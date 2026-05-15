-- 0004_verified_duel_types.sql
-- Verified-Only Duel Types (v3 Phase 1x.6).
--
-- Adds a single column to `duels` capturing the user's pre-duel choice
-- of duel type. METADATA ONLY in this pass — scoring engine is not
-- shipped yet. When scoring lands, this column decides which Apple
-- Health / verified-objective query runs against each participant.
--
-- Allowed values (validated in src/handlers/duels.ts, NOT in SQL —
-- frontend may need to evolve the set faster than a CHECK constraint
-- allows):
--   'steps' | 'sleep' | 'bedtime' | 'strength'
--   | 'verified_objectives' | 'boss_race'
--
-- Apply to remote:
--   wrangler d1 execute awakened-db --remote \
--     --file=migrations/0004_verified_duel_types.sql
--
-- Local dry-run:
--   wrangler d1 execute awakened-db --local \
--     --file=migrations/0004_verified_duel_types.sql

ALTER TABLE duels
  ADD COLUMN duel_type TEXT NOT NULL DEFAULT 'verified_objectives';

CREATE INDEX IF NOT EXISTS idx_duels_type ON duels(duel_type);
