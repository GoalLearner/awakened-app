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
import { describe, it, expect } from 'vitest';
import { computeGateHp } from './worldgate';

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
