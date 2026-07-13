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

  // W655 — the paid Founder pack was removed; its product id now maps to nothing,
  // so a (defunct) founders_lifetime purchase is acknowledged with no write.
  it('acknowledges (no grant) the removed founders_lifetime product', async () => {
    const db = makeDb();
    const res = await handleRevenueCatWebhook(
      webhook(purchase({ product_id: 'com.goallearner.awakened.founders_lifetime' })),
      makeEnv(db),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, granted: null, reason: 'unknown_product' });
    const calls = (db as unknown as { _calls: () => CapturedCall[] })._calls();
    expect(calls).toHaveLength(0); // no skin_entitlements write
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

// ── W650/W652 — auto-renewable "Awakened Premium" membership events ─────────
describe('handleRevenueCatWebhook — premium subscription (W650/W652)', () => {
  const FUTURE_MS = 1799999999000; // any fixed future horizon
  const EVENT_MS = 1783600000000;  // the RC event timestamp (drives write ordering)
  const premiumEvent = (type: string, over: Record<string, unknown> = {}) => ({
    event: {
      type,
      app_user_id: 'user-123',
      product_id: 'com.goallearner.awakened.premium.monthly',
      expiration_at_ms: FUTURE_MS,
      event_timestamp_ms: EVENT_MS,
      ...over,
    },
  });

  it('INITIAL_PURCHASE writes the horizon guarded by event-time ordering', async () => {
    const db = makeDb();
    const res = await handleRevenueCatWebhook(webhook(premiumEvent('INITIAL_PURCHASE')), makeEnv(db));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; premium: boolean; expires_at_ms: number };
    expect(body.premium).toBe(true);
    expect(body.expires_at_ms).toBe(FUTURE_MS);
    const calls = (db as unknown as { _calls: () => CapturedCall[] })._calls();
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('INSERT INTO premium_subscriptions');
    // W652 — last-writer-wins BY EVENT TIME: a redelivered/stale event can't
    // overwrite a newer truth, and a newer event may move the horizon in
    // EITHER direction (renewal forward, refund backward).
    expect(calls[0].sql).toMatch(/WHERE excluded\.last_event_ms > premium_subscriptions\.last_event_ms/);
    expect(calls[0].binds).toEqual(['user-123', 'com.goallearner.awakened.premium.monthly', FUTURE_MS, EVENT_MS]);
  });

  it('RENEWAL extends the horizon (same write path)', async () => {
    const db = makeDb();
    const res = await handleRevenueCatWebhook(webhook(premiumEvent('RENEWAL')), makeEnv(db));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { premium: boolean }).premium).toBe(true);
    expect((db as unknown as { _calls: () => CapturedCall[] })._calls()).toHaveLength(1);
  });

  it('voluntary CANCELLATION writes nothing — paid time keeps running until the horizon', async () => {
    const db = makeDb();
    const res = await handleRevenueCatWebhook(
      webhook(premiumEvent('CANCELLATION', { cancel_reason: 'UNSUBSCRIBE' })),
      makeEnv(db),
    );
    expect(res.status).toBe(200);
    expect((db as unknown as { _calls: () => CapturedCall[] })._calls()).toHaveLength(0);
  });

  it('W652 — refund CANCELLATION (CUSTOMER_SUPPORT) CLAWS the horizon back', async () => {
    const REFUND_MS = EVENT_MS; // RC moves expiration to the refund time
    const db = makeDb();
    const res = await handleRevenueCatWebhook(
      webhook(premiumEvent('CANCELLATION', { cancel_reason: 'CUSTOMER_SUPPORT', expiration_at_ms: REFUND_MS })),
      makeEnv(db),
    );
    expect(res.status).toBe(200);
    const calls = (db as unknown as { _calls: () => CapturedCall[] })._calls();
    expect(calls).toHaveLength(1);
    expect(calls[0].binds[2]).toBe(REFUND_MS);   // the horizon SHRINKS to the refund time
  });

  it('W652 — EXPIRATION adopts the (possibly pulled-in) horizon', async () => {
    const db = makeDb();
    const res = await handleRevenueCatWebhook(webhook(premiumEvent('EXPIRATION')), makeEnv(db));
    expect(res.status).toBe(200);
    expect((db as unknown as { _calls: () => CapturedCall[] })._calls()).toHaveLength(1);
  });

  it('W652 — BILLING_ISSUE keeps the member through the grace window', async () => {
    const GRACE_MS = FUTURE_MS + 16 * 24 * 3600 * 1000;
    const db = makeDb();
    const res = await handleRevenueCatWebhook(
      webhook(premiumEvent('BILLING_ISSUE', { grace_period_expiration_at_ms: GRACE_MS })),
      makeEnv(db),
    );
    expect(res.status).toBe(200);
    const calls = (db as unknown as { _calls: () => CapturedCall[] })._calls();
    expect(calls).toHaveLength(1);
    expect(calls[0].binds[2]).toBe(GRACE_MS);
  });

  it('a premium product NEVER rides the permanent skin-grant path', async () => {
    const db = makeDb();
    await handleRevenueCatWebhook(webhook(premiumEvent('INITIAL_PURCHASE')), makeEnv(db));
    const calls = (db as unknown as { _calls: () => CapturedCall[] })._calls();
    expect(calls.some((c) => c.sql.includes('skin_entitlements'))).toBe(false);
  });

  it('a horizon event missing expiration_at_ms is acknowledged with no write', async () => {
    const db = makeDb();
    const res = await handleRevenueCatWebhook(
      webhook(premiumEvent('INITIAL_PURCHASE', { expiration_at_ms: undefined })),
      makeEnv(db),
    );
    expect(res.status).toBe(200);
    expect((db as unknown as { _calls: () => CapturedCall[] })._calls()).toHaveLength(0);
  });
});
