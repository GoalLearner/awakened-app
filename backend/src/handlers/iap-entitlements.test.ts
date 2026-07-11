/**
 * iap-entitlements.test.ts — readEntitlements: the explicit-grant path and the
 * W626/W644 "First N Founders" grandfather (rank cap + go-live cutoff). Same
 * hand-rolled D1 mock as the other handler tests, extended so each prepared
 * statement can return a canned row.
 *
 * The W644 cutoff is the App-Review-critical branch: a fresh account created
 * AFTER go-live (like Apple's 2.1(b) review account) must NOT be auto-Founder'd,
 * or the Founder pack renders as "already purchased" on a brand-new account.
 */
import { describe, expect, it } from 'vitest';
import { readEntitlements } from './iap-entitlements';
import type { Env } from '../env';

// 2026-07-09T00:00:00Z — must mirror FOUNDER_PROMO_CUTOFF_MS in the handler.
const CUTOFF_MS = 1783555200000;
const PRE_LAUNCH = CUTOFF_MS - 60_000;  // account created before go-live
const POST_LAUNCH = CUTOFF_MS + 60_000; // account created after go-live (reviewer case)

interface UserRow { created_at: number }

/** D1 mock: routes each prepared SQL to a canned response by substring. */
function makeDb(opts: {
  skins?: string[];          // rows in skin_entitlements for the caller
  user?: UserRow | null;     // the caller's users row (null = missing)
  earlier?: number;          // accounts registered before the caller
}) {
  const skins = (opts.skins ?? []).map((skin_id) => ({ skin_id }));
  return {
    prepare: (sql: string) => ({
      bind: () => ({
        all: async () => ({ results: skins, success: true, meta: {} }),
        first: async () => {
          if (sql.includes('FROM users WHERE id')) return opts.user === undefined ? { created_at: PRE_LAUNCH } : opts.user;
          if (sql.includes('COUNT(*) AS earlier')) return { earlier: opts.earlier ?? 0 };
          return null;
        },
        run: async () => ({ success: true, meta: { changes: 0 } }),
      }),
    }),
  } as unknown as D1Database;
}

function makeEnv(db: D1Database, firstN?: string): Env {
  return { DB: db, FOUNDER_FIRST_N: firstN } as unknown as Env;
}

describe('readEntitlements — explicit grants', () => {
  it('returns owned skins and filters the reserved founder id out of skins', async () => {
    const db = makeDb({ skins: ['avatar-skin-stardust.png', 'founder'], user: { created_at: POST_LAUNCH } });
    const r = await readEntitlements(makeEnv(db), 'user-1');
    expect(r.skins).toEqual(['avatar-skin-stardust.png']);
    expect(r.founder).toBe(true); // explicit entitlement wins regardless of promo window
  });
});

describe('readEntitlements — First-N Founder grandfather (W626 + W644 cutoff)', () => {
  it('grandfathers a pre-launch account inside the first N', async () => {
    const db = makeDb({ user: { created_at: PRE_LAUNCH }, earlier: 5 });
    const r = await readEntitlements(makeEnv(db), 'user-1');
    expect(r.founder).toBe(true);
  });

  it('does NOT grandfather an account created after go-live, even at rank < N (the App-Review case)', async () => {
    const db = makeDb({ user: { created_at: POST_LAUNCH }, earlier: 33 });
    const r = await readEntitlements(makeEnv(db), 'reviewer-fresh-account');
    expect(r.founder).toBe(false);
  });

  it('does NOT grandfather a pre-launch account at rank >= N', async () => {
    const db = makeDb({ user: { created_at: PRE_LAUNCH }, earlier: 100 });
    const r = await readEntitlements(makeEnv(db), 'user-101');
    expect(r.founder).toBe(false);
  });

  it('respects FOUNDER_FIRST_N=0 as a promo kill-switch', async () => {
    const db = makeDb({ user: { created_at: PRE_LAUNCH }, earlier: 0 });
    const r = await readEntitlements(makeEnv(db, '0'), 'user-1');
    expect(r.founder).toBe(false);
  });

  it('fails closed when the users row is missing', async () => {
    const db = makeDb({ user: null, earlier: 0 });
    const r = await readEntitlements(makeEnv(db), 'ghost');
    expect(r.founder).toBe(false);
  });
});
