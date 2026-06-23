// tools/economy/sim-twotier.js — W479 two-tier economy gap, before vs after.
//
// The audit's #2 flaw: "pack users reach S+ in ~weeks, custom-path users in
// years (~30x gap)." Pack users earn the daily Compound Effect; a user who
// builds their OWN routine matched no preset pack and earned ZERO compound.
// W479 pays custom routines a daily compound on the SAME Morning curve, scaled
// by routine size (full Morning rate at 10+ habits, capped there).
//
// This sim accrues RANK XP day-by-day for a consistently-completing hunter under
// three economies and reports days-to-each-rank, proving the gap closes for
// equivalent effort while staying proportional (fewer habits => proportionally
// less) and never beating the curated packs. Uses the SAME tested economy math
// (lib/economy.js) the app uses, so the numbers are the app's, not a re-derivation.
//
// Run:  node tools/economy/sim-twotier.js
'use strict';
const E = require('../../lib/economy.js');

// ── App constants (mirrored exactly from app.js) ───────────────────────────
const RANKS = [
  { id: 'E',  min: 0 },     { id: 'D',  min: 100 },   { id: 'C',  min: 600 },
  { id: 'B',  min: 3000 },  { id: 'A',  min: 7000 },  { id: 'S',  min: 12000 },
  { id: 'S+', min: 36000 },
];
const DIFFICULTY_PTS = { easy: 1, medium: 3, hard: 5, legendary: 10 };
const KNEE = E.DAILY_XP_SOFT_CAP_KNEE, OVER = E.DAILY_XP_OVER_CAP_RATE;

// getCompoundXP('morning', streak) — byte-identical copy of the app.js Morning curve.
function morningCompoundXP(streak) {
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

// Day d (1-based) starting on a Monday → is it a weekend (Sat/Sun)?
function isWeekend(d) { const dow = (d - 1) % 7; return dow === 5 || dow === 6; }

// ── One profile: N habits of a given difficulty, optionally earning a compound.
// compoundMode: 'none' (pre-fix custom), 'morning' (preset pack), 'custom' (W479).
function simulate(habitCount, difficulty, compoundMode, maxDays) {
  const perHabit = DIFFICULTY_PTS[difficulty];
  const sizeFactor = E.customCompoundSizeFactor(habitCount); // W479 scaling (capped at 1.0)
  let total = 0;                 // cumulative rank XP (== totalPoints)
  const reached = {};            // rankId → first day reached
  for (let day = 1; day <= maxDays; day++) {
    const wknd = isWeekend(day);
    // Per-habit XP, passed through the daily soft-cap (compound is exempt).
    const rawHabit = habitCount * perHabit * (wknd ? 2 : 1);
    total += E.pacedDailyXp(rawHabit, 0, KNEE, OVER); // priorCredited=0: a fresh day ledger each day
    // Compound (exempt from the cap), streak == day for perfect consistency.
    let compound = 0;
    if (compoundMode === 'morning') compound = morningCompoundXP(day);
    else if (compoundMode === 'custom') compound = Math.round(morningCompoundXP(day) * sizeFactor);
    total += compound * (wknd ? 2 : 1);
    for (const r of RANKS) if (reached[r.id] === undefined && total >= r.min) reached[r.id] = day;
  }
  return { habitCount, difficulty, compoundMode, sizeFactor, reached, finalXP: total };
}

const MAX = 1500;
const profiles = [
  { key: 'pack10',        label: 'Pack user — Morning Routine (10 habits)',     n: 10, diff: 'medium', mode: 'morning' },
  { key: 'custom10_before', label: 'Custom 10 habits — BEFORE (no compound)',   n: 10, diff: 'medium', mode: 'none'    },
  { key: 'custom10_after',  label: 'Custom 10 habits — AFTER (W479)',           n: 10, diff: 'medium', mode: 'custom'  },
  { key: 'custom5_before',  label: 'Custom 5 habits — BEFORE (no compound)',    n: 5,  diff: 'medium', mode: 'none'    },
  { key: 'custom5_after',   label: 'Custom 5 habits — AFTER (W479)',            n: 5,  diff: 'medium', mode: 'custom'  },
];

const results = {};
for (const p of profiles) results[p.key] = { ...p, ...simulate(p.n, p.diff, p.mode, MAX) };

// ── Report ─────────────────────────────────────────────────────────────────
const cols = ['B', 'A', 'S', 'S+'];
function dd(r, rank) { const d = results[r].reached[rank]; return d === undefined ? `>${MAX}` : `${d}d`; }
const pad = (s, w) => String(s).padEnd(w);

console.log('\n=== W479 — Two-tier economy: days to reach each rank (perfect consistency) ===\n');
console.log(pad('Profile', 44) + cols.map(c => pad(c, 8)).join('') + 'XP@' + MAX + 'd');
console.log('-'.repeat(44 + cols.length * 8 + 10));
for (const p of profiles) {
  console.log(pad(p.label, 44) + cols.map(c => pad(dd(p.key, c), 8)).join('') + results[p.key].finalXP.toLocaleString());
}

function gapX(beforeKey, afterKey, packKey, rank) {
  const b = results[beforeKey].reached[rank] || MAX + 1;
  const a = results[afterKey].reached[rank] || MAX + 1;
  const pk = results[packKey].reached[rank] || MAX + 1;
  return { beforeVsPack: (b / pk).toFixed(1), afterVsPack: (a / pk).toFixed(1) };
}
console.log('\n=== Gap to the pack user at S+ (lower = fairer; 1.0 = parity) ===');
const g10 = gapX('custom10_before', 'custom10_after', 'pack10', 'S+');
const g5  = gapX('custom5_before',  'custom5_after',  'pack10', 'S+');
console.log(`  10-habit custom:  before ${g10.beforeVsPack}x slower than pack  ->  after ${g10.afterVsPack}x  (target ~1.0, equivalent effort)`);
console.log(`   5-habit custom:  before ${g5.beforeVsPack}x slower than pack  ->  after ${g5.afterVsPack}x  (half the habits => ~proportional, fair)`);

// Daily-XP curve at representative streak days, for the chart.
const curveDays = [];
for (let d = 1; d <= 365; d++) curveDays.push(d);
const seriesFor = (n, mode) => curveDays.map(d => {
  const wknd = isWeekend(d);
  const ph = E.pacedDailyXp(n * DIFFICULTY_PTS.medium * (wknd ? 2 : 1), 0, KNEE, OVER);
  let comp = 0;
  if (mode === 'morning') comp = morningCompoundXP(d);
  else if (mode === 'custom') comp = Math.round(morningCompoundXP(d) * E.customCompoundSizeFactor(n));
  return ph + comp * (wknd ? 2 : 1);
});
const out = {
  maxDays: MAX,
  ranks: RANKS,
  profiles: profiles.map(p => ({ key: p.key, label: p.label, reached: results[p.key].reached, finalXP: results[p.key].finalXP })),
  cumulative: profiles.reduce((acc, p) => {
    // cumulative XP per day for the chart
    let t = 0; const arr = [];
    for (let d = 1; d <= MAX; d++) {
      const wknd = isWeekend(d);
      t += E.pacedDailyXp(p.n * DIFFICULTY_PTS[p.diff] * (wknd ? 2 : 1), 0, KNEE, OVER);
      let comp = 0;
      if (p.mode === 'morning') comp = morningCompoundXP(d);
      else if (p.mode === 'custom') comp = Math.round(morningCompoundXP(d) * E.customCompoundSizeFactor(p.n));
      t += comp * (wknd ? 2 : 1);
      arr.push(t);
    }
    acc[p.key] = arr; return acc;
  }, {}),
};
require('fs').writeFileSync(__dirname + '/sim-twotier.json', JSON.stringify(out));
console.log('\nWrote ' + __dirname + '/sim-twotier.json  (feed to chart.py)\n');
