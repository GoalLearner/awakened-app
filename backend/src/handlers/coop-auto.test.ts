/**
 * coop-auto.test.ts — W1094 automatic friend hunts.
 *
 * The pure pieces (the boss pick, the daily pattern, the build gate), the creation sweep
 * (which pairs get a hunt, which are skipped, one row per pair per day), and the settle sweep
 * through the shared resolveCoopInstance (win → awards + ONE push a day for automatic hunts,
 * automatic defeat silent, manual defeat pushed as before). Same substring-routed D1 mock as
 * the other handler tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../lib/apns', () => ({ notifyUser: vi.fn(async () => {}) }));
import { notifyUser } from '../lib/apns';
import {
  AUTO_HUNT_MIN_W,
  buildW,
  createAutoHunt,
  dailyPattern,
  elapsedDaysPt,
  handleCoopAutoOptOut,
  pairKey,
  pickAutoBoss,
  sweepCoopAutoHunts,
  sweepCoopResolve,
} from './coop-auto';
import { getAccoladeWeekStart, priorWeekStart } from '../lib/accolade-week';
import { ptDayKey, ptMidnightIso, nextDay } from '../lib/pact-streak';
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';

const mockNotify = vi.mocked(notifyUser);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('pickAutoBoss — the strongest boss both ranks allow whose printed goal fits 0.9 × pattern', () => {
  it('a C pair walking 20,000 a day faces The Coursing Dread at its real goal', () => {
    expect(pickAutoBoss('C', 'B', 20000)).toEqual({ bossId: 'the_coursing_dread', goalSteps: 18000 });
  });
  it('the boundary: 18,000 fits at exactly 20,000; a step less drops to the Twin Maw at 14,000', () => {
    expect(pickAutoBoss('C', 'C', 20000).bossId).toBe('the_coursing_dread');
    expect(pickAutoBoss('C', 'C', 19999)).toEqual({ bossId: 'the_twin_maw', goalSteps: 14000 });
  });
  it('an E hunter caps the pair at the Twin Maw however far they walk', () => {
    expect(pickAutoBoss('E', 'S', 40000)).toEqual({ bossId: 'the_twin_maw', goalSteps: 14000 });
  });
  it('a pair under the Twin Maw gets it sized to them: 0.9 × pattern to the nearest 100, floor 2,000', () => {
    expect(pickAutoBoss('E', 'E', 10000)).toEqual({ bossId: 'the_twin_maw', goalSteps: 9000 });
    expect(pickAutoBoss('E', 'E', 15555)).toEqual({ bossId: 'the_twin_maw', goalSteps: 14000 });   // 13,999.5 → sized 14,000; the real goal is 14,000 and does not fit
    expect(pickAutoBoss('E', 'E', 15556).goalSteps).toBe(14000);                                   // 14,000.4 fits the real boss
    expect(pickAutoBoss('E', 'E', 1000)).toEqual({ bossId: 'the_twin_maw', goalSteps: 2000 });
    expect(pickAutoBoss('E', 'E', 0).goalSteps).toBe(2000);
  });
});

describe('dailyPattern / elapsedDaysPt / buildW', () => {
  it('averages last week and this week over the days that have passed', () => {
    expect(dailyPattern(70000, 30000, 3)).toBe(10000);
    expect(dailyPattern(0, 7000, 7)).toBe(500);
    expect(dailyPattern(0, 0, 3)).toBeNull();
    expect(dailyPattern(-5, 0, 3)).toBeNull();
  });
  it('elapsed days are 1 on the week start and 7 on its last day (date-only math)', () => {
    expect(elapsedDaysPt('2026-10-25', '2026-10-25')).toBe(1);
    expect(elapsedDaysPt('2026-10-25', '2026-10-31')).toBe(7);
    expect(elapsedDaysPt('2026-10-25', '2026-11-30')).toBe(7);
    expect(elapsedDaysPt('bad', '2026-10-25')).toBe(7);
  });
  it('reads the W number out of a build tag', () => {
    expect(buildW('3.0.16-w1094')).toBe(1094);
    expect(buildW('3.0.15-w1083')).toBe(1083);
    expect(buildW(null)).toBe(0);
    expect(buildW('garbage')).toBe(0);
    expect(AUTO_HUNT_MIN_W).toBe(1094);
  });
  it('pairKey sorts the two ids', () => {
    expect(pairKey('b', 'a')).toBe('a|b');
    expect(pairKey('a', 'b')).toBe('a|b');
  });
});

// ── a routed D1 mock for the sweeps ────────────────────────────────────────
interface SweepFixture {
  friends?: { a: string; b: string }[];
  done?: string[];
  optouts?: { user_id: string; friend_user_id: string }[];
  blocks?: { blocker_id: string; blocked_id: string }[];
  builds?: Record<string, string>;
  ranks?: Record<string, string>;
  stepsThisWeek?: Record<string, number>;
  stepsLastWeek?: Record<string, number>;
  active?: Record<string, unknown>[];
  progress?: { bid: string; user_id: string; event_type: string; s: number }[];
  participants?: { instance_id: string; user_id: string; joined_at: string | null }[];
  stampChanges?: number;
}
interface Call { sql: string; args: unknown[] }

function sweepDb(f: SweepFixture, calls: Call[]) {
  const thisWeek = getAccoladeWeekStart(Date.now());
  const lastWeek = priorWeekStart(thisWeek);
  const results = (sql: string, args: unknown[]): unknown[] => {
    if (sql.includes('FROM friends')) return f.friends ?? [];
    if (sql.includes('auto = 1 AND hunt_day')) return (f.done ?? []).map((pair_key) => ({ pair_key }));
    if (sql.includes('FROM coop_auto_optouts')) return f.optouts ?? [];
    if (sql.includes('FROM board_blocks')) return f.blocks ?? [];
    if (sql.includes('FROM app_opens')) return Object.entries(f.builds ?? {}).map(([user_id, build]) => ({ user_id, build }));
    if (sql.includes('FROM public_profile_summary')) return Object.entries(f.ranks ?? {}).map(([user_id, rank_tier]) => ({ user_id, rank_tier }));
    if (sql.includes('FROM merged')) {
      const src = args[0] === thisWeek ? f.stepsThisWeek : args[0] === lastWeek ? f.stepsLastWeek : {};
      return Object.entries(src ?? {}).map(([user_id, steps]) => ({ user_id, steps }));
    }
    if (sql.includes("WHERE status = 'active' ORDER BY ends_at")) return f.active ?? [];
    if (sql.includes('FROM coop_boss_participants')) return f.participants ?? [];
    if (sql.includes('FROM verified_events')) return f.progress ?? [];
    if (sql.includes('FROM users WHERE id IN')) return [{ id: 'u1', alias: 'richie' }, { id: 'u2', alias: 'anthony' }, { id: 'u3', alias: 'ren' }, { id: 'u4', alias: 'gali' }];
    return [];
  };
  const stmt = (sql: string, args: unknown[]) => ({
    all: async () => ({ results: results(sql, args), success: true, meta: {} }),
    first: async () => results(sql, args)[0] ?? null,
    run: async () => {
      if (sql.includes('SET coop_auto_push_day')) return { success: true, meta: { changes: f.stampChanges ?? 1 } };
      return { success: true, meta: { changes: 1 } };
    },
  });
  return {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => { calls.push({ sql, args }); return stmt(sql, args); },
      ...stmt(sql, []),
    }),
    batch: async (stmts: Array<{ run: () => Promise<unknown> }>) => Promise.all(stmts.map((s) => s.run())),
  } as unknown as D1Database;
}
function makeEnv(db: D1Database): Env {
  return { DB: db, RL_COOP_WRITE: { limit: async () => ({ success: true }) } } as unknown as Env;
}
const ctx = { waitUntil: (_p: Promise<unknown>) => undefined } as unknown as ExecutionContext;
const today = ptDayKey(Date.now());
const NEW = '3.0.16-w1094';

describe('sweepCoopAutoHunts — one sized hunt per walking friend pair per day', () => {
  const base: SweepFixture = {
    friends: [{ a: 'u1', b: 'u2' }, { a: 'u3', b: 'u1' }, { a: 'u2', b: 'u4' }],
    builds: { u1: NEW, u2: '3.0.16-w1095', u3: NEW, u4: NEW },
    ranks: { u1: 'C', u2: 'E', u3: 'C', u4: 'C' },
    stepsThisWeek: { u1: 30000, u2: 15000, u3: 40000, u4: 20000 },
    stepsLastWeek: { u1: 70000, u2: 35000, u3: 80000, u4: 50000 },
  };

  it('creates today\'s hunt for every eligible pair, with the boss and goal sized to the pair', async () => {
    const calls: Call[] = [];
    const res = await sweepCoopAutoHunts(makeEnv(sweepDb(base, calls)), ctx);
    expect(res.pairs).toBe(3);
    expect(res.created).toBe(3);
    const inserts = calls.filter((c) => c.sql.includes('INSERT OR IGNORE INTO coop_boss_instances'));
    expect(inserts.length).toBe(3);
    // every insert: active, auto, today's day, the pair's key, PT midnight to PT midnight
    for (const ins of inserts) {
      expect(ins.sql).toContain("'active'");
      expect(ins.args[8]).toBe(ptMidnightIso(today));          // starts_at
      expect(ins.args[9]).toBe(ptMidnightIso(nextDay(today))); // ends_at
      expect(ins.args[10]).toBe(today);                         // hunt_day
    }
    const byPair = new Map(inserts.map((c) => [c.args[11], c]));
    // u1 (C) + u2 (E): the E hunter caps it at the Twin Maw; pattern ≈ (70k+30k)/(7+e) + (35k+15k)/(7+e) ≥ 15.6k → the real 14,000
    expect(byPair.get('u1|u2')!.args[1]).toBe('the_twin_maw');
    expect(byPair.get('u1|u2')!.args[6]).toBe(14000);
    // u1 (C) + u3 (C): pattern ≥ 28k → The Coursing Dread at 18,000
    expect(byPair.get('u1|u3')!.args[1]).toBe('the_coursing_dread');
    expect(byPair.get('u1|u3')!.args[6]).toBe(18000);
    // the participant row is guarded on the instance existing
    const parts = calls.filter((c) => c.sql.includes('INTO coop_boss_participants'));
    expect(parts.length).toBe(3);
    expect(parts[0].sql).toContain('WHERE EXISTS');
  });

  it('skips a pair already holding today\'s row, an opted-out side, a blocked pair, an old build, and a hunter with no pattern', async () => {
    const calls: Call[] = [];
    const f: SweepFixture = {
      ...base,
      friends: [{ a: 'u1', b: 'u2' }, { a: 'u1', b: 'u3' }, { a: 'u2', b: 'u4' }, { a: 'u3', b: 'u4' }, { a: 'u1', b: 'u4' }],
      done: ['u1|u2'],
      optouts: [{ user_id: 'u3', friend_user_id: 'u1' }],
      blocks: [{ blocker_id: 'u4', blocked_id: 'u2' }],
      builds: { ...base.builds, u3: NEW, u4: '3.0.15-w1083' },
    };
    const res = await sweepCoopAutoHunts(makeEnv(sweepDb(f, calls)), ctx);
    expect(res.pairs).toBe(5);
    expect(res.created).toBe(0);
    expect(res.skipped).toBe(4);   // u1|u3 opted out, u2|u4 blocked, u3|u4 + u1|u4 old build
    expect(calls.some((c) => c.sql.includes('INSERT OR IGNORE INTO coop_boss_instances'))).toBe(false);
  });

  it('a global switch-off (\'*\') and a missing pattern both stop the pair', async () => {
    const calls: Call[] = [];
    const f: SweepFixture = {
      ...base,
      friends: [{ a: 'u1', b: 'u2' }, { a: 'u1', b: 'u3' }],
      optouts: [{ user_id: 'u2', friend_user_id: '*' }],
      stepsThisWeek: { u1: 30000, u2: 15000 },
      stepsLastWeek: { u1: 70000, u2: 35000 },   // u3 has no steps in either week
    };
    const res = await sweepCoopAutoHunts(makeEnv(sweepDb(f, calls)), ctx);
    expect(res.created).toBe(0);
    expect(res.skipped).toBe(2);
  });

  it('a lost race on the unique index creates nothing twice', async () => {
    const calls: Call[] = [];
    const db = sweepDb(base, calls) as unknown as { batch: (s: unknown[]) => Promise<unknown[]> };
    db.batch = async () => [{ meta: { changes: 0 } }, { meta: { changes: 0 } }];
    const ok = await createAutoHunt(makeEnv(db as unknown as D1Database), 'u2', 'u1', today, { bossId: 'the_twin_maw', goalSteps: 9000 });
    expect(ok).toBe(false);
    const ins = calls.find((c) => c.sql.includes('INSERT OR IGNORE INTO coop_boss_instances'))!;
    expect(ins.args[3]).toBe('u1');   // the smaller id leads
    expect(ins.args[4]).toBe('u2');
    expect(ins.args[6]).toBe(9000);
  });
});

describe('sweepCoopResolve — the server settles every active hunt', () => {
  const past = new Date(Date.now() - 3 * 3_600_000).toISOString();
  const future = new Date(Date.now() + 3 * 3_600_000).toISOString();
  const row = (id: string, extra: Record<string, unknown>) => ({
    id, boss_id: 'the_twin_maw', boss_rank: 'E', challenger_user_id: 'u1', partner_user_id: 'u2', partner2_user_id: null,
    partner_joined_at: past, partner2_joined_at: null, goal_steps: 14000, goal_flights: null, reward_souls: 25,
    fill_target: null, status: 'active', result: null, starts_at: past, ends_at: future, resolved_at: null,
    created_at: '2026-10-25 07:00:00', updated_at: '2026-10-25 07:00:00', ...extra,
  });

  it('an automatic win: completed + committed, awards for both, ONE push per hunter per day', async () => {
    const calls: Call[] = [];
    const f: SweepFixture = {
      active: [row('a1', { auto: 1, hunt_day: today, pair_key: 'u1|u2' })],
      participants: [{ instance_id: 'a1', user_id: 'u2', joined_at: past }],
      progress: [{ bid: 'a1', user_id: 'u1', event_type: 'steps_total', s: 9000 }, { bid: 'a1', user_id: 'u2', event_type: 'steps_total', s: 6000 }],
    };
    const res = await sweepCoopResolve(makeEnv(sweepDb(f, calls)), ctx);
    expect(res).toEqual({ won: 1, expired: 0 });
    const upd = calls.find((c) => c.sql.includes("SET status = 'completed'"))!;
    expect(upd.args).toEqual([1, 'a1']);   // committed = 1: both posted
    expect(calls.filter((c) => c.sql.includes('INTO coop_boss_awards')).length).toBe(2);
    expect(calls.filter((c) => c.sql.includes('SET coop_auto_push_day')).length).toBe(2);
    expect(mockNotify).toHaveBeenCalledTimes(2);
    const first = mockNotify.mock.calls[0];
    expect(first[1]).toBe('u1');
    expect((first[2] as { body: string }).body).toBe('You and anthony brought down The Twin Maw.');
    expect((first[2] as { type: string }).type).toBe('coop_complete');
  });

  it('a second automatic win the same day is quiet (the day stamp is already taken)', async () => {
    const calls: Call[] = [];
    const f: SweepFixture = {
      active: [row('a2', { auto: 1 })],
      participants: [{ instance_id: 'a2', user_id: 'u2', joined_at: past }],
      progress: [{ bid: 'a2', user_id: 'u1', event_type: 'steps_total', s: 14000 }, { bid: 'a2', user_id: 'u2', event_type: 'steps_total', s: 1 }],
      stampChanges: 0,
    };
    await sweepCoopResolve(makeEnv(sweepDb(f, calls)), ctx);
    expect(mockNotify).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.sql.includes('INTO coop_boss_awards')).length).toBe(2);   // the reward still lands
  });

  it('an automatic defeat is silent and stamps committed = 0 when one hunter never posted', async () => {
    const calls: Call[] = [];
    const f: SweepFixture = {
      active: [row('a3', { auto: 1, ends_at: past })],
      participants: [{ instance_id: 'a3', user_id: 'u2', joined_at: past }],
      progress: [{ bid: 'a3', user_id: 'u1', event_type: 'steps_total', s: 3000 }],
    };
    const res = await sweepCoopResolve(makeEnv(sweepDb(f, calls)), ctx);
    expect(res).toEqual({ won: 0, expired: 1 });
    const upd = calls.find((c) => c.sql.includes("SET status = 'expired'"))!;
    expect(upd.args).toEqual([0, 'a3']);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('a manual hunt still pushes its defeat to every hunter, and an unfinished one is left alone', async () => {
    const calls: Call[] = [];
    const f: SweepFixture = {
      active: [row('m1', { auto: 0, ends_at: past }), row('m2', { auto: 0 })],
      participants: [{ instance_id: 'm1', user_id: 'u2', joined_at: past }, { instance_id: 'm2', user_id: 'u2', joined_at: past }],
      progress: [{ bid: 'm1', user_id: 'u1', event_type: 'steps_total', s: 100 }, { bid: 'm2', user_id: 'u1', event_type: 'steps_total', s: 100 }],
    };
    const res = await sweepCoopResolve(makeEnv(sweepDb(f, calls)), ctx);
    expect(res).toEqual({ won: 0, expired: 1 });
    expect(mockNotify).toHaveBeenCalledTimes(2);
    expect((mockNotify.mock.calls[0][2] as { type: string }).type).toBe('coop_lost');
    expect(calls.some((c) => c.sql.includes("SET status = 'expired'") && c.args[1] === 'm2')).toBe(false);
  });
});

describe('sweepCoopResolve — the backlog settles quietly', () => {
  it('a hunt that closed days ago still gets its verdict and awards, but no push', async () => {
    const calls: Call[] = [];
    const longAgo = new Date(Date.now() - 5 * 86_400_000).toISOString();
    const base = {
      id: 'old1', boss_id: 'the_twin_maw', boss_rank: 'E', challenger_user_id: 'u1', partner_user_id: 'u2', partner2_user_id: null,
      partner_joined_at: longAgo, partner2_joined_at: null, goal_steps: 14000, goal_flights: null, reward_souls: 25, fill_target: null,
      status: 'active', result: null, starts_at: longAgo, ends_at: longAgo, resolved_at: null, created_at: longAgo, updated_at: longAgo, auto: 0,
    };
    const f: SweepFixture = {
      active: [base, { ...base, id: 'old2' }],
      participants: [{ instance_id: 'old1', user_id: 'u2', joined_at: longAgo }, { instance_id: 'old2', user_id: 'u2', joined_at: longAgo }],
      progress: [
        { bid: 'old1', user_id: 'u1', event_type: 'steps_total', s: 14000 },   // a win nobody resolved
        { bid: 'old2', user_id: 'u1', event_type: 'steps_total', s: 100 },     // a loss nobody resolved
      ],
    };
    const res = await sweepCoopResolve(makeEnv(sweepDb(f, calls)), ctx);
    expect(res).toEqual({ won: 1, expired: 1 });
    expect(calls.filter((c) => c.sql.includes('INTO coop_boss_awards')).length).toBe(2);
    expect(mockNotify).not.toHaveBeenCalled();
  });
});

describe('POST/DELETE /v1/coop-boss/auto/optout', () => {
  const session = (userId: string) => ({ userId, alias: 'tester' } as unknown as SessionPayload);
  const req = (body: unknown) => new Request('https://x/v1/coop-boss/auto/optout', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

  it('switches one friend off, then back on', async () => {
    const calls: Call[] = [];
    const env = makeEnv(sweepDb({}, calls));
    const off = await handleCoopAutoOptOut(req({ friend_user_id: 'deadbeef-1' }), env, session('u1'), false);
    expect(off.status).toBe(200);
    expect(calls.some((c) => c.sql.includes('INSERT OR IGNORE INTO coop_auto_optouts') && c.args[1] === 'deadbeef-1')).toBe(true);
    const on = await handleCoopAutoOptOut(req({ friend_user_id: 'deadbeef-1' }), env, session('u1'), true);
    expect(on.status).toBe(200);
    expect(calls.some((c) => c.sql.includes('DELETE FROM coop_auto_optouts') && c.args[1] === 'deadbeef-1')).toBe(true);
  });
  it("accepts '*' and refuses garbage or yourself", async () => {
    const env = makeEnv(sweepDb({}, []));
    expect((await handleCoopAutoOptOut(req({ friend_user_id: '*' }), env, session('u1'), false)).status).toBe(200);
    expect((await handleCoopAutoOptOut(req({ friend_user_id: 'u1' }), env, session('u1'), false)).status).toBe(400);
    expect((await handleCoopAutoOptOut(req({ friend_user_id: 'no spaces allowed' }), env, session('u1'), false)).status).toBe(400);
    expect((await handleCoopAutoOptOut(req({}), env, session('u1'), false)).status).toBe(400);
  });
});
