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

  // ── v3 Phase 1z.140 — trusted-source self-heal CASE ─────────────
  // Bug repro: Sunday-rollover device-local/UTC mismatch (pre-w18)
  // submitted last week's step total under the new Sunday-UTC
  // week_start. 1z.131 monotonic MAX then protected the contaminated
  // value all week. Fix: trusted w19+ clients send weekly_sum_source
  // = 'client_sunday_utc_v2'; the FIRST trusted submit for a
  // (user, metric) row whose stored source is NULL overrides MAX
  // and accepts the trusted lower value, then subsequent submits
  // revert to MAX (the trust marker is sticky).
  it('SQL contains the 1z.140 trusted-source self-heal CASE branch before the MAX branch', async () => {
    const db = makeDb({ current_value: 80886, best_value: 82939 });
    const env = makeEnv(db);
    await handleLeaderboardSubmit(
      makeReq({ metric: 'step_total', current_value: 7308, weekly_sum_source: 'client_sunday_utc_v2' }),
      env, session,
    );
    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    const insert = calls.find(c => c.sql.includes('INSERT INTO leaderboard_snapshots'))!;
    // Insert column list must include weekly_sum_source (1z.140 column).
    expect(insert.sql).toMatch(/INSERT INTO leaderboard_snapshots[\s\S]+weekly_sum_source/i);
    // Trusted self-heal branch: excluded.weekly_sum_source IS NOT NULL
    // AND existing.weekly_sum_source IS NULL AND same week → trust new.
    expect(insert.sql).toMatch(/excluded\.weekly_sum_source\s+IS\s+NOT\s+NULL/i);
    expect(insert.sql).toMatch(/leaderboard_snapshots\.weekly_sum_source\s+IS\s+NULL/i);
    // Self-heal branch must precede MAX branch so it fires first.
    const heal = insert.sql.search(/leaderboard_snapshots\.weekly_sum_source\s+IS\s+NULL/i);
    const max  = insert.sql.search(/MAX\(leaderboard_snapshots\.current_value/i);
    expect(heal).toBeGreaterThan(-1);
    expect(max).toBeGreaterThan(heal);
    // Trust marker persisted via COALESCE so NULL submits cannot wipe it.
    expect(insert.sql).toMatch(/weekly_sum_source\s*=\s*COALESCE\(excluded\.weekly_sum_source,\s*leaderboard_snapshots\.weekly_sum_source\)/i);
    // 7th bind arg = weekly_sum_source value.
    expect(insert.binds[6]).toBe('client_sunday_utc_v2');
  });

  it('unrecognised weekly_sum_source values are persisted as NULL (untrusted)', async () => {
    const db = makeDb({ current_value: 5000, best_value: 35000 });
    const env = makeEnv(db);
    await handleLeaderboardSubmit(
      makeReq({ metric: 'step_total', current_value: 5000, weekly_sum_source: 'totally_made_up_tag' }),
      env, session,
    );
    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    const insert = calls.find(c => c.sql.includes('INSERT INTO leaderboard_snapshots'))!;
    expect(insert.binds[6]).toBe(null);
  });

  it('missing weekly_sum_source persists NULL (back-compat for pre-w19 clients)', async () => {
    const db = makeDb({ current_value: 5000, best_value: 35000 });
    const env = makeEnv(db);
    await handleLeaderboardSubmit(makeReq({ metric: 'step_total', current_value: 5000 }), env, session);
    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    const insert = calls.find(c => c.sql.includes('INSERT INTO leaderboard_snapshots'))!;
    expect(insert.binds[6]).toBe(null);
  });

  // v3 Phase 1z.216 — cross-week untrusted submit guard. Reproduces
  // the May 30 contamination: an untrusted client at the UTC weekly
  // rollover boundary submits its (device-local-computed) cumulative
  // step total; server stamps the new week_start; without this guard
  // the ELSE branch wrote last week's total under the new period_key.
  // The new SQL CASE forces current_value=0 when (a) the submit
  // carries no trusted source tag AND (b) the new submit's week_start
  // differs from the existing row's week_start. Honest cross-week
  // re-entry by trusted clients still ratchets up via the self-heal
  // branch; same-week behavior unchanged.
  it('untrusted cross-week submit zeroes current_value (1z.216 guard)', async () => {
    const db = makeDb({ current_value: 78684, best_value: 82939 });
    const env = makeEnv(db);
    await handleLeaderboardSubmit(
      makeReq({ metric: 'step_total', current_value: 5000 }),
      env, session,
    );
    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    const insert = calls.find(c => c.sql.includes('INSERT INTO leaderboard_snapshots'))!;
    // SQL must contain the guard WHEN clause that returns 0 for an
    // untrusted cross-week submit.
    expect(insert.sql).toMatch(/excluded\.weekly_sum_source\s+IS\s+NULL/i);
    expect(insert.sql).toMatch(/excluded\.week_start\s*<>\s*leaderboard_snapshots\.week_start/i);
    // The guard branch's THEN clause is literally `0` (not MAX/value).
    // Pin its presence by searching for a `THEN 0` in the SQL body
    // that follows the cross-week WHEN block.
    const guardIdx = insert.sql.search(/excluded\.week_start\s*<>\s*leaderboard_snapshots\.week_start/i);
    expect(guardIdx).toBeGreaterThan(-1);
    const guardTail = insert.sql.slice(guardIdx);
    expect(guardTail).toMatch(/THEN\s+0/i);
  });

  it('trusted cross-week submit is NOT zeroed by the 1z.216 guard', async () => {
    // The guard's WHEN clause requires excluded.weekly_sum_source
    // IS NULL. A submit carrying the trusted v2 tag must bypass the
    // guard so honest cross-week values write normally — the next
    // same-week submit then uses the existing MAX branch.
    const db = makeDb({ current_value: 78684, best_value: 82939 });
    const env = makeEnv(db);
    await handleLeaderboardSubmit(
      makeReq({ metric: 'step_total', current_value: 5000, weekly_sum_source: 'client_sunday_utc_v2' }),
      env, session,
    );
    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    const insert = calls.find(c => c.sql.includes('INSERT INTO leaderboard_snapshots'))!;
    // Sanity: the trusted-tag bind is in position 7.
    expect(insert.binds[6]).toBe('client_sunday_utc_v2');
    // The guard's NULL check makes a trusted submit ineligible for
    // the zero branch. (Verified structurally — SQL still contains
    // the IS NULL clause but the runtime never hits it.) The
    // self-heal branch above the guard is what fires for trusted
    // submits with NULL-stored existing source.
    expect(insert.sql).toMatch(/excluded\.weekly_sum_source\s+IS\s+NOT\s+NULL\s+AND\s+leaderboard_snapshots\.weekly_sum_source\s+IS\s+NULL/i);
  });

  it('CASE ordering: cross-week guard sits AFTER same-week MAX and BEFORE the ELSE', async () => {
    // Branch precedence matters. The guard must fire only when
    // (a) source is null AND (b) weeks differ. Same-week MAX must
    // still win when weeks match, even for untrusted clients. ELSE
    // remains the catch-all for NULL-week / non-weekly metrics.
    const db = makeDb({ current_value: 1000, best_value: 1000 });
    const env = makeEnv(db);
    await handleLeaderboardSubmit(
      makeReq({ metric: 'step_total', current_value: 1500 }),
      env, session,
    );
    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    const insert = calls.find(c => c.sql.includes('INSERT INTO leaderboard_snapshots'))!;
    const sql = insert.sql;
    const sameWeekMax = sql.search(/MAX\(leaderboard_snapshots\.current_value/);
    const guardWhen  = sql.search(/excluded\.week_start\s*<>\s*leaderboard_snapshots\.week_start/i);
    const elseToken  = sql.search(/ELSE\s+excluded\.current_value/i);
    expect(sameWeekMax).toBeGreaterThan(-1);
    expect(guardWhen).toBeGreaterThan(-1);
    expect(elseToken).toBeGreaterThan(-1);
    expect(sameWeekMax).toBeLessThan(guardWhen);
    expect(guardWhen).toBeLessThan(elseToken);
  });

  it('weekly_step_records also has the 1z.140 self-heal CASE branch', async () => {
    const db = makeDb({ current_value: 80886, best_value: 82939 });
    const env = makeEnv(db);
    await handleLeaderboardSubmit(
      makeReq({ metric: 'step_total', current_value: 7308, weekly_sum_source: 'client_sunday_utc_v2' }),
      env, session,
    );
    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    const wsrInsert = calls.find(c => c.sql.includes('INSERT INTO weekly_step_records'));
    expect(wsrInsert).toBeDefined();
    // Hall of Fame insert now writes 7 cols (incl. weekly_sum_source).
    expect(wsrInsert!.sql).toMatch(/INSERT INTO weekly_step_records[\s\S]+weekly_sum_source/i);
    expect(wsrInsert!.sql).toMatch(/excluded\.weekly_sum_source\s+IS\s+NOT\s+NULL/i);
    expect(wsrInsert!.sql).toMatch(/weekly_step_records\.weekly_sum_source\s+IS\s+NULL/i);
    // Trust marker persisted via COALESCE.
    expect(wsrInsert!.sql).toMatch(/weekly_sum_source\s*=\s*COALESCE\(excluded\.weekly_sum_source,\s*weekly_step_records\.weekly_sum_source\)/i);
    // Trust tag is the 7th bind arg on this insert too.
    expect(wsrInsert!.binds[6]).toBe('client_sunday_utc_v2');
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
    // ON CONFLICT clause must use MAX(weekly_step_records.steps, excluded.steps).
    // 1z.140 added a trusted-source self-heal CASE around this so the MAX
    // lives in the ELSE branch — same monotonic protection for untrusted /
    // legacy submits, which is the path this test exercises (no
    // weekly_sum_source on the submit body → treated as untrusted).
    expect(wsrInsert!.sql).toMatch(/ELSE\s+MAX\(weekly_step_records\.steps,\s*excluded\.steps\)/i);
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
