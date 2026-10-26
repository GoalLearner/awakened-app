-- 0069_coop_auto_hunts.sql
-- W1094 — automatic friend hunts (owner, 2026-10-25: "being friends is enough").
--
-- Every accepted friend pair gets one duo hunt a day, created by the cron with both seats
-- already joined and a goal sized to what the two of them actually walk. The server settles
-- every hunt (sweepCoopResolve) — before this, a hunt nobody's phone resolved stayed 'active'
-- for ever.
--
-- 1. coop_boss_instances: auto (1 = cron-made), hunt_day (the Pacific start day), pair_key
--    (sorted "a|b"), committed (stamped at settle: 1 = every hunter posted progress, which is
--    what lets the day count toward the pact flame — W1094 flame rule; stored because
--    verified_events is pruned after 45 days).
--    The partial unique index makes a pair's day idempotent however often the sweep ticks.
-- 2. coop_auto_optouts: a hunter switching one friend off (friend_user_id) or everything off
--    (friend_user_id = '*'). Either side's row stops the pair.
-- 3. users.coop_auto_push_day: the one automatic win push a hunter gets per Pacific day.
-- 4. (status, ends_at) index: the settle sweep reads active hunts by deadline.
--
-- Apply: wrangler d1 migrations apply awakened-db --remote  — BEFORE deploying the worker
-- (the settle UPDATE writes `committed`).

ALTER TABLE coop_boss_instances ADD COLUMN auto INTEGER NOT NULL DEFAULT 0;
ALTER TABLE coop_boss_instances ADD COLUMN hunt_day TEXT;
ALTER TABLE coop_boss_instances ADD COLUMN pair_key TEXT;
ALTER TABLE coop_boss_instances ADD COLUMN committed INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_coop_auto_pair_day
  ON coop_boss_instances (pair_key, hunt_day) WHERE auto = 1;

CREATE INDEX IF NOT EXISTS idx_coop_instances_status_ends
  ON coop_boss_instances (status, ends_at);

CREATE TABLE IF NOT EXISTS coop_auto_optouts (
  user_id        TEXT NOT NULL,
  friend_user_id TEXT NOT NULL,            -- a users.id, or '*' = every friend
  created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, friend_user_id)
);

ALTER TABLE users ADD COLUMN coop_auto_push_day TEXT;
