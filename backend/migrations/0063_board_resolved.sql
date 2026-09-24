-- 0063_board_resolved.sql
-- W990 — RESOLVED on the Community board (owner 2026-09-24): a bug that was
-- fixed or an idea that shipped should stop looking open. Only the owner and
-- moderators mark a topic resolved; it drops out of the default list, its tag
-- count and the Community tab preview, and lives under its own RESOLVED filter
-- with a green tag. Reopening clears it. Resolving also unpins.
--
-- Additive only: existing rows get NULL and read unchanged.
--
-- Apply to remote (house convention — d1_migrations bookkeeping stays empty):
--   wrangler d1 execute awakened-db --remote --file=migrations/0063_board_resolved.sql

ALTER TABLE board_topics ADD COLUMN resolved_at INTEGER;
ALTER TABLE board_topics ADD COLUMN resolved_by TEXT;
CREATE INDEX IF NOT EXISTS idx_board_topics_resolved ON board_topics (resolved_at) WHERE resolved_at IS NOT NULL;
