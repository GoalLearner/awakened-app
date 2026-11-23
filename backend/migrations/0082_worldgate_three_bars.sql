-- 0082 — W1283: the Worldgate's three HP bars (steps, flights, sleep). Owner 2026-11-22: "I want to have the world gate do the
-- steps + flights HP bar + Sleep total ... So this worldgate will have all of these to complete to kill it" and "the kill wall has
-- to be % damage". From the gate of WG3_FROM (worldgate.ts) on, a gate carries an HP for flights and one for sleep (minutes)
-- beside its steps HP (`hp`); it falls when all three are spent. Older gates keep NULL here and stay steps-only.
-- world_gate_effort holds each hunter's flights and minutes asleep for a gate week, sent by the phone (POST /v1/worldgate/effort),
-- capped per day by the server, one row per (week, hunter), never lowered.
-- world_gate_claims.drops records the bounty's relic rolls ('s_tier', 'mythic', comma-joined), so a claim answers once.
-- Apply: wrangler d1 migrations apply awakened-db --remote (from backend/), BEFORE the deploy.
ALTER TABLE world_gates ADD COLUMN hp_flights INTEGER;
ALTER TABLE world_gates ADD COLUMN hp_sleep INTEGER;
CREATE TABLE IF NOT EXISTS world_gate_effort (
  week_start TEXT NOT NULL,
  user_id TEXT NOT NULL,
  flights INTEGER NOT NULL DEFAULT 0,
  sleep_min INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (week_start, user_id)
);
ALTER TABLE world_gate_claims ADD COLUMN drops TEXT;
