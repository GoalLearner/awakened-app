-- 0059_coop_seat_target.sql
-- ⚠ SUPERSEDED the same night by W925 (owner: hunters may run several co-op hunts
-- at once, so EVERY accepted invite becomes its own hunt — a multi-pick summons now
-- fans out into one duo instance per friend). The column stays (applied to remote
-- 2026-09-08) but nothing writes or reads it.
-- W924 — FIRST TO ANSWER JOINS (Rendell, 2026-09-08: "see if you can select
-- multiple at a time to bypass this screen").
--
-- A duo hunt used to take exactly ONE invited ally, so summoning a hunt meant
-- picking one friend, landing on "Waiting for X to accept", backing out, and
-- doing it again. Now the summoner can invite SEVERAL friends to the same duo:
-- every one of them holds a candidate seat (a participant row), the FIRST to
-- answer takes the real seat, the rest are released. `seat_target` is how many
-- allies must answer to activate (1 for a duo); NULL keeps the legacy rule
-- (every invited seat must answer). Trios and raids are unchanged.
--
-- Apply to remote (house convention — d1_migrations bookkeeping stays empty):
--   wrangler d1 execute awakened-db --remote --file=migrations/0059_coop_seat_target.sql

ALTER TABLE coop_boss_instances ADD COLUMN seat_target INTEGER;
