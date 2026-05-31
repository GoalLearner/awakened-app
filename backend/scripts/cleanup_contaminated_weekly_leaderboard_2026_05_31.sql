-- Phase 1z.216 — Cleanup of weekly leaderboard rows contaminated
-- by the pre-1z.216 cross-week-untrusted UPSERT bug.
--
-- Context:
--   At the May 30 PDT / May 31 UTC weekly rollover boundary
--   (~5 PM PDT Saturday) untrusted clients submitted their
--   device-local-computed weekly cumulative step totals just
--   after the backend's week_start advanced from 2026-05-24 to
--   2026-05-31. Without the 1z.216 guard, the snapshot row's
--   current_value was overwritten with last week's full total
--   under the new period_key. Example: real user 'galilea'
--   appeared with current_value=78684 on the new (May 31 - Jun 6)
--   board within minutes of rollover.
--
-- DO NOT RUN any UPDATE or DELETE in this file until:
--   1. The 1z.216 worker has been deployed (so new contamination
--      cannot enter).
--   2. The diagnostic SELECT below has been reviewed.
--   3. The user has explicitly approved the specific UPDATE.
--
-- Cleanup discipline:
--   * Run the diagnostic SELECT first.
--   * Confirm each suspect row is actually contaminated (cross-
--     check against the user's last known trusted submission /
--     same period in weekly_step_records).
--   * Run the UPDATE block targeting ONLY the confirmed rows —
--     either by user_id (recommended) or by the suspicious-value
--     threshold (more aggressive, but matches the contamination
--     profile).
--   * The contaminated user's next trusted submit (w19+ client
--     opening the app on Sunday or later) ratchets up via the
--     existing 1z.140 self-heal CASE.
--
-- Apply via:
--   cd backend
--   npx wrangler d1 execute awakened-db --remote \
--     --file=scripts/cleanup_contaminated_weekly_leaderboard_2026_05_31.sql
-- ─────────────────────────────────────────────────────────────


-- ─── DIAGNOSTIC SELECT — safe, read-only ─────────────────────
-- Lists every step_total snapshot row stamped with the
-- May 31 - Jun 6 UTC week that carries no trust marker AND a
-- current_value high enough to be implausible for the first few
-- hours of the new UTC week. Threshold 20,000 chosen because
-- (a) even an active hunter rarely accumulates >20K real steps
-- within the first 6-10 hours of a new UTC Sunday and (b) the
-- contamination delivers full prior-week totals (typically
-- 30K-100K). Tune up/down if the row count looks too noisy.

SELECT u.alias,
       ls.user_id,
       ls.current_value,
       ls.best_value,
       ls.week_start,
       ls.weekly_sum_source,
       ls.updated_at
  FROM leaderboard_snapshots ls
  JOIN users u ON u.id = ls.user_id
 WHERE ls.metric = 'step_total'
   AND ls.week_start = '2026-05-31'
   AND ls.weekly_sum_source IS NULL
   AND ls.current_value > 20000
 ORDER BY ls.current_value DESC;


-- ─── CLEANUP UPDATE — Option A (recommended) ─────────────────
-- Reset suspect rows to current_value=0. Keeps the row so the
-- existing 1z.140 self-heal branch ratchets up from the next
-- trusted submit (no row-creation race). best_value is left
-- intact because it represents the all-time peak and the
-- contaminating value DID land in best_value via the
-- unconditional MAX(...) clause — review-recommended: also
-- reset best_value if the diagnostic shows it was clearly
-- inflated by the same contamination event.
--
-- UNCOMMENT and run ONLY after the diagnostic SELECT is reviewed.

-- UPDATE leaderboard_snapshots
--    SET current_value = 0,
--        updated_at    = strftime('%s','now') * 1000
--  WHERE metric = 'step_total'
--    AND week_start = '2026-05-31'
--    AND weekly_sum_source IS NULL
--    AND current_value > 20000;


-- ─── CLEANUP UPDATE — Option A, scoped to a single user ──────
-- Safer variant: replace '<USER_ID>' with the contaminated
-- user's id taken from the diagnostic SELECT, then UNCOMMENT.

-- UPDATE leaderboard_snapshots
--    SET current_value = 0,
--        updated_at    = strftime('%s','now') * 1000
--  WHERE metric = 'step_total'
--    AND week_start = '2026-05-31'
--    AND weekly_sum_source IS NULL
--    AND user_id = '<USER_ID>';


-- ─── CLEANUP DELETE — Option B (NOT recommended) ─────────────
-- Removes the contaminated row entirely. The user's next
-- trusted submit will INSERT a fresh row via the UPSERT's
-- INSERT path. Option A is preferred because it preserves the
-- row identity, the best_value history, and the trust marker
-- once it lands.

-- DELETE FROM leaderboard_snapshots
--  WHERE metric = 'step_total'
--    AND week_start = '2026-05-31'
--    AND weekly_sum_source IS NULL
--    AND current_value > 20000;
