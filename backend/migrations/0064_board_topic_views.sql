-- 0064_board_topic_views.sql
-- W994 — "Has anyone looked at my post?" (owner 2026-09-24). Opening a topic
-- records the hunter once; the count of hunters who opened it (the author
-- excluded) is shown ONLY to the owner and moderators. One row per
-- (topic, hunter); nothing about when they came back. Additive only.
--
-- Apply to remote (house convention — d1_migrations bookkeeping stays empty):
--   wrangler d1 execute awakened-db --remote --file=migrations/0064_board_topic_views.sql

CREATE TABLE IF NOT EXISTS board_topic_views (
  topic_id  TEXT    NOT NULL,
  user_id   TEXT    NOT NULL,
  first_at  INTEGER NOT NULL,
  PRIMARY KEY (topic_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_board_topic_views_topic ON board_topic_views (topic_id);
