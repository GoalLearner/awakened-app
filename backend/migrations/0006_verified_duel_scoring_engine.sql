-- 0006_verified_duel_scoring_engine.sql
-- Verified Duel Scoring Engine v1 (v3 Phase 1z).
--
-- Generalizes the v0.1 steps-only scoring pass (migration 0005) into a
-- server-authoritative event log + auto-settling reward ledger covering
-- all 5 verified duel types. The legacy duel_progress_snapshots table
-- (0005) stays live for backward compatibility with already-active
-- steps duels.
--
-- New tables:
--   verified_events       — append-only event log. One row per Apple
--                           Health / system-verified event the client
--                           submits. Aggregator computes per-duel
--                           scores from this. UNIQUE(user_id, client_event_id)
--                           is the dedupe key — same event can be
--                           submitted N times safely.
--   user_souls_ledger     — soul reward ledger. INSERT-only. UNIQUE
--                           index on (user_id, ref_type, ref_id, reason)
--                           prevents double-pay (idempotent settle).
--                           Local hb_souls is NOT touched by v1; the
--                           ledger is the eventual reconciliation
--                           target.
--
-- New column on `duels`:
--   reward_settled_at — ISO timestamp when settleDuelReward inserted
--                       the +reward ledger row. NULL until resolve
--                       fires for a non-draw.
--
-- Apply to remote:
--   wrangler d1 execute awakened-db --remote \
--     --file=migrations/0006_verified_duel_scoring_engine.sql
--
-- Local dry-run:
--   wrangler d1 execute awakened-db --local \
--     --file=migrations/0006_verified_duel_scoring_engine.sql

CREATE TABLE IF NOT EXISTS verified_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  duel_id TEXT,
  event_type TEXT NOT NULL,
  metric TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  metric_date TEXT,
  window_start TEXT,
  window_end TEXT,
  client_event_id TEXT,
  client_created_at TEXT,
  server_created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata_json TEXT,
  UNIQUE(user_id, client_event_id)
);
CREATE INDEX IF NOT EXISTS idx_verified_events_user ON verified_events(user_id);
CREATE INDEX IF NOT EXISTS idx_verified_events_type ON verified_events(event_type);
CREATE INDEX IF NOT EXISTS idx_verified_events_duel ON verified_events(duel_id);
CREATE INDEX IF NOT EXISTS idx_verified_events_duel_user ON verified_events(duel_id, user_id);
CREATE INDEX IF NOT EXISTS idx_verified_events_user_occurred ON verified_events(user_id, occurred_at);

CREATE TABLE IF NOT EXISTS user_souls_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref_type TEXT,
  ref_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_souls_ledger_user ON user_souls_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_souls_ledger_ref ON user_souls_ledger(ref_type, ref_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_souls_ledger_duel_win
  ON user_souls_ledger(user_id, ref_type, ref_id, reason);

ALTER TABLE duels ADD COLUMN reward_settled_at TEXT;
