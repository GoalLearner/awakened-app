-- 0076 — W1212: one shared copy of the Today's Briefing step ranking.
-- [owner-requested 2026-11-14: "I want to make sure the awakened server / app won't crash if there's a
-- mass influx of people downloading. Make sure that this does not happen."]
--
-- GET /v1/steps/rank (W1178) reads every recent cloud save and pulls the 14-day step averages out of
-- the JSON. Each Worker isolate kept its own 15-minute copy, so in a rush (Cloudflare spins up many
-- isolates) every new isolate re-read every save: tens of MB of JSON per read at a few thousand
-- hunters, all against the one database. Now the 2-minute cron writes ONE row here every 15 minutes
-- and the endpoint reads that row; an isolate only computes itself when the row is missing or old.
--
-- averages_json = [{"u": user_id, "a": average}, ...] highest first (user ids only so the endpoint can
-- leave the caller out; the response stays anonymous). A deleted account drops out on the next
-- refresh, and account-delete.ts clears the row at once.
--
-- Apply: wrangler d1 migrations apply awakened-db --remote   (run from backend/), BEFORE the deploy
-- Reverse: DROP TABLE steps_rank_cache;

CREATE TABLE IF NOT EXISTS steps_rank_cache (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  first_day     TEXT    NOT NULL,
  averages_json TEXT    NOT NULL,
  computed_at   INTEGER NOT NULL
);
