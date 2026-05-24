-- 0010_leaderboard_weekly_sum_source.sql
--
-- v3 Phase 1z.140 — adds a nullable `weekly_sum_source` column to
-- both `leaderboard_snapshots` and `weekly_step_records` so the
-- submit handler can distinguish a trusted w19+ client (which uses
-- Sunday-UTC anchored weekly sums per 1z.139) from a pre-w18 client
-- whose weekly sum could be a Sunday-rollover carryover from last
-- week.
--
-- The submit handler uses this to self-heal a contaminated current-
-- week row: when the FIRST trusted submit (`weekly_sum_source =
-- 'client_sunday_utc_v2'`) arrives for a (user, metric) row whose
-- stored source is NULL or non-trusted, the handler overrides the
-- 1z.131 monotonic MAX clause and accepts the trusted value even if
-- it's lower. Subsequent submits revert to the 1z.131 MAX behaviour
-- (the trust marker is sticky, so the row can never be downgraded
-- again by an arbitrary lower submit).
--
-- NULL is the default — existing rows retain MAX semantics until they
-- receive their first trusted submit. New rows from w19+ clients are
-- marked trusted on first write.

ALTER TABLE leaderboard_snapshots ADD COLUMN weekly_sum_source TEXT DEFAULT NULL;
ALTER TABLE weekly_step_records  ADD COLUMN weekly_sum_source TEXT DEFAULT NULL;
