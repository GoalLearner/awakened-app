-- ────────────────────────────────────────────────────────────────
-- 0009_weekly_step_records.sql
--
-- v3 Phase 1z.36 — Weekly Steps Hall of Fame.
--
-- Permanent historical record book of the highest verified weekly
-- step totals ever recorded by REAL users. A user can appear in the
-- Hall of Fame multiple times for multiple high weeks. Independent
-- of `leaderboard_snapshots` (which holds the current week's ranking
-- and resets via the new week_start filter in handler/leaderboard-top)
-- and `user_accolades` (which holds the 100K Step Club accolade).
--
-- Write path: extended POST /v1/leaderboard/submit. When a real user
-- (apple_sub NOT LIKE 'sim_test_%') submits a step_total for the
-- current week, the submit handler upserts a row keyed by
-- (user_id, week_start) with steps = MAX(stored, new). Lower
-- resubmits within the same week never reduce the record.
--
-- Read path: new GET /v1/leaderboard/hall-of-fame?metric=step_total
-- — top-N global rows ordered by steps DESC, tie-broken by older
-- week_start ASC, plus the caller's personal best record (me_best).
--
-- Alias is NOT denormalized. Reads JOIN users so name changes flow
-- through automatically.
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS weekly_step_records (
  id          TEXT PRIMARY KEY,            -- UUID
  user_id     TEXT NOT NULL,
  week_start  TEXT NOT NULL,               -- 'YYYY-MM-DD' Sunday-UTC,
                                           -- same key convention as
                                           -- leaderboard_snapshots.week_start
                                           -- and user_accolades.unlock_week_start.
  steps       INTEGER NOT NULL,            -- weekly best for this user/week
  created_at  INTEGER NOT NULL,            -- Unix ms, set on initial INSERT
  updated_at  INTEGER NOT NULL,            -- Unix ms, bumped on every overwrite
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (user_id, week_start)
);

-- Top-N global ranking query path. Lexicographic week_start works as a
-- correct tiebreaker (older Sunday sorts before newer Sunday in YYYY-MM-DD).
CREATE INDEX IF NOT EXISTS idx_weekly_step_records_steps
  ON weekly_step_records (steps DESC, updated_at DESC);

-- Supports any future "top weeks in week X" diagnostic query.
CREATE INDEX IF NOT EXISTS idx_weekly_step_records_week
  ON weekly_step_records (week_start, steps DESC);

-- Supports the me_best read path (caller's personal best across all weeks).
CREATE INDEX IF NOT EXISTS idx_weekly_step_records_user
  ON weekly_step_records (user_id, steps DESC);
