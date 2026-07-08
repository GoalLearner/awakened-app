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
  (RevenueCat bridge + entitlement read). `IAP_ENABLED = false`; `REVENUECAT_PUBLIC_SDK_KEY`
  = the real production key since W627 (2026-07-08) — the only remaining switch is the flag.
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

3. **RevenueCat** — create a project, connect the App Store app, import the 10 products into an Offering. Copy the **public Apple SDK key** (`appl_…`). Also upload an **In-App Purchase Key** (ASC → Users and Access → Integrations → In-App Purchase) — StoreKit 2 (SDK v8 default) needs it to fetch products.
4. **RevenueCat → Webhooks** — URL `https://awakened-backend.richmondcampano93.workers.dev/v1/iap/revenuecat-webhook`; set an **Authorization header** value (e.g. `Bearer <openssl rand -hex 32>`).
5. **Backend** — `cd backend`:
   - `wrangler secret put REVENUECAT_WEBHOOK_AUTH` → paste the **exact** value from step 4.
   - ✅ DONE (W311): the `skin_entitlements` table is already live in prod D1, and the worker (incl. the IAP routes) is deployed. The webhook secret above is the only remaining backend step.
6. **App (on the Mac)** —
   - `npm install` (pulls `@revenuecat/purchases-capacitor`; confirm the version matches Capacitor 6) → `npx cap sync ios`.
   - In `auth.js`: set `REVENUECAT_PUBLIC_SDK_KEY` (step 3) and flip `IAP_ENABLED = true`. Bump the knobs (build tag, `auth.js?v`, sw cache).
   - Archive + upload.
7. **Test in sandbox** — a sandbox Apple ID buys a skin → tile flips to `OWNED`/equipped → confirm the `skin_entitlements` row exists in D1.

## Notes
- **RevenueCat API (v8, VERIFIED W311)**: `configure` / `getProducts` / `purchaseStoreProduct` / `restorePurchases` are unchanged v7->v8 (the break was native-only — iOS StoreKit 2 / Android BillingClient 7, not the JS API). `purchaseSkin()` now passes `type: 'NON_SUBSCRIPTION'` (v8 default is SUBSCRIPTION — ignored on iOS, required on Android).
- **appUserID = backend user_id** — set from the session JWT `sub` claim (`getBackendUserId`). Required so webhook grants land on the right account. Do not change.
- **Restore Purchases** (`Auth.restorePurchases`) is required by Apple review — surface it from Settings before submitting.
- Keep this list **cosmetic only**. Per the app's design ethos, never sell power.
