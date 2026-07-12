-- 0030_premium_subscriptions.sql — W650 "Awakened Premium" (auto-renewable membership)
--
-- Subscriptions EXPIRE, so they cannot ride the permanent skin_entitlements
-- grant path. One row per user carries the paid-through horizon; the
-- entitlement is DERIVED at read time as (expires_at_ms > now), so a lapsed
-- subscription revokes itself with no cron and no revocation event handling.
-- RevenueCat webhook events (INITIAL_PURCHASE / RENEWAL / UNCANCELLATION /
-- PRODUCT_CHANGE / EXPIRATION) upsert expires_at_ms from the event's
-- expiration_at_ms. CANCELLATION (auto-renew toggled off) deliberately does
-- NOT touch the row — a cancelled subscriber stays premium until paid time
-- runs out, per App Store rules.
CREATE TABLE premium_subscriptions (
  user_id       TEXT NOT NULL PRIMARY KEY,   -- backend userId (= RevenueCat app_user_id)
  product_id    TEXT NOT NULL,               -- monthly/yearly product that set the horizon
  expires_at_ms INTEGER NOT NULL,            -- paid-through, Unix ms (RevenueCat expiration_at_ms)
  store         TEXT NOT NULL DEFAULT 'app_store',
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
