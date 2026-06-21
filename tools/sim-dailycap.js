#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────
// tools/sim-dailycap.js — proof + decision aid for W461 daily rank-XP soft-cap.
//
// FINAL design: only PER-HABIT completion XP is capped (full to the knee, then
// reduced). COMPOUND pack bonuses (regular AND day-90/180/365 spikes) are EXEMPT
// — compound is bounded (≤2 packs, fixed by streak), so it is not a farm vector;
// the only user-inflatable lever is per-habit COUNT. This proves:
//   (1) IDENTITY below the knee — a normal player is NEVER touched.
//   (2) the cap is a loose GUARDRAIL — inert for every realistic profile, biting
//       only a pathological per-habit farmer (75+ hard habits).
//   (3) SPIKE days are now fully protected (0 clip) — compound never routes here.
//   node tools/sim-dailycap.js
// ─────────────────────────────────────────────────────────────────────
'use strict';

const KNEE = 750, OVER_RATE = 0.5;
function creditPerHabit(rawDay) {                 // verbatim creditDailyXP shape
  const full = Math.min(rawDay, KNEE);
  const over = Math.max(0, rawDay - KNEE);
  return Math.round(full + over * OVER_RATE);
}

function getCompoundXP(packId, streak) {          // verbatim from app.js
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

const SPLUS = 36000;
const perHabitRaw = (p, weekend) => p.habits * p.avgDiff * (weekend ? 2 : 1);          // CAPPABLE
const compoundRaw = (p, streak, weekend) => p.packs                                     // EXEMPT
  ? (getCompoundXP('morning', streak) + getCompoundXP('locked-in', streak)) * (weekend ? 2 : 1) : 0;

const PROFILES = [
  { name: 'Casual non-pack',       habits: 4,   avgDiff: 3, packs: false },
  { name: 'Engaged non-pack',      habits: 10,  avgDiff: 4, packs: false },
  { name: 'Mature both-packs',     habits: 16,  avgDiff: 3, packs: true  },
  { name: 'Farmer 25 hard+packs',  habits: 25,  avgDiff: 5, packs: true  },
  { name: 'PATHOLOGICAL 100 hard', habits: 100, avgDiff: 5, packs: true  },
];

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('  W461 DAILY RANK-XP SOFT-CAP (FINAL: per-habit only; compound exempt)');
console.log('  rule: per-habit XP full to KNEE ' + KNEE + '/day, then ' + (OVER_RATE * 100) + '% beyond');
console.log('═══════════════════════════════════════════════════════════════════════');

// (1) identity below the knee
let identityOK = true;
for (let r = 0; r <= KNEE; r += 7) if (creditPerHabit(r) !== r) identityOK = false;
console.log('\n  (1) IDENTITY below knee (credited === raw for every per-habit raw<=' + KNEE + '): ' + (identityOK ? 'PASS ✓' : 'FAIL ✗'));

// (2) per-profile per-habit bite (streak 60), weekday + weekend
console.log('\n  (2) PER-HABIT BITE (streak 60):  cappable per-habit raw -> credited');
console.log('   profile                    weekday          weekend');
PROFILES.forEach(p => {
  const wd = perHabitRaw(p, false), we = perHabitRaw(p, true);
  const f = (raw) => raw + '->' + creditPerHabit(raw) + (creditPerHabit(raw) === raw ? ' (none)' : ' (-' + (raw - creditPerHabit(raw)) + ')');
  console.log('   ' + p.name.padEnd(24) + f(wd).padEnd(17) + f(we));
});

// (3) spike days now fully protected (compound is exempt → 0 clip)
console.log('\n  (3) SPIKE-DAY PROTECTION (mature both-packs, weekend): compound is EXEMPT');
console.log('   milestone day   compound (raw=credited)   per-habit clip');
[90, 180, 365].forEach(d => {
  const comp = compoundRaw(PROFILES[2], d, true);
  const ph   = perHabitRaw(PROFILES[2], true);
  console.log('   day ' + String(d).padEnd(11) + (comp + ' (0 clip ✓)').padEnd(26) + (ph - creditPerHabit(ph)) + ' clip');
});

// (4) days-to-S+ — per-habit capped, compound exempt (5 weekdays + 2 weekend/wk)
function daysToSPlus(p, capped) {
  let xp = 0, days = 0;
  while (xp < SPLUS && days < 100000) {
    const weekend = (days % 7) >= 5;
    const ph = perHabitRaw(p, weekend);
    xp += (capped ? creditPerHabit(ph) : ph) + compoundRaw(p, 60, weekend);
    days++;
  }
  return days;
}
console.log('\n  (4) DAYS TO S+ (steady-state streak-60):  uncapped vs capped');
PROFILES.forEach(p => {
  const u = daysToSPlus(p, false), c = daysToSPlus(p, true);
  console.log('   ' + p.name.padEnd(24) + ('uncapped ' + u).padEnd(16) + 'capped ' + c + (u === c ? '   (cap inert ✓)' : '   (-' + (c - u) + ' days slower)'));
});

console.log('\n═══════════════════════════════════════════════════════════════════════');
console.log('  READ: the cap is INERT for every realistic profile (incl. a 25-hard-');
console.log('  habit + both-packs farmer) and only bites the PATHOLOGICAL 100-hard-');
console.log('  habit case — exactly the "insurance, never touches real play" guardrail');
console.log('  intended. Spike days + all compound: fully protected.');
console.log('═══════════════════════════════════════════════════════════════════════\n');
