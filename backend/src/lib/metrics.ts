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

export const METRICS = ['step_total', 'sleep_streak', 'bedtime_streak'] as const;
export type Metric = (typeof METRICS)[number];

export const METRIC_CAPS: Readonly<Record<Metric, number>> = {
  /** Cumulative steps over a rolling window. Cap is ~5× the
   * world-class daily ceiling × 7 days = absurd but legitimate. */
  step_total: 200_000,
  /** Consecutive nights ≥7h sleep. 365 = full year; cap protects
   * against accidental millisecond-style values. */
  sleep_streak: 365,
  /** Consecutive nights bedtime < midnight local time. Same cap as
   * sleep_streak for the same reason. */
  bedtime_streak: 365,
};

export function isValidMetric(value: unknown): value is Metric {
  return typeof value === 'string' && (METRICS as readonly string[]).includes(value);
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
export const WEEKLY_METRICS: ReadonlySet<Metric> = new Set<Metric>(['step_total']);

export function isWeeklyMetric(metric: Metric): boolean {
  return WEEKLY_METRICS.has(metric);
}
