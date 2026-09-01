-- 0054_cron_runs.sql
-- W904 — journal for scheduled jobs that used to fail SILENTLY.
--
-- The Monday "update available" push (W680) never ran on a Monday between
-- 2026-07-16 and 2026-08-31: its trigger "*/5 16-17 * * 1" fires on SUNDAY,
-- because Cloudflare numbers weekdays 1 = Sunday … 7 = Saturday (not POSIX
-- 0-6). The handler ran, the PT gate correctly refused, and nothing recorded
-- the refusal — push_broadcast_log only gets a row once a page is attempted.
--
-- This table records the DECISION of every in-window cron invocation (plus a
-- deduped off-hour heartbeat from the dedicated trigger), so "did not fire"
-- and "fired and skipped, because X" are distinguishable from D1 alone:
--   SELECT * FROM cron_runs WHERE job='update-push' ORDER BY id DESC LIMIT 20;
--
-- Apply to remote (house convention — d1_migrations bookkeeping stays empty):
--   wrangler d1 execute awakened-db --remote --file=migrations/0054_cron_runs.sql
-- Local dry-run:
--   wrangler d1 execute awakened-db --local --file=migrations/0054_cron_runs.sql

CREATE TABLE IF NOT EXISTS cron_runs (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  job      TEXT NOT NULL,                              -- 'update-push'
  cron     TEXT,                                       -- triggering expression (event.cron), NULL from admin/tests
  day_key  TEXT NOT NULL,                              -- PT 'YYYY-MM-DD'
  ran_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,    -- UTC
  decision TEXT NOT NULL,                              -- SKIP_GATE | SKIP_NOT_FRESH | PAGE | PAGE_<reason> | PAGE_FAILED
  detail   TEXT                                        -- JSON (≤2000 chars): release lookup + page result
);

CREATE INDEX IF NOT EXISTS idx_cron_runs_job_day ON cron_runs (job, day_key, decision);
