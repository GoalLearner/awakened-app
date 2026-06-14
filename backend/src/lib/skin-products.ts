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
 */
export const PRODUCT_TO_SKIN: Readonly<Record<string, string>> = {
  'com.goallearner.awakened.skin.stardust':      'avatar-skin-stardust.png',
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
