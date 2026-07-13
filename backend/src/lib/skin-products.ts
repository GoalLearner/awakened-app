/**
 * skin-products.ts — App Store product identifier → in-app skin catalog id.
 *
 * Single source of truth for the product↔skin mapping on the server. Keep in
 * sync with:
 *   - PREMIUM_SKINS in app.js (the client catalog + its `productId` field)
 *   - the In-App Purchase products in App Store Connect
 *   - the products/offerings configured in RevenueCat
 *
 * Convention: com.goallearner.awakened.skin.<slug>. All NON-CONSUMABLE
 * (own forever). Cosmetic only — never gates power.
 *
 * W624 — Stardust is the ONE exception to the <slug> convention: App Store
 * Connect permanently reserved 'com.goallearner.awakened.skin.stardust' from an
 * earlier draft (Apple never releases a used product id), so the real product
 * carries a '.sovereign' suffix. Both ids map to the same skin (the old one is a
 * harmless dead alias — no product will ever transact it). The client mirrors
 * this via _SKIN_PRODUCT_ID_OVERRIDES so its purchase call uses the real id.
 */
export const PRODUCT_TO_SKIN: Readonly<Record<string, string>> = {
  'com.goallearner.awakened.skin.stardust.sovereign': 'avatar-skin-stardust.png',   // W624 — real ASC id
  'com.goallearner.awakened.skin.stardust':      'avatar-skin-stardust.png',         // reserved/dead alias
  'com.goallearner.awakened.skin.dawnbringer':   'avatar-skin-dawnbringer.png',
  'com.goallearner.awakened.skin.nullprotocol':  'avatar-skin-nullprotocol.png',
  'com.goallearner.awakened.skin.nullprotocol2': 'avatar-skin-nullprotocol-2.png',
  'com.goallearner.awakened.skin.emberforged':   'avatar-skin-emberforged.png',
  'com.goallearner.awakened.skin.voidtouched':   'avatar-skin-voidtouched.png',
  'com.goallearner.awakened.skin.frostweaver':   'avatar-skin-frostweaver.png',
  'com.goallearner.awakened.skin.tempest':       'avatar-skin-tempest.png',
  'com.goallearner.awakened.skin.verdant':       'avatar-skin-verdant.png',
  'com.goallearner.awakened.skin.bloodmoon':     'avatar-skin-bloodmoon.png',
};

/** Resolve a store product id to its skin catalog id, or null if unknown. */
export function skinForProduct(productId: string): string | null {
  return PRODUCT_TO_SKIN[productId] ?? null;
}

// ── W650 — "Awakened Premium" auto-renewable membership ─────────────────────
// The membership: no co-op entrance fees, unlimited concurrent hunts, unlimited
// Ascent attempts. W655 — the subscription is now the ONLY paid tier (the paid
// "Founder's Lifetime" one-time pack was removed; it cannibalized the sub and
// created a permanent liability). AUTO-RENEWABLE — they expire, so they ride the
// premium_subscriptions table (expiry-derived), NEVER skin_entitlements.
export const PREMIUM_PRODUCT_IDS: ReadonlySet<string> = new Set([
  'com.goallearner.awakened.premium.monthly',   // $4.99/mo
  'com.goallearner.awakened.premium.yearly',    // $39.99/yr
]);
export function isPremiumProduct(productId: string): boolean {
  return PREMIUM_PRODUCT_IDS.has(productId);
}

/**
 * Resolve a store product id to the skin catalog id to persist, or null if
 * unknown. Used by the webhook + reconcile skin-grant path. (Premium products
 * are handled separately via the premium_subscriptions horizon, not here.)
 */
export function entitlementForProduct(productId: string): string | null {
  return skinForProduct(productId);
}
