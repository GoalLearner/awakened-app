-- W836 (Train 3, R2) — server-side win-back push ledger.
--
-- The client's local comeback notifications die on reinstall or a permission
-- change; this is the server-side replacement. One row per (user, lapse):
-- lapse_open_date is the user's latest app_opens.date_utc AT SEND TIME, so a
-- hunter who returns and lapses again gets a fresh anchor and becomes
-- eligible exactly once more. INSERT OR IGNORE on this PK is the claim that
-- makes overlapping cron runs unable to double-send (same pattern as the
-- Monday broadcast's cursor CAS).
CREATE TABLE win_back_pushes (
  user_id         TEXT    NOT NULL,
  lapse_open_date TEXT    NOT NULL,   -- 'YYYY-MM-DD' (UTC) — their last open when nudged
  sent_at         INTEGER NOT NULL,   -- unix ms
  PRIMARY KEY (user_id, lapse_open_date)
);
