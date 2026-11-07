/**
 * leaderboard-top.test.ts -- Handler-shape tests for the weekly
 * scoping change (v3 Phase 1z.33).
 *
 * Verifies that GET /v1/leaderboard/top filters weekly metrics by the
 * current Sunday-UTC week and leaves non-weekly metrics on the legacy
 * unfiltered path. SQL-behavior validation (real index scans, sort
 * correctness, etc.) is covered end-to-end by sims/scripts/*.ps1.
 */
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { handleLeaderboardTop } from './leaderboard-top';
import { isFinalStandingsHold } from '../lib/accolade-week';
import type { Env } from '../env';

const okRl = { limit: async () => ({ success: true }) };

interface CapturedCall {
  sql: string;
  binds: unknown[];
}

function makeDb(opts: {
  // W453/W656/W704 — rows may carry the optional passthrough columns the live
  // SELECT projects (prestige/rank_tier/founder_seq/avatar_id); absent = null-ish.
  topRows?: Array<{ alias: string; current_value: number; prestige?: number; rank_tier?: string; founder_seq?: number; avatar_id?: string }>;
  myRow?: { current_value: number } | null;
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
          all:   async () => ({ results: topRows, success: true, meta: {} }),
          first: async () => {
            if (sql.includes('COUNT(*)')) return { rank };
            if (sql.includes('FROM leaderboard_snapshots')) return myRow;
            return null;
          },
          run:   async () => ({ success: true, meta: { changes: 0 } }),
        };
      },
    }),
    _calls: () => calls,
  } as unknown as D1Database & { _calls: () => CapturedCall[] };
}

function makeEnv(db: D1Database): Env {
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
  } as unknown as Env;
}

const session = { userId: 'user-abc', alias: 'TestHunter' };

describe('GET /v1/leaderboard/top -- the Sunday-morning final standings (W1120)', () => {
  function holdDb(rows: Array<{ alias: string; current_value: number }>, me: { steps: number | null; above: number | null }) {
    const calls: CapturedCall[] = [];
    return {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => {
          calls.push({ sql, binds: args });
          return {
            all:   async () => ({ results: sql.includes('FROM merged m') ? rows : [], success: true, meta: {} }),
            first: async () => (sql.includes('FROM merged') ? me : null),
          };
        },
      }),
      _calls: () => calls,
    } as unknown as D1Database & { _calls: () => CapturedCall[] };
  }
  const top = (metric = 'step_total') => new Request('https://example.com/v1/leaderboard/top?metric=' + metric);

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('rests on last week off the durable merge, with the caller placed on it', async () => {
    vi.setSystemTime(new Date('2026-11-01T07:01:00Z'));   // Sunday 12:01 AM PDT
    const db = holdDb([{ alias: 'Alpha', current_value: 70000 }, { alias: 'Beta', current_value: 31684 }], { steps: 31684, above: 1 });
    const res = await handleLeaderboardTop(top(), makeEnv(db), session as never);
    const body = await res.json() as { final: boolean; week: string; top: Array<{ rank: number; alias: string; current_value: number }>; me: unknown };
    expect(body.final).toBe(true);
    expect(body.week).toBe('2026-10-25');
    expect(body.top.map((r) => [r.rank, r.alias, r.current_value])).toEqual([[1, 'Alpha', 70000], [2, 'Beta', 31684]]);
    expect(body.me).toEqual({ rank: 2, current_value: 31684 });
    expect(db._calls()[0].binds[0]).toBe('2026-10-25');
    expect(db._calls()[0].sql).toContain('weekly_step_records');
  });

  it('a hunter who was not on last week has no row, not a rank', async () => {
    vi.setSystemTime(new Date('2026-11-01T15:00:00Z'));
    const db = holdDb([{ alias: 'Alpha', current_value: 70000 }], { steps: null, above: 0 });
    const res = await handleLeaderboardTop(top(), makeEnv(db), session as never);
    expect((await res.json() as { me: unknown }).me).toBeNull();
  });

  it('an empty finished week falls through to the live board', async () => {
    vi.setSystemTime(new Date('2026-11-01T15:00:00Z'));
    const db = holdDb([], { steps: null, above: 0 });
    const res = await handleLeaderboardTop(top(), makeEnv(db), session as never);
    expect((await res.json() as { final?: boolean }).final).toBeUndefined();
  });

  it('at 12:00 PM Pacific the live week is back', async () => {
    vi.setSystemTime(new Date('2026-11-01T20:00:00Z'));   // Sunday 12:00 PM PST
    const db = makeDb({ topRows: [{ alias: 'Alpha', current_value: 900 }] });
    const res = await handleLeaderboardTop(top(), makeEnv(db), session as never);
    expect((await res.json() as { final?: boolean }).final).toBeUndefined();
    expect((db as unknown as { _calls: () => CapturedCall[] })._calls()[0].binds).toContain('2026-11-01');
  });

  it('only the Steps board rests', async () => {
    vi.setSystemTime(new Date('2026-11-01T15:00:00Z'));
    const db = makeDb({ topRows: [{ alias: 'Alpha', current_value: 90 }] });
    const res = await handleLeaderboardTop(top('floor_best'), makeEnv(db), session as never);
    expect((await res.json() as { final?: boolean }).final).toBeUndefined();
  });

  it.each([
    ['2026-11-01T06:59:59Z', false],   // Saturday 11:59 PM PDT
    ['2026-11-01T07:00:00Z', true],    // Sunday 12:00 AM PDT
    ['2026-11-01T19:59:59Z', true],    // Sunday 11:59 AM PST, the clocks fell back in between
    ['2026-11-01T20:00:00Z', false],   // Sunday 12:00 PM PST
    ['2026-05-17T18:59:59Z', true],    // Sunday 11:59 AM PDT
    ['2026-05-17T19:00:00Z', false],   // Sunday 12:00 PM PDT
    ['2026-11-02T15:00:00Z', false],   // Monday morning
  ])('the hold at %s is %s', (at, want) => {
    expect(isFinalStandingsHold(Date.parse(at))).toBe(want);
  });
});

describe('GET /v1/leaderboard/top -- weekly scoping (1z.33)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 2026-05-17 (Sunday) 1 PM PDT, past the W1120 hold -- week key '2026-05-17'
    vi.setSystemTime(new Date(Date.UTC(2026, 4, 17, 20, 0, 0)));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('filters step_total top-N by current Sunday-UTC week_start', async () => {
    const db = makeDb({
      topRows: [{ alias: 'Alpha', current_value: 35000 }],
      myRow: { current_value: 12000 },
      rank: 7,
    });
    const env = makeEnv(db);
    const res = await handleLeaderboardTop(
      new Request('https://example.com/v1/leaderboard/top?metric=step_total&limit=100'),
      env, session,
    );
    expect(res.status).toBe(200);

    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    const topQuery = calls.find(c => c.sql.includes('FROM leaderboard_snapshots ls') && c.sql.includes('ORDER BY'));
    expect(topQuery).toBeDefined();
    expect(topQuery!.sql).toMatch(/week_start\s*=\s*\?/i);
    // metric, week_start, limit
    expect(topQuery!.binds).toEqual(['step_total', '2026-05-17', 100]);
  });

  it('filters step_total user-rank query by current week_start', async () => {
    const db = makeDb({
      topRows: [],
      myRow: { current_value: 5000 },
      rank: 3,
    });
    const env = makeEnv(db);
    await handleLeaderboardTop(
      new Request('https://example.com/v1/leaderboard/top?metric=step_total'),
      env, session,
    );
    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    const rankQuery = calls.find(c => c.sql.includes('COUNT(*)'));
    expect(rankQuery).toBeDefined();
    expect(rankQuery!.sql).toMatch(/week_start\s*=\s*\?/i);
    expect(rankQuery!.binds).toEqual(['step_total', '2026-05-17', 5000]);
  });

  it('me-row lookup for step_total is scoped to the current week (stale prior-week rows return me=null)', async () => {
    const db = makeDb({ topRows: [], myRow: null });
    const env = makeEnv(db);
    const res = await handleLeaderboardTop(
      new Request('https://example.com/v1/leaderboard/top?metric=step_total'),
      env, session,
    );
    const body = (await res.json()) as { me: unknown };
    expect(body.me).toBeNull();
    // The me lookup must include week_start in WHERE.
    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    const meQuery = calls.find(c =>
      c.sql.includes('FROM leaderboard_snapshots') &&
      c.sql.includes('user_id') &&
      !c.sql.includes('COUNT(*)'),
    );
    expect(meQuery).toBeDefined();
    expect(meQuery!.sql).toMatch(/week_start\s*=\s*\?/i);
  });

  it('does NOT add week_start filter for sleep_streak (non-weekly metric)', async () => {
    const db = makeDb({
      topRows: [{ alias: 'Beta', current_value: 30 }],
      myRow: { current_value: 4 },
      rank: 12,
    });
    const env = makeEnv(db);
    await handleLeaderboardTop(
      new Request('https://example.com/v1/leaderboard/top?metric=sleep_streak'),
      env, session,
    );
    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    const topQuery = calls.find(c => c.sql.includes('FROM leaderboard_snapshots ls'));
    expect(topQuery).toBeDefined();
    expect(topQuery!.sql).not.toMatch(/week_start/i);
    expect(topQuery!.binds).toEqual(['sleep_streak', 100]);
  });

  it('does NOT add week_start filter for bedtime_streak', async () => {
    const db = makeDb();
    const env = makeEnv(db);
    await handleLeaderboardTop(
      new Request('https://example.com/v1/leaderboard/top?metric=bedtime_streak'),
      env, session,
    );
    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    const topQuery = calls.find(c => c.sql.includes('FROM leaderboard_snapshots ls'));
    expect(topQuery!.sql).not.toMatch(/week_start/i);
  });

  it('returns step_total top + me correctly when current-week data exists', async () => {
    const db = makeDb({
      topRows: [
        { alias: 'rendiesel',      current_value: 35369, prestige: 5, rank_tier: 'S+' },
        { alias: 'immortalshadow', current_value: 27112 },
      ],
      myRow: { current_value: 1776 },
      rank: 12,
    });
    const env = makeEnv(db);
    const res = await handleLeaderboardTop(
      new Request('https://example.com/v1/leaderboard/top?metric=step_total'),
      env, session,
    );
    const body = (await res.json()) as { metric: string; top: Array<{ rank: number; alias: string; current_value: number }>; me: { rank: number; current_value: number } | null };
    expect(body.metric).toBe('step_total');
    expect(body.top).toHaveLength(2);
    expect(body.top[0]).toEqual({ rank: 1, alias: 'rendiesel', current_value: 35369, arena_title: null, bosses_slain: null, prestige: 5, rankTier: 'S+', founderSeq: null, avatar_id: null, card_bg: null, card_ink: null, hall_ordinal: null });   // W453 prestige + W656 founderSeq + W704 avatar_id + W706 card_bg + W844 hall_ordinal + W1146 card_ink flow through
    expect(body.me).toEqual({ rank: 12, current_value: 1776 });
  });
});
