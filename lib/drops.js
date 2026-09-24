// lib/drops.js — Awakened relic drop engine: the rate tables and the pure roll
// decision (extracted from app.js, W992).
//
// W992 (owner 2026-09-24): "E-rank gates should not have the same drop rates as
// A-rank gates." Before this, every solo E/D/C/B boss shared ONE table keyed on
// how often it could be hunted (daily), and A/S bosses had flat tables with no
// bad-luck protection at all. Rates and mercy are now keyed on the boss's RANK:
// generous at E, stepping down each rank, and A/S finally get a bounded wait.
//
// Dual-mode like lib/economy.js: attaches to the global as `AwakenedDrops` for the
// browser (loaded via <script> BEFORE app.js) AND exports via module.exports for
// the Node test runner (lib/drops.test.js). Everything here is pure: the decision
// is computed from its inputs and an injectable rng. Inventory, ledger, reveals
// and counters stay in app.js.
(function (global) {
  'use strict';

  // ── Legacy cadence tables (kept verbatim; weekly = the Gray Pilgrim, daily = fallback) ──
  var DROP_RATES_BY_CADENCE = {
    daily: {
      ultra_rare:        1 / 20,
      rare:              1 / 12,
      common:            0.5407,
      common_protected:  (2 / 3) + 0.13,
    },
    triweekly: {
      ultra_rare:        0.10,
      rare:              0.15,
      common:            0.4771,
      common_protected:  0.78,
    },
    weekly: {
      ultra_rare:        0.20,
      rare:              0.25,
      common:            1.00,
      common_protected:  1.00,
    },
  };
  var DROP_PITY_BY_CADENCE = {
    daily:     { any_drop_guarantee_after: 4, rare_mercy_after: 12, ultra_soft_pity_after: 20, ultra_soft_pity_add: 0.02, ultra_soft_pity_max: 0.20, ultra_hard_pity_after: 40 },
    triweekly: { any_drop_guarantee_after: 3, rare_mercy_after: 6,  ultra_soft_pity_after: 10, ultra_soft_pity_add: 0.03, ultra_soft_pity_max: 0.25, ultra_hard_pity_after: 20 },
    weekly:    { any_drop_guarantee_after: 2, rare_mercy_after: 4,  ultra_soft_pity_after: 5,  ultra_soft_pity_add: 0.05, ultra_soft_pity_max: 0.35, ultra_hard_pity_after: 8 },
  };

  // ── W992 — rates by RANK (solo E/D/C/B gates) ──
  // The roll is ultra → rare → common, first hit wins, so the realized per-kill
  // odds are u, (1−u)·r, (1−u)(1−r)·c and "nothing" = (1−u)(1−r)(1−c):
  //   E  12.0% ultra · 24.6% rare · 55.1% common · 8.2% nothing
  //   D   9.0        · 20.0       · 55.4        · 15.6
  //   C   7.0        · 15.8       · 54.0        · 23.2
  //   B   5.0        · 11.4       · 46.0        · 37.6
  // (the old daily row realized 5.0 / 7.9 / 40.0 / 40.0 at every rank).
  // With the rank mercy below, E's ultra lands at ≈15% of kills over a long run.
  // common_protected applies until a boss's first common (per boss, as before).
  var DROP_RATES_BY_RANK = {
    E: { ultra_rare: 0.12, rare: 0.28, common: 0.87, common_protected: 0.95 },
    D: { ultra_rare: 0.09, rare: 0.22, common: 0.78, common_protected: 0.90 },
    C: { ultra_rare: 0.07, rare: 0.17, common: 0.70, common_protected: 0.85 },
    B: { ultra_rare: 0.05, rare: 0.12, common: 0.55, common_protected: 0.80 },
  };
  // Mercy by rank. A null threshold means that layer is off. A and S keep their
  // own dropTable odds; they gain a rare mercy (A) and a guaranteed ultra (both).
  var DROP_PITY_BY_RANK = {
    E: { any_drop_guarantee_after: 2,    rare_mercy_after: 5,    ultra_soft_pity_after: 8,    ultra_soft_pity_add: 0.04, ultra_soft_pity_max: 0.35, ultra_hard_pity_after: 15 },
    D: { any_drop_guarantee_after: 3,    rare_mercy_after: 8,    ultra_soft_pity_after: 12,   ultra_soft_pity_add: 0.03, ultra_soft_pity_max: 0.30, ultra_hard_pity_after: 25 },
    C: { any_drop_guarantee_after: 3,    rare_mercy_after: 10,   ultra_soft_pity_after: 16,   ultra_soft_pity_add: 0.02, ultra_soft_pity_max: 0.25, ultra_hard_pity_after: 32 },
    B: { any_drop_guarantee_after: 4,    rare_mercy_after: 12,   ultra_soft_pity_after: 20,   ultra_soft_pity_add: 0.02, ultra_soft_pity_max: 0.20, ultra_hard_pity_after: 40 },
    A: { any_drop_guarantee_after: null, rare_mercy_after: 8,    ultra_soft_pity_after: null, ultra_soft_pity_add: 0,    ultra_soft_pity_max: 0,    ultra_hard_pity_after: 25 },
    S: { any_drop_guarantee_after: null, rare_mercy_after: null, ultra_soft_pity_after: null, ultra_soft_pity_add: 0,    ultra_soft_pity_max: 0,    ultra_hard_pity_after: 30 },
  };

  function rankOf(cfg) { return String((cfg && cfg.rank) || '').toUpperCase(); }
  // Weekly cadence wins (the Gray Pilgrim keeps his 0%-nothing table), then the
  // rank row, then the cadence row, then daily.
  function ratesFor(cfg) {
    cfg = cfg || {};
    if (cfg.cadence === 'weekly') return DROP_RATES_BY_CADENCE.weekly;
    var r = DROP_RATES_BY_RANK[rankOf(cfg)];
    if (r) return r;
    return DROP_RATES_BY_CADENCE[cfg.cadence] || DROP_RATES_BY_CADENCE.daily;
  }
  function pityFor(cfg) {
    cfg = cfg || {};
    if (cfg.cadence === 'weekly') return DROP_PITY_BY_CADENCE.weekly;
    var p = DROP_PITY_BY_RANK[rankOf(cfg)];
    if (p) return p;
    return DROP_PITY_BY_CADENCE[cfg.cadence] || DROP_PITY_BY_CADENCE.daily;
  }

  // The EFFECTIVE ultra rate for one kill: hard pity → 1, soft pity → base + n·add
  // capped at max, else base. Null thresholds = that layer is off.
  function effectiveUltraRate(pity, killsSinceUltra, baseRate) {
    var k = killsSinceUltra | 0;
    if (!pity) return baseRate;
    if (pity.ultra_hard_pity_after != null && k >= pity.ultra_hard_pity_after) return 1;
    if (pity.ultra_soft_pity_after != null && k >= pity.ultra_soft_pity_after) {
      var extra = k - pity.ultra_soft_pity_after + 1;
      return Math.min(baseRate + extra * (pity.ultra_soft_pity_add || 0), pity.ultra_soft_pity_max || baseRate);
    }
    return baseRate;
  }

  function freshState() {
    return { kills_since_any_drop: 0, kills_since_ultra: 0, kills_since_rare_or_better: 0, last_drop_at: null };
  }

  // Decide ONE kill. Returns { rarity, fromPity, pityType, forceAny }:
  //   rarity   'mythic' | 'ultra_rare' | 'rare' | 'common' | null
  //   forceAny true when any-drop pity fired: the caller picks the card
  //            (app.js forcePityDrop prefers common → rare → ultra with cap headroom).
  // input: { dropTable, rates, pity, state, hasFirstCommon, luck, avail, rng }
  //   avail = { mythic, ultra_rare, rare, common } pool sizes.
  //   pity = null → no mercy of any kind (co-op rolls; the pure cumulative table).
  function resolveRoll(input) {
    input = input || {};
    var rng = typeof input.rng === 'function' ? input.rng : Math.random;
    var luck = (Number(input.luck) > 1) ? Math.min(1.25, Number(input.luck)) : 1;
    var avail = input.avail || {};
    var has = function (r) { return (avail[r] | 0) > 0; };
    var state = input.state || freshState();
    var pity = input.pity || null;
    var out = { rarity: null, fromPity: false, pityType: null, forceAny: false };

    if (input.dropTable) {
      // Path B — bespoke table: cumulative bands, best rarity first. Luck scales every
      // rarity, mythic included (W793.1). Mythic is never forced and never downgraded
      // (W703); when a pity config is given, an ultra hard pity and a rare mercy apply.
      var r = rng(); var acc = 0;
      var order = ['mythic', 'ultra_rare', 'rare', 'common'];
      for (var i = 0; i < order.length; i++) {
        var rar = order[i];
        var p = input.dropTable[rar];
        if (typeof p === 'number') p = p * luck;
        if (typeof p === 'number' && p > 0 && has(rar)) {
          acc += p;
          if (r < acc) { out.rarity = rar; break; }
        }
      }
      if (pity && out.rarity !== 'mythic') {
        if (out.rarity !== 'ultra_rare' && has('ultra_rare') && pity.ultra_hard_pity_after != null &&
            (state.kills_since_ultra | 0) >= pity.ultra_hard_pity_after) {
          out.rarity = 'ultra_rare'; out.fromPity = true; out.pityType = 'ultra_hard';
        } else if ((out.rarity === null || out.rarity === 'common') && has('rare') && pity.rare_mercy_after != null &&
            (state.kills_since_rare_or_better | 0) + 1 >= pity.rare_mercy_after) {
          out.rarity = 'rare'; out.fromPity = true; out.pityType = 'rare_mercy';
        }
      }
      return out;
    }

    // Path A — rank/cadence rates: ultra → rare → common, first hit wins; then mercy.
    var rates = input.rates || DROP_RATES_BY_CADENCE.daily;
    var commonRate = input.hasFirstCommon ? rates.common : rates.common_protected;
    var effU = effectiveUltraRate(pity, state.kills_since_ultra, rates.ultra_rare);
    var ultraHardForced = effU >= 1 && has('ultra_rare');
    if (rng() < Math.min(1, effU * luck) && has('ultra_rare')) {
      out.rarity = 'ultra_rare';
      if (ultraHardForced) { out.fromPity = true; out.pityType = 'ultra_hard'; }
      else if (effU > rates.ultra_rare) { out.fromPity = true; out.pityType = 'ultra_soft'; }
    } else if (rng() < Math.min(1, rates.rare * luck) && has('rare')) {
      out.rarity = 'rare';
    } else if (rng() < Math.min(1, commonRate * luck) && has('common')) {
      out.rarity = 'common';
    }
    if (pity) {
      // Rare mercy floor: one kill shy of the threshold and the outcome is weaker than
      // rare → rare. An ultra outcome is never downgraded.
      if (has('rare') && pity.rare_mercy_after != null && (state.kills_since_rare_or_better | 0) + 1 >= pity.rare_mercy_after) {
        var isRareOrBetter = out.rarity === 'rare' || out.rarity === 'ultra_rare';
        if (!isRareOrBetter) { out.rarity = 'rare'; out.fromPity = true; out.pityType = 'rare_mercy'; }
      }
      // Any-drop pity: every roll missed and the no-drop ceiling is one kill away.
      if (!out.rarity && pity.any_drop_guarantee_after != null && (state.kills_since_any_drop | 0) + 1 >= pity.any_drop_guarantee_after &&
          (has('common') || has('rare') || has('ultra_rare'))) {
        out.forceAny = true; out.fromPity = true; out.pityType = 'any_drop';
      }
    }
    return out;
  }

  // The app's counter rules, in one place. `rarity` null = an empty kill.
  function advanceState(state, rarity, nowIso) {
    state = state || freshState();
    if (!rarity) {
      state.kills_since_any_drop += 1;
      state.kills_since_ultra += 1;
      state.kills_since_rare_or_better += 1;
      return state;
    }
    if (rarity === 'common') {
      state.kills_since_any_drop = 0;
      state.kills_since_ultra += 1;
      state.kills_since_rare_or_better += 1;
    } else if (rarity === 'rare') {
      state.kills_since_any_drop = 0;
      state.kills_since_rare_or_better = 0;
      state.kills_since_ultra += 1;
    } else if (rarity === 'ultra_rare' || rarity === 'mythic') {
      state.kills_since_any_drop = 0;
      state.kills_since_rare_or_better = 0;
      state.kills_since_ultra = 0;
    }
    state.last_drop_at = nowIso || new Date().toISOString();
    return state;
  }

  // Analytic per-kill odds of a Path-A table (no mercy, no luck).
  function realizedOdds(rates, protectedCommon) {
    var u = rates.ultra_rare, r = rates.rare, c = protectedCommon ? rates.common_protected : rates.common;
    return { ultra: u, rare: (1 - u) * r, common: (1 - u) * (1 - r) * c, nothing: (1 - u) * (1 - r) * (1 - c) };
  }

  // Monte-Carlo over a cloned state. opts = { dropTable, rates, pity, avail, hasFirstCommon, state, rng, luck }.
  // Any-drop pity is tallied as a common (forcePityDrop prefers common).
  function simulate(opts, n) {
    opts = opts || {};
    n = Math.max(1, Math.min(100000, n | 0));
    var state = Object.assign(freshState(), opts.state || {});
    var firstCommon = !!opts.hasFirstCommon;
    var tally = { mythic: 0, ultra_rare: 0, rare: 0, common: 0, no_drop: 0, pity_drops: 0 };
    for (var i = 0; i < n; i++) {
      var o = resolveRoll({ dropTable: opts.dropTable || null, rates: opts.rates, pity: opts.pity, state: state,
        hasFirstCommon: firstCommon, luck: opts.luck, avail: opts.avail, rng: opts.rng });
      var rar = o.rarity;
      if (!rar && o.forceAny) rar = (opts.avail && opts.avail.common) ? 'common' : ((opts.avail && opts.avail.rare) ? 'rare' : 'ultra_rare');
      if (o.fromPity) tally.pity_drops += 1;
      if (!rar) tally.no_drop += 1; else { tally[rar] += 1; if (rar === 'common') firstCommon = true; }
      advanceState(state, rar, 'sim');
    }
    return tally;
  }

  var API = {
    DROP_RATES_BY_CADENCE: DROP_RATES_BY_CADENCE,
    DROP_PITY_BY_CADENCE: DROP_PITY_BY_CADENCE,
    DROP_RATES_BY_RANK: DROP_RATES_BY_RANK,
    DROP_PITY_BY_RANK: DROP_PITY_BY_RANK,
    ratesFor: ratesFor,
    pityFor: pityFor,
    effectiveUltraRate: effectiveUltraRate,
    resolveRoll: resolveRoll,
    advanceState: advanceState,
    realizedOdds: realizedOdds,
    simulate: simulate,
    freshState: freshState,
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = API; }
  if (global) { global.AwakenedDrops = API; }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
