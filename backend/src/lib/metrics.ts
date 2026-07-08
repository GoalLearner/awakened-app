/**
 * metrics.ts — Leaderboard metric definitions + sanity caps.
 *
 * One central place to add new metrics in v2.x+. Adding a metric
 * requires updating this file + (potentially) the leaderboard table
 * schema if the storage shape changes. Current schema is metric-
 * agnostic (one row per (user, metric) pair).
 *
 * Sanity caps prevent corrupt-client garbage from polluting the
 * leaderboard. They're NOT anti-cheat — a determined cheater can
 * still submit any value ≤ cap. Real anti-cheat (server-side
 * HealthKit verification) is deferred to v2.2+ per BACKEND.md §13.
 *
 * Caps chosen to be 3-5× the realistic-human max so legitimate
 * outliers (ultra-marathoners, elite athletes) aren't blocked but
 * obvious data corruption (steps as milliseconds, etc.) is caught.
 */

// v3 Phase 1z.120 — workout_streak added to the metric registry.
// The leaderboard_snapshots table is metric-agnostic (one row per
// (user_id, metric) pair) so no migration is needed — the storage
// layer already supports any metric string. Submit + top endpoints
// route through isValidMetric() against this list, so adding it
// here unlocks both routes simultaneously. Frontend default keeps
// workout_streak in `_LB_CLIENT_ONLY_METRICS` until a deploy lands
// AND the LEADERBOARD_WORKOUT_BACKEND_ENABLED flag flips true;
// behavior is unchanged on production today.
// v3 Phase 1z.125 — flights_climbed added to the metric registry.
// Weekly metric (Sunday-UTC scoped like step_total). Sourced from
// Apple Health HKQuantityTypeIdentifierFlightsClimbed via the
// existing 'stairs' auth alias (no new permission needed).
// Storage shape unchanged — leaderboard_snapshots is metric-agnostic.
// W274 — floor_best: highest Ascent floor ever cleared (1–100). The
// "race to floor 100" global board, companion to the Hall of the
// Awakened (the floor-100 finisher registry). NOT weekly — it's an
// all-time best, carried forward via the snapshot's MAX-preserved
// best_value (same storage shape as every other metric; no migration).
// W622 — relics_collected: unique relics currently in the client's
// Collection Log (rare/ultra-rare/mythic with a resolvable source
// boss; commons excluded — ~59 today, catalog still growing). NOT
// weekly, and deliberately NOT monotonic: selling the last copy of a
// relic reverts it to undiscovered client-side (W204), so submits ride
// the plain-overwrite ELSE branch of the upsert (current_value may
// decrease; best_value stays MAX-sticky). Client-derived like every
// other metric — the cap is sanity, not anti-cheat.
export const METRICS = ['step_total', 'sleep_streak', 'bedtime_streak', 'workout_streak', 'flights_climbed', 'floor_best', 'relics_collected'] as const;
export type Metric = (typeof METRICS)[number];

export const METRIC_CAPS: Readonly<Record<Metric, number>> = {
  /** Cumulative steps over the current Sunday-Pacific week. W585 lowered
   * this from 200_000 to 150_000: a real world-class weekly total is
   * ~100-140k, so 150k is a hair above the plausible human ceiling. The
   * flat cap is paired with a day-of-week VELOCITY clamp (see
   * maxPlausibleStepTotal) so a fabricated value can't dominate the shared
   * board early in the week either. Neither is true anti-cheat (device
   * attestation is still the durable fix) — but together they stop the
   * cross-user leaderboard/Hall-of-Fame/100K-club poisoning that a flat
   * 200k cap allowed. */
  step_total: 150_000,
  /** Consecutive nights ≥7h sleep. 365 = full year; cap protects
   * against accidental millisecond-style values. */
  sleep_streak: 365,
  /** Consecutive nights bedtime < midnight local time. Same cap as
   * sleep_streak for the same reason. */
  bedtime_streak: 365,
  /** Consecutive days with a verified Apple Health workout ≥30 min.
   * 365 = full year; same protect-against-garbage rationale as
   * sleep/bedtime. v3 Phase 1z.120. */
  workout_streak: 365,
  /** Cumulative flights climbed over the current Sunday-UTC week.
   * 1000 = ~3-5× world-class human max (Empire State race-up ≈ 500
   * flights), catching obvious garbage without blocking elite
   * stair-climbers. v3 Phase 1z.125. */
  flights_climbed: 1000,
  /** Highest Ascent floor ever cleared. Hard ceiling is the tower
   * height (100); anything above is corrupt-client garbage. W274. */
  floor_best: 100,
  /** Unique relics in the Collection Log. The log holds ~59 eligible
   * relics today (95-card catalog, commons + orphans excluded) and the
   * catalog only grows a few per release — 200 leaves generous headroom
   * while catching garbage (counts as milliseconds, etc.). W622. */
  relics_collected: 200,
};

export function isValidMetric(value: unknown): value is Metric {
  return typeof value === 'string' && (METRICS as readonly string[]).includes(value);
}

// W585 — per-day plausibility ceiling for the weekly cumulative step total.
// A very big real day (a marathon ≈ 50k steps) sits at this line; sustaining
// >50k EVERY day for a week is ultra-athlete territory that effectively no
// account reaches, so a legit accumulator never trips it. The purpose is to
// stop a fabricated weekly total from occupying rank #1 early in the week when
// only a day or two has elapsed.
export const STEP_TOTAL_PER_DAY_CEILING = 50_000;

/**
 * Elapsed days (1..7) into the current weekly window given `nowMs` and the
 * Sunday-Pacific `weekStart` date string ('YYYY-MM-DD').
 *
 * weekStart is parsed as UTC midnight — that is 7-8h EARLIER than true Pacific
 * midnight, so elapsed is very slightly OVER-counted, which only makes the
 * derived ceiling MORE permissive (never a false rejection from timezone skew).
 * A malformed date parses to NaN → 7 (fully permissive, defer to the flat cap).
 */
export function weeklyElapsedDays(nowMs: number, weekStart: string): number {
  const startMs = Date.parse(weekStart + 'T00:00:00Z');
  if (!Number.isFinite(startMs)) return 7;
  const days = Math.floor((nowMs - startMs) / 86_400_000) + 1;
  return Math.min(7, Math.max(1, days));
}

/**
 * The maximum plausible cumulative step_total this far into the week:
 * min(flat cap, elapsedDays × per-day ceiling). A submit above this is
 * rejected before it can poison the shared board or the permanent accolades.
 */
export function maxPlausibleStepTotal(nowMs: number, weekStart: string): number {
  return Math.min(
    METRIC_CAPS.step_total,
    weeklyElapsedDays(nowMs, weekStart) * STEP_TOTAL_PER_DAY_CEILING,
  );
}

/**
 * Metrics whose `current_value` is scoped to a single Sunday-UTC week.
 *
 * v3 Phase 1z.33 — adds weekly scoping for the Global Steps leaderboard.
 * The submit handler tags the snapshot row with the current Sunday-UTC
 * week key (see `getAccoladeWeekStart`), and the top handler filters
 * `WHERE week_start = $currentWeek` for these metrics so stale rows
 * from earlier weeks don't leak into "Steps · this week" rankings.
 *
 * Streak metrics (sleep_streak, bedtime_streak) are intentionally
 * NOT weekly — they represent running consecutive-night counts that
 * carry forward across weeks. Adding them here would force a daily
 * resubmit just to stay on the board.
 */
export const WEEKLY_METRICS: ReadonlySet<Metric> = new Set<Metric>(['step_total', 'flights_climbed']);

export function isWeeklyMetric(metric: Metric): boolean {
  return WEEKLY_METRICS.has(metric);
}
