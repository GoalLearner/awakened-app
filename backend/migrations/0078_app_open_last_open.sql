-- 0078 — W1250: the time of a hunter's latest REAL app open.
-- [owner 2026-11-20, on raiders who seemed active but posted no raid steps: "I am pretty sure it just is a
-- background thing but they don't actually open the app"]
--
-- app_opens.opened_at moves on every ping, and an Apple Health background wake pings too (open:false), so it
-- cannot tell a person opening the app from the phone waking it. app_open_counts only counts real opens but kept
-- no time. last_open_at (ms) is stamped on each real open, so the raid stand-in rule (24 hours away) reads real
-- opens only. Rows from before this migration stay NULL; readers take the end of that Pacific day.
--
-- Apply: wrangler d1 migrations apply awakened-db --remote   (run from backend/), BEFORE the deploy
-- (the counter's upsert names this column).
-- Reverse: harmless to leave; the column is only read by the raid sweeps.

ALTER TABLE app_open_counts ADD COLUMN last_open_at INTEGER;
