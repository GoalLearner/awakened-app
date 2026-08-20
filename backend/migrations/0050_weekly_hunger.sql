-- W845 (Train 5, E2) — rotating weekly boss modifier ("the Hunger").
--
-- The weekly pick itself is DETERMINISTIC on the client (hash of the PT
-- Sunday week key over the eligible catalog) — every device agrees with no
-- server round-trip and no cron. This table exists only for the OWNER
-- override: hand-pick a week's hungered boss and every client adopts it on
-- their next boot. No row = the deterministic pick stands.
--
-- Set one (see backend/OPS-QUERIES.md §7):
--   INSERT OR REPLACE INTO weekly_hunger_overrides (week_start, boss_id, created_at)
--   VALUES ('2026-08-23', 'the_twin_maw', strftime('%s','now')*1000);
CREATE TABLE weekly_hunger_overrides (
  week_start TEXT    PRIMARY KEY,   -- PT-Sunday 'YYYY-MM-DD' (same key as leaderboard weeks)
  boss_id    TEXT    NOT NULL,
  created_at INTEGER NOT NULL       -- unix ms
);
