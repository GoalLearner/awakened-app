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
});
