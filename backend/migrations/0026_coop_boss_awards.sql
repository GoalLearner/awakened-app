-- 0026 — Durable per-participant co-op drop credit (W463.1).
--
-- Co-op duo-hunt souls + relic drops are granted CLIENT-SIDE (the economy is
-- client-authoritative); the backend owns only the win/loss DECISION. Before
-- this table, a backgrounded hunter could be credited the kill server-side yet
-- never receive the drop, and there was no durable record of who was owed it.
--
-- This table records, per WON instance, that each participant is OWED a drop and
-- whether they have CLAIMED it. The client claims ATOMICALLY before granting
-- (POST /v1/coop-boss/:id/claim): only the device that wins the claim grants;
-- others see claimed=1 and skip — so the drop lands EXACTLY ONCE per user even
-- across a device wipe / reinstall / multiple devices.
--
-- Rows are written (INSERT OR IGNORE, both participants) when a hunt first
-- resolves to success. Pre-feature hunts have no row; the client falls back to
-- its local-guard grant for those.
CREATE TABLE IF NOT EXISTS coop_boss_awards (
  instance_id  TEXT    NOT NULL,
  user_id      TEXT    NOT NULL,
  claimed      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  claimed_at   TEXT,
  PRIMARY KEY (instance_id, user_id)
);

-- Per-user lookup for the list endpoint (caller's owed/claimed across instances).
CREATE INDEX IF NOT EXISTS idx_coop_boss_awards_user ON coop_boss_awards (user_id);
