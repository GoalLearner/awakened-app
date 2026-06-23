// tools/economy/sim-reconcile.js — W479 review-fix verification.
//
// The adversarial panel found the custom-path compound's magnitude depends on MUTABLE
// inputs (routine size + pack-ownership), which the original code didn't reconcile:
//   BLOCKER — mid-day pack-flip let custom + pack BOTH pay (double-dip), both directions.
//   MAJOR 1 — mid-day routine SHRINK overpaid (partial banked at a larger size survived).
//   MAJOR 2 — computeTodayXP re-derived from live size => most_xp_day non-monotonic.
//
// This harness FAITHFULLY MODELS the fixed app.js ledger transitions (same arithmetic:
// customCompoundSizeFactor/customCompoundPartialFactor + the Morning curve + the
// reconcile/clawback + the orphan refund + the symmetric latch) and asserts the
// invariants the fix must hold. It models the LOGIC, not the DOM wiring, so it's a
// regression guard for the math/ledger contract, complementing lib/economy.test.js.
//
// Run:  node tools/economy/sim-reconcile.js
'use strict';
const E = require('../../lib/economy.js');

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
// Mirror of app.js _customFullBonusToday(size): round THEN weekend-double.
function customFullBonusToday(size, streak, weekend) {
  const base = Math.round(morningCompoundXP(streak) * E.customCompoundSizeFactor(size));
  return weekend ? base * 2 : base;
}

// ── Faithful model of the FIXED app.js compound ledger for one day ──────────────
function newDay(weekend, streak) {
  return {
    weekend, streak,
    totalPoints: 0,
    customGiven: 0, customAwarded: false,
    packGiven: 0, packAwarded: false,
  };
}
// checkCustomRoutineCompound (partial + full award), post-fix.
function customTick(d, done, total) {
  if (d.packAwarded || d.packGiven > 0) return;        // symmetric latch (review fix)
  if (d.customAwarded) return;                         // once-per-day full guard
  if (total < 3 || done <= 0) return;
  const full = customFullBonusToday(total, d.streak, d.weekend);
  if (done >= total) {                                 // FULL — reconcile to fullBonus(currentSize)
    const remainder = full - d.customGiven;
    d.totalPoints = Math.max(0, d.totalPoints + remainder); // remainder<0 = shrink clawback
    d.customGiven = full;                              // ledger KEEPS exact paid (MAJOR 2)
    d.customAwarded = true;
    return;
  }
  const factor = E.customCompoundPartialFactor(done, total);
  const target = factor > 0 ? Math.round(full * factor) : 0;
  const delta = target - d.customGiven;
  if (delta === 0) return;
  d.totalPoints = Math.max(0, d.totalPoints + delta);  // delta<0 = shrink clawback (MAJOR 1)
  d.customGiven = target;
}
// awardCompoundEffect / checkCompoundEffect pack pay, post-fix (orphan refund).
function packPay(d, packFullBonus) {
  // _refundOrphanCustomCompound()
  if (d.customGiven > 0) { d.totalPoints = Math.max(0, d.totalPoints - d.customGiven); d.customGiven = 0; d.customAwarded = false; }
  d.totalPoints += packFullBonus;
  d.packGiven = packFullBonus; d.packAwarded = true;
}
// computeTodayXP custom contribution, post-fix: reads the ledger directly.
function customXpReported(d) { return d.customGiven; }

// ── Assertions ──────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function check(name, cond, extra) { if (cond) pass++; else { fail++; console.error('  ✗ ' + name + (extra ? '  ' + extra : '')); } }

// INVARIANT 1 — constant-size perfect day totals EXACTLY fullBonus, reported == credited.
for (const size of [3, 5, 10, 16]) for (const streak of [1, 7, 30, 90, 365]) for (const wknd of [false, true]) {
  const d = newDay(wknd, streak);
  customTick(d, 1, size);                       // a partial along the way
  customTick(d, Math.ceil(size * 2 / 3), size); // another
  customTick(d, size, size);                    // complete
  const full = customFullBonusToday(size, streak, wknd);
  check(`constant size=${size} streak=${streak} wknd=${wknd}: day==fullBonus`, d.totalPoints === full, `(${d.totalPoints} vs ${full})`);
  check(`constant size=${size} streak=${streak} wknd=${wknd}: reported==credited`, customXpReported(d) === d.totalPoints);
}

// INVARIANT 2 — MAJOR 1: inflate at large size, SHRINK, complete small → day == fullBonus(finalSize), no overpay.
{
  const d = newDay(false, 365);
  customTick(d, 7, 10);                          // 2/3 of a 10-habit routine at streak 365 → banks the large partial
  const bankedLarge = d.customGiven;
  customTick(d, 3, 3);                           // routine shrank to 3, completed
  const correct = customFullBonusToday(3, 365, false);
  check('SHRINK 10→3 complete: day == fullBonus(3) (clawback, no overpay)', d.totalPoints === correct, `(${d.totalPoints} vs correct ${correct}; banked ${bankedLarge})`);
  check('SHRINK: reported == credited', customXpReported(d) === d.totalPoints);
  check('SHRINK: actually clawed back (banked > final)', bankedLarge > correct);
}

// INVARIANT 3 — GROW: small partial then grow & complete → day == fullBonus(finalSize), pays up.
{
  const d = newDay(false, 90);
  customTick(d, 2, 3);                           // 2/3 of a 3-habit routine
  customTick(d, 10, 10);                         // grew to 10, completed
  const correct = customFullBonusToday(10, 90, false);
  check('GROW 3→10 complete: day == fullBonus(10)', d.totalPoints === correct, `(${d.totalPoints} vs ${correct})`);
}

// INVARIANT 4 — partial SHRINK without completing → banked == warranted partial at current size.
{
  const d = newDay(false, 365);
  customTick(d, 7, 10);                          // big partial
  customTick(d, 2, 3);                           // shrank to 3, did 2/3 (still incomplete) → reconcile down
  const full3 = customFullBonusToday(3, 365, false);
  const want = Math.round(full3 * E.customCompoundPartialFactor(2, 3));
  check('SHRINK incomplete: banked == warranted partial(size 3)', d.totalPoints === want, `(${d.totalPoints} vs ${want})`);
}

// INVARIANT 5 — BLOCKER scenario A: custom partial, then flip INTO a pack → custom refunded, day == pack only.
{
  const d = newDay(false, 30);
  customTick(d, 7, 10);                          // custom partial banked
  const customPart = d.customGiven;
  const packFull = 150;                          // morning full at streak 30
  packPay(d, packFull);                          // user added pack habits + completed the pack
  check('FLIP-IN: day == pack only (custom refunded)', d.totalPoints === packFull, `(${d.totalPoints} vs ${packFull}; had custom ${customPart})`);
  check('FLIP-IN: custom ledger cleared', customXpReported(d) === 0);
  // and custom can no longer re-add this day (latch)
  customTick(d, 10, 10);
  check('FLIP-IN: custom latched out after pack paid', d.totalPoints === packFull && d.customGiven === 0);
}

// INVARIANT 6 — BLOCKER scenario C: custom FULL awarded, then flip INTO pack → custom refunded, day == pack only.
{
  const d = newDay(false, 30);
  customTick(d, 10, 10);                         // custom FULL award
  const customFull = d.customGiven;
  const packFull = 150;
  packPay(d, packFull);                          // flipped into a pack + completed it
  check('FULL-then-pack: day == pack only (custom full refunded)', d.totalPoints === packFull, `(${d.totalPoints} vs ${packFull}; had custom full ${customFull})`);
  check('FULL-then-pack: custom award flag cleared', d.customAwarded === false);
}

// INVARIANT 7 — reverse flip (Scenario C as written): pack pays first, then custom tries → latched out.
{
  const d = newDay(false, 30);
  packPay(d, 150);                               // morning full paid first
  customTick(d, 10, 10);                         // then user dropped a pack habit + completed custom routine
  check('PACK-first: custom latched out (no stack on pack)', d.totalPoints === 150 && d.customGiven === 0, `(${d.totalPoints})`);
}

// ── Cross-day streak model (W479 streak-rollback review fix) ─────────────────
// compoundStreaks['custom'] is PERSISTENT state. A full custom award advances it (with
// a prev* snapshot); _refundOrphanCustomCompound must roll it back when a pack supersedes
// the day, else a refunded full-custom day still advances the streak and pays the NEXT
// custom-only day at an inflated tier. Day index stands in for the calendar date.
function newHunter() { return { custom: { streak: 0, lastDate: null }, totalPoints: 0, _customGiven: 0 }; }
function customFullAward(h, day, size, weekend) {
  const cs = h.custom;
  const newStreak = (cs.lastDate === day - 1) ? cs.streak + 1 : 1;
  h.custom = { streak: newStreak, lastDate: day, prevStreak: cs.streak || 0, prevLastDate: cs.lastDate == null ? null : cs.lastDate };
  const full = customFullBonusToday(size, newStreak, weekend);
  h.totalPoints += full; h._customGiven = full;
}
function packSupersede(h, day, packFull) {                 // mirror _refundOrphanCustomCompound + pack pay
  if (h._customGiven > 0) {
    h.totalPoints = Math.max(0, h.totalPoints - h._customGiven); h._customGiven = 0;
    const ccs = h.custom;
    if (ccs && ccs.lastDate === day && Object.prototype.hasOwnProperty.call(ccs, 'prevStreak')) {
      h.custom = { streak: ccs.prevStreak || 0, lastDate: ccs.prevLastDate };
    }
  }
  h.totalPoints += packFull;
}

// INVARIANT 8 — pack-superseded full-custom day must NOT advance the custom streak.
{
  const h = newHunter();
  customFullAward(h, 1, 10, false);
  check('day1: custom streak advanced to 1 on full award', h.custom.streak === 1);
  packSupersede(h, 1, 150);
  check('day1: streak rolled back to 0 after pack supersede', h.custom.streak === 0 && h.custom.lastDate === null, `(streak ${h.custom.streak})`);
  const proj = (h.custom.lastDate === 1) ? h.custom.streak + 1 : 1;   // day 2 projection
  check('day2: custom-only pays at streak 1, not 2 (no inflation)', proj === 1, `(proj ${proj})`);
  check('day1: pack XP retained after supersede', h.totalPoints === 150, `(${h.totalPoints})`);
}
// INVARIANT 9 — legit consecutive full-custom days still advance the streak.
{
  const h = newHunter();
  customFullAward(h, 1, 10, false);
  customFullAward(h, 2, 10, false);
  check('legit: two consecutive custom days → streak 2', h.custom.streak === 2, `(${h.custom.streak})`);
}
// INVARIANT 10 — a partial-only orphan has no streak to roll back (full award never ran).
{
  const h = newHunter();
  h.custom = { streak: 5, lastDate: 0 };   // yesterday's streak; today is day 1, only a PARTIAL banked
  h._customGiven = 40;
  packSupersede(h, 1, 150);
  check('partial-orphan: streak untouched (no full award)', h.custom.streak === 5 && h.custom.lastDate === 0, `(streak ${h.custom.streak})`);
}

console.log('\nsim-reconcile: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
