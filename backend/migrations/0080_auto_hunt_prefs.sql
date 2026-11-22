-- 0080 — W1268: the Auto Hunts manager (owner 2026-11-21: "DO it all").
-- One row per hunter who changed anything; no row = Auto, no targets, matching and the raid draw on.
--   mode         'auto' | 'targets'
--   targets_json up to 3 [{ "b": boss id, "d": drop id | "any" }], best first; kept while on Auto
--   match_on     0 = never matched with a new hunter (W1164 matching)
--   raid_on      0 = never drawn into an automatic raid, nor as a stand-in
-- coop_boss_instances.auto_reason: on an automatic hunt the cron picked from targets, the comma list of the
-- hunters whose target it was (the hunt card's "Your target" / "<name> needs this drop" tag); NULL = Auto.
-- Apply: wrangler d1 migrations apply awakened-db --remote (from backend/), BEFORE the deploy.
-- Reverse: harmless to leave; an empty table means everyone is on Auto, as before.
CREATE TABLE IF NOT EXISTS coop_auto_prefs (
  user_id      TEXT PRIMARY KEY,
  mode         TEXT NOT NULL DEFAULT 'auto',
  targets_json TEXT NOT NULL DEFAULT '[]',
  match_on     INTEGER NOT NULL DEFAULT 1,
  raid_on      INTEGER NOT NULL DEFAULT 1,
  updated_at   INTEGER NOT NULL
);
ALTER TABLE coop_boss_instances ADD COLUMN auto_reason TEXT;
