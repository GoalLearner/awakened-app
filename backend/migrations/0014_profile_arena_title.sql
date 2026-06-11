-- Migration 0014 — W257: equipped Arena title on the public profile summary.
--
-- The Ascent tower (client-side cosmetic minigame) awards 14 fixed titles
-- (boss clears + rating milestones). The player equips at most one; the
-- equipped title's ID rides the existing public-profile-summary heartbeat
-- and is shown as a chip next to the alias on the global leaderboard.
--
-- Stores the title ID (e.g. 'asc_brawler'), NOT the display name — names
-- resolve client-side from ARENA_TITLES, so copy changes never need a
-- migration. NULL = no title equipped (no chip).
--
-- The PUT handler validates against the fixed 14-ID whitelist. The server
-- cannot verify a title is genuinely unlocked (the Arena is client-side);
-- this is an accepted cosmetic-only risk — the field can never grant
-- power, currency, or progression.

ALTER TABLE public_profile_summary
  ADD COLUMN arena_title TEXT;
