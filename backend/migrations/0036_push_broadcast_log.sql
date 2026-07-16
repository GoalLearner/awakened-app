-- 0036_push_broadcast_log.sql
-- W680 — Monday "update available" push broadcast (pairs with the W679 banner).
--
-- One row per broadcast day (day_key = PT 'YYYY-MM-DD' of that Monday). The
-- Worker's cron fires every 5 min across the 16:00–17:59 UTC window on Mondays;
-- each eligible run (9 AM Pacific, DST-proof) claims this row and sends ONE
-- bounded page of users (free-plan subrequest budget), advancing `cursor`
-- (keyset pagination over DISTINCT device_tokens.user_id) until `completed`.
-- Idempotent by construction: the day_key PK + cursor mean a re-fired or
-- overlapping run can never re-send to a user already paged past.
--
-- Apply to remote (house convention — d1_migrations bookkeeping stays empty):
--   wrangler d1 execute awakened-db --remote --file=migrations/0036_push_broadcast_log.sql
-- Local dry-run:
--   wrangler d1 execute awakened-db --local --file=migrations/0036_push_broadcast_log.sql

CREATE TABLE IF NOT EXISTS push_broadcast_log (
  day_key    TEXT PRIMARY KEY,
  cursor     TEXT NOT NULL DEFAULT '',
  sent_users INTEGER NOT NULL DEFAULT 0,
  completed  INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
