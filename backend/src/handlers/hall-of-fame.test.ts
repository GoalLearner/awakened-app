/**
 * hall-of-fame.test.ts -- Handler-shape tests for the Weekly Steps
 * Hall of Fame read endpoint (v3 Phase 1z.36).
 *
 * Style matches accolades.test.ts: a stub D1 captures SQL + bindings
 * so we can verify the query shape and parameter binding. Real-SQL
 * behavior (sort correctness, JOIN, ordering tiebreak) is covered
 * end-to-end via the existing sim harness once Phase 1z.36 lands in
 * remote D1.
 */
import { describe, expect, it } from 'vitest';
import { handleLeaderboardHallOfFame } from './hall-of-fame';
import type { Env } from '../env';

const okRl = { limit: async () => ({ success: true }) };
const blockRl = { limit: async () => ({ success: false }) };

interface CapturedCall {
  sql: string;
  binds: unknown[];
}

function makeDb(opts: {
  topRows?: Array<{ alias: string; steps: number; week_start: string }>;
  myBest?: { steps: number; week_start: string } | null;
  rank?: number;
} = {}) {
  const calls: CapturedCall[] = [];
  const topRows = opts.topRows ?? [];
  const myBest = opts.myBest === undefined ? null : opts.myBest;
  const rank = opts.rank ?? 1;
  return {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => {
        calls.push({ sql, binds: args });
        return {
          all: async () => ({ results: topRows, success: true, meta: {} }),
          first: async () => {
            if (sql.includes('COUNT(*)')) return { rank };
            if (sql.includes('weekly_step_records')) return myBest;
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
    RL_LEADERBOARD_HOF: rl,
  } as unknown as Env;
}

const session = { userId: 'user-abc', alias: 'TestHunter' };

function makeReq(qs = '?metric=step_total'): Request {
  return new Request('https://example.com/v1/leaderboard/hall-of-fame' + qs);
}

describe('GET /v1/leaderboard/hall-of-fame', () => {
  it('returns top records ordered by steps DESC, tie-broken by week_start ASC', async () => {
    const db = makeDb({
      topRows: [
        { alias: 'Richie',     steps: 104821, week_start: '2026-05-17' },
        { alias: 'Alex',       steps:  98442, week_start: '2026-05-24' },
        { alias: 'Richie',     steps:  92110, week_start: '2026-06-07' },
      ],
      myBest: { steps: 88420, week_start: '2026-05-17' },
      rank: 7,
    });
    const res = await handleLeaderboardHallOfFame(makeReq(), makeEnv(db), session);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      metric: string;
      records: Array<{ rank: number; alias: string; steps: number; week_start: string; week_end: string }>;
      me_best: { rank: number; steps: number; week_start: string; week_end: string } | null;
    };
    expect(body.metric).toBe('step_total');
    expect(body.records).toHaveLength(3);
    expect(body.records[0]).toEqual({
      rank: 1, alias: 'Richie', steps: 104821, week_start: '2026-05-17', week_end: '2026-05-23',
      avatar_id: null,   // W704 — crest field rides the HoF rows
      card_bg: null,     // W706 — member card background rides the HoF rows
      rankTier: null, prestige: 0, founderSeq: 0,   // W713 — tier ring + number, prestige/founder
    });
    expect(body.records[2].alias).toBe('Richie');         // same user, second appearance
    expect(body.records[2].week_start).toBe('2026-06-07'); // different week
  });

  it('uses ORDER BY steps DESC, week_start ASC (older week wins ties)', async () => {
    const db = makeDb({ topRows: [], myBest: null });
    await handleLeaderboardHallOfFame(makeReq(), makeEnv(db), session);
    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    // Top query is now the union CTE — match on the trailing ORDER BY clause.
    const topQuery = calls.find(c => c.sql.includes('FROM merged m'));
    expect(topQuery).toBeDefined();
    expect(topQuery!.sql).toMatch(/ORDER BY[\s\S]*steps\s+DESC[\s\S]*week_start\s+ASC/i);
  });

  // v3 Phase 1z.41 — fallback union from leaderboard_snapshots.
  it('top query unions weekly_step_records with eligible leaderboard_snapshots rows', async () => {
    const db = makeDb({ topRows: [], myBest: null });
    await handleLeaderboardHallOfFame(makeReq(), makeEnv(db), session);
    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    const topQuery = calls.find(c => c.sql.includes('FROM weekly_step_records') && c.sql.includes('UNION ALL'));
    expect(topQuery).toBeDefined();
    // Eligibility filters on the snapshot fallback branch.
    expect(topQuery!.sql).toMatch(/metric\s*=\s*'step_total'/i);
    expect(topQuery!.sql).toMatch(/week_start\s+IS NOT NULL/i);
    expect(topQuery!.sql).toMatch(/apple_sub\s+NOT LIKE\s+'sim_test_%'/i);
    // Dedupe: snapshot rows excluded when wsr already has the (user, week).
    expect(topQuery!.sql).toMatch(/NOT EXISTS[\s\S]+FROM weekly_step_records\s+w[\s\S]+w\.user_id\s*=\s*ls\.user_id[\s\S]+w\.week_start\s*=\s*ls\.week_start/i);
  });

  it('me_best query unions weekly_step_records with caller\'s eligible snapshot rows', async () => {
    const db = makeDb({ topRows: [], myBest: { steps: 3110, week_start: '2026-05-17' } });
    await handleLeaderboardHallOfFame(makeReq(), makeEnv(db), session);
    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    // me_best lookup is the only query with `my_rows AS` CTE.
    const meQuery = calls.find(c => c.sql.includes('my_rows AS'));
    expect(meQuery).toBeDefined();
    expect(meQuery!.sql).toMatch(/UNION ALL/i);
    expect(meQuery!.sql).toMatch(/week_start\s+IS NOT NULL/i);
    // Three binds of session.userId (wsr branch + ls branch + NOT EXISTS subquery).
    expect(meQuery!.binds).toEqual(['user-abc', 'user-abc', 'user-abc']);
  });

  it('rank query counts against the same merged set (wsr + ls fallback)', async () => {
    const db = makeDb({
      topRows: [],
      myBest: { steps: 3110, week_start: '2026-05-17' },
      rank: 2,
    });
    await handleLeaderboardHallOfFame(makeReq(), makeEnv(db), session);
    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    const rankQuery = calls.find(c => c.sql.includes('COUNT(*)'));
    expect(rankQuery).toBeDefined();
    expect(rankQuery!.sql).toMatch(/merged AS/i);
    expect(rankQuery!.sql).toMatch(/UNION ALL/i);
    expect(rankQuery!.sql).toMatch(/WHERE\s+steps\s*>\s*\?/i);
    expect(rankQuery!.binds).toEqual([3110]);
  });

  it('snapshot fallback excludes NULL week_start rows (defended in the WHERE clause)', async () => {
    const db = makeDb({ topRows: [], myBest: null });
    await handleLeaderboardHallOfFame(makeReq(), makeEnv(db), session);
    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    const topQuery = calls.find(c => c.sql.includes('FROM merged m'));
    expect(topQuery!.sql).toMatch(/ls\.week_start\s+IS NOT NULL/i);
  });

  it('snapshot fallback excludes sim users via apple_sub filter', async () => {
    const db = makeDb({ topRows: [], myBest: null });
    await handleLeaderboardHallOfFame(makeReq(), makeEnv(db), session);
    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    const topQuery = calls.find(c => c.sql.includes('FROM merged m'));
    expect(topQuery!.sql).toMatch(/u\.apple_sub\s+NOT LIKE\s+'sim_test_%'/i);
  });

  it('returns me_best when caller has at least one record', async () => {
    const db = makeDb({
      topRows: [{ alias: 'Other', steps: 99000, week_start: '2026-05-17' }],
      myBest: { steps: 88420, week_start: '2026-04-26' },
      rank: 12,
    });
    const res = await handleLeaderboardHallOfFame(makeReq(), makeEnv(db), session);
    const body = (await res.json()) as { me_best: { rank: number; steps: number; week_end: string } | null };
    expect(body.me_best).toEqual({
      rank: 12, steps: 88420, week_start: '2026-04-26', week_end: '2026-05-02',
    });
  });

  it('returns me_best=null when caller has zero records', async () => {
    const db = makeDb({ topRows: [], myBest: null });
    const res = await handleLeaderboardHallOfFame(makeReq(), makeEnv(db), session);
    const body = (await res.json()) as { me_best: unknown };
    expect(body.me_best).toBeNull();
  });

  it('defaults limit to 50 and caps at 100', async () => {
    const db1 = makeDb();
    await handleLeaderboardHallOfFame(makeReq('?metric=step_total'), makeEnv(db1), session);
    const c1 = (db1 as unknown as { _calls(): CapturedCall[] })._calls();
    const top1 = c1.find(c => c.sql.includes('FROM weekly_step_records') && c.sql.includes('LIMIT ?'))!;
    expect(top1.binds).toEqual([50]);

    const db2 = makeDb();
    await handleLeaderboardHallOfFame(makeReq('?metric=step_total&limit=500'), makeEnv(db2), session);
    const c2 = (db2 as unknown as { _calls(): CapturedCall[] })._calls();
    const top2 = c2.find(c => c.sql.includes('FROM weekly_step_records') && c.sql.includes('LIMIT ?'))!;
    expect(top2.binds).toEqual([100]);

    const db3 = makeDb();
    await handleLeaderboardHallOfFame(makeReq('?metric=step_total&limit=10'), makeEnv(db3), session);
    const c3 = (db3 as unknown as { _calls(): CapturedCall[] })._calls();
    const top3 = c3.find(c => c.sql.includes('FROM weekly_step_records') && c.sql.includes('LIMIT ?'))!;
    expect(top3.binds).toEqual([10]);
  });

  it('rejects sleep_streak / bedtime_streak with 400 INVALID_METRIC (v1: step_total only)', async () => {
    const r1 = await handleLeaderboardHallOfFame(makeReq('?metric=sleep_streak'), makeEnv(makeDb()), session);
    expect(r1.status).toBe(400);
    const b1 = (await r1.json()) as { error: string };
    expect(b1.error).toBe('INVALID_METRIC');

    const r2 = await handleLeaderboardHallOfFame(makeReq('?metric=bedtime_streak'), makeEnv(makeDb()), session);
    expect(r2.status).toBe(400);

    const r3 = await handleLeaderboardHallOfFame(makeReq('?metric=bogus'), makeEnv(makeDb()), session);
    expect(r3.status).toBe(400);
  });

  it('rejects missing metric param with 400', async () => {
    const res = await handleLeaderboardHallOfFame(makeReq(''), makeEnv(makeDb()), session);
    expect(res.status).toBe(400);
  });

  it('returns 429 when the rate limiter blocks', async () => {
    const res = await handleLeaderboardHallOfFame(makeReq(), makeEnv(makeDb(), blockRl), session);
    expect(res.status).toBe(429);
  });

  it('JOINs users so alias edits flow through (no denormalized alias column)', async () => {
    const db = makeDb({ topRows: [{ alias: 'Richie', steps: 104821, week_start: '2026-05-17' }], myBest: null });
    await handleLeaderboardHallOfFame(makeReq(), makeEnv(db), session);
    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    const topQuery = calls.find(c => c.sql.includes('FROM weekly_step_records'));
    expect(topQuery!.sql).toMatch(/JOIN\s+users/i);
    expect(topQuery!.sql).toMatch(/u\.alias\s+AS\s+alias/i);
  });

  it('me_best rank query counts strictly higher records (consistent with rank computation in records[])', async () => {
    const db = makeDb({
      topRows: [],
      myBest: { steps: 88420, week_start: '2026-04-26' },
      rank: 12,
    });
    await handleLeaderboardHallOfFame(makeReq(), makeEnv(db), session);
    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    const rankQuery = calls.find(c => c.sql.includes('COUNT(*)'));
    expect(rankQuery).toBeDefined();
    expect(rankQuery!.sql).toMatch(/WHERE\s+steps\s*>\s*\?/i);
    expect(rankQuery!.binds).toEqual([88420]);
  });

  it('week_end is computed as week_start + 6 days (UTC)', async () => {
    const db = makeDb({
      topRows: [
        { alias: 'A', steps: 100, week_start: '2026-05-17' },        // May 17 (Sun) -> May 23
        { alias: 'B', steps:  90, week_start: '2026-05-31' },        // May 31 (Sun) -> Jun 6 (month rollover)
        { alias: 'C', steps:  80, week_start: '2025-12-28' },        // Dec 28 -> Jan 3 (year rollover)
      ],
      myBest: null,
    });
    const res = await handleLeaderboardHallOfFame(makeReq(), makeEnv(db), session);
    const body = (await res.json()) as { records: Array<{ week_end: string }> };
    expect(body.records[0].week_end).toBe('2026-05-23');
    expect(body.records[1].week_end).toBe('2026-06-06');
    expect(body.records[2].week_end).toBe('2026-01-03');
  });
});
