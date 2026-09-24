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
import { computeGateHp, handleWorldgateGet, handleWorldgateRally, handleWorldgateClaim, WORLDGATE_CLAIM_FLOOR, WORLDGATE_SOULS, WORLDGATE_MVP_BONUS } from './worldgate';
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

  it('W962 — a win streak does NOT raise the next gate (escalator off for a small fleet)', () => {
    const pools = [398668, 305069, 306299, 371684];
    const base = computeGateHp(pools, 0, 0);
    expect(computeGateHp(pools, 1, 0)).toBe(base);
    expect(computeGateHp(pools, 5, 0)).toBe(base);
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
  gate: { hp: number; status: string; kill_json?: string | null; slain_at?: number | null };
  claims?: Set<string>;     // W975 — user ids that claimed this week
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
            // W975 — the frozen kill's two reads (before the generic pool route, which would match too).
            if (/AS kill_hunters, COALESCE\(SUM\(steps\), 0\) AS kill_pool FROM merged/.test(sql)) return { kill_hunters: st.merged.length, kill_pool: st.merged.reduce((a, r) => a + r.steps, 0) };
            if (/AS above_kill/.test(sql)) { const m = st.merged.find((r) => r.user_id === binds[1]); const mine = m ? m.steps : 0; return { mine: m ? m.steps : null, above_kill: st.merged.filter((r) => r.steps > mine).length }; }
            if (/FROM world_gates WHERE week_start = \?/.test(sql)) return { week_start: binds[0], hp: st.gate.hp, status: st.gate.status, slain_at: st.gate.slain_at ?? null, slain_by: null, kill_json: st.gate.kill_json ?? null };
            if (/SUM\(steps\), 0\) AS pool FROM merged/.test(sql)) return { pool: st.merged.reduce((a, r) => a + r.steps, 0) };
            if (/FROM leaderboard_snapshots WHERE user_id = \?/.test(sql)) { const m = st.merged.find((r) => r.user_id === binds[0]); return m ? { current_value: m.steps } : null; }
            if (/FROM world_gate_claims/.test(sql)) return st.claims && st.claims.has(binds[1] as string) ? { one: 1 } : null;
            if (/AS hunters,/.test(sql)) {
              const me = binds[1] as string; const mine = binds[2] as number; const floor = binds[3] as number;
              const g = st.merged.filter((r) => isFriend(r.user_id) && r.user_id !== me);
              return { hunters: st.merged.length, guild_steps: g.reduce((a, r) => a + r.steps, 0), guild_hunters: g.length, above: st.merged.filter((r) => r.steps > mine).length, wall_count: st.merged.filter((r) => r.steps >= floor).length };
            }
            if (/SELECT sent FROM world_gate_rallies/.test(sql)) return st.rallies.has(`${binds[0]}|${binds[1]}`) ? { sent: 1 } : null;
            return null;
          },
          all: async () => {
            if (/SELECT m\.user_id AS user_id, u\.alias AS alias/.test(sql)) {   // W975 — the podium freeze
              const results = st.merged.slice().sort((a, b) => b.steps - a.steps || a.alias.localeCompare(b.alias)).slice(0, (binds[1] as number) || 3).map((r) => ({ user_id: r.user_id, alias: r.alias, steps: r.steps, rank_tier: r.rank_tier ?? null }));
              return { results, success: true, meta: {} };
            }
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
              const until = binds[2] as number | null;
              const results = st.merged.filter((r) => until == null || (r.updated_at || 0) <= until).sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0)).slice(0, binds[1] as number).map((r) => ({ alias: r.alias, steps: r.steps, at: r.updated_at || 0 }));
              return { results, success: true, meta: {} };
            }
            if (/AND updated_at > \?/.test(sql)) return { results: st.merged.filter((r) => (r.updated_at || 0) > (binds[1] as number)).map((r) => ({ user_id: r.user_id })), success: true, meta: {} };
            if (/AS f\(id\)/.test(sql)) return { results: st.friends.map((id) => ({ id })), success: true, meta: {} };
            if (/FROM world_gates WHERE week_start </.test(sql)) return { results: [], success: true, meta: {} };
            if (/FROM weekly_step_records/.test(sql)) return { results: [], success: true, meta: {} };
            return { results: [], success: true, meta: {} };
          },
          run: async () => {
            if (/UPDATE world_gates SET kill_json/.test(sql)) { st.gate.kill_json = binds[0] as string; return { success: true, meta: { changes: 1 } }; }
            if (/UPDATE world_gates SET status = 'slain', slain_at = \?, slain_by/.test(sql)) {
              if (st.gate.status !== 'open') return { success: true, meta: { changes: 0 } };
              st.gate.status = 'slain'; st.gate.slain_at = binds[0] as number; return { success: true, meta: { changes: 1 } };
            }
            if (/INSERT INTO world_gate_claims/.test(sql)) {
              st.claims = st.claims || new Set();
              if (st.claims.has(binds[1] as string)) throw new Error('UNIQUE constraint failed');
              st.claims.add(binds[1] as string); return { success: true, meta: { changes: 1 } };
            }
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

// ── W975 — Worldgate MVPs: the podium frozen at the kill, and its bonus ───
describe('W975 — Worldgate MVPs', () => {
  const kill = async (st: WgState, who: SessionPayload = meS) =>
    (await (await handleWorldgateGet(new Request('https://x/v1/worldgate'), wgEnv(st), who)).json()) as Record<string, any>;
  const claim = async (st: WgState, who: SessionPayload) =>
    (await (await handleWorldgateClaim(new Request('https://x/v1/worldgate/claim', { method: 'POST' }), wgEnv(st), who)).json()) as Record<string, any>;
  const ren = { userId: 'u-ren', alias: 'RenDIESEL' } as SessionPayload;
  const g = { userId: 'u-g', alias: 'grubbadub' } as SessionPayload;

  it('an open gate announces nothing', async () => {
    const r = await kill(wgFresh());
    expect(r.kill).toBeNull();
  });

  it('the read that crosses the line freezes the top three, the pool and the headcount', async () => {
    const st = wgFresh(); st.gate.hp = 40000;   // 50,000 walked: this read stamps the kill
    const r = await kill(st);
    expect(r.status).toBe('slain');
    expect(r.kill.mvps.map((m: any) => m.alias)).toEqual(['RenDIESEL', 'james', 'grubbadub']);
    expect(r.kill.mvps[0]).toEqual({ alias: 'RenDIESEL', rank_tier: 'S', steps: 21000 });
    expect(JSON.stringify(r.kill)).not.toMatch(/u-ren|user_id/);   // ids never leave the server
    expect(r.kill).toMatchObject({ pool: 50000, hunters: 4, my_place: 0, my_steps: 4000, my_pos: 4, mvp_bonus: WORLDGATE_MVP_BONUS });
    // Richie then walks past everyone: the podium does not move.
    st.merged[0]!.steps = 30000;
    const later = await kill(st);
    expect(later.kill.mvps.map((m: any) => m.alias)).toEqual(['RenDIESEL', 'james', 'grubbadub']);
    expect(later.kill.my_place).toBe(0);
  });

  it('a gate slain before the freeze existed is frozen on first read', async () => {
    const st = wgFresh(); st.gate.status = 'slain'; st.gate.slain_at = 123;
    const r = await kill(st);
    expect(r.kill.mvps.length).toBe(3);
    expect(st.gate.kill_json).toContain('RenDIESEL');
    expect(r.kill.slain_at).toBe(123);
  });

  it('1st gets bounty + 150; an MVP under the bounty floor still gets the bonus; a non-MVP under the floor is refused', async () => {
    const st = wgFresh(); st.gate.hp = 40000;
    await kill(st);   // stamp + freeze
    const a = await claim(st, ren);
    expect(a).toMatchObject({ ok: true, first: true, bounty: WORLDGATE_SOULS, mvp_bonus: 150, mvp_place: 1, souls: WORLDGATE_SOULS + 150 });
    const third = await claim(st, g);   // 9,000 steps: below the floor, but 3rd on the podium
    expect(third).toMatchObject({ ok: true, first: true, bounty: 0, mvp_bonus: 50, mvp_place: 3, souls: 50 });
    const again = await claim(st, ren);
    expect(again).toMatchObject({ first: false, souls: 0 });
    const res = await handleWorldgateClaim(new Request('https://x/v1/worldgate/claim', { method: 'POST' }), wgEnv(st), meS);
    expect(res.status).toBe(403);
  });

  it('an MVP below the floor reads as claimable', async () => {
    const st = wgFresh(); st.gate.hp = 40000;
    await kill(st);
    expect((await kill(st, g)).claimable).toBe(true);
    expect((await kill(st, meS)).claimable).toBe(false);
  });
});

// ── W983 — once the gate falls, strikes stop counting ─────────────────────
describe('W983 — the gate stops counting at the kill', () => {
  const read = async (st: WgState, who: SessionPayload = meS) =>
    (await (await handleWorldgateGet(new Request('https://x/v1/worldgate'), wgEnv(st), who)).json()) as Record<string, any>;
  const claim = async (st: WgState, who: SessionPayload) =>
    handleWorldgateClaim(new Request('https://x/v1/worldgate/claim', { method: 'POST' }), wgEnv(st), who);

  it('steps walked after the kill move nothing on the gate: damage, pool, lists, recent, claim', async () => {
    const st = wgFresh(); st.gate.hp = 40000;
    const atKill = await read(st);   // this read stamps + freezes
    expect(atKill.status).toBe('slain');
    // Richie walks 16,000 more and syncs: past the bounty floor, past everyone.
    st.merged[0]!.steps = 20000; st.merged[0]!.updated_at = 999;
    const r = await read(st);
    expect(r.my_damage).toBe(4000);
    expect(r.pool).toBe(50000);
    expect(r.my_rank).toBe(4);
    expect(r.top.map((t: any) => [t.alias, t.steps])).toEqual([['RenDIESEL', 21000], ['james', 16000], ['grubbadub', 9000], ['Richie', 4000]]);
    expect(r.wall.map((w: any) => w.alias)).toEqual(['RenDIESEL', 'james']);
    expect(r.wall_count).toBe(2);
    expect(r.guild).toEqual({ steps: 30000, hunters: 2 });
    expect(r.recent.map((x: any) => x.alias)[0]).toBe('grubbadub');   // his post-kill sync is not a strike
    expect(r.recent.some((x: any) => x.steps === 20000)).toBe(false);
    expect(r.kill).toMatchObject({ my_steps: 4000, my_pos: 4 });
    expect(r.claimable).toBe(false);
    expect((await claim(st, meS)).status).toBe(403);
    expect(JSON.stringify(r)).not.toMatch(/u-me|u-ren|user_id/);
  });

  it('an open gate still counts live', async () => {
    const st = wgFresh();
    st.merged[0]!.steps = 6000;
    const r = await read(st);
    expect(r.my_damage).toBe(6000);
    expect(r.pool).toBe(52000);
  });

  it('a kill frozen before standings existed is completed on first read: podium numbers kept, recent stops at the kill', async () => {
    const st = wgFresh(); st.gate.status = 'slain'; st.gate.slain_at = 250;
    st.gate.kill_json = JSON.stringify({ pool: 48000, hunters: 4, mvps: [
      { user_id: 'u-ren', alias: 'RenDIESEL', rank_tier: 'S', steps: 19000 },
      { user_id: 'u-j', alias: 'james', rank_tier: 'B', steps: 16000 },
      { user_id: 'u-g', alias: 'grubbadub', rank_tier: 'B', steps: 9000 },
    ] });
    // Richie synced AFTER the kill (6,000 now): he gives back the overshoot, the podium keeps its numbers.
    st.merged[0]!.steps = 6000; st.merged[0]!.updated_at = 500;
    const r = await read(st);
    expect(r.pool).toBe(48000);
    expect(r.top[0]).toMatchObject({ alias: 'RenDIESEL', steps: 19000 });   // his post-kill 2,000 do not count
    expect(r.my_damage).toBe(4000);   // 19,000 + 16,000 + 9,000 + 6,000 = 50,000 → 2,000 over the kill's 48,000
    expect(r.recent.map((x: any) => x.alias)).toEqual(['james']);   // only syncs at or before the kill
    const saved = JSON.parse(st.gate.kill_json as string);
    expect(Array.isArray(saved.standings)).toBe(true);
    expect(saved.standings.reduce((a: number, x: any) => a + x.steps, 0)).toBe(48000);
  });
});
