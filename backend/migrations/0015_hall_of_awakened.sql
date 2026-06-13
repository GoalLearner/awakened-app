-- 0015_hall_of_awakened.sql — The Hall of the Awakened (W270).
--
-- The eternal registry of every user who has completed all 100 floors
-- of the Ascent, in the order they finished. Ordinal #1 is the first
-- finisher, FOREVER — the value never changes once assigned.
--
-- One row per user (user_id PRIMARY KEY → once-ever). The global
-- `ordinal` is assigned SERVER-SIDE on the first finish via
--   INSERT ... SELECT COALESCE(MAX(ordinal),0)+1 ... WHERE NOT EXISTS(...)
-- D1 serialises writes per database, so two concurrent finishes can
-- never compute the same MAX+1; the UNIQUE(ordinal) constraint is the
-- belt-and-braces guard. Re-submits are idempotent no-ops (the
-- WHERE NOT EXISTS makes the INSERT affect zero rows once present).
--
-- Trust model (locked, same as Arena titles in public_profile_summary):
-- the backend CANNOT verify the climb from server data — the Arena is
-- cosmetic and CLIENT-AUTHORITATIVE. The Hall carries no rewards (pure
-- bragging rights), so a client-asserted finish is acceptable, exactly
-- like the equipped-title column.
--
-- Alias is NOT stored here — it is JOINed from users.alias at read time
-- (same as leaderboard_top), so an alias change is reflected instantly
-- and there is no denormalised copy to keep in sync.
--
-- Cascading delete from users(id) so /v1/account/delete wipes the row
-- atomically. NOTE: deleting a finisher leaves a GAP in the ordinal
-- sequence (by design — ordinals are eternal and never renumbered).
--
-- Apply to remote (Cloudflare-side) D1:
--   wrangler d1 execute awakened-db --remote \
--     --file=migrations/0015_hall_of_awakened.sql
--
-- Local dry-run:
--   wrangler d1 execute awakened-db --local \
--     --file=migrations/0015_hall_of_awakened.sql
--
-- Migration discipline (same as 0001-0014): NEVER edit after applying.
-- Add 0016_*.sql for any subsequent schema changes.

CREATE TABLE IF NOT EXISTS hall_of_awakened (
  -- FK to users.id. PRIMARY KEY → at most one finish row per user
  -- (once-ever). ON DELETE CASCADE wipes it with the account.
  user_id            TEXT PRIMARY KEY,

  -- The eternal finish ordinal. 1 = the first user to ever clear all
  -- 100 floors. Assigned server-side as MAX(ordinal)+1 at first finish;
  -- NEVER reassigned or renumbered. UNIQUE guards against any collision.
  ordinal            INTEGER NOT NULL UNIQUE,

  -- Server-side stamp at the moment the ordinal was assigned. Unix
  -- epoch ms (same convention as users / leaderboard_snapshots).
  finished_at_ms     INTEGER NOT NULL,

  -- Client-supplied ISO 8601 timestamp at finish time. Display-only
  -- ("MAR 2024"); the authoritative order is `ordinal`, not this.
  client_finished_at TEXT,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- The roll reads in ordinal order (ASC for the eternal #1.., and a
-- bounded range scan for the viewer's neighbourhood). UNIQUE(ordinal)
-- already creates an index, but name it explicitly for clarity.
CREATE INDEX IF NOT EXISTS idx_hall_ordinal
  ON hall_of_awakened (ordinal ASC);
