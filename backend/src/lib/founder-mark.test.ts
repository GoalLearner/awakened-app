/**
 * founder-mark.test.ts — W698 earned Founder: eligibility is 50 boss kills, the promo
 * is atomically capped at 20, and a Founder mark is a lifetime membership. Hand-rolled
 * substring-routed D1 mock (same pattern as the other handler tests).
 */
import { describe, expect, it } from 'vitest';
import { isFounderMarkEligible, maybeGrantFounderMark, FOUNDER_MARK_CAP, FOUNDER_KILL_THRESHOLD } from './founder-mark';
import type { Env } from '../env';

/** opts: bossesSlain (public_profile_summary total; undefined = no row = sim),
 *  existingSeq (already-marked), markCount (current founder_marks count). */
function makeEnv(opts: {
  bossesSlain?: number; existingSeq?: number; markCount?: number;
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
          if (/bosses_slain_total FROM public_profile_summary/.test(sql)) {
            return opts.bossesSlain === undefined ? null : { bosses_slain_total: opts.bossesSlain };
          }
          return null;
        },
        run: async () => {
          if (/INSERT INTO founder_marks/.test(sql)) {
            if (count < FOUNDER_MARK_CAP) { count += 1; didInsert = true; }
          }
          return { success: true, meta: { changes: 1 } };
        },
        all: async () => ({ results: [], success: true, meta: {} }),
      }),
    }),
  } as unknown as D1Database;
  return { env: { DB: db } as unknown as Env, inserted: () => didInsert };
}

describe('isFounderMarkEligible (50 boss kills)', () => {
  it('50 kills → eligible', async () => {
    const { env } = makeEnv({ bossesSlain: FOUNDER_KILL_THRESHOLD });
    expect(await isFounderMarkEligible(env, 'u1')).toBe(true);
  });
  it('above 50 → eligible', async () => {
    const { env } = makeEnv({ bossesSlain: 137 });
    expect(await isFounderMarkEligible(env, 'u1')).toBe(true);
  });
  it('49 kills → NOT eligible', async () => {
    const { env } = makeEnv({ bossesSlain: 49 });
    expect(await isFounderMarkEligible(env, 'u1')).toBe(false);
  });
  it('SIM / no profile row → NOT eligible', async () => {
    const { env } = makeEnv({ bossesSlain: undefined });
    expect(await isFounderMarkEligible(env, 'sim-42')).toBe(false);
  });
});

describe('maybeGrantFounderMark (cap 20)', () => {
  it('grants an eligible newcomer and returns the next seq', async () => {
    const { env, inserted } = makeEnv({ bossesSlain: 60, markCount: 4 });
    const seq = await maybeGrantFounderMark(env, 'u1');
    expect(inserted()).toBe(true);
    expect(seq).toBe(5);
  });
  it('an already-marked user returns the existing seq without inserting', async () => {
    const { env, inserted } = makeEnv({ existingSeq: 7 });
    expect(await maybeGrantFounderMark(env, 'u1')).toBe(7);
    expect(inserted()).toBe(false);
  });
  it('at the cap (20) does not mint a 21st', async () => {
    const { env, inserted } = makeEnv({ bossesSlain: 200, markCount: FOUNDER_MARK_CAP });
    const seq = await maybeGrantFounderMark(env, 'u1');
    expect(inserted()).toBe(false);   // guard blocks the insert
    expect(seq).toBe(null);
  });
  it('an under-50 hunter is not granted', async () => {
    const { env, inserted } = makeEnv({ bossesSlain: 10 });
    expect(await maybeGrantFounderMark(env, 'u1')).toBe(null);
    expect(inserted()).toBe(false);
  });
});
