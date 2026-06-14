/**
 * iap-revenuecat-webhook.test.ts — shared-secret auth (fail closed), the
 * product→skin grant path, and the acknowledged-no-op paths. Same hand-rolled
 * D1 mock as the other handler tests.
 */
import { describe, expect, it } from 'vitest';
import { handleRevenueCatWebhook } from './iap-revenuecat-webhook';
import type { Env } from '../env';

const SECRET = 'Bearer test-webhook-secret';

interface CapturedCall { sql: string; binds: unknown[] }

function makeDb() {
  const calls: CapturedCall[] = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => {
        calls.push({ sql, binds: args });
        return {
          all: async () => ({ results: [], success: true, meta: {} }),
          first: async () => null,
          run: async () => ({ success: true, meta: { changes: 1 } }),
        };
      },
    }),
    _calls: () => calls,
  } as unknown as D1Database & { _calls: () => CapturedCall[] };
  return db;
}

function makeEnv(db: D1Database, secret: string | undefined = SECRET): Env {
  return { DB: db, REVENUECAT_WEBHOOK_AUTH: secret } as unknown as Env;
}

function webhook(body: unknown, auth: string | null = SECRET): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth !== null) headers.Authorization = auth;
  return new Request('https://api.test/v1/iap/revenuecat-webhook', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const purchase = (over: Record<string, unknown> = {}) => ({
  event: {
    type: 'INITIAL_PURCHASE',
    app_user_id: 'user-123',
    product_id: 'com.goallearner.awakened.skin.stardust',
    transaction_id: 'txn-abc',
    ...over,
  },
});

describe('handleRevenueCatWebhook — auth', () => {
  it('401s when the Authorization header is missing', async () => {
    const db = makeDb();
    const res = await handleRevenueCatWebhook(webhook(purchase(), null), makeEnv(db));
    expect(res.status).toBe(401);
    expect((db as unknown as { _calls: () => CapturedCall[] })._calls()).toHaveLength(0);
  });

  it('401s on a wrong secret', async () => {
    const db = makeDb();
    const res = await handleRevenueCatWebhook(webhook(purchase(), 'Bearer wrong'), makeEnv(db));
    expect(res.status).toBe(401);
  });

  it('fails closed when the env secret is unset (rejects even a provided header)', async () => {
    const db = makeDb();
    // Build env WITHOUT the secret field so it's genuinely undefined (passing
    // `undefined` to makeEnv would trigger its default param instead).
    const env = { DB: db } as unknown as Env;
    const res = await handleRevenueCatWebhook(webhook(purchase()), env);
    expect(res.status).toBe(401);
  });
});

describe('handleRevenueCatWebhook — grant', () => {
  it('grants the mapped skin on INITIAL_PURCHASE', async () => {
    const db = makeDb();
    const res = await handleRevenueCatWebhook(webhook(purchase()), makeEnv(db));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, granted: 'avatar-skin-stardust.png' });
    const calls = (db as unknown as { _calls: () => CapturedCall[] })._calls();
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/INSERT OR IGNORE INTO skin_entitlements/);
    expect(calls[0].binds).toEqual([
      'user-123',
      'avatar-skin-stardust.png',
      'com.goallearner.awakened.skin.stardust',
      'txn-abc',
    ]);
  });

  it('also grants on NON_RENEWING_PURCHASE', async () => {
    const db = makeDb();
    const res = await handleRevenueCatWebhook(
      webhook(purchase({ type: 'NON_RENEWING_PURCHASE' })),
      makeEnv(db),
    );
    expect(res.status).toBe(200);
    expect((await res.json() as { granted: string }).granted).toBe('avatar-skin-stardust.png');
  });
});

describe('handleRevenueCatWebhook — no-op paths', () => {
  it('acknowledges (no write) an unknown product', async () => {
    const db = makeDb();
    const res = await handleRevenueCatWebhook(
      webhook(purchase({ product_id: 'com.goallearner.awakened.skin.nope' })),
      makeEnv(db),
    );
    expect(res.status).toBe(200);
    expect((await res.json() as { reason: string }).reason).toBe('unknown_product');
    expect((db as unknown as { _calls: () => CapturedCall[] })._calls()).toHaveLength(0);
  });

  it('acknowledges (no write) a non-purchase event', async () => {
    const db = makeDb();
    const res = await handleRevenueCatWebhook(webhook(purchase({ type: 'CANCELLATION' })), makeEnv(db));
    expect(res.status).toBe(200);
    expect((db as unknown as { _calls: () => CapturedCall[] })._calls()).toHaveLength(0);
  });

  it('400s on a body with no event', async () => {
    const res = await handleRevenueCatWebhook(webhook({ nope: true }), makeEnv(makeDb()));
    expect(res.status).toBe(400);
  });
});
