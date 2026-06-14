-- 0018 — lifetime "avg steps/day" on the public profile card (W304).
--
-- The card previously derived avg steps/day from the latest weekly step_total
-- snapshot ÷ 7 (a rolling-week figure that swings wildly). The client now
-- computes a true LIFETIME average (running total ÷ days since first record)
-- and submits it on the public-profile heartbeat; this column stores it.
-- public-profile-get serves this when present and falls back to the old
-- weekly ÷7 for clients that haven't resubmitted yet (zero-downtime rollout).
ALTER TABLE public_profile_summary ADD COLUMN avg_steps_per_day INTEGER DEFAULT 0;
