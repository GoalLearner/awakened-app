# Skins IAP — setup & go-live checklist (W297)

Real-money cosmetic **skin** purchases. The code is fully wired but **dormant**:
the shop still shows `SOON` until you complete the steps below and flip one flag.
Cosmetic only — skins never affect stats, the Ascent, or rank.

## What's already built (committed)

**Backend** (`630be5f`)
- `skin_entitlements` table (migration `0017`) — server-side source of truth.
- `POST /v1/iap/revenuecat-webhook` — RevenueCat → grant (shared-secret auth, fails closed, idempotent).
- `GET /v1/users/me/entitlements` — the client reads owned skins from here.
- `lib/skin-products.ts` — product id → skin map. 8/8 tests pass.

**Frontend** (this commit)
- `auth.js`: `configurePurchases` / `purchaseSkin` / `restorePurchases` / `fetchEntitlements`
  (RevenueCat bridge + entitlement read). `IAP_ENABLED = false`, `REVENUECAT_PUBLIC_SDK_KEY = 'appl_REPLACE_ME'`.
- `app.js`: owned-skins SWR cache; the Wardrobe shop renders `BUY / OWNED / EQUIP` when live,
  auto-equips after purchase, and revalidates ownership from the backend.
- `package.json`: `@revenuecat/purchases-capacitor` added (install on the Mac).

## Go-live steps (you + Apple — code can't do these)

1. **App Store Connect → Agreements** — sign the *Paid Apps* agreement and add banking + tax. (Lead-time gate; start first.)
2. **App Store Connect → In-App Purchases** — create **10 Non-Consumable** products with these exact ids and set a price tier each:

   | Skin | Product ID |
   |---|---|
   | Stardust Sovereign | `com.goallearner.awakened.skin.stardust` |
   | Dawnbringer | `com.goallearner.awakened.skin.dawnbringer` |
   | Null Protocol | `com.goallearner.awakened.skin.nullprotocol` |
   | Null Protocol II | `com.goallearner.awakened.skin.nullprotocol2` |
   | Emberforged | `com.goallearner.awakened.skin.emberforged` |
   | The Void-Touched | `com.goallearner.awakened.skin.voidtouched` |
   | Frostweaver | `com.goallearner.awakened.skin.frostweaver` |
   | Tempest | `com.goallearner.awakened.skin.tempest` |
   | The Verdant Oracle | `com.goallearner.awakened.skin.verdant` |
   | Bloodmoon | `com.goallearner.awakened.skin.bloodmoon` |

3. **RevenueCat** — create a project, connect the App Store app, import the 10 products into an Offering. Copy the **public Apple SDK key** (`appl_…`).
4. **RevenueCat → Webhooks** — URL `https://awakened-backend.richmondcampano93.workers.dev/v1/iap/revenuecat-webhook`; set an **Authorization header** value (e.g. `Bearer <openssl rand -hex 32>`).
5. **Backend** — `cd backend`:
   - `wrangler secret put REVENUECAT_WEBHOOK_AUTH` → paste the **exact** value from step 4.
   - Apply the migration: `wrangler d1 execute awakened-db --remote --file=migrations/0017_skin_entitlements.sql` (verify first; never blind-apply).
   - `npm run deploy`.
6. **App (on the Mac)** —
   - `npm install` (pulls `@revenuecat/purchases-capacitor`; confirm the version matches Capacitor 6) → `npx cap sync ios`.
   - In `auth.js`: set `REVENUECAT_PUBLIC_SDK_KEY` (step 3) and flip `IAP_ENABLED = true`. Bump the knobs (build tag, `auth.js?v`, sw cache).
   - Archive + upload.
7. **Test in sandbox** — a sandbox Apple ID buys a skin → tile flips to `OWNED`/equipped → confirm the `skin_entitlements` row exists in D1.

## Notes
- **RevenueCat method names**: `getProducts` / `purchaseStoreProduct` in `purchaseSkin()` match `@revenuecat/purchases-capacitor` v7. Confirm against the installed version when wiring live.
- **appUserID = backend user_id** — set from the session JWT `sub` claim (`getBackendUserId`). Required so webhook grants land on the right account. Do not change.
- **Restore Purchases** (`Auth.restorePurchases`) is required by Apple review — surface it from Settings before submitting.
- Keep this list **cosmetic only**. Per the app's design ethos, never sell power.
