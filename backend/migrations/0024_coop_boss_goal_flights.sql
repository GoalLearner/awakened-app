-- 0024_coop_boss_goal_flights.sql — W447 dual-condition co-op bosses.
--
-- Adds the SECOND metric goal to a co-op hunt so a boss can require BOTH a steps goal
-- AND a flights goal in the same 24h window (the_gaunt_wardens C: 10,000 steps + 6 flights;
-- the_sundered_choir B: 12,000 steps + 10 flights — both combined across the two hunters).
-- NULL for every existing single-metric boss; the resolver only ANDs the flights goal when
-- the server-side COOP_BOSS_CFG metric is 'both', so old instances are unaffected.
--
-- Additive, backward-compatible, NON-idempotent (ALTER ADD COLUMN). Apply EXACTLY once,
-- NOT via `migrations apply`:
--   wrangler d1 execute awakened-db --remote --file=migrations/0024_coop_boss_goal_flights.sql

ALTER TABLE coop_boss_instances ADD COLUMN goal_flights INTEGER;
