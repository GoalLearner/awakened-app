-- 0031_founder_marks.sql — W656 "Founder" prestige marker (FREE, earned, capped 100).
--
-- Replaces the removed PAID Founder tier with a purely-cosmetic prestige badge.
-- Grants NO premium access, NO gameplay perks — a title/badge only.
--
-- Eligibility (BOTH, all server-verifiable): the account registered before the
-- 2026-07-09 monetization go-live AND has either the 100K-Club accolade
-- (step_100k_club in user_accolades — 100k verified steps in one week) OR >= 25
-- co-op boss wins (coop_boss_awards rows). Solo boss kills are client-reported
-- and deliberately NOT used — the cap must rest on server truth. Sims have no
-- users row, so they can never qualify or consume a slot.
--
-- CAP: the first 100 to satisfy eligibility, forever. seq (1..100) is the
-- displayable Founder number. The grant is an atomic guarded INSERT (see
-- lib/founder-mark.ts): count-check + insert in ONE statement (D1 serializes
-- writes, so five simultaneous crossers at count 98 cannot mint 103), and
-- UNIQUE(seq) is the belt-and-suspenders against a duplicate number.
CREATE TABLE founder_marks (
  user_id    TEXT NOT NULL PRIMARY KEY,
  seq        INTEGER NOT NULL UNIQUE,          -- Founder #1 .. #100
  granted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Published onto the public profile so leaderboard rows + viewed profile cards
-- carry the Founder number cross-user with no per-read JOIN. NULL = not a Founder.
ALTER TABLE public_profile_summary ADD COLUMN founder_seq INTEGER;
