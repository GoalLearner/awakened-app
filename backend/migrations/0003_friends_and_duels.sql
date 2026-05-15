-- 0003_friends_and_duels.sql
-- Discipline Duels v1 foundation (v3 Phase 1x).
--
-- Two new tables:
--   friends — pending/accepted/declined/blocked social graph between users
--   duels   — pending/active/completed 1v1 Discipline Duel rows
--
-- Souls fields (stake_souls/reward_souls/burn_souls) are METADATA ONLY in
-- v1. localStorage souls remain client-side authoritative. No backend
-- spend/award logic runs against these columns until the scoring pass
-- ships (deferred).
--
-- Apply to remote:
--   wrangler d1 execute awakened-db --remote \
--     --file=migrations/0003_friends_and_duels.sql
--
-- Local dry-run:
--   wrangler d1 execute awakened-db --local \
--     --file=migrations/0003_friends_and_duels.sql
--
-- Migration discipline: NEVER edit after applying. Add 0004_*.sql for any
-- subsequent schema changes (e.g. when scoring lands and we add the
-- habit_events table).

CREATE TABLE IF NOT EXISTS friends (
  id TEXT PRIMARY KEY,
  requester_user_id TEXT NOT NULL,
  recipient_user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'blocked')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(requester_user_id, recipient_user_id)
);
CREATE INDEX IF NOT EXISTS idx_friends_requester ON friends(requester_user_id);
CREATE INDEX IF NOT EXISTS idx_friends_recipient ON friends(recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_friends_status ON friends(status);

CREATE TABLE IF NOT EXISTS duels (
  id TEXT PRIMARY KEY,
  challenger_user_id TEXT NOT NULL,
  opponent_user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'declined', 'cancelled', 'completed', 'expired')),
  stake_souls INTEGER NOT NULL DEFAULT 25,
  reward_souls INTEGER NOT NULL DEFAULT 40,
  burn_souls INTEGER NOT NULL DEFAULT 10,
  duration_days INTEGER NOT NULL DEFAULT 3,
  starts_at TEXT,
  ends_at TEXT,
  winner_user_id TEXT,
  challenger_score INTEGER NOT NULL DEFAULT 0,
  opponent_score INTEGER NOT NULL DEFAULT 0,
  challenger_verified_score INTEGER NOT NULL DEFAULT 0,
  opponent_verified_score INTEGER NOT NULL DEFAULT 0,
  challenger_xp_score INTEGER NOT NULL DEFAULT 0,
  opponent_xp_score INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_duels_challenger ON duels(challenger_user_id);
CREATE INDEX IF NOT EXISTS idx_duels_opponent ON duels(opponent_user_id);
CREATE INDEX IF NOT EXISTS idx_duels_status ON duels(status);
CREATE INDEX IF NOT EXISTS idx_duels_ends_at ON duels(ends_at);
