-- W1101 — one-off pushes the owner sends to a single hunter (first use: telling a hunter
-- whose phone started over that their backup is safe and how to restore it). A row written
-- here with `wrangler d1 execute` is sent by the 2-minute cron and stamped sent_at. Nothing
-- in the app writes this table, and writing it already takes full database access, so it
-- opens no new way in.
CREATE TABLE IF NOT EXISTS push_outbox (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'notice',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_push_outbox_unsent ON push_outbox(id) WHERE sent_at IS NULL;
