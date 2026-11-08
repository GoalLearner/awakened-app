-- W1164 — matched hunt partners. Owner, 2026-11-07: "Specifically those two orfhlaith and Sharr
-- would be a perfect pairing and I think that's how the pairing should be - two active hunters
-- with no friends."
--
-- The automatic-hunt cron (coop-auto.ts) now also pairs active hunters who have no friends with
-- each other and gives each pair the same daily sized hunt friends get (auto = 1). matched = 1
-- marks those rows so a stranger pair never forms a Pact Flame (the flame, its at-risk push and
-- Emberforged stay friend-only) and so the cron can keep a pair together for the PT week.
-- Every existing row is a friend or manual hunt: 0.
ALTER TABLE coop_boss_instances ADD COLUMN matched INTEGER NOT NULL DEFAULT 0;
