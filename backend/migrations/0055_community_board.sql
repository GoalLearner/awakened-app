-- 0055_community_board.sql
-- W907 — THE COMMUNITY BOARD (Friends tab → Community).
--
-- Rendell's pitch, owner's call (2026-09-04): one open, server-wide board
-- where hunters open TOPICS (tagged improvement / bug / talk) and REPLY, with
-- named MODERATORS (owner + Rendell) who can delete, hide and mute. This is
-- the first free text the backend has ever stored for other users to read
-- (every prior string was an alias or an allowlisted feed label), so the
-- Apple 1.2 user-generated-content pillars ship in the same schema:
-- a filter (profanity per token, handler-side), REPORT with auto-hide at the
-- third distinct reporter and a push to every moderator, BLOCK (symmetric
-- exclusion on every read), rules CONSENT before the first write, and a
-- MUTE the moderators wield.
--
-- Conventions: ids are crypto.randomUUID(); every timestamp is epoch-ms
-- INTEGER written by the Worker (Date.now()) — never CURRENT_TIMESTAMP, iOS
-- Safari cannot parse SQLite's space-separated datetime. Every user-keyed
-- table declares ON DELETE CASCADE like 0051/0052/0053, so account deletion
-- erases a hunter's board footprint through the one DELETE FROM users.
-- Sims (users.apple_sub LIKE 'sim_test_%') never write and are filtered on
-- every read in the handler, never here.
--
-- Apply to remote (house convention — d1_migrations bookkeeping stays empty):
--   wrangler d1 execute awakened-db --remote --file=migrations/0055_community_board.sql
-- Local dry-run:
--   wrangler d1 execute awakened-db --local --file=migrations/0055_community_board.sql

CREATE TABLE IF NOT EXISTS board_topics (
  id               TEXT PRIMARY KEY,
  author_id        TEXT NOT NULL,
  tag              TEXT NOT NULL CHECK (tag IN ('improvement', 'bug', 'talk')),
  title            TEXT NOT NULL,
  body             TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  reply_count      INTEGER NOT NULL DEFAULT 0,
  hidden_at        INTEGER,            -- moderator hide, or 'auto' at the 3rd distinct report
  hidden_by        TEXT,
  deleted_at       INTEGER,            -- moderator delete (soft; body cleared)
  deleted_by       TEXT,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_board_topics_feed ON board_topics (deleted_at, hidden_at, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_board_topics_author ON board_topics (author_id, created_at DESC);

CREATE TABLE IF NOT EXISTS board_replies (
  id         TEXT PRIMARY KEY,
  topic_id   TEXT NOT NULL,
  author_id  TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  hidden_at  INTEGER,
  hidden_by  TEXT,
  deleted_at INTEGER,
  deleted_by TEXT,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_board_replies_topic ON board_replies (topic_id, created_at);
CREATE INDEX IF NOT EXISTS idx_board_replies_author ON board_replies (author_id, created_at DESC);

CREATE TABLE IF NOT EXISTS board_reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('topic', 'reply')),
  target_id   TEXT NOT NULL,
  reporter_id TEXT NOT NULL,
  reason      TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  resolved_at INTEGER,
  resolved_by TEXT,
  UNIQUE (target_kind, target_id, reporter_id),
  FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_board_reports_open ON board_reports (resolved_at, created_at DESC);

CREATE TABLE IF NOT EXISTS board_blocks (
  blocker_id TEXT NOT NULL,
  blocked_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id),
  FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_board_blocks_blocked ON board_blocks (blocked_id);

CREATE TABLE IF NOT EXISTS board_mutes (
  user_id    TEXT PRIMARY KEY,
  until      INTEGER NOT NULL,
  by_user_id TEXT NOT NULL,
  reason     TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS board_moderators (
  user_id    TEXT PRIMARY KEY,
  role       TEXT NOT NULL CHECK (role IN ('owner', 'mod')),
  granted_by TEXT,
  granted_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS board_consents (
  user_id     TEXT PRIMARY KEY,
  accepted_at INTEGER NOT NULL,
  version     INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
