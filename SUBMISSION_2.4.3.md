# Awakened 2.4.3 — App Store submission package

Build **406** · marketing version **2.4.3** (APP_VERSION drives it; prep forces it in).
Covers: paid Founder tier removed → Awakened Premium subscription is the only paid
membership · co-op dungeon entrance-fee/paywall · free earned "Founder #N" prestige
marker · stability polish.

Backend is already **live** (Worker `bb647275`, migration 0031 applied, 3 Founders
backfilled). Nothing else server-side is needed.

---

## 1. Build on the MacBook (build 406)

```bash
cd /Volumes/AwakenedDev/repos/awakened-app && git pull && npm install && bash scripts/prep-local-build.sh 406 && npx cap open ios
```

Then in Xcode: **Product → Archive → Distribute App → App Store Connect → Upload**.
`prep-local-build.sh` forces MARKETING_VERSION = 2.4.3; the `406` arg is CFBundleVersion.

---

## 2. App Store Connect steps

1. **Version.** My Apps → Awakened → create/open the **2.4.3** version (marketing
   version 2.4.3).
2. **Build.** After the upload finishes processing, attach **build 406**.
3. **Attach the subscriptions to this version (required for their first review).**
   In the version's *In-App Purchases and Subscriptions* section, add BOTH:
   - `com.goallearner.awakened.premium.monthly` — $4.99 / month
   - `com.goallearner.awakened.premium.yearly` — $39.99 / year
   Confirm the **Awakened Premium** group (ID 22229532) has, per product: localized
   display name + description, and the group has the review **screenshot** attached.
   Apple requires at least one subscription be submitted *with* an app version on its
   first review — attaching both here satisfies that.
4. **Remove the old paid Founder IAP.** Monetization → In-App Purchases →
   **Founders Lifetime** (non-consumable) → **Remove from Sale** (an approved IAP
   can't be hard-deleted, but Remove-from-Sale delists it; the app no longer
   references it either way). If it was never approved, Delete it outright.
5. **App Review Information.** Paste the reviewer note (section 3). Verify the demo
   account signs in.
6. **Submit for Review.**

---

## 3. Apple reviewer note (paste into App Review Information → Notes)

```
What changed in this build:

1) Awakened Premium (auto-renewable subscription) is now the only paid membership.
   Two options, both auto-renewable, in the "Awakened Premium" subscription group:
     - com.goallearner.awakened.premium.monthly  ($4.99 / month)
     - com.goallearner.awakened.premium.yearly   ($39.99 / year)
   The paywall (Settings > Awakened Premium) shows, on the same screen as the buy
   button: the subscription name and length, the price, an explicit auto-renewal
   disclosure, a visible Restore Purchases button, and tappable Terms of Use (EULA)
   and Privacy Policy links.

2) The previous one-time "Founders Lifetime" non-consumable has been removed. It is
   no longer purchasable anywhere in the app, and we have removed it in App Store
   Connect.

3) Cosmetic skins remain available as one-time purchases (unchanged; cosmetic only).

4) "Founder #N" shown on profiles and the leaderboard is a FREE, earned prestige
   marker — NOT an in-app purchase. It is granted server-side to the first 100
   pre-launch accounts that met an in-game achievement bar. It grants no premium
   access and no gameplay advantage: a badge/number only.

What Premium unlocks: no co-op dungeon entrance fee, no concurrent-hunt cap, and
unlimited daily Ascent attempts. Premium gives no competitive combat advantage (no
stat boosts, no exclusive power) — leaderboards stay skill/effort based.

The subscription can be exercised end-to-end in the StoreKit sandbox with the
reviewer's sandbox Apple ID. Demo account for the app itself is below.
```

Fill in the demo account (same one used for 2.4.2).

---

## 4. "What's New" (release notes — no emojis)

```
Awakened Premium is here. Support the game and unlock the full co-op experience with
a membership, monthly or yearly. Premium removes co-op dungeon entrance fees, lifts
the concurrent-hunt cap, and grants unlimited Ascent attempts.

Co-op dungeons now show a clear entrance fee up front and split rewards fairly across
the party.

Founders: the first 100 hunters who were here before launch and earned their place
now carry a permanent Founder number on their profile and the leaderboard.

Plus stability fixes and polish across the Arena and co-op.
```

---

## 5. What shipped in code (for your records)

- **Founder tier removed** (W655, already committed): `isFounder`/`purchaseFounders`
  gone; every "founder OR premium" gate is now just premium; Settings entry renamed
  to "Awakened Premium"; no dead code. 31 pre-cutoff real accounts were grandfathered
  to Premium so nobody who "bought Founder" lost access.
- **Awakened Premium subscription** (W650–652): monthly/yearly, expiry-derived
  entitlement, webhook maintains the paid-through horizon; **billing grace period
  handled** (a failed payment inside Apple's 16-day grace keeps Premium active; only
  a real expiration/refund revokes).
- **Free Founder marker** (W656): server-authoritative, atomic cap of 100,
  sims excluded; badge on hunter card + leaderboard + profile card.
