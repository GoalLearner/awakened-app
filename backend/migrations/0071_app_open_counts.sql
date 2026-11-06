-- 0071 — W1127: count EVERY open, per hunter per Pacific day. [owner-requested 2026-11-05:
-- "make it count every open"]
--
-- app_opens (0027) keeps one row per user per UTC day and only the LATEST open's time, so
-- "how many times did people open the app today" had no answer. It stays as it is (retention,
-- founder-mark active days, update-push and coop-auto all read it). This table is the counter.
--
--   opens: 3.0.22+ sends {open:true} on each launch and each return to the app, only while the
--          screen can be seen (an Apple Health background wake is not an open), so its count is
--          exact. Pings from those builds with open:false (a forced funnel flush) add 0.
--          Older builds send no `open` key: each of their pings adds 1. They ping at most once
--          per 5 minutes, on launch and on return, so for them it is a close undercount.
--   day_pt: 'YYYY-MM-DD' in America/Los_Angeles, derived server-side (ptDayKey), never sent
--          by the client.
-- One row per user per day; account deletion purges it (account-delete.ts).
--
-- Apply: wrangler d1 migrations apply awakened-db --remote   (run from backend/)
-- Reverse: DROP TABLE IF EXISTS app_open_counts;  (nothing else reads it)

CREATE TABLE IF NOT EXISTS app_open_counts (
  user_id TEXT    NOT NULL,
  day_pt  TEXT    NOT NULL,
  opens   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day_pt)
);

CREATE INDEX IF NOT EXISTS idx_app_open_counts_day ON app_open_counts (day_pt);
