// ─────────────────────────────────────────────────────────────
// simulated-leaderboard.js (v3 Phase 1s)
//
// Client-side ONLY. Injects ~9 simulated hunters into the Steps
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
//     realUserStepTotal,       // number — trailing-7-day steps
//     dateKey                  // 'YYYY-MM-DD' device-local
//   ) → merged sorted array of { alias, current_value, rank, _sim? }
//
// Pure function. No DOM, no fetch, no side effects.
// ─────────────────────────────────────────────────────────────

(function () {
  'use strict';

  // ─── KILL SWITCH ──────────────────────────────────────────
  // Flip to false to remove all simulated entries. Top of file
  // by design; the merge wrapper in app.js short-circuits if it
  // sees `false` here.
  const SIMULATE_USERS = true;

  // ─── NAME POOL ────────────────────────────────────────────
  // 25 entries, three styles. The displayed 9 per day are picked
  // deterministically from this pool so the cast rotates day to
  // day — feels more alive than a static set of names.
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

  // How many fakes to inject per render. ~10 total board including
  // the real user. The real user is anchored in the MIDDLE of the
  // pack via nAbove / nBelow below.
  const FAKES_PER_DAY = 9;

  // ─── PRNG ─────────────────────────────────────────────────
  // FNV-1a hash → 32-bit seed → mulberry32. Deterministic.
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

  // Make a step-total look human: never exactly round, slight jitter.
  function humanize(rng, base) {
    let v = Math.round(base);
    // Strip the last two zeros for "perfect" multiples.
    if (v % 1000 === 0) v += Math.floor(rng() * 900) + 31;
    else if (v % 100 === 0) v += Math.floor(rng() * 90) + 7;
    return v;
  }

  function mergeWithSimulated(realTop, realUserAlias, realUserStepTotal, dateKey) {
    if (!SIMULATE_USERS) {
      // Return realTop as-is with ranks normalized so the renderer
      // doesn't have to think about it.
      const out = (realTop || []).slice();
      out.forEach((r, i) => { r.rank = i + 1; });
      return out;
    }

    const rng = mulberry32(hashDateKey(dateKey));

    // Pick FAKES_PER_DAY names from the 25-pool deterministically.
    const pool = NAME_POOL.slice();
    shuffleInPlace(pool, rng);
    const picked = pool.slice(0, FAKES_PER_DAY);

    // Anchor: the real user's current value. If they have nothing
    // submitted yet, pretend they're a baseline hunter so the board
    // still surrounds a sensible number.
    const realValue = (typeof realUserStepTotal === 'number' && realUserStepTotal > 0)
      ? realUserStepTotal
      : 28000;

    // How many fakes above the user. Default 2–3. If the user is
    // Goggins-tier (well above the typical 4–18k human range), pull
    // most/all fakes below them so the board doesn't lie about how
    // far ahead they are.
    let nAbove;
    if (realValue > 60000)      nAbove = 0;
    else if (realValue > 35000) nAbove = Math.floor(rng() * 2);       // 0 or 1
    else                        nAbove = 2 + Math.floor(rng() * 2);   // 2 or 3
    const nBelow = FAKES_PER_DAY - nAbove;

    const fakes = [];

    // ABOVE — 5%-25% higher than anchor. Cap below ~20k when the
    // anchor is in the typical human range so the top of the board
    // doesn't read as cartoon-Goggins. When anchor is already high,
    // fakes scale proportionally.
    for (let i = 0; i < nAbove; i++) {
      const factor = 1.05 + rng() * 0.20;
      let val = humanize(rng, realValue * factor);
      if (realValue < 18000 && val > 19500) {
        val = 19500 - Math.floor(rng() * 1500);
      }
      if (val === realValue) val += 137;
      fakes.push({ alias: picked[i], current_value: val, _sim: true });
    }

    // BELOW — 10%-60% lower than anchor. Floor at ~3500 so we don't
    // pad the bottom with corpses.
    for (let i = 0; i < nBelow; i++) {
      const downFactor = 0.10 + rng() * 0.50;
      let val = humanize(rng, realValue * (1 - downFactor));
      if (val < 3500) val = 3500 + Math.floor(rng() * 2000);
      if (val === realValue) val -= 211;
      fakes.push({ alias: picked[nAbove + i], current_value: val, _sim: true });
    }

    // Ensure no duplicate aliases vs. realTop. (Aliases in the pool
    // are stylized enough that backend collisions are unlikely, but
    // a real user signing up as "nightowl" shouldn't double-render.)
    const realAliases = new Set((realTop || []).map(r => r && r.alias).filter(Boolean));
    const dedupedFakes = fakes.filter(f => !realAliases.has(f.alias));

    // Merge + sort descending by value.
    const merged = (realTop || []).slice().concat(dedupedFakes);

    // If the real user isn't in realTop (out-of-top-N), inject them
    // so they actually appear on the visible board. The wrapper in
    // app.js could do this too, but doing it here keeps the merge
    // function self-contained.
    if (realUserAlias && realValue > 0 &&
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

  // ─── PUBLIC API ───────────────────────────────────────────
  if (typeof window !== 'undefined') {
    window.SimulatedLeaderboard = {
      SIMULATE_USERS: SIMULATE_USERS,
      merge:          mergeWithSimulated,
      NAME_POOL:      NAME_POOL,
      // Exposed for console debug / sanity-check dumps.
      _hashDateKey:   hashDateKey,
      _mulberry32:    mulberry32,
    };
  }
})();
