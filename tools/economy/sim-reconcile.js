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

// ── W482 — shield + rollover + strip + backfill-date invariants ─────────────
// Finishing W479: the custom path must be a TRUE PEER of the packs. Model the FORGIVENESS
// lifecycle (mirrors tryEarnShield + processStreakRollover) so the parity is PROVEN: a shielded
// miss preserves the custom streak exactly like a pack, and the strip shows the right state.
const W484_SHIELD_THRESHOLD = 14, W484_SHIELD_MAX = 3;
function newShieldHunter() { return { custom: { streak: 0, lastDate: null }, shields: 0, shieldMilestoneClaimed: -1 }; }
// W484 — shields are earned from DAYS ACTIVE into a single GLOBAL pool (mirror tryEarnActivityShield):
// 1 per 14 days-active, max 3, idempotent via shieldMilestoneClaimed, seed-on-first-run (no retro flood).
function tryEarnActivityShieldM(h, daysActive) {
  const milestones = Math.floor(daysActive / W484_SHIELD_THRESHOLD);
  if (h.shieldMilestoneClaimed < 0) { h.shieldMilestoneClaimed = milestones; return false; }
  if (milestones <= h.shieldMilestoneClaimed) return false;
  let earned = false;
  while (h.shieldMilestoneClaimed < milestones) {
    h.shieldMilestoneClaimed++;
    if (h.shields < W484_SHIELD_MAX) { h.shields += 1; earned = true; }
  }
  return earned;
}
// W484 — the award advances the custom STREAK only; shields are NOT earned here anymore.
function awardCustomShieldDay(h, day) {
  const cs = h.custom;
  const newStreak = (cs.lastDate === day - 1) ? cs.streak + 1 : 1;
  h.custom = { streak: newStreak, lastDate: day, prevStreak: cs.streak || 0, prevLastDate: cs.lastDate };
}
function rolloverCustomM(h, today) {                          // mirror processStreakRollover for 'custom'
  const cs = h.custom;
  if (!cs || cs.lastDate == null || cs.streak === 0) return;
  if (cs.lastDate === today || cs.lastDate === today - 1) return;
  let cursor = cs.lastDate + 1, broken = false;
  while (cursor < today) {
    if (h.shields > 0) { h.shields -= 1; cs.lastDate = cursor; cursor++; continue; }   // Honest-Rest omitted (same absorb mechanism)
    broken = true; break;
  }
  if (broken) { cs.streak = 0; cs.lastDate = null; }
}

// INVARIANT 11 — a SHIELDED miss PRESERVES the custom streak (the owner's #1 parity test).
{
  const h = newShieldHunter();
  for (let d = 1; d <= 14; d++) awardCustomShieldDay(h, d);   // 14-day streak (the award no longer earns a shield)
  h.shields = 1;                                              // a shield earned from DAYS ACTIVE (see the W484 earn invariant)
  check('W484: a custom streak can hold a (global, activity-earned) shield', h.shields === 1);
  check('W484: custom streak is 14', h.custom.streak === 14);
  rolloverCustomM(h, 16);                                     // missed day 15; app opens on day 16
  check('W482: shielded miss CONSUMED a shield', h.shields === 0, `(${h.shields})`);
  check('W482: shielded miss PRESERVED the custom streak (held at 14)', h.custom.streak === 14 && h.custom.lastDate === 15, `(streak ${h.custom.streak}, last ${h.custom.lastDate})`);
  awardCustomShieldDay(h, 16);                                // complete day 16 → continues
  check('W482: custom streak CONTINUES after a shielded miss', h.custom.streak === 15, `(${h.custom.streak})`);
}
// INVARIANT 12 — an UNSHIELDED miss breaks the custom streak (same as a pack).
{
  const h = newShieldHunter();
  for (let d = 1; d <= 5; d++) awardCustomShieldDay(h, d);    // streak 5, < 14 so no shield
  check('W482: no shield before the 14-day threshold', h.shields === 0);
  rolloverCustomM(h, 7);                                      // missed day 6, no shield → break
  check('W482: UNshielded miss BREAKS the custom streak', h.custom.streak === 0 && h.custom.lastDate === null);
}
// INVARIANT 13 — the strip shows the custom row ONLY on the custom path (the owner's #2 test).
function stripShowsCustomRow(onPresetPack, total) { return !onPresetPack && total >= 3; }   // mirror renderCompoundProgress onCustom gate
check('W482: strip SHOWS the custom row on the custom path (>=3 habits)', stripShowsCustomRow(false, 5) === true);
check('W482: strip shows NO custom row on a preset pack (no phantom)', stripShowsCustomRow(true, 12) === false);
check('W482: strip shows NO custom row for a <3-habit non-pack user', stripShowsCustomRow(false, 2) === false);
// INVARIANT 14 — stale pre-W482 save (no prevStreak) refund neutralizes the streak inflation.
function refundOrphanStreak(ccs, today) {                     // mirror _refundOrphanCustomCompound streak block
  if (!(ccs && ccs.lastDate === today)) return ccs;
  if (Object.prototype.hasOwnProperty.call(ccs, 'prevStreak')) {
    return { streak: ccs.prevStreak || 0, lastDate: ccs.prevLastDate || null };
  }
  return { streak: Math.max(0, (ccs.streak || 0) - 1), lastDate: null };
}
{
  const stale = refundOrphanStreak({ streak: 8, lastDate: 100 }, 100);             // pre-W482: no prevStreak
  check('W482: stale-save refund neutralizes inflation (8->7, lastDate null)', stale.streak === 7 && stale.lastDate === null, `(${stale.streak},${stale.lastDate})`);
  const fresh = refundOrphanStreak({ streak: 8, lastDate: 100, prevStreak: 7, prevLastDate: 99 }, 100);
  check('W482: post-W482 refund exact rollback to prevStreak (8->7, last 99)', fresh.streak === 7 && fresh.lastDate === 99);
}
// INVARIANT 15 — W484 ACTIVITY-EARNED shields: 1 per 14 days-active, idempotent, cap 3, seed-no-flood.
{
  // (a) an existing user with prior activity does NOT get a retroactive flood on first run
  const h = newShieldHunter();                               // shieldMilestoneClaimed = -1 (needs seeding)
  tryEarnActivityShieldM(h, 40);                             // first call seeds to floor(40/14)=2, grants nothing
  check('W484: first run seeds the milestone (no retroactive flood)', h.shields === 0 && h.shieldMilestoneClaimed === 2, `(${h.shields},${h.shieldMilestoneClaimed})`);
  // (b) a fresh user earns exactly 1 shield at 14 days active
  const h2 = newShieldHunter();
  tryEarnActivityShieldM(h2, 1);                             // seed at day 1 -> milestone 0
  for (let da = 2; da <= 13; da++) tryEarnActivityShieldM(h2, da);
  check('W484: no shield before 14 days active', h2.shields === 0);
  tryEarnActivityShieldM(h2, 14);
  check('W484: 1 shield at 14 days active', h2.shields === 1 && h2.shieldMilestoneClaimed === 1);
  // (c) idempotent — re-evaluating at the same days-active count never double-grants
  tryEarnActivityShieldM(h2, 14);
  check('W484: idempotent at the same milestone (no double-grant)', h2.shields === 1);
  // (d) recurring earn, capped at SHIELD_MAX (milestones still advance/consume past the cap)
  for (let da = 15; da <= 70; da++) tryEarnActivityShieldM(h2, da);  // crosses 28/42/56/70 -> 5 milestones total
  check('W484: shields cap at SHIELD_MAX=3', h2.shields === 3, `(${h2.shields})`);
  check('W484: milestones advance past the cap (consumed, no retro-flood on spend)', h2.shieldMilestoneClaimed === 5, `(${h2.shieldMilestoneClaimed})`);
}
// INVARIANT 16 — diffPts weekend now reflects the SEALED date, not today (the backfill bug).
function isWeekendDate(dateStr) {                             // mirror app.js isWeekend(dateStr) LA-anchored 'T20:00:00Z'
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short' }).format(new Date(Date.parse(dateStr + 'T20:00:00Z')));
  return day === 'Fri' || day === 'Sat' || day === 'Sun';
}
check('W482: a Thursday-sealed date is a WEEKDAY (no x2)',          isWeekendDate('2026-06-18') === false);  // 2026-06-18 = Thu
check('W482: a Saturday-sealed date is a WEEKEND (x2)',            isWeekendDate('2026-06-20') === true);   // 2026-06-20 = Sat
check('W482: Friday counts as weekend (Fri/Sat/Sun set preserved)', isWeekendDate('2026-06-19') === true);  // 2026-06-19 = Fri
check('W482: Monday is a weekday',                                  isWeekendDate('2026-06-22') === false); // 2026-06-22 = Mon

// ── W482 review fix — dormant-skip + genuine-absence comeback gate ──────────
// processStreakRollover now (a) SKIPS a dormant custom streak while the user is on a preset pack
// (frozen — no break/shield-spend/toast), and (b) queues a Comeback ONLY on a genuine absence
// (lastActiveDate strictly before yesterday), so an active path-switcher gets no phantom +25 XP.
function rolloverCustomFull(h, today, onPresetPack, lastActiveDate) {
  if (onPresetPack) return { broken: false, comebackQueued: false };         // (a) dormant skip
  const cs = h.custom;
  if (!cs || cs.lastDate == null || cs.streak === 0) return { broken: false, comebackQueued: false };
  if (cs.lastDate === today || cs.lastDate === today - 1) return { broken: false, comebackQueued: false };
  let cursor = cs.lastDate + 1, broken = false;
  while (cursor < today) { if (h.shields > 0) { h.shields--; cs.lastDate = cursor; cursor++; continue; } broken = true; break; }
  if (!broken) return { broken: false, comebackQueued: false };
  cs.streak = 0; cs.lastDate = null;                                          // streak still breaks
  const comebackQueued = (lastActiveDate != null && lastActiveDate < today - 1);  // (b) genuine-absence gate
  return { broken: true, comebackQueued };
}
// INVARIANT 17 — a dormant custom streak is FROZEN on a preset pack (no break / shield spend / comeback).
{
  const h = newShieldHunter(); h.custom = { streak: 20, lastDate: 10 }; h.shields = 2;
  const r = rolloverCustomFull(h, 16, true, 15);
  check('W482: dormant custom FROZEN on a pack — no break, shields preserved', !r.broken && h.custom.streak === 20 && h.shields === 2);
  check('W482: dormant custom FROZEN on a pack — no comeback', !r.comebackQueued);
}
// INVARIANT 18 — comeback gate: an ACTIVE custom user whose streak breaks gets NO comeback;
// a genuinely-ABSENT one does.
{
  const ha = newShieldHunter(); ha.custom = { streak: 20, lastDate: 10 }; ha.shields = 0;
  const ra = rolloverCustomFull(ha, 16, false, 15);   // active yesterday (day 15), today 16
  check('W482: ACTIVE switcher — custom streak breaks but NO phantom comeback', ra.broken && !ra.comebackQueued);
  const hb = newShieldHunter(); hb.custom = { streak: 20, lastDate: 10 }; hb.shields = 0;
  const rb = rolloverCustomFull(hb, 16, false, 10);   // last active day 10 (genuinely away)
  check('W482: genuinely-ABSENT user — custom streak breaks AND comeback fires', rb.broken && rb.comebackQueued);
}

console.log('\nsim-reconcile: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
