-- 0057_board_antispam.sql
-- W914 — THE SPAM GUARD for the Community board.
--
-- Owner (2026-09-06): "create a system that prevents people from spamming
-- the message board either with topics or replies." The gates themselves
-- live in the handler (caps + cooldowns, a repeat filter, a junk filter,
-- strikes that turn into an automatic mute) and count from the topics and
-- replies already stored. This file adds the two things they need:
--   board_strikes             — every rejected write (cap, repeat, junk); five
--                               in 24 h mute the hunter for a day.
--   board_topics.locked_at/by — moderators can LOCK a topic (no more replies).
-- plus author+time indexes so the per-hunter counts stay cheap.
--
-- Conventions as 0055/0056: epoch-ms INTEGER timestamps from the Worker;
-- user-keyed rows cascade from users. ALTER TABLE ADD COLUMN applies once.
--
-- Apply to remote (house convention — d1_migrations bookkeeping stays empty):
--   wrangler d1 execute awakened-db --remote --file=migrations/0057_board_antispam.sql

ALTER TABLE board_topics ADD COLUMN locked_at INTEGER;
ALTER TABLE board_topics ADD COLUMN locked_by TEXT;

CREATE TABLE IF NOT EXISTS board_strikes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT    NOT NULL,
  reason     TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_board_strikes_user_time  ON board_strikes (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_board_topics_author_time ON board_topics  (author_id, created_at);
CREATE INDEX IF NOT EXISTS idx_board_replies_author_time ON board_replies (author_id, created_at);
