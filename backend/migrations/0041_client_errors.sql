-- 0041_client_errors.sql
-- W746 (item 4 of the vibe-code audit) — server-side client error tracking.
--
-- The app had ZERO error visibility: users don't report bugs, they leave. The
-- client now reports uncaught JS errors (window.onerror + unhandledrejection)
-- to POST /v1/users/me/client-errors, which lands them here. Read with:
--   npx wrangler d1 execute awakened-db --remote --command \
--     "SELECT created_at, build, path, message FROM client_errors ORDER BY created_at DESC LIMIT 50"
--
-- Rows are pruned server-side on insert (30-day retention) so the table cannot
-- grow unboundedly. All text columns are length-clamped by the handler.
--
-- Migration discipline: never edit an applied file; forward-only add.
CREATE TABLE IF NOT EXISTS client_errors (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,          -- unix ms, server clock
  build      TEXT,                      -- APP_BUILD_TAG (e.g. '2.4.5-w744')
  path       TEXT,                      -- client screen/tab hint
  message    TEXT NOT NULL,             -- error message (clamped 500)
  stack      TEXT                       -- stack trace head (clamped 2000)
);

-- Retention prune ("DELETE WHERE created_at < ?") + recency reads.
CREATE INDEX IF NOT EXISTS idx_client_errors_created ON client_errors(created_at);
-- Per-user triage ("what did THIS user hit?").
CREATE INDEX IF NOT EXISTS idx_client_errors_user ON client_errors(user_id, created_at);
