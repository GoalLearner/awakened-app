// lib/economy.test.js — regression tests for the pure economy math (W471).
// Zero dependencies — run with `node lib/economy.test.js` (or `npm run test:unit`).
// Locks in the CURRENT behavior of the XP/rank/compound/soft-cap math so future
// economy tuning can't silently regress it.
'use strict';
const assert = require('node:assert');
const E = require('./economy.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; console.error('  ✗ ' + name + '\n      ' + (e && e.message)); }
}

// ── xpToNextLevel ──────────────────────────────────────────────
test('xpToNextLevel table values L1..L19', () => {
  const t = [5,15,30,50,75,105,140,180,225,275,330,390,455,525,600,680,765,855,950];
  for (let l = 1; l <= 19; l++) assert.strictEqual(E.xpToNextLevel(l), t[l-1]);
});
test('xpToNextLevel is 0 at the cap and for invalid levels', () => {
  assert.strictEqual(E.xpToNextLevel(20), 0);
  assert.strictEqual(E.xpToNextLevel(0), 0);
  assert.strictEqual(E.xpToNextLevel(-1), 0);
  assert.strictEqual(E.xpToNextLevel(99), 0);
});
test('xpToNextLevel strictly increases L1..L19', () => {
  for (let l = 1; l < 19; l++) assert.ok(E.xpToNextLevel(l+1) > E.xpToNextLevel(l));
});

// ── xpForLevel ─────────────────────────────────────────────────
test('xpForLevel cumulative values', () => {
  assert.strictEqual(E.xpForLevel(1), 0);
  assert.strictEqual(E.xpForLevel(2), 5);
  assert.strictEqual(E.xpForLevel(3), 20);
  assert.strictEqual(E.xpForLevel(20), 6650);
  assert.strictEqual(E.xpForLevel(20), E.MAX_STAT_XP);
});
test('xpForLevel clamps beyond the cap (L99 == L20)', () => {
  assert.strictEqual(E.xpForLevel(99), E.xpForLevel(20));
});

// ── statLevel ──────────────────────────────────────────────────
test('statLevel floors at 1', () => {
  assert.strictEqual(E.statLevel(0), 1);
  assert.strictEqual(E.statLevel(-5), 1);
  assert.strictEqual(E.statLevel(null), 1);
  assert.strictEqual(E.statLevel(undefined), 1);
  assert.strictEqual(E.statLevel(4), 1);
});
test('statLevel boundaries', () => {
  assert.strictEqual(E.statLevel(5), 2);
  assert.strictEqual(E.statLevel(19), 2);
  assert.strictEqual(E.statLevel(20), 3);
  assert.strictEqual(E.statLevel(6650), 20);
  assert.strictEqual(E.statLevel(999999), 20);
});
test('statLevel is the inverse of xpForLevel at thresholds', () => {
  for (let lv = 1; lv <= 20; lv++) assert.strictEqual(E.statLevel(E.xpForLevel(lv)), lv);
});
test('statLevel is monotonically non-decreasing', () => {
  let prev = 0;
  for (let xp = 0; xp <= 7000; xp += 50) { const lv = E.statLevel(xp); assert.ok(lv >= prev); prev = lv; }
});

// ── compoundPartialFactor (W459) ───────────────────────────────
test('compoundPartialFactor tiers', () => {
  assert.strictEqual(E.compoundPartialFactor(0), 1);
  assert.strictEqual(E.compoundPartialFactor(-2), 1);
  assert.strictEqual(E.compoundPartialFactor(1), 0.5);
  assert.strictEqual(E.compoundPartialFactor(3), 0.5);
  assert.strictEqual(E.compoundPartialFactor(4), 0.25);
  assert.strictEqual(E.compoundPartialFactor(8), 0.25);
  assert.strictEqual(E.compoundPartialFactor(9), 0);
  assert.strictEqual(E.compoundPartialFactor(99), 0);
});
test('compoundPartialFactor is non-increasing in missing count', () => {
  let prev = 1;
  for (let m = 0; m <= 20; m++) { const f = E.compoundPartialFactor(m); assert.ok(f <= prev); prev = f; }
});

// ── pacedDailyXp (W461 soft-cap core) ──────────────────────────
test('pacedDailyXp gives full credit below the knee', () => {
  assert.strictEqual(E.pacedDailyXp(100, 0), 100);
  assert.strictEqual(E.pacedDailyXp(200, 500), 200);
  assert.strictEqual(E.pacedDailyXp(50, 700), 50); // lands exactly on 750
});
test('pacedDailyXp gives half credit fully above the knee', () => {
  assert.strictEqual(E.pacedDailyXp(100, 750), 50);
  assert.strictEqual(E.pacedDailyXp(200, 800), 100);
});
test('pacedDailyXp straddling the knee blends full + overage', () => {
  assert.strictEqual(E.pacedDailyXp(100, 700), 75); // 50 full + 50*0.5
});
test('pacedDailyXp honors custom knee/overRate', () => {
  assert.strictEqual(E.pacedDailyXp(100, 900, 1000, 0.5), 100);
  assert.strictEqual(E.pacedDailyXp(100, 1000, 1000, 0.5), 50);
  assert.strictEqual(E.pacedDailyXp(100, 750, 750, 0.25), 25);
});
test('pacedDailyXp passes non-positive raw through (matches creditDailyXP)', () => {
  assert.strictEqual(E.pacedDailyXp(0, 0), 0);
  assert.strictEqual(E.pacedDailyXp(-3, 100), -3);
});
test('pacedDailyXp matches the original creditDailyXP math across a day', () => {
  function ref(raw, before) {
    if (!(raw > 0)) return raw || 0;
    const after = before + raw, KNEE = 750;
    const full = Math.max(0, Math.min(after, KNEE) - Math.min(before, KNEE));
    const over = Math.max(0, after - Math.max(before, KNEE));
    return Math.round(full + over * 0.5);
  }
  let before = 0;
  for (const raw of [120, 300, 250, 400, 90, 600]) {
    assert.strictEqual(E.pacedDailyXp(raw, before), ref(raw, before));
    before += raw;
  }
});

// ── customCompoundSizeFactor (W479) ────────────────────────────
test('customCompoundSizeFactor scales linearly to the full-size cap', () => {
  assert.strictEqual(E.customCompoundSizeFactor(10), 1);    // full Morning rate at 10 habits
  assert.strictEqual(E.customCompoundSizeFactor(5), 0.5);
  assert.strictEqual(E.customCompoundSizeFactor(3), 0.3);
  assert.strictEqual(E.customCompoundSizeFactor(1), 0.1);
});
test('customCompoundSizeFactor caps at 1.0 (custom never beats Morning)', () => {
  assert.strictEqual(E.customCompoundSizeFactor(11), 1);
  assert.strictEqual(E.customCompoundSizeFactor(16), 1);    // a 16-habit custom routine ≤ Morning rate, < Locked-In
  assert.strictEqual(E.customCompoundSizeFactor(999), 1);
});
test('customCompoundSizeFactor is 0 for non-positive / invalid size', () => {
  assert.strictEqual(E.customCompoundSizeFactor(0), 0);
  assert.strictEqual(E.customCompoundSizeFactor(-4), 0);
  assert.strictEqual(E.customCompoundSizeFactor(null), 0);
  assert.strictEqual(E.customCompoundSizeFactor(undefined), 0);
});
test('customCompoundSizeFactor is non-decreasing in size', () => {
  let prev = -1;
  for (let s = 0; s <= 20; s++) { const f = E.customCompoundSizeFactor(s); assert.ok(f >= prev); prev = f; }
});

// ── customCompoundPartialFactor (W479) ─────────────────────────
test('customCompoundPartialFactor full credit when routine complete', () => {
  assert.strictEqual(E.customCompoundPartialFactor(5, 5), 1);
  assert.strictEqual(E.customCompoundPartialFactor(10, 10), 1);
  assert.strictEqual(E.customCompoundPartialFactor(6, 5), 1); // done > size clamps to full
});
test('customCompoundPartialFactor fraction tiers (2/3 → .5, 1/3 → .25)', () => {
  // 3-habit routine
  assert.strictEqual(E.customCompoundPartialFactor(1, 3), 0.25); // 1/3
  assert.strictEqual(E.customCompoundPartialFactor(2, 3), 0.5);  // 2/3
  // 10-habit routine
  assert.strictEqual(E.customCompoundPartialFactor(7, 10), 0.5); // 0.7 ≥ 2/3
  assert.strictEqual(E.customCompoundPartialFactor(4, 10), 0.25);// 0.4 ≥ 1/3
  assert.strictEqual(E.customCompoundPartialFactor(3, 10), 0);   // 0.3 < 1/3 → no credit yet
});
test('customCompoundPartialFactor pays zero below 1/3 done and for invalid input', () => {
  assert.strictEqual(E.customCompoundPartialFactor(1, 10), 0);
  assert.strictEqual(E.customCompoundPartialFactor(0, 5), 0);
  assert.strictEqual(E.customCompoundPartialFactor(3, 0), 0);
  assert.strictEqual(E.customCompoundPartialFactor(2, -1), 0);
});
test('customCompoundPartialFactor is non-decreasing in done (no cliff; W459 parity)', () => {
  for (const size of [3, 4, 5, 8, 10, 12, 16]) {
    let prev = -1;
    for (let done = 0; done <= size; done++) {
      const f = E.customCompoundPartialFactor(done, size);
      assert.ok(f >= prev, `size=${size} done=${done} f=${f} < prev=${prev}`);
      prev = f;
    }
  }
});

// ── customCompoundDifficultyFactor (W485) ──────────────────────
test('customCompoundDifficultyFactor pivots at medium (3 pts -> 1.0x, unchanged)', () => {
  assert.strictEqual(E.customCompoundDifficultyFactor(3), 1);
});
test('customCompoundDifficultyFactor: easy ~0.7x, hard ~1.3x (rebalance both ways)', () => {
  assert.ok(Math.abs(E.customCompoundDifficultyFactor(1) - 0.7) < 1e-9, 'easy(1)=0.7');   // 1 + .15*(1-3) = 0.70
  assert.ok(Math.abs(E.customCompoundDifficultyFactor(2) - 0.85) < 1e-9, 'avg2=0.85');    // 1 + .15*(-1)
  assert.ok(Math.abs(E.customCompoundDifficultyFactor(5) - 1.3) < 1e-9, 'hard(5)=1.3');   // 1 + .15*2
});
test('customCompoundDifficultyFactor clamps to [0.7, 1.5]', () => {
  assert.strictEqual(E.customCompoundDifficultyFactor(10), 1.5);  // 1 + .15*7 = 2.05 -> clamp 1.5
  assert.strictEqual(E.customCompoundDifficultyFactor(99), 1.5);
  assert.strictEqual(E.customCompoundDifficultyFactor(0.5), 0.7); // 1 + .15*(-2.5) = 0.625 -> clamp 0.7
});
test('customCompoundDifficultyFactor is neutral (1.0) for zero/invalid avgPts', () => {
  assert.strictEqual(E.customCompoundDifficultyFactor(0), 1);
  assert.strictEqual(E.customCompoundDifficultyFactor(-4), 1);
  assert.strictEqual(E.customCompoundDifficultyFactor(null), 1);
  assert.strictEqual(E.customCompoundDifficultyFactor(undefined), 1);
});
test('customCompoundDifficultyFactor is non-decreasing in avgPts over its domain (>=1)', () => {
  let prev = -1;
  for (let p = 1; p <= 15; p += 0.25) { const f = E.customCompoundDifficultyFactor(p); assert.ok(f >= prev, `p=${p} f=${f} < ${prev}`); prev = f; }
});

console.log('economy.js: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
