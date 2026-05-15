-- sanitize-hk-flags-auto.sql
-- Auto-targeting version of sanitize-hk-flags.sql.
--
-- Targets ALL snapshots that contain at least one of the four
-- device-state HealthKit cache keys (i.e., any user affected by
-- the v3 Phase 1w.1 bug). No alias edit required.
--
-- Why this is safe:
--   - The four removed keys are device-state cache, not user
--     progress. Removing them never deletes habits/completions/
--     bosses/inventory/souls/build/stats/etc.
--   - Only users who triggered the Cloud Sync v1.0 → reinstall →
--     restore cycle have these flags in their snapshot.
--   - Other TestFlight testers who hit the same bug benefit from
--     the same fix (it's a bug, not user preference).
--   - Users who never hit the bug have NULL on `json_extract` for
--     these paths and won't match the WHERE clause → untouched.
--   - `json_remove` is idempotent — re-running this is a no-op.
--   - leaderboard_snapshots untouched. users table untouched.
--
-- From repo root:
--   cd backend
--   wrangler d1 execute awakened-db --remote --file=scripts/sanitize-hk-flags-auto.sql

-- ─── Step 1: BEFORE — list every affected snapshot ─────────
SELECT
  u.id                                                          AS user_id,
  u.alias                                                       AS alias,
  length(s.state_json)                                          AS bytes_before,
  json_extract(s.state_json, '$.keys.hb_healthkit_status')      AS had_hk_status,
  json_extract(s.state_json, '$.keys.hb_healthkit_prompted')    AS had_hk_prompted,
  json_extract(s.state_json, '$.keys.hb_healthkit_sleep_requested') AS had_hk_sleep_req,
  json_extract(s.state_json, '$.keys.hb_healthkit_authversion') AS had_hk_authversion,
  (json_extract(s.state_json, '$.keys.hb_habits') IS NOT NULL)  AS has_habits,
  (json_extract(s.state_json, '$.keys.hb_souls')  IS NOT NULL)  AS has_souls,
  (json_extract(s.state_json, '$.keys.hb_bosses') IS NOT NULL)  AS has_bosses,
  (json_extract(s.state_json, '$.keys.hb_inventory') IS NOT NULL) AS has_inventory,
  (json_extract(s.state_json, '$.keys.hb_hunter_build') IS NOT NULL) AS has_build
FROM user_state_snapshots s
JOIN users u ON u.id = s.user_id
WHERE json_extract(s.state_json, '$.keys.hb_healthkit_status')         IS NOT NULL
   OR json_extract(s.state_json, '$.keys.hb_healthkit_prompted')       IS NOT NULL
   OR json_extract(s.state_json, '$.keys.hb_healthkit_sleep_requested') IS NOT NULL
   OR json_extract(s.state_json, '$.keys.hb_healthkit_authversion')    IS NOT NULL;

-- ─── Step 2: SANITIZE — remove the four cache keys ─────────
UPDATE user_state_snapshots
SET state_json = json_remove(
  state_json,
  '$.keys.hb_healthkit_status',
  '$.keys.hb_healthkit_prompted',
  '$.keys.hb_healthkit_sleep_requested',
  '$.keys.hb_healthkit_authversion'
)
WHERE json_extract(state_json, '$.keys.hb_healthkit_status')         IS NOT NULL
   OR json_extract(state_json, '$.keys.hb_healthkit_prompted')       IS NOT NULL
   OR json_extract(state_json, '$.keys.hb_healthkit_sleep_requested') IS NOT NULL
   OR json_extract(state_json, '$.keys.hb_healthkit_authversion')    IS NOT NULL;

-- ─── Step 3: AFTER — verify all four flags are gone everywhere ───
-- Should return 0 rows. If it returns any, the UPDATE didn't reach
-- those snapshots (shouldn't happen — the WHERE clauses match).
SELECT
  u.id        AS user_id,
  u.alias     AS alias,
  'STILL HAS HK FLAGS' AS warning,
  json_extract(s.state_json, '$.keys.hb_healthkit_status')      AS hk_status,
  json_extract(s.state_json, '$.keys.hb_healthkit_prompted')    AS hk_prompted,
  json_extract(s.state_json, '$.keys.hb_healthkit_sleep_requested') AS hk_sleep_req,
  json_extract(s.state_json, '$.keys.hb_healthkit_authversion') AS hk_authversion
FROM user_state_snapshots s
JOIN users u ON u.id = s.user_id
WHERE json_extract(s.state_json, '$.keys.hb_healthkit_status')         IS NOT NULL
   OR json_extract(s.state_json, '$.keys.hb_healthkit_prompted')       IS NOT NULL
   OR json_extract(s.state_json, '$.keys.hb_healthkit_sleep_requested') IS NOT NULL
   OR json_extract(s.state_json, '$.keys.hb_healthkit_authversion')    IS NOT NULL;

-- ─── Step 4: AFTER summary — show all snapshots + core-data sanity ───
-- Confirms snapshots are intact (habits/souls/bosses/etc still present).
SELECT
  u.id                                                          AS user_id,
  u.alias                                                       AS alias,
  length(s.state_json)                                          AS bytes_after,
  (json_extract(s.state_json, '$.keys.hb_habits')       IS NOT NULL) AS still_has_habits,
  (json_extract(s.state_json, '$.keys.hb_souls')        IS NOT NULL) AS still_has_souls,
  (json_extract(s.state_json, '$.keys.hb_bosses')       IS NOT NULL) AS still_has_bosses,
  (json_extract(s.state_json, '$.keys.hb_inventory')    IS NOT NULL) AS still_has_inventory,
  (json_extract(s.state_json, '$.keys.hb_hunter_build') IS NOT NULL) AS still_has_build,
  (json_extract(s.state_json, '$.keys.hb_leaderboard')  IS NOT NULL) AS still_has_leaderboard
FROM user_state_snapshots s
JOIN users u ON u.id = s.user_id;
