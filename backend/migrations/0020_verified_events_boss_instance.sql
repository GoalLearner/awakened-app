-- 0020_verified_events_boss_instance.sql
-- Co-op Dungeon Bosses v1 (W370).
--
-- Lets the EXISTING verified_events log (0006) carry a co-op boss
-- instance id alongside its (now legacy) duel_id. The same live
-- POST /v1/verified-events endpoint + UNIQUE(user_id, client_event_id)
-- dedupe + RL_DUELS_WRITE limiter are reused unchanged — a co-op
-- step submission is just a 'steps_total' event with boss_instance_id
-- set instead of duel_id.
--
-- The co-op resolver aggregates per instance:
--   SELECT user_id, MAX(value) FROM verified_events
--    WHERE boss_instance_id = ? AND event_type = 'steps_total'
--    GROUP BY user_id
-- then sums the two participants' maxes for the combined total.
--
-- Additive + non-destructive: the column is nullable, so every legacy
-- duel/outbox event keeps inserting exactly as before.
--
-- Apply to remote:
--   wrangler d1 execute awakened-db --remote \
--     --file=migrations/0020_verified_events_boss_instance.sql
--
-- Local dry-run:
--   wrangler d1 execute awakened-db --local \
--     --file=migrations/0020_verified_events_boss_instance.sql

ALTER TABLE verified_events ADD COLUMN boss_instance_id TEXT;
CREATE INDEX IF NOT EXISTS idx_verified_events_boss
  ON verified_events(boss_instance_id, user_id);
