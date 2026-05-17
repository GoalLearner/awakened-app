-- ────────────────────────────────────────────────────────────────
-- 0008_leaderboard_week_start.sql
--
-- v3 Phase 1z.33 — Weekly scoping for the Global Steps leaderboard.
--
-- Problem: leaderboard_snapshots stores ONE row per (user, metric)
-- without a week tag. For weekly metrics (step_total), this means
-- a user's last submitted total leaks across week boundaries — they
-- appear at the top of "Steps · this week" even when they haven't
-- opened the app since the prior week. GET /v1/leaderboard/top has
-- no way to scope its query to the current week.
--
-- Fix: add a nullable week_start TEXT column tagging which Sunday-UTC
-- week the current_value belongs to. The leaderboard-submit handler
-- writes getAccoladeWeekStart(now) on every submit for step_total.
-- The leaderboard-top handler filters WHERE week_start = $currentWeek
-- for weekly metrics. Existing rows (with week_start = NULL) drop out
-- of the current-week top automatically until the user resubmits.
--
-- best_value is unaffected — it stays the all-time MAX across weeks.
-- Non-weekly metrics (sleep_streak, bedtime_streak) ignore the column.
--
-- Indexes:
--   - idx_leaderboard_metric_value (existing) — kept for non-weekly
--     metric queries that don't filter on week_start.
--   - idx_leaderboard_metric_week_value (new) — supports the weekly
--     filter+sort path for metric='step_total' AND week_start=?
--     ORDER BY current_value DESC.
-- ────────────────────────────────────────────────────────────────

ALTER TABLE leaderboard_snapshots
  ADD COLUMN week_start TEXT;

-- Composite index for the weekly top-N query path.
-- Lexicographic comparison on the YYYY-MM-DD text is correct for
-- equality filtering on week_start (the cardinality is low — a few
-- buckets active at any time).
CREATE INDEX IF NOT EXISTS idx_leaderboard_metric_week_value
  ON leaderboard_snapshots (metric, week_start, current_value DESC);
