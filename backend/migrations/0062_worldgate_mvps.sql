-- 0062_worldgate_mvps.sql
-- W975 — WORLDGATE MVPs (owner 2026-09-22, Claude Design handoff 29).
-- The top three by steps at the moment a gate falls are its MVPs. The week's
-- live list keeps moving until Sunday, so the podium is frozen here, as JSON
-- { pool, hunters, mvps: [{ user_id, alias, rank_tier, steps }] }, by the
-- request that stamps the kill (or on first read, for a gate slain earlier).
-- user_id never leaves the server; it only pays the MVP bonus on claim.
-- Additive: existing rows read kill_json NULL and are frozen lazily.
--
-- Apply to remote (house convention — d1_migrations bookkeeping stays empty):
--   wrangler d1 execute awakened-db --remote --file=migrations/0062_worldgate_mvps.sql

ALTER TABLE world_gates ADD COLUMN kill_json TEXT;
