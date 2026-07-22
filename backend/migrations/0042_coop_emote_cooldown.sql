-- 0042_coop_emote_cooldown.sql
-- W750 — battle-cry cooldown (owner: "every 4 hours, you can send a message").
--
-- One row per user: when they last sent ANY battle cry (rally/push/finish share
-- the one budget). The handler refuses with 429 EMOTE_COOLDOWN inside the 4h
-- window. Server-authoritative on purpose — the client greys its buttons too,
-- but a modded client must not be able to spam APNs pushes at a party
-- (vibe-audit item 2: the UI is never the security).
--
-- Migration discipline: never edit an applied file; forward-only add.
CREATE TABLE IF NOT EXISTS coop_emote_cooldowns (
  user_id TEXT PRIMARY KEY,
  sent_at INTEGER NOT NULL          -- unix ms of the last accepted battle cry
);
