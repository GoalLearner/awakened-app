-- 0056_board_votes_pins_feed_likes.sql
-- W913 — COMMUNITY BOARD v3 (Claude Design handoff 27) + LIKES on friend feats.
--
-- Owner (2026-09-06): "Everything has been more organized ... there is now a
-- cheer feature but instead of cheer can we change that to like .. so you
-- can see multiple people like a person's achievement."
--
-- Three additions, all additive:
--   board_topics.up_count / pinned_at / pinned_by — upvotes (denormalised
--     count, recounted from board_votes on every toggle so it can never
--     drift) and moderator pins (pinned topics lead the first page).
--   board_votes  — one upvote per hunter per topic (toggle).
--   feed_likes   — one LIKE per hunter per public achievement event; the
--     feed read returns the count, whether the caller liked it, and the
--     first likers' aliases so "multiple people like a person's
--     achievement" is visible.
--
-- Conventions as 0055: epoch-ms INTEGER timestamps from the Worker; every
-- user-keyed table cascades from users so account deletion erases the rows;
-- votes cascade from the topic, likes from the event. ALTER TABLE ADD COLUMN
-- has no IF NOT EXISTS in SQLite — this file applies exactly once.
--
-- Apply to remote (house convention — d1_migrations bookkeeping stays empty):
--   wrangler d1 execute awakened-db --remote --file=migrations/0056_board_votes_pins_feed_likes.sql

ALTER TABLE board_topics ADD COLUMN up_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE board_topics ADD COLUMN pinned_at INTEGER;
ALTER TABLE board_topics ADD COLUMN pinned_by TEXT;

CREATE TABLE IF NOT EXISTS board_votes (
  topic_id   TEXT    NOT NULL,
  user_id    TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (topic_id, user_id),
  FOREIGN KEY (topic_id) REFERENCES board_topics(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)  REFERENCES users(id)        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS feed_likes (
  event_id   TEXT    NOT NULL,
  user_id    TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, user_id),
  FOREIGN KEY (event_id) REFERENCES public_achievement_events(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)  REFERENCES users(id)                     ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_feed_likes_event ON feed_likes (event_id, created_at);
CREATE INDEX IF NOT EXISTS idx_board_topics_pinned ON board_topics (pinned_at) WHERE pinned_at IS NOT NULL;
