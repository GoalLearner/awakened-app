-- 0017 — Skin entitlements (cosmetic avatar skins bought via real-money IAP).
--
-- Server-side source of truth for which premium skins a user owns. Granted by
-- the RevenueCat webhook (POST /v1/iap/revenuecat-webhook, shared-secret auth);
-- read by the client via GET /v1/users/me/entitlements (cache-first, display-
-- only on device — mirrors the user_accolades pattern). Non-consumable: owned
-- forever. COSMETIC ONLY — these never affect stats, the Ascent, or rank.
--
-- Grant is idempotent via the (user_id, skin_id) primary key, so RevenueCat
-- webhook redelivery / restore-purchases replays are safe no-ops.
CREATE TABLE IF NOT EXISTS skin_entitlements (
  user_id      TEXT NOT NULL,
  skin_id      TEXT NOT NULL,                 -- catalog id, e.g. 'avatar-skin-stardust.png'
  product_id   TEXT NOT NULL DEFAULT '',      -- store product id that granted it
  store        TEXT NOT NULL DEFAULT 'app_store',
  store_txn_id TEXT,                          -- original store transaction id (audit/trace)
  source       TEXT NOT NULL DEFAULT 'revenuecat_webhook',
  acquired_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, skin_id)
);

CREATE INDEX IF NOT EXISTS idx_skin_entitlements_user ON skin_entitlements (user_id);
