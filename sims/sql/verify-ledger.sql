-- verify-ledger.sql
--
-- After a duel resolves, verify the reward landed in the
-- user_souls_ledger exactly once for the winner.
--
-- Replace __DUEL_ID__ with the duel's UUID. Returns the
-- ledger row(s) keyed on the duel.
--
-- Expected: exactly ONE row with delta=+40, reason='duel_win',
-- ref_type='duel', ref_id=<duel_id>.
--
-- A second /resolve call should produce ZERO additional rows
-- (UNIQUE constraint on (user_id, ref_type, ref_id, reason)
-- silently dedupes via INSERT OR IGNORE).

SELECT
  l.id              AS ledger_id,
  l.user_id,
  u.alias           AS user_alias,
  l.delta,
  l.reason,
  l.ref_type,
  l.ref_id,
  datetime(l.created_at) AS created
FROM user_souls_ledger l
JOIN users u ON u.id = l.user_id
WHERE l.ref_type = 'duel'
  AND l.ref_id   = '__DUEL_ID__'
ORDER BY l.created_at;
