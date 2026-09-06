-- 0058_worldgate_rallies.sql
-- W916 — THE WORLDGATE v2 (Claude Design handoff 28): the RALLY horn.
--
-- A hunter can rally their guild (accepted friends) once a day: every friend
-- gets a push saying how far the gate is down and that every verified step
-- strikes it. This table is the once-a-day ledger; the read side of v2
-- (hunters striking, your guild's share, top strikers, the Kill Wall, recent
-- strikes) is computed live from the existing step tables — no new schema.
--
-- Apply to remote (house convention — d1_migrations bookkeeping stays empty):
--   wrangler d1 execute awakened-db --remote --file=migrations/0058_worldgate_rallies.sql

CREATE TABLE IF NOT EXISTS world_gate_rallies (
  user_id    TEXT    NOT NULL,
  day        TEXT    NOT NULL,      -- 'YYYY-MM-DD' in America/Los_Angeles
  sent       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, day),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
