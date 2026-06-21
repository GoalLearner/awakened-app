-- 0025_prestige_level.sql — Prestige (W453): the endgame past S+.
--
-- One display field on the public profile: the hunter's Prestige star count.
-- Every 12,000 XP earned BEYOND the S+ threshold (36,000) is another ascending
-- ✦ star. It's a CLIENT-AUTHORITATIVE display value (same trust model as
-- power / arena_title / bosses_slain_total): the backend stores what the
-- client submits after a [0, 100000] range check; it never recomputes it from
-- XP. Surfaced on the friends list + tap-a-name profile card so the long-term
-- player base visibly "stunts on noobs" — exact rank_points (XP) stays hidden.
-- 0 for everyone below S+ and for pre-W453 clients (column DEFAULT 0).
--
-- Apply to remote (Cloudflare-side) D1 BEFORE deploying the W453 worker (the
-- new INSERT references prestige_level):
--   wrangler d1 execute awakened-db --remote \
--     --file=migrations/0025_prestige_level.sql
--
-- NOTE: ALTER ... ADD COLUMN is NOT idempotent (re-running errors "duplicate
-- column"). Apply EXACTLY once via execute --file. Do NOT run
-- `wrangler d1 migrations apply` (the prod d1_migrations bookkeeping table is
-- empty by house convention, so it would try to re-run everything).
--
-- Migration discipline (same as 0001-0024): NEVER edit after applying.

ALTER TABLE public_profile_summary
  ADD COLUMN prestige_level INTEGER NOT NULL DEFAULT 0;
