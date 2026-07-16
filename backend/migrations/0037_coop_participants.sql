-- 0037_coop_participants.sql
-- W692 — scale co-op hunts from a fixed ≤3 seats to N hunters (up to 5, for the
-- W693 "Grinning God" members raid). The challenger STAYS a column on
-- coop_boss_instances (the leader/creator); every OTHER hunter moves to a row
-- here. participantIds() (coop-boss.ts) — the single seam the progress / resolve
-- / award / notify / pact paths fan out over — now reads this table.
--
-- ADDITIVE + backward-compatible: the legacy partner_user_id / partner2_user_id /
-- partner_joined_at / partner2_joined_at columns are LEFT IN PLACE (house rule:
-- ALTER…DROP is non-idempotent; serializeCoop keeps emitting them one release for
-- old clients). New writes go to BOTH the columns (duo/trio compat) and this table.
--
-- joined_at semantics (mirror the seat-stamp model): NULL = invited, not yet
-- answered; non-NULL = this hunter joined (a duo/trio activates only once every
-- participant row has joined_at set).
--
-- Apply to remote:
--   wrangler d1 execute awakened-db --remote --file=migrations/0037_coop_participants.sql
-- Local:
--   wrangler d1 execute awakened-db --local  --file=migrations/0037_coop_participants.sql

CREATE TABLE IF NOT EXISTS coop_boss_participants (
  instance_id TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  joined_at   TEXT,               -- NULL = invited/unanswered; set = joined (clock-eligible)
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (instance_id, user_id)
);
-- The cap + "my hunts" queries fan out by user_id; index it.
CREATE INDEX IF NOT EXISTS idx_coop_participants_user ON coop_boss_participants(user_id);

-- Backfill existing partner + partner2 seats into participant rows. joined_at:
-- prefer the trio stamp; else, for a non-pending (already-activated) hunt the
-- ally has joined so anchor to starts_at; a pending duo/trio invite stays NULL.
INSERT OR IGNORE INTO coop_boss_participants (instance_id, user_id, joined_at)
  SELECT id, partner_user_id,
         COALESCE(partner_joined_at, CASE WHEN status = 'pending' THEN NULL ELSE starts_at END)
    FROM coop_boss_instances
   WHERE partner_user_id IS NOT NULL AND partner_user_id <> '';

INSERT OR IGNORE INTO coop_boss_participants (instance_id, user_id, joined_at)
  SELECT id, partner2_user_id,
         COALESCE(partner2_joined_at, CASE WHEN status = 'pending' THEN NULL ELSE starts_at END)
    FROM coop_boss_instances
   WHERE partner2_user_id IS NOT NULL AND partner2_user_id <> '';
