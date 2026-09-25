-- 0065_board_topic_edited.sql
-- W1001 — a topic can be edited (its author, or a moderator); the card wears EDITED.
-- Additive only. Apply to remote (house convention — d1_migrations bookkeeping stays empty):
--   wrangler d1 execute awakened-db --remote --file=migrations/0065_board_topic_edited.sql

ALTER TABLE board_topics ADD COLUMN edited_at INTEGER;
