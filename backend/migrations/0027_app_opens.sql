-- 0027 — Per-user retention tracking (app_opens). [owner-requested: real D1/D7/D30
-- retention, independent of Apple's opt-in App Store Analytics].
--
-- PURPOSE: one row per (user, UTC day) — NOT every open. The ingest endpoint
-- (POST /v1/users/me/app-open) UPSERTs on (user_id, date_utc), so repeated opens
-- the same day touch the SAME row (opened_at refreshed to the latest open). The
-- table therefore grows at most ~1 row / user / day. Append-light by design.
--
-- COHORT / first-seen: derived as MIN(date_utc) per user at QUERY time (see the
-- admin-retention handler), NOT denormalized onto users.first_seen. WHY:
--   (1) self-consistent — the cohort (install) day and the return days come from
--       the SAME table, so there is ZERO skew between "auth/install day"
--       (users.created_at) and "first OPEN day";
--   (2) zero changes to the existing `users` table → nothing existing can break,
--       and rollback is a clean DROP (see REVERSE below);
--   (3) the retention query is admin-only / infrequent, so the GROUP BY MIN cost
--       is irrelevant.
--
-- The composite PRIMARY KEY (user_id, date_utc) IS the requested UNIQUE constraint
-- AND the requested (user_id, date_utc) index — SQLite builds a btree on the PK,
-- so a separate secondary index on the same columns would be redundant.
--
-- ── APPLY ──
--   local dry-run : wrangler d1 execute awakened-db --local  --file=migrations/0027_app_opens.sql
--   remote (prod) : wrangler d1 execute awakened-db --remote --file=migrations/0027_app_opens.sql
--
-- ── REVERSE (rollback) — purely additive, so rollback is a clean drop ──
--   wrangler d1 execute awakened-db --remote --command "DROP TABLE IF EXISTS app_opens;"
--   No existing table is touched by this migration, so dropping app_opens fully
--   reverts it with no effect on any other feature.

CREATE TABLE IF NOT EXISTS app_opens (
  user_id   TEXT    NOT NULL,            -- users.id (verified session JWT `sub`); never client-specified
  opened_at INTEGER NOT NULL,            -- unix epoch SECONDS of the latest open recorded that UTC day
  date_utc  TEXT    NOT NULL,            -- 'YYYY-MM-DD' (UTC), derived from opened_at by the Worker
  PRIMARY KEY (user_id, date_utc)        -- one row per user per UTC day (the unique constraint AND the index)
);
