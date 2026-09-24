// lib/drops.test.js — regression tests for the relic drop engine (W992).
// Zero dependencies — run with `node lib/drops.test.js` (or `npm run test:unit`).
'use strict';
const assert = require('node:assert');
const D = require('./drops.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; console.error('  ✗ ' + name + '\n      ' + (e && e.message)); }
}
// deterministic rng: a sequence, then 0.999 forever (so every later roll misses)
const seq = (arr) => { let i = 0; return () => (i < arr.length ? arr[i++] : 0.999); };
// seeded LCG for the Monte-Carlo cases
const lcg = (seed) => { let s = seed >>> 0; return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 4294967296; }; };
const RANKS = ['E', 'D', 'C', 'B'];
const AVAIL_ALL = { mythic: 0, ultra_rare: 1, rare: 1, common: 3 };

// ── the rank tables ──
test('rank rates: ultra, rare and common each strictly decrease E→D→C→B', () => {
  for (const k of ['ultra_rare', 'rare', 'common']) {
    for (let i = 1; i < RANKS.length; i++) assert.ok(D.DROP_RATES_BY_RANK[RANKS[i]][k] < D.DROP_RATES_BY_RANK[RANKS[i - 1]][k], k + ' ' + RANKS[i]);
  }
});
test('rank rates: every rate in (0,1]; common_protected >= common', () => {
  for (const r of RANKS) {
    const t = D.DROP_RATES_BY_RANK[r];
    for (const k of ['ultra_rare', 'rare', 'common', 'common_protected']) assert.ok(t[k] > 0 && t[k] <= 1, r + ' ' + k);
    assert.ok(t.common_protected >= t.common, r);
  }
});
test('realized odds per rank sum to 1 and nothing rises E→D→C→B (8.2 < 15.6 < 23.2 < 37.6)', () => {
  let prev = -1;
  const expect = { E: 0.082, D: 0.156, C: 0.232, B: 0.376 };
  for (const r of RANKS) {
    const o = D.realizedOdds(D.DROP_RATES_BY_RANK[r]);
    assert.ok(Math.abs(o.ultra + o.rare + o.common + o.nothing - 1) < 1e-9, r + ' sums');
    assert.ok(o.nothing > prev, r + ' nothing rises');
    assert.ok(Math.abs(o.nothing - expect[r]) < 0.002, r + ' nothing ≈ ' + expect[r] + ' got ' + o.nothing.toFixed(4));
    prev = o.nothing;
  }
  const e = D.realizedOdds(D.DROP_RATES_BY_RANK.E);
  assert.ok(Math.abs(e.ultra - 0.12) < 1e-9 && Math.abs(e.rare - 0.2464) < 1e-6 && Math.abs(e.common - 0.5512) < 1e-3);
  // the old daily row, for the record: 5.0 / 7.9 / 40 / 40
  const old = D.realizedOdds(D.DROP_RATES_BY_CADENCE.daily);
  assert.ok(Math.abs(old.nothing - 0.40) < 0.001 && Math.abs(old.rare - 0.0792) < 0.001);
});
test('rank mercy: any/rare/soft/hard thresholds non-decreasing E→B, hard > soft, add/max sane', () => {
  for (let i = 1; i < RANKS.length; i++) {
    const a = D.DROP_PITY_BY_RANK[RANKS[i - 1]], b = D.DROP_PITY_BY_RANK[RANKS[i]];
    for (const k of ['any_drop_guarantee_after', 'rare_mercy_after', 'ultra_soft_pity_after', 'ultra_hard_pity_after']) assert.ok(b[k] >= a[k], k + ' ' + RANKS[i]);
  }
  for (const r of RANKS) {
    const p = D.DROP_PITY_BY_RANK[r];
    assert.ok(p.ultra_hard_pity_after > p.ultra_soft_pity_after, r);
    assert.ok(p.ultra_soft_pity_add > 0 && p.ultra_soft_pity_max > D.DROP_RATES_BY_RANK[r].ultra_rare && p.ultra_soft_pity_max <= 1, r);
  }
  assert.deepStrictEqual(D.DROP_PITY_BY_RANK.B, D.DROP_PITY_BY_CADENCE.daily);   // B = the old daily row
});
test('A/S mercy: A rare 8 + ultra 25, S ultra 30 only; no any-drop pity above B', () => {
  assert.strictEqual(D.DROP_PITY_BY_RANK.A.any_drop_guarantee_after, null);
  assert.strictEqual(D.DROP_PITY_BY_RANK.A.rare_mercy_after, 8);
  assert.strictEqual(D.DROP_PITY_BY_RANK.A.ultra_hard_pity_after, 25);
  assert.strictEqual(D.DROP_PITY_BY_RANK.S.any_drop_guarantee_after, null);
  assert.strictEqual(D.DROP_PITY_BY_RANK.S.rare_mercy_after, null);
  assert.strictEqual(D.DROP_PITY_BY_RANK.S.ultra_hard_pity_after, 30);
});
test('ratesFor: weekly cadence wins over rank (Gray Pilgrim keeps 0% nothing); unknown rank falls back to daily', () => {
  assert.strictEqual(D.ratesFor({ rank: 'C', cadence: 'weekly' }), D.DROP_RATES_BY_CADENCE.weekly);
  assert.strictEqual(D.ratesFor({ rank: 'E', cadence: 'daily' }), D.DROP_RATES_BY_RANK.E);
  assert.strictEqual(D.ratesFor({ rank: 'A', cadence: 'daily' }), D.DROP_RATES_BY_CADENCE.daily);   // A has no rank row; its dropTable decides
  assert.strictEqual(D.ratesFor({ cadence: 'nope' }), D.DROP_RATES_BY_CADENCE.daily);
  assert.strictEqual(D.ratesFor({}), D.DROP_RATES_BY_CADENCE.daily);
});
test('pityFor mirrors ratesFor precedence and reaches A/S', () => {
  assert.strictEqual(D.pityFor({ rank: 'C', cadence: 'weekly' }), D.DROP_PITY_BY_CADENCE.weekly);
  assert.strictEqual(D.pityFor({ rank: 'B' }), D.DROP_PITY_BY_RANK.B);
  assert.strictEqual(D.pityFor({ rank: 'A' }), D.DROP_PITY_BY_RANK.A);
  assert.strictEqual(D.pityFor({ rank: 'S' }), D.DROP_PITY_BY_RANK.S);
  assert.strictEqual(D.pityFor({ cadence: 'daily' }), D.DROP_PITY_BY_CADENCE.daily);
});

// ── resolveRoll, Path A ──
test('resolveRoll sequential: first-hit-wins order and luck cap 1.25', () => {
  const rates = D.DROP_RATES_BY_RANK.E, pity = D.DROP_PITY_BY_RANK.E;
  const base = { rates, pity, state: D.freshState(), hasFirstCommon: true, avail: AVAIL_ALL };
  assert.strictEqual(D.resolveRoll(Object.assign({}, base, { rng: seq([0.11]) })).rarity, 'ultra_rare');
  assert.strictEqual(D.resolveRoll(Object.assign({}, base, { rng: seq([0.13, 0.27]) })).rarity, 'rare');
  assert.strictEqual(D.resolveRoll(Object.assign({}, base, { rng: seq([0.13, 0.29, 0.86]) })).rarity, 'common');
  assert.strictEqual(D.resolveRoll(Object.assign({}, base, { rng: seq([0.13, 0.29, 0.88]) })).rarity, null);
  // luck 2.0 is capped at 1.25: ultra threshold becomes 0.15, not 0.24
  assert.strictEqual(D.resolveRoll(Object.assign({}, base, { luck: 2.0, rng: seq([0.149]) })).rarity, 'ultra_rare');
  assert.strictEqual(D.resolveRoll(Object.assign({}, base, { luck: 2.0, rng: seq([0.151, 0.9, 0.9]) })).rarity, 'common');   // luck also lifts common to min(1, .87×1.25) = 1
  // an empty ultra pool cannot drop an ultra
  assert.strictEqual(D.resolveRoll(Object.assign({}, base, { avail: { ultra_rare: 0, rare: 1, common: 1 }, rng: seq([0.01, 0.9, 0.9]) })).rarity, null);
});
test('resolveRoll: rare mercy fires on the Nth kill and never downgrades an ultra', () => {
  const rates = D.DROP_RATES_BY_RANK.E, pity = D.DROP_PITY_BY_RANK.E;   // rare mercy 5
  const state = Object.assign(D.freshState(), { kills_since_rare_or_better: 4 });
  const o = D.resolveRoll({ rates, pity, state, hasFirstCommon: true, avail: AVAIL_ALL, rng: seq([0.9, 0.9, 0.9]) });
  assert.deepStrictEqual([o.rarity, o.fromPity, o.pityType], ['rare', true, 'rare_mercy']);
  const c = D.resolveRoll({ rates, pity, state, hasFirstCommon: true, avail: AVAIL_ALL, rng: seq([0.9, 0.9, 0.1]) });   // a common is upgraded
  assert.strictEqual(c.rarity, 'rare');
  const u = D.resolveRoll({ rates, pity, state, hasFirstCommon: true, avail: AVAIL_ALL, rng: seq([0.01]) });   // an ultra is kept
  assert.strictEqual(u.rarity, 'ultra_rare'); assert.strictEqual(u.fromPity, false);
  const early = D.resolveRoll({ rates, pity, state: Object.assign(D.freshState(), { kills_since_rare_or_better: 3 }), hasFirstCommon: true, avail: AVAIL_ALL, rng: seq([0.9, 0.9, 0.9]) });
  assert.strictEqual(early.rarity, null);
});
test('resolveRoll: any-drop pity fires when counter+1 >= N and only if a pool is available', () => {
  const rates = D.DROP_RATES_BY_RANK.E, pity = D.DROP_PITY_BY_RANK.E;   // any-drop 2
  const miss = seq([0.9, 0.9, 0.9]);
  const o = D.resolveRoll({ rates, pity, state: Object.assign(D.freshState(), { kills_since_any_drop: 1 }), hasFirstCommon: true, avail: AVAIL_ALL, rng: miss });
  assert.deepStrictEqual([o.rarity, o.forceAny, o.pityType], [null, true, 'any_drop']);
  const none = D.resolveRoll({ rates, pity, state: Object.assign(D.freshState(), { kills_since_any_drop: 1 }), hasFirstCommon: true, avail: { common: 0, rare: 0, ultra_rare: 0 }, rng: seq([0.9, 0.9, 0.9]) });
  assert.strictEqual(none.forceAny, false);
  const fresh = D.resolveRoll({ rates, pity, state: D.freshState(), hasFirstCommon: true, avail: AVAIL_ALL, rng: seq([0.9, 0.9, 0.9]) });
  assert.strictEqual(fresh.forceAny, false);
});
test('resolveRoll: ultra soft pity lifts the rate from the soft floor; hard pity guarantees it', () => {
  const rates = D.DROP_RATES_BY_RANK.E, pity = D.DROP_PITY_BY_RANK.E;   // soft 8 (+0.04, cap .35), hard 15
  assert.strictEqual(D.effectiveUltraRate(pity, 7, 0.12), 0.12);
  assert.ok(Math.abs(D.effectiveUltraRate(pity, 8, 0.12) - 0.16) < 1e-9);
  assert.strictEqual(D.effectiveUltraRate(pity, 14, 0.12), 0.35);
  assert.strictEqual(D.effectiveUltraRate(pity, 15, 0.12), 1);
  const soft = D.resolveRoll({ rates, pity, state: Object.assign(D.freshState(), { kills_since_ultra: 8 }), hasFirstCommon: true, avail: AVAIL_ALL, rng: seq([0.15]) });
  assert.deepStrictEqual([soft.rarity, soft.pityType], ['ultra_rare', 'ultra_soft']);
  const hard = D.resolveRoll({ rates, pity, state: Object.assign(D.freshState(), { kills_since_ultra: 15 }), hasFirstCommon: true, avail: AVAIL_ALL, rng: seq([0.999]) });
  assert.deepStrictEqual([hard.rarity, hard.pityType], ['ultra_rare', 'ultra_hard']);
});

// ── resolveRoll, Path B (dropTable) ──
const A_TABLE = { ultra_rare: 0.08, rare: 0.25 };
const S_TABLE = { mythic: 0.01, ultra_rare: 0.30 };
test('resolveRoll dropTable (A): rare mercy at 8, ultra hard pity at 25, mythic never forced', () => {
  const pity = D.DROP_PITY_BY_RANK.A; const avail = { mythic: 0, ultra_rare: 3, rare: 2, common: 0 };
  assert.strictEqual(D.resolveRoll({ dropTable: A_TABLE, pity, state: D.freshState(), avail, rng: seq([0.05]) }).rarity, 'ultra_rare');
  assert.strictEqual(D.resolveRoll({ dropTable: A_TABLE, pity, state: D.freshState(), avail, rng: seq([0.20]) }).rarity, 'rare');
  assert.strictEqual(D.resolveRoll({ dropTable: A_TABLE, pity, state: D.freshState(), avail, rng: seq([0.50]) }).rarity, null);
  const rm = D.resolveRoll({ dropTable: A_TABLE, pity, state: Object.assign(D.freshState(), { kills_since_rare_or_better: 7 }), avail, rng: seq([0.50]) });
  assert.deepStrictEqual([rm.rarity, rm.pityType], ['rare', 'rare_mercy']);
  const uh = D.resolveRoll({ dropTable: A_TABLE, pity, state: Object.assign(D.freshState(), { kills_since_ultra: 25 }), avail, rng: seq([0.50]) });
  assert.deepStrictEqual([uh.rarity, uh.pityType], ['ultra_rare', 'ultra_hard']);
  const uh2 = D.resolveRoll({ dropTable: A_TABLE, pity, state: Object.assign(D.freshState(), { kills_since_ultra: 25 }), avail, rng: seq([0.20]) });   // a rare is upgraded
  assert.strictEqual(uh2.rarity, 'ultra_rare');
  const notYet = D.resolveRoll({ dropTable: A_TABLE, pity, state: Object.assign(D.freshState(), { kills_since_ultra: 24 }), avail, rng: seq([0.50]) });
  assert.strictEqual(notYet.rarity, null);
  // mythic is never produced by pity on a table without one
  for (let k = 0; k < 60; k++) assert.notStrictEqual(D.resolveRoll({ dropTable: A_TABLE, pity, state: Object.assign(D.freshState(), { kills_since_ultra: k, kills_since_rare_or_better: k }), avail, rng: seq([0.5]) }).rarity, 'mythic');
});
test('resolveRoll dropTable (S/Erebus): a rolled mythic is never downgraded; ultra hard pity at 30; no rare mercy', () => {
  const pity = D.DROP_PITY_BY_RANK.S; const avail = { mythic: 1, ultra_rare: 3, rare: 0, common: 0 };
  const my = D.resolveRoll({ dropTable: S_TABLE, pity, state: Object.assign(D.freshState(), { kills_since_ultra: 99 }), avail, rng: seq([0.005]) });
  assert.deepStrictEqual([my.rarity, my.fromPity], ['mythic', false]);
  assert.strictEqual(D.resolveRoll({ dropTable: S_TABLE, pity, state: Object.assign(D.freshState(), { kills_since_ultra: 29 }), avail, rng: seq([0.5]) }).rarity, null);
  const uh = D.resolveRoll({ dropTable: S_TABLE, pity, state: Object.assign(D.freshState(), { kills_since_ultra: 30 }), avail, rng: seq([0.5]) });
  assert.deepStrictEqual([uh.rarity, uh.pityType], ['ultra_rare', 'ultra_hard']);
  assert.strictEqual(D.resolveRoll({ dropTable: S_TABLE, pity, state: Object.assign(D.freshState(), { kills_since_rare_or_better: 50 }), avail: { mythic: 1, ultra_rare: 3, rare: 1, common: 0 }, rng: seq([0.5]) }).rarity, null);
  // luck scales mythic (W793.1): 1.04% band
  assert.strictEqual(D.resolveRoll({ dropTable: S_TABLE, pity, state: D.freshState(), avail, luck: 1.04, rng: seq([0.0103]) }).rarity, 'mythic');
  assert.strictEqual(D.resolveRoll({ dropTable: S_TABLE, pity, state: D.freshState(), avail, luck: 1, rng: seq([0.0103]) }).rarity, 'ultra_rare');
});
test('resolveRoll dropTable with pity=null (co-op): identical to the pure cumulative roll', () => {
  const avail = { mythic: 0, ultra_rare: 1, rare: 2, common: 0 };
  const t = { ultra_rare: 0.22, rare: 0.55 };
  for (const [r, exp] of [[0.10, 'ultra_rare'], [0.50, 'rare'], [0.80, null]]) {
    const o = D.resolveRoll({ dropTable: t, pity: null, state: Object.assign(D.freshState(), { kills_since_ultra: 999, kills_since_rare_or_better: 999, kills_since_any_drop: 999 }), avail, rng: seq([r]) });
    assert.strictEqual(o.rarity, exp, 'r=' + r); assert.strictEqual(o.fromPity, false);
  }
});

// ── state ──
test('advanceState matches the app counter rules (common/rare/ultra/mythic/null)', () => {
  const s = D.freshState();
  D.advanceState(s, null, 'x'); assert.deepStrictEqual([s.kills_since_any_drop, s.kills_since_ultra, s.kills_since_rare_or_better], [1, 1, 1]);
  D.advanceState(s, 'common', 'x'); assert.deepStrictEqual([s.kills_since_any_drop, s.kills_since_ultra, s.kills_since_rare_or_better], [0, 2, 2]);
  D.advanceState(s, 'rare', 'x'); assert.deepStrictEqual([s.kills_since_any_drop, s.kills_since_ultra, s.kills_since_rare_or_better], [0, 3, 0]);
  D.advanceState(s, 'ultra_rare', 'x'); assert.deepStrictEqual([s.kills_since_any_drop, s.kills_since_ultra, s.kills_since_rare_or_better], [0, 0, 0]);
  D.advanceState(s, null, 'x'); D.advanceState(s, 'mythic', 'x'); assert.deepStrictEqual([s.kills_since_any_drop, s.kills_since_ultra, s.kills_since_rare_or_better], [0, 0, 0]);
  assert.strictEqual(s.last_drop_at, 'x');
});
test('Monte-Carlo 100k E kills (seeded): ultra 12–16% (base 12% + soft pity), nothing <= 8.5%, never two empty kills in a row', () => {
  const rates = D.DROP_RATES_BY_RANK.E, pity = D.DROP_PITY_BY_RANK.E;
  const t = D.simulate({ rates, pity, avail: AVAIL_ALL, hasFirstCommon: true, rng: lcg(7) }, 100000);
  const n = 100000;
  assert.ok(t.ultra_rare / n >= 0.12 && t.ultra_rare / n < 0.16, 'ultra ' + (t.ultra_rare / n));   // soft pity from kill 8 lifts the base 12% to ≈15%
  assert.ok(t.no_drop / n <= 0.085, 'nothing ' + (t.no_drop / n));
  // any-drop 2: an empty kill is always followed by a drop
  let state = D.freshState(), rng = lcg(11), prevEmpty = false;
  for (let i = 0; i < 20000; i++) {
    const o = D.resolveRoll({ rates, pity, state, hasFirstCommon: true, avail: AVAIL_ALL, rng });
    const rar = o.rarity || (o.forceAny ? 'common' : null);
    if (prevEmpty) assert.ok(rar, 'two empty kills in a row at ' + i);
    prevEmpty = !rar; D.advanceState(state, rar, 's');
  }
});
test('Monte-Carlo A (seeded): pity fires and nothing stays near 67% minus mercy', () => {
  const t = D.simulate({ dropTable: A_TABLE, pity: D.DROP_PITY_BY_RANK.A, avail: { mythic: 0, ultra_rare: 3, rare: 2, common: 0 }, rng: lcg(3) }, 100000);
  assert.ok(t.pity_drops > 0);
  assert.ok(t.no_drop / 100000 < 0.67 && t.no_drop / 100000 > 0.55, 'nothing ' + (t.no_drop / 100000));
  const s = D.simulate({ dropTable: S_TABLE, pity: D.DROP_PITY_BY_RANK.S, avail: { mythic: 1, ultra_rare: 3, rare: 0, common: 0 }, rng: lcg(5) }, 100000);
  assert.ok(Math.abs(s.mythic / 100000 - 0.01) < 0.003, 'mythic stays 1%: ' + (s.mythic / 100000));
});

console.log('drops.js: ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
