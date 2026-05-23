/**
 * leaderboard-submit.test.ts -- Handler-shape tests for the weekly
 * scoping change (v3 Phase 1z.33).
 *
 * Following the project convention from accolades.test.ts: we don't
 * ship miniflare-D1 / better-sqlite3, so SQL-behavior validation
 * (e.g. ON CONFLICT MAX preservation, real ORDER BY) is exercised
 * end-to-end via sims/scripts/*.ps1 against the production backend.
 *
 * These tests cover the deterministic handler logic that's testable
 * without a real SQL engine: that step_total submits pass the current
 * Sunday-UTC week key as the 6th bound argument, and that non-weekly
 * metrics pass NULL for the same column.
 */
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { handleLeaderboardSubmit } from './leaderboard-submit';
import type { Env } from '../env';

const okRl = { limit: async () => ({ success: true }) };

interface CapturedCall {
  sql: string;
  binds: unknown[];
}

function makeDb(snapshotRow: { current_value: number; best_value: number } | null = null) {
  const calls: CapturedCall[] = [];
  return {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => {
        calls.push({ sql, binds: args });
        return {
          all:   async () => ({ results: [], success: true, meta: {} }),
          first: async () => {
            if (sql.includes('FROM leaderboard_snapshots')) return snapshotRow;
            if (sql.includes('FROM users')) return { apple_sub: 'apple_real_user' };
            return null;
          },
          run:   async () => ({ success: true, meta: { changes: 1 } }),
        };
      },
    }),
    _calls: () => calls,
  } as unknown as D1Database & { _calls: () => CapturedCall[] };
}

function makeEnv(db: D1Database): Env {
  return {
    DB: db,
    JWT_SIGNING_KEY: 'unused-in-this-test',
    APPLE_BUNDLE_ID: 'com.goallearner.awakened',
    APPLE_TEAM_ID: 'LK8FVGBQPL',
    RL_AUTH_VERIFY: okRl,
    RL_LEADERBOARD_SUBMIT: okRl,
    RL_LEADERBOARD_TOP: okRl,
    RL_ACCOUNT_DELETE: okRl,
    RL_USER_STATE_GET: okRl,
    RL_USER_STATE_POST: okRl,
    RL_FRIENDS_READ: okRl,
    RL_FRIENDS_WRITE: okRl,
    RL_DUELS_READ: okRl,
    RL_DUELS_WRITE: okRl,
    RL_USER_ACCOLADES_READ: okRl,
  } as unknown as Env;
}

const session = { userId: 'user-abc', alias: 'TestHunter' };

function makeReq(body: unknown): Request {
  return new Request('https://example.com/v1/leaderboard/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /v1/leaderboard/submit -- weekly scoping (1z.33)', () => {
  // Pin time to 2026-05-17 (Sunday) UTC -- the week-start key for that
  // moment is '2026-05-17'. Same week as the rest of the test suite.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 4, 17, 13, 0, 0)));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('tags step_total submits with the current Sunday-UTC week_start', async () => {
    const db = makeDb({ current_value: 12000, best_value: 12000 });
    const env = makeEnv(db);
    const res = await handleLeaderboardSubmit(makeReq({ metric: 'step_total', current_value: 12000 }), env, session);
    expect(res.status).toBe(200);

    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    const insert = calls.find(c => c.sql.includes('INSERT INTO leaderboard_snapshots'));
    expect(insert).toBeDefined();
    // 6th bind arg is week_start (after user_id, metric, current_value, best_value, updated_at)
    expect(insert!.binds[0]).toBe('user-abc');
    expect(insert!.binds[1]).toBe('step_total');
    expect(insert!.binds[2]).toBe(12000);
    expect(insert!.binds[3]).toBe(12000);
    expect(typeof insert!.binds[4]).toBe('number'); // updated_at
    expect(insert!.binds[5]).toBe('2026-05-17');     // week_start
  });

  it('writes NULL week_start for non-weekly metrics (sleep_streak)', async () => {
    const db = makeDb({ current_value: 14, best_value: 22 });
    const env = makeEnv(db);
    const res = await handleLeaderboardSubmit(makeReq({ metric: 'sleep_streak', current_value: 14 }), env, session);
    expect(res.status).toBe(200);

    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    const insert = calls.find(c => c.sql.includes('INSERT INTO leaderboard_snapshots'));
    expect(insert).toBeDefined();
    expect(insert!.binds[1]).toBe('sleep_streak');
    expect(insert!.binds[5]).toBe(null);
  });

  it('writes NULL week_start for bedtime_streak', async () => {
    const db = makeDb({ current_value: 7, best_value: 10 });
    const env = makeEnv(db);
    const res = await handleLeaderboardSubmit(makeReq({ metric: 'bedtime_streak', current_value: 7 }), env, session);
    expect(res.status).toBe(200);

    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    const insert = calls.find(c => c.sql.includes('INSERT INTO leaderboard_snapshots'));
    expect(insert!.binds[5]).toBe(null);
  });

  // ── v3 Phase 1z.131 — same-week monotonic current_value ──────────
  // Bug repro: rendiesel submitted step_total=101,259 then later
  // 73,840 same week. Previously current_value was overwritten to
  // 73,840 even though best_value+weekly_step_records preserved 101K
  // — producing the "100K Club shows 101K but This Week shows 73K"
  // mismatch. Fix is a CASE in the ON CONFLICT clause that pins
  // current_value to MAX(existing, new) when weeks match.
  it('current_value is MAX-preserved within the same week for weekly metrics (step_total)', async () => {
    const db = makeDb({ current_value: 5000, best_value: 35000 });
    const env = makeEnv(db);
    await handleLeaderboardSubmit(makeReq({ metric: 'step_total', current_value: 5000 }), env, session);

    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    const insert = calls.find(c => c.sql.includes('INSERT INTO leaderboard_snapshots'))!;
    // SQL must contain the same-week monotonic CASE for current_value.
    // Match shape: CASE WHEN ... week_start IS NOT NULL ... = excluded.week_start
    // THEN MAX(... current_value, excluded.current_value) ELSE excluded.current_value END
    expect(insert.sql).toMatch(/current_value\s*=\s*CASE/i);
    expect(insert.sql).toMatch(/excluded\.week_start\s+IS\s+NOT\s+NULL/i);
    expect(insert.sql).toMatch(/leaderboard_snapshots\.week_start\s*=\s*excluded\.week_start/i);
    expect(insert.sql).toMatch(/MAX\(leaderboard_snapshots\.current_value,\s*excluded\.current_value\)/i);
    // ELSE branch must fall through to the new value (cross-week / NULL).
    expect(insert.sql).toMatch(/ELSE\s+excluded\.current_value/i);
  });

  it('current_value MAX-preservation also applies to flights_climbed (weekly cumulative)', async () => {
    const db = makeDb({ current_value: 50, best_value: 77 });
    const env = makeEnv(db);
    await handleLeaderboardSubmit(makeReq({ metric: 'flights_climbed', current_value: 50 }), env, session);

    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    const insert = calls.find(c => c.sql.includes('INSERT INTO leaderboard_snapshots'))!;
    // Same CASE clause covers flights_climbed because it's a weekly metric
    // (week_start is non-NULL via WEEKLY_METRICS in metrics.ts).
    expect(insert.sql).toMatch(/current_value\s*=\s*CASE/i);
    expect(insert.sql).toMatch(/MAX\(leaderboard_snapshots\.current_value,\s*excluded\.current_value\)/i);
  });

  it('streak metrics (sleep_streak) hit the ELSE branch — current_value can decrease when streak breaks', async () => {
    const db = makeDb({ current_value: 12, best_value: 22 });
    const env = makeEnv(db);
    // streak broke; client submits 0
    await handleLeaderboardSubmit(makeReq({ metric: 'sleep_streak', current_value: 0 }), env, session);

    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    const insert = calls.find(c => c.sql.includes('INSERT INTO leaderboard_snapshots'))!;
    // week_start bound as NULL for non-weekly metrics — the
    // `excluded.week_start IS NOT NULL` guard falls through to ELSE
    // and current_value gets overwritten with the new (lower) value.
    expect(insert.binds[5]).toBe(null);
    expect(insert.sql).toMatch(/ELSE\s+excluded\.current_value/i);
  });

  it('INSERT SQL preserves week_start on conflict so new-week resubmits overwrite the prior tag', async () => {
    const db = makeDb({ current_value: 5000, best_value: 35000 });
    const env = makeEnv(db);
    await handleLeaderboardSubmit(makeReq({ metric: 'step_total', current_value: 5000 }), env, session);

    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    const insert = calls.find(c => c.sql.includes('INSERT INTO leaderboard_snapshots'))!;
    // ON CONFLICT clause must update week_start to excluded.week_start
    // -- otherwise a user submitting in week W+1 would keep their stale
    // week W tag and never appear in the new week's ranking.
    expect(insert.sql).toMatch(/ON CONFLICT[\s\S]+week_start\s*=\s*excluded\.week_start/i);
  });

  it('still awards 100K accolade when step_total >= 100000 (best_value preserved across weeks)', async () => {
    const db = makeDb({ current_value: 104821, best_value: 104821 });
    const env = makeEnv(db);
    const res = await handleLeaderboardSubmit(makeReq({ metric: 'step_total', current_value: 104821 }), env, session);
    expect(res.status).toBe(200);

    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    // user_accolades INSERT is the second write
    const accoladeInsert = calls.find(c => c.sql.includes('INSERT INTO user_accolades'));
    expect(accoladeInsert).toBeDefined();
    // unlock_week_start and last_qualified_week_start both reference '2026-05-17'
    expect(accoladeInsert!.binds).toContain('2026-05-17');
    expect(accoladeInsert!.binds).toContain('step_100k_club');
  });

  // ── v3 Phase 1z.36 — Weekly Steps Hall of Fame write path ──────
  it('writes a weekly_step_records row on a real-user step_total submit', async () => {
    const db = makeDb({ current_value: 88420, best_value: 88420 });
    const env = makeEnv(db);
    const res = await handleLeaderboardSubmit(makeReq({ metric: 'step_total', current_value: 88420 }), env, session);
    expect(res.status).toBe(200);

    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    const wsrInsert = calls.find(c => c.sql.includes('INSERT INTO weekly_step_records'));
    expect(wsrInsert).toBeDefined();
    // bind layout: id, user_id, week_start, steps, created_at, updated_at
    expect(wsrInsert!.binds[1]).toBe('user-abc');
    expect(wsrInsert!.binds[2]).toBe('2026-05-17');
    expect(wsrInsert!.binds[3]).toBe(88420);
  });

  it('weekly_step_records UPSERT preserves the higher value (same-week lower resubmit cannot reduce)', async () => {
    const db = makeDb({ current_value: 50000, best_value: 88420 });
    const env = makeEnv(db);
    await handleLeaderboardSubmit(makeReq({ metric: 'step_total', current_value: 50000 }), env, session);
    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    const wsrInsert = calls.find(c => c.sql.includes('INSERT INTO weekly_step_records'));
    expect(wsrInsert).toBeDefined();
    // ON CONFLICT clause must use MAX(weekly_step_records.steps, excluded.steps)
    expect(wsrInsert!.sql).toMatch(/ON CONFLICT[\s\S]+steps\s*=\s*MAX\(weekly_step_records\.steps,\s*excluded\.steps\)/i);
  });

  it('does NOT write weekly_step_records for sleep_streak or bedtime_streak', async () => {
    const db = makeDb({ current_value: 14, best_value: 22 });
    const env = makeEnv(db);
    await handleLeaderboardSubmit(makeReq({ metric: 'sleep_streak', current_value: 14 }), env, session);
    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    const wsrInsert = calls.find(c => c.sql.includes('INSERT INTO weekly_step_records'));
    expect(wsrInsert).toBeUndefined();
  });

  // ── v3 Phase 1z.38 — Hall of Fame write isolation ──────────────
  // The weekly_step_records INSERT is wrapped in try/catch so a
  // missing table (e.g. worker deployed before migration 0009) or
  // any other transient failure on the HoF write degrades to a
  // logged warning while the rest of the submit completes normally.
  describe('Hall of Fame write isolation (1z.38)', () => {
    // Build a DB that throws on the weekly_step_records INSERT only.
    // All other prepare(...).run() / .first() calls behave normally.
    function makeDbWithHofThrow(snapshotRow: { current_value: number; best_value: number }) {
      const calls: CapturedCall[] = [];
      return {
        prepare: (sql: string) => ({
          bind: (...args: unknown[]) => {
            calls.push({ sql, binds: args });
            const isHofWrite = sql.includes('INSERT INTO weekly_step_records');
            return {
              all:   async () => ({ results: [], success: true, meta: {} }),
              first: async () => {
                if (sql.includes('FROM leaderboard_snapshots')) return snapshotRow;
                if (sql.includes('FROM users')) return { apple_sub: 'apple_real_user' };
                return null;
              },
              run: async () => {
                if (isHofWrite) {
                  throw new Error('D1_ERROR: no such table: weekly_step_records');
                }
                return { success: true, meta: { changes: 1 } };
              },
            };
          },
        }),
        _calls: () => calls,
      } as unknown as D1Database & { _calls: () => CapturedCall[] };
    }

    it('submit still returns 200 when the HoF INSERT throws', async () => {
      const db  = makeDbWithHofThrow({ current_value: 12000, best_value: 12000 });
      const env = makeEnv(db);
      const res = await handleLeaderboardSubmit(makeReq({ metric: 'step_total', current_value: 12000 }), env, session);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { metric: string; current_value: number; best_value: number };
      expect(body.metric).toBe('step_total');
      expect(body.current_value).toBe(12000);
    });

    it('leaderboard_snapshots upsert still ran when HoF throws (core write not skipped)', async () => {
      const db  = makeDbWithHofThrow({ current_value: 12000, best_value: 12000 });
      const env = makeEnv(db);
      await handleLeaderboardSubmit(makeReq({ metric: 'step_total', current_value: 12000 }), env, session);
      const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
      const snapInsert = calls.find(c => c.sql.includes('INSERT INTO leaderboard_snapshots'));
      expect(snapInsert).toBeDefined();
      // Belt-and-suspenders: the HoF INSERT was also attempted (proves
      // we're not just skipping it).
      const hofInsert = calls.find(c => c.sql.includes('INSERT INTO weekly_step_records'));
      expect(hofInsert).toBeDefined();
    });

    it('100K accolade still awards when HoF throws and value >= 100000', async () => {
      const db  = makeDbWithHofThrow({ current_value: 104821, best_value: 104821 });
      const env = makeEnv(db);
      const res = await handleLeaderboardSubmit(makeReq({ metric: 'step_total', current_value: 104821 }), env, session);
      expect(res.status).toBe(200);
      const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
      const accoladeInsert = calls.find(c => c.sql.includes('INSERT INTO user_accolades'));
      expect(accoladeInsert).toBeDefined();
      expect(accoladeInsert!.binds).toContain('step_100k_club');
      expect(accoladeInsert!.binds).toContain('2026-05-17');
    });

    it('logs a clear warning when the HoF write fails', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const db  = makeDbWithHofThrow({ current_value: 12000, best_value: 12000 });
        const env = makeEnv(db);
        await handleLeaderboardSubmit(makeReq({ metric: 'step_total', current_value: 12000 }), env, session);
        expect(warnSpy).toHaveBeenCalled();
        const msg = warnSpy.mock.calls.map(c => c.join(' ')).join(' ');
        expect(msg).toMatch(/hall-of-fame/i);
        expect(msg).toMatch(/weekly_step_records/);
        expect(msg).toMatch(/user-abc/);
        expect(msg).toMatch(/2026-05-17/);
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('normal HoF write still works when the DB is healthy', async () => {
      // Uses the standard makeDb (no throw). Mirrors the 1z.36 happy-path
      // assertion -- ensures the try/catch wrapper doesn't accidentally
      // suppress successful writes.
      const db  = makeDb({ current_value: 88420, best_value: 88420 });
      const env = makeEnv(db);
      await handleLeaderboardSubmit(makeReq({ metric: 'step_total', current_value: 88420 }), env, session);
      const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
      const hofInsert = calls.find(c => c.sql.includes('INSERT INTO weekly_step_records'));
      expect(hofInsert).toBeDefined();
      expect(hofInsert!.binds[2]).toBe('2026-05-17');
      expect(hofInsert!.binds[3]).toBe(88420);
    });
  });

  it('does NOT write weekly_step_records for sim users (apple_sub LIKE sim_test_%)', async () => {
    // Override the users SELECT to return a sim apple_sub. The default
    // helper returns 'apple_real_user'; this test re-stubs to return a
    // sim_test_ apple_sub so the isSimUser guard short-circuits.
    const calls: CapturedCall[] = [];
    const simDb = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => {
          calls.push({ sql, binds: args });
          return {
            all: async () => ({ results: [], success: true, meta: {} }),
            first: async () => {
              if (sql.includes('FROM users')) return { apple_sub: 'sim_test_alpha' };
              if (sql.includes('FROM leaderboard_snapshots')) return { current_value: 10000, best_value: 10000 };
              return null;
            },
            run: async () => ({ success: true, meta: { changes: 1 } }),
          };
        },
      }),
    } as unknown as D1Database;
    const env = makeEnv(simDb);
    const res = await handleLeaderboardSubmit(makeReq({ metric: 'step_total', current_value: 10000 }), env, session);
    expect(res.status).toBe(200);
    const wsrInsert = calls.find(c => c.sql.includes('INSERT INTO weekly_step_records'));
    expect(wsrInsert).toBeUndefined();
    // Also: 100K branch should not fire even if value >=100000 (this test is
    // at 10000 so it doesn't, but the guard is shared).
    const accoladeInsert = calls.find(c => c.sql.includes('INSERT INTO user_accolades'));
    expect(accoladeInsert).toBeUndefined();
  });
});
