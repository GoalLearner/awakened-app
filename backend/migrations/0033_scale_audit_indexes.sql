-- 0033_scale_audit_indexes.sql
-- W673 — scale-audit (100-user readiness). Three ADDITIVE indexes that turn
-- full-table scans / filesorts on interactive read paths into index range scans.
-- Purely a speedup: query RESULTS are byte-identical. Idempotent + non-destructive
-- (each is CREATE INDEX IF NOT EXISTS; reversible via DROP INDEX).
--
-- 1) friends.ts findUserByAlias filters `WHERE LOWER(REPLACE(alias,' ','')) = ?`.
--    The existing idx_users_alias_lower is on LOWER(alias) — a DIFFERENT expression,
--    so that query could not use it and full-scanned users. This functional index
--    matches the exact expression. (Do NOT drop the space-stripping in the query —
--    it is intentional space-insensitive matching, distinct from the uniqueness rule.)
--
-- 2) leaderboard-rank-band.ts issues up to 4 queries per request keyed on
--    (rank_tier = ?) + ORDER BY power DESC + (power > ?) range counts. The only
--    prior index was on rank_sort_value, so all four full-scanned + filesorted.
--    Composite (rank_tier, power DESC, server_updated_at ASC) serves the filter,
--    the range count, and the ordering (incl. the tie-break) as an index scan.
--
-- 3) step-100k-club.ts orders members by (best_value DESC, ...) within an
--    accolade_type; idx_user_accolades_type covers only the filter, leaving a
--    filesort. This composite covers filter + primary sort.
--
-- Apply to remote (house convention — d1_migrations bookkeeping is kept empty, so
-- use d1 execute --file, NOT `migrations apply`):
--   wrangler d1 execute awakened-db --remote --file=migrations/0033_scale_audit_indexes.sql
-- Local dry-run:
--   wrangler d1 execute awakened-db --local --file=migrations/0033_scale_audit_indexes.sql

CREATE INDEX IF NOT EXISTS idx_users_alias_norm
  ON users (LOWER(REPLACE(alias, ' ', '')));

CREATE INDEX IF NOT EXISTS idx_pps_tier_power
  ON public_profile_summary (rank_tier, power DESC, server_updated_at ASC);

CREATE INDEX IF NOT EXISTS idx_user_accolades_type_best
  ON user_accolades (accolade_type, best_value DESC);
