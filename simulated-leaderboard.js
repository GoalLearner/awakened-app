// ─────────────────────────────────────────────────────────────
// simulated-leaderboard.js (v3 Phase 1s, v2 — all 3 metrics)
//
// Client-side ONLY. Injects ~9 simulated hunters into the
// leaderboard render so an empty / near-empty board still feels
// alive. NEVER sent to the backend, NEVER persisted to localStorage
// or IndexedDB. Fresh each render; "day-to-day variation" comes
// from a deterministic PRNG seeded off the local calendar date, so
// within one day the same fakes show the same numbers across page
// reloads.
//
// Kill switch: flip SIMULATE_USERS below to `false` to remove all
// fakes instantly. No config dance.
//
// Public API:
//   window.SimulatedLeaderboard.merge(
//     realTop,                 // [{ alias, current_value, rank? }, …]
//     realUserAlias,           // string | null
//     realUserValue,           // number — value for `metric`
//     dateKey,                 // 'YYYY-MM-DD' device-local
//     metric                   // 'step_total' | 'sleep_streak' | 'bedtime_streak'
//   ) → merged sorted array of { alias, current_value, rank, _sim? }
//
// Pure function. No DOM, no fetch, no side effects.
// ─────────────────────────────────────────────────────────────

(function () {
  'use strict';

  // ─── KILL SWITCH ──────────────────────────────────────────
  const SIMULATE_USERS = true;

  // ─── NAME POOL ────────────────────────────────────────────
  // 25 entries, three styles. The displayed 9 per day per metric
  // are picked deterministically — same date + same metric picks
  // the same names; different metrics on the same day rotate.
  const NAME_POOL = [
    // Style A — gamer / handle (9)
    'immortalshadow', 'voidwalker_88', 'nightowl', 'xX_ronin_Xx',
    'kaiser_void', 'phantom_eclipse', 'ghostlift', 'drift_protocol',
    'silent_strider',
    // Style B — realistic first-name-ish (9)
    'Marcus T.', 'Sienna K.', 'Diego R.', 'Priya N.', 'Tomás L.',
    'Aisha B.', 'Caleb W.', 'Mei H.', 'Jordan F.',
    // Style C — Solo Leveling / RPG flavored (7)
    'ShadowMonarch_K', 'IronWillVII', 'AwakenedRen', 'S-Rank_Yusuf',
    'SungJoonClone', 'AscendantNova', 'BladeOfDawn',
  ];

  const FAKES_PER_DAY = 9;

  // Per-metric tuning. step_total uses anchor-relative multipliers;
  // streak metrics use small integers because real users live
  // mostly in the 0–14 range with rare outliers.
  const METRIC_CONFIG = {
    step_total: {
      kind: 'continuous',
      fallbackAnchor: 28000,
    },
    sleep_streak: {
      kind: 'streak',
      fallbackAnchor: 3,
      typicalMax: 21,   // cap "elite" fakes here unless anchor exceeds
    },
    bedtime_streak: {
      kind: 'streak',
      fallbackAnchor: 3,
      typicalMax: 21,
    },
  };

  // ─── PRNG ─────────────────────────────────────────────────
  function hashDateKey(str) {
    let h = 2166136261 >>> 0;
    const s = String(str || 'unknown');
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffleInPlace(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
  }

  // ─── Value generation per metric ──────────────────────────
  // step_total: anchor-relative, humanized (no perfect round)
  function humanizeSteps(rng, base) {
    let v = Math.round(base);
    if (v % 1000 === 0)      v += Math.floor(rng() * 900) + 31;
    else if (v % 100 === 0)  v += Math.floor(rng() * 90)  + 7;
    return v;
  }
  function stepsAbove(rng, anchor) {
    const factor = 1.05 + rng() * 0.20;
    let val = humanizeSteps(rng, anchor * factor);
    if (anchor < 18000 && val > 19500) val = 19500 - Math.floor(rng() * 1500);
    if (val === anchor) val += 137;
    return val;
  }
  function stepsBelow(rng, anchor) {
    const downFactor = 0.10 + rng() * 0.50;
    let val = humanizeSteps(rng, anchor * (1 - downFactor));
    if (val < 3500)        val = 3500 + Math.floor(rng() * 2000);
    if (val === anchor)    val -= 211;
    return val;
  }

  // Streak metrics: small integers, distribution shaped to feel
  // like a real population. Most fakes near anchor; a few outliers
  // to make the board feel alive.
  function streakAbove(rng, anchor, typicalMax) {
    // New / low-streak users (anchor < 3): pull from a realistic
    // distribution skewed toward small streaks, occasional outlier.
    if (anchor < 3) {
      const r = rng();
      if (r < 0.30) return 1 + Math.floor(rng() * 2);                  // 1–2
      if (r < 0.65) return 3 + Math.floor(rng() * 3);                  // 3–5
      if (r < 0.88) return 6 + Math.floor(rng() * 5);                  // 6–10
      if (r < 0.97) return 11 + Math.floor(rng() * 5);                 // 11–15
      return 16 + Math.floor(rng() * Math.max(1, typicalMax - 15));    // 16–typicalMax
    }
    // Established streak: above = anchor + 1 to anchor + 5, capped
    // by typicalMax + a small bonus for outliers.
    const bump = 1 + Math.floor(rng() * 5);
    let val = anchor + bump;
    const ceiling = Math.max(typicalMax, anchor + 6);
    if (val > ceiling) val = ceiling;
    if (val === anchor) val = anchor + 1;
    return val;
  }
  function streakBelow(rng, anchor) {
    if (anchor < 2) return 0; // can't go below 0
    // Subtract 1 to (anchor) — produces a mix of 0..(anchor-1).
    const drop = 1 + Math.floor(rng() * anchor);
    let val = anchor - drop;
    if (val < 0) val = 0;
    if (val === anchor) val = Math.max(0, anchor - 1);
    return val;
  }

  // ─── Above/Below split ────────────────────────────────────
  function pickSplit(rng, metric, anchor) {
    const cfg = METRIC_CONFIG[metric];
    if (cfg.kind === 'continuous') {
      // step_total — preserves the Goggins guard from v1.
      let nAbove;
      if (anchor > 60000)      nAbove = 0;
      else if (anchor > 35000) nAbove = Math.floor(rng() * 2);
      else                     nAbove = 2 + Math.floor(rng() * 2);
      return { nAbove: nAbove, nBelow: FAKES_PER_DAY - nAbove };
    }
    // streaks: new users (anchor < 3) sit near the BOTTOM with most
    // fakes above. Established streaks get the 2–3 above / rest below
    // split, with a Goggins cap at 25+ nights.
    if (anchor < 3) {
      const nAbove = 7 + Math.floor(rng() * 2); // 7 or 8
      return { nAbove: nAbove, nBelow: FAKES_PER_DAY - nAbove };
    }
    let nAbove;
    if (anchor > 30)      nAbove = 0;
    else if (anchor > 18) nAbove = Math.floor(rng() * 2);
    else                  nAbove = 2 + Math.floor(rng() * 2);
    return { nAbove: nAbove, nBelow: FAKES_PER_DAY - nAbove };
  }

  // ─── Main merge ───────────────────────────────────────────
  function mergeWithSimulated(realTop, realUserAlias, realUserValue, dateKey, metric) {
    metric = metric || 'step_total';
    const cfg = METRIC_CONFIG[metric];
    if (!cfg) {
      const out = (realTop || []).slice();
      out.forEach((r, i) => { r.rank = i + 1; });
      return out;
    }

    if (!SIMULATE_USERS) {
      const out = (realTop || []).slice();
      out.forEach((r, i) => { r.rank = i + 1; });
      return out;
    }

    // Seed includes the metric name so the 3 boards rotate through
    // DIFFERENT subsets of the 25-name pool on the same day —
    // otherwise "immortalshadow" would always lead all three.
    const rng = mulberry32(hashDateKey(dateKey + '|' + metric));

    const pool = NAME_POOL.slice();
    shuffleInPlace(pool, rng);
    const picked = pool.slice(0, FAKES_PER_DAY);

    // Two distinct concepts:
    //  - realValue: what the user actually has (may be 0). This is
    //    what gets shown next to their alias.
    //  - anchor: what we use to shape the fakes. Falls back to the
    //    metric's typical baseline when the user has zero progress
    //    so the surrounding fakes still feel like a real population
    //    instead of a wall of zeros.
    const realValue = (typeof realUserValue === 'number' && realUserValue >= 0)
      ? realUserValue
      : 0;
    const anchor = realValue > 0 ? realValue : cfg.fallbackAnchor;

    const { nAbove, nBelow } = pickSplit(rng, metric, anchor);
    const fakes = [];

    for (let i = 0; i < nAbove; i++) {
      let val;
      if (cfg.kind === 'continuous') val = stepsAbove(rng, anchor);
      else                            val = streakAbove(rng, anchor, cfg.typicalMax);
      fakes.push({ alias: picked[i], current_value: val, _sim: true });
    }
    for (let i = 0; i < nBelow; i++) {
      let val;
      if (cfg.kind === 'continuous') val = stepsBelow(rng, anchor);
      else                            val = streakBelow(rng, anchor);
      fakes.push({ alias: picked[nAbove + i], current_value: val, _sim: true });
    }

    // Dedupe vs. real entries to avoid double-rendering an alias.
    const realAliases = new Set((realTop || []).map(r => r && r.alias).filter(Boolean));
    const dedupedFakes = fakes.filter(f => !realAliases.has(f.alias));

    const merged = (realTop || []).slice().concat(dedupedFakes);

    // Inject the real user themselves if they're not in realTop
    // (out-of-top-N case). The wrapper in app.js depends on the
    // user appearing in the merged list so the "your rank #N" row
    // suppresses correctly.
    if (realUserAlias && realUserValue !== undefined && realUserValue !== null &&
        !realAliases.has(realUserAlias)) {
      merged.push({
        alias: realUserAlias,
        current_value: realValue,
        _injectedSelf: true,
      });
    }

    merged.sort((a, b) => (b.current_value || 0) - (a.current_value || 0));
    merged.forEach((row, i) => { row.rank = i + 1; });

    return merged;
  }

  if (typeof window !== 'undefined') {
    window.SimulatedLeaderboard = {
      SIMULATE_USERS: SIMULATE_USERS,
      merge:          mergeWithSimulated,
      NAME_POOL:      NAME_POOL,
      _hashDateKey:   hashDateKey,
      _mulberry32:    mulberry32,
    };
  }
})();
