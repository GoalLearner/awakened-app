-- 0007_user_accolades.sql — 100K Step Club + future accolades (v3 Phase 1z.27).
--
-- One row per (user, accolade_type). For the v1 accolade type
-- 'step_100k_club' the row is awarded inline during leaderboard
-- submit when the authenticated user's weekly step_total crosses
-- 100,000 (see backend/src/handlers/leaderboard-submit.ts).
--
-- Schema is generic enough to hold future accolades (e.g.
-- 'sleep_perfect_month', 'streak_100_days') without a migration —
-- new types just write new rows with their own metadata.
--
-- Cascading delete from users(id) so /v1/account/delete wipes
-- accolades atomically with the user row.

CREATE TABLE IF NOT EXISTS user_accolades (
  id                        TEXT PRIMARY KEY,
  user_id                   TEXT NOT NULL,
  accolade_type             TEXT NOT NULL,
  unlock_week_start         TEXT NOT NULL,     -- ISO YYYY-MM-DD (Sunday UTC)
  unlock_value              INTEGER NOT NULL,  -- the value that first triggered the award
  best_value                INTEGER NOT NULL,  -- running MAX across all qualifying weeks
  repeat_count              INTEGER NOT NULL DEFAULT 1,
  last_qualified_week_start TEXT NOT NULL,     -- ISO YYYY-MM-DD of the latest qualifying week
  unlocked_at               INTEGER NOT NULL,  -- unix ms, first-ever award
  updated_at                INTEGER NOT NULL,  -- unix ms, most recent write
  metadata_json             TEXT,              -- reserved for future fields
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (user_id, accolade_type)
);

CREATE INDEX IF NOT EXISTS idx_user_accolades_user
  ON user_accolades (user_id);

CREATE INDEX IF NOT EXISTS idx_user_accolades_type
  ON user_accolades (accolade_type);
