// ─────────────────────────────────────────────────────────────
// simulated-leaderboard.js (v3 Phase 1s — rev v4: 10 fixed bots)
//
// Client-side ONLY. Injects 10 simulated hunters into the live
// leaderboard render so sparse boards still feel populated.
// NEVER sent to the backend, NEVER persisted to localStorage.
//
// Design (rev v4):
//   - FIXED cast of 10 bots. Same 10 names every week, every
//     metric. Each bot has a personality (archetype) that shapes
//     all three of their metrics.
//   - Each bot "moves like a real user":
//       step_total      — accumulates day-by-day through the week.
//                         Each bot has an avgDailySteps + variance;
//                         each day we deterministically roll their
//                         step count, then sum across the days
//                         elapsed so far this week. Monotonic
//                         non-decreasing within the week.
//       sleep_streak    — small integer that nudges by ±1 per
//                         night around the bot's tendency, stable
//                         WITHIN the week (rolled at week start).
//       bedtime_streak  — same shape as sleep_streak.
//   - New week → new daily samples (week boundary = Sunday,
//     device-local). Names + archetypes stay constant across
//     weeks; only the rolled values change.
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

  // ─── THE CAST OF 10 ───────────────────────────────────────
  // Each bot has an archetype that drives ALL three metrics so
  // they feel like a real person, not three independent rolls.
  //
  //   avgDailySteps  — center of the daily step distribution
  //   stepStdDev     — daily variance around that center
  //   sleepBase      — tendency for the sleep ≥7h streak
  //   bedtimeBase    — tendency for the before-midnight streak
  //   sleepJitter    — how much sleep can vary week to week
  //   bedtimeJitter  — same for bedtime
  //
  // Spread across the leaderboard so the board has top performers,
  // a middle band, and a long tail with realistic-feeling streaks.
  const BOTS = [
    // Top tier — high-volume disciplined hunters
    { name: 'ShadowMonarch_K', avgDailySteps: 14200, stepStdDev: 2800, sleepBase: 18, sleepJitter: 4, bedtimeBase: 15, bedtimeJitter: 4 },
    { name: 'AscendantNova',   avgDailySteps: 12500, stepStdDev: 2400, sleepBase: 12, sleepJitter: 3, bedtimeBase: 10, bedtimeJitter: 3 },

    // Strong mid-pack
    { name: 'ghostlift',       avgDailySteps: 10800, stepStdDev: 2200, sleepBase:  9, sleepJitter: 3, bedtimeBase:  7, bedtimeJitter: 2 },
    { name: 'Marcus T.',       avgDailySteps:  9600, stepStdDev: 1900, sleepBase:  7, sleepJitter: 2, bedtimeBase:  5, bedtimeJitter: 2 },
    { name: 'Sienna K.',       avgDailySteps:  8800, stepStdDev: 1700, sleepBase:  6, sleepJitter: 2, bedtimeBase:  6, bedtimeJitter: 2 },

    // Average users
    { name: 'voidwalker_88',   avgDailySteps:  7400, stepStdDev: 1800, sleepBase:  4, sleepJitter: 2, bedtimeBase:  3, bedtimeJitter: 2 },
    { name: 'Jordan F.',       avgDailySteps:  6200, stepStdDev: 1600, sleepBase:  3, sleepJitter: 2, bedtimeBase:  2, bedtimeJitter: 1 },

    // Light / inconsistent
    { name: 'AwakenedRen',     avgDailySteps:  4800, stepStdDev: 1500, sleepBase:  2, sleepJitter: 2, bedtimeBase:  1, bedtimeJitter: 1 },
    { name: 'Priya N.',        avgDailySteps:  3700, stepStdDev: 1300, sleepBase:  1, sleepJitter: 1, bedtimeBase:  1, bedtimeJitter: 1 },

    // Just-starting
    { name: 'nightowl',        avgDailySteps:  2400, stepStdDev: 1100, sleepBase:  0, sleepJitter: 1, bedtimeBase:  0, bedtimeJitter: 1 },
  ];

  // ─── PRNG ─────────────────────────────────────────────────
  function hashKey(str) {
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

  // Standard normal via Box-Muller. Gives us realistic-looking
  // daily step variance (tails fall off naturally).
  function gaussian(rng) {
    const u1 = Math.max(rng(), 1e-9);
    const u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  // ─── Date helpers ─────────────────────────────────────────
  // YYYY-MM-DD of the most recent Sunday (device-local).
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

  // 0 (Sun) through 6 (Sat). Day index within the current week.
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

  // ─── Per-bot daily step roll ──────────────────────────────
  // Deterministic on (weekStartKey, bot.name, dayIdx). Returns
  // a non-negative integer step count for that day.
  function rollBotDayStep(weekStartKey, bot, dayIdx) {
    const seed = hashKey(weekStartKey + '|' + bot.name + '|d' + dayIdx);
    const rng = mulberry32(seed);
    const z = gaussian(rng); // ~N(0,1), typically -3..+3
    let v = bot.avgDailySteps + z * bot.stepStdDev;
    // Most people have a rest day or two — collapse the very-low
    // tail toward 0 so the curve looks human.
    if (v < 1500) v = Math.max(0, v * 0.5);
    if (v < 0) v = 0;
    return Math.round(v);
  }

  // Bot's cumulative step total from Sunday through `dayIdx`
  // inclusive. This is what shows on the leaderboard for the
  // current calendar week. Monotonic non-decreasing as dayIdx
  // grows since each day's roll is ≥ 0.
  function botStepsThroughDay(weekStartKey, bot, dayIdx) {
    let sum = 0;
    for (let d = 0; d <= dayIdx; d++) {
      sum += rollBotDayStep(weekStartKey, bot, d);
    }
    return sum;
  }

  // ─── Per-bot streak roll (week-stable) ────────────────────
  // Streaks barely change day-to-day in real life, so we roll
  // once per week per (bot, metric) and hold steady.
  function rollBotStreak(weekStartKey, bot, metricKey) {
    const base = metricKey === 'sleep_streak' ? bot.sleepBase    : bot.bedtimeBase;
    const jit  = metricKey === 'sleep_streak' ? bot.sleepJitter  : bot.bedtimeJitter;
    const seed = hashKey(weekStartKey + '|' + bot.name + '|' + metricKey);
    const rng = mulberry32(seed);
    // Symmetric jitter: ±jit, with extra mass at 0 (people often
    // sit on the same streak count for many days).
    const r = rng();
    let delta;
    if      (r < 0.40) delta = 0;
    else if (r < 0.70) delta = 1 + Math.floor(rng() * Math.max(1, jit));
    else if (r < 0.92) delta = -(1 + Math.floor(rng() * Math.max(1, jit)));
    else               delta = (rng() < 0.5 ? -1 : 1) * (1 + Math.floor(rng() * (jit + 1)));
    let v = base + delta;
    if (v < 0) v = 0;
    // Cap at a realistic ceiling so no bot reads as superhuman.
    if (v > 30) v = 30;
    return v;
  }

  // ─── Main merge ───────────────────────────────────────────
  function mergeWithSimulated(realTop, realUserAlias, realUserValue, dateKey, metric) {
    metric = metric || 'step_total';
    if (!SIMULATE_USERS) {
      const out = (realTop || []).slice();
      out.forEach((r, i) => { r.rank = i + 1; });
      return out;
    }

    const weekStartKey = getWeekStartKey(dateKey) || dateKey;
    const dow = dayOfWeekIndex(dateKey || weekStartKey, weekStartKey);

    const realValue = (typeof realUserValue === 'number' && realUserValue >= 0)
      ? realUserValue
      : 0;

    const fakes = [];
    for (let i = 0; i < BOTS.length; i++) {
      const bot = BOTS[i];
      let val;
      if (metric === 'step_total') {
        val = botStepsThroughDay(weekStartKey, bot, dow);
      } else if (metric === 'sleep_streak' || metric === 'bedtime_streak') {
        val = rollBotStreak(weekStartKey, bot, metric);
      } else {
        // Unknown metric — skip simulation, return real only.
        const passthrough = (realTop || []).slice();
        passthrough.forEach((r, idx) => { r.rank = idx + 1; });
        return passthrough;
      }
      // Avoid an exact tie with the real user (cosmetic — the
      // gold "ME" row should still feel distinct).
      if (val === realValue) val = metric === 'step_total' ? val + 137 : val + 1;
      fakes.push({ alias: bot.name, current_value: val, _sim: true });
    }

    // Dedupe vs. real entries (real user could share a name with
    // a bot in theory — unlikely but defensive).
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
      BOTS:              BOTS,
      // Exposed for dev / debug / preview QA
      _hashKey:          hashKey,
      _mulberry32:       mulberry32,
      _getWeekStartKey:  getWeekStartKey,
      _dayOfWeekIndex:   dayOfWeekIndex,
      _rollBotDayStep:   rollBotDayStep,
      _botStepsThroughDay: botStepsThroughDay,
      _rollBotStreak:    rollBotStreak,
    };
  }
})();
