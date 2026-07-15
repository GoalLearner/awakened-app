-- 0034_friends_live_pair_unique.sql
-- W674 — close the mutual friend-request race. The friends table's only
-- uniqueness was the DIRECTIONAL UNIQUE(requester_user_id, recipient_user_id),
-- so (A,B) and (B,A) are distinct rows. Two users adding each other in the same
-- ~tens-of-ms window (each pre-check runs before the other's INSERT commits) both
-- inserted a pending row → auto-accept defeated AND "remove friend" left the
-- reciprocal row alive (still-friends-after-remove). This adds an UNORDERED-pair
-- uniqueness so at most ONE live row can exist per pair regardless of direction;
-- the raced second INSERT then fails and handleFriendsRequest converges it to
-- auto-accept.
--
-- PARTIAL (WHERE status IN ('pending','accepted')) — declined/blocked rows are
-- KEPT in this table (decline UPDATEs status; only remove DELETEs), and a declined
-- pair must NOT block a fresh request in either direction. Scoping the index to
-- LIVE rows preserves the re-friend-after-decline flow while still allowing at most
-- one active friendship/request per pair.
--
-- Verified 2026-07-15 against remote: ZERO existing unordered pairs have >1 live
-- row, so this index builds cleanly with no dedup step. Additive + reversible
-- (DROP INDEX idx_friends_live_pair). Apply (house convention — d1 execute, not
-- `migrations apply`):
--   wrangler d1 execute awakened-db --remote --file=migrations/0034_friends_live_pair_unique.sql

CREATE UNIQUE INDEX IF NOT EXISTS idx_friends_live_pair
  ON friends (
    (CASE WHEN requester_user_id < recipient_user_id THEN requester_user_id ELSE recipient_user_id END),
    (CASE WHEN requester_user_id < recipient_user_id THEN recipient_user_id ELSE requester_user_id END)
  )
  WHERE status IN ('pending', 'accepted');
