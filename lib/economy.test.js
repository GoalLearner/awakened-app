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

console.log('economy.js: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
