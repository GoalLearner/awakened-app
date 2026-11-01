/**
 * membership-open.test.ts — W1122: no memberships for now (owner 2026-11-01). Every hunter
 * reads as a member, while `premium` keeps telling the truth about who actually pays.
 */
import { describe, expect, it } from 'vitest';
import { readEntitlements } from './iap-entitlements';
import { MEMBERSHIP_OPEN } from '../lib/membership';
import type { Env } from '../env';

function makeEnv(premiumExpiresAt?: number): Env {
  const db = {
    prepare: (sql: string) => ({
      bind: () => ({
        all: async () => ({ results: [], success: true, meta: {} }),
        first: async () => (sql.includes('FROM premium_subscriptions') && premiumExpiresAt != null
          ? { expires_at_ms: premiumExpiresAt }
          : null),
      }),
    }),
  };
  return { DB: db } as unknown as Env;
}

describe('W1122 — memberships are open', () => {
  it('the switch is on', () => {
    expect(MEMBERSHIP_OPEN).toBe(true);
  });

  it('a hunter with no subscription and no Founder mark is a member, and not premium', async () => {
    const r = await readEntitlements(makeEnv(), 'free-user');
    expect(r.member).toBe(true);
    expect(r.premium).toBe(false);
    expect(r.founder_seq).toBeNull();
  });

  it('a lapsed subscription still reads as a member, and not premium', async () => {
    const r = await readEntitlements(makeEnv(Date.now() - 1000), 'lapsed-user');
    expect(r.member).toBe(true);
    expect(r.premium).toBe(false);
  });

  it('a paying subscriber still reads as premium', async () => {
    const r = await readEntitlements(makeEnv(Date.now() + 86_400_000), 'paying-user');
    expect(r.member).toBe(true);
    expect(r.premium).toBe(true);
  });
});
