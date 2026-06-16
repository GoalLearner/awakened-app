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

## Correctness sprint (W350–W359) — data-integrity fixes (next build, 2.2.7-w359)
Five 5-round read-only audits → 10 verified fixes (full record in CORRECTNESS_AUDIT.md). Most are
edge-case / crash-window / backend-logic and **can't be forced on a device** — listed at the end for
awareness. These **are** device-checkable:

- **W359 — can't sell an equipped relic (the highest-value one).** Equip a relic in your **Hunter
  Build**, get it down to a **single copy** (count 1), then try to **sell** it.
  ✅ PASS: the sale is **blocked** ("equipped"). Unequip it from the build → now it **can** be sold.
  ✗ FAIL (the old bug): it sells, and the build slot is left pointing at a relic you no longer own.
- **W352 — ascent record counts once.** Engage a boss, then **forfeit / lose**.
  ✅ PASS: your win/loss record changes by exactly **one** (a forfeit records the loss once; no double-count).
- **W355 — souls charged correctly.** Buy a relic, and separately engage a boss.
  ✅ PASS: balance drops by **exactly** the price/cost; if you can't afford it the action is refused and
  nothing is granted/charged.
- **W356 — deleting a habit clears its note.** Add a note to a habit → delete that habit → create a new
  habit. ✅ PASS: no stale note appears; `hb_notes` has no orphaned entry.
- **W351 — reminders re-arm after permission recovery.** In iOS Settings, **deny** notifications, reopen
  the app, then **re-grant** them. ✅ PASS: per-habit reminders re-arm **immediately** (not only after the
  next cold start).

_Logic-only (verified by code/tests, not forceable on device): W350 souls-underflow guards · W353 flights
PT-week sum · W354 mythic pity reset · W357/W358 social-feed crash-window de-dupe · (W349 submit timeliness)._

## Ship
- Build with `prep-local-build.sh <next#>` (it syncs the native Marketing Version from APP_VERSION = 2.2.7).
- Xcode → Product → Archive → Distribute. The next build bundles everything through **W359** + the
  correctness-sprint fixes (W349–W359) and the handoff docs.
- In the JS console after launch: `Arena.selfTest()` → **37/37**.
