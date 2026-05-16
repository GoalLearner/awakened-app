-- force-ends-at-past.sql
--
-- Forces the active duel identified by __DUEL_ID__ to have an
-- ends_at 10 seconds in the past, so the resolve endpoint will
-- accept it instead of rejecting with DUEL_NOT_ENDED.
--
-- Usage: substitute __DUEL_ID__, then run via
--   wrangler d1 execute awakened-db --remote --command "..."
--
-- Or pipe a file:
--   wrangler d1 execute awakened-db --remote --file=sims/sql/force-ends-at-past.sql
--
-- Guard: only updates rows with status='active' to prevent
-- accidentally rewinding completed/cancelled duels.

UPDATE duels
SET ends_at = datetime('now', '-10 seconds')
WHERE id = '__DUEL_ID__'
  AND status = 'active';
