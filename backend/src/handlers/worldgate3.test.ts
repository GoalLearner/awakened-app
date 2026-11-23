/**
 * worldgate3.test.ts — W1283, the Worldgate's three HP bars (steps, flights, sleep).
 *
 * Owner 2026-11-22: "I want to have the world gate do the steps + flights HP bar + Sleep total ... So this worldgate will
 * have all of these to complete to kill it. Make this realistic but challenging", "MVP will be contributions to the boss
 * kill so all three combined in a percentage damage", "the kill wall has to be % damage" and "everyone on the kill wall
 * gets 200 souls each + 1% chance at any S-tier item drop + 0.5% on the mythic drop".
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
vi.mock('../lib/apns', () => ({ notifyUser: vi.fn(async () => {}) }));
import {
  handleWorldgateGet, handleWorldgateClaim, handleWorldgateEffort, overallPct, damagePct, barsDown, computeNextBars,
  nextStepsAfterThreeBar, wgDaysBegun, wgCapDays, wgDice, WG3_FROM, WG3_START_FLIGHTS, WG3_START_SLEEP, WG3_WALL_PCT,
  WG3_DROP_S, WG3_DROP_MYTHIC, WG3_FLIGHTS_DAY_CAP, WG3_SLEEP_NIGHT_CAP, WORLDGATE_SOULS,
} from './worldgate';
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';

describe('W1283 — the three-bar math', () => {
  it('starts 2026-11-29 at 1,500 flights and 600 hours of sleep; the Kill Wall is 0.5%; the bounty rolls 1% and 0.5%', () => {
    expect(WG3_FROM).toBe('2026-11-29');
    expect(WG3_START_FLIGHTS).toBe(1500);
    expect(WG3_START_SLEEP).toBe(600 * 60);
    expect(WG3_WALL_PCT).toBe(0.5);
    expect(WG3_DROP_S).toBe(0.01);
    expect(WG3_DROP_MYTHIC).toBe(0.005);
    expect(WG3_FLIGHTS_DAY_CAP).toBe(50);
    expect(WG3_SLEEP_NIGHT_CAP).toBe(9 * 60);
  });
  it('the gate\'s damage averages the three bars, each capped at 100%; it falls only when all three are spent', () => {
    const hp = { steps: 1000, flights: 100, sleep: 600 };
    expect(overallPct(hp, { steps: 500, flights: 50, sleep: 300 })).toBeCloseTo(50);
    expect(overallPct(hp, { steps: 3000, flights: 0, sleep: 0 })).toBeCloseTo(33.333, 2);   // an overfilled bar counts 100%
    expect(barsDown(hp, { steps: 3000, flights: 100, sleep: 599 })).toBe(false);
    expect(barsDown(hp, { steps: 1000, flights: 100, sleep: 600 })).toBe(true);
  });
  it('a hunter\'s damage is their share of each bar averaged; everyone\'s adds up to the gate\'s, never past 100%', () => {
    const hp = { steps: 1000, flights: 100, sleep: 600 };
    const a = { steps: 600, flights: 10, sleep: 0 }, b = { steps: 600, flights: 90, sleep: 600 };
    const pool = { steps: 1200, flights: 100, sleep: 600 };
    expect(damagePct(a, hp, pool)).toBeCloseTo(((600 / 1200) + 0.1 + 0) / 3 * 100);
    expect(damagePct(a, hp, pool) + damagePct(b, hp, pool)).toBeCloseTo(100);   // overfilled steps share the 1,200 walked
    expect(damagePct({ steps: 0, flights: 0, sleep: 0 }, hp, pool)).toBe(0);
  });
  it('the next gate: start values with no three-bar gate before; a beaten gate grows by how early it fell; one that stood eases what was left', () => {
    expect(computeNextBars(null, null, 0)).toEqual({ flights: 1500, sleep: 36000 });
    expect(computeNextBars({ week_start: '2026-11-22', hp: 1, hp_flights: null, hp_sleep: null, status: 'slain', slain_at: 1 }, null, 0)).toEqual({ flights: 1500, sleep: 36000 });
    const wed = Date.parse('2026-12-02T20:00:00Z');   // Wednesday, Pacific
    expect(computeNextBars({ week_start: '2026-11-29', hp: 1, hp_flights: 1500, hp_sleep: 36000, status: 'slain', slain_at: wed }, null, 0)).toEqual({ flights: 1950, sleep: 46800 });
    // stood: flights were spent (kept), sleep reached 20,000 of 36,000 (eased to 90% of it)
    expect(computeNextBars({ week_start: '2026-11-29', hp: 1, hp_flights: 1500, hp_sleep: 36000, status: 'survived', slain_at: null },
      { steps: 0, flights: 1600, sleep: 20000 }, 1)).toEqual({ flights: 1500, sleep: 18000 });
    expect(nextStepsAfterThreeBar({ hp: 1_000_000 }, 1_200_000, 1)).toBe(1_000_000);   // a spent steps bar keeps its size
    expect(nextStepsAfterThreeBar({ hp: 1_000_000 }, 500_000, 1)).toBe(450_000);
  });
  it('the phone\'s day lists: only the days begun (one more for a phone east of Pacific), each capped', () => {
    expect(wgDaysBegun('2026-11-29', '2026-11-28')).toBe(0);
    expect(wgDaysBegun('2026-11-29', '2026-11-29')).toBe(1);
    expect(wgDaysBegun('2026-11-29', '2026-12-05')).toBe(7);
    expect(wgCapDays([10, 80, 5, 999], 1, 50)).toBe(10 + 50);   // Sunday + Monday's first hours east of Pacific
    expect(wgCapDays([10, 80, 5, 999], 7, 50)).toBe(10 + 50 + 5 + 50);
    expect(wgCapDays([600, -5, 'x', 2.9], 7, 540)).toBe(540 + 2);
    expect(wgCapDays('nope', 7, 50)).toBe(0);
  });
});

// ── the handlers, over a small stand-in for D1 ──
interface St {
  gate: { week_start: string; hp: number; hp_flights: number; hp_sleep: number; status: string; slain_at: number | null; kill_json: string | null };
  merged: Array<{ user_id: string; alias: string; steps: number; rank_tier?: string }>;
  effort: Array<{ user_id: string; alias: string; flights: number; sleep_min: number }>;
  friends: string[];
  claims: Map<string, string>;
}
function env3(st: St): Env {
  const ok = { limit: async () => ({ success: true }) };
  const res = (results: unknown[]) => ({ results, success: true, meta: {} });
  const db = {
    prepare: (sql: string) => ({
      bind: (...b: unknown[]) => ({
        first: async () => {
          if (/AND status = 'slain'/.test(sql)) return st.gate.status === 'slain' && b[0] === st.gate.week_start ? { ...st.gate, slain_by: null } : null;
          if (/FROM world_gates WHERE week_start = \?/.test(sql)) return b[0] === st.gate.week_start ? { ...st.gate, slain_by: null } : null;
          if (/SUM\(steps\), 0\) AS pool FROM merged/.test(sql)) return { pool: st.merged.reduce((a, r) => a + r.steps, 0) };
          if (/AS f, COALESCE\(SUM\(sleep_min\)/.test(sql)) return { f: st.effort.reduce((a, r) => a + r.flights, 0), s: st.effort.reduce((a, r) => a + r.sleep_min, 0) };
          if (/FROM leaderboard_snapshots WHERE user_id = \?/.test(sql)) { const m = st.merged.find((r) => r.user_id === b[0]); return m ? { current_value: m.steps } : null; }
          if (/FROM world_gate_claims/.test(sql)) return st.claims.has(b[1] as string) ? { one: 1 } : null;
          if (/FROM app_open_counts WHERE user_id = \?1/.test(sql)) return { n: 7 };
          if (/SELECT flights, sleep_min FROM world_gate_effort/.test(sql)) return st.effort.find((r) => r.user_id === b[1]) ?? null;
          return null;
        },
        all: async () => {
          if (/SELECT m\.user_id AS user_id, u\.alias AS alias/.test(sql)) return res(st.merged.map((r) => ({ ...r, rank_tier: r.rank_tier ?? null })));
          if (/SELECT x\.user_id AS user_id, x\.flights/.test(sql)) return res(st.effort.map((r) => ({ ...r, rank_tier: null })));
          if (/^SELECT id FROM \(SELECT CASE/.test(sql)) return res(st.friends.map((id) => ({ id })));
          return res([]);
        },
        run: async () => {
          if (/UPDATE world_gates SET kill_json/.test(sql)) { st.gate.kill_json = b[0] as string; return { meta: { changes: 1 } }; }
          if (/UPDATE world_gates SET status = 'slain', slain_at = \?, slain_by/.test(sql)) {
            if (st.gate.status !== 'open') return { meta: { changes: 0 } };
            st.gate.status = 'slain'; st.gate.slain_at = b[0] as number; return { meta: { changes: 1 } };
          }
          if (/INSERT INTO world_gate_claims/.test(sql)) {
            if (st.claims.has(b[1] as string)) throw new Error('UNIQUE constraint failed');
            st.claims.set(b[1] as string, String(b[3] ?? '')); return { meta: { changes: 1 } };
          }
          if (/INSERT INTO world_gate_effort/.test(sql)) {
            const row = st.effort.find((r) => r.user_id === b[1]);
            if (row) { row.flights = Math.max(row.flights, b[2] as number); row.sleep_min = Math.max(row.sleep_min, b[3] as number); }
            else st.effort.push({ user_id: b[1] as string, alias: 'x', flights: b[2] as number, sleep_min: b[3] as number });
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 1 } };
        },
      }),
    }),
  } as unknown as D1Database;
  return { DB: db, RL_FRIENDS_READ: ok, RL_FRIENDS_WRITE: ok } as unknown as Env;
}
const me: SessionPayload = { userId: 'u-me', alias: 'Richie' } as SessionPayload;
function fresh(): St {
  return {
    gate: { week_start: '2026-11-29', hp: 100000, hp_flights: 1000, hp_sleep: 6000, status: 'open', slain_at: null, kill_json: null },
    merged: [
      { user_id: 'u-me', alias: 'Richie', steps: 10000, rank_tier: 'A' },
      { user_id: 'u-ren', alias: 'RenDIESEL', steps: 40000, rank_tier: 'S' },
      { user_id: 'u-k', alias: 'Kestrel', steps: 20000, rank_tier: 'B' },
      { user_id: 'u-low', alias: 'Lowly', steps: 300 },
    ],
    effort: [
      { user_id: 'u-me', alias: 'Richie', flights: 300, sleep_min: 3000 },
      { user_id: 'u-k', alias: 'Kestrel', flights: 200, sleep_min: 0 },
      { user_id: 'u-sl', alias: 'Sleeper', flights: 0, sleep_min: 1500 },   // no steps at all: sleep alone counts
    ],
    friends: ['u-k'],
    claims: new Map(),
  };
}
const get = async (st: St) => (await (await handleWorldgateGet(new Request('https://x/v1/worldgate'), env3(st), me)).json()) as Record<string, any>;
const claim = async (st: St) => (await handleWorldgateClaim(new Request('https://x/v1/worldgate/claim', { method: 'POST' }), env3(st), me));
const WED = new Date('2026-12-02T20:00:00Z');
afterEach(() => { vi.useRealTimers(); });

describe('W1283 — GET /v1/worldgate on a three-bar gate', () => {
  it('the three bars, the gate\'s damage and yours; the lists rank by damage; the Kill Wall is 0.5% or more', async () => {
    vi.useFakeTimers(); vi.setSystemTime(WED);
    const j = await get(fresh());
    expect(j.bars).toEqual({
      steps: { hp: 100000, pool: 70300, my: 10000 },
      flights: { hp: 1000, pool: 500, my: 300 },
      sleep: { hp: 6000, pool: 4500, my: 3000 },
    });
    expect(j.pct).toBeCloseTo(((0.703 + 0.5 + 0.75) / 3) * 100, 1);
    expect(j.my_pct).toBeCloseTo(((0.1 + 0.3 + 0.5) / 3) * 100, 1);   // 30%
    expect(j.top.map((t: any) => t.alias)).toEqual(['Richie', 'RenDIESEL', 'Kestrel', 'Sleeper', 'Lowly']);
    expect(j.top[0]).toMatchObject({ me: true, steps: 10000, flights: 300, sleep: 3000 });
    expect(j.my_rank).toBe(1);
    expect(j.wall.map((w: any) => w.alias)).toEqual(['Richie', 'RenDIESEL', 'Kestrel', 'Sleeper']);   // Lowly: 0.1%
    expect(j.wall_count).toBe(4);
    expect(j.wall_pct).toBe(0.5);
    expect(j.drop_odds).toEqual({ s_tier: 0.01, mythic: 0.005 });
    expect(j.effort).toBe(true);
    expect(j.status).toBe('open');
    expect(j.claimable).toBe(false);
    expect(j.guild).toMatchObject({ hunters: 1, steps: 20000 });
    expect(j.hp).toBe(100000);   // an older build still reads a steps bar
  });
  it('steps alone never bring it down; all three spent does, and the kill freezes the MVPs by damage', async () => {
    vi.useFakeTimers(); vi.setSystemTime(WED);
    const st = fresh();
    st.merged[1].steps = 200000;   // the steps bar is spent twice over
    expect((await get(st)).status).toBe('open');
    st.effort.push({ user_id: 'u-ren', alias: 'RenDIESEL', flights: 500, sleep_min: 1500 });   // flights 1,000 · sleep 6,000
    const j = await get(st);
    expect(j.status).toBe('slain');
    const snap = JSON.parse(st.gate.kill_json as string);
    expect(snap.bars.hp).toEqual({ steps: 100000, flights: 1000, sleep: 6000 });
    expect(snap.mvps.map((m: any) => m.alias)).toEqual(['RenDIESEL', 'Richie', 'Kestrel']);   // Kestrel 9.6% beats the Sleeper's 8.3%
    expect(j.kill.mvps[0]).toMatchObject({ alias: 'RenDIESEL', flights: 500, sleep: 1500 });
    expect(j.kill.my_place).toBe(2);
    expect(j.kill.my_pct).toBeGreaterThan(0);
    expect(j.claimable).toBe(true);
  });
});

describe('W1283 — the bounty on a three-bar kill', () => {
  const slainState = async () => {
    vi.useFakeTimers(); vi.setSystemTime(WED);
    const st = fresh();
    st.merged[1].steps = 200000;
    st.effort.push({ user_id: 'u-ren', alias: 'RenDIESEL', flights: 500, sleep_min: 1500 });
    await get(st);
    expect(st.gate.status).toBe('slain');
    return st;
  };
  it('a hunter on the Kill Wall gets 200 souls (+ the MVP bonus) and the two relic rolls, once', async () => {
    const st = await slainState();
    const rolls = [0.005, 0.004];   // both hit: under 1%, under 0.5%
    const spy = vi.spyOn(wgDice, 'next').mockImplementation(() => rolls.shift() ?? 0.99);
    const a = (await (await claim(st)).json()) as Record<string, any>;
    expect(a).toMatchObject({ ok: true, first: true, bounty: WORLDGATE_SOULS, mvp_place: 2, mvp_bonus: 100, souls: 300, drops: ['s_tier', 'mythic'] });
    expect(st.claims.get('u-me')).toBe('s_tier,mythic');
    const again = (await (await claim(st)).json()) as Record<string, any>;
    expect(again).toMatchObject({ first: false, souls: 0, drops: [] });
    spy.mockRestore();
  });
  it('the rolls miss above their odds', async () => {
    const st = await slainState();
    const rolls = [0.01, 0.005];   // exactly at the odds: a miss
    const spy = vi.spyOn(wgDice, 'next').mockImplementation(() => rolls.shift() ?? 0.99);
    const a = (await (await claim(st)).json()) as Record<string, any>;
    expect(a.drops).toEqual([]);
    expect(a.bounty).toBe(WORLDGATE_SOULS);
    spy.mockRestore();
  });
  it('under 0.5% of the kill and off the podium: no bounty', async () => {
    const st = await slainState();
    const low: SessionPayload = { userId: 'u-low', alias: 'Lowly' } as SessionPayload;
    const r = await handleWorldgateClaim(new Request('https://x/v1/worldgate/claim', { method: 'POST' }), env3(st), low);
    expect(r.status).toBe(403);
    expect(((await r.json()) as any).detail).toMatch(/0\.5% of the kill/);
  });
});

describe('W1283 — POST /v1/worldgate/effort', () => {
  const post = async (st: St, body: unknown) => (await (await handleWorldgateEffort(new Request('https://x/v1/worldgate/effort', { method: 'POST', body: JSON.stringify(body) }), env3(st), me)).json()) as Record<string, any>;
  it('caps each day, counts only the days begun, never lowers a total', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-30T20:00:00Z'));   // Monday, Pacific: two days begun
    const st = fresh(); st.effort = [];
    const a = await post(st, { week: '2026-11-29', flights: [12, 90, 40, 40], sleep: [480, 700, 400] });
    expect(a).toMatchObject({ counted: true, flights: 12 + 50 + 40, sleep: 480 + 540 + 400 });   // Tuesday rides the east-of-Pacific day
    await post(st, { week: '2026-11-29', flights: [1], sleep: [1] });
    expect(st.effort[0]).toMatchObject({ flights: 102, sleep_min: 1420 });
  });
  it('another week, or a week before the three bars, is answered and ignored', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-30T20:00:00Z'));
    const st = fresh(); st.effort = [];
    expect(await post(st, { week: '2026-11-22', flights: [5], sleep: [5] })).toMatchObject({ ok: true, counted: false });
    vi.setSystemTime(new Date('2026-11-24T20:00:00Z'));   // the week of 2026-11-22: steps only
    expect(await post(st, { week: '2026-11-22', flights: [5], sleep: [5] })).toMatchObject({ ok: true, counted: false });
    expect(st.effort.length).toBe(0);
  });
});
