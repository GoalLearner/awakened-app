-- 0081 — W1281: how many of the last 7 nights the phone's Apple Health has sleep for (0-7), sent on the app-open ping
-- like flights_avg (0075). Owner 2026-11-22: "If people haven't tracked sleep in the past 7 days we can safely assume that
-- this person doesn't have a sleep device so we would have to disqualify these types of co-op bosses". A sleep co-op boss
-- (the Myrmidon King) is only made, and only shows as eligible, when both hunters have at least one night. NULL = an older
-- build or no Health: no sleep device known, so disqualified.
-- Apply: wrangler d1 migrations apply awakened-db --remote (from backend/), BEFORE the deploy.
ALTER TABLE app_opens ADD COLUMN sleep_nights INTEGER;
