-- 0077 — W1248: raid stand-ins.
-- [owner-requested 2026-11-20: "If a player on a raid is currently inactive for 24 hours straight, replace
-- them with a person that is waiting to be on a raid or that is active and qualifies to be raiding."]
--
-- A hunter away 24 hours leaves their raid and a stand-in takes the seat. What the departed hunter already
-- walked stays with the team: their steps and flights at the moment of the swap are banked on the raid row
-- and added to the team's totals (so a bar never goes backwards). coop_raid_swaps keeps who left, who came
-- in and what was banked, for the owner's checks.
--
-- Apply: wrangler d1 migrations apply awakened-db --remote   (run from backend/), BEFORE the deploy
-- Reverse: DROP TABLE coop_raid_swaps; (the two columns are harmless at 0)

ALTER TABLE coop_boss_instances ADD COLUMN banked_steps INTEGER NOT NULL DEFAULT 0;
ALTER TABLE coop_boss_instances ADD COLUMN banked_flights INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS coop_raid_swaps (
  instance_id  TEXT    NOT NULL,
  out_user_id  TEXT    NOT NULL,
  in_user_id   TEXT    NOT NULL,
  out_steps    INTEGER NOT NULL DEFAULT 0,
  out_flights  INTEGER NOT NULL DEFAULT 0,
  swapped_at   TEXT    NOT NULL,
  PRIMARY KEY (instance_id, out_user_id, swapped_at)
);
CREATE INDEX IF NOT EXISTS idx_coop_raid_swaps_instance ON coop_raid_swaps (instance_id);
