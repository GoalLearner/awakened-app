-- W842 (Train 4, G1) — universal-link invite loop, server side.
--
-- Every share surface used to end at a bare App Store link: K-factor ≈ 0 by
-- construction (no token, no attribution, no reward). This gives each hunter
-- ONE stable invite code (embedded in share URLs as
-- https://<worker>/i/<code>), and records exactly-once redemptions that
-- carry the friendship + both-sides souls reward.
--
-- invite_codes: one row per user, forever. The code is the user's permanent
-- referral identity — share cards can bake it in without expiry logic.
CREATE TABLE invite_codes (
  user_id    TEXT    PRIMARY KEY,
  code       TEXT    NOT NULL UNIQUE,  -- short slug, unambiguous alphabet
  created_at INTEGER NOT NULL          -- unix ms
);
CREATE INDEX idx_invite_codes_code ON invite_codes (code);

-- invite_redemptions: PK on the REDEEMER = a hunter can be recruited once,
-- ever, by anyone (the anti-farm invariant — no code-swapping rings).
-- redeemer's +souls grant rides the redeem response (the INSERT is the
-- exactly-once moment); the inviter's grant is claimed later via the guarded
-- inviter_claimed 0→1 flip (same client-side-grant model as coop_boss_awards
-- — the backend owns THAT it happened, the client owns paying it out).
CREATE TABLE invite_redemptions (
  redeemer_user_id TEXT    PRIMARY KEY,
  inviter_user_id  TEXT    NOT NULL,
  code             TEXT    NOT NULL,
  redeemed_at      INTEGER NOT NULL,           -- unix ms
  inviter_claimed  INTEGER NOT NULL DEFAULT 0  -- inviter's souls paid out client-side
);
CREATE INDEX idx_invite_redemptions_inviter ON invite_redemptions (inviter_user_id, inviter_claimed);
