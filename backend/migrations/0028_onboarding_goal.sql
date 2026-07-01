-- 0028_onboarding_goal.sql
-- Vertical Jump Program (FITxVERT acquisition feature).
--
-- Adds a dedicated, QUERYABLE onboarding-goal flag to the users table so we can
-- (a) count how many installs arrived for the jump program (the FITxVERT proxy
-- metric) with a plain SQL COUNT — no JSON-blob parsing — and (b) hold the
-- server-authoritative source of truth for the client-side jump-library
-- partition. Values: 'jump_program' | 'default'. Legacy users default to
-- 'default' so nothing about their existing habit access changes.
--
-- Migration discipline: never edit an applied file; this is a forward-only add.
ALTER TABLE users ADD COLUMN onboarding_goal TEXT NOT NULL DEFAULT 'default';

-- Cohort counts (SELECT COUNT(*) ... WHERE onboarding_goal = 'jump_program')
-- and GROUP BYs stay fast as the table grows.
CREATE INDEX IF NOT EXISTS idx_users_onboarding_goal ON users(onboarding_goal);
