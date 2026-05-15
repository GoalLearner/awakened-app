-- 0005_duel_progress_snapshots.sql
-- Steps Duel Scoring v1 (v3 Phase 1y).
--
-- First real competitive scoring loop in Awakened. Only `steps` duel
-- type is scored in v1 — other duel types stay metadata-only until a
-- later pass.
--
-- New table:
--   duel_progress_snapshots — one row per (duel, user, metric). The
--   client POSTs Apple Health-derived step counts to
--   /v1/duels/:id/progress; the server upserts here. On
--   /v1/duels/:id/resolve, the resolver reads both participants'
--   snapshots, picks the higher value (missing = 0), and updates the
--   parent duels row.
--
-- New columns on `duels`:
--   resolved_at — ISO timestamp when resolveDuel finalized the row.
--   result      — 'challenger_win' | 'opponent_win' | 'draw'. Derived
--                 classifier so clients render outcomes without
--                 re-comparing scores. Maps directly from
--                 winner_user_id (null + result='draw' on tie).
--
-- Apply to remote:
--   wrangler d1 execute awakened-db --remote \
--     --file=migrations/0005_duel_progress_snapshots.sql
--
-- Local dry-run:
--   wrangler d1 execute awakened-db --local \
--     --file=migrations/0005_duel_progress_snapshots.sql

CREATE TABLE IF NOT EXISTS duel_progress_snapshots (
  id TEXT PRIMARY KEY,
  duel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  duel_type TEXT NOT NULL,
  metric TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'apple_health',
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  client_updated_at TEXT NOT NULL,
  server_updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(duel_id, user_id, metric)
);
CREATE INDEX IF NOT EXISTS idx_duel_progress_duel ON duel_progress_snapshots(duel_id);
CREATE INDEX IF NOT EXISTS idx_duel_progress_user ON duel_progress_snapshots(user_id);

ALTER TABLE duels ADD COLUMN resolved_at TEXT;
ALTER TABLE duels ADD COLUMN result TEXT CHECK (result IS NULL OR result IN ('challenger_win', 'opponent_win', 'draw'));
