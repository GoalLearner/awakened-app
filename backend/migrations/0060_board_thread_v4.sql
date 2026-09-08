-- 0060_board_thread_v4.sql
-- W929 — FORUM THREAD v4 (Claude Design handoff 27 "Forum Thread v4").
--
-- The thread grows up: replies can be upvoted, a reply can answer another reply
-- (ONE level of nesting — a sub-reply always hangs off a top-level reply), a
-- hunter can edit their own reply (marked EDITED), and a hunter can FOLLOW a
-- topic to be pushed on new replies (the author of a topic and every replier
-- are followed in automatically; the bell on the thread toggles it).
--
-- Conventions as 0055–0057: epoch-ms INTEGER timestamps from the Worker; every
-- user-keyed table cascades from users; votes cascade from the reply, follows
-- from the topic. ALTER TABLE ADD COLUMN has no IF NOT EXISTS in SQLite — this
-- file applies exactly once.
--
-- Apply to remote (house convention — d1_migrations bookkeeping stays empty):
--   wrangler d1 execute awakened-db --remote --file=migrations/0060_board_thread_v4.sql

ALTER TABLE board_replies ADD COLUMN parent_reply_id TEXT;
ALTER TABLE board_replies ADD COLUMN up_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE board_replies ADD COLUMN edited_at INTEGER;

CREATE TABLE IF NOT EXISTS board_reply_votes (
  reply_id   TEXT    NOT NULL,
  user_id    TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (reply_id, user_id),
  FOREIGN KEY (reply_id) REFERENCES board_replies(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)  REFERENCES users(id)         ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS board_follows (
  topic_id   TEXT    NOT NULL,
  user_id    TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (topic_id, user_id),
  FOREIGN KEY (topic_id) REFERENCES board_topics(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)  REFERENCES users(id)        ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_board_follows_topic ON board_follows (topic_id);
