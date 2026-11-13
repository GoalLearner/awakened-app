-- 0075 — W1195: each hunter's daily flights average, for the automatic duo hunts.
-- [owner-requested 2026-11-13: "get the averages of the users and then pick the closest duo boss for
-- the automated so it isn't just twin maw or coursing dread all the time ... even automate steps +
-- flights if a user averages flights per day"]
--
-- The phone (3.0.24-w1195+) sends flights_avg on its app-open ping: the mean of its last 14 complete
-- days of Apple Health flights (days it recorded, at least 3), one decimal. The server keeps the day
-- row's latest non-null value (COALESCE, like build). coop-auto.ts reads each hunter's newest value
-- from the last 7 days; the pair's sum decides whether a steps + flights or flights duo boss fits.
-- Never shown to anyone, never sent back. Older builds send nothing: NULL = no flights bosses.
-- Account deletion already purges app_opens (account-delete.ts).
--
-- Apply: wrangler d1 migrations apply awakened-db --remote   (run from backend/), BEFORE the deploy
-- Reverse: ALTER TABLE app_opens DROP COLUMN flights_avg;

ALTER TABLE app_opens ADD COLUMN flights_avg REAL;
