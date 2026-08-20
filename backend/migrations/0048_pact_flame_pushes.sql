-- W837 (Train 3, R3) — pact-flame-at-risk push ledger.
--
-- The Pact Flame dies silently at Pacific midnight when a pair with a live
-- streak doesn't START a hunt together that day (W813 commitment rule).
-- This table is the once-per-(pair, day) claim for the evening warning push:
-- user_a/user_b are the pair in canonical order (user_a < user_b), day_key is
-- the Pacific day the flame would die. INSERT OR IGNORE before send — same
-- claim pattern as win_back_pushes (0047).
CREATE TABLE pact_flame_pushes (
  user_a  TEXT    NOT NULL,
  user_b  TEXT    NOT NULL,
  day_key TEXT    NOT NULL,   -- PT 'YYYY-MM-DD' of the at-risk evening
  sent_at INTEGER NOT NULL,   -- unix ms
  PRIMARY KEY (user_a, user_b, day_key)
);
