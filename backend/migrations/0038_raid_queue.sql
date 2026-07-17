-- 0038_raid_queue.sql
-- W694 — raid-finder MATCHMAKING for the members-only Grinning God raid. A member who
-- can't field a full party of five queues here; a matchmaking pass forms queued seekers
-- into a party (2..maxParty) and spins up a coop_boss_instances hunt with them as
-- auto-joined participants (they consented to start by queuing). Rides the W692 N-hunter
-- participant model — no changes to the instance tables.
--
-- One row per hunter (PRIMARY KEY user_id): a hunter is in at most one queue at a time.
-- created_at is the FIFO position (kept across poll re-POSTs); last_seen_at is the
-- liveness HEARTBEAT, refreshed by every poll tick — the staleness TTL runs on the
-- heartbeat, NOT created_at (W694 review: a TTL on created_at deadlocks a queue that
-- takes longer than the TTL to fill, aging out actively-searching hunters).
--
-- Apply to remote (house convention — d1_migrations bookkeeping stays empty, so use
-- d1 execute --file, NOT `migrations apply`):
--   wrangler d1 execute awakened-db --remote --file=migrations/0038_raid_queue.sql
-- Local:
--   wrangler d1 execute awakened-db --local  --file=migrations/0038_raid_queue.sql

CREATE TABLE IF NOT EXISTS raid_queue (
  user_id      TEXT PRIMARY KEY,
  boss_id      TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- The matchmaking pass fans out by boss_id (oldest-first within a boss); index it.
CREATE INDEX IF NOT EXISTS idx_raid_queue_boss ON raid_queue(boss_id, created_at);
