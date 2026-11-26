-- 0084 — W1323: a Worldgate bar stops counting once it fills (owner 2026-11-25: "the sleep shouldn't be at 313h / 300h. It
-- should hit the 300h and stop recording more sleep. Same with the other two conditions"). The first read that finds a bar at
-- or past its HP writes every hunter's part of that bar here and stamps the bar's *_full_at on the gate; from then on the bar
-- and everyone's damage read these, never the live totals. The live totals are still kept (world_gate_effort, the weekly
-- steps): the next gate is sized from everything the fleet actually did (W1323's forecast).
-- Apply: wrangler d1 migrations apply awakened-db --remote (from backend/), BEFORE the deploy.
CREATE TABLE IF NOT EXISTS world_gate_bar_locks (
  week_start TEXT NOT NULL,
  bar        TEXT NOT NULL,          -- 'steps' | 'flights' | 'sleep'
  user_id    TEXT NOT NULL,
  value      INTEGER NOT NULL,       -- steps, flights, or minutes asleep, as of the fill
  PRIMARY KEY (week_start, bar, user_id)
);
ALTER TABLE world_gates ADD COLUMN steps_full_at INTEGER;
ALTER TABLE world_gates ADD COLUMN flights_full_at INTEGER;
ALTER TABLE world_gates ADD COLUMN sleep_full_at INTEGER;
