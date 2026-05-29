-- 0013_public_profile_achievements.sql — Global Friend
-- Achievements MVP-A (v3 Phase 1z.195).
--
-- Extends 0012's public_profile_summary table with three typed,
-- public-safe achievement summary columns + an updated_at marker.
-- Client submits these via the same PUT /v1/users/me/
-- public-profile-summary as the rank fields (1z.190); friends-
-- list LEFT JOIN already projects this table, so the new fields
-- light up automatically once the client write path ships in
-- 1z.196.
--
-- Privacy posture (locked in 1z.194 audit):
--   bosses_slain_total        — game fiction aggregate; no PHI.
--   ultra_rare_drops_total    — public-flex by design; no PHI.
--   verified_streak_label     — streak type + length only ("30-day
--                                MR streak"); NEVER the user's
--                                private habit name.
--   achievements_updated_at   — set ONLY when at least one
--                                achievement field is present on
--                                the PUT body, so the rank-only
--                                daily heartbeat does not churn
--                                this column.
--
-- Design choices:
--   - Typed columns, not metadata_json. Queryable, indexable,
--     validatable. The metadata_json column (added in 0012) stays
--     reserved for genuinely future-unstable fields.
--   - All four columns are nullable / DEFAULT 0 so existing rows
--     migrate cleanly without backfill.
--   - No new index in v1; achievement-sorted reads are not yet a
--     product surface. Add an index later if needed.
--
-- Apply to remote (Cloudflare-side) D1:
--   wrangler d1 execute awakened-db --remote \
--     --file=migrations/0013_public_profile_achievements.sql
--
-- Local dry-run:
--   wrangler d1 execute awakened-db --local \
--     --file=migrations/0013_public_profile_achievements.sql
--
-- Migration discipline (same as 0001-0012): NEVER edit after
-- applying. Add 0014_*.sql for any subsequent schema changes.

ALTER TABLE public_profile_summary
  ADD COLUMN bosses_slain_total INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public_profile_summary
  ADD COLUMN ultra_rare_drops_total INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public_profile_summary
  ADD COLUMN verified_streak_label TEXT;

ALTER TABLE public_profile_summary
  ADD COLUMN achievements_updated_at INTEGER;
