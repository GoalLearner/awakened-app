/**
 * step-100k-club.test.ts -- Handler-shape tests for the 100K Step
 * Club roster endpoint (v3 Phase 1z.52).
 *
 * Style matches accolades.test.ts and hall-of-fame.test.ts: a stub
 * D1 captures SQL + bindings so we can verify query shape and
 * parameter binding. Real-SQL behavior (sort correctness across
 * three-tier tiebreaker, NOT LIKE filter at scale) is covered
 * end-to-end via the existing sim harness once the endpoint lands
 * in remote D1.
 */
import { describe, expect, it } from 'vitest';
import { handleStep100kClub } from './step-100k-club';
import type { Env } from '../env';

const okRl = { limit: async () => ({ success: true }) };
const blockRl = { limit: async () => ({ success: false }) };

interface CapturedCall {
  sql: string;
  binds: unknown[];
}

function makeDb(opts: {
  topRows?: Array<{
    alias: string;
    best_value: number;
    unlock_week_start: string;
    repeat_count: number;
    last_qualified_week_start: string;
    unlocked_at: number;
  }>;
  myRow?: { best_value: number; unlock_week_start: string; repeat_count: number } | null;
  rank?: number;
} = {}) {
  const calls: CapturedCall[] = [];
  const topRows = opts.topRows ?? [];
  const myRow = opts.myRow === undefined ? null : opts.myRow;
  const rank = opts.rank ?? 1;
  return {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => {
        calls.push({ sql, binds: args });
        return {
          all: async () => ({ results: topRows, success: true, meta: {} }),
          first: async () => {
            if (sql.includes('COUNT(*)')) return { rank };
            if (sql.includes('user_accolades')) return myRow;
            return null;
          },
          run: async () => ({ success: true, meta: { changes: 0 } }),
        };
      },
    }),
    _calls: () => calls,
  } as unknown as D1Database & { _calls: () => CapturedCall[] };
}

function makeEnv(db: D1Database, rl: typeof okRl = okRl): Env {
  return {
    DB: db,
    JWT_SIGNING_KEY: 'unused',
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
    RL_DUELS_WRITE: okRl,
    RL_USER_ACCOLADES_READ: okRl,
    RL_LEADERBOARD_HOF: okRl,
    RL_LEADERBOARD_STEP_100K_CLUB: rl,
  } as unknown as Env;
}

const session = { userId: 'user-abc', alias: 'TestHunter' };

function makeReq(qs = ''): Request {
  return new Request('https://example.com/v1/leaderboard/step-100k-club' + qs);
}

describe('GET /v1/leaderboard/step-100k-club', () => {
  it('returns only step_100k_club accolades (filters by accolade_type)', async () => {
    const db = makeDb({ topRows: [], myRow: null });
    await handleStep100kClub(makeReq(), makeEnv(db), session);
    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    const topQ = calls.find(c => c.sql.includes('FROM user_accolades') && c.sql.includes('ORDER BY'));
    expect(topQ).toBeDefined();
    expect(topQ!.sql).toMatch(/accolade_type\s*=\s*\?/i);
    expect(topQ!.binds[0]).toBe('step_100k_club');
  });

  it('excludes sim users via apple_sub NOT LIKE filter', async () => {
    const db = makeDb({ topRows: [], myRow: null });
    await handleStep100kClub(makeReq(), makeEnv(db), session);
    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    const topQ = calls.find(c => c.sql.includes('FROM user_accolades') && c.sql.includes('ORDER BY'));
    expect(topQ!.sql).toMatch(/u\.apple_sub\s+NOT LIKE\s+'sim_test_%'/i);
  });

  it('sorts by best_value DESC, repeat_count DESC, unlocked_at ASC', async () => {
    const db = makeDb({ topRows: [], myRow: null });
    await handleStep100kClub(makeReq(), makeEnv(db), session);
    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    const topQ = calls.find(c => c.sql.includes('FROM user_accolades') && c.sql.includes('ORDER BY'));
    expect(topQ!.sql).toMatch(/ORDER BY[\s\S]*best_value\s+DESC[\s\S]*repeat_count\s+DESC[\s\S]*unlocked_at\s+ASC/i);
  });

  it('returns members with rank, alias, best_value, week range, repeat_count', async () => {
    const db = makeDb({
      topRows: [
        { alias: 'Richie',  best_value: 104821, unlock_week_start: '2026-05-17', repeat_count: 2, last_qualified_week_start: '2026-05-17', unlocked_at: 1760000000000 },
        { alias: 'Alex',    best_value: 100500, unlock_week_start: '2026-05-24', repeat_count: 1, last_qualified_week_start: '2026-05-24', unlocked_at: 1761000000000 },
      ],
      myRow: null,
    });
    const res = await handleStep100kClub(makeReq(), makeEnv(db), session);
    const body = (await res.json()) as {
      type: string;
      members: Array<{ rank: number; alias: string; best_value: number; unlock_week_start: string; unlock_week_end: string; repeat_count: number }>;
      me: unknown;
    };
    expect(body.type).toBe('step_100k_club');
    expect(body.members).toHaveLength(2);
    expect(body.members[0]).toMatchObject({
      rank: 1, alias: 'Richie', best_value: 104821,
      unlock_week_start: '2026-05-17', unlock_week_end: '2026-05-23',
      repeat_count: 2,
    });
    expect(body.members[1]).toMatchObject({
      rank: 2, alias: 'Alex', best_value: 100500,
      unlock_week_start: '2026-05-24', unlock_week_end: '2026-05-30',
      repeat_count: 1,
    });
    expect(body.me).toBeNull();
  });

  it('returns me rank when caller is a member', async () => {
    const db = makeDb({
      topRows: [],
      myRow: { best_value: 104821, unlock_week_start: '2026-05-17', repeat_count: 2 },
      rank: 1,
    });
    const res = await handleStep100kClub(makeReq(), makeEnv(db), session);
    const body = (await res.json()) as { me: { rank: number; best_value: number; unlock_week_start: string; unlock_week_end: string; repeat_count: number } | null };
    expect(body.me).toEqual({
      rank: 1,
      best_value: 104821,
      unlock_week_start: '2026-05-17',
      unlock_week_end:   '2026-05-23',
      repeat_count: 2,
    });
  });

  it('returns me=null when caller is not a member', async () => {
    const db = makeDb({ topRows: [], myRow: null });
    const res = await handleStep100kClub(makeReq(), makeEnv(db), session);
    const body = (await res.json()) as { me: unknown };
    expect(body.me).toBeNull();
  });

  it('me-rank query counts strictly higher best_values (stable-tie convention)', async () => {
    const db = makeDb({
      topRows: [],
      myRow: { best_value: 100500, unlock_week_start: '2026-05-24', repeat_count: 1 },
      rank: 2,
    });
    await handleStep100kClub(makeReq(), makeEnv(db), session);
    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    const rankQ = calls.find(c => c.sql.includes('COUNT(*)'));
    expect(rankQ).toBeDefined();
    expect(rankQ!.sql).toMatch(/WHERE[\s\S]+ua\.best_value\s*>\s*\?/i);
    // accolade_type + best_value binds (the apple_sub filter is a literal)
    expect(rankQ!.binds).toEqual(['step_100k_club', 100500]);
  });

  it('defaults limit to 50 and caps at 100', async () => {
    const db1 = makeDb();
    await handleStep100kClub(makeReq(''), makeEnv(db1), session);
    const top1 = (db1 as unknown as { _calls(): CapturedCall[] })._calls().find(c => c.sql.includes('LIMIT ?'))!;
    expect(top1.binds[1]).toBe(50);

    const db2 = makeDb();
    await handleStep100kClub(makeReq('?limit=999'), makeEnv(db2), session);
    const top2 = (db2 as unknown as { _calls(): CapturedCall[] })._calls().find(c => c.sql.includes('LIMIT ?'))!;
    expect(top2.binds[1]).toBe(100);

    const db3 = makeDb();
    await handleStep100kClub(makeReq('?limit=20'), makeEnv(db3), session);
    const top3 = (db3 as unknown as { _calls(): CapturedCall[] })._calls().find(c => c.sql.includes('LIMIT ?'))!;
    expect(top3.binds[1]).toBe(20);
  });

  it('returns 429 when the rate limiter blocks', async () => {
    const res = await handleStep100kClub(makeReq(), makeEnv(makeDb(), blockRl), session);
    expect(res.status).toBe(429);
  });

  it('JOINs users for live alias (no denormalized alias column)', async () => {
    const db = makeDb({
      topRows: [{ alias: 'Richie', best_value: 104821, unlock_week_start: '2026-05-17', repeat_count: 1, last_qualified_week_start: '2026-05-17', unlocked_at: 1760000000000 }],
      myRow: null,
    });
    await handleStep100kClub(makeReq(), makeEnv(db), session);
    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    const topQ = calls.find(c => c.sql.includes('FROM user_accolades') && c.sql.includes('ORDER BY'));
    expect(topQ!.sql).toMatch(/JOIN\s+users\s+u\s+ON\s+u\.id\s*=\s*ua\.user_id/i);
    expect(topQ!.sql).toMatch(/u\.alias\s+AS\s+alias/i);
  });

  it('week_end is computed as week_start + 6 days (UTC, month + year rollover safe)', async () => {
    const db = makeDb({
      topRows: [
        { alias: 'A', best_value: 200000, unlock_week_start: '2026-05-31', repeat_count: 1, last_qualified_week_start: '2026-05-31', unlocked_at: 1 },  // month rollover -> Jun 6
        { alias: 'B', best_value: 100000, unlock_week_start: '2025-12-28', repeat_count: 1, last_qualified_week_start: '2025-12-28', unlocked_at: 2 },  // year rollover -> Jan 3
      ],
      myRow: null,
    });
    const res = await handleStep100kClub(makeReq(), makeEnv(db), session);
    const body = (await res.json()) as { members: Array<{ unlock_week_end: string }> };
    expect(body.members[0].unlock_week_end).toBe('2026-06-06');
    expect(body.members[1].unlock_week_end).toBe('2026-01-03');
  });
});
