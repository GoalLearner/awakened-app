# Device-test checklist — build 317 (2.2.7-w348)

_What to verify on a real iPhone (some items need an Apple Watch paired). Preview can't exercise
HealthKit, native notifications, or IAP, so these are device-only._

## Must-verify (the fixes that triggered this build)

### 1. Galilea fix — leaderboard step-submit lag (W346)
- Cross a step threshold (e.g. 10k) on your device.
- On a **second account/device** (or after this device backgrounds+foregrounds), open the Steps board.
- ✅ PASS: your new total shows on **others'** board within a minute or two of crossing it — NOT hours later.
- ✗ FAIL: you're credited in the guild feed but show 0 / a stale number to others for a long time.

### 2. Rendiesel fix — multi-source double-count (W347 + W348), **needs Apple Watch**
- With **iPhone + Watch both active**, walk a known amount.
- Compare the app's **steps** to the **Apple Health app**'s daily total.
- ✅ PASS: they match (≈ Health app). ✗ FAIL: app shows ~2× Health.
- Repeat for **flights climbed** and **active energy** (W348).
- Also confirm **single-source** (Watch off / removed) is unchanged vs before.
- Note: the JS interim uses "max single source," so a multi-source total may read slightly LOW vs Health
  in the rare complementary case — that's expected until the native HKStatisticsQuery fix
  (see NATIVE_HEALTHKIT_FIX.md). It must NOT read high (~2×).

### 3. Streak-danger copy (W344)
- Have an active perfect-day chain (≥1) and an **incomplete** habit, between **11 PM and midnight PT**.
- ✅ PASS: the danger banner reads "Your {N}-day chain breaks at midnight — {R} habits to go."
  (falls back to "Under an hour left — {R} habits to go." with no chain).

## Dormant until you flip IAP_ENABLED (presentation only)
These render NOTHING until `IAP_ENABLED=true` (auth.js) — so on this build they should be **invisible**:
- Founder CTA on the **rank-up** celebration (W340).
- Founder CTA at the **day-7 "Week Warrior"** perfect-streak milestone (W343).
- Once IAP is live: confirm both appear, open the offer, and the shared cap (W342) means you never see
  two Founder prompts stacked in one session (≥1h apart, max 1/session).

## Regression smoke (the redesigns + funnel)
- **Leaderboard** redesign (W333) renders across all tabs; **Souls** sheet (W334) shows the merged
  economy table with the live D=35/35 (1×) row + "every rank but D" takeaway.
- **Settings** redesign (W335) + Manage Vows now under the **Habits** tab (W336).
- **Activation:** First Mark on first completion (W337), the day-2 morning digest (W338, iOS-only delivery)
  + the in-app Day-2 welcome-back (W339).
- In the JS console: `Arena.selfTest()` → **37/37**.

## Ship
- Build with `prep-local-build.sh 317` (it syncs the native Marketing Version from APP_VERSION = 2.2.7).
- Xcode → Product → Archive → Distribute. Bundles everything through **W348** + the handoff docs.
