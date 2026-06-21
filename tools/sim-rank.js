#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────
// tools/sim-rank.js — Rank-curve / XP-pacing simulator
//
// Answers: "How many days of consistent use does it take to reach each
// rank?" under a given threshold curve and a given player profile — and
// how a DAILY RANK-XP SOFT CAP changes that.
//
// It day-by-day simulates rank XP using the REAL earn model from app.js:
//   • per-habit XP   = diffPts (easy 1 / medium 3 / hard 5 / legendary 10),
//                      DOUBLED on weekends (Sat/Sun).
//   • compound packs = getCompoundXP('morning'|'locked-in', streak) — the
//                      streak-scaled "Compound Effect" bonus, also ×2 wknd.
// (One-time stat-threshold + achievement bonuses are omitted — they're
//  small and non-recurring; this sim is for the recurring pacing.)
//
// The SOFT CAP models "rank rewards consistency over volume": it caps the
// PER-HABIT (volume) portion of daily rank XP; compound/streak bonuses
// (the consistency reward) always count in full.
//
// Usage:
//   node tools/sim-rank.js                 # full comparison report
//   node tools/sim-rank.js --cap 80        # override soft-cap full-credit
//   node tools/sim-rank.js --tail 0.25     # override over-cap credit frac
// ─────────────────────────────────────────────────────────────────────
'use strict';

// ── Curves (totalPoints thresholds to ENTER each rank) ───────────────
const CURVES = {
  // Current live curve (post-w153). See app.js RANKS.
  OLD: { E: 0, D: 100, C: 600, B: 3000, A: 12000, S: 40000, 'S+': 100000 },
  // Proposed faster curve — NON-DEMOTING (every threshold <= OLD), so no
  // existing user can drop a rank. Only A/S/S+ lowered; the already-fast
  // early game (D/C/B) is left exactly as-is.
  NEW: { E: 0, D: 100, C: 600, B: 3000, A: 7000, S: 12000, 'S+': 36000 },
};
const RANK_ORDER = ['E', 'D', 'C', 'B', 'A', 'S', 'S+'];

// ── Soft cap (per-habit volume portion only) ─────────────────────────
const argv = process.argv.slice(2);
function argNum(flag, dflt) {
  const i = argv.indexOf(flag);
  return (i >= 0 && argv[i + 1] != null) ? Number(argv[i + 1]) : dflt;
}
const CAP_FULL = argNum('--cap', 100);   // first N per-habit XP/day at full credit
const CAP_TAIL = argNum('--tail', 0.25); // credit fraction beyond the cap

// ── Real compound-XP model (verbatim from app.js getCompoundXP) ──────
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

// Day index 0 = a Monday. Weekend = Sat(5)/Sun(6).
function isWeekend(day) { const d = day % 7; return d === 5 || d === 6; }

// ── Player profiles ──────────────────────────────────────────────────
// avgPts = average difficulty pts per habit (3 = "medium").
// packs  = which compound packs they keep daily (streak == active day).
// consistency = fraction of days active (1 = perfect; <1 breaks streaks).
const PROFILES = [
  { name: 'Light casual  (5 habits, no packs)',        habits: 5,  avgPts: 2.5, packs: [],                      consistency: 1 },
  { name: 'Target user   (12 habits, both packs)',     habits: 12, avgPts: 3,   packs: ['morning', 'locked-in'], consistency: 1 },
  { name: 'Power grinder (30 habits, both packs)',     habits: 30, avgPts: 3.5, packs: ['morning', 'locked-in'], consistency: 1 },
];

// Per-day rank XP for a profile. Returns { habitXp, compoundXp }.
function dayXp(profile, day, streak) {
  const wk = isWeekend(day) ? 2 : 1;
  const habitXp = profile.habits * profile.avgPts * wk;
  let compoundXp = 0;
  for (const p of profile.packs) compoundXp += getCompoundXP(p, streak) * wk;
  return { habitXp, compoundXp };
}

// Apply the soft cap to the per-habit (volume) portion only.
function capHabitXp(habitXp) {
  if (habitXp <= CAP_FULL) return habitXp;
  return CAP_FULL + (habitXp - CAP_FULL) * CAP_TAIL;
}

// capMode: 'none'  = no cap
//          'habit' = cap only the per-habit (volume) portion; compounds full
//          'all'   = cap TOTAL daily rank XP (compounds included) → rank≈days
function capAll(totalDayXp) {
  if (totalDayXp <= CAP_FULL) return totalDayXp;
  return CAP_FULL + (totalDayXp - CAP_FULL) * CAP_TAIL;
}

// Simulate until S+ reached or maxDays. Returns { reachDay: {rank: day} }.
function simulate(profile, curve, capMode, maxDays = 2000) {
  let xp = 0, streak = 0;
  const reach = {};
  // record rank reached at xp=0 (E)
  for (let day = 0; day < maxDays; day++) {
    const active = profile.consistency >= 1 || (day % Math.round(1 / (1 - profile.consistency + 1e-9))) !== 0;
    if (active) {
      streak += 1;
      const { habitXp, compoundXp } = dayXp(profile, day, streak);
      let credited;
      if (capMode === 'all')        credited = capAll(habitXp + compoundXp);
      else if (capMode === 'habit') credited = capHabitXp(habitXp) + compoundXp;
      else                          credited = habitXp + compoundXp;
      xp += credited;
    } else {
      streak = 0; // missed day breaks compound streak
    }
    // record any newly-crossed thresholds
    for (const r of RANK_ORDER) {
      if (reach[r] == null && xp >= curve[r]) reach[r] = day + 1;
    }
    if (reach['S+'] != null) break;
  }
  return reach;
}

function fmtDays(d) {
  if (d == null) return '  —  ';
  if (d < 100) return d + 'd';
  const mo = (d / 30.4).toFixed(1);
  return d + 'd (' + mo + 'mo)';
}

// ── Report ────────────────────────────────────────────────────────────
console.log('');
console.log('════════════════════════════════════════════════════════════════════');
console.log('  RANK PACING SIMULATOR — days of consistent use to reach each rank');
console.log('  soft cap: first ' + CAP_FULL + ' per-habit XP/day full, ' +
            (CAP_TAIL * 100) + '% beyond  (compounds always full)');
console.log('════════════════════════════════════════════════════════════════════');

console.log('\nThresholds:');
console.log('  OLD:  ' + RANK_ORDER.map(r => r + ' ' + CURVES.OLD[r]).join('  '));
console.log('  NEW:  ' + RANK_ORDER.map(r => r + ' ' + CURVES.NEW[r]).join('  '));

for (const profile of PROFILES) {
  console.log('\n────────────────────────────────────────────────────────────────────');
  console.log('  ' + profile.name);
  console.log('────────────────────────────────────────────────────────────────────');
  const variants = [
    ['OLD curve              ', simulate(profile, CURVES.OLD, 'none')],
    ['NEW curve (W452, live) ', simulate(profile, CURVES.NEW, 'none')],
    ['NEW + cap habits only  ', simulate(profile, CURVES.NEW, 'habit')],
    ['NEW + cap ALL @' + CAP_FULL + '/day ', simulate(profile, CURVES.NEW, 'all')],
  ];
  const head = 'days to reach          ' + ['D', 'C', 'B', 'A', 'S', 'S+'].map(r => r.padStart(11)).join('');
  console.log('  ' + head);
  for (const [label, reach] of variants) {
    const row = ['D', 'C', 'B', 'A', 'S', 'S+'].map(r => fmtDays(reach[r]).padStart(11)).join('');
    console.log('  ' + label + row);
  }
  // show the effective rank XP/day on a representative steady-state day (day 60)
  const s60 = dayXp(profile, 60, 60);
  const rawDay = s60.habitXp + s60.compoundXp;
  const capDay = capHabitXp(s60.habitXp) + s60.compoundXp;
  console.log('  steady-state day-60 rank XP/day:  raw ' + Math.round(rawDay) +
              '   capped ' + Math.round(capDay) +
              (rawDay !== capDay ? '   (clipped ' + Math.round(rawDay - capDay) + ')' : '   (under cap)'));
}

console.log('\n════════════════════════════════════════════════════════════════════');
console.log('  Read: compounds (150-450/day) dominate rank XP — raw habit VOLUME');
console.log('  barely matters, so "cap habits only" is near-inert. The real lever');
console.log('  is "cap ALL @' + CAP_FULL + '": it makes rank ≈ DAYS of consistency (S ≈ ' +
            Math.round(12000 / CAP_FULL) + 'd, S+ ≈ ' + Math.round(36000 / CAP_FULL) +
            'd) regardless');
console.log('  of habit count or pack-stacking — at the cost of throttling the');
console.log('  Compound bonus\'s RANK impact (it still feeds total XP, stats, power).');
console.log('════════════════════════════════════════════════════════════════════\n');
