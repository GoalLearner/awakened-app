/**
 * founder-mark.test.ts — W656 free Founder marker: server-verifiable eligibility,
 * the atomic cap, and sim/post-cutoff exclusion. Hand-rolled substring-routed D1
 * mock (same pattern as the other handler tests).
 */
import { describe, expect, it } from 'vitest';
import { isFounderMarkEligible, maybeGrantFounderMark, FOUNDER_CUTOFF_MS } from './founder-mark';
import type { Env } from '../env';

const PRE = FOUNDER_CUTOFF_MS - 60_000;
const POST = FOUNDER_CUTOFF_MS + 60_000;

/** opts: createdAt (users row; undefined = no row = sim), has100k, coopWins,
 *  existingSeq (already-marked), markCount (current founder_marks count). */
function makeEnv(opts: {
  createdAt?: number; has100k?: boolean; coopWins?: number;
  existingSeq?: number; markCount?: number;
}): { env: Env; inserted: () => boolean } {
  let didInsert = false;
  let count = opts.markCount ?? 0;
  const db = {
    prepare: (sql: string) => ({
      bind: () => ({
        first: async () => {
          if (/FROM founder_marks WHERE user_id/.test(sql)) {
            if (opts.existingSeq != null) return { seq: opts.existingSeq };
            return didInsert ? { seq: count } : null;
          }
          if (/FROM users WHERE id/.test(sql)) return opts.createdAt === undefined ? null : { created_at: opts.createdAt };
          if (/FROM user_accolades/.test(sql)) return opts.has100k ? { x: 1 } : null;
          if (/COUNT\(\*\) AS n FROM coop_boss_awards/.test(sql)) return { n: opts.coopWins ?? 0 };
          return null;
        },
        run: async () => {
          if (/INSERT INTO founder_marks/.test(sql)) {
            if (count < 100) { count += 1; didInsert = true; }
          }
          return { success: true, meta: { changes: 1 } };
        },
        all: async () => ({ results: [], success: true, meta: {} }),
      }),
    }),
  } as unknown as D1Database;
  return { env: { DB: db } as unknown as Env, inserted: () => didInsert };
}

describe('isFounderMarkEligible', () => {
  it('pre-cutoff + 100K Club → eligible', async () => {
    const { env } = makeEnv({ createdAt: PRE, has100k: true });
    expect(await isFounderMarkEligible(env, 'u1')).toBe(true);
  });
  it('pre-cutoff + 25 co-op wins → eligible', async () => {
    const { env } = makeEnv({ createdAt: PRE, coopWins: 25 });
    expect(await isFounderMarkEligible(env, 'u1')).toBe(true);
  });
  it('pre-cutoff but 24 co-op wins and no 100K → NOT eligible', async () => {
    const { env } = makeEnv({ createdAt: PRE, coopWins: 24 });
    expect(await isFounderMarkEligible(env, 'u1')).toBe(false);
  });
  it('POST-cutoff account (even with 100K) → NOT eligible', async () => {
    const { env } = makeEnv({ createdAt: POST, has100k: true, coopWins: 99 });
    expect(await isFounderMarkEligible(env, 'reviewer')).toBe(false);
  });
  it('SIM (no users row) → NOT eligible', async () => {
    const { env } = makeEnv({ createdAt: undefined, has100k: true, coopWins: 99 });
    expect(await isFounderMarkEligible(env, 'sim-42')).toBe(false);
  });
});

describe('maybeGrantFounderMark', () => {
  it('grants an eligible newcomer and returns a seq', async () => {
    const { env, inserted } = makeEnv({ createdAt: PRE, has100k: true, markCount: 4 });
    const seq = await maybeGrantFounderMark(env, 'u1');
    expect(inserted()).toBe(true);
    expect(seq).toBe(5);
  });
  it('an already-marked user returns the existing seq without inserting', async () => {
    const { env, inserted } = makeEnv({ existingSeq: 7 });
    expect(await maybeGrantFounderMark(env, 'u1')).toBe(7);
    expect(inserted()).toBe(false);
  });
  it('at the cap (100) does not mint a 101st', async () => {
    const { env, inserted } = makeEnv({ createdAt: PRE, has100k: true, markCount: 100 });
    const seq = await maybeGrantFounderMark(env, 'u1');
    expect(inserted()).toBe(false);   // guard blocks the insert
    expect(seq).toBe(null);
  });
  it('an ineligible user is not granted', async () => {
    const { env, inserted } = makeEnv({ createdAt: POST, has100k: true });
    expect(await maybeGrantFounderMark(env, 'u1')).toBe(null);
    expect(inserted()).toBe(false);
  });
});
