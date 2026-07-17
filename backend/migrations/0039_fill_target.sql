-- 0039_fill_target.sql
-- W695 — "Summon & Fill": a party leader summons 1-3 friends AND opens the remaining
-- seats to the raid finder. fill_target (the intended party size, e.g. 5) marks such a
-- hunt: while pending it does NOT activate when the invited friends have all answered —
-- it becomes a READY open hunt that matchmaking pours solo seekers into (and merges
-- with other open hunts), activating when full OR when the leader explicitly starts it
-- (POST /:id/start, min-party met). NULL = a normal closed hunt (every hunt until now).
--
-- Additive, backward-compatible, NON-idempotent (ALTER ADD COLUMN). Apply EXACTLY once:
--   wrangler d1 execute awakened-db --remote --file=migrations/0039_fill_target.sql
-- Local:
--   wrangler d1 execute awakened-db --local  --file=migrations/0039_fill_target.sql

ALTER TABLE coop_boss_instances ADD COLUMN fill_target INTEGER;
