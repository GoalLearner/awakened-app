/**
 * worldgate.test.ts — W892 (3.0.1 C11).
 *
 * The Worldgate shipped with HP = max(400_000, actives14d * 55_000) and NO test
 * coverage. In production that produced ~1.31M HP against real weekly pools of
 * 250-400k: every gate ever created survived, zero claims were ever paid, and
 * the capstone social moment never once happened.
 *
 * These cases pin the replacement against ELEVEN WEEKS OF REAL PRODUCTION POOLS
 * (weekly_step_records, 2026-06-07 .. 2026-08-16, sims excluded) so the number
 * cannot drift back into unwinnable territory unnoticed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../lib/apns', () => ({ notifyUser: vi.fn(async () => {}) }));
import { notifyUser } from '../lib/apns';
import { computeGateHp, handleWorldgateGet, handleWorldgateRally, WORLDGATE_CLAIM_FLOOR } from './worldgate';
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';

// Real durable weekly pools, oldest first. The in-progress week is excluded.
const REAL_POOLS: Array<[string, number]> = [
  ['2026-06-07', 398668], ['2026-06-14', 305069], ['2026-06-21', 306299], ['2026-06-28', 371684],
  ['2026-07-05', 415105], ['2026-07-12', 352353], ['2026-07-19', 320038], ['2026-07-26', 398736],
  ['2026-08-02', 295412], ['2026-08-09', 252178], ['2026-08-16', 296492],
];
const CARRY_RATE = 0.05;

/** Replay the real weeks through the live formula, exactly as ensureGate would. */
function backtest() {
  let streak = 0;
  let carry = 0;
  let slain = 0;
  const rows: Array<{ week: string; hp: number; pool: number; won: boolean }> = [];
  for (let i = 4; i < REAL_POOLS.length; i++) {
    const [week, pool] = REAL_POOLS[i];
    const priorPools = REAL_POOLS.slice(i - 4, i).map((w) => w[1]);
    const hp = computeGateHp(priorPools, streak, carry);
    const won = pool >= hp;
    rows.push({ week, hp, pool, won });
    if (won) { slain++; streak++; carry = 0; }
    else { streak = 0; carry = Math.floor(pool * CARRY_RATE); }
  }
  return { rows, slain, total: rows.length };
}

describe('worldgate HP (W892)', () => {
  it('is beatable by a typical real week — the bug this replaced was not', () => {
    // The old formula produced 1.31M against these pools: 0 of 7 winnable.
    const hp = computeGateHp([398668, 305069, 306299, 371684], 0, 0);
    expect(hp).toBeLessThan(400000);
    expect(hp).toBeGreaterThan(120000);
  });

  it('breaks 50-80% of real weeks (the tuning target)', () => {
    const { slain, total } = backtest();
    const rate = slain / total;
    expect(rate).toBeGreaterThanOrEqual(0.5);
    expect(rate).toBeLessThanOrEqual(0.8);
  });

  it('escalates after consecutive wins so victory does not become routine', () => {
    const pools = [398668, 305069, 306299, 371684];
    const base = computeGateHp(pools, 0, 0);
    expect(computeGateHp(pools, 1, 0)).toBeGreaterThan(base);
    expect(computeGateHp(pools, 2, 0)).toBeGreaterThan(computeGateHp(pools, 1, 0));
  });

  it('self-corrects downward after a slump', () => {
    const strong = computeGateHp([415105, 398736, 398668, 371684], 0, 0);
    const weak = computeGateHp([252178, 295412, 296492, 305069], 0, 0);
    expect(weak).toBeLessThan(strong);
  });

  it('honours the survived-gate carry', () => {
    const pools = [398668, 305069, 306299, 371684];
    expect(computeGateHp(pools, 0, 10000)).toBe(computeGateHp(pools, 0, 0) - 10000);
  });

  it('never returns a non-positive or sub-floor-on-empty HP', () => {
    expect(computeGateHp([], 0, 0)).toBe(120000);          // bootstrap: no history yet
    expect(computeGateHp([0, 0], 0, 0)).toBe(120000);      // junk filtered
    expect(computeGateHp([200000], 0, 999999999)).toBeGreaterThan(0);   // carry cannot invert it
  });
});

// ── W916 — the v2 read side + the rally horn ────────────────────────────
const mockNotify = vi.mocked(notifyUser);
interface WgState {
  merged: Array<{ user_id: string; alias: string; steps: number; rank_tier?: string; updated_at?: number }>;
  friends: string[];        // accepted friends of 'u-me'
  gate: { hp: number; status: string };
  rallies: Set<string>;     // `${user}|${day}`
  calls: { sql: string; binds: unknown[] }[];
}
function wgEnv(st: WgState): Env {
  const okRl = { limit: async () => ({ success: true }) };
  const isFriend = (u: string) => st.friends.includes(u);
  const db = {
    prepare: (sql: string) => ({
      bind: (...binds: unknown[]) => {
        st.calls.push({ sql, binds });
        return {
          first: async () => {
            if (/FROM world_gates WHERE week_start = \?/.test(sql)) return { week_start: binds[0], hp: st.gate.hp, status: st.gate.status, slain_at: null, slain_by: null };
            if (/SUM\(steps\), 0\) AS pool FROM merged/.test(sql)) return { pool: st.merged.reduce((a, r) => a + r.steps, 0) };
            if (/FROM leaderboard_snapshots WHERE user_id = \?/.test(sql)) { const m = st.merged.find((r) => r.user_id === binds[0]); return m ? { current_value: m.steps } : null; }
            if (/FROM world_gate_claims/.test(sql)) return null;
            if (/AS hunters,/.test(sql)) {
              const me = binds[1] as string; const mine = binds[2] as number; const floor = binds[3] as number;
              const g = st.merged.filter((r) => isFriend(r.user_id) && r.user_id !== me);
              return { hunters: st.merged.length, guild_steps: g.reduce((a, r) => a + r.steps, 0), guild_hunters: g.length, above: st.merged.filter((r) => r.steps > mine).length, wall_count: st.merged.filter((r) => r.steps >= floor).length };
            }
            if (/SELECT sent FROM world_gate_rallies/.test(sql)) return st.rallies.has(`${binds[0]}|${binds[1]}`) ? { sent: 1 } : null;
            return null;
          },
          all: async () => {
            if (/ORDER BY m\.steps DESC, u\.alias ASC\s+LIMIT \?3/.test(sql) && /AS me/.test(sql)) {
              const me = binds[1] as string;
              const results = st.merged.slice().sort((a, b) => b.steps - a.steps).slice(0, binds[2] as number).map((r) => ({ alias: r.alias, steps: r.steps, rank_tier: r.rank_tier ?? null, me: r.user_id === me ? 1 : 0 }));
              return { results, success: true, meta: {} };
            }
            if (/WHERE m\.steps >= \?2/.test(sql)) {
              const results = st.merged.filter((r) => r.steps >= (binds[1] as number)).sort((a, b) => b.steps - a.steps).map((r) => ({ alias: r.alias, steps: r.steps }));
              return { results, success: true, meta: {} };
            }
            if (/ORDER BY ls\.updated_at DESC/.test(sql)) {
              const results = st.merged.slice().sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0)).slice(0, binds[1] as number).map((r) => ({ alias: r.alias, steps: r.steps, at: r.updated_at || 0 }));
              return { results, success: true, meta: {} };
            }
            if (/AS f\(id\)/.test(sql)) return { results: st.friends.map((id) => ({ id })), success: true, meta: {} };
            if (/FROM world_gates WHERE week_start </.test(sql)) return { results: [], success: true, meta: {} };
            if (/FROM weekly_step_records/.test(sql)) return { results: [], success: true, meta: {} };
            return { results: [], success: true, meta: {} };
          },
          run: async () => {
            if (/INSERT OR IGNORE INTO world_gate_rallies/.test(sql)) {
              const k = `${binds[0]}|${binds[1]}`; if (st.rallies.has(k)) return { success: true, meta: { changes: 0 } };
              st.rallies.add(k); return { success: true, meta: { changes: 1 } };
            }
            return { success: true, meta: { changes: 1 } };
          },
        };
      },
    }),
  } as unknown as D1Database;
  return { DB: db, RL_FRIENDS_READ: okRl, RL_FRIENDS_WRITE: okRl } as unknown as Env;
}
const meS: SessionPayload = { userId: 'u-me', alias: 'Richie' } as SessionPayload;
const wgCtx = { waitUntil: (p: Promise<unknown>) => { void p; } } as unknown as ExecutionContext;
function wgFresh(): WgState {
  return {
    merged: [
      { user_id: 'u-me', alias: 'Richie', steps: 4000, rank_tier: 'A', updated_at: 100 },
      { user_id: 'u-ren', alias: 'RenDIESEL', steps: 21000, rank_tier: 'S', updated_at: 300 },
      { user_id: 'u-j', alias: 'james', steps: 16000, rank_tier: 'B', updated_at: 200 },
      { user_id: 'u-g', alias: 'grubbadub', steps: 9000, rank_tier: 'B', updated_at: 400 },
    ],
    friends: ['u-ren', 'u-g'],
    gate: { hp: 120000, status: 'open' },
    rallies: new Set(),
    calls: [],
  };
}
beforeEach(() => { mockNotify.mockClear(); });

describe('W916 — the Worldgate v2 read side', () => {
  it('reports hunters striking, the guild share, top strikers with me, my rank, the Kill Wall and recent strikers', async () => {
    const st = wgFresh();
    const res = await handleWorldgateGet(new Request('https://x/v1/worldgate'), wgEnv(st), meS);
    expect(res.status).toBe(200);
    const j = (await res.json()) as Record<string, unknown>;
    expect(j.pool).toBe(50000);
    expect(j.hunters).toBe(4);
    expect(j.guild).toEqual({ steps: 30000, hunters: 2 });
    expect(j.my_damage).toBe(4000);
    expect(j.my_rank).toBe(4);
    const top = j.top as Array<{ alias: string; me: boolean }>;
    expect(top.map((t) => t.alias)).toEqual(['RenDIESEL', 'james', 'grubbadub', 'Richie']);
    expect(top[3]!.me).toBe(true);
    expect((j.wall as Array<{ alias: string }>).map((w) => w.alias)).toEqual(['RenDIESEL', 'james']);
    expect(j.wall_count).toBe(2);
    expect((j.recent as Array<{ alias: string }>)[0]!.alias).toBe('grubbadub');
    expect(j.rallied_today).toBe(false);
    expect(j.claim_floor).toBe(WORLDGATE_CLAIM_FLOOR);
  });

  it('the rally horn pushes every accepted friend once a day; the second horn is a no-op', async () => {
    const st = wgFresh();
    const first = (await (await handleWorldgateRally(new Request('https://x/v1/worldgate/rally', { method: 'POST' }), wgEnv(st), meS, wgCtx)).json()) as Record<string, unknown>;
    expect(first).toMatchObject({ ok: true, already: false, sent: 2 });
    expect(mockNotify).toHaveBeenCalledTimes(2);
    expect((mockNotify.mock.calls[0]![2] as { type: string; body: string }).type).toBe('worldgate_rally');
    expect((mockNotify.mock.calls[0]![2] as { body: string }).body).toMatch(/42% down/);   // 50,000 of 120,000
    const again = (await (await handleWorldgateRally(new Request('https://x/v1/worldgate/rally', { method: 'POST' }), wgEnv(st), meS, wgCtx)).json()) as Record<string, unknown>;
    expect(again).toMatchObject({ ok: true, already: true, sent: 0 });
    expect(mockNotify).toHaveBeenCalledTimes(2);
    const read = (await (await handleWorldgateGet(new Request('https://x/v1/worldgate'), wgEnv(st), meS)).json()) as Record<string, unknown>;
    expect(read.rallied_today).toBe(true);
  });

  it('a hunter with no guild rallies nobody, and a slain gate changes the horn', async () => {
    const st = wgFresh(); st.friends = []; st.gate.status = 'slain';
    const r = (await (await handleWorldgateRally(new Request('https://x/v1/worldgate/rally', { method: 'POST' }), wgEnv(st), meS, wgCtx)).json()) as Record<string, unknown>;
    expect(r).toMatchObject({ ok: true, sent: 0 });
    expect(mockNotify).not.toHaveBeenCalled();
  });
});
