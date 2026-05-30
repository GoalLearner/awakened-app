-- 0014_public_achievement_events.sql — Public friend activity
-- events MVP-B (v3 Phase 1z.200).
--
-- Chronological time-series of preformatted public events. The
-- client submits allowlisted v1 types only (boss_kill, rank_up,
-- step_milestone_bucket); friends-scoped reads power the future
-- Guild Activity → Guild mode feed. The backend NEVER recomputes
-- event labels from XP / HealthKit / opaque snapshots — labels
-- are preformatted client-side under strict per-type regexes
-- (locked in 1z.199 audit).
--
-- Privacy posture (locked in 1z.199 audit):
--   - boss_kill, rank_up are public-safe (game fiction +
--     already-public rank tier).
--   - step_milestone_bucket is BUCKETED only (10k, 20k, 30k, …).
--     Exact daily step counts are NEVER stored or returned. The
--     handler regex rejects "crossed 15,319 steps today".
--   - ultra_rare_drop / card_drop / sleep_quality_7h /
--     habit_streak / friend_added are all REJECTED in v1
--     (defer for separate product decision; would leak loot
--     identity / health / habit names / roster events).
--   - metadata_json column exists but stays UNUSED in v1. Typed
--     columns are queryable, indexable, and easier to validate.
--
-- Dedupe: UNIQUE(user_id, client_event_id) — same event resubmit
-- collapses via ON CONFLICT DO NOTHING. Idempotent on retry.
--
-- Indexes:
--   idx_pae_user_time — friend-feed reads filter by user_id and
--                       sort newest-first. The primary feed
--                       query (UNION across accepted friends
--                       + self, ORDER BY server_created_at DESC)
--                       walks this index per user.
--   idx_pae_type_time — type-scoped lookups (e.g. future
--                       "boss kills this week" surfaces). Cheap
--                       to add now; expensive to add later.
--
-- Cascading delete from users(id) so /v1/account/delete wipes
-- a user's events atomically with the row.
--
-- Apply to remote (Cloudflare-side) D1:
--   wrangler d1 execute awakened-db --remote \
--     --file=migrations/0014_public_achievement_events.sql
--
-- Local dry-run:
--   wrangler d1 execute awakened-db --local \
--     --file=migrations/0014_public_achievement_events.sql
--
-- Migration discipline (same as 0001-0013): NEVER edit after
-- applying. Add 0015_*.sql for any subsequent schema changes.

CREATE TABLE IF NOT EXISTS public_achievement_events (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,

  -- Allowlisted in handler: boss_kill | rank_up |
  -- step_milestone_bucket. Enforced server-side; SQLite has no
  -- native enum. Adding new types requires a handler change and
  -- (preferably) a product decision around privacy.
  event_type        TEXT NOT NULL,

  -- Short opaque identifier used to differentiate events of the
  -- same type for the same user. e.g. 'glass_strider' for a
  -- boss_kill; 'D_II' for rank_up; '10k' for a step bucket.
  -- Length-capped + charset-validated by the handler.
  event_key         TEXT NOT NULL,

  -- Preformatted display string. Per-type regex allowlist:
  --   boss_kill           → /^defeated [A-Za-z0-9 '\-]+$/
  --   rank_up             → /^reached (E|D|C|B|A|S|S\+)( III| II| I)?$/
  --   step_milestone_bucket → /^crossed (10,000|20,000|…|100,000) steps today$/
  event_label       TEXT NOT NULL,

  -- Optional numeric value (boss kill count / rankSortValue /
  -- step bucket integer). Per-type range validation.
  event_value       INTEGER,

  -- Optional rank/rarity tag: boss rank letter for boss_kill;
  -- NULL for rank_up and step_milestone_bucket.
  rarity            TEXT,

  -- Client-supplied dedupe key, e.g.
  -- 'boss_kill:glass_strider:4' or 'rank_up:D_II'. UNIQUE per
  -- user.
  client_event_id   TEXT NOT NULL,

  -- ISO 8601 string from the client at event time. Rejected if
  -- > 7 days old or > 5 minutes in the future.
  client_created_at TEXT NOT NULL,

  -- Server-side stamp at insert time. Used for the newest-first
  -- read order.
  server_created_at INTEGER NOT NULL,

  -- Reserved. UNUSED in v1. Future per-event payloads (e.g. a
  -- batch achievement summary block) can land here without a
  -- migration. The handler intentionally never reads client
  -- metadata in v1.
  metadata_json     TEXT,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (user_id, client_event_id)
);

CREATE INDEX IF NOT EXISTS idx_pae_user_time
  ON public_achievement_events (user_id, server_created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pae_type_time
  ON public_achievement_events (event_type, server_created_at DESC);
