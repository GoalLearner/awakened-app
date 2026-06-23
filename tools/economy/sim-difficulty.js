// tools/economy/sim-difficulty.js — W485 difficulty-aware custom compound, before vs after.
//
// The compound is ~90% of rank XP and was difficulty-BLIND, so an all-easy custom routine
// reached S+ about as fast as an all-legendary one ("rank rewards attendance, not effort").
// W485 scales the custom compound by the routine's average difficulty, REBALANCED around
// medium (3 pts -> 1.0x, unchanged): all-easy ~0.7x, all-legendary ~1.5x. This sim accrues
// rank XP day-by-day for a 10-habit custom routine at each uniform difficulty and reports
// days-to-S+ BEFORE (blind) vs AFTER (tilted), proving the spread widens while MEDIUM is
// unchanged (no pace inflation). Uses the SAME tested lib/economy.js factor the app uses.
//
// Run:  node tools/economy/sim-difficulty.js
'use strict';
const E = require('../../lib/economy.js');

const S_PLUS = 36000;                                   // RANKS S+ min (app.js)
const DIFFICULTY_PTS = { easy: 1, medium: 3, hard: 5, legendary: 10 };
const KNEE = E.DAILY_XP_SOFT_CAP_KNEE, OVER = E.DAILY_XP_OVER_CAP_RATE;

function morningCompoundXP(streak) {                    // byte-identical to app.js getCompoundXP('morning', …)
  if (typeof streak !== 'number' || streak <= 0) return 0;
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
function isWeekend(d) { const dow = (d - 1) % 7; return dow === 5 || dow === 6; }

// One 10-habit custom routine at a uniform difficulty, perfect consistency.
// `tilt` = apply the W485 difficulty factor (after) vs 1.0 (before).
function daysToSplus(diffName, tilt, maxDays) {
  const n = 10;
  const perHabit = DIFFICULTY_PTS[diffName];
  const avgPts = perHabit;                              // uniform routine -> avg == the tier's pts
  const sizeF = E.customCompoundSizeFactor(n);          // 1.0 at 10 habits
  const diffF = tilt ? E.customCompoundDifficultyFactor(avgPts) : 1;
  let total = 0;
  for (let day = 1; day <= maxDays; day++) {
    const w = isWeekend(day);
    total += E.pacedDailyXp(n * perHabit * (w ? 2 : 1), 0, KNEE, OVER);   // per-habit XP (always difficulty-aware)
    const comp = Math.round(morningCompoundXP(day) * sizeF * diffF);       // compound (W485-tilted when `tilt`)
    total += comp * (w ? 2 : 1);
    if (total >= S_PLUS) return day;
  }
  return Infinity;
}

const MAX = 4000;
const tiers = ['easy', 'medium', 'hard', 'legendary'];
const pad = (s, w) => String(s).padEnd(w);
const dd = (d) => (d === Infinity ? `>${MAX}` : `${d}d`);

console.log('\n=== W485 — days to S+ for a 10-habit custom routine, by difficulty ===\n');
console.log(pad('Routine (10 habits)', 22) + pad('factor', 9) + pad('BEFORE (blind)', 16) + pad('AFTER (W485)', 14) + 'Δ');
console.log('-'.repeat(70));
const rows = {};
for (const t of tiers) {
  const before = daysToSplus(t, false, MAX);
  const after  = daysToSplus(t, true,  MAX);
  rows[t] = { before, after, factor: E.customCompoundDifficultyFactor(DIFFICULTY_PTS[t]) };
  const delta = (before === Infinity || after === Infinity) ? '—'
    : (after < before ? `${before - after}d faster` : after > before ? `${after - before}d slower` : 'unchanged');
  console.log(pad('all ' + t, 22) + pad(rows[t].factor.toFixed(2) + 'x', 9) + pad(dd(before), 16) + pad(dd(after), 14) + delta);
}

console.log('\n=== Read ===');
console.log(`• MEDIUM is the pivot: ${dd(rows.medium.before)} -> ${dd(rows.medium.after)} (UNCHANGED — no pace inflation).`);
const eL = rows.legendary.after, eE = rows.easy.after;
console.log(`• AFTER spread easy->legendary: ${dd(eE)} vs ${dd(eL)}  =  ${(eE / eL).toFixed(2)}x.`);
const bL = rows.legendary.before, bE = rows.easy.before;
console.log(`• BEFORE spread (per-habit XP only, compound was blind): ${dd(bE)} vs ${dd(bL)}  =  ${(bE / bL).toFixed(2)}x.`);
console.log(`• REACHABLE TODAY: no library habit is 'legendary' (hardest = hard/5pts) and custom-created habits are pinned to medium,`);
console.log(`  so real routines span ~0.7x (easy-heavy library) to ~1.3x (all-hard library) ≈ ${(rows.easy.after / rows.hard.after).toFixed(2)}x; an all-custom routine = 1.0x. The legendary/1.5x rows are forward-looking headroom.`);
console.log(`• Effort now visibly changes the climb; consistency still dominates (the curve, streak spikes, and size cap are untouched).\n`);
