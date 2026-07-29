-- W798 — one-time "hunt nearly done, window closing" push. Stamped on the
-- INSTANCE (one reminder per hunt, all seats pushed together) when the cron
-- sees <=30 minutes left AND >=80% of the primary goal met.
ALTER TABLE coop_boss_instances ADD COLUMN crunch_reminded_at TEXT;
