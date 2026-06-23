// lib/economy.js — Awakened pure economy math (extracted from app.js, W471).
//
// Path-to-A (Craft/tech): the XP curve, stat-level, compound partial-credit, and
// daily soft-cap math lived inline in the 52k-line app.js with NO unit tests — the
// most-touched, least-tested code path. These are the PURE, side-effect-free pieces
// (they compute only from their arguments — no reads/writes of app state), pulled
// out here so they can be locked down with regression tests (lib/economy.test.js)
// before any future economy tuning.
//
// Dual-mode: attaches to the global as `AwakenedEconomy` for the browser (loaded via
// <script> BEFORE app.js, which delegates to it) AND exports via module.exports for
// the Node test runner. The bodies are byte-identical copies of the app.js originals
// — ZERO behavior change. Stateful wrappers (the day-ledger persistence in
// creditDailyXP) stay in app.js and call pacedDailyXp() for the pure math.
(function (global) {
  'use strict';

  var MAX_STAT_LEVEL = 20;

  // XP required to advance FROM level `l` TO level `l+1` (max level 20).
  function xpToNextLevel(l) {
    var TABLE = [5, 15, 30, 50, 75, 105, 140, 180, 225, 275, 330, 390, 455, 525, 600, 680, 765, 855, 950];
    return (l >= 1 && l <= 19) ? TABLE[l - 1] : 0; // 0 at cap — Level 20 has nowhere to go
  }

  // Total cumulative XP needed to REACH level `l` (level 1 = 0 XP).
  function xpForLevel(l) {
    var total = 0;
    for (var i = 1; i < l; i++) total += xpToNextLevel(i);
    return total;
  }

  // Level (1..20) for a given lifetime stat-points total.
  function statLevel(pts) {
    if (!pts || pts <= 0) return 1;
    var lv = 1, cumXP = 0;
    while (lv < 20) {
      var needed = xpToNextLevel(lv);
      if (pts < cumXP + needed) break;
      cumXP += needed;
      lv++;
    }
    return lv;
  }

  // W459 graded compound partial-credit factor by ABSOLUTE missing-habit count.
  // missing 0 = full (1.0) · 1–3 = 50% · 4–8 = 25% · 9+ = 0. Monotonic: fewer
  // missing habits never yields less credit. Proof: tools/sim-compound.js.
  var COMPOUND_PARTIAL_TIERS = [
    { maxMissing: 3, factor: 0.50 },
    { maxMissing: 8, factor: 0.25 },
  ];
  function compoundPartialFactor(missing) {
    if (missing <= 0) return 1;
    for (var i = 0; i < COMPOUND_PARTIAL_TIERS.length; i++) {
      if (missing <= COMPOUND_PARTIAL_TIERS[i].maxMissing) return COMPOUND_PARTIAL_TIERS[i].factor;
    }
    return 0;
  }

  // W479 — CUSTOM-PATH COMPOUND. A user who builds their OWN routine matches no
  // preset pack (morning/locked-in) and so earned ZERO compound — the two-tier
  // economy gap. These two pure helpers let app.js pay a daily compound for a
  // SELF-BUILT routine, on the SAME Morning streak curve, scaled by routine size.
  //
  // (1) Size factor — a custom routine earns the full Morning rate at CUSTOM_COMPOUND_FULL_SIZE
  // (10) habits and proportionally less below, CAPPED at 1.0 so a custom routine
  // never beats Morning (the curated Locked-In cycle stays the premium tier). The
  // app multiplies getCompoundXP('morning', streak) by this.
  var CUSTOM_COMPOUND_FULL_SIZE = 10;
  function customCompoundSizeFactor(size) {
    if (!(size > 0)) return 0;
    return Math.min(size, CUSTOM_COMPOUND_FULL_SIZE) / CUSTOM_COMPOUND_FULL_SIZE;
  }

  // (2) Graded partial factor — mirrors compoundPartialFactor (W459) but keyed on
  // the FRACTION of the routine done (done/size), not an absolute missing count,
  // because a custom routine has no fixed size: 2/3+ done = 50%, 1/3+ = 25%, else 0,
  // full = 100%. Fraction-based so a 3-habit and a 12-habit routine grade alike, and
  // so a near-complete custom day never pays zero (no re-introduced compound cliff).
  // Monotonic in `done` for fixed `size` (factor is non-decreasing as done rises), so
  // — over a constant daily base — completing one more habit can never lower the day's
  // credit, exactly as W459 guarantees for packs.
  var CUSTOM_COMPOUND_PARTIAL_TIERS = [
    { minFrac: 2 / 3, factor: 0.50 },
    { minFrac: 1 / 3, factor: 0.25 },
  ];
  function customCompoundPartialFactor(done, size) {
    if (!(size > 0) || done <= 0) return 0;
    if (done >= size) return 1;
    var frac = done / size;
    for (var i = 0; i < CUSTOM_COMPOUND_PARTIAL_TIERS.length; i++) {
      if (frac >= CUSTOM_COMPOUND_PARTIAL_TIERS[i].minFrac) return CUSTOM_COMPOUND_PARTIAL_TIERS[i].factor;
    }
    return 0;
  }

  // W461 daily rank-XP soft-cap — the PURE math core of app.js creditDailyXP.
  // Given `rawToday` new raw XP and `priorCredited` raw XP already counted today,
  // returns the paced rank XP to award: full up to `knee`, then `overRate` beyond.
  // The day ledger + persistence stay in app.js's creditDailyXP wrapper; this is pure.
  var DAILY_XP_SOFT_CAP_KNEE = 750;
  var DAILY_XP_OVER_CAP_RATE = 0.5;
  function pacedDailyXp(rawToday, priorCredited, knee, overRate) {
    if (!(rawToday > 0)) return rawToday || 0;
    if (typeof knee !== 'number') knee = DAILY_XP_SOFT_CAP_KNEE;
    if (typeof overRate !== 'number') overRate = DAILY_XP_OVER_CAP_RATE;
    var before = priorCredited || 0;
    var after  = before + rawToday;
    var fullPortion = Math.max(0, Math.min(after, knee) - Math.min(before, knee));
    var overPortion = Math.max(0, after - Math.max(before, knee));
    return Math.round(fullPortion + overPortion * overRate);
  }

  // Cumulative XP to reach the level-20 cap (= sum of the per-level table = 6650).
  var MAX_STAT_XP = xpForLevel(MAX_STAT_LEVEL);

  var API = {
    xpToNextLevel: xpToNextLevel,
    xpForLevel: xpForLevel,
    statLevel: statLevel,
    compoundPartialFactor: compoundPartialFactor,
    customCompoundSizeFactor: customCompoundSizeFactor,
    customCompoundPartialFactor: customCompoundPartialFactor,
    pacedDailyXp: pacedDailyXp,
    COMPOUND_PARTIAL_TIERS: COMPOUND_PARTIAL_TIERS,
    CUSTOM_COMPOUND_FULL_SIZE: CUSTOM_COMPOUND_FULL_SIZE,
    CUSTOM_COMPOUND_PARTIAL_TIERS: CUSTOM_COMPOUND_PARTIAL_TIERS,
    DAILY_XP_SOFT_CAP_KNEE: DAILY_XP_SOFT_CAP_KNEE,
    DAILY_XP_OVER_CAP_RATE: DAILY_XP_OVER_CAP_RATE,
    MAX_STAT_LEVEL: MAX_STAT_LEVEL,
    MAX_STAT_XP: MAX_STAT_XP,
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = API; }
  if (global) { global.AwakenedEconomy = API; }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
