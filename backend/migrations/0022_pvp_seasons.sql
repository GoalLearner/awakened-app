-- 0022_pvp_seasons.sql — Ranked seasons + placement (PVP.md §12.3 revisited).
-- Applied (NOT via `migrations apply`) with:
--   wrangler d1 execute awakened-db --remote --file=migrations/0022_pvp_seasons.sql
--
-- A season is a fixed window; at its end the ladder soft-resets (elo halves its distance to
-- 1500) and placement re-opens. Ratings become season-scoped: pvp_ratings now tracks the
-- CURRENT season's stats, and a player's first ranked match of a NEW season lazily resets
-- their row (done in the MatchRoom DO's updateElo). placement_games counts ranked matches
-- this season; a player is "placed" once it reaches PVP_PLACEMENT_GAMES (5).

CREATE TABLE IF NOT EXISTS pvp_seasons (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  number     INTEGER NOT NULL UNIQUE,        -- 1-based; the displayed "Season N"
  started_at TEXT NOT NULL,                  -- ISO/SQLite datetime (UTC)
  ends_at    TEXT NOT NULL                   -- when the ladder soft-resets + placement re-opens
);

-- Season columns on the live ratings table (additive — existing rows keep their rating).
ALTER TABLE pvp_ratings ADD COLUMN season_id INTEGER;
ALTER TABLE pvp_ratings ADD COLUMN placement_games INTEGER NOT NULL DEFAULT 0;

-- Launch Season 1 (35-day window) and adopt every existing rating into it AS-IS — no reset on
-- launch: current players are treated as already placed (placement_games = 5) at their current
-- elo. Future seasons reset normally (lazily, per player, on their first match of the season).
INSERT OR IGNORE INTO pvp_seasons (number, started_at, ends_at)
  VALUES (1, datetime('now'), datetime('now', '+35 days'));
UPDATE pvp_ratings
  SET season_id = (SELECT id FROM pvp_seasons WHERE number = 1),
      placement_games = 5
  WHERE season_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_pvp_ratings_season ON pvp_ratings(season_id, elo DESC);
