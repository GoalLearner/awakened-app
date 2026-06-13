// ─────────────────────────────────────────────────────────────
// simulated-leaderboard.js (v3 Phase 1z.37 — rev v6: HoF filler)
//
// Client-side ONLY. Injects 10 simulated hunters into the live
// leaderboard render so sparse boards still feel populated.
// NEVER sent to the backend, NEVER persisted to localStorage.
//
// v5 / Phase 1z.35 changes:
//   - Hard cap: no simulated weekly step total exceeds
//     SIM_STEP_WEEKLY_CAP (45,555). This is well below the
//     100K Step Club threshold (100,000) so bots can never
//     visually qualify for that accolade.
//   - Bot cast retuned across the four suggested bands so the
//     natural distribution feels realistic and spread out
//     instead of saturating the cap:
//       Light (2k–8k) · Normal (8k–22k) · Active (22k–36k)
//       · High but realistic (36k–45,555)
//   - Determinism + seeded PRNG layout unchanged. Same week
//     produces the same totals before and after — only the
//     bots' avgDailySteps / stepStdDev shifted and the
//     cumulative is clamped to the cap at the end.
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

  // ─── HARD CAP — v3 Phase 1z.35 ────────────────────────────
  // No simulated weekly step total is ever allowed to exceed
  // this number. Well below the 100K Step Club threshold so
  // bots can never appear to be chasing or qualifying for the
  // accolade. Single source of truth — both the cumulative
  // clamp in botStepsThroughDay() and the post-tie-bump clamp
  // in the merge reference this constant.
  const SIM_STEP_WEEKLY_CAP = 45555;

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
  // v5 retune (Phase 1z.35): avgDailySteps lowered so the natural
  // 7-day mean spreads across the four product-spec bands instead
  // of saturating the cap. Approximate weekly means at avg×7:
  //   ShadowMonarch_K  ~40,600   (High but realistic)
  //   AscendantNova    ~36,400   (High but realistic)
  //   ghostlift        ~30,800   (Active)
  //   Marcus T.        ~25,900   (Active)
  //   Sienna K.        ~23,100   (Active / Normal)
  //   voidwalker_88    ~18,200   (Normal)
  //   Jordan F.        ~14,700   (Normal)
  //   AwakenedRen      ~10,500   (Normal)
  //   Priya N.         ~7,000    (Light)
  //   nightowl         ~3,850    (Light)
  // The hard SIM_STEP_WEEKLY_CAP clamp catches the high tail of
  // top-tier bots so they can never exceed 45,555 even on a
  // luckiest-week-ever roll.
  // v3 Phase 1z.125 — flightsBase / flightsJitter slots added to
  // each archetype.
  // v3 Phase 1z.128 — retuned DOWN to match realistic Apple Health
  // flights-climbed data. Old ranges (athletes ≈ 250 ± 80) made the
  // top of the board show 300+ flights/week, dwarfing real users
  // whose Health-recorded totals sit in the 20-50 range. New ranges
  // keep the cast competitive with real users while never exceeding
  // the FLIGHTS_SIM_WEEKLY_CAP of 50 flights/week. Bases chosen so
  // the deterministic Sat-of-week (full-progress) value lands near
  // the target distribution { 49, 43, 36, 29, 22, 16, 11, 7, 3, 0 }
  // with natural wobble. Backend cap remains 1000 for real users.
  const BOTS = [
    // Top tier — competitive with high-real-user weeks (40-50)
    { name: 'ShadowMonarch_K', floorBase: 92, avgDailySteps: 5800, stepStdDev: 900, sleepBase: 18, sleepJitter: 4, bedtimeBase: 15, bedtimeJitter: 4, flightsBase: 52, flightsJitter: 6, title: 'rt_duelist' },
    { name: 'AscendantNova', floorBase: 84,   avgDailySteps: 5200, stepStdDev: 850, sleepBase: 12, sleepJitter: 3, bedtimeBase: 10, bedtimeJitter: 3, flightsBase: 42, flightsJitter: 6, title: 'rt_contender' },

    // Active — stairs-heavy week but not extreme (25-40)
    { name: 'ghostlift', floorBase: 76,       avgDailySteps: 4400, stepStdDev: 800, sleepBase:  9, sleepJitter: 3, bedtimeBase:  7, bedtimeJitter: 2, flightsBase: 33, flightsJitter: 6, title: 'rt_blade' },
    { name: 'Marcus T.', floorBase: 68,       avgDailySteps: 3700, stepStdDev: 750, sleepBase:  7, sleepJitter: 2, bedtimeBase:  5, bedtimeJitter: 2, flightsBase: 26, flightsJitter: 5 },
    { name: 'Sienna K.', floorBase: 61,       avgDailySteps: 3300, stepStdDev: 700, sleepBase:  6, sleepJitter: 2, bedtimeBase:  6, bedtimeJitter: 2, flightsBase: 20, flightsJitter: 5, title: 'rt_brawler' },

    // Normal — moderate stair use (10-25)
    { name: 'voidwalker_88', floorBase: 53,   avgDailySteps: 2600, stepStdDev: 650, sleepBase:  4, sleepJitter: 2, bedtimeBase:  3, bedtimeJitter: 2, flightsBase: 14, flightsJitter: 4, title: 'rt_brawler' },
    { name: 'Jordan F.', floorBase: 45,       avgDailySteps: 2100, stepStdDev: 600, sleepBase:  3, sleepJitter: 2, bedtimeBase:  2, bedtimeJitter: 1, flightsBase: 10, flightsJitter: 3 },
    { name: 'AwakenedRen', floorBase: 33,     avgDailySteps: 1500, stepStdDev: 500, sleepBase:  2, sleepJitter: 2, bedtimeBase:  1, bedtimeJitter: 1, flightsBase:  6, flightsJitter: 3 },

    // Light / sedentary — minimal stair use (0-10)
    { name: 'Priya N.', floorBase: 22,        avgDailySteps: 1000, stepStdDev: 400, sleepBase:  1, sleepJitter: 1, bedtimeBase:  1, bedtimeJitter: 1, flightsBase:  3, flightsJitter: 2 },
    { name: 'nightowl', floorBase: 11,        avgDailySteps:  550, stepStdDev: 300, sleepBase:  0, sleepJitter: 1, bedtimeBase:  0, bedtimeJitter: 1, flightsBase:  1, flightsJitter: 2 },
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
  // v3 Phase 1z.35 -- hard cap at SIM_STEP_WEEKLY_CAP. Single
  // source of truth for the bot weekly ceiling; well below the
  // 100K Step Club threshold so a bot can never visually
  // qualify for that accolade no matter how lucky the rolls.
  function botStepsThroughDay(weekStartKey, bot, dayIdx) {
    let sum = 0;
    for (let d = 0; d <= dayIdx; d++) {
      sum += rollBotDayStep(weekStartKey, bot, d);
    }
    if (sum > SIM_STEP_WEEKLY_CAP) sum = SIM_STEP_WEEKLY_CAP;
    return sum;
  }

  // v3 Phase 1z.125 — bot weekly flights climbed. Continuous
  // distribution like steps (not an integer streak). Uses the
  // (flightsBase, flightsJitter) archetype slots. Weekly total
  // ramps proportionally with the day-of-week index (Sun=0,
  // Sat=6) so the leaderboard climbs through the week.
  //
  // v3 Phase 1z.128 — clamped to FLIGHTS_SIM_WEEKLY_CAP (50)
  // INSTEAD of the backend metric cap (1000). The backend cap is
  // anti-corruption defense for real values; the sim cap reflects
  // realistic human stair-climbing in a week and keeps the
  // leaderboard credible against real Apple Health data (which for
  // most users sits at 20-50 flights/week even when active).
  // Backend cap of 1000 still applies to real-user submits via
  // app.js LB_CLIENT_CAPS / backend metrics.ts.
  const FLIGHTS_SIM_WEEKLY_CAP = 50;
  // Legacy export name retained for backwards compat — was the old
  // backend-aligned cap. Now equals FLIGHTS_SIM_WEEKLY_CAP.
  const FLIGHTS_WEEKLY_CAP = FLIGHTS_SIM_WEEKLY_CAP;
  function botFlightsThroughDay(weekStartKey, bot, dayIdx) {
    const seed = hashKey(weekStartKey + '|' + bot.name + '|flights');
    const rng = mulberry32(seed);
    // Weekly total this archetype would hit by Saturday — sample
    // once per (bot, week). Symmetric jitter around flightsBase.
    const base = bot.flightsBase || 0;
    const jit  = bot.flightsJitter || 0;
    const weeklyTotal = Math.max(0, Math.round(base + (rng() * 2 - 1) * jit));
    // Scale by progress through the week. dayIdx 0 (Sunday) → 1/7;
    // dayIdx 6 (Saturday) → full weekly total. Slight rng wobble
    // so the ramp doesn't feel mechanical.
    const progress = Math.max(1, dayIdx + 1) / 7;
    const wobble = 0.85 + rng() * 0.3;
    let v = Math.round(weeklyTotal * progress * wobble);
    if (v < 0) v = 0;
    if (v > FLIGHTS_SIM_WEEKLY_CAP) v = FLIGHTS_SIM_WEEKLY_CAP;
    return v;
  }

  // ─── Per-bot streak roll (week-stable) ────────────────────
  // Streaks barely change day-to-day in real life, so we roll
  // once per week per (bot, metric) and hold steady.
  function rollBotStreak(weekStartKey, bot, metricKey) {
    // v3 Phase 1z.118 — workout_streak replaces bedtime_streak. Both
    // are small-integer streak metrics with the same jitter shape;
    // reuse the bedtime base/jitter slots so the BOTS table doesn't
    // need to grow. (The slots are personality-archetype-driven and
    // were never tied to the "before midnight" semantics — they just
    // produce realistic small-integer streak values.)
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

  // ─── Per-bot best floor (W274 — all-time, name-stable) ─────
  // floor_best is the highest Ascent floor ever cleared, so unlike
  // the weekly metrics it does NOT reshuffle by week — seed by bot
  // name alone and hold steady. Clamped to [1, 96] so the tie-bump
  // can't nudge a bot to 100 (the summit stays a real-player honor).
  function botFloorBest(bot) {
    const base = bot.floorBase || 0;
    const rng = mulberry32(hashKey(bot.name + '|floor_best'));
    const jit = Math.floor(rng() * 5) - 2;   // ±2 stable wobble
    let v = base + jit;
    if (v < 1) v = 1;
    if (v > 96) v = 96;
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
      } else if (metric === 'flights_climbed') {
        // v3 Phase 1z.125 — continuous-distribution weekly flights.
        val = botFlightsThroughDay(weekStartKey, bot, dow);
      } else if (metric === 'floor_best') {
        // W274 — highest Ascent floor ever cleared (name-stable, ≤96).
        val = botFloorBest(bot);
      } else if (metric === 'sleep_streak' || metric === 'bedtime_streak' || metric === 'workout_streak') {
        // v3 Phase 1z.118 — workout_streak joins the streak family.
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
      // v3 Phase 1z.35 -- defense-in-depth: re-clamp after the
      // tie-bump so a bot already at the cap (e.g. saturated)
      // can't be nudged 137 over by the tie-breaker.
      if (metric === 'step_total' && val > SIM_STEP_WEEKLY_CAP) val = SIM_STEP_WEEKLY_CAP;
      // W257 — modest Arena-title chips on some bots (apex titles never simulated)
      fakes.push({ alias: bot.name, current_value: val, _sim: true, arena_title: bot.title || null });
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

  // ─── Weekly Steps Hall of Fame — client-side filler ─────────
  // v3 Phase 1z.37 — spec correction: fake users CAN appear in the
  // Hall of Fame so the board doesn't look empty at launch. They
  // remain capped at SIM_STEP_WEEKLY_CAP (45,555), are NEVER
  // persisted to D1, NEVER affect me_best, and are merged into the
  // display by app.js on top of the real backend response.
  //
  // Determinism: same `dateKey` (week) produces the same fake
  // records on every load. A page reload doesn't reshuffle. Past
  // weeks are seeded by (weekStartKey + bot.name + 'hof') so each
  // (bot, week) pair has a stable rolled value.
  //
  // Distribution: each top-tier bot contributes 2 records (their
  // best 2 of the last PAST_WEEKS), every other bot contributes
  // 1 record (their best of the last PAST_WEEKS). ~12 fake rows
  // total — enough to populate, few enough to leave room for real
  // records to dominate as they appear.
  const HOF_PAST_WEEKS  = 8;
  const HOF_TOP_TIER_COUNT = 2;          // bots index 0..1 → 2 records each
  const HOF_PER_BOT_DEFAULT = 1;

  // Saturday-UTC YYYY-MM-DD given the Sunday-UTC week_start.
  function _weekEndFromStart(weekStart) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(weekStart);
    if (!m) return weekStart;
    const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
             + 6 * 24 * 60 * 60 * 1000;
    const d = new Date(ms);
    const yyyy = d.getUTCFullYear();
    const mm   = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd   = String(d.getUTCDate()).padStart(2, '0');
    return yyyy + '-' + mm + '-' + dd;
  }

  // Build the list of past Sunday-UTC week keys: 1..HOF_PAST_WEEKS
  // BEFORE the current week (current week excluded so HoF reflects
  // completed weeks). Returns YYYY-MM-DD strings in any order.
  function _pastWeekStartsUTC(currentWeekKey) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(currentWeekKey || '');
    if (!m) return [];
    const baseMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const out = [];
    for (let i = 1; i <= HOF_PAST_WEEKS; i++) {
      const ms = baseMs - i * 7 * 24 * 60 * 60 * 1000;
      const d = new Date(ms);
      out.push(
        d.getUTCFullYear() + '-' +
        String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
        String(d.getUTCDate()).padStart(2, '0')
      );
    }
    return out;
  }

  // Deterministic weekly-best-ever value for (bot, week). Different
  // PRNG seed family than the current-week daily roll (suffix 'hof')
  // so the two systems can never accidentally agree on identical
  // numbers. Always clamped to SIM_STEP_WEEKLY_CAP.
  function _rollBotWeeklyBestForHof(weekKey, bot) {
    const seed = hashKey(weekKey + '|' + bot.name + '|hof');
    const rng = mulberry32(seed);
    const z = gaussian(rng);
    // Weekly total ≈ avgDailySteps × 7 + (Gaussian noise scaled
    // for 7-day aggregation). sqrt(7) damps the per-day variance
    // when summed across the week.
    let v = bot.avgDailySteps * 7 + z * bot.stepStdDev * Math.sqrt(7);
    v = Math.round(v);
    if (v < 0) v = 0;
    if (v > SIM_STEP_WEEKLY_CAP) v = SIM_STEP_WEEKLY_CAP;
    return v;
  }

  /**
   * Returns the deterministic list of simulated Hall of Fame records
   * for the given dateKey. Each row:
   *   { alias, steps, week_start, week_end, _sim: true, _simulated: true }
   *
   * Caller (app.js) merges these on top of the real backend response,
   * re-sorts by steps DESC + week_start ASC, and re-ranks. The
   * frontend never persists this list. The backend NEVER receives it.
   *
   * v1: metric=step_total only. Streak metrics return [] (HoF tab
   * is hidden for them at the UI layer too).
   */
  function getHallOfFameRecords(dateKey, metric) {
    if (!SIMULATE_USERS) return [];
    if (metric && metric !== 'step_total') return [];
    const currentWeekKey = getWeekStartKey(dateKey || '');
    if (!currentWeekKey) return [];
    const weekKeys = _pastWeekStartsUTC(currentWeekKey);
    if (weekKeys.length === 0) return [];

    const records = [];
    BOTS.forEach((bot, idx) => {
      const slots = idx < HOF_TOP_TIER_COUNT ? 2 : HOF_PER_BOT_DEFAULT;
      // Compute this bot's weekly best across the candidate weeks.
      const cands = weekKeys.map(wk => ({
        week_start: wk,
        steps: _rollBotWeeklyBestForHof(wk, bot),
      }));
      // Highest first; week tiebreaker keeps the picks deterministic
      // when two of a bot's weeks roll to the same number.
      cands.sort((a, b) => (b.steps - a.steps) || a.week_start.localeCompare(b.week_start));
      cands.slice(0, slots).forEach(c => {
        records.push({
          alias:      bot.name,
          steps:      c.steps,
          week_start: c.week_start,
          week_end:   _weekEndFromStart(c.week_start),
          _sim:       true,
          _simulated: true,
        });
      });
    });

    return records;
  }

  if (typeof window !== 'undefined') {
    window.SimulatedLeaderboard = {
      SIMULATE_USERS:        SIMULATE_USERS,
      SIM_STEP_WEEKLY_CAP:   SIM_STEP_WEEKLY_CAP,
      merge:                 mergeWithSimulated,
      // v3 Phase 1z.37 — Hall of Fame client-side filler.
      getHallOfFameRecords:  getHallOfFameRecords,
      BOTS:                  BOTS,
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
