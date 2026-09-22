-- 0061_board_updates.sql
-- W973 — UPDATES on the Community board (owner 2026-09-21): the developers'
-- weekly voice. Only the owner and moderators open an update; everyone reads,
-- replies and upvotes; the newest update pins itself and unpins the last.
--
-- Why a column and not a new tag value: 0055 declared
--   tag TEXT NOT NULL CHECK (tag IN ('improvement', 'bug', 'talk'))
-- and SQLite cannot alter a CHECK without rebuilding board_topics — a rebuild
-- (DROP + RENAME) on a table other rows reference is exactly the kind of
-- migration that loses data. So an update is stored as tag 'talk' with
-- kind 'update'; the handler maps it to tag 'update' on the wire and in every
-- filter/count. Additive only: existing rows get kind NULL and read unchanged.
--
-- Apply to remote (house convention — d1_migrations bookkeeping stays empty):
--   wrangler d1 execute awakened-db --remote --file=migrations/0061_board_updates.sql

ALTER TABLE board_topics ADD COLUMN kind TEXT;
CREATE INDEX IF NOT EXISTS idx_board_topics_kind ON board_topics (kind, created_at DESC);
