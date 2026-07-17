/**
 * iap-entitlements.test.ts — readEntitlements: owned skins + the Awakened
 * Premium membership derivation. W655 — the paid Founder tier (one-time pack +
 * first-N grandfather promo) was removed; the subscription is the only paid
 * tier, so `member` == `premium`.
 */
import { describe, expect, it } from 'vitest';
import { readEntitlements } from './iap-entitlements';
import type { Env } from '../env';

/** D1 mock: routes each prepared SQL to a canned response by substring. */
function makeDb(opts: {
  skins?: string[];          // rows in skin_entitlements for the caller
  premiumExpiresAt?: number; // W650 — premium_subscriptions horizon (absent = no row)
  founderSeq?: number;       // W698 — the caller's founder_marks seq (absent = not a Founder)
}) {
  const skins = (opts.skins ?? []).map((skin_id) => ({ skin_id }));
  return {
    prepare: (sql: string) => ({
      bind: () => ({
        all: async () => ({ results: skins, success: true, meta: {} }),
        first: async () => {
          if (sql.includes('FROM premium_subscriptions')) {
            return opts.premiumExpiresAt != null ? { expires_at_ms: opts.premiumExpiresAt } : null;
          }
          if (sql.includes('FROM founder_marks')) {
            return opts.founderSeq != null ? { seq: opts.founderSeq } : null;
          }
          return null;
        },
        run: async () => ({ success: true, meta: { changes: 0 } }),
      }),
    }),
  } as unknown as D1Database;
}

function makeEnv(db: D1Database): Env {
  return { DB: db } as unknown as Env;
}

describe('readEntitlements — owned skins', () => {
  it('returns the caller owned skin ids', async () => {
    const r = await readEntitlements(makeEnv(makeDb({ skins: ['avatar-skin-stardust.png', 'avatar-skin-tempest.png'] })), 'user-1');
    expect(r.skins).toEqual(['avatar-skin-stardust.png', 'avatar-skin-tempest.png']);
  });

  it('no rows → empty skins, not a member', async () => {
    const r = await readEntitlements(makeEnv(makeDb({})), 'free-user');
    expect(r.skins).toEqual([]);
    expect(r.member).toBe(false);
  });
});

// ── W650/W655 — premium membership derivation (expiry-based, no revocation events) ──
describe('readEntitlements — premium membership', () => {
  it('an unexpired premium horizon → premium=true, member=true', async () => {
    const r = await readEntitlements(makeEnv(makeDb({ premiumExpiresAt: Date.now() + 86_400_000 })), 'subscriber-1');
    expect(r.premium).toBe(true);
    expect(r.member).toBe(true);
  });

  it('a LAPSED horizon self-revokes: premium=false, member=false', async () => {
    const r = await readEntitlements(makeEnv(makeDb({ premiumExpiresAt: Date.now() - 1000 })), 'lapsed-subscriber');
    expect(r.premium).toBe(false);
    expect(r.member).toBe(false);
  });

  it('no subscription row at all → premium=false, member=false', async () => {
    const r = await readEntitlements(makeEnv(makeDb({})), 'free-user');
    expect(r.premium).toBe(false);
    expect(r.member).toBe(false);
  });

  it('owning skins does NOT confer membership', async () => {
    const r = await readEntitlements(makeEnv(makeDb({ skins: ['avatar-skin-bloodmoon.png'] })), 'skin-owner');
    expect(r.member).toBe(false);
  });
});

// ── W698 — a Founder mark is an EARNED lifetime membership ──────────────────
describe('readEntitlements — Founder lifetime membership', () => {
  it('a Founder (no premium) → member=true, founder_seq set, premium=false', async () => {
    const r = await readEntitlements(makeEnv(makeDb({ founderSeq: 3 })), 'founder-3');
    expect(r.premium).toBe(false);
    expect(r.member).toBe(true);
    expect(r.founder_seq).toBe(3);
  });

  it('a Founder with a LAPSED premium is STILL a member (the mark is lifetime)', async () => {
    const r = await readEntitlements(makeEnv(makeDb({ founderSeq: 1, premiumExpiresAt: Date.now() - 1000 })), 'founder-1');
    expect(r.premium).toBe(false);
    expect(r.member).toBe(true);
  });

  it('a non-Founder non-subscriber is not a member', async () => {
    const r = await readEntitlements(makeEnv(makeDb({})), 'nobody');
    expect(r.member).toBe(false);
    expect(r.founder_seq).toBe(null);
  });
});

// ── W652 — the premium-query guard swallows ONLY the missing-table case ──────
describe('readEntitlements — premium D1 error handling (W652)', () => {
  function makeThrowingDb(err: string) {
    return {
      prepare: (sql: string) => ({
        bind: () => ({
          all: async () => ({ results: [], success: true, meta: {} }),
          first: async () => {
            if (sql.includes('FROM premium_subscriptions')) throw new Error(err);
            return null;
          },
          run: async () => ({ success: true, meta: { changes: 0 } }),
        }),
      }),
    } as unknown as D1Database;
  }

  it('missing table (migration not applied) → premium quietly false', async () => {
    const r = await readEntitlements(makeEnv(makeThrowingDb('no such table: premium_subscriptions')), 'u1');
    expect(r.premium).toBe(false);
  });

  it('any OTHER D1 error PROPAGATES (a 500 must not read as premium=false)', async () => {
    await expect(readEntitlements(makeEnv(makeThrowingDb('D1_ERROR: network timeout')), 'u1')).rejects.toThrow();
  });
});
