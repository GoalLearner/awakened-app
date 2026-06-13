-- 0016_profile_avatar_power.sql — Player profile card (W-next).
--
-- Two display fields on the public profile, surfaced by the tap-a-name
-- profile card:
--   avatar_id — the hunter's avatar/skin identifier (e.g. 'avatar-warrior').
--               Today it's class-derived; the forward-compatible hook for
--               future purchasable skins (the equipped skin id lands here).
--   power     — the combat power level shown in the Arena ("YOUR POWER"),
--               display-scaled (the number the player sees, ~1,782).
--
-- Both are CLIENT-AUTHORITATIVE display values (same trust model as
-- arena_title / bosses_slain_total): the backend stores what the client
-- submits after shape/range validation; it never recomputes them. The
-- profile-card read endpoint returns them; exact rank_points (XP) stays
-- hidden, same as the friends read.
--
-- Apply to remote (Cloudflare-side) D1:
--   wrangler d1 execute awakened-db --remote \
--     --file=migrations/0016_profile_avatar_power.sql
--
-- NOTE: these are ALTER ... ADD COLUMN (NOT idempotent — re-running errors
-- "duplicate column"). Apply EXACTLY once via execute --file. Do NOT run
-- `wrangler d1 migrations apply` (the prod d1_migrations bookkeeping table
-- is empty by house convention, so it would try to re-run everything).
--
-- Migration discipline (same as 0001-0015): NEVER edit after applying.

ALTER TABLE public_profile_summary
  ADD COLUMN avatar_id TEXT;

ALTER TABLE public_profile_summary
  ADD COLUMN power INTEGER NOT NULL DEFAULT 0;
