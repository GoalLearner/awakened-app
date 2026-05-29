-- 0012_public_profile_summary.sql — Friend rank badges MVP
-- (v3 Phase 1z.190).
--
-- One row per user. The authenticated user submits a preformatted
-- public rank summary via PUT /v1/users/me/public-profile-summary
-- and the row is upserted verbatim after shape/range validation.
-- The backend NEVER recomputes rank from XP/HealthKit/snapshot
-- data — rank derivation lives in the client `getRankDivisionInfo`
-- helper (frontend single source of truth, locked in 1z.189).
--
-- /v1/friends LEFT JOINs this table when serializing each friend
-- row, so accepted/incoming/outgoing rows carry optional rank
-- fields when the friend has opted in. `rank_points` is stored
-- but never returned to friends in v1 (privacy: hides exact XP
-- magnitude). `metadata_json` is reserved for future achievement
-- summaries.
--
-- Cascading delete from users(id) so /v1/account/delete wipes the
-- public summary atomically with the user row.
--
-- Apply to remote (Cloudflare-side) D1:
--   wrangler d1 execute awakened-db --remote \
--     --file=migrations/0012_public_profile_summary.sql
--
-- Local dry-run:
--   wrangler d1 execute awakened-db --local \
--     --file=migrations/0012_public_profile_summary.sql
--
-- Migration discipline (same as 0001-0011): NEVER edit after
-- applying. Add 0013_*.sql for any subsequent schema changes.

CREATE TABLE IF NOT EXISTS public_profile_summary (
  -- FK to users.id. ON DELETE CASCADE so account deletion wipes
  -- this row atomically.
  user_id           TEXT PRIMARY KEY,

  -- Rank tier letter. One of: 'E', 'D', 'C', 'B', 'A', 'S', 'S+'.
  -- Enforced at the application layer in
  -- handlers/public-profile-summary.ts; SQLite has no native
  -- enum. Matches the RANKS array in app.js.
  rank_tier         TEXT NOT NULL,

  -- Sub-tier division. One of: 'I', 'II', 'III', or NULL.
  -- NULL is only valid when rank_tier === 'S+' (the max tier
  -- has no divisions per 1z.59/1z.189 model).
  rank_division     TEXT,

  -- Preformatted display label, e.g. 'D II', 'C I', 'S+'.
  -- Client-submitted from `getRankDivisionInfo(totalXp).fullLabel`
  -- so all clients agree without server recomputation.
  rank_label        TEXT NOT NULL,

  -- Monotonic numeric sort key. Higher = stronger. Derived
  -- client-side from rank_tier × division × rank_points using
  -- the formula locked in 1z.189:
  --   tierWeight * 1_000_000_000 + divWeight * 1_000_000
  --   + clamp(rank_points, 0, 999_999)
  -- Range: [0, 6_999_999_999]. Indexed DESC for the
  -- friends-sorted-by-rank read path.
  rank_sort_value   INTEGER NOT NULL DEFAULT 0,

  -- Raw rank XP at submission time. Stored for diagnostics and
  -- the rank-points tiebreaker inside rank_sort_value. Never
  -- returned to friends in v1 — exposing this would leak the
  -- user's exact XP magnitude. Returned to the submitting user
  -- only in the PUT response echo.
  rank_points       INTEGER NOT NULL DEFAULT 0,

  -- Client-side timestamp at the moment the summary was built.
  -- ISO 8601 string. Used for "stale rank" UI signals.
  client_updated_at TEXT NOT NULL,

  -- Server-side timestamp set at upsert time. Unix epoch ms.
  -- Matches the convention used by users + leaderboard_snapshots
  -- + user_accolades.
  server_updated_at INTEGER NOT NULL,

  -- Reserved for future achievement payloads (e.g. bosses_slain
  -- aggregate counts, recent feat summary). Opaque TEXT today so
  -- future expansion needs no migration. NULL until a write path
  -- ships.
  metadata_json     TEXT,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Backs the future "friends sorted by rank" read path. DESC index
-- lets the LEFT JOIN's planner walk in the right order without an
-- explicit ORDER BY rank_sort_value DESC sort step.
CREATE INDEX IF NOT EXISTS idx_public_profile_rank
  ON public_profile_summary (rank_sort_value DESC);
