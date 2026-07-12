-- 0030_premium_subscriptions.sql — W650/W652 "Awakened Premium" (auto-renewable membership)
--
-- Subscriptions EXPIRE, so they cannot ride the permanent skin_entitlements
-- grant path. One row per user carries the paid-through horizon; the
-- entitlement is DERIVED at read time as (expires_at_ms > now), so a lapsed
-- subscription revokes itself with no cron and no revocation event handling.
--
-- W652 — writes are LAST-WRITER-WINS BY EVENT TIME (last_event_ms), not
-- MAX(expires): the horizon must be able to SHRINK when Apple refunds a
-- subscription (RevenueCat: CANCELLATION with cancel_reason CUSTOMER_SUPPORT,
-- followed by EXPIRATION at the refund time) — under MAX semantics a refunded
-- yearly subscriber kept the full ~12 months of membership (adversarial-review
-- HIGH, pre-deploy). The event-time guard keeps redelivered / out-of-order
-- webhooks harmless: a stale event can never overwrite a newer truth.
-- Voluntary CANCELLATION (auto-renew off, no refund) still writes nothing —
-- paid time keeps running, per App Store rules.
CREATE TABLE premium_subscriptions (
  user_id       TEXT NOT NULL PRIMARY KEY,   -- backend userId (= RevenueCat app_user_id)
  product_id    TEXT NOT NULL,               -- monthly/yearly product that set the horizon
  expires_at_ms INTEGER NOT NULL,            -- paid-through, Unix ms (incl. billing grace when known)
  last_event_ms INTEGER NOT NULL DEFAULT 0,  -- RevenueCat event_timestamp_ms of the write that set this row
  store         TEXT NOT NULL DEFAULT 'app_store',
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
