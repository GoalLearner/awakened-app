-- 0066_recap_texts.sql
-- W1015 — the Monday recap, written by DeepSeek. One message per hunter per week, stored
-- so a second device (or a reinstall) shows the same words and never pays twice; the
-- previous week's message is read back so the next one is worded differently.
-- Only the finished 1-3 sentences are kept — never the facts the phone sent.
-- Additive only. Account deletion purges it (handlers/account-delete.ts).
--
-- Apply to remote (house convention — d1_migrations bookkeeping stays empty):
--   wrangler d1 execute awakened-db --remote --file=migrations/0066_recap_texts.sql

CREATE TABLE IF NOT EXISTS recap_texts (
  user_id     TEXT    NOT NULL,
  week_start  TEXT    NOT NULL,   -- this week's Monday, PST (YYYY-MM-DD)
  text        TEXT    NOT NULL,   -- JSON array of 1-3 sentences
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, week_start)
);
