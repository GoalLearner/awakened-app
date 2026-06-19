-- 0021_pvp.sql — Realtime human PvP (PVP.md §21).
-- Applied (NOT via `migrations apply`) with:
--   wrangler d1 execute awakened-db --remote --file=migrations/0021_pvp.sql
--
-- The MatchRoom Durable Object owns live match state; D1 holds the durable record
-- (results for history/leaderboard) + ELO ratings + the open-queue matchmaking table.

-- One row per match. id = the DO name (= the invite code for invite-by-code matches,
-- or a generated id for queue matches). Combatant snapshots are the client-submitted
-- builds at join (stats are client-authoritative; the server owns resolution).
CREATE TABLE IF NOT EXISTS pvp_matches (
  id                TEXT PRIMARY KEY,
  code              TEXT,                          -- invite code (NULL for queue matches)
  p1_user_id        TEXT NOT NULL,
  p2_user_id        TEXT,                          -- NULL until P2 joins
  p1_alias          TEXT,
  p2_alias          TEXT,
  p1_combatant_json TEXT,
  p2_combatant_json TEXT,
  winner_user_id    TEXT,                          -- NULL for draw / unfinished
  result            TEXT,                          -- 'p1_win' | 'p2_win' | 'draw' | 'forfeit' | NULL
  turns             INTEGER,
  ranked            INTEGER NOT NULL DEFAULT 0,    -- 0 = invite duel (unranked, v1); 1 = ranked queue
  status            TEXT NOT NULL DEFAULT 'lobby', -- 'lobby' | 'active' | 'ended' | 'abandoned'
  created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at        TEXT,                          -- ISO, set when P2 joins (battle begins)
  ended_at          TEXT                           -- ISO, set on resolution/forfeit
);
CREATE INDEX IF NOT EXISTS idx_pvp_matches_p1 ON pvp_matches(p1_user_id);
CREATE INDEX IF NOT EXISTS idx_pvp_matches_p2 ON pvp_matches(p2_user_id);
CREATE INDEX IF NOT EXISTS idx_pvp_matches_code ON pvp_matches(code);

-- ELO ratings (PVP.md §11.3 / §12). Updated on every ranked match end (win/loss/draw).
-- alias is denormalized (latest seen at match end) so the ELO leaderboard needs no join.
CREATE TABLE IF NOT EXISTS pvp_ratings (
  user_id       TEXT PRIMARY KEY,
  alias         TEXT,
  elo           INTEGER NOT NULL DEFAULT 1500,
  peak_elo      INTEGER NOT NULL DEFAULT 1500,
  wins          INTEGER NOT NULL DEFAULT 0,
  losses        INTEGER NOT NULL DEFAULT 0,
  draws         INTEGER NOT NULL DEFAULT 0,
  last_match_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_pvp_ratings_elo ON pvp_ratings(elo DESC);

-- Open-queue matchmaking (Phase 2 stretch). One row per queued user; a matcher pairs
-- two compatible users into a match code, which the waiting client polls for.
CREATE TABLE IF NOT EXISTS pvp_queue (
  user_id        TEXT PRIMARY KEY,
  alias          TEXT,
  elo            INTEGER NOT NULL DEFAULT 1500,
  combatant_json TEXT,
  enqueued_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  matched_code   TEXT                              -- set when paired; NULL while waiting
);
CREATE INDEX IF NOT EXISTS idx_pvp_queue_elo ON pvp_queue(elo);
