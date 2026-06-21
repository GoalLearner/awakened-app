#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────
// tools/sim-compound.js — proof harness for W459 graded compound credit.
//
// Replicates the EXACT app.js math and proves the two properties the owner
// required:
//   (1) MONOTONIC, no boundary dips — completing one more pack habit never
//       lowers the day's XP, checked at EVERY adjacent step incl. tier seams.
//   (2) A 100%-complete day nets IDENTICAL compound XP to the old behavior
//       (no regression for perfect users).
// Prints the per-completion XP table for a 16-habit pack so the curve is
// eyeball-able, and runs the assertions across many streaks (rounding seams)
// and weekday/weekend.
//   node tools/sim-compound.js
// ─────────────────────────────────────────────────────────────────────
'use strict';

// ── verbatim from app.js getCompoundXP ──
function getCompoundXP(packId, streak) {
  if (typeof streak !== 'number' || streak <= 0) return 0;
  if (packId === 'morning') {
    if (streak <= 6) return streak * 5;
    if (streak <= 13) return 50;
    if (streak <= 29) return 75;
    if (streak <= 89) return 150;
    if (streak === 90) return 300;
    if (streak <= 179) return 200;
    if (streak === 180) return 500;
    if (streak <= 364) return 250;
    if (streak === 365) return 1000;
    return 300;
  }
  if (packId === 'locked-in') {
    if (streak <= 6) { const ramp = [0, 8, 15, 23, 30, 38, 45]; return ramp[streak]; }
    if (streak <= 13) return 75;
    if (streak <= 29) return 112;
    if (streak <= 89) return 225;
    if (streak === 90) return 450;
    if (streak <= 179) return 300;
    if (streak === 180) return 750;
    if (streak === 365) return 1500;
    if (streak <= 364) return 375;
    return 450;
  }
  return 0;
}

// ── verbatim from app.js W459 ──
const COMPOUND_PARTIAL_TIERS = [
  { maxMissing: 3, factor: 0.50 },
  { maxMissing: 8, factor: 0.25 },
];
function compoundPartialFactor(missing) {
  if (missing <= 0) return 1;
  for (let i = 0; i < COMPOUND_PARTIAL_TIERS.length; i++) {
    if (missing <= COMPOUND_PARTIAL_TIERS[i].maxMissing) return COMPOUND_PARTIAL_TIERS[i].factor;
  }
  return 0;
}

// Cumulative compound XP credited at a given completion count — exactly what
// the app holds in compoundPartial.given as you complete habits (top-up to
// round(fullBonus*factor)), and the full bonus once the pack is complete.
function compoundCumulative(done, total, fullBonus) {
  const missing = total - done;
  if (missing <= 0) return fullBonus;               // full path pays the remainder up to fullBonus
  return Math.round(fullBonus * compoundPartialFactor(missing));
}
// Old behavior: all-or-nothing.
function compoundOld(done, total, fullBonus) {
  return (total - done <= 0) ? fullBonus : 0;
}

const PER_HABIT = 3; // illustrative per-habit XP (each real habit adds +1..+10 — always > 0)

// Verify both properties for one (pack,total,streak,weekend) case. Returns failures[].
function verify(packId, total, streak, weekend) {
  const fullBonus = getCompoundXP(packId, streak) * (weekend ? 2 : 1);
  const fails = [];
  let prevTotal = -1, prevCompound = -1;
  for (let done = 0; done <= total; done++) {
    const comp = compoundCumulative(done, total, fullBonus);
    const dayXP = done * PER_HABIT + comp;
    // (1a) compound component never decreases
    if (comp < prevCompound) fails.push(`compound DIP at done=${done} (${prevCompound}→${comp})`);
    // (1b) total day XP never decreases (the real guarantee)
    if (done > 0 && dayXP < prevTotal) fails.push(`TOTAL DIP at done=${done} (${prevTotal}→${dayXP})`);
    prevCompound = comp; prevTotal = dayXP;
  }
  // (2) full day identical to old
  const newFull = compoundCumulative(total, total, fullBonus);
  const oldFull = compoundOld(total, total, fullBonus);
  if (newFull !== oldFull) fails.push(`full-day NOT identical: new ${newFull} vs old ${oldFull}`);
  if (newFull !== fullBonus) fails.push(`full-day != fullBonus (${newFull} vs ${fullBonus})`);
  return fails;
}

// ── headline table: Locked-In (16 habits), streak 30, weekday ──
function printTable(packId, total, streak, weekend) {
  const fullBonus = getCompoundXP(packId, streak) * (weekend ? 2 : 1);
  console.log(`\n  ${packId} · ${total} habits · streak ${streak} · ${weekend ? 'WEEKEND ×2' : 'weekday'} · full bonus = ${fullBonus} XP`);
  console.log('  done  missing  tier   compound   Δcompound   +habit   dayXP   Δtotal   monotonic?');
  let prevComp = 0, prevTotal = 0;
  for (let done = 0; done <= total; done++) {
    const missing = total - done;
    const f = missing <= 0 ? 1 : compoundPartialFactor(missing);
    const comp = compoundCumulative(done, total, fullBonus);
    const dComp = comp - prevComp;
    const dayXP = done * PER_HABIT + comp;
    const dTot = done === 0 ? 0 : dayXP - prevTotal;
    const ok = (dComp >= 0 && (done === 0 || dTot >= 0)) ? 'ok' : '*** DIP ***';
    const tierLbl = missing <= 0 ? 'FULL' : (f * 100) + '%';
    console.log(
      '  ' + String(done).padStart(3) +
      String(missing).padStart(8) +
      tierLbl.padStart(7) +
      String(comp).padStart(10) +
      ('+' + dComp).padStart(11) +
      ('+' + (done === 0 ? 0 : PER_HABIT)).padStart(9) +
      String(dayXP).padStart(8) +
      ('+' + dTot).padStart(8) +
      '   ' + ok
    );
    prevComp = comp; prevTotal = dayXP;
  }
}

console.log('════════════════════════════════════════════════════════════════════');
console.log('  W459 GRADED COMPOUND CREDIT — proof harness');
console.log('  tiers: miss 1-3 → 50% · miss 4-8 → 25% · miss 9+ → 0% · miss 0 → 100%');
console.log('════════════════════════════════════════════════════════════════════');

printTable('locked-in', 16, 30, false);   // the representative curve the owner wanted

// ── assertion sweep across magnitudes (rounding seams) + weekday/weekend ──
const STREAKS = [1, 2, 3, 5, 6, 7, 13, 14, 29, 30, 89, 90, 179, 180, 364, 365, 400];
let totalFails = 0, cases = 0;
for (const pack of [['morning', 10], ['locked-in', 16]]) {
  for (const streak of STREAKS) {
    for (const weekend of [false, true]) {
      cases++;
      const fails = verify(pack[0], pack[1], streak, weekend);
      if (fails.length) { totalFails += fails.length; console.log(`\n  FAIL ${pack[0]} streak ${streak} ${weekend ? 'wknd' : 'week'}:`); fails.forEach(f => console.log('    - ' + f)); }
    }
  }
}

console.log('\n════════════════════════════════════════════════════════════════════');
console.log('  swept ' + cases + ' (pack × streak × weekend) cases:');
console.log('  • monotonic (no compound dip, no total dip at any step/seam)');
console.log('  • 100% day === old full bonus (perfect users unchanged)');
console.log('  RESULT: ' + (totalFails === 0 ? 'ALL PASS ✓' : totalFails + ' FAILURES ✗'));
console.log('════════════════════════════════════════════════════════════════════\n');
process.exit(totalFails === 0 ? 0 : 1);
