-- sanitize-hk-flags.sql
-- One-shot cleanup for the v3 Phase 1w.1 Cloud Sync bug.
--
-- Removes four device-state HealthKit cache keys from the saved
-- state_json of a single user's snapshot in user_state_snapshots.
-- These four keys were mistakenly included in Cloud Sync v1.0's
-- SNAPSHOT_KEYS allowlist; after a fresh-install restore, they
-- reported "already granted, already prompted" to the app even
-- though iOS had revoked the actual permission grant on app delete.
--
-- The four keys this script removes:
--   $.keys.hb_healthkit_status
--   $.keys.hb_healthkit_prompted
--   $.keys.hb_healthkit_sleep_requested
--   $.keys.hb_healthkit_authversion
--
-- The script preserves ALL other state (habits, completions,
-- streaks, bosses, inventory, souls, hunter build, stats,
-- achievements, leaderboard accumulators, origin story, etc).
-- json_remove is forgiving — if a path doesn't exist, it's a
-- no-op for that path; safe to run on snapshots that already
-- lack one or more of these keys.
--
-- BEFORE RUNNING:
--   1. Replace '__YOUR_ALIAS__' (3 places below) with your actual
--      hunter alias as shown in Settings → Account in the app.
--      Aliases are case-insensitive uniquely indexed in `users`
--      so there's exactly zero or one match.
--   2. From repo root:
--        cd backend
--        wrangler d1 execute awakened-db --remote --file=scripts/sanitize-hk-flags.sql
--   3. The script outputs three result sets:
--        a. snapshot stats BEFORE — shows your byte size + whether
--           the four keys were present + that core data exists
--        b. UPDATE result — number of rows affected (should be 1)
--        c. snapshot stats AFTER — verify the four keys are gone
--           and core data (habits/souls/bosses) is still present
--
-- SAFETY:
--   - Targets one specific user by alias (UNIQUE indexed lower(alias))
--   - Does NOT touch the `users` row itself
--   - Does NOT touch any other user's snapshot
--   - Does NOT delete the row, only modifies state_json
--   - json_remove is idempotent — running this twice does nothing
--   - leaderboard_snapshots untouched
--
-- POST-RUN:
--   1. Delete the Awakened app from your iPhone
--   2. Reinstall from TestFlight
--   3. Sign in with the same Apple ID
--   4. Tap "Restore" when prompted — restored state will NOT contain
--      the four HK cache keys
--   5. Habits tab loads → autoVerifyWalk fires → permissionStatus
--      is 'unknown' → showHealthKitPreprompt() fires → tap Enable
--   6. iOS native permission sheet appears → grant Sleep + Steps +
--      Workouts
--   7. Awakened reappears in iOS Settings → Health → Apps
--   8. Sleep / Daily walk / Strength training auto-check on next
--      render (assuming you have qualifying data in Apple Health)

-- ─── Step 1: BEFORE snapshot ────────────────────────────────
-- Confirms the target row exists and shows the current state of
-- the four flags. Also confirms core user data (habits) is present
-- so you can compare AFTER.
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
  s.client_updated_at                                           AS last_client_update,
  s.server_updated_at                                           AS last_server_update
FROM users u
JOIN user_state_snapshots s ON u.id = s.user_id
WHERE u.alias = '__YOUR_ALIAS__';

-- ─── Step 2: SANITIZE ────────────────────────────────────────
-- json_remove() with multiple paths removes each path sequentially.
-- Targets a single user via the unique alias index. If alias yields
-- 0 rows, this UPDATE no-ops (no error).
UPDATE user_state_snapshots
SET state_json = json_remove(
  state_json,
  '$.keys.hb_healthkit_status',
  '$.keys.hb_healthkit_prompted',
  '$.keys.hb_healthkit_sleep_requested',
  '$.keys.hb_healthkit_authversion'
)
WHERE user_id = (SELECT id FROM users WHERE alias = '__YOUR_ALIAS__');

-- ─── Step 3: AFTER snapshot ──────────────────────────────────
-- Verify all four flags are now NULL (removed) AND core data is
-- still present. byte count should shrink slightly (a few hundred
-- bytes per removed key including the JSON syntax around them).
SELECT
  u.id                                                          AS user_id,
  u.alias                                                       AS alias,
  length(s.state_json)                                          AS bytes_after,
  json_extract(s.state_json, '$.keys.hb_healthkit_status')      AS hk_status_now,
  json_extract(s.state_json, '$.keys.hb_healthkit_prompted')    AS hk_prompted_now,
  json_extract(s.state_json, '$.keys.hb_healthkit_sleep_requested') AS hk_sleep_req_now,
  json_extract(s.state_json, '$.keys.hb_healthkit_authversion') AS hk_authversion_now,
  (json_extract(s.state_json, '$.keys.hb_habits') IS NOT NULL)  AS still_has_habits,
  (json_extract(s.state_json, '$.keys.hb_souls')  IS NOT NULL)  AS still_has_souls,
  (json_extract(s.state_json, '$.keys.hb_bosses') IS NOT NULL)  AS still_has_bosses,
  (json_extract(s.state_json, '$.keys.hb_inventory') IS NOT NULL) AS still_has_inventory,
  (json_extract(s.state_json, '$.keys.hb_hunter_build') IS NOT NULL) AS still_has_build,
  (json_extract(s.state_json, '$.keys.hb_leaderboard') IS NOT NULL) AS still_has_leaderboard
FROM users u
JOIN user_state_snapshots s ON u.id = s.user_id
WHERE u.alias = '__YOUR_ALIAS__';
