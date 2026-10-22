-- 0068_security_and_scale.sql
-- W1075/W1076 — the 2026-10-21 security + scale pass (six parallel reviews).
--
-- 1. users.token_version — server-side session revocation. Every session JWT now carries a
--    `tv` claim; the per-request users lookup compares it. Sign-out bumps the column, so a
--    stolen or leaked token dies the moment the hunter signs out (before this, only account
--    deletion killed a token: 90 days + 30 days of grace).
-- 2. A UNIQUE index on the normalised alias. "RenDiesel" and "Ren Diesel" rendered as the same
--    name everywhere (the app strips spaces for display) and the friend lookup picked whichever
--    row came first: a stranger could pre-register a creator's name. Verified 2026-10-21: no two
--    live rows share a normalised form, so the unique index creates cleanly.
-- 3. Indexes for the prunes and scans the scale review found unindexed:
--    verified_events(occurred_at) — the new age prune; public_achievement_events(server_created_at)
--    — its prune; board_reports(reporter_id, created_at) — the per-reporter daily cap;
--    board_topics(created_at) — the Community badge count walked every visible topic;
--    coop_boss_instances(starts_at) — the nightly pact-flame sweep was a full scan;
--    app_opens(date_utc) — the Monday push's build report scanned the table.
--
-- Apply: wrangler d1 migrations apply awakened-db --remote  (bookkeeping is current as of 0067)
-- Every statement is idempotent.

ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_alias_norm_uq ON users (LOWER(REPLACE(alias, ' ', '')));

CREATE INDEX IF NOT EXISTS idx_verified_events_occurred ON verified_events (occurred_at);
CREATE INDEX IF NOT EXISTS idx_pae_time ON public_achievement_events (server_created_at);
CREATE INDEX IF NOT EXISTS idx_board_reports_reporter_time ON board_reports (reporter_id, created_at);
CREATE INDEX IF NOT EXISTS idx_board_topics_created ON board_topics (created_at);
CREATE INDEX IF NOT EXISTS idx_coop_boss_starts_at ON coop_boss_instances (starts_at);
CREATE INDEX IF NOT EXISTS idx_app_opens_date ON app_opens (date_utc);
