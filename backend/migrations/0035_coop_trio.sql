-- 0035_coop_trio.sql
-- W677 — TRIO co-op hunts (owner: "handpick 2 friends in your guild"; same co-op
-- system + Pacts, just a bigger party — NOT a separate feature).
--
-- Additive, backward-compatible, NON-idempotent (ALTER ADD COLUMN). Apply EXACTLY
-- once. Duo rows are untouched: partner2_user_id stays NULL, and every existing
-- query keeps working (party size is derived: partner2 set → trio).
--
--   partner2_user_id    — the second invited ally (NULL = duo hunt, the v1 shape).
--   partner_joined_at   — trio-only: when the FIRST-slot ally accepted. A trio
--   partner2_joined_at  — activates (starts_at/ends_at stamped, 24h clock starts)
--                         only once BOTH allies have joined; these two stamps track
--                         who has answered while the instance is still 'pending'.
--                         Duo hunts keep the v1 behavior (join → instantly active)
--                         and leave both stamps NULL.
--
-- Apply to remote (house convention — d1_migrations bookkeeping stays empty, so
-- use d1 execute --file, NOT `migrations apply`):
--   wrangler d1 execute awakened-db --remote --file=migrations/0035_coop_trio.sql
-- Local dry-run:
--   wrangler d1 execute awakened-db --local --file=migrations/0035_coop_trio.sql

ALTER TABLE coop_boss_instances ADD COLUMN partner2_user_id TEXT;
ALTER TABLE coop_boss_instances ADD COLUMN partner_joined_at TEXT;
ALTER TABLE coop_boss_instances ADD COLUMN partner2_joined_at TEXT;

-- Mirrors idx_coop_boss_partner (0019): the list/cap/pact queries now also probe
-- by partner2_user_id.
CREATE INDEX IF NOT EXISTS idx_coop_boss_partner2
  ON coop_boss_instances(partner2_user_id);
