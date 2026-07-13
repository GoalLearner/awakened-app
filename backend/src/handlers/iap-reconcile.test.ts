/**
 * iap-reconcile.test.ts — W637 self-healing grant. Verifies the handler reads
 * the caller's purchases from RevenueCat's REST API and grants any missing
 * locally (idempotent), maps the Founder product, ignores unknown products,
 * fails soft when RevenueCat is unreachable, and honours the rate limit.
 *
 * Uses the same hand-rolled D1 mock style as the other handler tests, extended
 * to track inserted rows so the post-insert read-back reflects the grants.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleEntitlementsReconcile } from './iap-reconcile';
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';

interface CapturedCall { sql: string; binds: unknown[] }

/** DB mock: INSERT OR IGNORE tracks new skin_ids (changes:1 first time, 0 after);
 *  the readEntitlements SELECT returns the existing + inserted rows. `claimedTxns`
 *  maps a store_txn_id → the user_id that already owns it, so the anti-farming
 *  claim-check query (store_txn_id = ? AND user_id <> ?) can return a claimant. */
function makeDb(existingSkins: string[] = [], claimedTxns: Record<string, string> = {}) {
  const calls: CapturedCall[] = [];
  const inserted: string[] = [];
  const owned = () => [...existingSkins, ...inserted];
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => {
        calls.push({ sql, binds: args });
        return {
          all: async () => ({ results: owned().map((s) => ({ skin_id: s })), success: true, meta: {} }),
          first: async () => {
            // anti-farming claim check: SELECT user_id ... WHERE store_txn_id=? AND user_id<>?
            if (/store_txn_id = \? AND user_id <> \?/.test(sql)) {
              const txn = String(args[0]);
              const asker = String(args[1]);
              const ownerOf = claimedTxns[txn];
              return ownerOf && ownerOf !== asker ? { user_id: ownerOf } : null;
            }
            return null;
          },
          run: async () => {
            if (/INSERT OR IGNORE INTO skin_entitlements/.test(sql)) {
              const skinId = String(args[1]);
              if (!owned().includes(skinId)) { inserted.push(skinId); return { success: true, meta: { changes: 1 } }; }
              return { success: true, meta: { changes: 0 } };
            }
            return { success: true, meta: { changes: 0 } };
          },
        };
      },
    }),
    _calls: () => calls,
    _inserted: () => inserted,
  } as unknown as D1Database & { _calls: () => CapturedCall[]; _inserted: () => string[] };
  return db;
}

function makeEnv(db: D1Database, rlSuccess = true): Env {
  return {
    DB: db,
    RL_IAP_RECONCILE: { limit: async () => ({ success: rlSuccess }) },
  } as unknown as Env;
}

const SESSION = { userId: 'user-123' } as unknown as SessionPayload;
const req = () => new Request('https://api.test/v1/users/me/entitlements/reconcile', { method: 'POST' });

/** Stub global fetch to return an RC subscriber payload (200) or a status code. */
function stubRc(nonSubscriptions: Record<string, Array<Record<string, unknown>>> | null, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(
      nonSubscriptions === null ? 'err' : JSON.stringify({ subscriber: { non_subscriptions: nonSubscriptions } }),
      { status, headers: { 'content-type': 'application/json' } },
    ),
  ));
}

afterEach(() => vi.unstubAllGlobals());

describe('handleEntitlementsReconcile', () => {
  it('grants a purchase RevenueCat knows about but the DB is missing', async () => {
    stubRc({
      'com.goallearner.awakened.skin.nullprotocol': [{ store_transaction_id: 'txn-null' }],
      'com.goallearner.awakened.skin.stardust.sovereign': [{ store_transaction_id: 'txn-star' }],
    });
    const db = makeDb(['avatar-skin-nullprotocol.png']); // nullprotocol already owned; stardust missing
    const res = await handleEntitlementsReconcile(req(), makeEnv(db), SESSION);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; reconciled: number; skins: string[] };
    expect(body.ok).toBe(true);
    expect(body.reconciled).toBe(1); // only stardust was newly granted
    expect(body.skins.sort()).toEqual(['avatar-skin-nullprotocol.png', 'avatar-skin-stardust.png']);
    // the stardust insert used the mapped skin id + product id + last txn id
    // (both products get an idempotent INSERT OR IGNORE; only stardust is new).
    const insert = db._calls().find((c) => /INSERT OR IGNORE/.test(c.sql) && c.binds[1] === 'avatar-skin-stardust.png');
    expect(insert?.binds).toEqual(['user-123', 'avatar-skin-stardust.png', 'com.goallearner.awakened.skin.stardust.sovereign', 'txn-star']);
  });

  it('is idempotent — an already-owned purchase grants nothing new', async () => {
    stubRc({ 'com.goallearner.awakened.skin.stardust.sovereign': [{ store_transaction_id: 'txn-star' }] });
    const db = makeDb(['avatar-skin-stardust.png']); // already owned
    const res = await handleEntitlementsReconcile(req(), makeEnv(db), SESSION);
    const body = await res.json() as { reconciled: number; skins: string[] };
    expect(body.reconciled).toBe(0);
    expect(body.skins).toEqual(['avatar-skin-stardust.png']);
  });

  it('W655 — the removed founders_lifetime product is now an unknown product (no grant)', async () => {
    stubRc({ 'com.goallearner.awakened.founders_lifetime': [{ store_transaction_id: 'txn-f' }] });
    const db = makeDb([]);
    const res = await handleEntitlementsReconcile(req(), makeEnv(db), SESSION);
    const body = await res.json() as { reconciled: number; skins: string[] };
    expect(body.reconciled).toBe(0); // maps to nothing → ignored
    expect(body.skins).toEqual([]);
  });

  it('refuses to grant a transaction already claimed by another user (anti-farming)', async () => {
    // Same Apple receipt restored onto a second free account: reconcile must NOT
    // re-grant it (buy-once-farm-onto-N-accounts exploit).
    stubRc({ 'com.goallearner.awakened.skin.stardust.sovereign': [{ store_transaction_id: 'txn-shared' }] });
    const db = makeDb([], { 'txn-shared': 'other-user-999' }); // txn already owned elsewhere
    const res = await handleEntitlementsReconcile(req(), makeEnv(db), SESSION);
    const body = await res.json() as { reconciled: number; skins: string[] };
    expect(body.reconciled).toBe(0);
    expect(body.skins).toEqual([]);
    expect(db._calls().some((c) => /INSERT OR IGNORE/.test(c.sql))).toBe(false); // never inserted
  });

  it('ignores unknown products (no insert)', async () => {
    stubRc({ 'com.goallearner.awakened.skin.doesnotexist': [{ store_transaction_id: 'x' }] });
    const db = makeDb([]);
    const res = await handleEntitlementsReconcile(req(), makeEnv(db), SESSION);
    const body = await res.json() as { reconciled: number };
    expect(body.reconciled).toBe(0);
    expect(db._calls().some((c) => /INSERT OR IGNORE/.test(c.sql))).toBe(false);
  });

  it('fails soft when RevenueCat is unreachable — returns current entitlements, no throw', async () => {
    stubRc(null, 500);
    const db = makeDb(['avatar-skin-nullprotocol.png']);
    const res = await handleEntitlementsReconcile(req(), makeEnv(db), SESSION);
    expect(res.status).toBe(200);
    const body = await res.json() as { reconciled: number; skins: string[] };
    expect(body.reconciled).toBe(0);
    expect(body.skins).toEqual(['avatar-skin-nullprotocol.png']); // existing grant still returned
  });

  it('429s when rate-limited (no RevenueCat call)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const db = makeDb([]);
    const res = await handleEntitlementsReconcile(req(), makeEnv(db, false), SESSION);
    expect(res.status).toBe(429);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
