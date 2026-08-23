-- W870 (Wave 2 Train B) — THE TOWER REMEMBERS: cross-user Ascent presence.
-- Two event kinds:
--   'clear'  — a rated floor clear (one per user/floor/PT-week; the earliest
--              clear among your FRIENDS plants that floor's weekly banner).
--   'defeat' — a run-ending loss (latest per user only — the handler prunes
--              priors); visible to friends as a kneeling echo for 7 days.
--              A friend clearing that floor may AVENGE it (avenged_by/at):
--              the avenger earns souls, the defeated regains a daily life.
CREATE TABLE tower_events (
  id         TEXT    PRIMARY KEY,
  user_id    TEXT    NOT NULL,
  kind       TEXT    NOT NULL,              -- 'clear' | 'defeat'
  floor      INTEGER NOT NULL,
  week_start TEXT    NOT NULL,              -- PT-Sunday 'YYYY-MM-DD'
  created_at INTEGER NOT NULL,              -- unix ms
  avenged_by TEXT,                          -- defeats only
  avenged_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_tower_clear_once ON tower_events(user_id, floor, week_start) WHERE kind = 'clear';
CREATE INDEX idx_tower_user_kind ON tower_events(user_id, kind, created_at);
