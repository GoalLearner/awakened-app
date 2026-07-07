-- 0029_device_tokens.sql
-- Push notifications v1 (W603).
--
-- Stores one row per (device, user) so the backend can send a REMOTE
-- APNs push (friend request, friend accepted, co-op invite, co-op join)
-- to a recipient whose app is CLOSED/backgrounded. Until now the client
-- discovered these events ONLY by polling while open (see the "there is
-- no push infra" admissions in app.js); this table is the missing half.
--
-- Model:
--   token       — the APNs device token (hex string). PRIMARY KEY: a
--                 single physical device has one token, and re-registering
--                 the same token upserts its user_id (covers reinstall /
--                 a different hunter signing in on the same phone).
--   user_id     — the recipient key. Matches users.id (the internal UUID
--                 that the session JWT carries as `sub`), which is the
--                 exact value every push trigger site already has in
--                 scope (session.userId / target.id / partner_user_id).
--                 One user may have MANY devices → indexed, not unique.
--   platform    — 'ios' for now (APNs). Column exists so a future
--                 Android/FCM path slots in without a migration.
--   environment — 'production' (TestFlight / App Store, the aps-environment
--                 the build scripts set) or 'sandbox' (Xcode debug builds).
--                 Decides which APNs host the send routine targets; a token
--                 is only valid on its matching host.
--   bundle_id   — the apns-topic used to send (defensive; == APPLE_BUNDLE_ID).
--
-- Dead tokens (APNs 410 Unregistered / 400 BadDeviceToken) are pruned by
-- the send routine (src/lib/apns.ts), so this table self-heals — no cron.
--
-- No FK constraint (consistent with the rest of the schema, e.g. friends /
-- coop_boss_instances declare none); orphan rows are harmless and get
-- pruned on the next failed send.
--
-- Apply to remote:
--   wrangler d1 execute awakened-db --remote \
--     --file=migrations/0029_device_tokens.sql
--
-- Local dry-run:
--   wrangler d1 execute awakened-db --local \
--     --file=migrations/0029_device_tokens.sql

CREATE TABLE IF NOT EXISTS device_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'ios',
  environment TEXT NOT NULL DEFAULT 'production',
  bundle_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id);
