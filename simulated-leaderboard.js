// ─────────────────────────────────────────────────────────────
// simulated-leaderboard.js (v3 Phase 1s, v3 — weekly stable)
//
// Client-side ONLY. Injects ~9 simulated hunters into the live
// leaderboard render so sparse boards still feel populated.
// NEVER sent to the backend, NEVER persisted to localStorage.
// Fresh each render; deterministic per-week per-metric.
//
// v3 change (vs v2): seed is now WEEK + metric, not DAY + metric.
// Roster + per-fake parameters stay stable for a whole leaderboard
// week (Sunday → Saturday device-local). Reseeds at week boundary.
//
// For step_total:
//   - Stable roster + per-fake factor + per-fake profile per week
//   - Display = userProjectedFinal × factor × profile[dayOfWeek]
//   - Values grow monotonically through the week as the user's
//     own step total accumulates
//
// For sleep_streak / bedtime_streak:
//   - Stable roster + stable values per week
//   - Streaks are inherently small integers that change slowly;
//     reseeding once per week is more realistic than daily.
//
// Kill switch: flip SIMULATE_USERS below to `false`.
//
// Public API:
//   window.SimulatedLeaderboard.merge(
//     realTop,                 // [{ alias, current_value, rank? }, …]
//     realUserAlias,           // string | null
//     realUserValue,           // number — current value for `metric`
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
  // 25 entries, three styles. The displayed 9 per WEEK are picked
  // deterministically from this pool. Different weeks rotate.
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

  const FAKES_PER_WEEK = 9;

  // Per-metric tuning. step_total uses anchor-relative projection;
  // streak metrics use small integers because real users live
  // mostly in the 0–14 range with rare outliers.
  const METRIC_CONFIG = {
    step_total: {
      kind: 'continuous',
      fallbackAnchor: 28000, // when real user has 0 steps yet this week
    },
    sleep_streak: {
      kind: 'streak',
      fallbackAnchor: 3,
      typicalMax: 21,
    },
    bedtime_streak: {
      kind: 'streak',
      fallbackAnchor: 3,
      typicalMax: 21,
    },
  };

  // ─── Step distribution model ──────────────────────────────
  // Each fake's display follows: display = anchor × factor, where
  // factor is per-fake and stable per week. This makes display
  // grow proportionally with the user's accumulating step total
  // and guarantees no fake's value EVER decreases within the week
  // (anchor is monotonic non-decreasing as the user walks).
  //
  // We tried per-fake activity profiles (even / weekend-warrior /
  // early-week) in early iteration but it introduced ~5-10% dips
  // for some fakes mid-week — the projected-final-target math
  // doesn't stay monotonic across all profile shapes when the
  // user's pace shifts. Spec says "values must never decrease",
  // so we drop the profile layer. Realism comes from factor
  // spread alone (0.40-1.30 range = 90 percentage points), which
  // gives plenty of natural variation between fakes.

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

  // ─── Date helpers ─────────────────────────────────────────
  // YYYY-MM-DD of the most recent Sunday (device-local). Aligns
  // with the backend's leaderboard week boundary per CLAUDE.md
  // ("Total steps from Sunday 12:00 AM through Saturday 11:59 PM").
  function getWeekStartKey(dateKey) {
    if (!dateKey || typeof dateKey !== 'string') return null;
    const m = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
    if (isNaN(d.getTime())) return null;
    const dow = d.getDay(); // 0=Sun, 6=Sat
    d.setDate(d.getDate() - dow);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return yyyy + '-' + mm + '-' + dd;
  }

  // 0 (Sun) through 6 (Sat). Day index within the leaderboard week.
  function dayOfWeekIndex(dateKey, weekStartKey) {
    if (!dateKey || !weekStartKey) return 0;
    const md = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const ms = weekStartKey.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!md || !ms) return 0;
    const dDate = new Date(Number(md[1]), Number(md[2]) - 1, Number(md[3]), 12, 0, 0);
    const sDate = new Date(Number(ms[1]), Number(ms[2]) - 1, Number(ms[3]), 12, 0, 0);
    const diff = Math.round((dDate.getTime() - sDate.getTime()) / 86400000);
    return Math.max(0, Math.min(6, diff));
  }

  // ─── Humanize numeric output ──────────────────────────────
  function humanize(rng, base) {
    let v = Math.round(base);
    if (v < 100) return v;
    if (v % 1000 === 0)      v += Math.floor(rng() * 900) + 31;
    else if (v % 100 === 0)  v += Math.floor(rng() * 90)  + 7;
    return v;
  }

  // ─── Streak helpers (unchanged from v2) ───────────────────
  function streakAbove(rng, anchor, typicalMax) {
    if (anchor < 3) {
      const r = rng();
      if (r < 0.30) return 1 + Math.floor(rng() * 2);
      if (r < 0.65) return 3 + Math.floor(rng() * 3);
      if (r < 0.88) return 6 + Math.floor(rng() * 5);
      if (r < 0.97) return 11 + Math.floor(rng() * 5);
      return 16 + Math.floor(rng() * Math.max(1, typicalMax - 15));
    }
    const bump = 1 + Math.floor(rng() * 5);
    let val = anchor + bump;
    const ceiling = Math.max(typicalMax, anchor + 6);
    if (val > ceiling) val = ceiling;
    if (val === anchor) val = anchor + 1;
    return val;
  }
  function streakBelow(rng, anchor) {
    if (anchor < 2) return 0;
    const drop = 1 + Math.floor(rng() * anchor);
    let val = anchor - drop;
    if (val < 0) val = 0;
    if (val === anchor) val = Math.max(0, anchor - 1);
    return val;
  }

  // ─── Above/Below split (unchanged) ────────────────────────
  function pickSplit(rng, metric, anchor) {
    const cfg = METRIC_CONFIG[metric];
    if (cfg.kind === 'continuous') {
      let nAbove;
      if (anchor > 60000)      nAbove = 0;
      else if (anchor > 35000) nAbove = Math.floor(rng() * 2);
      else                     nAbove = 2 + Math.floor(rng() * 2);
      return { nAbove: nAbove, nBelow: FAKES_PER_WEEK - nAbove };
    }
    if (anchor < 3) {
      const nAbove = 7 + Math.floor(rng() * 2);
      return { nAbove: nAbove, nBelow: FAKES_PER_WEEK - nAbove };
    }
    let nAbove;
    if (anchor > 30)      nAbove = 0;
    else if (anchor > 18) nAbove = Math.floor(rng() * 2);
    else                  nAbove = 2 + Math.floor(rng() * 2);
    return { nAbove: nAbove, nBelow: FAKES_PER_WEEK - nAbove };
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

    // Week boundary alignment — Sunday start, device-local.
    const weekStartKey = getWeekStartKey(dateKey) || dateKey;
    const dow = dayOfWeekIndex(dateKey || weekStartKey, weekStartKey);

    // ROSTER seed — stable for the entire week + metric. This
    // pins names for the whole week so the cast doesn't churn.
    const rosterRng = mulberry32(hashDateKey(weekStartKey + '|' + metric + '|roster'));
    const pool = NAME_POOL.slice();
    shuffleInPlace(pool, rosterRng);
    const picked = pool.slice(0, FAKES_PER_WEEK);

    // VALUE seed — also stable per week per metric. Factor +
    // profile choices are the same on Mon as on Sat for a given
    // fake. Display value moves through the week because:
    //   1. The user's anchor accumulates (more steps each day)
    //   2. The profile's cumulative fraction grows from Sun→Sat
    const valueRng = mulberry32(hashDateKey(weekStartKey + '|' + metric + '|values'));

    // Two distinct concepts:
    //   - realValue: what the user actually has (may be 0). Shown.
    //   - anchor: what we use to shape the fakes. Falls back to
    //     the metric baseline when the user has no progress so
    //     surrounding fakes feel like a real population.
    const realValue = (typeof realUserValue === 'number' && realUserValue >= 0)
      ? realUserValue
      : 0;
    const anchor = realValue > 0 ? realValue : cfg.fallbackAnchor;

    const { nAbove, nBelow } = pickSplit(valueRng, metric, anchor);
    const fakes = [];

    if (cfg.kind === 'continuous') {
      // ── Step total — accumulating display through the week ──
      // Each fake's display = anchor × factor (factor per-fake,
      // stable per week). Anchor accumulates daily as the user
      // walks → fake displays grow proportionally. Guaranteed
      // monotonic per-fake: if anchor[today] ≥ anchor[yesterday],
      // then display[today] ≥ display[yesterday].

      for (let i = 0; i < nAbove; i++) {
        const factor = 1.05 + valueRng() * 0.25; // 1.05–1.30
        let val = humanize(valueRng, anchor * factor);
        // Goggins guard — cap absolute size when anchor is in the
        // typical human range so fakes don't read as cartoonish.
        if (anchor < 18000 && val > 19500) {
          val = 19500 - Math.floor(valueRng() * 1500);
        }
        if (val === realValue) val += 137;
        fakes.push({ alias: picked[i], current_value: val, _sim: true });
      }

      for (let i = 0; i < nBelow; i++) {
        const factor = 0.40 + valueRng() * 0.50; // 0.40–0.90
        let val = humanize(valueRng, anchor * factor);
        // Floor early-week values so the board doesn't drown in
        // very-small numbers on Sunday morning (when anchor is small).
        if (val < 200) val = 200 + Math.floor(valueRng() * 1500);
        if (val === realValue) val -= 211;
        fakes.push({ alias: picked[nAbove + i], current_value: val, _sim: true });
      }
    } else {
      // ── Streak — stable values for the entire week ──
      // Streaks are small integers that change slowly. We reseed
      // at week boundary; values stay the same all week. This is
      // more realistic than daily reshuffling for a metric where
      // real users' values change by 0 or 1 per night.
      for (let i = 0; i < nAbove; i++) {
        const val = streakAbove(valueRng, anchor, cfg.typicalMax);
        fakes.push({ alias: picked[i], current_value: val, _sim: true });
      }
      for (let i = 0; i < nBelow; i++) {
        const val = streakBelow(valueRng, anchor);
        fakes.push({ alias: picked[nAbove + i], current_value: val, _sim: true });
      }
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
      SIMULATE_USERS:    SIMULATE_USERS,
      merge:             mergeWithSimulated,
      NAME_POOL:         NAME_POOL,
      // Exposed for dev / debug / preview QA
      _hashDateKey:      hashDateKey,
      _mulberry32:       mulberry32,
      _getWeekStartKey:  getWeekStartKey,
      _dayOfWeekIndex:   dayOfWeekIndex,
    };
  }
})();
