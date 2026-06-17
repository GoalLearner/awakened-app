-- 0019_coop_boss_instances.sql
-- Co-op Dungeon Bosses v1 (W370).
--
-- A co-op boss is a SHARED hunt between two accepted friends: they
-- jointly meet a combined verified-step goal inside a 24h window and
-- BOTH are credited the kill. Single-player bosses evaluate their kill
-- condition client-side from HealthKit; a co-op boss CANNOT (it must
-- combine two devices' verified steps), so the authoritative win/loss
-- decision moves server-side. This table is that shared instance.
--
-- Lifecycle (status):
--   pending   — challenger invited a partner; 24h clock NOT started.
--   active    — partner joined; starts_at/ends_at stamped (now + 24h).
--   completed — resolved as a WIN (result='success'); combined >= goal.
--   expired   — 24h elapsed without reaching the goal (result='defeat').
--   declined  — partner declined the invite.
--   cancelled — challenger withdrew a pending invite, OR either participant
--               left an active hunt (W384).
--
-- The combined step total is NOT stored here — it is computed live from
-- verified_events (see 0020) as SUM over participants of MAX(value) per
-- user. MAX because each client resubmits its growing in-window step
-- count repeatedly; MAX = that user's window total. This mirrors the
-- 'max' aggregate the retired steps duels used (duels.ts DUEL_SCORING_CFG).
--
-- Economy note: souls + the relic drop are granted CLIENT-SIDE on the
-- kill (hb_souls + the card/pity inventory are client-authoritative in
-- this game), exactly like a solo boss. This table holds reward_souls
-- only as the agreed per-hunter payout for display + client reconcile;
-- the backend writes no souls ledger row for co-op in v1.
--
-- Apply to remote:
--   wrangler d1 execute awakened-db --remote \
--     --file=migrations/0019_coop_boss_instances.sql
--
-- Local dry-run:
--   wrangler d1 execute awakened-db --local \
--     --file=migrations/0019_coop_boss_instances.sql

CREATE TABLE IF NOT EXISTS coop_boss_instances (
  id TEXT PRIMARY KEY,
  boss_id TEXT NOT NULL,
  boss_rank TEXT NOT NULL,
  challenger_user_id TEXT NOT NULL,
  partner_user_id TEXT NOT NULL,
  goal_steps INTEGER NOT NULL,
  reward_souls INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  result TEXT,
  starts_at TEXT,
  ends_at TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_coop_boss_challenger ON coop_boss_instances(challenger_user_id);
CREATE INDEX IF NOT EXISTS idx_coop_boss_partner ON coop_boss_instances(partner_user_id);
CREATE INDEX IF NOT EXISTS idx_coop_boss_status ON coop_boss_instances(status);
