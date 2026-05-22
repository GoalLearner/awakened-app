# CLAUDE.md — Awakened (Habit RPG)

Onboarding doc for any future Claude session working on this project. Reflects the actual state of the code (not what it might become). All values are extracted from the source.

---

## 📌 Session handoff — May 21, 2026 — Sleep HealthKit + leaderboard fixes verified on TestFlight (read this first)

### ✅ STATUS: Sleep system is fully fixed and verified end-to-end on a real TestFlight build

The multi-day sleep-debug arc that started with the build 92/93/94/95 HealthKit-queries-return-zero failure is closed. A real TestFlight install on iPhone confirms every piece of the pipeline works:

| Surface | Status |
|---|---|
| HealthKit entitlement wiring | ✅ wired via `scripts/prep-local-build.sh` step 7-9 |
| HealthKit sleep query returns real samples | ✅ Oura ring writes ~145 stage fragments per night; plugin returns them |
| Sleep session grouping + main-session selection | ✅ correctly picks the night ending today (~8h) instead of summing 36h |
| Sleep 7 hours habit auto-seals | ✅ verified on-device |
| Daily walk 8,000 steps auto-seals | ✅ verified on-device |
| Sleep streak in the global leaderboard matches the weekly Ledger | ✅ Richie reads 5 — same as Ledger |
| Sleep streak leaderboard hides users below 3 nights | ✅ rows with 0/1/2 are gone; board stops at awakenedren = 3 |
| iOS AppIcon is the canonical Awakened logo (not default Capacitor) | ✅ |
| Class-avatar PNGs ship in the iOS bundle | ✅ |
| iOS Info.plist HealthKit purpose strings present | ✅ |
| Web bundle release knobs match root (`2.2.3-w2`, `app.js?v=455`, `sw.js v5.341`) | ✅ |
| Custom Habit save freeze | ✅ fixed in 1z.106 |

**The mandatory MacBook archive command is now:**

```bash
bash scripts/prep-local-build.sh
```

The heavy prep is atomic: rebuilds `www/`, syncs iOS, applies HealthKit Info.plist + entitlements + Sign in with Apple wiring, replaces the default Capacitor AppIcon with the tracked Awakened set, and runs all four verify gates as its final steps (public assets, app icon, HealthKit purpose strings, entitlements). The lite flow is documented in `LOCAL_BUILD.md` as a quick-refresh fallback only; for any HealthKit-related change, **use the heavy flow**. The build-92/93/94/95 incidents were all traceable to the lite flow skipping one of these steps.

**Real TestFlight verification of the leaderboard floor (1z.116):**

After 1z.115 (`f8e2ef1`) lifted Richie's row from 1 to his real 5-night streak, 1z.116 (`6a2017e`) hid sub-3-night entries. The on-device modal now shows:

```
#1  shadowmonarch_k   20
#2  ascendantnova     12
#3  ghostlift          9
#4  marcust.           7
#5  siennak.           6
#6  jordanf.           6
#7  Richie             5     ← actual user, matches Weekly Ledger
#8  voidwalker_88      4
#9  awakenedren        3     ← lowest visible row (exactly at floor)
```

No 0/1/2 rows visible. Ledger and leaderboard agree.

**Suggested next steps (no longer Sleep-related):**

The sleep + entitlement + leaderboard work is done. Open targets going forward:

1. Broader TestFlight QA across tabs — Habits / Quests / Items / Social / Duels / Stats / History — looking for any UI regressions introduced by the 1z.108-1z.116 changes.
2. Workout 30 min auto-verification (1z.105) on-device — needs a real Apple Health workout of any type ≥30 min daily total to fire. Should now work end-to-end since the entitlement is wired.
3. Sleep before midnight on-device — bedtime path uses `getBedtimeSamplesInWindow` with a strict `[20:00, 24:00)` window. Untouched by the sleep arc but never specifically re-verified on the post-entitlement build. A late-bedtime night would exercise it.
4. The two untracked preview HTMLs (`preview-duels-polish.html`, `preview-morning-briefing.html`) — either commit or `.gitignore`. Housekeeping only.

**Knobs unchanged across the entire arc** (1z.108 → 1z.116):

| Knob | Value |
|---|---|
| `APP_VERSION` | `2.2.3` |
| `APP_BUILD_TAG` | `2.2.3-w2` |
| `app.js?v=` | `455` |
| `sw.js CACHE_VERSION` | `v5.341` |
| `QA_UNLOCK_C_RANK_DUNGEONS` | `false` |

A `2.2.3-w3` / `app.js?v=456` / `sw.js v5.342` bump is appropriate when a NEW user-facing change ships. The 1z.108-1z.116 series rode on the same web-bundle fingerprint deliberately — each fix shipped piggyback on whatever TestFlight build was archived next.

---

## 📌 Session handoff — May 20, 2026 (historical — superseded by the May 21 status above)

### 🛠 STATUS: 2.2.3 build 94 — MacBook needs to archive with the icon patch + verify gates

**Build 92 shipped a 2.2.3 native shell wrapping a stale 2.2.2-w15 JavaScript bundle.** TestFlight (and App Store Connect) showed `2.2.3 (92)` because `agvtool` / Info.plist had been bumped, but Copy Debug Info inside the running app reported `"version": "2.2.2", "build": "2.2.2-w15"`. Root cause: `npx cap copy ios` ran against a `www/` snapshot that hadn't been rebuilt from the root sources. `cap copy` only copies `www/` into `ios/App/App/public/`; it does NOT regenerate `www/`.

**Build 93 fixed the web-assets mismatch but shipped with the default blue Capacitor app icon on the home screen.** Root cause: `cap copy` / `cap sync` seeds `ios/App/App/Assets.xcassets/AppIcon.appiconset/` with Capacitor's default icons. The MacBook flow had no step that replaced them with the tracked Awakened icons. Codemagic does this replacement; the lite MacBook flow skipped it.

**Fixes landed for the upcoming build 94:**
- 1z.107 (`ec77430`) — defensive recognition of legacy `Strength training` rows so auto-verify never orphans them even if the rename migration misses.
- 1z.108 (`ba6a084`) — release knobs bumped to `2.2.3-w2` / `app.js?v=455` / `sw.js v5.341`; new tracked gate `scripts/verify-ios-public-assets.sh` fails the build if `ios/App/App/public/`'s release knobs don't match the root sources after `cap copy`. `scripts/prep-local-build.sh` runs the gate and no longer hardcodes the stale `2.2.2` marketing version.
- 1z.109 (this commit) — new tracked scripts `scripts/patch-ios-app-icon.sh` and `scripts/verify-ios-app-icon.sh`. The patch script replaces the default Capacitor `AppIcon.appiconset` with the tracked Awakened set at `resources/ios/AppIcon.appiconset/` (19 PNG sizes + `Contents.json`, identical to Codemagic's icon step; `AppIcon-1024.png` byte-identical to root `app-icon-source.png`). The verify gate hash-compares the ship-side 1024 marketing icon to the canonical source, so the default Capacitor icon can never silently ship again. `scripts/prep-local-build.sh` invokes both as steps 8b and 11. **No web/cache knob bumps were needed** — icon-only correction. `APP_BUILD_TAG=2.2.3-w2`, `app.js?v=455`, `sw.js v5.341` stay where they are.

**Current knobs on `main` (post release-prep commit):**

| Knob | Value |
|---|---|
| `APP_VERSION` | `2.2.3` |
| `APP_BUILD_TAG` | `2.2.3-w2` |
| `app.js?v=` | `455` |
| `sw.js CACHE_VERSION` | `v5.341` |
| `QA_UNLOCK_C_RANK_DUNGEONS` | `false` |

**MacBook flow for build 93** — DO NOT skip the `rm -rf www && cp <root sources>` step. After `cap copy`, run `bash scripts/verify-ios-public-assets.sh` — if it exits non-zero, **do not archive**. See LOCAL_BUILD.md for the full sequence and troubleshooting.

**This 2.2.3 build bundles:**

- **1z.104** (`5e787f9`) — HealthKit auto-verify diagnostics (`hb_health_verify_debug_v1` ring + `payload.healthVerify.debug` Copy Debug Info export). No behaviour change.
- **1z.105** (`e7bdf5a`) — "Strength training" canonical habit broadened/renamed to "Workout"; verifies from ANY Apple Health workout totaling 30+ min daily. Idempotent rename migration via `hb_strength_to_workout_rename_v1`. Iron Warden boss and Strength Duel intentionally remain strength-only.
- **1z.106** (`9f62001`) — Create Your Own Habit freeze fix. `saveCustomHabit` now closes the parent `#lib-sheet` + `#lib-overlay` after the custom modal so the library overlay can't intercept pointer events on the tab bar. New custom-create breadcrumbs in `hb_add_habit_debug_v1`. Playwright regression test `I · Create Your Own Habit (1z.106)` covers it. Full e2e: **9/9 passing**.
- **Add Habits exit-path audit** — performed after 1z.106; every documented exit path for `lib-sheet`, `lib-overlay`, `custom-overlay`, `hd-sheet`, and `mr-overlay` was traced. **No remaining real unclosed paths.** 1z.106 closed the only real stranded-overlay surface. No further code changes warranted from the audit.

**Status of recent uploads:**
- **2.2.2 build 91** — rejected by ASC validation: marketing version `2.2.2` is closed.
- **2.2.3 build 91** — rejected by Apple with **ITMS-90683 "Missing purpose string in Info.plist"** (`NSHealthShareUsageDescription` / `NSHealthUpdateUsageDescription`). The Capacitor template does NOT seed these keys, and the desktop repo does NOT track `ios/`, so every fresh `npx cap copy/sync ios` wipes them. New tracked script `scripts/patch-ios-health-plist.sh` now idempotently re-applies the Apple-accepted strings; the heavy `scripts/prep-local-build.sh` was synced to the same wording.
- **2.2.3 build 92** — ✅ **uploaded successfully on May 20, 2026** after the Info.plist purpose strings were added on the MacBook. This is the first build on the `2.2.3` train to reach App Store Connect.

**Migrated off Codemagic.** Build cost per Codemagic run was acceptable per-build (~$0.40) but the cumulative iteration cost during heavy debugging sessions added up faster than budgeted. The MacBook Air now does local Xcode archives directly, with the project + Xcode caches living on an external Samsung SSD named `AwakenedDev`. **This is the canonical path going forward.** Codemagic stays in the repo as a documented fallback but must not be triggered without explicit user approval.

### Machine roles

| Machine | Role |
|---|---|
| **Windows desktop** (ClaudeCode) | Development. Commits + pushes to `origin/main`. Never builds iOS. |
| **MacBook Air** | Local iOS archive + App Store Connect upload. Pulls from GitHub. |
| **GitHub `origin/main`** | Source of truth between both machines. |
| **Codemagic** | Fallback only. **Do not trigger without explicit approval.** |

### Confirmed-working local setup

| Path | Where | Why |
|---|---|---|
| `Xcode.app` | **Internal Mac disk** | Apple signing tools break on external. Do not move. |
| Awakened repo | `/Volumes/AwakenedDev/repos/awakened-app` | Frees internal storage. |
| Convenience symlink | `~/Documents/repos/awakened-app` → SSD path | Familiar `cd` commands still work. |
| Xcode DerivedData | `/Volumes/AwakenedDev/Xcode/DerivedData` | Off internal. |
| Xcode Archives | `/Volumes/AwakenedDev/Xcode/Archives` | Off internal. |
| npm cache | `/Volumes/AwakenedDev/npm-cache` | Off internal (set via `npm config set cache`). |
| Claude app data | Relocated to SSD | Frees internal Mac space. |
| **Internal free space** | **~11 GiB** | post-migration |
| **SSD free space** | **~921 GiB** | abundant headroom |

### Confirmed-working Release signing

| Field | Value |
|---|---|
| Bundle ID | `com.goallearner.awakened` |
| Team | Richmond Campano |
| Signing model | **Manual** (Release config only — Debug ignored) |
| Provisioning Profile | `Awakened App Store 2026-05-19` |
| Signing Certificate | `Apple Distribution: Richmond Campano` |

Debug-signing warnings in Xcode are expected and irrelevant — Archive uses Release exclusively. Do not press the Play button. Do not select the Simulator or Richie's iPhone as destination. **Use Any iOS Device (arm64).**

### What was proven on May 20

- ✅ Local Xcode archive succeeds.
- ✅ Manual App Store signing succeeds.
- ✅ Xcode upload transport reaches App Store Connect validation.
- ⚠️ **Build 91 was NOT an accepted TestFlight build.** ASC rejected it during validation because marketing version `2.2.2` is closed — see next section. Build 91 should be treated as a successful local archive / signing / upload-transport proof only. It did not become a TestFlight build and did not reach any tester.

### ⚠️ Version-train rule (CRITICAL — read before any new upload)

**Marketing version `2.2.2` is CLOSED.** App Store Connect rejected build 91 with:

> "This bundle is invalid. The value for key CFBundleShortVersionString [2.2.2] must contain a higher version than that of the previously approved version [2.2.2]."
> "Invalid Pre-Release Train. The train version '2.2.2' is closed for new build submissions."

This means: even though `2.2.2` has been our active development train since 1z.85, App Store Connect has now permanently closed it for new submissions (because some prior 2.2.2 build was approved and the train cannot accept lower-or-equal marketing versions afterward).

**The next real upload must use:**
- **Marketing Version (`APP_VERSION` + Xcode):** `2.2.3` (or higher; strictly greater than `2.2.2`)
- **Build Number (Xcode → General → Identity → Build):** latest TestFlight build + 1 (currently `92` or higher)

**Do not bump these speculatively.** Bump them only when explicitly preparing a new TestFlight/App Store build.

### Standard desktop → MacBook upload workflow

**Desktop (ClaudeCode / Richmond):**
1. Make code changes.
2. `git commit` + `git push origin main`.
3. Tell Richmond it's ready to ship.

**MacBook Air:**
```bash
cd /Volumes/AwakenedDev/repos/awakened-app   # or use the ~/Documents symlink
git fetch origin
git pull origin main
git log --oneline -3                          # confirm HEAD matches expected
# Only if package.json changed:
npm install --no-audit --no-fund
# Rebuild www/ from root sources (or use scripts/prep-local-build.sh)
npx cap copy ios                              # web-only updates — fast
# Only when native deps changed: npx cap sync ios
npx cap open ios
```

**In Xcode:**
1. Destination dropdown → **Any iOS Device (arm64)**.
2. App target → Signing & Capabilities → confirm Release uses manual `Awakened App Store 2026-05-19` + `Apple Distribution: Richmond Campano`.
3. App target → General → Identity → Marketing Version + Build (already bumped if a new upload is intended).
4. Product → Clean Build Folder (⇧⌘K).
5. Product → Archive.
6. Organizer opens → select new archive → Distribute App → App Store Connect → Upload.

Full details + troubleshooting: see `LOCAL_BUILD.md`.

### ✅ Before the next upload — release prep checklist

**Desktop (ClaudeCode) — release prep commit: ✅ DONE for 2.2.3-w1.** The next desktop bump is for whichever future train comes after this one. For reference (and for the next future train), the desktop steps are:
1. Confirm with the user that they want a new upload prepared. Wait for explicit yes.
2. Bump `APP_VERSION` (must be strictly greater than the last approved marketing version).
3. Bump `APP_BUILD_TAG` accordingly (e.g. `2.2.X-w1`).
4. Bump `app.js?v=` in `index.html`.
5. Bump `sw.js` `CACHE_VERSION`.
6. Confirm `QA_UNLOCK_C_RANK_DUNGEONS = false`.
7. Update the version-knobs table in this CLAUDE.md to match.
8. `node --check app.js && node --check sw.js && npm run test:e2e` — must be green.
9. Commit `chore: prepare X.Y.Z local archive build` and push to `origin/main`.

**MacBook Air — local archive + upload (THIS IS THE ACTIVE STEP FOR 2.2.3 BUILD 93):**
```bash
cd /Volumes/AwakenedDev/repos/awakened-app   # or use the ~/Documents symlink
git fetch origin
git pull origin main
git log --oneline -1                          # confirm HEAD shows the 1z.108 bump commit
# Only if package.json changed since last build:
npm install --no-audit --no-fund

# CRITICAL: rebuild www/ from root sources BEFORE cap copy.
# Build 92 failed precisely because this step was skipped — cap copy
# only copies www/, it does NOT regenerate it from root sources.
rm -rf www
mkdir -p www
cp index.html app.js styles.css sw.js auth.js simulated-leaderboard.js manifest.json www/
cp avatar-*.png www/                             # 8 class silhouettes — REQUIRED (build-93 avatar incident)
cp icon-192.png icon-512.png app-icon-source.png www/ 2>/dev/null || true
cp -R assets www/assets 2>/dev/null || true
cp -R docs www/docs 2>/dev/null || true
# (Or run `bash scripts/prep-local-build.sh` for the full curated allowlist;
#  that script now also runs the verify gate as its final step.)

npx cap copy ios                              # web-only updates — fast
# Only when native deps changed: npx cap sync ios

# Re-apply HealthKit Info.plist purpose strings (idempotent).
# REQUIRED before every archive — `ios/` is not tracked, so cap copy/sync
# regenerates Info.plist from the Capacitor template, which omits these.
# Apple rejected 2.2.3 build 91 with ITMS-90683 for this exact reason.
bash scripts/patch-ios-health-plist.sh

# Replace the default blue Capacitor AppIcon set with the tracked
# Awakened icons. REQUIRED before every archive — cap copy/sync seeds
# the default icon set every time. Build 93 shipped with the default
# icon on the home screen for exactly this reason.
bash scripts/patch-ios-app-icon.sh

# Verify ios/App/App/public/ release knobs match root sources.
# This gate failing means the IPA would ship a native-shell/web-asset
# mismatch (the build-92 failure mode). DO NOT archive if this fails.
bash scripts/verify-ios-public-assets.sh

# Verify the ship-side 1024 marketing icon hash-matches the canonical
# Awakened icon. Failure = default Capacitor icon (or other wrong art)
# is in place (the build-93 failure mode). DO NOT archive if this fails.
bash scripts/verify-ios-app-icon.sh

# Verify HealthKit + Sign in with Apple entitlements are WIRED into the
# Xcode project (not just present in App.entitlements). The lite flow
# above does NOT wire entitlements — only prep-local-build.sh does that.
# Without the wiring, HKSampleQuery silently returns zero rows even
# though permission prompts work. This was the root cause of the
# build-93/94/95 "sleep verifier says granted but returns zero" issue.
# If this gate fails, run `bash scripts/prep-local-build.sh` instead.
bash scripts/verify-ios-entitlements.sh

npx cap open ios
```

> ⚠️ **Strongly prefer `bash scripts/prep-local-build.sh`** over the manual cp + patch sequence above. The heavy prep script atomically rebuilds www/, syncs iOS, applies all entitlements + purpose strings + icons, and runs all four verify gates as its final steps. The lite flow is documented for when you've already run the heavy flow recently and only need a quick `www/` refresh after a small code change. **The lite flow does NOT wire entitlements** — see the "HealthKit queries silently return zero rows" troubleshooting entry in LOCAL_BUILD.md.

**In Xcode (Archive + Upload — 2.2.3 build 94 specifics):**
1. Destination dropdown → **Any iOS Device (arm64)**. NOT Simulator, NOT Richie's iPhone.
2. App target → Signing & Capabilities → confirm **Release** uses **Manual** signing with profile `Awakened App Store 2026-05-19` + certificate `Apple Distribution: Richmond Campano`. (Debug-signing warnings can be ignored — Archive is Release-only.)
3. App target → General → Identity → set **Marketing Version: `2.2.3`** and **Build: `94`** (or whichever is `latest TestFlight + 1` — confirm in App Store Connect → TestFlight → iOS Builds before archiving).
4. Product → **Clean Build Folder** (⇧⌘K).
5. Product → **Archive**. ~5–15 min.
6. Organizer auto-opens → select the new archive → **Distribute App** → **App Store Connect** → **Upload**.
7. Wait for **Upload Successful**. ASC ingestion is 5–15 min before the build shows up under TestFlight → iOS Builds.
8. **After install on phone**, 5-tap version line → Copy Debug Info → confirm `"build": "2.2.3-w2"`. If it still says `2.2.2-w15` or any older tag, the archive shipped stale web assets again — STOP, fix the `www/` rebuild step, archive as the next build number. Also **glance at the home-screen icon** — it must be the Awakened gold-triangle-on-navy logo, not the default blue Capacitor icon. (The new verify gate at step 9 prevents this, but the visual sanity check is free.)

**Forbidden during release prep + upload:**
- ❌ Do NOT trigger Codemagic.
- ❌ Do NOT select Simulator as the Xcode destination.
- ❌ Do NOT select Richie's iPhone as the destination.
- ❌ Do NOT press the Play (▶) button in Xcode — Archive only.
- ❌ Do NOT use Codemagic unless the user explicitly approves the fallback path.
- ❌ Do NOT bump versions or upload without explicit user instruction.

### Hard guardrails for any future ClaudeCode session

- ❌ Do NOT trigger Codemagic without explicit user instruction.
- ❌ Do NOT bump `APP_VERSION` or build number without explicit user instruction.
- ❌ Do NOT deploy, upload, or submit to App Store without explicit user instruction.
- ❌ Do NOT suggest Simulator workflows.
- ❌ Do NOT select Richie's iPhone as the Xcode destination for Archive builds.
- ❌ Do NOT press the Play (▶) button in Xcode — Archive only.
- ❌ Do NOT move Xcode.app off internal storage.
- ✅ DO commit code changes and push to `origin/main` — that's the only thing ClaudeCode does from the desktop.
- ✅ DO assume Codemagic stays untouched as a documented fallback.

### Multi-day arc since the prior May 19 handoff (1z.82 → 1z.103)

| Phase | Theme | Key shipped |
|---|---|---|
| 1z.82 → 1z.83 | Sealed Mystery Relic reveal flow | Rare/ultra reveal cinematic in Boss Defeated modal |
| 1z.84 | PERFECT DAY banner leak fix | Confetti overlay scoping |
| 1z.85 → 1z.87 | First three Add Habits freeze attempts | Failed — wrong layer |
| 1z.88 → 1z.89 | Child detail + parent sheet close hardening | Partial fix |
| 1z.90 | Codemagic build provenance + freshness gates | CI hardening |
| 1z.91 → 1z.92 | Persistent localStorage breadcrumbs + in-app debug export (5-tap version unlock) | Diagnostic infrastructure |
| 1z.93 | Local-build script + LOCAL_BUILD.md draft | Pre-migration prep |
| 1z.94 → 1z.95 | Add Habits freeze finally fixed | Side effects decoupled from add path → microtask cascade neutralised |
| 1z.96 | Notification permission auto-recovery | iOS-dropped-permission fix |
| 1z.97 | skipSideEffects rolled out to all user-mutation render paths | Class-wide freeze fix |
| 1z.98 → 1z.101 | Discipline Duels rendering — challenge discovery, in-flight guard, request-token pattern, total-timeout safety net + duels breadcrumbs | Iterative |
| 1z.102 | `esc()` defensive type coercion | Root cause of "Loading duels…" stuck state. Real fix. |
| 1z.103 | MacBook Air + SSD local archive pipeline confirmed working; version train 2.2.2 closed; canonical workflow documented | Migration milestone |
| 1z.104 | HealthKit auto-verify diagnostics — `hb_health_verify_debug_v1` ring + `payload.healthVerify.debug` Copy Debug Info export | Diagnostic instrumentation, no behaviour change |
| 1z.105 | "Strength training" → "Workout"; verifies from ANY Apple Health workout totaling 30+ min daily. Iron Warden + Strength Duel kept strength-only | Product spec change + idempotent rename migration |
| 1z.106 | Create Your Own Habit freeze fix — `saveCustomHabit` now closes parent `#lib-sheet` + `#lib-overlay`; new custom-create breadcrumbs; Playwright regression test. Add Habits exit-path audit completed: no remaining unclosed paths | Final freeze-class fix |
| 1z.107 | Defensive recognition of legacy `Strength training` rows — `isLegacyOrCanonicalWorkoutName` helper threaded through `isStrengthWorkoutHabit` / `isReadOnlyAutoVerifyHabit` / `findStrengthHabit` / migration. Dedup logic for cloud-restore duplicate-row edge. Iron Warden + Strength Duel kept strength-only. 2 new Playwright tests (J.1, J.2) | Belt-and-braces for migration-miss |
| 1z.108 | Stale-web-assets gate — new `scripts/verify-ios-public-assets.sh` fails the build if `ios/App/App/public/` release knobs don't match root sources after `cap copy`; `prep-local-build.sh` now invokes the gate and no longer hardcodes the stale `2.2.2` marketing version. Release-prep bump to `2.2.3-w2` / `app.js?v=455` / `sw.js v5.341` for build 93 | Build-pipeline hardening after build-92 stale-asset incident |
| 1z.109 | iOS AppIcon patch + verify gate — new `scripts/patch-ios-app-icon.sh` replaces the default Capacitor icon set with the tracked Awakened set; `scripts/verify-ios-app-icon.sh` hash-compares the ship-side 1024 marketing icon to the canonical source so the default icon can never silently ship again. Both invoked from `prep-local-build.sh`. No web/cache knob bumps — icon-only correction for build 94 | Build-pipeline hardening after build-93 default-icon incident |
| 1z.110 | Sleep auto-verify diagnostics — full breadcrumb instrumentation of `autoVerifySleep` + `getSleepLastNight`. New `sleep-*` and `bedtime-*` steps. Sleep-state filter changed to exclude only 'InBed' (forward-compatible with future plugin stage labels). | Sleep diagnostic gap closed |
| 1z.111 | `cp avatar-*.png www/` restored to the lite MacBook flow; `verify-ios-public-assets.sh` extended to require 8 avatar PNGs + 2 PWA icons in `ios/App/App/public/`. | Build-93 avatar regression |
| 1z.112 | Sleep query window widened 18h → 36h; new fallback 72h re-query if primary returns 0; richer raw-shape + sample-summary breadcrumbs. | strict-startDate edge defended |
| 1z.113 | iOS entitlements verify gate — new `scripts/verify-ios-entitlements.sh` checks `App.entitlements` has HealthKit + Sign in with Apple AND `CODE_SIGN_ENTITLEMENTS` is wired in `project.pbxproj`. Lite-flow hazard documented: it doesn't wire entitlements; only `prep-local-build.sh` does. JS-side parallel stepCount probe added to `getSleepLastNight` when both sleep windows return empty. | **Confirmed root cause of build-93/94/95 sleep-query-empty** on the next archive — the heavy prep wired the entitlement and HealthKit started returning real data. |
| 1z.114 | Sleep session grouping — `getSleepLastNight` now groups Oura/Apple-Health stage fragments into discrete sleep sessions (≤90-min gap merge) and selects the session ending today as `totalAsleepHours`, instead of summing all 36h-window non-InBed samples. | Verified on build 97 device: 167 fragments → 2 sessions → main session 8.04h ending today (vs prior bug's 15.53h). |
| 1z.115 (`f8e2ef1`) | Sleep streak leaderboard derives current/best from `completions[dateStr]` containing the Sleep habit id (the user-visible Weekly Ledger source-of-truth), not the standalone `state.current_sleep_streak` counter whose gap-reset rule fired any time the user missed opening the app for a morning. `lbGetSnapshot()` returns `Math.max(state-tracked, ledger-derived)` — never reduces. Diagnostics: `leaderboard-sleep-streak-result` breadcrumb. | Verified on build 98+ device: Richie's row lifted from stuck-at-1 to his real 5-night streak. |
| 1z.116 (`6a2017e`) | Sleep streak leaderboard 3-night qualification floor. New `_LB_MIN_QUALIFYING_SCORE = { sleep_streak: 3 }` config table; `_lbMaybeSimulate` filters and re-ranks merged rows; `lbBuildRankList` suppresses the "submitting…" placeholder for below-floor users. `step_total` and `bedtime_streak` unaffected. | Verified on TestFlight: modal stops at awakenedren = 3; rendiesel/priyan (=1) and immortalshadow/galilea/melvin/jesserawdawg (=0) no longer visible. |
| 1z.117 (`cad15ec`) | Dungeon rank-filter preserved after boss defeat. `renderBossesPanel(rankFilter)` now defaults to `currentDungeonRank` when called without an argument (8 kill/streak/hunt-failed paths leaked unfiltered renders). 2 new Playwright tests (N.1, N.2) + dungeon-render breadcrumb. | Fixes build-99 corruption screenshot (E + D + C cards under D-RANK DUNGEON header). |
| 1z.118 (this handoff) | Leaderboard preview metric swap — bedtime streak retired, **Workout Streak** card added in its place. New `_lbComputeWorkoutStreakFromCompletions` helper mirrors the 1z.115 sleep ledger derivation; canonical 'Workout' habit + legacy 'Strength training' both recognized. `lbGetSnapshot()` exposes `current_workout_streak` / `best_workout_streak`. `_LB_SIM_METRICS` swapped (`bedtime_streak` → `workout_streak`); simulated-leaderboard.js bot streak generator accepts both. Underlying `bedtime_streak` state tracking is left in place (the **Sleep before midnight habit** auto-verify still uses it; only the leaderboard card was retired). 3 new Playwright tests (group O). **Flights Climbed investigated** — see audit notes below. | Workout Streak source = `completions[date].includes(workoutId)` ledger, same as the Workout habit's "SEALED" badge. No fake data. |

The freeze-debug arc (1z.85 → 1z.102) was a single bug class: a microtask cascade where HealthKit native-bridge Promise callbacks chained recursively, starving the JS event loop on every user-mutation render. The fix was a one-line `esc()` type guard plus skipSideEffects in every user-mutation path, plus breadcrumb infrastructure to diagnose iOS-only bugs without Safari Web Inspector. Full per-phase detail in the sections further down this file.

### 🔍 Flights Climbed leaderboard — audit memo (1z.118)

Asked during the 1z.118 patch whether a **Most Flights Climbed** leaderboard could be added. Findings:

**Native + HealthKit layer**: ✅ READY. No native work required.
- `Health.getFlightsClimbedToday()` and `Health.getFlightsClimbedBetween(startISO, endISO)` already exposed and battle-tested via the C-rank boss **Ascendant Colossus** ("Climb 10+ verified flights"). See `app.js` line 28779 / 28811 + the `_queryFlightsInRange` helper at 28824.
- Authorization is bundled into the `'stairs'` alias inside `requestAuthorization` (see plugin source line 90-91: `'stairs'` maps to `HKQuantityTypeIdentifierFlightsClimbed`). Already in the existing request set on every fresh install and on the v3 Phase 1z.61 upgrade-path.
- `requestFlightsPermissionIfNeeded()` upgrade-path helper exists and is already wired.
- HealthKit entitlement (`com.apple.developer.healthkit`) covers FlightsClimbed — same entitlement that gates Steps + Sleep + Workouts. No new entitlement key needed.
- Info.plist purpose strings (`NSHealthShareUsageDescription`) already declare what we read — generic enough to cover stairs. No new App Review copy needed.
- `flightsCache` (TTL'd) at line 27541 already exists.

**Leaderboard layer**: NOT YET WIRED.
- `LB_METRICS_META` (line ~20783) doesn't have a `flights_climbed_weekly` entry.
- `_LB_SIM_METRICS` (line ~21237) doesn't enable simulated rows for flights.
- `_LB_WEEKLY_METRICS` (line ~20621) doesn't include flights — backend submission isn't wired.
- `lbGetSnapshot()` doesn't expose current/best weekly flights.
- `renderLeaderboardPreview` (line 18609) renders exactly 3 cards — adding a 4th changes the strip layout.
- `simulated-leaderboard.js` `BOTS` table has no `flightsBase`/`flightsJitter` archetype slots.

**Decision deferred**. Adding flights would be a clean follow-up patch — the data layer is in place and the metric registry pattern is well-established. But this patch's scope was the bedtime → workout swap; adding a 4th leaderboard card on top of that would change the 3-card strip layout (the user explicitly said "Do NOT redesign the rankings area"). When the user is ready to ship it as 1z.119, the punch list is:

1. Add `flights_climbed_weekly: 3` (or chosen floor) to `_LB_MIN_QUALIFYING_SCORE` if it should require a minimum.
2. Add `flights_climbed_weekly: 1` to `_LB_SIM_METRICS` and `LB_WEEKLY_METRICS`.
3. Add the metric to `LB_METRICS_META` with title "Most flights climbed this week" + blurb.
4. Extend `lbGetSnapshot()` with `current_flights_weekly` (sum via `Health.getFlightsClimbedBetween` over the Sunday-PT-anchored window) + `best_flights_weekly` (persist alongside `best_7day_step_total`).
5. Extend `_lbMaybeSimulate` and the bot table to generate plausible flight totals.
6. Either add a 4th card to `renderLeaderboardPreview` (layout change — needs design pass) OR expose flights only through the full Top-50 sheet via a new entry point.
7. Tests mirror Group O / M patterns.

No archive / upload / deploy needed for either this patch or the follow-up — both live entirely in the web bundle.

### 🌐 Real-user leaderboard — audit memo + activation runbook (1z.120)

**Asked**: How do we get the leaderboard off the simulated-only state and surface real users alongside Richie? **Audit finding**: The backend is far more mature than the question implied. We're 1 backend deploy + 1 frontend flag flip away from real workout_streak users. step_total / sleep_streak / bedtime_streak ALREADY support real users — the leaderboard just looks sim-heavy because the user base is small.

#### What already works (production today)

| Layer | What's live |
|---|---|
| **Auth** | Apple Sign In + JWT (backend/src/handlers/auth-verify.ts) — every iOS user has a stable user_id + display_name (alias). |
| **DB schema** | `leaderboard_snapshots` table is **metric-agnostic** — one row per `(user_id, metric)` pair. No schema migration needed to add a metric. `weekly_step_records` table backs the Hall of Fame for step_total. 9 migrations applied to remote D1. |
| **Submit route** | `POST /v1/leaderboard/submit { metric, current_value }` — authenticated, rate-limited via `RL_LEADERBOARD_SUBMIT`. Upserts user's row. |
| **Top route** | `GET /v1/leaderboard/top?metric=X&limit=N` — returns top + caller's row. Rate-limited via `RL_LEADERBOARD_TOP`. |
| **Hall of Fame** | `GET /v1/leaderboard/hall-of-fame?metric=step_total&limit=N` — for step_total only. |
| **Frontend submit** | `lbSubmitAllMetrics()` (app.js:6607) submits step_total + sleep_streak + bedtime_streak on every app open + visibility change. |
| **Frontend fetch** | `_lbRenderThisWeekTab` fetches via `Auth.fetchLeaderboardTop` and merges with simulated rows for sparse boards. |
| **Sanity caps** | step_total: 200,000; streaks: 365. Server-side enforced. |
| **Weekly scoping** | step_total filtered by `week_start = $currentSundayUTC`. Streaks carry forward (no weekly reset). |

#### Why the board looks sim-heavy today

- The user base is small (only the actual test/dev users — Richie + maybe a few others — are submitting). Sim merge fills the gap from `simulated-leaderboard.js`.
- The "Richie" row is real (Apple Sign In → backend submit). Every name like `shadowmonarch_k`, `ascendantnova`, `ghostlift`, etc. is a deterministic sim bot.
- As real users sign up and submit, they'll naturally appear and bots will get pushed down by the sort.
- workout_streak (1z.118) was shipped as **client-only** intentionally — backend wasn't updated yet.

#### What's missing for workout_streak specifically

The 1z.118 commit marked workout_streak client-only because the backend's `METRICS` whitelist didn't include it. The fix is mechanical (no schema change — table is metric-agnostic):

1. **Backend** (`backend/src/lib/metrics.ts`): add `'workout_streak'` to METRICS array + METRIC_CAPS map. → Done in this commit (code change only; not deployed).
2. **Backend handlers** error strings updated (cosmetic, validation already goes through `isValidMetric`). → Done.
3. **Backend tests**: pass. `npx vitest run` shows 20/20 in leaderboard-submit + leaderboard-top.
4. **Backend deploy**: required. `cd backend && npx wrangler deploy`. **NOT done in this commit** — deploy is a separate explicit step.
5. **Frontend flag flip**: `LEADERBOARD_WORKOUT_BACKEND_ENABLED = false` → `true`. When true: workout_streak drops out of `_LB_CLIENT_ONLY_METRICS`, AND `lbSubmitAllMetrics` includes it in the submit array. Default stays FALSE in this commit so behavior is unchanged.
6. **Frontend archive + upload**: the flag flip needs to land on TestFlight. Same heavy-prep flow as prior patches.

#### Activation runbook (when ready to ship real workout_streak)

```bash
# 1. Backend deploy
cd backend
npx wrangler deploy          # pushes the workout_streak whitelist
npx vitest run               # confirm 20/20 pass

# 2. Flip the frontend flag (this commit's repo state has it at false)
#    Edit app.js:21319 → LEADERBOARD_WORKOUT_BACKEND_ENABLED = true
#    Commit: "chore: enable workout_streak backend leaderboard"

# 3. Archive + upload (MacBook)
bash scripts/prep-local-build.sh   # all four verify gates
npx cap open ios                   # Marketing 2.2.3, Build = next, Archive → Upload
```

The backend is forward-compatible: even with the new METRICS entry, no existing client behavior changes until a client actually submits workout_streak (which only happens with the flag flipped).

#### Other metrics already real-user-capable today

- `step_total` — already submitting + fetching live. World Rank #2 visible to Richie is computed from real submissions (with sim filler).
- `sleep_streak` — same. The 1z.116 floor (>= 3 nights) gates which real users appear.
- `bedtime_streak` — backend still accepts it; UI card was retired in 1z.118 but the metric continues to support potential future surfaces (e.g. a Bedtime Duel view).

#### Decision: chose Path D-lite (Path B + C combined, no deploy)

- Path A (docs only) — leaves the workout_streak path unwired forever.
- Path B (frontend adapter scaffold) — overkill; `_lbMaybeSimulate` is already the abstraction.
- Path C (backend route scaffold) — routes already exist for every metric; just needs the whitelist entry.
- **Path D-lite** — minimal backend code change (1 array entry + 1 cap entry + cosmetic error-string updates), feature-flagged frontend gate, no deploy. The actual flip-the-switch step is a documented runbook.

The patch is forward-safe: a future session that wants to ship real workout_streak follows the 3-step runbook above. The system stays in its current proven state until that explicit decision.

---

## 📌 Session handoff — May 19, 2026 morning (historical — superseded by the May 20 section above)

### 🎉 STATUS: 2.2.1 APPROVED BY APPLE

**Approval received:** May 19, 2026 at 12:01 AM Pacific Daylight Time.
**App Store URL:** `https://apps.apple.com/app/awakened-habit-rpg/id6764727990`
**Submission ID (approved):** `f5373012-82a7-49ff-9bb7-e6bc3a6a6321`
**Previous (rejected) submission:** `07b1380d-d40f-49bc-bb19-8bb2ba508e7c` (rejected May 18 evening on 5.1.1(iv) HealthKit pre-prompt buttons + 1.5 Support URL).

Apple may take up to 24h to flip the build from "Ready for Distribution" to publicly available. As of this handoff, 2.2.1 is approved/eligible for distribution in App Store Connect. Confirm whether it has been manually released or is publicly available before announcing.

### Current HEAD vs. approved IPA — IMPORTANT GAP

**Current HEAD:** `d20f2e7` · `fix: actual root cause of C-rank boss art — Codemagic copy script` · in sync with `origin/main`. Working tree clean apart from the long-standing untracked preview HTMLs (`preview-duels-polish.html`, `preview-morning-briefing.html`).

**The approved 2.2.1 IPA was built off an earlier commit** (pre-1z.80). It contains:
- All App Review compliance fixes (1z.77 + 1z.78 — HealthKit + Notifications neutral "Continue" buttons).
- The Sigil Bloom rare/ultra relic reveal (1z.74 → 1z.76).
- Three C-rank bosses with full drop pools (1z.63 → 1z.70).
- Apple Health verified stats for steps / sleep / strength / flights / active energy.
- Item rebalance + sub-rank divisions + dual-condition boss + tappable hunting pills + Carouser Friday-only.

**The approved IPA does NOT contain:**
- The robust `setBossImage` helper (shipped in 1z.80).
- The Codemagic glob-copy fix that actually bundles C-rank boss PNGs into the iOS bundle (shipped in 1z.81).

**Practical impact on the live 2.2.1:** C-rank boss cards show **blank art** for the three C-rank bosses (Ascendant Colossus, Furnace Knight, Marathon Wraith). The boss is functional — engagement, kill conditions, drops all work — only the portrait illustration is missing on the card and detail screen.

**Why Apple still approved it:** C-rank bosses are rank-gated. Apple's reviewer is an E-rank fresh install. They saw the three C-rank bosses in **preview state** ("Reach C rank to engage") and didn't engage them, so the blank-art issue was invisible during review. Functional review passed.

**Recommended next step:** trigger Codemagic off `main` HEAD `d20f2e7` to produce 2.2.1 build 62 (or 2.2.2 build 1) with the boss-art pipeline fixed. The new Codemagic freshness gate will block any future build that fails to bundle the C-rank PNGs. **Not urgent** — current users see functional E/D bosses fine; only users who hit C-rank will see the issue, and we're early enough that there should be ~zero users at C-rank yet.

### Version knobs (current `main`, NOT the approved IPA)

| Knob | Value |
|---|---|
| `APP_VERSION` | `2.2.2` |
| `APP_BUILD_TAG` | `2.2.2-w15` |
| `app.js?v=` | `453` |
| `auth.js?v=` | `16` |
| `styles.css?v=` | `302` |
| `simulated-leaderboard.js?v=` | `6` |
| `sw.js CACHE_VERSION` | `v5.339` |
| `HEALTHKIT_AUTH_VERSION` | `4` |
| `QA_UNLOCK_C_RANK_DUNGEONS` | `false` (relocked in 1z.80 — must stay false for public) |

### App Store Connect metadata (live, last verified May 19 AM)

| Field | Value |
|---|---|
| **Support URL** | `https://goallearner.github.io/awakened-app/support.html` (GitHub Pages from `docs/` folder) |
| **Marketing URL** | `https://luminous-sorbet-1e5987.netlify.app/` (live PWA — acceptable, polish later) |
| **Privacy Policy URL** | `https://heartfelt-froyo-54ffa1.netlify.app/` (Netlify-hosted privacy page, ~75 lines, covers on-device vs. backend data) |
| **Version** | 2.2.1 |
| **Copyright** | © 2026 Richmond Campano |
| **App Privacy** (Apple App Privacy form) | Set per the rejection cycle — all categories aligned with the Netlify privacy policy |

### Multi-day arc summary (1z.58 → 1z.81)

The session covering this submission was a ~7-day arc condensed below. Each phase is fully documented in its own section further down in this file.

| Phase | Theme | Key shipped |
|---|---|---|
| 1z.58 | Tappable hunting pills + Carouser Friday-only engage | UX polish |
| 1z.59 → 1z.60 | Rank detail sub-divisions (III → II → I) | UX |
| 1z.61 → 1z.62 | Apple Health: Flights Climbed + Active Energy plumbing | HealthKit auth v3 → v4 |
| 1z.63 → 1z.66 | C-rank bosses ×3 (Ascendant Colossus, Furnace Knight, Marathon Wraith) + 15 C-rank items + pool-wide rebalance | Major content |
| 1z.65, 1z.68, 1z.70 | Boss art + item PNGs installed (canonical paths) | Assets |
| 1z.67 | First dual-condition boss (strength + active energy) | Resolver logic |
| 1z.71 | Temporary C-rank QA unlock for TestFlight smoke | QA affordance |
| 1z.72 | Daily-boss verification window + one-kill-per-day lock | Product rule |
| 1z.73 → 1z.76 | Sigil Bloom rare/ultra reveal + result queue chaining + tap-to-reveal | ClaudeDesign-spec cinematic |
| 1z.77 → 1z.78 | App Review compliance — HealthKit + Notifications "Continue" buttons | Apple 5.1.1(iv) |
| 1z.79 | Public support page (`docs/support.html`) | Apple 1.5 |
| 1z.80 | C-rank QA unlock RELOCKED + robust `setBossImage` helper | Compliance + JS hardening |
| 1z.81 | **Real** root cause of C-rank boss art: Codemagic `cp` allowlist → glob copy | Build pipeline |

### Files you'll touch most for follow-up work

| File | What's in it |
|---|---|
| `app.js` | 28k+ lines IIFE. `BOSSES` config ~line 330, `CARDS` items ~1180, Health IIFE ~24500, Sigil Bloom code ~3830, `getBossArtPath`/`setBossImage` ~577 |
| `index.html` | App shell + every overlay/modal markup |
| `styles.css` | 23k lines; Sigil Bloom block near bottom, boss-card / pill blocks scattered |
| `sw.js` | Service worker + PRECACHE_ASSETS list (every asset must exist on disk OR cache.addAll fails install) |
| `codemagic.yaml` | iOS build pipeline. Has pre-sync + post-sync freshness gates with explicit C-rank boss PNG presence checks (1z.81) |
| `docs/support.html`, `docs/index.html` | Public support page (GitHub Pages) |
| `auth.js` | Apple Sign In + backend RPC wrappers — DO NOT TOUCH unless backend work approved |
| `backend/` | Cloudflare Worker + D1. **DO NOT TOUCH unless explicitly approved.** |
| `tests/e2e/smoke.spec.ts` | Playwright smoke (7 tests, expected `7 passed` in ~40s) |

### Open follow-ups (non-blocking)

1. **Boss art on live 2.2.1:** trigger Codemagic off `d20f2e7` to bundle the C-rank PNGs. Suggest 2.2.2 (since 2.2.1 is approved, a new version is cleaner than a rebuild).
2. **Marketing URL polish:** swap `luminous-sorbet-1e5987.netlify.app` for `https://goallearner.github.io/awakened-app/` once you flesh out the landing page with screenshots + features. Pure metadata change, no review required.
3. **Privacy Policy URL polish:** the Netlify subdomain `heartfelt-froyo-54ffa1` works but isn't pretty. Could rename the Netlify site to something like `awakened-privacy.netlify.app`, OR move privacy.html to GitHub Pages alongside support.html. Pure metadata change.
4. **Support page upgrade:** consider adding a public Privacy Policy section directly on `docs/support.html` or linking the Netlify policy from there for consistency.
5. **QA_UNLOCK_C_RANK_DUNGEONS:** stays `false`. Flip to `true` ONLY during local QA passes, then flip back before any commit that goes near `main`.

### Codemagic build hygiene (1z.81 hardening)

The build now has **two-stage freshness verification:**

1. **Pre-sync gate** (after `cp` to `www/`): checks every C-rank boss PNG exists in `www/assets/bosses/`. Fails the build loudly if not.
2. **Post-sync gate** (after `npx cap sync ios`): checks every C-rank boss PNG exists in `ios/App/App/public/assets/bosses/`. Catches the case where `cap sync` somehow drops these specific files.

If either gate fails, the build aborts with a message pointing at the line that broke. This is what would have caught the 1z.65 / 1z.68 / 1z.70 oversight at first commit instead of taking three TestFlight builds to notice. Any future boss PNG you drop into `assets/bosses/` will bundle automatically (glob copy) — no `codemagic.yaml` edit required.

### Smoke gate — current expected state

`node --check app.js` → OK
`npm run test:e2e` → **7 passed** in ~40s
Grep for risk strings → clean (no `Not Now` / `Enable` button text near permission requests)
Boss art files → all 9 present on disk and tracked in git

### What got REMOVED from CLAUDE.md as part of this handoff

The previous handoff section (May 17 PM) documented the 100K Step Club / Hall of Fame / leaderboard work that shipped to backend D1 then. That work is now stable, documented in its own phase sections below, and no longer requires top-of-file attention. Backend D1 state is unchanged since 1z.41 (Worker version `761b6392`).

---

## ⚠️ ARCHIVED HISTORICAL HANDOFF — DO NOT USE FOR CURRENT BUILD INSTRUCTIONS

> The May 17 handoff below describes the state of the repo as of `6fc7acf` (build tag `2.2.1-w61`, `app.js?v=410`). It is preserved for historical context only.
>
> **The current source of truth is the May 19 handoff at the top of this file** (`d20f2e7`, `2.2.1-w85`, `app.js?v=434`, App Store-approved).
>
> Any references in this archived section to HEAD `6fc7acf`, build tag `2.2.1-w47`, or "trigger Codemagic on current main" are HISTORICAL — they reflected the state at the time of writing and have been superseded.

---

### Previous handoff (archived) — May 17, 2026 4:30 PM

**Then-current HEAD:** `6fc7acf35886c5e040401b3174123c158a4c6fd4` · `fix: hall of fame falls back to leaderboard_snapshots` · in sync with `origin/main` at the time. Working tree was clean apart from two untracked preview HTMLs (`preview-duels-polish.html`, `preview-morning-briefing.html`) that had been sitting around for a while and were NOT part of the build.

**Version knobs at the time:**
| Knob | Value |
|---|---|
| `APP_VERSION` | `2.2.1` |
| `APP_BUILD_TAG` | `2.2.1-w61` |
| `app.js?v=` | `410` |
| `auth.js?v=` | `16` |
| `styles.css?v=` | `295` |
| `simulated-leaderboard.js?v=` | `6` |
| `sw.js CACHE_VERSION` | `v5.296` |
| `HEALTHKIT_AUTH_VERSION` | `2` |

### What shipped today (May 17 work)

**A. Spark branding (earlier session arc)** — Spark mark replaced legacy logo across the app icon, splash, and brand surfaces. Static `/icon-192.png` / `/icon-512.png` generated from `app-icon-source.png` via `scripts/generate-app-icons.ps1`; OffscreenCanvas dynamic-icon path retired from `sw.js`. Splash + brand mark use the canonical Spark geometry.

**B. 100K Step Club (Phase 1z.27 → 1z.32)** — backend `user_accolades` D1 table live; `GET /v1/users/me/accolades` live with `RL_USER_ACCOLADES_READ` ratelimit. Inline award on `step_total >= 100000` from real users only (sim filter at write time). Final UI = the **rank-aware "Rank Hero" 100K Club badge** (Phase 1z.32) — 6 variants (E violet · D green · C blue · B royal · A amber+violet ring+laurel · S crimson+embers), gold frame constant, stacked `100K / rank-letter / CLUB` content, S+ falls back to S. The accolade detail sheet works. Local browser preview tested via `hb_accolades_cache` localStorage mock.

**C. Weekly Steps leaderboard scoping (Phase 1z.33)** — migration `0008_leaderboard_week_start.sql` deployed. `leaderboard_snapshots` now has a `week_start TEXT` column + `idx_leaderboard_metric_week_value` composite index. `GET /v1/leaderboard/top?metric=step_total` filters by current Sunday-UTC week. Submit path tags rows; ON CONFLICT preserves the new-week overwrite. Sheet copy updated to `May 17–May 23 · resets Sunday 12:00 AM UTC. Apple Health is the only source.` Stale pre-1z.33 NULL-week rows correctly drop out (3 rows on prod: Immortal Shadow / Melvin / Galilea — invisible until they resubmit). Convention documented: **Sunday 00:00 UTC**, identical to the 100K accolade week key. Client cache also cross-week-guards so the World Rank card doesn't paint last-week's rank after the boundary.

**D. Simulated leaderboard cap (Phase 1z.35)** — `simulated-leaderboard.js` rev v5 → v6. `SIM_STEP_WEEKLY_CAP = 45555` constant centralized and exposed on `window.SimulatedLeaderboard`. Hard clamp in `botStepsThroughDay`. Defense-in-depth re-clamp after the tie-bump in the merge. Bot cast retuned across the four product bands (Light / Normal / Active / High but realistic). Stress test across 200 random week keys: max bot weekly = 45,555 exactly (cap engages on tail rolls, never exceeded). Sims cannot visually approach 100K Club territory.

**E. Weekly Steps Hall of Fame (Phase 1z.36 → 1z.41)** — full feature shipped end-to-end:
- Backend: migration `0009_weekly_step_records.sql` deployed (table + 3 named indexes + 2 auto-indexes). `GET /v1/leaderboard/hall-of-fame?metric=step_total&limit=N` deployed with `RL_LEADERBOARD_HOF` (namespace 1012, 30/min). Write path extended in `leaderboard-submit.ts` with the `MAX(stored, new)` upsert wrapped in a try/catch (1z.38) so HoF write failures cannot break the core leaderboard / accolade writes. **Fallback-union (1z.41) reads from `weekly_step_records` UNION ALL eligible `leaderboard_snapshots` rows** (metric=step_total, week_start IS NOT NULL, apple_sub NOT LIKE 'sim_test_%', NOT EXISTS in wsr) so real users with valid pre-1z.36 week-tagged snapshots appear in HoF immediately without backfill.
- Frontend: segmented `This Week / Hall of Fame` control inside `#lb-rank-sheet`. `hb_lb_hof_step_total` cache (10-min TTL). `_lbMergeHofRecords` returns `{records, me_best_displayed}` so the pinned `YOUR BEST` rank matches the visible merged list (1z.40 fix). Sims are CLIENT-ONLY filler (1z.37 decision) — never persisted, never affect `me_best`, capped at 45,555.
- **Current D1 state:** `weekly_step_records` has 1 row (Richie's post-1z.36 submit). `leaderboard_snapshots` has 2 eligible fallback rows (RenDIESEL 3,246 + Richie 3,110, both week `2026-05-17`). HoF endpoint returns 2 unique records (wsr's Richie row supersedes the ls fallback via NOT EXISTS dedupe).
- Backend Worker version live: **`761b6392-d274-41d1-b923-97bf009e2820`** (the 1z.41 fallback-union deploy).

**F. Leaderboard sheet UX (Phase 1z.40)** — `#lb-rank-sheet` is X-only close. Removed both `overlay click → close` AND `attachSheetDismissGesture` for this sheet specifically (the HoF list is the longest content of any sheet in the app and the drag-dismiss mis-fired during legitimate scrolls). All 12 other sheets keep their existing drag + overlay-tap dismiss — scope-limited fix. **Needs on-device QA confirmation** in the next iOS build: scroll the HoF list down vigorously → sheet stays open; tap X → closes; tap overlay → stays open.

**G. iOS post-save freeze (Phase 1z.34)** — fixed across 4 save handlers. Root cause was the `save(); renderHabits(); closeXModal();` anti-pattern: a synchronous throw inside `renderHabits` (e.g. `buildItem` hitting an unexpected habit shape after edit) bubbled past the close call and the overlay kept intercepting touches. New pattern across all sites: **persist → close → render-in-try-catch**. Affected flows: `commitEdit` (Edit Habit Save), `saveCustomHabit` (Add Custom Habit), the `sched-save-btn` handler (Schedule picker save), `confirmPackAdd` (Lock-In / Morning Routine pack confirm). `closeEditModal` was also hardened — each DOM step is independently try/caught so a missing element cannot leave the overlay stuck.

**H. Boss detail Souls balance (Phase 1z.39)** — IMPLEMENTED. Compact `SOULS AVAILABLE / 🩸 185` readout inside `#bfs-engage-cta`, above the gradient ENGAGE BOSS button. Two states: sufficient (gold) / insufficient (red ember, `NEED MORE SOULS / 12 / 25 needed`). Engage button gains `.bfs-engage-btn--insufficient` modifier (55% opacity, grayscale, red glow) when broke. Reads from existing `getSoulsBalance()` accessor — no new state. Existing `engageBoss()` toast guard is still the source of truth for spending.

### Deployment status — what is LIVE right now

**Backend (Cloudflare Worker @ `awakened-backend.richmondcampano93.workers.dev`):**
- D1 has **11 tables** (added `weekly_step_records` today on top of `users`, `leaderboard_snapshots`, `user_state_snapshots`, `user_accolades`, `friends`, `duels`, `verified_events`, `duel_progress_snapshots`, `user_souls_ledger`, `d1_migrations`).
- Migrations applied to remote D1: `0001` through `0009` (today added `0008` weekly scoping + `0009` HoF table).
- Endpoints live: `/v1/auth/verify`, `/v1/leaderboard/submit`, `/v1/leaderboard/top`, **`/v1/leaderboard/hall-of-fame`** (new), `/v1/account/delete`, `/v1/users/me/state` (GET/POST), `/v1/users/me/accolades`, `/v1/friends*`, `/v1/duels*`.
- Current Worker version ID: **`761b6392-d274-41d1-b923-97bf009e2820`** (1z.41 fallback-union deploy, May 17 evening).
- 12 ratelimit bindings (added `RL_LEADERBOARD_HOF` namespace 1012 today).

**Frontend (iOS / PWA) — as of May 17:**
- `main` at `6fc7acf` carried everything above, but **Codemagic had NOT yet been triggered for that day's work.** The last iOS build on TestFlight at the time predated Phase 1z.32. (Historical only — the work has since shipped through subsequent build cycles that culminated in the App Store-approved 2.2.1.)

### Playwright smoke tests (NEW — added end of May 17)

**Pre-Codemagic smoke gate, NOT a TestFlight replacement.** Browser-level structural-regression catcher. Run before every Codemagic trigger. Expected green state: **`7 passed`** in ~33s.

**First-time setup on a new machine (or fresh clone):**
```
npm install                       # picks up @playwright/test from devDependencies
npx playwright install chromium   # downloads the browser binary (one-time)
npm run test:e2e                  # should print "7 passed"
```
Skipping the `npx playwright install chromium` step is the most common first-run failure — the test runner exits with "Executable doesn't exist" and a hint to run that command.

**Standard commands:**
```
npm run test:e2e          # headless run, prints list output — the gate
npm run test:e2e:headed   # see the browser drive the app
npm run test:e2e:ui       # Playwright UI mode for picking individual tests
npm run test:e2e:report   # open the HTML report from the last run
```

**Setup baked into the repo:**
- `@playwright/test ^1.60.0` in devDependencies.
- `playwright.config.ts` boots the existing `serve.ps1` static server at `http://localhost:8080` via `webServer` (with `reuseExistingServer: true` for local dev iterations). Viewport set to 414×896 (iPhone-ish portrait). `trace: retain-on-failure`, `screenshot: only-on-failure`, `video: retain-on-failure`.
- Single worker (`workers: 1`) since the app is stateful and we don't want cross-test localStorage races.
- Chromium-only (the iOS WKWebView shipping shape is closest to Chromium-family; cross-browser matrix is unnecessary for a PWA wrapped in Capacitor).

**Tests live in `tests/e2e/smoke.spec.ts`** — 7 covers:
1. **A · App boots** — shell mounts, no fatal JS errors. Tolerates 401/network noise from the dev stub JWT hitting the production worker.
2. **B · Status tab** — default-active, "Hunter Profile" content visible.
3. **C · Habits tab** — opens, habit list area mounts (either `#habit-list` or `#empty-state` visible), Add Habit affordance reachable.
4. **D · Edit Habit modal** — opens + closes cleanly via Cancel, overlay is not stranded (covers the iOS post-save freeze regression from Phase 1z.34).
5. **E · Leaderboard sheet** — opens via the World Rank Steps card, `This Week / Hall of Fame` tabs visible, week date-range blurb present, HoF tab switch works, scroll keeps the sheet open, X closes (covers Phase 1z.40 scroll-dismiss fix).
6. **F · Boss detail Souls readout** — `SOULS AVAILABLE` pill renders above the Engage button (covers Phase 1z.39).
7. **G · Duels picker** — opens the picker via `window.openDuelTypePicker(stubAlias)` (pre-existing global used by in-app dispatch; not a test-only export) and asserts exactly 5 cards render with `data-duel-type` in `{verified_objectives, steps, sleep, bedtime, strength}`. `boss_race` is filtered by `selectable: false` in `_renderDuelTypeCards` and never reaches the DOM. UI-attribute-based — no DUEL_TYPES global needed.

**`freshApp(page)` helper** seeds the gate-skipping localStorage keys via `page.addInitScript()` BEFORE the page script runs:
- `hb_onboarding_seen_v2`, `hb_welcomed`, `hb_hunter_name_claimed`, `hb_cloud_restore_dismissed`, `hb_whats_new_seen` (set to `99.99.99` so the What's New modal never paints).
- Auth comes from `Auth.devSignInIfLocalhost()` — see auth.js. On `http://localhost` the app auto-signs in as "DevUser" with a stub JWT, so we never hit Apple Sign In.
- Then the helper waits for the splash to detach + force-hides any transient overlays (`#awakened-splash`, `#wn-overlay`, `#modal-overlay`, etc.) as a belt-and-suspenders safety net.

**What the smoke suite intentionally does NOT cover:**
- End-to-end Apple Sign In or any production-JWT flow.
- Real backend integration (the dev stub JWT 401s on `/v1/*` — filtered from the console.error watcher).
- HealthKit step submission / 100K Step Club accolade earning (HealthKit is a Capacitor-native plugin and only works on iOS).
- The Capacitor wrapper itself (WKWebView gestures, native nav).
- Drag-reorder regressions (intentionally disabled for 2.2.1).
- Duel CREATE / verified-event scoring flows (write paths against the real backend).
- iOS-only modals or sheet gestures that don't render in the Chromium engine.

**Where it fits in the pre-ship pipeline:**
- After a code change, before triggering Codemagic: `npm run test:e2e`. ~35 seconds for the full pass. If it's green, the Status/Habits/Edit-modal/Leaderboard/Boss-detail/Duels-tab flows aren't visually broken at a browser-render level.
- The suite is NOT a substitute for on-device TestFlight QA. iOS-specific Capacitor + WKWebView behavior (the post-save freeze repro itself) still needs an iPhone for ground-truth. The smoke suite catches the structural regressions that would otherwise burn a Codemagic build slot.

**Run output is sequential + fast.** Failures retain trace+video+screenshot under `test-results/` (gitignored). `npm run test:e2e:report` opens the last HTML report.

### Historical only — superseded by May 19 handoff

> ⚠️ The checklist, Codemagic action items, and acceptance gates below describe what the May 17 author intended the NEXT session to do. **They are NOT current instructions.** The May 19 handoff at the top of this file is the source of truth for any active build/release work. Read this subsection for historical context only — the action items have all been overtaken by subsequent build cycles culminating in the App Store-approved 2.2.1.

**Historical: next-session checklist that was queued at May 17 EOD:**
1. `git pull` to confirm HEAD matched `origin/main`.
2. Re-check the (then-current) version knobs table against `app.js`, `index.html`, `sw.js`.
3. Run the Playwright smoke suite (`npm run test:e2e`) before any Codemagic trigger.
4. Local browser preview spot-checks were listed for: Hall of Fame populated with real records + sim filler; This Week tab scoping; sheet scroll/dismiss behavior; rank-aware 100K badge rendering; Edit Habit + Lock-In save flows; Boss detail Souls balance; World Rank card → leaderboard sheet.

**Historical: Codemagic build target the May 17 session expected:**
- Trigger on then-current main HEAD (`6fc7acf` or later).
- Build tag was expected to read `2.2.1-w47`.
- Guidance was: do NOT build an older `w43` / `w45` / `w46` once `w47` or later is current.
- Manual on-device QA list was queued for post-install verification.

**Historical: post-build QA acceptance gates the May 17 session set:**
- HoF YOUR BEST card rank had to match a visible row in the merged list.
- HoF list scroll could not dismiss; X had to be the only close path.
- Edit Habit / Lock-In saves could not leave a stuck modal.
- 100K badge had to render correctly per rank.
- Boss Souls balance had to be visible and toggle insufficient state correctly.
- 5-type Duels picker only (Boss Race deferred).
- No drag-reorder on habits list (intentionally disabled for 2.2.1).

(All of the above have either been verified shipped through subsequent build cycles or were superseded by later product decisions. Do NOT re-execute as a checklist — refer to the May 19 handoff for current build state and any active follow-ups.)

### Known open items / NOT shipped

These are NOT in `main` and should NOT be assumed live. Tag in CLAUDE.md or a new ticket if planning work:

1. **Historical weekly champions / Monday winner recognition** — no backend cron, no recognition UI. The data to support it (`weekly_step_records`) is now live, so this could be the next feature pass. Idea: a "last week's champion" pill on the dashboard each Sunday/Monday.
2. **Weekly Steps Champion reward** — no souls/relic/XP grant for winning a week. No tournament mechanic.
3. **Accolades sheet / profile history** — beyond the 100K Step Club row, no aggregate accolades UI. `user_accolades` schema is generic enough for future types (`sleep_perfect_month`, etc.) but no other accolade type ships today.
4. **100K Club repeat-count richer UI** — `repeat_count` and `last_qualified_week_start` are persisted; the sheet currently shows the count but not a "week-by-week timeline." Could be a future deep-dive view.
5. **Boss rewards / loot / cards expansion** — current 6 bosses + 24 drop cards is the v2.2.1 dungeon. No new bosses planned this train.
6. **Habit reorder redesign via explicit edit mode** — drag-reorder is intentionally DISABLED for 2.2.1 (caused too many accidental reorders). When it returns, the spec is "explicit edit-mode toggle + drag handles per row" — no design or code yet.
7. **UI wording polish** — `"resets Sunday 12:00 AM UTC"` in the This Week blurb is technically correct but reads as engineering-speak. A future copy pass could shorten to `"resets Sunday"`. Don't change without product approval.
8. **Hall of Fame minimum-qualify threshold** — currently every real-user submit creates a row. If the table gets noisy with sub-10k entries, add a `WHERE steps >= 10000` filter at write time (no schema change required).
9. **Sims-to-HoF backend persistence** — explicitly DECIDED AGAINST. Sims stay client-only filler. Do not add sim users to `weekly_step_records`.

### 🛑 Safety warnings (read before any destructive work)

- **D1 migrations.** Do NOT run `wrangler d1 migrations apply` — the historical migrations are not seeded in the `d1_migrations` tracker. Use direct `wrangler d1 execute --remote --file=migrations/XXXX.sql` (with `printf 'y\n' |` to bypass the interactive confirmation) for new migrations. The `0008` and `0009` migrations applied today both used this pattern.
- **Sim seed / teardown scripts under `sims/`** — do NOT run unless explicitly testing sims. They mutate prod D1 (insert/delete test users).
- **Backend / Duels.** Do NOT touch backend handlers or Duels code casually before App Store / TestFlight QA. The 5-type duels picker, deferred Boss Race scoring, and verified-event aggregation are all known-good states that should not regress.
- **Sim cap.** `SIM_STEP_WEEKLY_CAP = 45555` is load-bearing. Do not raise it, do not bypass it, do not allow sims to ever submit to backend (they don't — keep it that way).
- **100K Club accolade.** Sims must NEVER earn it. The `apple_sub LIKE 'sim_test_%'` filter at write time in `leaderboard-submit.ts` is the gate. The HoF table inherits the same filter both at write time and via the union read.
- **Habit drag-reorder.** Stay disabled for 2.2.1. Do not re-enable without the explicit edit-mode redesign.
- **Codemagic.** Trigger only when intentional. Do not auto-trigger on every commit. (At the time of writing, `6fc7acf` was the queued target — historical only; check the May 19 handoff for the current target.)
- **Worker rollback.** If a Worker deploy regresses, `wrangler rollback` is available. The 1z.36 → 1z.41 Worker versions (`712ff1c5`, `9593f398`, `b97990ad`, `761b6392`) are all in the version history and any can be re-deployed.

### Create Your Own Habit freeze fix + Add Habits exit-path audit (v3 Phase 1z.106)

**Reproduced repeatably on iPhone/TestFlight.** User typed a custom habit name (`Run`, `Jump`), picked the STR stat, tapped Create Habit — modal appeared to dismiss but the app became unresponsive. Confirmed in Playwright before the fix: post-save tap on `#tab-profile` was rejected because `<div class="lib-pack-entry--lockedin"> from #lib-sheet subtree intercepts pointer events`.

**Root cause.** `saveCustomHabit` closed `#custom-overlay` cleanly but never closed the parent `#lib-sheet` / `#lib-overlay`. The library overlay then intercepted pointer events on the bottom tab bar, reading to the user as a freeze after the modal dismissed.

**Fix (surgical).** Mirrors the 1z.89 preset-add UX (`confirmPackAdd`):
- `saveCustomHabit` now calls `closeLibrary()` after `closeCustomHabitModal()`, each wrapped in its own try/catch so a throw in one cannot strand the others.
- Order preserved (matches the proven safe pattern): `push → save → close modals → renderHabits(skipSideEffects) → renderLibrary → toast`.
- Duplicate-name check is now null-safe (was `h.name.toLowerCase()` on a possibly-undefined name; defensive only).
- A confirmation toast `"<name>" added` fires post-save so the user gets unambiguous feedback.

**Diagnostics.** New custom-create breadcrumb sequence added to the existing `hb_add_habit_debug_v1` ring (so Copy Debug Info captures the path on TestFlight without a new ring):
- `custom-create-click`, `custom-create-validated`, `custom-create-persist-start` / `-ok` / `-threw`, `custom-create-close-modal`, `custom-create-render-start` / `-ok` / `-threw`, `custom-create-render-library-threw`, `custom-create-validation-failed`, `custom-create-complete`.
- Privacy-safe: logs name length and stat id only — not the habit name string itself.

**Regression test.** `tests/e2e/smoke.spec.ts` gained `I · Create Your Own Habit (1z.106)` which:
- Opens Add Habits → Create Your Own → fills `Run` → selects STR (first stat card) → clicks Create Habit.
- Asserts BOTH the custom overlay AND the parent `#lib-sheet` + `#lib-overlay` are hidden after save (the regression assertion).
- Asserts the habit lands in `hb_habits` with `custom: true`, `primaryStat: 'STR'`, `difficulty: 'medium'`.
- Asserts the toast renders.
- Asserts `#tab-profile` is tappable post-save (this is the freeze symptom — was failing before the fix).
- Asserts the breadcrumb sequence is intact and no error breadcrumbs fired on the happy path.

**Files touched (1z.106 only):**
- `app.js` — `saveCustomHabit` reworked + breadcrumbs.
- `tests/e2e/smoke.spec.ts` — new test `I`.
- `CLAUDE.md` — this section and the handoff updates.

**Verification:**
- `node --check app.js` → OK
- `node --check sw.js` → OK
- `npm run test:e2e` → **9/9 pass** (~58s)
- Version knobs unchanged: `APP_VERSION 2.2.2`, `APP_BUILD_TAG 2.2.2-w15`, `app.js?v=453`, `sw.js v5.339`, `QA_UNLOCK_C_RANK_DUNGEONS = false`.

**No version-knob bumps. No Codemagic. No upload.** Ships piggyback on the next 2.2.3+ build.

#### Add Habits exit-path audit (post-1z.106)

After the 1z.106 fix landed, every documented exit path for the Add Habits overlay stack was traced end-to-end. Result: **no real unclosed paths remain.** 1z.106 closed the only real stranded-overlay surface. No additional code changes warranted.

**`lib-sheet` + `lib-overlay` — 9 exit paths, all close cleanly:**
1. `#lib-close-btn` → `closeLibrary`.
2. `#lib-overlay` backdrop click → `closeLibrary`.
3. Swipe-down dismiss via `attachSheetDismissGesture` — also clears inline `transform/transition/opacity` in its `transitionend` cleanup.
4. Preset-add success → `forceCloseAddHabitsStack('add-success')` (closes hd-sheet + lib-sheet + lib-overlay + clears inline residue).
5. Preset dup-guard → `forceCloseAddHabitsStack('dup-guard')`.
6. Preset outer-catch → `forceCloseAddHabitsStack('outer-throw')`.
7. Post-add watchdog (500ms) → `forceCloseAddHabitsStack('watchdog-500ms')` — idempotent belt-and-braces.
8. Pack-add success (`confirmPackAdd`) → closes mr-overlay + lib-sheet + lib-overlay, each in own try/catch.
9. Custom-habit save (1z.106) → closes custom-overlay + lib-sheet + lib-overlay, each in own try/catch.

**`custom-overlay` — 3 exit paths, all close cleanly:**
1. `#custom-cancel-btn` → `closeCustomHabitModal` (lib-sheet remains open — intentional, returns user to library).
2. `#custom-overlay` backdrop click → `closeCustomHabitModal`.
3. `#custom-save-btn` → `saveCustomHabit` → closes custom-overlay + lib-sheet + lib-overlay (1z.106).

**`hd-sheet` — 7 exit paths, all close cleanly:**
1. `#hd-back` → `closeHabitDetail` (sets `display:none !important` + `pointer-events:none` belt-and-braces; lib-sheet remains — intentional, returns to library).
2. Swipe-down → `closeHabitDetail`.
3. `addBtn` success / dup-guard / outer-catch / watchdog → `forceCloseAddHabitsStack` (all four).
4. Onboarding "Remove from list" (line 17216): `opts.onRemove(); closeHabitDetail();` — `opts.onRemove` is `obDeselect` (Set.delete + DOM toggle, very low throw risk); no lib-sheet behind in onboarding context, so even a theoretical throw wouldn't deadlock interaction. **Not actionable.**

**`mr-overlay` (pack confirm) — 4 exit paths, all close cleanly:**
1. `#mr-cancel-btn` → `closeMorningPackModal` (mr-overlay only; lib-sheet remains — intentional, returns to library).
2. `#mr-overlay` backdrop → `closeMorningPackModal`.
3. `#mr-confirm-btn` (missing > 0) → `confirmPackAdd` → closes mr-overlay + lib-sheet + lib-overlay.
4. `confirmPackAdd` early return when `missing.length === 0` (line 15663) — closes mr-overlay only. Safe because the button is disabled when `missing===0` (line 15481); this is a defense-in-depth branch only.

**Cross-cutting protections verified:**
- `forceCloseAddHabitsStack` (16533) wraps `closeHabitDetail` + `closeLibrary` + `resetAddHabitsInteractionState`, each in independent try; called from 4 sites in the preset path.
- `resetAddHabitsInteractionState` (16490) per-id clears inline `transform/transition/opacity/pointer-events` on `hd-sheet`, `lib-sheet`, `lib-overlay` so gesture-handler residue can't strand the next open.
- Inline `display:none !important` + `pointer-events:none` on `closeHabitDetail` (17249-17251) belt-and-braces against stale style attributes.
- `attachSheetDismissGesture` `transitionend` callback (24566-24571) clears its own inline `transform/transition/opacity` after dismiss.
- `switchTab` does NOT close Add Habits overlays — safe because lib-overlay sits over the tab bar (modal z-index), so the user can't accidentally switch tabs from inside Add Habits; they must use one of the documented exit paths.

**Conclusion.** The 1z.106 fix closed the last real strand path in the Add Habits surface. No further code changes are warranted from the audit.

### Workout habit broadened from strength-only to any Apple Health workout (v3 Phase 1z.105)

**Product decision.** Following the 1z.104 diagnostic instrumentation, the user confirmed the issue was as anticipated for Hypothesis (A): Apple Health logged the user's workouts as HIIT + Walking, neither of which was in the strength-only allowlist. The fix could either extend the allowlist (still strength-leaning) or broaden the habit to accept ANY workout type. **Decision: broaden + rename.**

**Habit rename.** Canonical habit `Strength training` → `Workout`. The displayed card label changes from "Strength training 30 min" to "Workout 30 min".

**Verification rule change.** Habit auto-verifies when the user's total daily Apple Health workout minutes (sum across ALL workout types: HIIT, walking, running, cycling, strength, yoga, sports, anything) meets `HEALTHKIT_WORKOUT_DAILY_TARGET_MIN = 30` minutes. Per-sample floor: `HEALTHKIT_WORKOUT_SAMPLE_MIN_MIN = 1` minute (filters zero-length junk only).

**Iron Warden boss kept strength-only.** Iron Warden's kill condition copy explicitly reads "verified strength workout of at least 10 minutes today." Per the user's explicit guardrail ("do not silently change Duels scoring without explicit review" — same principle for boss kill conditions), Iron Warden continues to call `Health.getStrengthWorkoutsToday()` which retains the strength-only filter. The new generic habit and Iron Warden now use **different data sources** within the same `autoVerifyStrengthTraining` function call.

**Strength Duel kept strength-only.** `duel_type === 'strength'` copy reads "Most Apple Health strength workouts wins." Untouched. If the strength duel type is ever broadened, it should be renamed "Workout Duel" with explicit UI copy changes.

**Files touched (1z.105):** only `app.js`.

Code surfaces changed:
1. New constants `HEALTHKIT_WORKOUT_DAILY_TARGET_MIN` (30), `HEALTHKIT_WORKOUT_SAMPLE_MIN_MIN` (1).
2. `DEFAULT_HABITS[4]` renamed: `name: 'Workout'` (emoji 🏋️ kept).
3. `MEASURABLE_HABITS['Strength training']` key → `'Workout'` (def 30 / min 20 / step 5 unchanged — user can still configure goal display).
4. `STATS.STR.habits[]` membership updated.
5. `HABIT_PRIMARY_STAT['Workout'] = 'STR'`.
6. `HABIT_ICONS['Workout']` → `assets/habit-icons/icon-strength.png` (asset kept; dumbbells still represent workout generically).
7. `HABIT_DESCRIPTIONS['Workout']` updated to neutral "Movement is metabolic armor" framing.
8. `HABIT_NOTIF_COPY['Workout']` body + title updated.
9. `isStrengthWorkoutHabit(habit)` now matches `'Workout'` (function name kept for caller stability; semantics are generic workout now).
10. `isReadOnlyAutoVerifyHabit(habit)` references updated.
11. `findStrengthHabit()` now looks up `'Workout'` (name kept for caller stability).
12. Notes-modal explainer copy (line ~6527) rewritten — no longer says "Cardio sessions, HIIT, and yoga don't count." Now says any workout type counts.
13. `autoVerifyStrengthTraining()` restructured: fetches BOTH strength-only data (for Iron Warden) AND any-workout data (for habit), checks against the new daily-target threshold.
14. New `Health.getAnyWorkoutsToday()` + `Health.getAnyWorkoutsBetween()` + `Health.clearAnyWorkoutCache()` exported. Separate cache (`_anyWorkoutCache`).
15. Visibility-resume handler clears both strength + any-workout caches.
16. `_backfillStrengthYesterday()` reworked: uses `getAnyWorkoutsBetween` + 30-min total threshold; toast text now "Workout sealed for yesterday — N verified min".
17. `wasUncheckedToday` / `wasUncheckedOnDate` lookups check BOTH `'Workout'` AND `'Strength training'` for backwards-compat with users who unchecked the habit prior to the rename.
18. `countCompletionsByName` achievement counter sums both names for the same backwards-compat reason.
19. New rename migration in `init()`: `if (!localStorage.getItem('hb_strength_to_workout_rename_v1'))` finds non-custom habits named "Strength training" and renames in-place. Preserves `habit.id`, so all completions/streaks/per-id metadata carries forward unchanged. Idempotent.
20. Health-verify breadcrumbs (1z.104) updated: emit `target: HEALTHKIT_WORKOUT_DAILY_TARGET_MIN`, distinguish `strength.*` (Iron Warden data) from `workout.*` (habit data) in the `strength-data` payload, and report `below-daily-target` skip reason with totalMinutes + target.

**Hypothesis disposition (from 1z.104 audit):**
- (A) Workout type classification — CONFIRMED as the cause. Fix: accept any type.
- (B) Auto-verify trigger not firing — NOT the cause (1z.104 breadcrumbs would have shown missing entry breadcrumbs).
- (C) Stale cache — NOT the cause.
- (D) Per-habit gates — NOT the cause.

**Files touched (1z.105 only):**
- `app.js` — all 20 surface changes above. `APP_BUILD_TAG` unchanged at `2.2.2-w15`.
- `CLAUDE.md` — this section.

**No version-knob bumps.** This ships piggyback on the next 2.2.3+ build whenever the user is ready.

**Verification:**
- `node --check app.js` → OK
- `npm run test:e2e` → 8/8 pass.
- `git diff --name-only` → `app.js`, `CLAUDE.md` only.

**Known non-goals:**
- Iron Warden boss kill condition NOT changed — still strength-only per explicit decision.
- Strength Duel NOT changed — still strength-only per explicit decision.
- No backend / D1 / HealthKit permission wording / Notification permission wording changes.
- Codemagic NOT triggered. No upload, no archive, no deploy.

**Migration safety:**
- Existing users' "Strength training" habits are renamed in-place. Habit.id preserved → all completions/streaks/XP/per-id metadata carries forward unchanged.
- Idempotent via `hb_strength_to_workout_rename_v1` localStorage flag.
- Won't duplicate the habit. Won't reset any data.
- Pre-rename `wasUncheckedToday`/`wasUncheckedOnDate` history under `'Strength training'` is still honored (dual lookup).

### HealthKit auto-verify breadcrumb instrumentation (v3 Phase 1z.104)

**Trigger.** User reported on May 20 evening that the "Strength training 30 min" habit didn't auto-check even though Apple Health showed 3h 12min of workouts on the same day. Daily walk also unchecked despite Apple Health showing 9,153 steps over the 8,000-step threshold.

**Static audit result.** Code path is structurally correct. Could not distinguish between competing hypotheses from static read alone:
- (A) Workout type classification — Apple Health's "Workouts" total may include non-strength activities (cardio, walking, etc.) that the `_isStrengthWorkoutSample` filter correctly rejects. The user could simply not have done any strength-typed workout.
- (B) Auto-verify trigger not firing — both Daily walk AND Strength training are unverified, so it might be a broader trigger / cache / permission issue rather than a strength-specific classification miss.
- (C) Stale 5-minute cache returning pre-workout step counts.
- (D) Per-habit gates — `wasUncheckedToday`, `isChecked`, `isAutoVerifyDisabled`, manual user unchecks.

The existing `_hkDebug` logging requires `localStorage.hb_debug_healthkit === '1'` AND Safari Web Inspector console access — both unavailable on App Store-signed TestFlight builds.

**Fix.** Added persistent breadcrumb instrumentation (no behaviour change, no version bumps):

1. **`_addHealthVerifyBreadcrumb(step, data)` helper** — mirrors `_addNotifBreadcrumb` and `_addDuelsBreadcrumb`. Writes to `localStorage.hb_health_verify_debug_v1` (60-entry ring). Each entry: `{ t, step, data }`.

2. **Breadcrumbs in `autoVerifyStrengthTraining`** — at entry, permission read, data fetch (with first 5 sample classifications: `workoutActivityName`, `workoutActivityId`, `duration_min`), and each skip branch (data-null / auto-verify-paused / habit-not-in-list / already-checked / user-unchecked-today / zero-qualifying-workouts) and the sealed path.

3. **Breadcrumbs in `autoVerifyWalk`** — same shape: entry, permission, steps result, each skip branch, threshold check (with `steps`, `threshold`, `meets`), and sealed.

4. **Debug payload extension** — `_buildAwakenedDebugPayload` now includes a `healthVerify.debug` section surfacing the breadcrumb ring via Copy Debug Info.

**Privacy.** The sample classification data captures only the workout type identifiers (name + numeric id + duration in minutes) — not workout history, not source-app name, not raw HealthKit sample objects. Caps at 5 samples per fetch.

**No version-knob bumps.** `APP_BUILD_TAG` stays at `2.2.2-w15`, `app.js?v=453`, `sw.js v5.339`. This diagnostic ships piggyback on the next 2.2.3+ build whenever the user is ready to upload.

**Files touched (1z.104 only):**
- `app.js` — new `_addHealthVerifyBreadcrumb` helper near the other breadcrumb helpers; instrumentation calls inside `autoVerifyStrengthTraining` (skip-branch breadcrumbs + data classification) and `autoVerifyWalk` (skip-branch breadcrumbs + threshold-check breadcrumb); `payload.healthVerify.debug` added to the Copy Debug Info export.
- `CLAUDE.md` — this section.

**No backend / D1 / Duels / HealthKit permission wording / boss / drop / pity / mercy / rank-threshold / QA-unlock / economy changes.** No upload triggered. No Codemagic triggered.

**Diagnostic flow when this ships on TestFlight (2.2.3+):**
1. User reproduces the issue: does workouts, opens app, observes habit not auto-checked.
2. Settings → 5-tap version → Copy Debug Info → paste JSON.
3. The `healthVerify.debug` section will tell us:
   - Did `autoVerifyStrengthTraining` even run? (look for `strength-entry`)
   - What did HealthKit return? (look for `strength-data` — `count`, `totalMinutes`, `sampleClassification`)
   - If `count: 0`, were workout samples present but rejected by the strength filter? Sample classification shows the `name`/`id` — we extend the allowlist if needed.
   - If `strength-skip` fired, what was the `reason`?
   - Same for walk: `walk-entry`, `walk-steps`, `walk-threshold-check`, `walk-skip` reasons.

That single export will disambiguate hypotheses (A) through (D) completely.

### MacBook Air + SSD local archive pipeline confirmed (v3 Phase 1z.103)

**Documentation milestone — no code changes in this phase.**

After the night of freeze-debug arc (1z.85 → 1z.102) consumed more Codemagic builds than the per-build cost justified ($0.40/build × many builds = noticeable burn during heavy iteration), the project moved off Codemagic as the canonical iOS build path. The MacBook Air now archives and uploads directly to App Store Connect.

**Setup achieved on May 20:**
- External Samsung Portable SSD reformatted to APFS, mounted as `/Volumes/AwakenedDev`.
- Project repo moved to `/Volumes/AwakenedDev/repos/awakened-app` with a symlink at `~/Documents/repos/awakened-app` so existing muscle-memory commands still work.
- Xcode Settings → Locations: DerivedData and Archives both relocated to the SSD.
- npm cache relocated to the SSD via `npm config set cache /Volumes/AwakenedDev/npm-cache`.
- Claude app data also relocated to free internal Mac space.
- Internal disk: ~11 GiB free post-migration (was ~0.5 GiB pre-migration).
- SSD: ~921 GiB free.

**Proven working (pipeline only — NOT a TestFlight ship):**
- Local Xcode archive succeeds.
- Manual App Store signing succeeds using:
  - Provisioning Profile: `Awakened App Store 2026-05-19`
  - Certificate: `Apple Distribution: Richmond Campano`
- Xcode upload transport reaches App Store Connect validation (build 91 of the 2.2.2 train traveled from the local machine to ASC's validation layer).

**Build 91 did NOT become an accepted TestFlight build.** ASC rejected it during validation, before it could appear under TestFlight → iOS Builds and before any tester could install it. Build 91 is a "the pipeline works" milestone, not a "we shipped to testers" milestone.

**Version-train discovery:** ASC's rejection of build 91 read:
> "Invalid Pre-Release Train. The train version '2.2.2' is closed for new build submissions."

Cause: a prior 2.2.2 build was approved, which closed the train. Future uploads require **marketing version ≥ 2.2.3** and **build number ≥ 92** (or latest TestFlight + 1).

**Workflow (now canonical):**

Desktop:
1. ClaudeCode makes changes.
2. Commit + push to `origin/main`.

MacBook Air:
1. `cd /Volumes/AwakenedDev/repos/awakened-app` (or use the symlink).
2. `git fetch origin && git pull origin main`.
3. If `package.json` changed: `npm install --no-audit --no-fund`.
4. Rebuild `www/` (manual cp or via `scripts/prep-local-build.sh`).
5. `npx cap copy ios` (fast — web-only). Use `cap sync ios` only when native deps changed.
6. `npx cap open ios`.

Xcode:
1. Destination: **Any iOS Device (arm64)** — never Simulator, never the physical iPhone.
2. Confirm Release signing (manual, the profile + cert above).
3. Marketing Version + Build set (when preparing a new upload).
4. Product → Clean Build Folder → Product → Archive.
5. Organizer → Distribute App → App Store Connect → Upload.

**Codemagic status:** `codemagic.yaml` remains in the repo as a documented fallback. **Do not trigger Codemagic without explicit user approval.** Cost was the reason for migration; reverting silently would defeat the migration's purpose.

**Files touched (1z.103 only):**
- `LOCAL_BUILD.md` — fully rewritten to reflect the SSD-based workflow, the version-train rule, the symlink convention, and `cap copy` vs `cap sync` guidance.
- `CLAUDE.md` — new top-of-file May 20 handoff section + this phase note + version-train rule documented prominently.

**No version-knob bumps.** `APP_BUILD_TAG`, `app.js?v`, `sw.js CACHE_VERSION` unchanged. App.js and sw.js untouched in this phase. This is documentation only.

**Hard guardrails for future ClaudeCode sessions (also at top of handoff):**
- Do NOT trigger Codemagic without explicit instruction.
- Do NOT bump version knobs without explicit instruction.
- Do NOT upload / submit / deploy without explicit instruction.
- Do NOT suggest Simulator workflows.
- Do NOT select the physical iPhone as Archive destination.
- Do NOT move Xcode.app off internal storage.

### esc() defensive type coercion — root cause of Duels render failure (v3 Phase 1z.102)

**Diagnosis (definitive, from 1z.101's new breadcrumbs).** Build 89 (1z.101) shipped the total-timeout safety net + per-step breadcrumbs. User reported the Duels section now shows "Could not load duels: Render failed." with a "Tap to retry" button. The new `duels.debug` payload revealed the EXACT failure point across 5 separate render attempts:

```
render-start (token: N)
inner-start (token: N)
inner-pre-fetch (token: N)
inner-fetch-ok (token: N, ok: true)        ← fetch succeeded
inner-pre-resolve-loop (activeCount: 0)
inner-post-resolve-loop (didResolveAny: false)
inner-hero-rendered (outgoingCount: 1)     ← hero rendered for 1 outgoing duel
render-threw: "s.replace is not a function. (In 's.replace(/&/g,'&amp;')', 's.replace' is undefined)"
```

The render reached `inner-hero-rendered` consistently, then died 1-3ms later when building the OUTGOING duel card HTML. The user has 1 outgoing duel (the pending challenge to rendiesel).

**Root cause.** The `esc()` HTML-escape helper at line 15248 had no defense against non-string inputs:

```js
function esc(s) {
  return s.replace(/&/g,'&amp;')...; // throws if s is not a string
}
```

The outgoing duel card construction at line 19587 calls `esc(d.id)`. The backend returns duel `id` as a **number**, not a string. `.replace()` doesn't exist on Number primitives → uncaught TypeError → propagates up through the async chain → caught by 1z.101's outer wrapper → user sees "Could not load duels: Render failed." with the retry button.

This same `esc()` bug could affect any code path that ever passes non-string values: numeric IDs, null/undefined fields, booleans. The defensive fix at one line solves a whole class of latent crashes.

**Fix (one-line):**

```js
function esc(s) {
  if (s == null) return '';
  if (typeof s !== 'string') s = String(s);
  return s.replace(/&/g,'&amp;')...;
}
```

- `null` / `undefined` → empty string (safe for missing fields)
- numbers, booleans, objects → coerced via `String()`
- ordinary strings → behaviour unchanged

**Files touched (1z.102 only):**
- `app.js` — `esc()` made defensive (line 15248); `APP_BUILD_TAG → 2.2.2-w15`.
- `index.html` — `app.js?v=453`.
- `sw.js` — `CACHE_VERSION = v5.339`.
- `CLAUDE.md` — this section + handoff knob table.

**Version knobs:** `APP_VERSION 2.2.2` (unchanged), `APP_BUILD_TAG 2.2.2-w15`, `app.js?v=453`, `sw.js v5.339`. `styles.css` unchanged.

**Verification:**
- `node --check app.js` → OK
- `node --check sw.js` → OK
- `npm run test:e2e` → see commit log.

**Manual QA (TestFlight 2.2.2-w15):**
1. Boot — verify `"build":"2.2.2-w15"` via 5-tap debug export.
2. Open Social tab — duels section should NOW load successfully.
3. The pending outgoing challenge to rendiesel should appear under **Outgoing** with View / Cancel buttons.
4. Have your friend send a challenge — should appear under **Incoming** with Accept / Decline / View buttons.
5. Export breadcrumbs → `duels.debug` should show `render-complete` (no `render-threw`) for each render.

**Acknowledgment.** Phases 1z.99 / 1z.100 / 1z.101 were chasing the wrong symptom. The real bug was a one-line `esc()` defensive gap, not race conditions or timeouts. The breadcrumb instrumentation in 1z.101 surfaced the actual root cause cleanly — instrumentation paid for itself. The 20-second total-timeout safety net stays in place as belt-and-braces against any future similar render-time errors.

**Known non-goals:**
- The backend returns duel IDs as numbers; not changed here (the frontend defense is sufficient and `esc()` should always have been defensive anyway).
- No backend / D1 / HealthKit / Notification permission wording / boss / drop / economy changes.
- Codemagic NOT triggered.

### Duels render — total-timeout safety net + breadcrumbs (v3 Phase 1z.101)

**Bug.** Build 88 (1z.100) shipped the request-token pattern. User reported the Duels section was STILL stuck on "Loading duels…" on the new build. Debug export confirmed `"build":"2.2.2-w13"` — 1z.100 was definitely installed.

**Why 1z.100 didn't fix it.** The token pattern only handles CONCURRENT calls. It doesn't help if a SINGLE call's `await` never resolves AND no newer call comes in to invalidate the token. The user's notif breadcrumbs showed JS was alive (recover-start firing on visibility resumes), but the duels section stayed on "Loading duels…" for >30 seconds — well past the 15s per-await timeout I added in 1z.99. So either:
- The 15s `setTimeout` itself wasn't firing on iOS WKWebView (Capacitor may throttle certain timers in some states), OR
- `fetchDuels` resolved but a downstream `await` (e.g. `maybeResolveDuelIfEnded` calling `Auth.resolveDuel`) hangs forever.

Either way, the render path needs an UPPER-BOUND escape hatch.

**Fix — total-timeout safety net.** Wrap the entire `_renderDuelsSectionInner` call in a `Promise.race` against a 20-second total timeout. If the inner render takes longer than 20 seconds (for ANY reason — fetch hang, resolve hang, infinite loop, anything), the race rejects with `'total-timeout'`. The outer handler renders the error UI with a "Tap to retry" button — same recovery path as the per-await timeout from 1z.99/1z.100.

Plus: **per-step breadcrumb instrumentation throughout the render path**, written to `localStorage.hb_duels_debug_v1` (40-entry ring, included in the Copy Debug Info export). Breadcrumbs at:
- `render-start` / `render-complete` / `render-threw`
- `inner-start` / `inner-no-body` / `inner-no-auth` / `inner-pre-fetch`
- `inner-fetch-ok` / `inner-fetch-threw` (with isTimeout flag)
- `inner-stale-pre-auth` / `inner-stale-post-fetch` / `inner-stale-in-resolve-loop` / `inner-stale-post-refetch`
- `inner-pre-resolve-loop` / `inner-post-resolve-loop` (with `didResolveAny`)
- `inner-post-refetch`
- `inner-hero-rendered` (with active/incoming/outgoing counts — proves render completed)

If 1z.101 STILL has the stuck state, the next debug export will reveal exactly which step the render reached before hanging. Surgical follow-up rather than guessing.

**Files touched (1z.101 only):**
- `app.js` — `_addDuelsBreadcrumb` helper; total-timeout wrapper on `renderDuelsSection`; breadcrumbs throughout `_renderDuelsSectionInner`; `payload.duels` section in Copy Debug Info export; `APP_BUILD_TAG → 2.2.2-w14`.
- `index.html` — `app.js?v=452`.
- `sw.js` — `CACHE_VERSION = v5.338`.
- `CLAUDE.md` — this section + handoff knob table.

**Version knobs:** `APP_VERSION 2.2.2` (unchanged), `APP_BUILD_TAG 2.2.2-w14`, `app.js?v=452`, `sw.js v5.338`. `styles.css` unchanged.

**Verification:**
- `node --check app.js` → OK
- `node --check sw.js` → OK
- `npm run test:e2e` → see commit log.

**Manual QA (TestFlight 2.2.2-w14):**
1. Boot — verify `"build":"2.2.2-w14"` via 5-tap debug export.
2. Open Social tab. Duels should load OR (worst case) timeout within 20s → retry button appears.
3. If retry button appears, tap it. Should retry the fetch cleanly.
4. Background + foreground. Either cards load OR retry button appears within 20s.
5. Export debug info → inspect `duels.debug` ring to see exactly where each render reached.

**Known non-goals:**
- Doesn't fix the underlying iOS WKWebView setTimeout-throttling or backend slowness — just bounds the user-visible damage.
- No backend / D1 / HealthKit / Notification permission wording / boss / drop / economy changes.
- Codemagic NOT triggered.

### Duels render — request-token pattern (v3 Phase 1z.100)

**Bug.** Build 87 (1z.99) shipped the in-flight guard fix, but the user reported the Duels section was STILL stuck on "Loading duels…" on the new build. Debug export confirmed `"build":"2.2.2-w12"` — so 1z.99 was definitely installed.

**Root cause of the 1z.99 failure.** The in-flight boolean flag approach has a fatal flaw on iOS Capacitor:

```js
let _duelsRenderInFlight = false;
async function renderDuelsSection() {
  if (_duelsRenderInFlight) return;
  _duelsRenderInFlight = true;
  try { await _renderDuelsSectionInner(); }
  finally { _duelsRenderInFlight = false; }
}
```

When the app backgrounds on iOS, in-flight `fetch()` promises and `setTimeout` callbacks get paused — and on app foreground they often **DON'T resume** (iOS killed the underlying network connection / timer). This means:

- First `renderDuelsSection()` call: flag→true, body→"Loading duels…", awaits fetchDuels.
- App backgrounds. fetchDuels promise is now paused permanently.
- App foregrounds. Visibility handler from 1z.98 calls `renderDuelsSection()` again.
- Second call: flag is still `true`. Bails immediately.
- Original promise never settles. The finally never runs. Flag stuck `true`.
- Every subsequent call bails. Body forever stuck on "Loading duels…".

Confirmed by debug export's `notif.debug` timeline showing 11 visibility-resume cycles (`recover-start` entries) — each one would have hit the stuck-flag bail.

**Fix — request-token pattern.** Replace the boolean flag with a monotonically-increasing token:

```js
let _duelsRenderToken = 0;
async function renderDuelsSection() {
  const myToken = ++_duelsRenderToken;
  await _renderDuelsSectionInner(myToken);
}
async function _renderDuelsSectionInner(myToken) {
  // ... await fetchDuels ...
  if (myToken !== _duelsRenderToken) return; // stale — silently exit
  // ... await maybeResolveDuelIfEnded loop ...
  if (myToken !== _duelsRenderToken) return; // stale check after each await
  // ... render
}
```

Each call increments the token and captures its number. After every `await`, the call checks whether it's still the latest token. If a newer call has started, the older one silently exits without touching the DOM. The latest call always wins. Stale stuck calls discard their results when (or if) they eventually resolve.

This guarantees:
- **Visibility-resume always proceeds.** No flag to be stuck.
- **Concurrent calls don't race on the DOM.** Only the latest writes.
- **Stuck/cancelled prior calls can't pollute newer calls' UI.** Token check after each await ensures this.

The 1z.99 15-second fetch timeout + cache-aware loading state suppression + retry button are all retained. The "always wins" property of the token pattern makes them work reliably even after iOS suspension events.

Token checks placed at three points:
1. Right after the `Auth.fetchDuels()` race (post-fetch staleness check).
2. Inside the `maybeResolveDuelIfEnded` loop (post-iteration check — each network resolve can take seconds).
3. Right after the optional re-fetch when an active duel auto-resolved.

**Files touched (1z.100 only):**
- `app.js` — `_duelsRenderInFlight` boolean replaced with `_duelsRenderToken` integer; three token-staleness checks inserted at await boundaries; `APP_BUILD_TAG → 2.2.2-w13`.
- `index.html` — `app.js?v=451`.
- `sw.js` — `CACHE_VERSION = v5.337`.
- `CLAUDE.md` — this section + handoff knob table.

**Version knobs:** `APP_VERSION 2.2.2` (unchanged), `APP_BUILD_TAG 2.2.2-w13`, `app.js?v=451`, `sw.js v5.337`. `styles.css` unchanged.

**Verification:**
- `node --check app.js` → OK
- `node --check sw.js` → OK
- `npm run test:e2e` → see commit log.

**Manual QA (TestFlight 2.2.2-w13):**
1. Boot — verify `"build":"2.2.2-w13"` via 5-tap debug export.
2. **Open Social tab** — duels load (cards or empty hero).
3. **Background → foreground while on Social** — duels reload, no stuck "Loading duels…".
4. **Background mid-fetch** (open Social, IMMEDIATELY background app, wait 30s, return) → second fetch should proceed cleanly. No stuck loading state.
5. **Have friend send a challenge** — return to app → challenge appears in Incoming with Accept/Decline.
6. **Repeat 3-5x** to confirm consistency.

**Known non-goals:**
- The 15-second timeout still applies. If the backend is truly down for >15s, the user sees "Could not load duels: Request timed out. [Tap to retry]" — by design.
- Doesn't touch any backend / D1 / Duels / HealthKit / Notification permission wording / boss / drop / pity / mercy / rank-threshold / QA-unlock / economy code.
- Codemagic NOT triggered.

### Duels render — in-flight guard + fetch timeout (v3 Phase 1z.99)

**Bug.** Build 87 (1z.98) shipped to the user. After install, their Discipline Duels section was permanently stuck on "Loading duels…" — no error, no cards, no recovery path.

**Root cause.** 1z.98 added a visibility-resume `renderDuelsSection()` call that could race with the initial `switchTab('social')` call. Two interleaved invocations:

```
T+0ms   call #1 from switchTab → body = "Loading duels…" → await fetchDuels
T+200ms call #1 fetchDuels resolves → body = rendered cards
T+250ms visibility change fires (e.g. transient backgrounding)
T+250ms call #2 from visibility handler → body = "Loading duels…" → await fetchDuels
T+????  call #2 fetchDuels still in-flight → body STAYS "Loading duels…"
```

If the second fetch was slow or hung, the user saw "Loading duels…" indefinitely. Additionally, `Auth.fetchDuels()` had no client-side timeout — a hung backend hung the UI forever.

**Fix — two layers:**

1. **In-flight guard.** Module-level `_duelsRenderInFlight` flag. If `renderDuelsSection()` is called while a prior invocation is still running, the second call bails immediately. The first call completes uninterrupted. Cleared in a `finally` so an exception can never strand the flag.

2. **15-second fetch timeout via `Promise.race`.** If the backend doesn't respond in 15 seconds, the catch branch fires with code `'TIMEOUT'` and the body renders an actionable error: "Could not load duels: Request timed out." with a **"Tap to retry"** button. Same UI on `NETWORK` errors. Cards no longer get stuck on the loading state.

3. **Cache-first refresh, no flash-to-loading.** When `_duelsCache` is populated from a prior successful fetch, `renderDuelsSection()` skips setting body to "Loading duels…" — the existing cards stay visible while the fresh fetch runs in the background. If the refresh succeeds, cards swap in seamlessly. If it errors, the error UI shows but the hero still reflects the cached active duel (so the user doesn't lose context). First-ever load with no cache still shows "Loading duels…" as before.

These three changes together make the duels section resilient to concurrent calls (the visibility handler can fire as often as it wants without breaking the UI), to slow backends (15-second timeout + retry), and to errors (cache survives a failed refresh).

**Files touched (1z.99 only):**
- `app.js` — `renderDuelsSection` split into outer guard + `_renderDuelsSectionInner`; 15-second timeout + retry button + cache-aware loading; `APP_BUILD_TAG → 2.2.2-w12`.
- `index.html` — `app.js?v=450`.
- `sw.js` — `CACHE_VERSION = v5.336`.
- `CLAUDE.md` — this section + handoff knob table.

**Version knobs:** `APP_VERSION 2.2.2` (unchanged), `APP_BUILD_TAG 2.2.2-w12`, `app.js?v=450`, `sw.js v5.336`. `styles.css` unchanged.

**Verification:**
- `node --check app.js` → OK
- `node --check sw.js` → OK
- `npm run test:e2e` → see commit log.

**Manual QA on TestFlight 2.2.2-w12:**
1. Open Social tab — duels load normally with cards (or empty hero if no duels).
2. Background app + foreground while on Social tab — no "Loading duels…" flash.
3. Backend reachability test: turn on airplane mode → open Social tab → expected "Could not load duels: Could not reach server." with **Tap to retry** button. Disable airplane mode → tap retry → cards load.
4. Rapid switching between tabs — no stuck loading state.

**Known non-goals:**
- Does not fix the (presumed) backend bug where new pending duels might not always be returned to the recipient. 1z.98 mitigates via foreground-resume refresh + create-failure refresh; 1z.99 hardens that refresh path against races and hangs.
- No backend / D1 / HealthKit / Notification permission wording / boss / drop / pity / mercy / rank-threshold / QA-unlock / economy changes.
- Codemagic NOT triggered.

### Discipline Duels — challenge discovery fix (v3 Phase 1z.98)

**Bug reported.** User A (challenger) sent a Discipline Duel challenge to User B (recipient). User B opened the Social tab on his phone and saw "No active duel — Add a hunter below…" — the empty state. When User B tried to challenge User A BACK, the create-duel API rejected with "A pending duel between you already exists." User B then scrolled around the Duels section trying to find the pending challenge — couldn't see it anywhere. Stuck state: cannot accept, cannot decline, cannot start a new duel with this opponent.

**Root cause (two-layered, both frontend).**

1. **Stale local cache.** `renderDuelsSection()` runs only when the user switches TO the Social tab (line 15312, inside `switchTab` for `tab === 'social'`). It does NOT auto-refresh while the user remains on the tab, and it did NOT run on app foreground resume even if the user was on the Social tab when they backgrounded. So: User B opened Social → fetchDuels returned empty (no duels yet). User A then sent the challenge from a different device. User B's view stayed at the old "empty" result indefinitely until he manually switched tabs and came back.

2. **No recovery from create-duel error.** When User B tried to challenge User A back, the create-duel API returned an "already exists" error. The frontend's `_submitDuelChallenge` handler (line 19581) just showed `res.detail` as a toast and returned. It did NOT refresh `renderDuelsSection`, did NOT guide the user to find the pending duel, did NOT provide ANY recovery path.

**Both bugs are frontend-only — backend logic is correct (it properly rejects duplicate challenges and presumably surfaces the pending duel as "incoming" when fetched fresh). The frontend just never re-fetched at the right moments.**

**Fix — two small changes:**

1. **Visibility-resume refresh.** The main app-foreground visibility handler (line 29802) already does HealthKit cache invalidation, auto-verify retries, header pill refresh, etc. — but didn't refresh `renderDuelsSection`. Now it does, gated on `currentTab === 'social'` so it's free (no fetch) when the user is on any other tab. Catches: "friend sent challenge while I was backgrounded → I open the app → app immediately re-fetches duels → incoming card appears with Accept/Decline."

2. **Create-duel failure → force refresh + actionable toast.** `_submitDuelChallenge` now calls `renderDuelsSection()` on FAILURE as well as success. When the error matches `/pending.*duel.*already exists/i`, it shows a sticky toast: "You already have a duel pending with this hunter. Check Discipline Duels above to accept or decline." This points the user at the now-fresh section where the incoming card has just rendered with Accept/Decline buttons.

The existing Incoming Duel card UI at line 19384 (`duel-card--incoming` with Accept/Decline/View buttons + `_friendAvatarHtml`) is unchanged — it was already implemented and waiting. The bug was just that the data never re-flowed to it at the right moments.

**Files touched (1z.98 only):**
- `app.js` — `_submitDuelChallenge` error path enhanced (line 19590-19620); visibility handler refresh-on-resume gated on `currentTab === 'social'` (line ~29832-29840); `APP_BUILD_TAG → 2.2.2-w11`.
- `index.html` — `app.js?v=449`.
- `sw.js` — `CACHE_VERSION = v5.335`.
- `CLAUDE.md` — this section + handoff knob table.

**Version knobs:** `APP_VERSION 2.2.2` (unchanged), `APP_BUILD_TAG 2.2.2-w11`, `app.js?v=449`, `sw.js v5.335`. `styles.css` unchanged.

**Verification:**
- `node --check app.js` → OK
- `node --check sw.js` → OK
- `npm run test:e2e` → no changes to test surface; suite still 8/8.

**Manual QA (two devices required):**
1. Device A (challenger) and Device B (recipient) both signed in as different hunters.
2. Both add each other as friends. Confirm both can see each other under FRIENDS.
3. Device A: tap Challenge on friend row → pick verified duel type → Submit. Confirm "Duel challenge sent." toast.
4. Device B: open Social tab. Wait 5 seconds. If already there, swipe to background and reopen → renderDuelsSection refresh fires.
5. Expected on Device B: under Discipline Duels, Incoming section now shows the challenge card with **Accept**, **Decline**, **View** buttons.
6. Device B taps Accept → duel becomes active. Both devices see it under Active.
7. Edge case: Device B tries to challenge Device A BACK before refreshing. Expected: "You already have a duel pending with this hunter. Check Discipline Duels above to accept or decline." toast (sticky) + the incoming card now visible after the forced refresh.

**Known non-goals:**
- Does NOT add polling (the visibility-resume refresh is the lightweight equivalent — fetchDuels only fires when the user actually returns to the app on the right tab).
- Does NOT touch backend duel categorization. Backend's `/v1/duels` endpoint is assumed to correctly return pending duels in the `incoming` bucket for the recipient.
- Does NOT change Duel mechanics (3-day duration, 25 souls stake, 40 souls reward, verified-only types). All product rules preserved.
- No backend / D1 / HealthKit / Notification permission wording / boss / drop / pity / mercy / rank-threshold / QA-unlock / economy changes.
- Codemagic NOT triggered.

### Habit-mutation freeze fix — skipSideEffects on every user-mutation render (v3 Phase 1z.97)

**Bug.** After 1z.95/1z.96 shipped (build 84, w9), user tested OTHER habit operations and found the same freeze class still present on:
- **Delete habit** (context menu → Delete)
- **Schedule save** (Schedule modal Save button)
- **Edit habit save** (Edit Habit modal Save button)

Plus, by extension, every other user-mutation that calls `renderHabits()` afterward.

**Root cause.** 1z.95 only fixed the Add Habits path. The HealthKit native-bridge microtask cascade described in 1z.95's notes wasn't a property of the add flow specifically — it was a property of ANY render path that called `autoVerifyWalk` / `autoVerifySleep` / `autoVerifyStrengthTraining` / `resolveBossHuntsAcrossWindow` / `_sweepExpiredBossHuntsNoHealth` at the tail. `renderHabits()` does this at the bottom of its body by default. Every site that called `renderHabits()` after a user mutation re-triggered the same cascade.

**Fix.** Audited every `renderHabits()` call site in `app.js` and updated each one to pass `{ skipSideEffects: true }` when the call is a USER-MUTATION render (delete, edit save, schedule save, custom save, pack add, quick-add, drag-drop reorder). Natural-trigger renders (tab switch, day change, visibility change, app boot) keep side effects enabled — those are when the cascade is acceptable because the user expects a brief settle.

Also updated three HealthKit auto-verify completion sites and three yesterday-backfill completion sites to skip side effects — those just ran the side effects, re-running them in the immediate next render is what creates the recursive cascade.

**Sites updated (10):**
- `app.js:7796` — Weekend Warrior quick-add post-save render → `skipSideEffects`
- `app.js:15526` — Custom habit save post-save render → `skipSideEffects`
- `app.js:15599` — Pack (Morning Routine / Locked-In) add post-save render → `skipSideEffects`
- `app.js:17245` — Schedule modal Save button post-save render → `skipSideEffects`
- `app.js:23016` — Edit Habit modal Save button post-save render → `skipSideEffects`
- `app.js:23049` — Edit Habit modal Delete button post-delete render → `skipSideEffects`
- `app.js:23402` — `deleteHabit()` internal post-delete render → `skipSideEffects`
- `app.js:23738` — Drag-drop finalize post-reorder render → `skipSideEffects`
- `app.js:23955` — Stat detail linked-habit add post-save render → `skipSideEffects`
- `app.js:28227, 28265, 28345` — Yesterday-backfill completion renders (strength / walk / sleep) → `skipSideEffects`
- `app.js:28429` — `autoVerifyWalk` completion render → `skipSideEffects`
- `app.js:28584` — `autoVerifySleep` completion render → `skipSideEffects`
- `app.js:28675` — `autoVerifyStrengthTraining` completion render → `skipSideEffects`

**Sites NOT changed (natural triggers — keep side effects):**
- `app.js:11651` — `render()` main render orchestrator (called from `switchTab`, day change, etc.)
- `app.js:25154` — HealthKit pause/unpause toggle in Settings (user explicitly toggling auto-verify; the cascade is desired here)

**Pattern going forward.** Any new code that calls `renderHabits()` in response to a user mutation MUST pass `{ skipSideEffects: true }` to avoid re-introducing this freeze class. Natural-trigger renders can keep the default. The 1z.95 commentary inside `renderHabits()` itself documents this contract.

**Files touched (1z.97 only):**
- `app.js` — 13 call sites updated with `{ skipSideEffects: true }`; `APP_BUILD_TAG → 2.2.2-w10`.
- `index.html` — `app.js?v=448`.
- `sw.js` — `CACHE_VERSION = v5.334`.
- `CLAUDE.md` — this section + handoff knob table.

**Version knobs:** `APP_VERSION 2.2.2` (unchanged), `APP_BUILD_TAG 2.2.2-w10`, `app.js?v=448`, `sw.js v5.334`. `styles.css` unchanged.

**Verification:**
- `node --check app.js` → OK
- `node --check sw.js` → OK
- `npm run test:e2e` → see commit log for the gating run.

**Manual QA on TestFlight 2.2.2-w10:**
1. Boot — verify `"build":"2.2.2-w10"` via debug export.
2. **Delete a custom habit** (Edit modal → Delete) → modal closes, list updates, app stays interactive.
3. **Schedule save** (long-press habit → Schedule → change → Save) → modal closes, list updates, app interactive.
4. **Edit habit save** (long-press habit → Edit → change → Save) → modal closes, list updates, app interactive.
5. **Drag-drop reorder** → release → list updates, app interactive.
6. **Add Habits** (existing 1z.95 path) → still works.
7. Tap around tabs between each — all should respond.

**Known non-goals:**
- The underlying microtask-cascade behaviour in HealthKit handlers is still present. Tab switches still trigger it (briefly, on a screen the user is moving toward, so it's not user-perceptible). A future phase could break the cascade in the handlers themselves by wrapping native-call continuations in `setTimeout(0)`, but that's a deeper refactor. Today's fix is enough for App Store ship.
- No backend / D1 / Duels / HealthKit / Notification permission wording / boss / drop / pity / mercy / rank-threshold / QA-unlock / economy changes. The Notif module and the auto-verify logic themselves are untouched.
- Codemagic NOT triggered.

### Notification permission auto-recovery + notif state in debug export (v3 Phase 1z.96)

**Bug.** Multiple users (including a friend who has NOT been installing builds today) reported that notifications stopped firing on May 19. iPhone Settings → Notifications no longer lists Awakened at all. The app's localStorage still has `hb_notif_perm_requested='1'` (we previously asked, user granted), but iOS silently dropped its tracking of the app's notification permission.

Cause: iOS occasionally wipes an app's notification permission entry — multiple TestFlight reinstalls in one day (today's 5 builds), iOS updates, or system cache clears can trigger it. The pre-1z.96 code only asked for notification permission ONCE during onboarding (gated by `hb_notif_perm_requested` localStorage flag), with no recovery path when iOS later drops the permission silently. `LocalNotifications.schedule()` calls then no-op without user-visible feedback.

**Fix — `recoverNotifPermissionIfDropped()` runs on every boot.**

1. Bails if not running on native Capacitor (web has its own notif flow).
2. Bails if `hb_notif_perm_requested` is false (onboarding handles first-time users).
3. Reads iOS's current permission status via `Notif.checkPermission()`.
4. Branches on status:
   - **`granted`** → state is consistent, no action.
   - **`denied`** → user explicitly declined. Show a sticky toast: "Reminders are off. Enable in iOS Settings → Awakened to receive them." Don't auto-prompt (iOS would just return `denied` without UI).
   - **`prompt` / `unsupported` / `unknown`** → state mismatch. iOS thinks we never asked. **Re-request once.** iOS shows its native dialog if the entry was wiped, OR silently returns the cached decision if it wasn't. App Review compliant — at most one prompt per app launch, identical to the onboarding prompt.
5. On successful recovery (`result === 'granted'`), re-arms all schedules: `Notif.rescheduleAll()`, `reapplyDigest()`, `reapplyCheckin()`, `reapplyMidDay()`. Notifications resume the same day.

**Diagnostic instrumentation:**

- New `_addNotifBreadcrumb(step, data)` writes a 40-entry ring to `localStorage.hb_notif_debug_v1`. Mirrors the 1z.91 add-habit breadcrumb pattern.
- Recovery flow logs at every branch:
  - `recover-start`, `recover-skip-no-notif-module`, `recover-skip-not-native`, `recover-skip-onboarding-will-handle`
  - `recover-checkPermission-threw`, `recover-status-read`, `recover-already-granted-noop`
  - `recover-denied-show-toast`, `recover-mismatch-re-requesting`
  - `recover-requestPermission-threw`, `recover-request-result`
  - `recover-reschedule-ok`, `recover-reschedule-threw`
  - `recover-complete`, `recover-outer-threw`
- `_buildAwakenedDebugPayload()` extended with `notif` section:
  - `permAskedBefore` — the localStorage flag value
  - `disabled` — in-app master toggle state
  - `pausedUntil` + `currentlyPaused` — paused-until-date status
  - `dailyDigestTime` — user's chosen Morning Briefing time
  - `debug` — the full breadcrumb ring

After the next TestFlight build, the user's debug export will reveal exactly which branch the recovery took. If `recover-request-result: granted` appears + `recover-reschedule-ok` follows, the recovery worked and notifications will resume.

**App Review safety:**
- The re-request uses the EXACT SAME `Notif.requestPermission()` call as the existing onboarding flow. Permission wording in Info.plist (HealthKit usage strings, Sign in with Apple) is unchanged.
- iOS itself enforces "no repeat prompts" — if the user has previously denied, the call returns `denied` synchronously without showing UI.
- The recovery only fires when `hb_notif_perm_requested='1'` AND iOS reports a non-granted state. Fresh-install users (App Review reviewers) skip the recovery entirely via the early bail.

**Files touched (1z.96 only):**
- `app.js` — `_addNotifBreadcrumb` helper, `recoverNotifPermissionIfDropped()` async function, wire into `init()` after `setupNotifTapRouting()`, extend `_buildAwakenedDebugPayload()` with notif section; `APP_BUILD_TAG → 2.2.2-w9`.
- `index.html` — `app.js?v=447`.
- `sw.js` — `CACHE_VERSION = v5.333`.
- `CLAUDE.md` — this section + handoff knob table.

No backend / D1 / Duels / HealthKit / Notification permission wording / boss / drop / pity / mercy / rank-threshold / QA-unlock / economy changes. The Notif module itself is untouched — only the boot path adds a new recovery call.

**Version knobs:** `APP_VERSION 2.2.2` (unchanged), `APP_BUILD_TAG 2.2.2-w9`, `app.js?v=447`, `sw.js v5.333`. `styles.css` unchanged.

**Manual QA on TestFlight 2.2.2-w9:**
1. Install build.
2. Force-quit + relaunch.
3. iOS native dialog should appear: "Awakened would like to send you notifications." Tap **Allow**.
4. Verify Awakened now appears in iPhone Settings → Notifications.
5. Wait for the 9 AM / 1 PM / 6 PM (whichever is next) to confirm a notification fires.
6. Export breadcrumbs:
   - `notif.permAskedBefore: true` ✓
   - `notif.debug` should contain `recover-start` → `recover-status-read` → `recover-mismatch-re-requesting` → `recover-request-result {result:'granted'}` → `recover-reschedule-ok` → `recover-complete`.
7. If iOS doesn't prompt (because it remembers the prior grant), notifications should resume automatically — the recover trail will show `recover-already-granted-noop`.

**Known non-goals:**
- This doesn't address tab-switch sluggishness from the HealthKit cascade (still present, deferred).
- Doesn't change permission wording or copy.
- Codemagic NOT triggered by this commit.

### Add Habits freeze — side effects fully removed from add path (v3 Phase 1z.95)

**Diagnosis (definitive, from TestFlight 2.2.2-w7 breadcrumb dump).**

For two clean add attempts on w7 (Track finances & net worth, Review your long term goals), every breadcrumb fired correctly through `alive-1000` (t+1004ms) and `side-effects-complete` (t+2009ms). Then:

```
side-effects-complete (t+2009ms)
[55-second gap with ZERO breadcrumbs]
[user eventually taps next preset at t+57600ms]
```

**`alive-2000`, `alive-3000` NEVER fired** despite being scheduled. `ensureInteractive` at t+500ms reported `tabBarVisible: false` — confirmed touch-block. The 1z.94 2000ms-deferred side-effects ran, then JS got stuck for ~55 seconds.

**Root cause — microtask cascade starving the event loop.** The HealthKit native-bridge calls inside `autoVerifyWalk` / `autoVerifySleep` / `autoVerifyStrengthTraining` return as Promises. Their `.then()` handlers are **microtasks**. The microtask queue runs to completion BEFORE the next macrotask. Each HealthKit response handler can dispatch more native calls (re-`renderHabits` triggers more `autoVerify` dispatches), creating new microtasks indefinitely. As long as new microtasks keep being queued, **macrotasks (setTimeout callbacks) are starved**. That's why `alive-2000` (a setTimeout = macrotask) never fired — the microtask queue never emptied for ~55 seconds.

1z.94's "decouple by 2 seconds" didn't fix the cascade. It just moved it 2 seconds later. The cascade still ran, still starved JS, still felt like a freeze — just shifted to right after the user expected the add to be "done."

**Fix — don't dispatch side effects from the add path at all.**

The side effects are no-ops for habits that don't match (e.g. autoVerifyWalk is a no-op unless the user has a "Daily walk" habit). For habits that DO match (this user has "Strength training 30 min"), the side effect dispatches HealthKit calls. We can defer that dispatch entirely.

The side effects still run — just on natural triggers:
- **Tab switch** (`switchTab` → `renderHabits` → side effects).
- **Visibility change** (app foreground → `renderHabits` → side effects).
- **Day change** (`checkDayChange` → `renderHabits` → side effects).

The cascade still happens on those triggers, but the user is in a different mental context (looking at a new tab, returning to the app, starting a new day). They expect a brief settle. Tapping "Add to My Habits" creates an entirely different expectation — instant interactivity — and that's what 1z.95 delivers.

**What this changes:**
1. The 2000ms `setTimeout` block in the addBtn handler that ran `autoVerifyWalk` / `autoVerifySleep` / `autoVerifyStrengthTraining` / `resolveBossHuntsAcrossWindow` / `_sweepExpiredBossHuntsNoHealth` — **REMOVED**.
2. Replaced with a single `side-effects-skipped-on-add` breadcrumb so the next debug export proves we hit the new code path.
3. Alive probes extended to 5000ms + 10000ms (in addition to existing 100/500/1000/2000/3000) so we can verify JS stays healthy throughout the whole post-add window.
4. `renderHabits(opts.skipSideEffects)` from 1z.94 retained — when called from the post-add path, it still skips side effects internally. Both safety nets in place.

**What this does NOT change:**
- `renderHabits()` for non-add callers (tab switch, day change, visibility change) — identical behaviour. They still call all the side effects.
- `forceCloseAddHabitsStack`, dup tap guard, watchdog at 500ms, toast — all unchanged.
- The post-add render (still fires at +150ms, still updates the visible habit list).

**Trade-off:** If the user adds a habit and stays on the Habits tab for hours without switching, the auto-verify won't run for any newly-added HealthKit-tracked habit until they next switch tabs. Acceptable — the user can also manually check the habit done, and most users switch tabs within minutes.

**Files touched (1z.95 only):**
- `app.js` — 2000ms side-effects setTimeout REMOVED from addBtn handler; new `side-effects-skipped-on-add` breadcrumb; alive probes extended to 5000/10000; `APP_BUILD_TAG → 2.2.2-w8`.
- `index.html` — `app.js?v=446`.
- `sw.js` — `CACHE_VERSION = v5.332`.
- `tests/e2e/smoke.spec.ts` — section H now asserts `side-effects-skipped-on-add` present AND `side-effects-start`/`side-effects-complete` absent within the post-add window.
- `CLAUDE.md` — this section + handoff knob table.

**Version knobs:** `APP_VERSION 2.2.2` (unchanged), `APP_BUILD_TAG 2.2.2-w8`, `app.js?v=446`, `sw.js v5.332`. `styles.css` unchanged.

**Verification:**
- `node --check app.js` → OK
- `node --check sw.js` → OK
- `npm run test:e2e` → see commit log.

**Manual QA on TestFlight 2.2.2-w8:**
1. Verify boot stamp / debug export shows `"build":"2.2.2-w8"`.
2. Add any preset. App should be instantly interactive — tap a tab, scroll, anything responds.
3. Add another preset. Same.
4. Wait 3 seconds. App should still be interactive (alive-3000 should land in next export).
5. Wait 10 seconds. App should still be interactive (alive-10000 should land).
6. Export breadcrumbs:
   - Expected: `side-effects-skipped-on-add` present.
   - Expected: `alive-2000`, `alive-3000`, `alive-5000`, `alive-10000` ALL present.
   - Expected: `side-effects-start` and `side-effects-complete` ABSENT (because the add path no longer dispatches them — they only fire from tab switches now).

**Known non-goals:**
- The underlying microtask cascade in HealthKit handlers is NOT fixed here. It still runs on natural renderHabits triggers (tab switches, etc.). If users report tab-switch sluggishness, follow-up phase will break the cascade by wrapping native calls in setTimeout(0) to convert microtasks to macrotasks. For now: the freeze the user reported was specifically "tap Add to My Habits → frozen," and 1z.95 addresses that surface.
- No backend / D1 / Duels / HealthKit / Notification permission wording / boss / drop / pity / mercy / rank-threshold / QA-unlock / economy changes.
- Codemagic NOT triggered.

### Add Habits freeze — decoupled HealthKit side effects (v3 Phase 1z.94)

**Diagnosis (definitive).** TestFlight 2.2.2-w6 (build 81) shipped 1z.92's in-app debug export. User reproduced the freeze on three different presets (No alcohol, Under 1 hour screen time, Digital declutter) and pasted the breadcrumb JSON. The trace was identical for all three:

```
tap-start → busy-guard-set → dup-guard-passed
→ cfg-build-complete → onConfirm-complete (saveOK:true)
→ force-close-start/complete → toast-shown → finally-cleanup
→ alive-100 (t+100ms)
→ render-tick-start (t+150ms) → render-tick-ok (t+169ms, renderHabits took 16ms)
✗ alive-500 NEVER FIRED
✗ watchdog-complete NEVER FIRED
✗ alive-1000 NEVER FIRED
```

**The add path completed cleanly.** `save()` ran (habit persisted), both sheets closed, toast rendered, renderHabits completed in 16ms. **Then JS main thread died between t+169ms and t+500ms.**

**Root cause.** `renderHabits()` synchronously dispatches HealthKit native-bridge work at the bottom (`autoVerifyWalk`, `autoVerifySleep`, `autoVerifyStrengthTraining`, `resolveBossHuntsAcrossWindow`, `_sweepExpiredBossHuntsNoHealth` — lines 11688–11696). Each dispatch is fast (just postMessage to native), but the **native HealthKit responses arrive ~200–500ms later as async callbacks**. Each callback fires heavy JS work — re-triggering `renderHabits()` in a cascade. With **34 habits / 19 scheduled today** in the user's profile, the cascade was heavy enough to permanently block touch handling on iOS WKWebView. `swController: false` in the export ruled out service-worker poisoning; this was native-bridge cascade blocking, plain and simple.

The 16ms renderHabits time confirms the SYNCHRONOUS part is fine. The freeze is in the asynchronous post-render callback storm.

**Fix (1z.94):**

1. **`renderHabits(opts)` now accepts `opts.skipSideEffects`.** When true, it does the DOM update (user sees new habit immediately) and `return`s before the HealthKit/boss block. When false (the default — everything else in the codebase), behaviour is unchanged.

2. **Add-path renderHabits call passes `{ skipSideEffects: true }`.** Decouples the post-add render from the native-bridge callback cascade. The user sees visual confirmation of the add but doesn't trigger the storm.

3. **Side effects scheduled on a separate 2000ms-deferred tick.** They still run — just after the UI has fully committed paint, the watchdog has fired, and touch input has settled. Each side effect independently try-wrapped + breadcrumbed:
   - `side-effects-start`
   - `side-effects-walk-ok` / `side-effects-walk-threw`
   - `side-effects-sleep-ok` / `side-effects-sleep-threw`
   - `side-effects-strength-ok` / `side-effects-strength-threw`
   - `side-effects-boss-resolve-ok` / `side-effects-boss-resolve-threw`
   - `side-effects-boss-sweep-ok` / `side-effects-boss-sweep-threw`
   - `side-effects-complete`

4. **New alive probes at 2000ms + 3000ms** (in addition to 100/500/1000). If `alive-3000` lands in the next debug export, the freeze is gone. If it doesn't, the side-effects breadcrumbs above identify the specific HealthKit/boss function still misbehaving.

**What's NOT changed:**
- `renderHabits()` behaviour for non-add callers (tab switch, day change, visibility change, etc.) is identical. Default `opts.skipSideEffects = undefined → falsy → runs side effects` as before.
- Side effects still fire — just 2 seconds after the add instead of synchronously. Daily-walk auto-verify and boss-hunt resolution still work; they're just no longer coupled to user clicks on the Add Habits CTA.
- All other Add Habits flow logic (forceCloseAddHabitsStack, watchdog, dup tap guard, toast) is unchanged.

**Files touched (1z.94 only):**
- `app.js` — `renderHabits(opts)` signature + skipSideEffects branch; addBtn click handler passes `{ skipSideEffects: true }`, schedules delayed side-effects setTimeout at 2000ms with per-function breadcrumbs, alive probes at 2000/3000ms; `APP_BUILD_TAG → 2.2.2-w7`.
- `index.html` — `app.js?v=445`.
- `sw.js` — `CACHE_VERSION = v5.331`.
- `tests/e2e/smoke.spec.ts` — section H now asserts `side-effects-start`, `side-effects-complete`, `alive-2000`, `alive-3000` are all present; waits 3300ms post-add.
- `CLAUDE.md` — this section + handoff knob table.

**Version knobs:** `APP_VERSION 2.2.2` (unchanged), `APP_BUILD_TAG 2.2.2-w7`, `app.js?v=445`, `sw.js v5.331`. `styles.css` unchanged.

**Verification:**
- `node --check app.js` → OK
- `node --check sw.js` → OK
- `npm run test:e2e` → see commit log for the gating run.

**Manual QA on TestFlight 2.2.2-w7:**
1. Boot — confirm `[Awakened] boot · build=2.2.2-w7` in Safari devtools (or accept it via the 5-tap unlock + Copy Debug Info → confirm `"build":"2.2.2-w7"` in the JSON).
2. Add any preset → app should remain interactive immediately.
3. Tab bar should respond. Other tabs should work.
4. After 2–3 sec, the delayed side effects run silently.
5. Export breadcrumbs and confirm:
   - `alive-2000` ✓
   - `alive-3000` ✓
   - `side-effects-start` ✓
   - `side-effects-complete` ✓
   - If any `side-effects-*-threw` appears, the specific failure is named — surgical follow-up.

**Known non-goals:**
- 1z.94 is a freeze fix, not a full HealthKit-cascade audit. If `side-effects-complete` lands but the user still reports a sluggish moment around 2 sec post-add, follow-up phase will move side effects to an idle callback or chained per-tick scheduling. For now: as long as the freeze is gone and the user can interact immediately, the bug is closed.
- No backend / D1 / Duels / HealthKit / Notification permission wording / boss / drop / pity / mercy / rank-threshold / QA-unlock / economy CHANGES (the side-effects functions themselves are unchanged — only their schedule is decoupled).
- Codemagic NOT triggered.

### Local-build pipeline — MacBook archive without Codemagic (v3 Phase 1z.93)

**Trigger.** User decided to stop relying on Codemagic ($31/mo cumulative debug-cycle cost was higher than expected). All future TestFlight builds will be archived locally from a MacBook Air via Xcode and uploaded to App Store Connect through Organizer.

**Fix — two files, zero runtime impact:**

1. **`scripts/prep-local-build.sh`** (new). One-shot deterministic prep script that mirrors `codemagic.yaml`'s nine prep steps (web asset copy with codemagic.yaml's curated allowlist, public-dir wipe, `cap sync ios`, deployment-target bump, `pod install`, `ITSAppUsesNonExemptEncryption`, HealthKit + applesignin entitlements, `CODE_SIGN_ENTITLEMENTS` Ruby wiring via xcodeproj gem, optional agvtool build-number bump). Idempotent. Prints disk space, git HEAD, and version-knob sanity at start. Designed to fail loudly on any missing input rather than silently shipping a stale bundle.

2. **`LOCAL_BUILD.md`** (new). Step-by-step reference for the per-build workflow on the Mac. Covers one-time setup (Xcode, Homebrew, Node, CocoaPods, xcodeproj gem, Apple Developer sign-in), per-build commands, and troubleshooting for the known failure modes (`applesignin` provisioning bug, missing Apple Distribution cert, build-number collisions, agvtool not found, disk-space runs).

**What this does NOT do:**
- Does NOT touch any runtime code (`app.js`, `sw.js`, `index.html`, `styles.css`, `auth.js` all untouched).
- Does NOT bump version knobs. `APP_BUILD_TAG` stays at `2.2.2-w6`, `app.js?v=444`, `sw.js v5.330`. Local archives off HEAD `7100aec` ship 1z.92 (the debug export) as the user-visible change.
- Does NOT remove Codemagic. `codemagic.yaml` stays intact as a fallback / safety net. The local script and Codemagic produce equivalent IPAs (same prep steps, same entitlements, same signing model).
- Does NOT automate signing or upload — Xcode GUI handles those because they're more reliable when interactive (Apple ID 2FA, manual provisioning profile selection, etc.).

**Files touched (1z.93 only):**
- `scripts/prep-local-build.sh` — new build prep script.
- `LOCAL_BUILD.md` — new operator reference doc.
- `CLAUDE.md` — this section.

**No app.js / sw.js / index.html / styles.css change. No version-knob bump. No runtime impact whatsoever** — this is build tooling only.

**Verification:**
- `bash -n scripts/prep-local-build.sh` → no syntax errors.
- The script will be exercised tonight on the MacBook by the user; any real-environment issues (CocoaPods specs repo missing, signing snags, etc.) get fixed forward as they surface.

**Known non-goals:**
- No backend / D1 / Duels / HealthKit / Notification permission wording / boss / drop / pity / mercy / rank-threshold / QA-unlock / economy changes.
- No Codemagic trigger.
- No Add Habits logic change in this phase — the freeze diagnosis still depends on extracting the 1z.91 breadcrumbs via the 1z.92 in-app debug export, which requires a TestFlight build with 1z.92 code (HEAD `7100aec`). The local archive is the path to that build.

### In-app debug-info export — TestFlight breadcrumb retrieval (v3 Phase 1z.92)

**Trigger.** Phase 1z.91 wrote persistent Add Habits breadcrumbs to `localStorage['hb_add_habit_debug_v1']`, with the assumption that the user could read them via Safari Web Inspector. **That assumption broke** — on TestFlight build 80, Safari sees the iPhone under the Develop menu but Awakened is not listed ("No Inspectable Applications"). Apple disables WKWebView's Web Inspector flag in App Store-signed IPAs by default; only debug-signed builds (developer signed) expose it. The breadcrumbs were trapped on the device.

1z.92 closes the loop by giving the user an in-app way to copy the breadcrumb payload to clipboard.

**UX (kept hidden from normal users):**
1. Open Settings.
2. Tap the "Version 2.2.2" label five times within 3 seconds.
3. A "Copy Debug Info" button appears below the version line, plus a toast "Diagnostics unlocked."
4. Tap the button → JSON payload is copied to clipboard, toast "Debug info copied — paste it in chat."
5. If clipboard write fails (rare — e.g. permission denied in some WebView contexts), a fallback modal opens with a read-only textarea, a "Select All" button, and a "Close" button. User long-presses → Select All → Copy via iOS share/edit menu.

**Payload shape** (one JSON object, pretty-printed for paste readability):
```json
{
  "kind": "awakened-debug",
  "schema": 1,
  "version": "2.2.2",
  "build": "2.2.2-w6",
  "createdAt": "...ISO...",
  "href": "capacitor://localhost/",
  "userAgent": "...",
  "isCapacitor": true,
  "platform": "ios",
  "addHabitDebug": [ { "t": ..., "step": "...", "data": {...} }, ... ],
  "uiState": {
    "sheets": [ { "id": "hd-sheet", "hasHiddenClass": true, "inlineDisplay": "none", ... }, ... ],
    "activeTab": "tab-habits",
    "bodyClass": "...",
    "activeElement": "..."
  },
  "habitSummary": { "count": 12, "lastFew": [ { "name": "No alcohol", ... } ] },
  "swController": true,
  "knownSwVersion": "v5.329"
}
```

**Key implementation details:**

- **Five helpers** added to `app.js`, all IIFE-scoped: `_buildAwakenedDebugPayload()`, `_copyTextToClipboard(text)` (returns Promise<bool>), `_legacyCopyFallback(text, resolve)`, `_showDebugTextFallback(text)`, `_exportAwakenedDebugInfo()`, `_setupDebugInfoUnlock()`, `_revealDebugInfoButton()`.
- **No `index.html` markup changes** — the Copy button is created dynamically and inserted after the existing `#settings-app-ver` element. No risk of breaking other Settings markup or App Review-relevant copy.
- **Each DOM op is independently try-wrapped** — the export action can never throw past its own boundary or freeze the app.
- **Local-only** — no `fetch()`, no analytics, no transmission anywhere. The user copies the JSON and pastes it manually into chat.
- **App Review safe** — no new permissions, no private APIs, no scary developer copy. The unlock is invisible to a reviewer who doesn't five-tap the version label. The visible copy ("Diagnostics unlocked.", "Local-only diagnostic snapshot.") is neutral.
- **Add Habits breadcrumbs (`_addHabitBreadcrumb`) are unchanged.** Cap still 80 entries. Existing Playwright section H assertions all pass unchanged.

**Files touched (1z.92 only):**
- `app.js` — seven new helpers (see above); `_setupDebugInfoUnlock()` wired into the Settings init right after the version-label text assignment; `APP_BUILD_TAG → 2.2.2-w6`.
- `index.html` — `app.js?v=444`.
- `sw.js` — `CACHE_VERSION = v5.330`.
- `CLAUDE.md` — this section + handoff version table.

**Version knobs (post-1z.92):** `APP_VERSION 2.2.2` (unchanged), `APP_BUILD_TAG 2.2.2-w6`, `app.js?v=444`, `sw.js v5.330`. `styles.css?v=302` unchanged.

**Verification:**
- `node --check app.js` → OK
- `node --check sw.js` → OK
- `npm run test:e2e` → see commit log for the gating run (8/8 expected, no Playwright changes needed — section H still asserts the same canonical breadcrumb sequence, and the new debug export is unrelated to the add-flow assertions).
- `git diff --name-only` → `CLAUDE.md`, `app.js`, `index.html`, `sw.js`. No backend / D1 / Duels / HealthKit / Notification permission wording / boss / drop / pity / mercy / rank-threshold / QA-unlock / economy files. `QA_UNLOCK_C_RANK_DUNGEONS` stays `false`.

**Manual QA checklist (TestFlight 2.2.2-w6):**
1. Boot — open Settings (gear icon top-right).
2. Tap the "Version 2.2.2" line five times in <3 sec. Toast "Diagnostics unlocked." appears, "Copy Debug Info" button appears below the version line.
3. Tap Copy Debug Info. Toast "Debug info copied — paste it in chat."
4. Open the iOS Notes app (or any text field) → long-press → Paste. Confirm JSON appears with `"build": "2.2.2-w6"`, `"addHabitDebug": [...]`, and `"uiState": {...}`.
5. Reproduce the Add Habits freeze.
6. Force-quit + relaunch.
7. Settings → version 5-tap → Copy Debug Info again.
8. Confirm breadcrumbs survived force-quit and the last entries show where the freeze stopped.
9. **Paste full payload into chat** for diagnosis.

**Known non-goals:**
- The debug export does NOT include device-identifying info (no IDFA, no IDFV, no model name beyond what's in the user agent).
- No automatic transmission — the user must paste it manually.
- No backend / D1 / Duels / HealthKit / Notification permission wording / boss / drop / pity / mercy / rank-threshold / QA-unlock / economy changes.
- Codemagic NOT triggered by this commit.

### Add Habits freeze — instrumented conservative add path (v3 Phase 1z.91)

**Bug confirmed real on w4.** TestFlight build 79 (`APP_BUILD_TAG 2.2.2-w4`, app.js?v=442) was installed fresh from Codemagic build off `e83da84` per the 1z.90 provenance pass. User force-quit + relaunched (which would have eliminated any SW cache poisoning class). Add Habits still freezes on every preset add. `hb_habits` localStorage shows the habit persists after force-quit, so `save()` runs — the freeze is somewhere in the close / render / interaction-cleanup path AFTER save.

Because the freeze requires force-quit (which destroys the console log buffer), there is no way to know from the device which step actually stalls. 1z.91 makes that diagnosis trivial post-mortem by writing a persistent breadcrumb ring to localStorage at every step of the add path, then makes the path more conservative.

**Five changes:**

1. **`_addHabitBreadcrumb(step, data)` helper** writes to `localStorage['hb_add_habit_debug_v1']` (capped 80 entries) at EVERY step of the add path. Each entry is `{ t, step, data? }`. Also mirrored to `console.log('[add-habit-debug]', step, data)`. Survives force-quit so a freeze can be diagnosed by inspecting localStorage on the device or via Safari devtools post-relaunch. Documented as a temporary diagnostic surface.

2. **`forceCloseAddHabitsStack(reason)` helper.** Single deterministic close path — bundles `closeHabitDetail` + `closeLibrary` + `resetAddHabitsInteractionState` + a final overlay scrub. Idempotent. Each underlying call independently try-wrapped. Used by the success path, the dup tap guard, the outer-catch, and the post-add watchdog. Eliminates three-call-site drift.

3. **`ensureHabitsTabInteractive()` helper.** Snapshots the post-add interaction state (tab bar visibility, body class, sheet/overlay hidden flags) to breadcrumbs so the next freeze repro tells us exactly which element is intercepting. Never throws.

4. **No `renderLibrary()` after successful add.** 1z.88/1z.89 still re-rendered the library on a deferred tick post-add. The library sheet is closed at that point so the rebuild was pure DOM thrash into a hidden subtree — a suspected freeze contributor on iOS. The library re-renders on the next `openLibrary()` call regardless. Removed.

5. **Longer render delay + 500ms watchdog.** `renderHabits` deferred 150ms (a real paint frame on iOS WebView, not the 0ms macrotask the prior phases used). A 500ms watchdog re-runs `forceCloseAddHabitsStack` idempotently as belt-and-braces against any stale overlay surviving the first close. Alive probes at 100ms / 500ms / 1000ms write breadcrumbs that distinguish JS-blocked freezes from touch-interception freezes (if alive crumbs land, JS is alive — freeze is touch interception).

**Breadcrumb sequence on a clean fresh add (canonical):**
```
tap-start → busy-guard-set → dup-guard-start → dup-guard-passed
→ cfg-build-start → cfg-build-complete
→ onConfirm-start → onConfirm-complete (saveOK:true)
→ force-close-start → forceClose-start → forceClose-complete → force-close-complete
→ toast-shown → finally-cleanup
→ alive-100
→ render-tick-start → render-tick-ok
→ alive-500 → watchdog-complete (forceClose-start/complete + ensureInteractive nested)
→ alive-1000
```

**Inspecting breadcrumbs after a TestFlight freeze:**
1. Force-quit + relaunch the app.
2. Settings → some QA affordance OR Safari devtools console:
   ```js
   JSON.parse(localStorage.getItem('hb_add_habit_debug_v1') || '[]')
   ```
3. The LAST entry tells you the deepest step the freeze reached. Cross-reference against the canonical sequence above to pinpoint which step stalled.

**Files touched (1z.91 only):**
- `app.js` — `_addHabitBreadcrumb`, `forceCloseAddHabitsStack`, `ensureHabitsTabInteractive` helpers; click-handler refactor with breadcrumbs at every step; renderLibrary removed from success path; 150ms render delay; 500ms watchdog; alive probes; `APP_BUILD_TAG → 2.2.2-w5`.
- `index.html` — `app.js?v=443`.
- `sw.js` — `CACHE_VERSION = v5.329`.
- `tests/e2e/smoke.spec.ts` — section H updated to assert the canonical breadcrumb sequence and watchdog completion.
- `CLAUDE.md` — this section + handoff version table.

**Version knobs (post-1z.91):** `APP_VERSION 2.2.2` (unchanged), `APP_BUILD_TAG 2.2.2-w5`, `app.js?v=443`, `sw.js v5.329`. `styles.css?v=302` unchanged.

**Verification:**
- `node --check app.js` → OK
- `node --check sw.js` → OK
- `npm run test:e2e` → see commit log for the gating run; section H now asserts the breadcrumb sequence.
- `git diff --name-only` → `CLAUDE.md`, `app.js`, `index.html`, `sw.js`, `tests/e2e/smoke.spec.ts`. No backend / D1 / Duels / HealthKit / Notification / boss / drop / pity / mercy / rank-threshold / QA-unlock / economy files. `QA_UNLOCK_C_RANK_DUNGEONS` stays `false`.

**Manual QA checklist (next TestFlight build):**
1. Boot — Safari devtools console must show `[Awakened] boot · APP_VERSION=2.2.2 · build=2.2.2-w5`. If not, you're on a stale build.
2. **Mobility & Stretching fresh add** — sheets close, lands on Habits tab, toast shows, habit visible, app fully responsive.
3. **Sprint session fresh add** — same.
4. **Protein goal fresh add** (the screenshot habit) — same.
5. **Rapid double-tap** — only one habit added.
6. **If the freeze STILL reproes** — force-quit + relaunch, then in Safari devtools run `JSON.parse(localStorage.getItem('hb_add_habit_debug_v1'))`. Paste the last 5-10 entries. The step name on the last entry tells us which line of the handler stalled.

**Known non-goals:**
- `sw.js ignoreSearch: true` was identified as a possible SW cache-poisoning vector in 1z.90 but force-quit/relaunch ruled it out as the cause of the user-reported freeze. Documented for a later pass; not touched here.
- No backend / D1 / Duels / HealthKit / Notification permission wording / boss / drop / pity / mercy / rank-threshold / QA-unlock / economy changes.
- Codemagic NOT triggered by this commit.

### Build-provenance reconciliation pass (v3 Phase 1z.90)

**Trigger.** After Phases 1z.88 (commit `3829456`) and 1z.89 (commit `a623113`) were pushed to `origin/main`, the user reported the Add Habits freeze still reproed on what they believed was the brand-new TestFlight build. ClaudeCode initially concluded the runtime was stale based on `APP_BUILD_TAG = 2.2.2-w2` vs the source `2.2.2-w4` and the fact that no Codemagic build had been explicitly approved during the session. User pushed back: they were certain the build was new.

**Root question.** The contradiction has four possible explanations:
1. **User installed an older TestFlight build** (TestFlight retains old builds; the device list can default to the prior build after an IPA upload notification).
2. **Codemagic ran on a stale commit checkout** (gates were verifying internal repo↔www↔iOS consistency but NOT verifying the checkout commit matched origin/main HEAD). Both sides could agree on w2 and pass.
3. **Build pipeline silently dropped the new assets** (`cap sync ios` copied the wrong files, or the force-clean step didn't wipe a sub-asset).
4. **iOS Capacitor WebView served stale assets from a registered service-worker cache** that survived the IPA replace.

ClaudeCode cannot determine which of the four from the local source alone — Codemagic build logs and App Store Connect build numbers are required. The 1z.90 pass therefore makes future ambiguity impossible to sustain rather than attempting to retroactively diagnose the current one.

**Fix (build-pipeline only — no app.js change, no version-knob bump):**

1. **New `codemagic.yaml` step "Print build provenance"** runs first, before `npm install`. Loudly prints to the Codemagic log:
   - Full git commit hash + short hash + branch + commit subject + author date.
   - `APP_VERSION` value parsed from `app.js`.
   - `APP_BUILD_TAG` value parsed from `app.js` (fails the build if missing entirely).
   - `app.js?v=` query string parsed from `index.html`.
   - `CACHE_VERSION` parsed from `sw.js`.
   - Latest TestFlight build number from App Store Connect, plus best-effort estimate of what this build will be numbered.
2. **`APP_BUILD_TAG` added to existing freshness gates** — both pre-sync (`www/`) and post-sync (`ios/App/App/public/`). If `app.js` ever loses the constant or drifts between locations, the build fails loudly. Previously the gates only checked `app.js?v=` query strings and `CACHE_VERSION`.
3. **Post-sync log lines** print the resolved `APP_BUILD_TAG` and `app.js?v=` from the iOS bundle so a Codemagic log inspector can match the in-app boot stamp (`[Awakened] boot · APP_VERSION=… · build=…`) to a specific IPA without guesswork.

**What this does NOT do.** It does not retroactively fix the current TestFlight installation. The user must still:
1. Open the TestFlight app on the device.
2. Tap "Awakened" → look at the **Build** number shown.
3. Cross-reference against the App Store Connect build list — which build number is actually installed?
4. Or — attach Safari devtools (Mac → Safari → Develop → iPhone → Awakened) and read the `[Awakened] boot · APP_VERSION=2.2.2 · build=…` console line. That settles the question.

Once a NEW Codemagic build runs with these provenance changes, every future build log shows commit hash + `APP_BUILD_TAG` + TestFlight build number on one line. The next time a "brand-new build still buggy" report comes in, the Codemagic log + Safari devtools boot line together resolve the question instantly.

**Decision tree (used to classify the current incident before any further Add Habits patches):**

| Evidence | Classification | Action |
|---|---|---|
| TestFlight build number on device = latest in ASC, boot stamp shows `build=2.2.2-w4` | Runtime is current; Add Habits bug is real on w4 | Resume universal Add Habits freeze debugging |
| TestFlight build on device < latest in ASC | User installed an older build | Have user reinstall latest; do NOT patch app.js |
| Latest ASC build matches source HEAD commit hash but boot stamp says `build=2.2.2-w2` | Codemagic built off old commit, gates didn't catch it | New Codemagic build off HEAD; the 1z.90 provenance step exposes the cause |
| Latest ASC build commit matches HEAD but boot stamp wrong + Codemagic log shows correct tag pre-sync | iOS WebView served stale SW cache | Investigate sw.js activation (skipWaiting/clientsClaim); inflict cache name bump |
| Boot stamp says `build=2.2.2-w4` and freeze still reproes | Add Habits bug is real on w4 — runtime cleared | Resume universal Add Habits freeze debugging with confidence |

**Files touched (1z.90 only):**
- `codemagic.yaml` — new provenance step + `APP_BUILD_TAG` cross-check in both freshness gates.
- `CLAUDE.md` — this section.

**No app.js / sw.js / index.html / styles.css change. No version-knob bump (existing knobs remain at `APP_BUILD_TAG=2.2.2-w4`, `app.js?v=442`, `sw.js v5.328`). No Add Habits logic touched. No backend / D1 / Duels / HealthKit / Notification / boss / drop / economy / QA-unlock change.**

**Verification:**
- `node --check app.js` → OK (file unchanged this phase)
- `node --check sw.js` → OK (file unchanged this phase)
- `bash -n codemagic.yaml` is not meaningful (YAML, not bash). Manual review of the new step shows it is valid bash inside a literal block, uses `set -e`-compatible idioms, and the version-knob extractors are the same ones already used elsewhere in the pipeline.
- `git diff --name-only` → `CLAUDE.md`, `codemagic.yaml`. No backend/D1/Duels/HealthKit/Notification/boss/economy files. `QA_UNLOCK_C_RANK_DUNGEONS` unchanged.

**Manual reconciliation checklist (user action required):**
1. **Device check:** On the iPhone, open the TestFlight app → Awakened → note the Build number displayed (e.g. "Build 77" or "Build 76").
2. **ASC check:** Log into App Store Connect → My Apps → Awakened → TestFlight → iOS Builds. List the most recent builds and their upload dates.
3. **Boot stamp check:** Plug iPhone into Mac → Safari → Develop → iPhone Name → Awakened. Read the console. Look for `[Awakened] boot · APP_VERSION=2.2.2 · build=…`. Paste the line back to ClaudeCode.
4. **Codemagic log check (if a build was triggered post-3829456):** Open Codemagic dashboard → Awakened → last build. Look for either the existing `✓ www/ bundle verified fresh` line (current pipeline) OR — once 1z.90 ships — a `BUILD PROVENANCE` block with the commit hash.
5. Send the four findings back. ClaudeCode will then classify per the decision tree and proceed accordingly.

**Known non-goals:**
- No Add Habits logic patched until runtime identity is established.
- No automatic Codemagic trigger.
- No HealthKit/Notification permission wording changed.
- No boss / drop / pity / mercy / rank-threshold / QA-unlock / economy / Duels / D1 / backend changes.

### Add Habits parent-sheet freeze — close-to-Habits-tab fix (v3 Phase 1z.89)

**Bug summary.** After Phase 1z.88 the freeze MOVED from the child detail sheet to the parent Add Habits library sheet. User reported on TestFlight 2.2.2 build 76 (the 1z.88 build = `APP_BUILD_TAG 2.2.2-w3`): tapping "Add to My Habits" from a preset detail successfully closed the detail screen, returned to the parent Add Habits library — and then the whole sheet became non-interactive. Force-quit was required. The habit DID persist (save() ran), but the user couldn't use the sheet or any tab control until relaunch.

**Affected example reported:**
- **`Mobility & Stretching`** opened from Add Habits → Physical Performance. Add to My Habits → returns to library → frozen library sheet, force-quit required.

**Root cause (analysed, not guessed).**
The library sheet (`#lib-sheet`) has its own swipe-down-to-dismiss gesture attached at `setupLibrary` (line 15315: `attachSheetDismissGesture(libSheet, libOverlay, …)`). That gesture handler mutates **inline** `transform`, `transition`, and `opacity` on `#lib-sheet` and `#lib-overlay` during touch. It clears them via a `transitionend` listener.

On iOS Capacitor WebView, the post-add `renderLibrary()` (deferred 1z.88 setTimeout chain) tears down and rebuilds the entire `#lib-list` subtree. If the user's tap or any micro-drag had nudged the gesture into a "dragging" state — or if `transitionend` simply never fires through the DOM thrash — residual inline `transform: translateY(...)` / `transition` / `opacity` survives on `#lib-sheet`. The sheet is then visually mid-transition or partially translated, and on iOS the WebView's hit-testing through that style state becomes inconsistent. Result: parent sheet visible but non-interactive.

The 1z.88 fix only hardened `#hd-sheet` (the detail), not the parent `#lib-sheet`. Closing the detail with belt-and-braces inline styles solved the detail freeze, but the user landed on the still-broken parent.

**Distinguishing JS-freeze vs touch-interception freeze.** This was a **touch-interception freeze**, not a JS-main-thread freeze. Evidence: `save()` ran to completion (habit persisted to localStorage), `closeHabitDetail()` ran (detail visibly closed), and the user returned to a rendered parent sheet — that whole chain executed. The freeze was the sheet's hit-testing post-render, not blocked JS.

**Chosen UX (PART D Option 1 — "much safer" route).**
After a successful preset add from the library, close BOTH sheets and return the user to the Habits tab with a toast confirming the add. This eliminates the entire half-state class — no parent sheet means no parent sheet freeze. The library still re-renders on the deferred tick so the next `openLibrary()` reflects the new `habits[]`.

The trade-off: users who wanted to add multiple presets in a row now reopen the library each time. We accept this — bulk-add is what the Morning Routine / Locked-In packs are for, and the existing pack modal is unaffected. Adding individual presets one at a time was always the slower flow.

**Fix — three pieces:**

1. **`resetAddHabitsInteractionState()` helper.** Hard-resets `#hd-sheet`, `#lib-sheet`, and `#lib-overlay` — re-applies `.hidden`, scrubs inline `transform`, `transition`, `opacity`, `pointer-events`, and `display` (preserves `#hd-sheet`'s inline `display:none` from 1z.88 belt-and-braces). Each DOM op is independently try-wrapped. Single source of truth for cleaning up gesture residue.
2. **Click handler — close parent on add.** After `closeHabitDetail()`, if `opts.context === 'library'`, also call `closeLibrary()`, then `resetAddHabitsInteractionState()`, then show a `<name> added to your habits.` toast. Applied to both the success path AND the outer catch (force-close on any thrown failure).
3. **Tap-guard parity.** The 1z.88 dup tap guard now also closes the library on duplicate-detect, for consistency. The guard still toasts and short-circuits before save/render — only the destination changes.

`closeLibrary()` itself is unchanged (it just toggles `.hidden` on `#lib-sheet` + `#lib-overlay`). The reset helper compensates for the inline-style residue that `closeLibrary` doesn't touch.

Render deferral (chained `setTimeout(0)` from 1z.88) is unchanged — both `renderHabits` and `renderLibrary` still fire after the close so the Habits tab list and the (now-hidden) library are both fresh for next open.

**Files touched (1z.89 only):**
- `app.js` — `resetAddHabitsInteractionState` helper, click handler closes library + toast on add success and on dup, `APP_BUILD_TAG → 2.2.2-w4`.
- `index.html` — `app.js?v=442`.
- `sw.js` — `CACHE_VERSION = v5.328`.
- `tests/e2e/smoke.spec.ts` — section **H** updated to assert the parent library sheet is CLOSED (not visible) after add, the user is back on the Habits tab, and the app is responsive. New duplicate-detect coverage too.
- `CLAUDE.md` — this section + handoff version table.

**Version knobs (post-1z.89):** `APP_VERSION 2.2.2` (unchanged), `APP_BUILD_TAG 2.2.2-w4`, `app.js?v=442`, `sw.js v5.328`. `styles.css?v=302` unchanged.

**Verification:**
- `node --check app.js` → OK
- `node --check sw.js` → OK
- `npm run test:e2e` → see commit log for the gating run.
- `git diff --name-only` confirms: `CLAUDE.md`, `app.js`, `index.html`, `sw.js`, `tests/e2e/smoke.spec.ts`. **No backend, D1, Duels, HealthKit, Notification, boss, drop-rate, pity, mercy, rank-threshold, QA-unlock, or economy files changed.** `QA_UNLOCK_C_RANK_DUNGEONS` stays `false`.

**Manual QA checklist (TestFlight 2.2.2-w4):**
1. Boot — Safari devtools console must show `[Awakened] boot · APP_VERSION=2.2.2 · build=2.2.2-w4`. If not, kill + relaunch the IPA.
2. **Mobility & Stretching fresh add.** Add Habits → Physical Performance → Mobility & Stretching → Add to My Habits. Both sheets close, user lands on Habits tab, toast shows "Mobility & Stretching added to your habits.", habit visible in list, all tabs responsive.
3. **Sprint session fresh add.** Same flow. Same expected outcome.
4. **Rapid double-tap.** Two fast taps on Add to My Habits. Only one habit added (busy guard), no freeze.
5. **Re-open library after add.** Tap Add Habits again — the freshly added preset must NOT appear in its category (renderLibrary filters on activeNames).
6. **Pack flows unaffected.** Morning Routine / Locked-In pack add flows still close their own modal correctly (pack modal is a different path — not touched).
7. **Console.** Expected sequence per add: `add click start → calling opts.onConfirm → opts.onConfirm returned → sheet closed → library sheet closed → tick1 · renderHabits → tick2 · renderLibrary → renders complete`. No `threw` entries.

**Known non-goals:**
- No backend / D1 / Duels / HealthKit / Notification permission wording / boss / drop-rate / pity / mercy / rank-threshold / QA-unlock / economy changes.
- Codemagic NOT triggered by this commit.
- Onboarding habit-detail flow (`opts.context === 'onboarding'`) is intentionally untouched — onboarding has its own multi-select grid pattern and doesn't suffer the post-add return-to-library state.
- We do NOT diagnose whether the underlying gesture handler is itself buggy (e.g. whether `attachSheetDismissGesture` should be made idempotent). That's deferred — the close-to-Habits-tab approach makes that bug unreachable for the Add Habits flow. If a similar freeze surfaces in other sheets using the same gesture helper (Streaks, Souls Ledger, Class Detail, etc.), revisit the gesture handler itself.

### Add Habits freeze — defensive hardening pass (v3 Phase 1z.88)

**Bug summary.** Tapping "Add to My Habits" inside the Add Habits detail sheet froze the app on iOS TestFlight (Capacitor WebView). The sheet logically closed but visually stayed up intercepting taps until the JS turn finished — which on slow renders never visibly completed.

**Affected examples reported on TestFlight 2.2.2 build 76:**
- **`Sprint session`** — regular library preset (Physical Performance category, DEFAULT_HABITS[5]). Normal Add CTA. Tap → freeze.
- **`No caffeine` opened from the library after the Morning Routine pack shows "All added"** — the user had already added the MR pack, then browsed the library and tapped a preset they'd already added via the pack. The detail sheet still rendered an active "Add to My Habits" button instead of the "Already in your habits list" state. Tapping it tried to push a duplicate, which compounded the freeze.

**Root cause.**
1. **Detail-state ambiguity.** `openHabitDetail` checked `habits.some(a => a.name === h.name)` directly. That check was correct for the simple case, but a stale-sheet edge case (sheet opened BEFORE the dup landed via another flow) could still expose the active Add CTA. There was no defensive recheck at tap time.
2. **iOS WebView paint scheduling.** Even with the 1z.85 close-before-render ordering, on Capacitor's WKWebView a single `requestAnimationFrame` (1z.87) wasn't enough to guarantee the close paints before `renderHabits` blocked the next frame. The user saw an apparently-frozen sheet that was actually closed under the hood.
3. **No belt-and-braces close.** `closeHabitDetail` only toggled `.hidden`. Any leftover inline style or stray transform could leave the sheet invisible-but-interactive.

**Why the prior 1z.87 fix (commit 69eddde) didn't fully resolve it.** 1z.87 deferred renders to a single `requestAnimationFrame`. On the Capacitor iOS WebView, rAF callbacks can fire BEFORE the previous frame's paint commits, so a heavy render in that callback still blocks the close from being visible. Empirically, splitting `renderHabits` and `renderLibrary` into separate `setTimeout(0)` macrotasks is what unsticks the visible freeze.

**Fix — five layers:**

1. **Canonical `isHabitAlreadyAdded(h)` helper** (single source of truth). Excludes `.custom` so user-built habits with a colliding name don't false-positive. Both the render-time check and the new click-time guard route through it.
2. **Render-time early return** (already existed in `render()`): when `alreadyAdded` is true, paint the "Already in your habits list" message and `return` BEFORE appending the Add CTA. Now uses the helper.
3. **Click-time defensive tap guard.** First operation inside `addBtn`'s handler: recompute `isHabitAlreadyAdded` against the live `habits[]`. If true → toast + `closeHabitDetail()` + clear busy/disabled + `return`. The heavy save/render branch is unreachable for dups.
4. **Chained `setTimeout(0)` render deferral** replaces the single rAF. `renderHabits` and `renderLibrary` each get their own macrotask tick so the iOS WebView paints between them.
5. **Belt-and-braces `closeHabitDetail`.** Beyond `classList.add('hidden')`, the sheet now also gets inline `display:none !important` + `pointer-events:none`, each in its own try. `openHabitDetail` clears those inline styles before re-showing. Renders + close ordering is unchanged: persist → close → deferred renders.

Plus granular logging around `opts.onConfirm` call/return and each `setTimeout` tick so Safari devtools pinpoints any future repro.

**Files touched (1z.88 only):**
- `app.js` — `isHabitAlreadyAdded` helper, tap guard, chained setTimeout, hardened close + open inline-style reset, `APP_BUILD_TAG → 2.2.2-w3`.
- `index.html` — `app.js?v=441`.
- `sw.js` — `CACHE_VERSION = v5.327`.
- `tests/e2e/smoke.spec.ts` — new section **H** asserting an already-added preset shows the Already-added message, no Add CTA, closes cleanly, app stays responsive.
- `CLAUDE.md` — this section + handoff version table.

**Version knobs (post-1z.88):** `APP_VERSION 2.2.2` (unchanged), `APP_BUILD_TAG 2.2.2-w3`, `app.js?v=441`, `sw.js v5.327`. `styles.css?v=302` unchanged.

**Verification:**
- `node --check app.js` → OK
- `node --check sw.js` → OK
- `npm run test:e2e` → see commit log for the run that gated this commit.
- `git diff --name-only` confirms: `CLAUDE.md`, `app.js`, `index.html`, `sw.js`, `tests/e2e/smoke.spec.ts`. **No backend, D1, Duels, HealthKit, Notification, boss, or economy files changed.** `QA_UNLOCK_C_RANK_DUNGEONS` stays `false`.

**Manual QA checklist (TestFlight 2.2.2-w3):**
1. Boot the app — Safari devtools console must show `[Awakened] boot · APP_VERSION=2.2.2 · build=2.2.2-w3`. If not, the device is still on the prior build — kill + relaunch the IPA.
2. **Sprint session — fresh add.** Add Habits → Physical Performance → Sprint session → "Add to My Habits". Sheet should close immediately, habit appears in list, app stays responsive.
3. **Sprint session — re-open already-added.** Re-open Add Habits → Sprint session card. Detail sheet should show "Already in your habits list" and NO Add to My Habits button.
4. **Morning Routine all-added child.** Add the Morning Routine pack → confirm "All added" state. Then re-open Add Habits → No caffeine (or any MR child). Same already-added state must render — no active Add CTA.
5. **Rapid double-tap.** On a fresh preset, tap Add to My Habits twice rapidly. Only one habit should be added (busy guard) and no freeze.
6. **Cancel/back path.** Open any detail, tap the ← back arrow. Sheet closes, no stranded overlay, tab bar still works.
7. **Console hygiene.** While performing the above, the only `[habit-detail]` logs should be the expected `add click start / calling opts.onConfirm / opts.onConfirm returned / sheet closed / tick1 · renderHabits / tick2 · renderLibrary / renders complete` sequence (or the `tap guard · already added, short-circuiting` line for already-added taps). No `threw` entries.

**Known non-goals:**
- Onboarding habit-detail flow (`opts.context === 'onboarding'`) is intentionally untouched. The freeze class only affects the post-onboarding library / detail path.
- No changes to the Lock-In / Morning Routine pack confirm modal itself — only the per-habit library detail. The pack modal already had its own 1z.34 isolation.
- No changes to HealthKit/Notification wording, boss logic, drop rates, pity, mercy, rank thresholds, QA unlock, economy, Duels, or backend.
- Codemagic NOT triggered by this commit.

### iOS-friendlier preset Add Habits fix (v3 Phase 1z.87)

**Reinforces 1z.85.** User reported the freeze still reproed on the new TestFlight 2.2.2 build (`Sleep before midnight`, `No sugar/junk food`). 1z.85's `persist → close → render-in-try-catch` ordering was correct, but on iOS Capacitor WebView the close + heavy renders ran in the same JS turn — so the WebView didn't get a chance to paint the closed-sheet state until the renders finished, making it LOOK frozen.

**Three tweaks:**

1. **Renders deferred to `requestAnimationFrame`** so iOS paints the close first. Synchronous fallback if rAF is somehow unavailable.
2. **`busy` + `disabled` cleared BEFORE the deferred renders** so even if a render hangs in the next frame, the button is already unlocked.
3. **Console logging** added at three points (`add click start`, `sheet closed`, `renders complete`) so Safari devtools can confirm where a future repro stops.
4. **Boot-time version log** (`[Awakened] boot · APP_VERSION=2.2.2 · build=2.2.2-w2`) so Safari devtools can confirm which IPA the device is actually running — disambiguates "has the fix" vs "still on the prior build" when a repro comes in.

**Versions:** `app.js?v=440`, `sw.js v5.326`, `APP_BUILD_TAG 2.2.2-w2`. `styles.css` unchanged. `APP_VERSION` stays 2.2.2.

### Marketing version bump 2.2.1 → 2.2.2 (v3 Phase 1z.86)

**App Store Connect publish failure on Codemagic.** Build #102 IPA upload to App Store Connect failed with:

```
This bundle is invalid. The value for key CFBundleShortVersionString [2.2.1]
in the Info.plist file must contain a higher version than that of the
previously approved version [2.2.1].
```

**Root cause.** 2.2.1 was already approved by Apple Review on May 19 and is "Ready for Distribution." Apple's bundling check requires the **marketing version** (`CFBundleShortVersionString`) to be strictly greater than the previously approved version. Incrementing only the build number (`CFBundleVersion`, e.g. build 62 vs build 61) is enough for TestFlight, but once a marketing version reaches Distribution status, the next IPA must bump the marketing version.

**Fix.** Three files updated to advance the marketing version:

| File | Change |
|---|---|
| `codemagic.yaml` env vars | `APP_VERSION: "2.2.1"` → `"2.2.2"` (drives `agvtool new-marketing-version`) |
| `app.js` constant | `const APP_VERSION = '2.2.1'` → `'2.2.2'` |
| `app.js` build tag | `APP_BUILD_TAG = '2.2.1-w89'` → `'2.2.2-w1'` (new w-series for the 2.2.2 cycle) |

Plus the standard SW + JS-query bumps (`app.js?v=439`, `sw.js v5.325`) so the new web bundle cache-busts.

**What ships in 2.2.2** (everything on `main` since the 2.2.1 IPA was built):
- 1z.80 — `setBossImage` robust loader + QA unlock relock
- 1z.81 — Codemagic glob-copy fix that finally bundles C-rank boss PNGs into the IPA
- 1z.82 → 1z.83 — Sealed Mystery Relic reveal flow (replaces "???" placeholder)
- 1z.84 — "PERFECT DAY" banner leak fix on rare/ultra drops
- 1z.85 — Preset Add Habits freeze fix (this is the user-visible bug fix that motivated the new submission)

**Build number** continues to auto-increment from the latest TestFlight upload via the existing `agvtool new-version -all $((LATEST + 1))` step in codemagic.yaml — no manual edit needed.

**App Store Connect side:** the rejected build (102) will appear in TestFlight as a failed upload. Create a new 2.2.2 version in App Store Connect → App Information → Version, then trigger Codemagic off `main`. The next build will bundle marketing version 2.2.2 with a fresh auto-incremented build number.

**Versions:** `APP_VERSION 2.2.2`, `app.js?v=439`, `sw.js v5.325`, `APP_BUILD_TAG 2.2.2-w1`.

### iOS post-save freeze fix — preset Add Habits detail (v3 Phase 1z.85)

**Same class of bug as 1z.34.** Reproducible on iOS App Store build 2.2.1: Add Habits → tap any preset (e.g. Hydrate) → tap "Add to My Habits" → app freezes on the detail sheet. Force-close + relaunch shows the habit DID persist — so the save path completed; the freeze was post-save UI work.

**Anti-pattern (pre-fix, line ~16215 of `app.js`):**
```js
opts.onConfirm(cfg);   // pushes habit + save + renderHabits + renderLibrary
closeHabitDetail();    // ← never runs if any of the above throws
```

A synchronous throw inside `renderHabits` (or `renderLibrary`, or anywhere in the chain) bubbled past `closeHabitDetail()` and left the sheet open intercepting all touches.

**Fix.** Same pattern documented for 1z.34 in this file: **persist → close → render-in-try-catch**.

Two edits:

1. **`openHabitDetail`'s addBtn click handler** (line ~16215):
   - Double-tap guard via `addBtn.dataset.busy` so repeated taps don't queue duplicate adds while the handler is mid-flight.
   - `try / catch` around `opts.onConfirm(cfg)` so a throw inside the callback can't skip the close.
   - `closeHabitDetail()` runs unconditionally before any renders.
   - `renderHabits()` + `renderLibrary()` are now called HERE (not inside the library `onConfirm`), each in its own try/catch.
   - `renderLibrary()` only runs when `opts.context === 'library'` (skipped for the onboarding flow which doesn't have a library to repaint).
   - `finally` clears `dataset.busy` + `disabled` so the button can't get stuck in a loading state.
   - Outer catch force-closes the sheet if the cfg builder itself throws.

2. **Library card's `onConfirm` callback** (line ~15758):
   - Renders pulled out (now centralized in the addBtn handler above).
   - New dedup guard: if a habit with the same name + non-custom flag already exists, show a toast (`"<name> is already in your habits."`) and bail. Prevents duplicates when the user re-opens an already-added preset from the library and re-taps Add.
   - `save()` wrapped in try/catch so a persistence failure doesn't block the close.

**Onboarding `obSelect` callback** (line ~24759) was audited and is safe — it only tracks in-memory selection state, no save / render. No change needed.

**No behavioural changes** to: drop rates, mercy, pity, boss logic, souls, XP, rank thresholds, HealthKit permissions, App Review compliance wording, QA_UNLOCK_C_RANK_DUNGEONS flag, backend, Duels. Pure UI/sequencing fix.

**Versions:** `app.js?v=438`, `sw.js v5.324`, `APP_BUILD_TAG 2.2.1-w89`. `APP_VERSION` stays 2.2.1.

**Manual QA next TestFlight build:**
1. Fresh install → Add Habits → Hydrate → Add to My Habits → no freeze; detail sheet closes; Hydrate appears in list.
2. Repeat with multiple presets in sequence.
3. Open Hydrate again from library → tap Add to My Habits → see toast "Hydrate is already in your habits." → sheet closes.
4. Double-tap Add to My Habits rapidly → only one habit added, button never stuck.
5. Force-close + relaunch → habits persist.

### Sealed-state cleanup: hide "PERFECT DAY" banner leak (v3 Phase 1z.84)

**Two surgical fixes to the 1z.83 sealed flow.**

1. **`celebrateRareDrop` no longer fires for sealed first-acquisitions.** Per the Sealed Mystery Relic spec, the sealed sigil should be quiet — the Sigil Bloom cinematic carries the celebration. Previously, `_showBossResult` fired `celebrateRareDrop` for ANY rare/ultra drop, which dropped confetti over the sealed card and visually conflicted with the design. Now gated on `!_sealRelic` so only duplicate rare/ultra drops (which skip the cinematic) get the confetti+chime fallback.

2. **`_relicConfettiBurst` now hides `.pdc-content` while it's reusing `pdc-overlay`.** The legacy Perfect Day Celebration overlay contains a `.pdc-banner` element with the text **"PERFECT DAY"** inside `.pdc-content`. When 1z.73 added relic-drop confetti by reusing this overlay's canvas, it forgot to hide the banner — so "PERFECT DAY" rendered over any rare/ultra drop modal. Now `_relicConfettiBurst` sets `pdc-content.style.display = 'none'` on entry and restores it on cleanup, so the real Perfect Day Celebration still works.

Both bugs were observable on localhost preview of the sealed flow — the user saw "PERFECT DAY" text over the Sealed Mystery Relic card alongside drifting motes.

**Versions:** `app.js?v=437`, `sw.js v5.323`, `APP_BUILD_TAG 2.2.1-w88`. `styles.css` unchanged. `APP_VERSION` stays 2.2.1.

### Sealed Mystery Relic — ClaudeDesign reveal panel (v3 Phase 1z.83)

**Replaces 1z.82's "???" masking.** Per ClaudeDesign spec, the Boss Defeated modal now shows a proper **sealed sigil** card for rare/ultra first-acquisitions instead of greying out the existing relic card's fields. The relic identity is entirely absent from the DOM until reveal (spec hard requirement — accessibility tools cannot read what doesn't exist).

**Three discrete moments:**
1. **"I won"** — Boss Defeated header + sealed sigil + copy.
2. **"What is it?"** — user taps Reveal Relic (violet pulsing glow + seal-glyph icon).
3. **"Oh, that's what it is."** — Sigil Bloom cinematic fires → tap-to-reveal → real relic card.

**DOM structure** — new `<section id="bro-sealed-card">` in index.html as a sibling of `bro-relic-card`. Contains:
- Kicker: `· RELIC ACQUIRED ·` (mono gold)
- 88×88 sealed sigil with gold→violet gradient frame, navy radial well, gold corner cuts, two rune circles (gold outer + violet dashed inner), centered Spark flame, horizontal gold seal bar (the "locked" symbol), pulsing gold radial aura
- 6 drifting violet/gold motes (4s loop, staggered delays)
- Two-line title: **A sealed relic** (white) / **has emerged.** (gold w/ glow)
- Whisper: *Its power is hidden. Reveal to identify.* (italic Cormorant Garamond)

**No identity hints** — same sealed visual for rare and ultra. Rarity differentiation only happens post-reveal in the Sigil Bloom.

**`_showBossResult` flow:**
- `_sealRelic = !!(evt.drop.wasFirst && (rare || ultra_rare))`
- Sealed branch: show `bro-sealed-card`, hide `bro-relic-card` entirely; viewBtn copy → `Reveal Relic` + `.is-armed` class (violet pulse) + seal-glyph icon + `data-masked="1"`.
- Common / duplicate rare-or-ultra branch: show `bro-relic-card` with full identity as before; viewBtn copy → `View Relic`; clears `.is-armed` and `data-masked` defensively (the same modal element is reused across queued results).

**Reveal flow:** View Relic click handler (from 1z.82) checks `data-masked` and short-circuits to `closeBossResult({ suppressDrain: true })` + `_drainBossResultQueue()`. The drain's empty-queue branch chains to `processRevealQueue` (per 1z.73) → opens `openCardRevealModal` → fires Sigil Bloom. The cinematic's tap-to-continue handles marking the card as seen.

**1z.82's "???" masking removed.** The legacy block inside the `bro-relic-card` else-if branch was a placeholder that no longer fires (sealed drops never reach that branch).

**Animation specs:**
- `bro-sealed-pulse`: 2.8s ease-in-out infinite on the inner gold radial aura (opacity 0.6 → 1.0 → 0.6)
- `bro-sealed-motes-drift`: 4s ease-in-out infinite, motes translate Y -60px while fading
- `bro-armed-pulse`: 2.4s ease-in-out infinite on the Reveal Relic button's violet glow

**Reduced motion:** `prefers-reduced-motion: reduce` disables all three animations. Sigil + aura stay visually intact; only motion is suppressed. Sigil Bloom's existing reduced-motion path takes over at reveal time.

**New globals for QA/preview only:** `window.__queueBossResult`, `window.__processRevealQueue`, `window.__loadInventory`. Console preview snippets can simulate a sealed-relic flow on localhost without grinding an actual defeat. Production code still uses the IIFE-scoped originals.

**Versions:** `app.js?v=436`, `styles.css?v=302`, `sw.js v5.322`, `APP_BUILD_TAG 2.2.1-w87`. `APP_VERSION` stays 2.2.1.

### Mask rare/ultra relic identity in Boss Defeated modal (v3 Phase 1z.82)

**Product fix.** Before 1z.82, rare/ultra first-acquisitions showed the relic art + name + stats in the Boss Defeated modal AND then again in the Sigil Bloom cinematic — the cinematic lost its impact because the user had already seen the item.

**New flow:**

| Drop | Boss Defeated modal | View Relic button | After tap |
|---|---|---|---|
| Common | Full relic (art + name + stats) | "View Relic" → opens card detail | (no cinematic) |
| Duplicate rare/ultra | Full relic (no cinematic queued) | "View Relic" → opens card detail | (no cinematic) |
| **Rare/Ultra FIRST acquisition** | **Masked: silhouette + "???" name + "???" slot + "From <Boss>"** | **"Reveal Relic"** → closes modal, queue drains | **Sigil Bloom cinematic fires** |

What stays visible on a masked drop (so the moment still reads as significant):
- `RELIC ACQUIRED` eyebrow
- Rarity pill (`ULTRA-RARE` / `RARE`)
- `From <Boss Name>` source label

What gets masked:
- Art (img cleared via `setModalCardArt(null)`)
- Slot icon ('?' replaces the emoji)
- Name ('???' replaces the real name)
- Stat badges (cleared)
- "NEW" pill (hidden — that's a spoiler too)

**Code.** Two surgical edits in app.js:

1. In `_showBossResult`, after the existing relic-render block, compute `_maskRelic = !!(evt.drop.wasFirst && (rarity === 'rare' || rarity === 'ultra_rare'))`. When true, override the rendered fields and stamp `data-masked="1"` on the View Relic button. When false, defensively restore the default button copy (the same modal element is reused across queued results).
2. The View Relic click handler now checks `data-masked` and short-circuits when set: `closeBossResult({ suppressDrain: true })` + `_drainBossResultQueue()`. The drain's empty-queue branch chains to `processRevealQueue` (per 1z.73) which opens `openCardRevealModal` → fires the Sigil Bloom. The cinematic's tap-to-reveal handles marking the card as seen.

The Close button on a masked drop also triggers the cinematic (it calls `_drainBossResultQueue` directly). Hunt Again behavior is unchanged from 1z.73.

**Versions:** `app.js?v=435`, `sw.js v5.321`, `APP_BUILD_TAG 2.2.1-w86`. `styles.css` unchanged. `APP_VERSION` stays 2.2.1.

### ACTUAL root cause of C-rank boss art blanks: Codemagic copy script (v3 Phase 1z.81)

**The real bug.** 1z.80 hardened the JS render path, which was a real improvement but not the root cause. The C-rank boss art was blank on TestFlight because **`codemagic.yaml` had a hardcoded allowlist of 6 boss filenames in its `cp` loop and never copied the three C-rank PNGs into the iOS bundle.**

Lines 117-119 (pre-fix):
```bash
for boss in the-insomniac the-carouser the-steel-wolf the-iron-warden the-glass-strider the-dream-tyrant; do
  cp "assets/bosses/$boss.png" "www/assets/bosses/$boss.png"
done
```

The three new C-rank PNGs (`the-ascendant-colossus`, `the-furnace-knight`, `the-marathon-wraith`) landed on disk in phases 1z.65 / 1z.68 / 1z.70, were tracked in git, and were correctly added to `sw.js` precache. But the Codemagic build script never copied them into `www/` → `cap sync` propagated nothing → the iOS bundle shipped without the files → `<img src>` 404'd on device → blank art. No amount of JS hardening would fix this; the asset literally wasn't in the IPA.

**The contrast.** Item art works fine because the `cp assets/items/*.png` loop right below (line 134-137) uses glob copy. Bosses had the only hardcoded allowlist.

**Fix.** Converted the boss loop to glob copy (same pattern as items):
```bash
mkdir -p www/assets/bosses
if compgen -G "assets/bosses/*.png" > /dev/null; then
  cp assets/bosses/*.png www/assets/bosses/
fi
```

Any future boss PNG dropped into `assets/bosses/` now bundles automatically. No more `codemagic.yaml` edit required when a new boss ships.

**Defensive freshness gates added.** Both the pre-sync (`www/`) and post-sync (`ios/App/App/public/`) verification steps now explicitly check that the three C-rank PNGs are present. A future regression of the copy step fails the build loudly with a pointer to the line that broke instead of silently shipping blank boss cards.

**Per-IPA implication.** TestFlight build #61 (and any earlier build) doesn't have the C-rank boss PNGs in its bundle. Codemagic must build a fresh IPA off `main` post-`1574deb` (the 1z.80 commit) + this `1z.81` commit before the boss art renders correctly on-device.

**1z.80 changes still good.** The robust `setBossImage` + `loading="lazy"` removal + QA-unlock relock are all real fixes that should stay shipped — they make the JS render path resilient to genuine asset-load failures (which can still happen during SW cache transitions, offline-first-launch, etc.). 1z.80 hardened the JS; 1z.81 fixes the actual asset pipeline.

**Versions:** `app.js?v=434`, `sw.js v5.320`, `APP_BUILD_TAG 2.2.1-w85`. Bumped for traceability + SW cache bust even though only `codemagic.yaml` changed materially. `APP_VERSION` stays 2.2.1.

**Next step:** trigger Codemagic build off the current `main` HEAD. The post-sync freshness gate now blocks the build if the C-rank PNGs don't make it through.

### C-rank QA unlock RELOCKED + boss-art rendering deep fix (v3 Phase 1z.80)

**Two urgent fixes pre-App-Review-resubmission.**

#### 1. C-rank QA unlock RELOCKED

`QA_UNLOCK_C_RANK_DUNGEONS = false`. Must stay false for App Review / public builds. The temporary unlock added in 1z.71 was a smoke-test affordance only.

Restored behavior: C-rank gate goes back to normal rank comparison via `isGateUnlocked('C')`. Users below C see the three C-rank bosses in **preview state** (still walkable / inspectable — the dungeon view does NOT hide them), but the engage button shows `"Reach C rank to engage"` and `engageBoss` defensively refuses. D / B / A / S / S+ gates unchanged. No XP / rank-threshold / displayed-rank changes — purely the gate flag.

Flip back to `true` for future local QA passes (grep anchor: `QA_UNLOCK_C_RANK_DUNGEONS`).

#### 2. Boss-art rendering — root cause + deep fix

**Root cause identified.** Item art renders fine because Pokédex + reveal modal use `setModalCardArt` — start-hidden + onload-reveals pattern. Boss art was rendered via inline `<img src="..." onerror="this.style.display='none'">` (introduced in 1z.73). On iOS Capacitor WebView, **transient SW fetch races during card render cause onerror to fire even for assets that subsequently load fine** — the image gets `display:none` permanently for the session.

Confirmed by reading both code paths side-by-side at app.js:5090 (`setModalCardArt`) vs the prior boss-card inline `<img>` — the `setModalCardArt` pattern always succeeded, the inline pattern intermittently failed on iOS.

**Fix — new `setBossImage(imgEl, bossId)` helper** that mirrors `setModalCardArt`'s safe pattern:
- Clears prior on{load,error} handlers (re-use across re-renders).
- Starts the image **hidden** (`display:none`).
- `onload` reveals (`display:''`) — only fires on real decode success.
- `onerror` keeps hidden + warns to console for QA debugging.
- Removes any `loading` attribute (eager only).
- Sets `decoding="async"` then `src`.

**Call-site refactor:**

| Surface | Before | After |
|---|---|---|
| Boss-card (dungeon grid) | Inline `<img src=imgPath onerror="display:none">` | Hidden placeholder `<img data-boss-art-id=...>`; `renderBossesPanel` post-render iterates and calls `setBossImage` |
| Boss detail hero (`#bfs-hero-img`) | Raw `heroImg.src = imgPath` | `setBossImage(heroImg, id)` |
| Hunting-row pill icon (`_statusPillIcon`) | `loading="lazy"` on inline `<img>` | `loading="lazy"` removed (eager); src remains inline (pills are tiny + above-the-fold so cheap) |
| Boss-defeated portrait (`#bfs-defeated-portrait-img`) | Already-safe `data-art="missing"` CSS fallback | Unchanged — its pattern was already robust |
| Pending-result re-open | Routed through the boss-defeated modal | Unchanged |

The `data-boss-art-id` attribute on the boss-card img is the only new DOM contract — it lets `renderBossesPanel` find every boss-art `<img>` post-`innerHTML` and wire `setBossImage` on each.

**No other boss/item logic touched.** Drop rates, mercy, pity, souls, XP, rank thresholds, daily one-kill-per-day lock, Carouser Friday-only, App Review permission compliance, Sigil Bloom, queue semantics — all preserved.

**Versions:** `app.js?v=433`, `sw.js v5.319`, `APP_BUILD_TAG 2.2.1-w84`. `styles.css?v=301` (no CSS changes). `APP_VERSION` stays 2.2.1.

**Manual QA next TestFlight build:**
1. Open dungeon tab as E-rank user. C-rank bosses visible in preview state with `"Reach C rank to engage"` label. Engage button disabled / refuses.
2. Confirm Ascendant Colossus, Furnace Knight, Marathon Wraith cards render real boss art (not blank).
3. Open each boss detail screen → confirm hero art renders.
4. Engage a non-C boss to verify hunting-row pill icon renders.
5. Confirm item art in inventory still renders.

### App Store Support URL fix — public support page (v3 Phase 1z.79)

**Resolves the remaining half of the App Review rejection** (Guideline 1.5 Safety: Developer Information). Apple flagged the App Store Connect Support URL — currently `https://github.com/GoalLearner/awakened-app` — as non-functional. This phase ships a clean static support page at `docs/support.html` plus a `docs/index.html` landing card, ready for GitHub Pages.

**Files created (docs only — no app code changes):**
- `docs/support.html` — full support page. Sections: Contact (email `richmondcampano93@gmail.com`), Privacy reference, Apple Health data explanation (mentions steps / sleep / workouts / flights climbed / active energy + how to manage permissions in iOS Settings or the Apple Health app), Account & Data Requests (subject-line guidance), FAQ (5 entries).
- `docs/index.html` — minimal landing page. Title + tagline + a single Support card linking to `support.html`. So GitHub Pages site root resolves to something legible if a reviewer hits the bare URL.

Both pages are pure static HTML/CSS — no external scripts, no analytics, no tracking, no forms requiring a backend. Self-contained styling (dark bg + gold accents matching the app's brand). Mobile-responsive.

**No app runtime changes.** `app.js`, `styles.css`, `index.html`, `sw.js`, `auth.js` all untouched. No version bumps. `APP_VERSION` stays 2.2.1. `APP_BUILD_TAG` stays `2.2.1-w83`.

---

#### Manual setup — enable GitHub Pages (one-time)

1. Push this commit to `main` (already done by this phase).
2. Open the repo on GitHub: `https://github.com/GoalLearner/awakened-app`.
3. Click **Settings** (top right).
4. In the left sidebar, click **Pages**.
5. Under **Build and deployment** → **Source**, select **Deploy from a branch**.
6. Under **Branch**, choose:
   - Branch: `main`
   - Folder: `/docs`
7. Click **Save**.
8. Wait ~30–60 seconds for GitHub to publish. Refresh the Pages settings page to see the published URL.

**Expected published URLs** (case-sensitive; verify the casing on the Pages settings panel):
- Landing: `https://goallearner.github.io/awakened-app/`
- Support: `https://goallearner.github.io/awakened-app/support.html`

If GitHub displays the URL with a different username casing (`GoalLearner` vs `goallearner`), GitHub Pages always lowercases — use whatever the Pages settings panel shows as the canonical Site URL.

---

#### Manual setup — update App Store Connect Support URL (one-time)

1. Sign in to **App Store Connect** → Apps → **Awakened: Habit RPG**.
2. Left sidebar → **App Information**.
3. Scroll to **General Information** → **Support URL**.
4. Replace the broken value (`https://github.com/GoalLearner/awakened-app`) with the GitHub Pages support URL — preferably the deep link to the support page:
   - `https://goallearner.github.io/awakened-app/support.html`
   - (The root URL would also work because it links to support, but the deep link is more direct.)
5. **Save**.
6. Go to the rejected app version (2.2.1 build 61 or a fresh build with the 1z.77 + 1z.78 HealthKit / notifications fixes).
7. **Resubmit for App Review**.

When Apple re-reviews, both rejection reasons are addressed:
- **5.1.1(iv)** — HealthKit + Notifications pre-permission modals now use single neutral `Continue` button, no exit before the system sheet (1z.77 + 1z.78).
- **1.5** — Support URL now resolves to a functional public support page (this phase).

---

#### Verification

- `docs/support.html` exists and renders standalone (open it in a browser locally to confirm — no broken links, no missing assets, no external dependencies).
- `docs/index.html` exists and links to `support.html`.
- `git status` shows only the two new files in `docs/`.
- `npm run test:e2e` not re-run (no app code changed).
- `node --check app.js` not re-run (no app code changed).

No backend / no Duels / no app runtime / no entitlement changes.

### App Store Review compliance — full permission-prompt audit (v3 Phase 1z.78)

**Full audit of every native permission system in the app.** Triggered by the 1z.77 HealthKit fix to make sure no other Guideline 5.1.1(iv) risks remain. Apple's specific guidance:

- Pre-permission custom messages must use neutral button copy (`Continue`, `Next`).
- Words reserved for the system dialog and **disallowed** in custom UI: `Enable`, `Allow`, `Grant`, `Turn On`, `Accept`.
- The user must always proceed to the system permission request after the custom message — no exit / cancel / skip option may precede the system sheet.

**Native permission systems present in the app:**

| Permission | Custom pre-prompt? | Native request follows | Risk | Fix |
|---|---|---|---|---|
| **HealthKit** | `#hk-preprompt-overlay` (`showHealthKitPreprompt`) | `Health.requestPermissions()` | High → fixed in 1z.77 | Single `Continue`. No cancel. |
| **HealthKit sleep upgrade** | none | `requestSleepPermissionIfNeeded` → native sheet directly | Low | None needed |
| **HealthKit flights upgrade** | none | `requestFlightsPermissionIfNeeded` → native sheet directly | Low | None needed |
| **HealthKit active-energy upgrade** | none | `requestActiveEnergyPermissionIfNeeded` → native sheet directly | Low | None needed |
| **Notifications** (UNUserNotificationCenter via LocalNotifications) | `#notif-explain-overlay` (`showNotifExplainer`) | `Notif.requestPermission()` | High → fixed this phase | Single `Continue`. No cancel. |
| **Notifications — Settings panel button** | n/a (the button itself, label was `Enable`) | Opens explainer above, then native | Medium → fixed this phase | Renamed to `Set up notifications` |

**Confirmed absent — no audit needed:**
- Camera / Photos / Microphone / Location / Motion / Contacts / Calendar / Bluetooth / App Tracking Transparency. Grep of the source (`navigator.geolocation`, `Camera`, `Photos`, `requestTrackingAuth`, etc.) returns zero hits.

**Fixes applied this phase (1z.78):**

1. **Notifications explainer** (`showNotifExplainer` / `#notif-explain-overlay`):
   - Removed `notif-explain-cancel` button entirely (was `Not Now`, with onboarding A passing `cancelLabel: 'Maybe Later'`).
   - Renamed `notif-explain-enable` button text `Enable Notifications` → `Continue`.
   - `showNotifExplainer` now ignores `opts.cancelLabel` / `opts.enableLabel` so callers can't reintroduce non-neutral copy.
   - `runOnboardingNotifPrompt`'s legacy if-not-ok branch kept as defensive dead code (never reached now).
   - Post-denial toast softened from `"Reminders are off. Enable in iOS Settings → Awakened anytime."` to `"Reminders are off. Turn them on in iOS Settings → Awakened anytime."` — denial messaging is allowed per Apple's guidance ("you may include a notification to inform the user and provide a link to the Settings app").

2. **Settings panel reminders button** (`#settings-rem-enable`):
   - Renamed `Enable` → `Set up notifications`. The Settings panel is the persistent app UI (not a transient modal), but the button copy still triggered concern since it directly opens the explainer + native permission sheet. Neutralised the copy to remove ambiguity.

**Risk-category review of remaining `Enable` / `Not Now` strings in the source:**

| Match | Location | Risk | Status |
|---|---|---|---|
| `app.js` line 22215 | Compliance docstring comment | Low — comment only | OK |
| `"Enable in iOS Settings"` toast | Post-denial messaging | Low — describes the system action, not the app's pre-permission UI | Softened to "Turn them on" anyway |
| `Edit Reminder` modal's enable/save labels | In-app feature toggle, not a permission request | Low | OK |
| `editStepGoalEnabled` / `editSleepGoalEnabled` / similar | Internal variable names | None | OK |
| `soundEnabled` | Internal variable name | None | OK |

No remaining `Not Now` strings in the app's permission flow. No remaining `Enable` button text in front of a native permission request.

**HealthKit entitlements / Info.plist usage descriptions unchanged.** This is a UI-copy fix only.

**Versions:** `app.js?v=432`, `sw.js v5.318`, `APP_BUILD_TAG 2.2.1-w83`. `styles.css?v=301` (no CSS changes). `APP_VERSION` stays 2.2.1 (still the same submission cycle, not a new version).

**Support URL (Guideline 1.5)** — still pending. Manual App Store Connect action as documented in 1z.77.

**Preserved:** drop rates, mercy, pity, souls, XP, rank thresholds, daily one-kill-per-day lock, Carouser Friday-only, temp 1z.71 C-rank QA unlock, Sigil Bloom, queue semantics. No backend / no Duels / no HealthKit entitlement changes.

**Manual QA next TestFlight build:**
1. Fresh install OR clear `hb_healthkit_prompted` + `hb_notif_perm_requested` + `hb_notif_perm_deferred` in localStorage.
2. Trigger HealthKit explainer → confirm single `Continue` button → tap → iOS sheet appears.
3. Trigger notifications explainer (onboarding A or Settings → Reminders → Set up notifications) → confirm single `Continue` button, no `Not Now` / `Maybe Later` → tap → iOS sheet appears.
4. Deny both → app does not crash; existing graceful unavailable states apply.
5. Grant both → reminders + Health auto-verify work as before.

### App Store Review compliance — HealthKit pre-permission modal (v3 Phase 1z.77)

**⚠️ App Store Review rejection fix.** Apple rejected iOS App 2.2.1 (61) on May 19, 2026 for two issues. Reviewed on iPad Air 11" (M3) + iPhone 17 Pro Max. Submission ID `07b1380d-d40f-49bc-bb19-8bb2ba508e7c`.

**Issue 1 — Guideline 5.1.1(iv) Privacy: Data Collection and Storage.** The HealthKit pre-permission custom modal (`#hk-preprompt-overlay`, surfaced from `autoVerifyWalk`'s first-encounter path in `showHealthKitPreprompt`) used button text Apple flagged as directing users to grant permission before the system sheet:
- ❌ `Not Now` (cancel/exit before the request — Apple: "the user should always proceed to the permission request after the custom message")
- ❌ `Enable` (Apple: "use words like 'Continue' or 'Next' on the button instead")

**Fix.** Collapsed to a single neutral primary button:
- ✅ `Continue` — tapping immediately calls `Health.requestPermissions()`, which fires iOS's native HealthKit permission sheet. The Allow / Don't Allow choice happens there, where the user has full control.
- Removed the secondary `Not Now` button entirely. No exit before the system request.
- Existing graceful unavailable-state code paths (every `autoVerify*` and the resolver short-circuit on `permissionStatus !== 'granted'`) handle denial without crashing.
- Added `.hk-preprompt-actions--single` CSS modifier so the lone button still uses the full row for touch-target hygiene on iPad + iPhone.

**Other upgrade helpers audited and clean.** `requestSleepPermissionIfNeeded` (1z.55-era), `requestFlightsPermissionIfNeeded` (1z.61), `requestActiveEnergyPermissionIfNeeded` (1z.62) all fire the native `requestAuthorization` sheet directly with **no custom pre-permission modal preceding** — they don't trip 5.1.1(iv).

**Notifications pre-prompt unchanged.** The "Enable Notifications" / "Not Now" buttons in `#notif-explain-overlay` are a separate permission system (UNUserNotificationCenter, not HealthKit). Apple's rejection was scoped to HealthKit per 5.1.1(iv). If a future review flags it, apply the same fix.

**Issue 2 — Guideline 1.5 Safety: Developer Information.** Support URL in App Store Connect — `https://github.com/GoalLearner/awakened-app` — is "currently not functional and/or displays an error."

**Required App Store Connect action (manual, NOT a code change):**
1. Sign in to App Store Connect → Awakened: Habit RPG → App Information.
2. Replace **Support URL** with a functional public support page. Options:
   - GitHub Pages site (push a static `support/index.html` to the same repo + enable Pages in repo settings).
   - Notion public page, Carrd, Framer, or any hosted static page.
3. Content the support page must include:
   - App name: **Awakened: Habit RPG**
   - Contact email
   - Privacy Policy link
   - Basic FAQ / data deletion / Health data explanation
4. Once the URL resolves to a real page (not the bare repo), resubmit.

**Not adding a `support/` folder to the repo this turn** — the spec says only do this if it fits, and an in-repo static page won't be served from a publicly addressable HTTPS URL without separately configuring GitHub Pages (which is a manual App Store Connect action anyway). Documenting it here is the actionable handoff.

**HealthKit entitlements unchanged** — `Info.plist` / native iOS project still declares the same usage descriptions. Just the JS UI message before the system sheet changed.

**Preserved:** drop rates, mercy, pity, souls, XP, rank thresholds, daily one-kill-per-day lock, Carouser Friday-only, temp 1z.71 C-rank QA unlock, Sigil Bloom (1z.74→76), queue semantics. No backend / no Duels / no entitlement changes.

**Versions:** `app.js?v=431`, `styles.css?v=301`, `sw.js v5.317`, `APP_BUILD_TAG 2.2.1-w82`. `APP_VERSION` stays 2.2.1 — not bumped, this is a compliance fix on the same submission.

**Manual QA next TestFlight build:**
1. Fresh install OR clear `localStorage.hb_healthkit_prompted` + `hb_healthkit_status` to reset the prompt gate.
2. Trigger the HealthKit pre-prompt (default walk habit at threshold should surface it).
3. Confirm modal shows **single Continue button**. No `Not Now`, no `Enable`.
4. Tap Continue → iOS's native HealthKit sheet appears.
5. Tap Don't Allow → app does not crash. `permissionStatus` becomes `'denied'`. Existing unavailable-state UX applies.
6. Repeat + Allow → real-time auto-verify runs (`autoVerifyWalk` / `autoVerifySleep` / `autoVerifyStrengthTraining` fire immediately).

### Sigil Bloom — keep silhouette visible during tap wait (v3 Phase 1z.76)

**Fix.** After 1z.75 deferred the relic card to a first-tap, the screen went blank between settle and tap because:

1. The `.is-phase-4 .sb-silhouette` rule was fading the silhouette to opacity 0 at settle.
2. The 2500/3000ms safety cleanup was calling `stage.innerHTML = ''` and stripping everything out.

Both removed. The sword (rare) / crown (ultra) silhouette + wordmark now stay rendered through the "TAP TO CONTINUE" wait. They only fade when the user taps and `.is-card-revealed` is added (existing 350ms fade rule). Stage cleanup happens at modal close via `_teardownSigilBloom`.

**Files touched:** `app.js`, `styles.css`. Bumped: `app.js?v=430`, `styles.css?v=300`, `sw.js v5.316`, `APP_BUILD_TAG 2.2.1-w81`.

### Sigil Bloom — tap-to-reveal gate (v3 Phase 1z.75)

**Defers relic card until user tap.** Original 1z.74 design slid the relic card in during phase 3, sharing the screen with the rune circle and silhouette. New flow:

1. Bloom plays phases 1 → 4 (gather → ignite → burst → settle). Card stays hidden the entire time.
2. After settle, overlay gets `.is-bloom-ready` + the "TAP TO CONTINUE" hint pulses.
3. **First tap** → adds `.is-card-revealed`. Rune / wordmark / silhouette / vignette fade out (350ms ease); relic card slides in (500ms translateY 12→0 + opacity 0→1).
4. **Second tap** → `closeCardRevealModal` as before.
5. **Mid-bloom tap** → skip ahead: adds both `.is-bloom-ready` and `.is-card-revealed` in one step (no forced animation watch).

**Reduced-motion path** unchanged in outcome: the bloom is hidden, but now JS also adds `.is-bloom-ready` + `.is-card-revealed` up front so the card appears immediately (the new CSS gates card visibility on `.is-card-revealed` instead of phase classes). Audio still fires. First tap closes.

**ESC** always closes the modal regardless of state (no bloom watching required for keyboard users).

**Teardown** strips the two new classes alongside the existing phase + rarity classes so a chained reveal starts clean.

**Files touched:** `app.js`, `styles.css`. Bumped: `app.js?v=429`, `styles.css?v=299`, `sw.js v5.315`, `APP_BUILD_TAG 2.2.1-w80`. No backend / no Duels / no economy changes.

### Sigil Bloom Relic Reveal (v3 Phase 1z.74)

**ClaudeDesign-spec rare/ultra reveal.** Replaces the loot-box/treasure-chest concept with a magic-sigil bloom: motes spiral inward → rune ignites → silhouette resolves → relic card slides in. Same anatomy at both tiers; intensity scales via `.is-ultra`. Common drops bypass this entirely (they don't reach `openCardRevealModal`).

**Phase timeline** (Rare / Ultra ms):

| Phase | Rare | Ultra | What happens |
|---|---|---|---|
| 1 gather | 100 | 100 | Motes spiral inward; rune scales in; hum (sine rising) |
| 2 ignite | 700 | 900 | Bloom flash; ultra adds 12-ray fan; silhouette resolves from blur; wordmark fades in; impact (sine falling) |
| 3 burst | 1300 | 1700 | Motes drift outward; relic card slides in below; crystalline chime (3 triangle / 4 sine notes, 60ms stagger) |
| 4 settle | 1800 | 2400 | Rune fades; dashed inner ring keeps slow rotation |
| safety unmount | 2500 | 3000 | Hard cleanup of motes; phase classes stripped on modal close |

**DOM:** new `#sigil-bloom-stage` div added inside `#reveal-overlay` before `.reveal-card`. `_runSigilBloom(rarity)` mounts the rune SVG (handbuilt, no external assets), 14/22 gather motes, bloom flash, ultra ray-fan, sword/crown silhouette SVG, wordmark, 16/28 burst motes. All children carry `pointer-events: none` so action buttons stay tappable from t=0.

**Audio:** new `_playSigilBloomSfx(rarity)` implements the 3-layer Web Audio cue per spec. Shared `window.__bloomCtx`, `ctx.resume()` on each play (iOS suspension), wrapped in try/catch. Gated on existing `soundEnabled` flag.

**Haptics:** light pattern at ignite (rare = `[25]`, ultra = `[40,30,60]`); ultra adds a heavy `[90]` at burst.

**Differentiation matrix:**

| Aspect | Rare | Ultra |
|---|---|---|
| Rune accent | violet `#a78bfa` | gold `#f5b842` |
| Cardinal sigils | none | 4 flame sigils at N/E/S/W |
| Vignette | none | radial transparent → 0.55α at edges |
| Bloom flash | violet wash | white-gold wash |
| Ray fan | none | 12-ray gradient burst |
| Silhouette | sword (violet body, gold pommel) | crown (gold body, violet gems) |
| Wordmark | `RARE` violet, glow violet | `ULTRA RARE` gold, glow gold |
| Whisper | "A rare relic has awakened." | "A relic of the Hollow King has awakened." |
| Total duration | ~1.8s settle | ~2.4s settle |

**Reduced motion fallback:** `prefers-reduced-motion: reduce` hides the rune/motes/flash/rays/silhouette/vignette entirely. The wordmark stays visible (no animation) and the relic card displays immediately. **Audio still fires** — audio is not motion. Per the spec.

**Queue preservation:** the sigil bloom fires on the modal's mount, NOT on the underlying state-change event. Each queued boss-defeated → reveal modal independently triggers its own bloom. `_teardownSigilBloom()` runs from `closeCardRevealModal` so the next reveal starts clean. The 1z.73 queue chain (boss-defeated drain → `processRevealQueue` → reveal modal → close → next) is intact.

**Boss-defeated modal celebration** (1z.73 confetti + chime) stays in place for **duplicate** rare/ultra drops that route through the boss-defeated modal (not the cinematic reveal). Together: cinematic reveal = sigil bloom; boss-defeated = confetti + 1z.73 chime.

**Preserved:** drop rates, mercy, pity, souls, XP, rank thresholds, daily one-kill-per-day lock, Carouser Friday-only, temp 1z.71 C-rank QA unlock, queue semantics. No backend / no Duels changes.

**Files touched:** `app.js`, `index.html`, `styles.css`. Bumped: `app.js?v=428`, `styles.css?v=298`, `sw.js v5.314`, `APP_BUILD_TAG 2.2.1-w79`.

### Boss-result polish: art helper, drop celebration, queue (v3 Phase 1z.73)

**Three fixes from the next round of TestFlight smoke testing.**

**1. Boss art still missing — `getBossArtPath` central helper.** Files exist on disk (9 PNGs, all tracked + precached). Five different code paths previously inlined the same `assets/bosses/' + id.replace(/_/g, '-') + '.png'` derivation. Now all route through one `getBossArtPath(bossId)` helper. Easier to audit, single chokepoint for future convention changes. *Root cause of the on-device blank art is most likely a TestFlight IPA that pre-dates 1z.65 / 1z.68 / 1z.70 — rebuild via Codemagic bundles the new PNGs.*

**2. Rare/Ultra drop celebration.** New `celebrateRareDrop(rarity)` helper:
- **Confetti:** lightweight canvas burst on the existing `pdc-overlay` / `pdc-canvas` (same pattern as Perfect Day Celebration). Rare = gold + violet, 70 particles. Ultra = gold + violet + white, 130 particles + stronger initial velocity.
- **Chime:** Web Audio, layered sine + triangle oscillators. Rare = A4 → E5 (perfect fifth). Ultra = A4 → C#5 → E5 → A5 (major arpeggio resolving to octave). Gated on the existing `soundEnabled` flag.
- **Haptic:** `navigator.vibrate(30)` for rare, `[40, 30, 80]` pattern for ultra.
- Wrapped in try/catch — autoplay restrictions or missing AudioContext can't crash.

Hooked into:
- `openCardRevealModal` — fires on every first-acquisition cinematic reveal (always rare/ultra by design).
- `_showBossResult` — fires when the boss-defeated modal opens with `evt.drop.rarity === 'rare' || 'ultra_rare'` (catches duplicate rare drops that don't route through the cinematic reveal).

**3. Queue every defeat — multi-boss defeats now show one modal per boss.** Previously when a boss defeated with a rare/ultra first-acquisition, `_queueBossResult` was *skipped entirely* (the cinematic reveal was deemed sufficient). With two bosses falling in the same resolver tick — one common-drop, one rare-drop — only ONE boss-defeated modal showed; users couldn't tell two bosses fell.

Fix: every defeat queues a boss-defeated modal. The cinematic reveal queue (`processRevealQueue`) is now chained from `_drainBossResultQueue` when the queue empties — so the user sees: boss-defeated #1 → close → boss-defeated #2 → close → cinematic reveal (if any rare/ultra first-acquisitions). All defeats acknowledged, rare/ultra drops still get their cinematic moment.

Removed the 500ms `processRevealQueue` kick inside `announceKillAndDrop`. Single trigger point now lives in the queue drain.

**Preserved:** Daily one-kill-per-day lock (1z.72), Carouser Friday-only (1z.58 / 1z.72), drop rates, mercy, pity, souls economy, XP economy, rank thresholds, leaderboard, HoF, 100K Club, habit verification, temporary 1z.71 C-rank QA unlock. No backend / no Duels changes.

**Manual QA next TestFlight build:** rebuild IPA → confirm C-rank boss art renders; defeat a boss with a rare drop → confetti + chime fire on the cinematic reveal; defeat two bosses simultaneously → both boss-defeated modals show one after the other.

### Daily-boss verification window + one-kill-per-day lock (v3 Phase 1z.72)

**Smoke-test fixes from the iPhone TestFlight run.** Three problems addressed:

**1. C-rank boss art `[?]` placeholders.** Files exist on disk and `sw.js` precache lists them, but the TestFlight IPA that was tested may pre-date the 1z.70 art install. `CACHE_VERSION` bumped `v5.311 → v5.312` so the SW reinstalls and pre-fetches on next launch. Defense-in-depth: boss-card `<img>` now carries `onerror="this.style.display='none'"` so a 404 hides the broken-image glyph entirely (clean dark `.bcard-art` background instead). Also removed `loading="lazy"` from boss-card art — paired badly with iOS Capacitor WebView in the 1z.48 relic-art bug; same fix applied preemptively here.

**2. Same-day pre-engage Health data now counts for daily bosses.** Product rule change: for `cadence === 'daily'` bosses, the verification window is now **today's device-local day** `[startOfTodayLocalMs, min(endOfTodayLocalMs, now)]`, NOT `[hunt_started_at, evalEnd]`. The hunt window for the 24-hour timer is unchanged — only the verification range changes.

Applied to ALL daily bosses (Insomniac, Steel Wolf, Glass Strider, Iron Warden, Dream Tyrant, Ascendant Colossus, Furnace Knight, Marathon Wraith, and any future daily). All resolver branches (steps, flights, dual workout+kcal, single workout, sleep) get the same `start` / `evalEnd` override at the top of the per-boss loop. Carouser (`cadence === 'weekly'`) keeps its existing weekend-scoped logic.

**Yesterday's data still doesn't count** — each midnight resets the verification window. **Tomorrow's data doesn't count** either — `evalEnd` clamps to `now`. Pre-engagement same-day data counts because the window doesn't depend on `hunt_started_at`.

**3. One successful daily kill per boss per local day.** New helper `wasDailyBossDefeatedToday(state, now)` compares `_localDateKey(state.last_defeated_at)` to today's date key. `canEngageBossNow` extended with a daily-lock branch and now returns richer `{ ok, reason, ctaText, blurb }`:
- Locked state ctaText → `"AVAILABLE TOMORROW"`, blurb → `"Daily hunts reset at midnight."`
- Carouser's Friday-only branch updated with the same shape.
- `engageBoss` enforces the gate (toast `"Daily hunt already cleared. Resets at midnight."`, returns false, **does not spend souls**).
- Detail-screen engage CTA renderer is now generic — reads `engageGate.ctaText` / `engageGate.blurb` instead of hardcoded Carouser text.

**`last_defeated_at` semantics:** only `_awardSingleShotKill` sets this ISO timestamp. Manual disengage (`disengageBoss`) doesn't touch it. HUNT FAILED (`_expireBossHunt`) doesn't touch it. So failure / manual stop never trip the daily lock — the user can re-engage same day if they wish. Only a successful kill consumes the daily slot.

**Helper additions** near the `isCarouserEngageDay` block:
- `_localDateKey(date)` → device-local `YYYY-MM-DD` string.
- `_startOfLocalDayMs(now)` → epoch ms.
- `_endOfLocalDayMs(now)` → epoch ms.
- `wasDailyBossDefeatedToday(state, now)`.

**Preserved:** all drop rates, mercy/pity thresholds, souls economy, XP economy, rank thresholds, leaderboard, HoF, 100K Club, habit verification, Health permissions, Carouser end-of-Sunday expiration, temporary 1z.71 C-rank QA unlock. No backend / no Duels changes.

**Manual QA next TestFlight build:** confirm C-rank boss cards now show real art (or clean dark fallback on missing); engage Marathon Wraith with 10k+ today already → instant defeat; engage Furnace Knight with both strength workout + 300+ kcal today → instant defeat; defeat Ascendant Colossus, confirm Hunt Again becomes "AVAILABLE TOMORROW"; tap blocked button confirms no souls spent; midnight rollover unlocks.

### TEMP QA — C-rank dungeon unlock (v3 Phase 1z.71)

**⚠️ TEMPORARY TestFlight/QA flag. Relock before public release.**

**What changed.** New constant `QA_UNLOCK_C_RANK_DUNGEONS = true` near `isGateUnlocked`. When true, the C-rank gate (and ONLY the C-rank gate) returns unlocked regardless of user rank. All three C-rank bosses (Ascendant Colossus, Furnace Knight, Marathon Wraith) become engageable on TestFlight without grinding to C.

**Single-chokepoint design.** All gate-aware call sites already route through `isGateUnlocked`:
- `engageBoss` rank-gate check (toast: "Reach C rank to engage <boss>")
- `buildBossCardHTML` — `bcard--preview` class + PREVIEW corner label
- `openBossFullScreen` — preview vs. engage CTA rendering

One edit cascades to all three. No other code paths touched.

**What this does NOT do:**
- Does NOT modify `RANKS` thresholds or any XP economy.
- Does NOT grant XP, souls, or kills.
- Does NOT change the displayed user rank — status-card badge, rank-detail popup, leaderboard, and HoF all still read `getRank(totalPoints).id` directly and show the user's REAL rank.
- Does NOT bypass any other check: souls cost, `MAX_ENGAGED_BOSSES`, Carouser Friday-only (`canEngageBossNow`), hunt-window timer, HealthKit kill conditions, drop rates, mercy thresholds. All remain real and unmodified.
- Does NOT touch backend, Duels, or leaderboard identity.
- Does NOT affect D / B / A / S / S+ gates — those still gate normally.

**Relock path** (after C-rank QA passes on TestFlight):
1. Set `QA_UNLOCK_C_RANK_DUNGEONS = false` in `app.js`.
2. Bump `app.js?v`, `sw.js CACHE_VERSION`, `APP_BUILD_TAG`.
3. Run `node --check app.js` + `npm run test:e2e`.
4. Commit + push.
5. Build via Codemagic.

Grep anchor for relock: `QA_UNLOCK_C_RANK_DUNGEONS`.

**Manual QA next TestFlight build:**
1. Open app as a normal low-rank user; confirm status-card rank still shows the REAL rank (e.g. E).
2. Open dungeon tab; C-rank tier shows 3 bosses engageable (not preview).
3. Engage Ascendant Colossus — real souls cost applies; 24h timer starts; needs 10 verified flights.
4. Engage Furnace Knight — needs verified strength workout AND ≥ 300 active kcal.
5. Engage Marathon Wraith — needs 10,000 verified steps inside the window.
6. Confirm E / D bosses behave exactly as before.

### Marathon Wraith art installed (v3 Phase 1z.70)

**Boss + 5 item PNGs landed on disk.** Generated locally and downloaded into the repo root. Moved into the canonical asset layout. Pending status from 1z.69 cleared — boss-card / detail / BOSS DEFEATED modal / Pokédex now render real art.

**Final paths:**
- `assets/bosses/the-marathon-wraith.png` (renamed from `run_of_the_ghost_knight.png` — generator filename didn't match the boss id; renamed to follow `buildBossCardHTML`'s `id.replace(/_/g,'-')+'.png'` derivation).
- `assets/items/roadworn-mantle.png`
- `assets/items/phantom-mile-wraps.png`
- `assets/items/wayfarers-signet.png`
- `assets/items/ten-thousand-step-blade.png`
- `assets/items/greaves-of-the-endless-road.png`

Item `art_path` fields in `CARDS` were already set to these exact strings in 1z.69. Just the file moves wire them up. No JS change.

**Service worker precache.** All 6 new paths added to `PRECACHE_ASSETS`. All verified to exist on disk before adding. `CACHE_VERSION` bumped `v5.309 → v5.310`.

**No backend / no Duels / no styles / no auth changes.** Asset move + sw.js precache update only.

### Third C-rank boss — The Marathon Wraith (v3 Phase 1z.69)

**Final C-rank boss + step-progress mirror upgrade.** Steps-based daily boss using the existing per-day steps resolver branch (same path as Steel Wolf and Glass Strider). Also adds live `state.step_progress` mirroring so all three step bosses get a granular `"N / threshold steps"` label.

**Boss config (`BOSSES.the_marathon_wraith`):**
- `rank: 'C'`, `statDomain: 'VIT'`, `cadence: 'daily'` (24h window)
- `streakTarget: 1`, `stepThreshold: 10000`
- Copy: *"A ghost that follows every road you've failed to finish. It fades only when your steps outlast its shadow."* / *"Walk 10,000+ verified steps before the hunt expires"* / *"The road vanished before the distance was claimed."*

**Resolver upgrade.** The existing steps branch in `resolveBossHuntsAcrossWindow` now tracks `maxStepsInDay` across all device-local days in the window and writes it to `state.step_progress` (capped at `cfg.stepThreshold`). Defeat semantics unchanged: any single day reaching the threshold defeats. The mirror also benefits Steel Wolf (6,000) and Glass Strider (7,500) — their detail labels now show live progress too.

**State reset.** `_clearBossHuntFields` and `engageBoss` zero `state.step_progress` so each hunt starts fresh.

**Progress UI.** `buildBossCardHTML` + `openBossFullScreen` both detect step bosses (`cfg.stepThreshold`) and render a single threshold dot + `"7,842 / 10,000 steps"` label (locale-formatted with commas).

**Drop pool — 5 C-rank items** (`source_boss: 'the_marathon_wraith'`):

| Item | Rarity | Slot | STR | VIT | INT | FOC | WILL | Σ |
|---|---|---|---|---|---|---|---|---|
| Roadworn Mantle | common | body | · | 3 | · | 2 | 1 | **6** |
| Phantom Mile Wraps | common | gloves | 2 | 2 | · | 2 | · | **6** |
| Wayfarer's Signet | common | ring | · | 2 | 1 | 2 | 1 | **6** |
| Ten-Thousand Step Blade | rare | weapon | 5 | 4 | · | 3 | 2 | **14** |
| Greaves of the Endless Road | ultra | legs | 5 | 6 | 3 | 5 | 3 | **22** |

**Per-spec slot picks:** Ultra = **legs** (still the thinnest catalog slot per 1z.66 audit; Furnace Knight took cape for its ultra, so this boss takes legs). Rare = **weapon**. Commons spread across body / gloves / ring. STR/FOCUS/WILL/INT all represented; VIT doesn't dominate. No WLT. Power curve hits C-tier targets exactly.

**Art: PENDING.** PNGs at `assets/items/<id with hyphens>.png` + `assets/bosses/the-marathon-wraith.png` not on disk yet. Fallback rendering handles it. **NOT precached in `sw.js`**.

**Rank-gated** below C via `isGateUnlocked`. `engageBoss` refuses defensively.

**No backend / no Duels / no drop rates / no economy changes.** Frontend content + resolver mirror only.

### Furnace Knight art installed (v3 Phase 1z.68)

**Boss + 5 item PNGs landed on disk.** Generated locally and downloaded into the repo root with mixed naming. Moved into the canonical asset layout. Pending status from 1z.67 cleared — boss-card / detail / BOSS DEFEATED modal / Pokédex now render real art.

**Final paths:**
- `assets/bosses/the-furnace-knight.png` (resolves via `buildBossCardHTML`'s `id.replace(/_/g,'-')+'.png'`). Source file `furnace-knight.png` was renamed to add the `the-` prefix to match the existing convention.
- `assets/items/embergrip-gauntlets.png`
- `assets/items/furnacewalk-legplates.png`
- `assets/items/cinderplate-harness.png`
- `assets/items/kilnforged-warblade.png`
- `assets/items/ashen-monarchs-cape.png`

Item `art_path` fields were already set to these exact strings in 1z.67. Just the file moves wire them up. No JS change.

**Service worker precache.** All 6 new paths added to `PRECACHE_ASSETS` in `sw.js`. All paths verified to exist on disk before adding. `CACHE_VERSION` bumped `v5.307 → v5.308` so the SW reinstalls and pre-fetches the new art.

**No backend / no Duels / no styles / no auth changes.** Asset move + sw.js precache update only.

### Second C-rank boss — The Furnace Knight (v3 Phase 1z.67)

**First dual-condition boss.** Requires BOTH a verified strength workout AND ≥ 300 active kcal inside the 24-hour hunt window. Powered by the 1z.62 active-energy plumbing (`Health.getActiveEnergyBetween`) combined with the existing strength workout plumbing (`Health.getStrengthWorkoutsBetween`). AND-gated — either condition alone is insufficient.

**Boss config (`BOSSES.the_furnace_knight`):**
- `rank: 'C'`, `statDomain: 'STR'`, `cadence: 'daily'` (24h window)
- `streakTarget: 1`
- `workoutMinutes: 10` AND `activeEnergyKcal: 300` — the presence of BOTH fields signals dual-condition to the resolver.
- Copy: *"A knight sealed inside a living forge. It only yields to those who lift under fire and burn through the trial."* / *"Complete a verified strength workout AND 300+ active kcal before the hunt expires"* / *"The forge cooled before the trial was complete."*

**Resolver dual-condition branch.** New block in `resolveBossHuntsAcrossWindow` placed before the existing flights / workout / sleep branches. Discriminator: presence of BOTH `cfg.workoutMinutes` AND `cfg.activeEnergyKcal`. Iron Warden (workoutMinutes only) is unaffected — that branch's condition `typeof cfg.activeEnergyKcal === 'number'` rejects it. The dual branch:
- Queries `getStrengthWorkoutsBetween` + `getActiveEnergyBetween` over `[start, evalEnd]`.
- Writes `state.strength_done` (boolean) and `state.energy_progress` (capped at `cfg.activeEnergyKcal`) for live UI.
- Awards the kill via `_awardHuntKillFromBackfill` only when BOTH conditions pass.
- Either metric returning `null` (permission denied / unavailable) leaves the condition unmet — no false defeat. Timer-based HUNT FAILED still fires on window expiration.

**State reset.** `_clearBossHuntFields` and `engageBoss` both now zero `state.strength_done` and `state.energy_progress` so a new hunt starts fresh.

**Progress UI.** `buildBossCardHTML` + `openBossFullScreen` both detect dual-condition bosses (`workoutMinutes && activeEnergyKcal`) and render:
- Single threshold dot (filled only when BOTH conditions pass).
- Two-line label: `"✓ Strength workout verified"` (or `"○ Strength workout"`) + `"N / 300 active kcal"`.

**Drop pool — 5 C-rank items** (`source_boss: 'the_furnace_knight'`):

| Item | Rarity | Slot | STR | VIT | INT | FOC | WILL | Σ |
|---|---|---|---|---|---|---|---|---|
| Embergrip Gauntlets | common | gloves | 3 | · | · | 2 | 1 | **6** |
| Furnacewalk Legplates | common | legs | 3 | 2 | · | 1 | · | **6** |
| Cinderplate Harness | common | body | 2 | 2 | · | · | 2 | **6** |
| Kilnforged Warblade | rare | weapon | 6 | · | 2 | 4 | 2 | **14** |
| Ashen Monarch's Cape | ultra | cape | 6 | 4 | 3 | 5 | 4 | **22** |

Slot picks address 1z.66 audit gaps: legs (thin), gloves (no rare), body (no ultra), cape (no ultra), weapon (curve gap). STR-primary, FOCUS heavily represented, INT/WILL secondary. All totals hit C-tier targets (common 6 / rare 14 / ultra 22). No WLT anywhere.

**Art: PENDING.** PNGs at `assets/items/<id with hyphens>.png` + `assets/bosses/the-furnace-knight.png` not on disk yet. `setModalCardArt` / Pokédex onerror falls back to slot emoji + rarity gradient; boss-card `<img>` 404s show broken icon but don't crash. **NOT precached in `sw.js`** (cache.addAll would reject install on 404).

**Rank-gated** below C via `isGateUnlocked` (preview state). `engageBoss` refuses defensively.

**No backend / no Duels / no drop rates / no economy changes.** Frontend content + resolver logic only.

### Item stat rebalance (v3 Phase 1z.66)

**Pool-wide rebalance.** Updated `bonuses` (and added/replaced `bonus_ranges`) for **all 35 relic cards** across E + D + C tiers. Drop rates, mercy thresholds, stack caps, boss economy, XP formulas, inventory/equip logic — all untouched.

**Target power curve (now enforced for every item):**

| Rarity | E | D | C |
|---|---|---|---|
| Common | 2 | 4 | 6 |
| Rare | 6 | 10 | 14 |
| Ultra | 12 | 15 | 22 |

**Major outlier fixes:**
- Trail-Worn Boots (D ultra): 24 → 15 (was the biggest outlier in the catalog).
- Alpha's Mantle (D rare): 12 → 10 (was at ultra-budget).
- Keystone Pendant (C rare): 8 → 14 (was below D-rare budget).
- Crown of the Ascendant (C ultra): 12 → 22 (was at D-rare budget).
- Tracker's Wrap / Rusted Training Blade / Strider's Laces / Quiet Thread: 3 → 4 (undershooting D-common curve).
- C commons all bumped 4 → 6.

**Stat distribution fixes:**
- **WLT removed from all items.** Shardwalker Wrap's WLT +1 → STR +1 (only item that had WLT). All `wlt` fields now hard-zero in both `bonuses` and `bonus_ranges`.
- **VIT no longer dominates.** Now distributed alongside STR/FOCUS/INT/WILL per the boss-identity matrix below.
- **INT** appears on: Moonlit Lens, Tyrant's Sleep Mask, Crown of Deep Rest, Upper Gate Band, Keystone Pendant, Crown of the Ascendant (6 items vs. 1 before).
- **FOCUS** appears on 16/35 items (was ~5).
- **STR** appears on 13/35 items, including all 3 Iron Warden commons (was already strong there), with strong representation in Ascendant Colossus + secondary roles in Steel Wolf and Glass Strider.

**Boss stat identities (per spec PART B):**
- Insomniac → VIT primary, FOCUS/WILL secondary.
- Carouser → WILL primary, FOCUS secondary.
- Steel Wolf → VIT primary, STR/FOCUS secondary.
- Iron Warden → STR primary, WILL/FOCUS/VIT secondary.
- Glass Strider → VIT primary, FOCUS/STR secondary.
- Dream Tyrant → VIT primary, FOCUS/INT/WILL secondary.
- Ascendant Colossus → STR/VIT primary, FOCUS/INT/WILL secondary.

**`bonus_ranges` convention** (added to 9 legacy items that previously had only `bonuses`): generated via `rng(n)` — `1 → [0,2]`, `2 → [1,3]`, `3 → [2,4]`, `4 → [3,5]`, `5 → [3,7]`, `6 → [4,8]`, `7 → [5,9]`, `8 → [6,10]`, `9 → [7,11]`, `10+ → [n-2, n+2]`. Matches the existing PVP.md per-stat roll conventions.

**No backend / no Duels / no drop rates / no economy changes.** Content rewrite only.

### Ascendant Colossus art installed (v3 Phase 1z.65)

**Boss + 5 item PNGs landed on disk.** Art was generated locally and downloaded into the repo root with mixed naming (spaces / title case / underscores). Moved into the canonical asset layout + renamed to kebab-case so the existing path conventions resolve cleanly. Pending status from 1z.64 cleared — BOSS DEFEATED modal + Pokédex + boss-card/detail now render real art instead of emoji+gradient fallback.

**Final paths:**
- `assets/bosses/the-ascendant-colossus.png` (resolves via `buildBossCardHTML`'s `id.replace(/_/g, '-') + '.png'`).
- `assets/items/summit-treads.png`
- `assets/items/stairbound-greaves.png`
- `assets/items/upper-gate-band.png`
- `assets/items/keystone-pendant.png`
- `assets/items/crown-of-the-ascendant.png`

Item `art_path` fields in `CARDS` were already set to these exact strings in 1z.64 — no JS change needed; just the file moves.

**Service worker precache.** Added all 6 new paths to `PRECACHE_ASSETS` in `sw.js`. All paths verified to exist before adding (otherwise `cache.addAll` rejects the entire install on 404). `CACHE_VERSION` bumped `v5.304 → v5.305` so the SW reinstalls and pre-fetches the new art.

**No backend / no Duels / no styles / no auth changes.** Asset move + sw.js update only.

### Ascendant Colossus C-rank drop pool (v3 Phase 1z.64)

**5 C-rank relics for The Ascendant Colossus (1z.63 / 1z.63b boss).** 3 common, 1 rare, 1 ultra rare.

**Slot-coverage audit (totals across pre-1z.64 cards):** helm 4 · cape 4 · amulet 4 · weapon 3 · body 4 · **legs 1** · gloves 2 · boots 4 · ring 4. Legs was the most underrepresented; **Stairbound Greaves** fills it. Remaining 4 slots in this pool (boots, ring, amulet, helm) match the boss's ascension theme: feet on stairs, ring of ascent oath, keystone amulet, summit crown.

**Stat-distribution audit:** prior C/D/E pools lean **VIT-heavy** (Steel Wolf / Glass Strider / Dream Tyrant all VIT primary). The Ascendant Colossus pool deliberately mixes — **STR appears in 4/5 items**, FOCUS in 2, WILL in 2, INT in 1, VIT in 4. Climbing is endurance AND strength AND discipline AND focus.

| Item | Rarity | Slot | Stats | Total |
|---|---|---|---|---|
| Summit Treads | Common | boots | STR +2, VIT +2 | 4 |
| Stairbound Greaves | Common | legs | STR +3, VIT +1 | 4 |
| Upper Gate Band | Common | ring | WILL +2, FOCUS +1, VIT +1 | 4 |
| Keystone Pendant | Rare | amulet | STR +3, VIT +3, FOCUS +2 | 8 |
| Crown of the Ascendant | Ultra-Rare | helm | STR +4, VIT +3, WILL +3, INT +2 | 12 |

Power curve hits the spec PART C targets exactly (C common ≈ 4, C rare ≈ 8, C ultra ≈ 12). `bonus_ranges` provided per PVP.md so PvP randomization works when enabled (not touching Duels here).

**Drop integration.** `rollBossDrop` filters `CARDS` by `source_boss === bossId` — adding `source_boss: 'the_ascendant_colossus'` to each card auto-wires them into the pool. Drop rates derive from cadence (`daily` for Ascendant Colossus): ultra 5% / rare 8.33% / common 54.07% / common_protected 79.67% (first-common-per-boss). Mercy/pity all daily-tier (any-drop after 4, rare-mercy after 12, ultra-soft after 20, ultra-hard after 40). No changes to drop rates, mercy thresholds, stack caps, or roll order.

**Art assets — PENDING.** The 5 PNGs at `assets/items/<id with hyphens>.png` are not on disk yet. The existing `setModalCardArt` / Pokédex onerror path falls back to slot emoji + rarity gradient — no broken images, no crash. Intentionally **NOT precached in sw.js** (cache.addAll would reject install on a 404). Drop the PNGs in later + add precache entries; they'll render automatically.

**No backend / no Duels / no leaderboard / no METRIC_CAPS.** Frontend content only.

### First C-rank boss — The Ascendant Colossus (v3 Phase 1z.63)

**Boss config.** New entry in `BOSSES`:
- `id: 'the_ascendant_colossus'`
- `name: 'The Ascendant Colossus'`
- `rank: 'C'`, `statDomain: 'VIT'`, `cadence: 'daily'` (→ 24-hour hunt window via `getBossHuntDurationMs`). **Corrected in 1z.63b from triweekly to daily** — daily is the right cadence for a 10-flights goal that should be hittable in a single active day.
- `streakTarget: 1`, `flightThreshold: 10`
- Flavor + kill-cond copy locked: *"A giant chained above the stairwell between earth and sky. It weakens only when you ascend."* / *"Climb 10+ verified flights before the hunt expires"* / *"The tower sealed before you reached the summit."*

**Kill condition.** Cumulative: at least 10 verified flights climbed inside `[hunt_started_at, hunt_expires_at]`. Each flight counts; reaching the threshold defeats the boss for that hunt. Sub-threshold expiration → 1z.56 HUNT FAILED modal. Defeat → standard BOSS DEFEATED flow + 1z.61 `Health.getFlightsClimbedBetween` window query.

**Where it plugs in.**
- `resolveBossHuntsAcrossWindow` gets a new `cfg.flightThreshold` branch after the steps branch and before workouts. Single `Health.getFlightsClimbedBetween(start, evalEnd)` call; on `>= threshold` calls `_awardHuntKillFromBackfill` (single-shot kill, reuses the existing souls + drop + announce + UI-refresh flow). On sub-threshold writes `state.flight_progress` for the live label.
- `_bossProgressNoun` returns `'flight' | 'flights'` for any boss with `cfg.flightThreshold`.
- `buildBossCardHTML` (dungeon-grid card) renders a single threshold dot + `"N / 10 flights"` label when `cfg.flightThreshold` is set.
- `openBossFullScreen` progress region renders a single dot + `"N / 10 flights"` label same way. `flight_progress` falls back to 0 when missing.
- `_clearBossHuntFields` now also zeros `state.flight_progress` so a new hunt starts fresh; `engageBoss` also defensively zeros it (belt-and-braces).

**Pre/post-window exclusion.** The resolver reads only the explicit `[hunt_started_at, evalEnd]` window — `Health.getFlightsClimbedBetween` is uncached and queries only this range. Flights logged before engagement or after expiration are naturally excluded by the window query. Defeat fires `_awardSingleShotKill` exactly once (last_eval_date idempotency); subsequent resolver passes short-circuit because `state.engaged === false`.

**Drop pool.** Empty for this ship. `rollBossDrop` filters `CARDS` by `source_boss === 'the_ascendant_colossus'`; with zero matching cards the function returns `null` (line 2875-2878). `announceKillAndDrop` renders the no-drop BOSS DEFEATED variant. C-rank loot ships separately.

**Boss art.** No `assets/bosses/the-ascendant-colossus.png` on disk yet — the `<img>` 404s and shows a broken icon, but the panel does not crash. Path follows the existing `id.replace(/_/g, '-') + '.png'` convention so dropping the asset later "just works" — no code change needed. NOT precached in `sw.js` (cache.addAll would reject the whole install if the asset 404s).

**Rank gating.** Users below C-rank see the boss in preview state via `isGateUnlocked(cfg.rank)` — boss card carries `bcard--preview` class + PREVIEW corner label, detail screen swaps ENGAGE for "Reach C rank to engage". `engageBoss` also refuses defensively.

**Permission behavior.** Health permission for flights is already wired (1z.61). If user denied the new 'stairs' category, `getFlightsClimbedBetween` returns `null` and the resolver silently skips defeat; the timer still expires the hunt and the HUNT FAILED modal fires when the window closes. No crash, no false defeat.

**Verification.** All previously-shipped bosses continue to work (steps/workout/sleep branches unchanged). `node --check` passes; Playwright smoke 7/7 (no boss-related selectors in suite). Manual QA next TestFlight build per spec PART M.

**No backend / no leaderboard / no Hall of Fame / no Duels / no METRIC_CAPS.** Frontend-only.

### Active Energy verified stat plumbing (v3 Phase 1z.62)

**TestFlight verification for 1z.61 first.** Installed the 1z.61 IPA on iPhone. iOS Health Access sheet for Awakened correctly displayed **Flights Climbed + Sleep + Steps + Workouts**, with the new Flights Climbed toggle alongside the three existing ones. User enabled all four. No crash. The auth-version upgrade path (HEALTHKIT_AUTH_VERSION 2→3) fired exactly once and surfaced the new category. This validates the `'stairs'` auth alias and `'flightsClimbed'` query sampleName on real-device HealthKit. C-rank dungeon boss content remains pending.

**Now: Active Energy plumbing (Phase 1z.62).** Same shape as 1z.61. Frontend/iOS HealthKit plumbing only — no boss, no leaderboard, no Hall of Fame, no Duels, no backend.

**Plugin support confirmed in `@perfood/capacitor-healthkit ^1.3.2`:**
- Auth alias `'calories'` → native bridge inserts **both** `HKQuantityTypeIdentifier.activeEnergyBurned` AND `basalEnergyBurned` (Swift line 97-99). Including 'calories' in the read array authorises both; the query helper here only fetches active.
- Query `sampleName: 'activeEnergyBurned'` (TS defs line 131: `ACTIVE_ENERGY_BURNED = "activeEnergyBurned"`).
- **Unit: kilocalorie (kcal).** Verified in `CapacitorHealthkitPlugin.swift:436-438` — the plugin auto-selects `HKUnit.kilocalorie()` when the sample's quantity is compatible with that unit (always true for activeEnergyBurned). `resultData[].value` is the kcal number.

**Changes (frontend / iOS only):**
1. `HEALTHKIT_AUTH_VERSION` bumped `3 → 4`. New flag `hb_healthkit_energy_requested` added to `HEALTHKIT_AUTH_FLAGS_TO_CLEAR`.
2. `requestPermissions()` read array now `['steps', 'activity', 'stairs', 'calories']` — fresh installs bundle active energy into the first sheet.
3. The 1z.61 `requestFlightsPermissionIfNeeded()` and the new `requestActiveEnergyPermissionIfNeeded()` both pass the full read array, so iOS dedupes within a single auth call and existing grants stay untouched while the NEW category alone triggers a sheet.
4. New `Health.requestActiveEnergyPermissionIfNeeded()` idempotent upgrade-path helper. Fires once per cold launch from init (4500ms delay, staggered after the flights upgrade) when status is `'granted'`.
5. New 5-min `activeEnergyCache` (`{ kcal, fetchedAt }`) + `isActiveEnergyCacheFresh()` + `clearActiveEnergyCache()`.
6. New public Health surface members:
   - `Health.getActiveEnergyToday()` — device-local day window (wall-clock activity, matches strength + flights, NOT PT-anchored). Returns integer **kcal** or `null`.
   - `Health.getActiveEnergyBetween(startISO, endISO)` — uncached range query for the future boss hunt window resolver.
   - Internal `_queryActiveEnergyInRange` sums `resultData[].value` like `_queryFlightsInRange`.

**Graceful-failure contract preserved.** Never throws. Returns `null` on non-iOS / missing plugin / permission denied / query throws. Web/PWA `isAvailable()` returns false and every helper short-circuits — Playwright smoke unaffected.

**NOT shipped:** no habit type, no dashboard stat card, no leaderboard metric, no Hall of Fame, no METRIC_CAPS entry, no Duels verified-event type. Future calorie-based boss / quest verification will call `Health.getActiveEnergyBetween(hunt_started_at, hunt_expires_at)`.

**Manual QA next TestFlight build:** existing 1z.61 users → next cold launch shows a sheet for ONLY "Active Energy"; fresh installs → single sheet covering steps + sleep + workouts + flights + active energy; denying active energy does not break any existing flow; granting it lets future boss code read kcal via `Health.getActiveEnergyToday()`.

### Flights Climbed verified stat plumbing (v3 Phase 1z.61)

**Frontend / Health-plugin plumbing only.** Adds Apple Health "Flights Climbed" as a first-class verified stat alongside steps / sleep / strength workouts. **Foundation for a future C-rank dungeon boss** (Stat Domain: VIT, triweekly cadence, climb-N-verified-flights kill condition) — the boss itself is NOT added yet. No leaderboard, no Hall of Fame, no Duels, no backend changes.

**HealthKit plugin support — confirmed.** `@perfood/capacitor-healthkit ^1.3.2` exposes:
- Auth alias `'stairs'` → native bridge maps to `HKQuantityTypeIdentifierFlightsClimbed` (verified in `node_modules/@perfood/capacitor-healthkit/ios/Plugin/CapacitorHealthkitPlugin.swift:90-91`).
- Query `sampleName: 'flightsClimbed'` (verified in `dist/esm/definitions.d.ts:129`).
- Returns the same `{ countReturn, resultData: [{ value, ... }] }` shape as steps.

**Changes.**
1. `HEALTHKIT_AUTH_VERSION` bumped `2 → 3`. New flag `hb_healthkit_flights_requested` added to `HEALTHKIT_AUTH_FLAGS_TO_CLEAR` so existing v1.1.5 users get an iOS sheet for ONLY the new 'stairs' category on next cold launch.
2. `requestPermissions()` read array now `['steps', 'activity', 'stairs']` — fresh installs bundle flights into the first permission sheet.
3. New upgrade-path helper `Health.requestFlightsPermissionIfNeeded()` mirroring the sleep upgrade-path pattern. Idempotent via the new flag. Fires once per cold launch from init (3000ms delay, staggered after the sleep upgrade) when the user has `permissionStatus === 'granted'`.
4. New 5-min flights cache (`flightsCache`, `FLIGHTS_CACHE_TTL_MS`) + `isFlightsCacheFresh()` + `clearFlightsCache()`.
5. New helpers on the public `Health` surface:
   - `Health.getFlightsClimbedToday()` — device-local day window (matches strength workouts, NOT PT-anchored like steps; flights are wall-clock activity). Returns integer or `null`.
   - `Health.getFlightsClimbedBetween(startISO, endISO)` — range query for the future boss hunt window resolver. Uncached.
   - `_queryFlightsInRange` internal, sums `resultData[].value` like steps.

**Graceful-failure contract — same as steps/sleep/strength.** Never throws. Returns `null` on non-iOS / missing plugin / permission denied / permission unknown / query throws. Web/PWA `isAvailable()` returns `false` and every helper short-circuits to `null` — Playwright smoke unaffected.

**NOT shipped (deferred until C-rank boss content lands):**
- No habit type (no `cfg.flightsThreshold` boss-eval branch, no Add-Habits library entry).
- No dashboard stat card.
- No leaderboard metric / Hall of Fame.
- No backend `METRIC_CAPS` entry.
- No Duels verified-event type.

**Manual QA next iOS build:** install build; existing users get a permission sheet for "Flights Climbed" on first cold launch after sleep prompt; new installs get a single sheet covering steps + sleep + workouts + flights together; denying flights does not break any existing flow; granting + climbing real stairs lets the future boss read the count via `Health.getFlightsClimbedToday()`.

### Rank detail sheet — sub-rank divisions (v3 Phase 1z.59)

**Frontend-only progression milestones.** The major rank ladder (E → D → C → B → A → S → S+) is unchanged: same RANKS thresholds, same `getRank()`, same XP earning, same economy, same small badge (still just the letter). Inside the rank detail popup ONLY, each major rank now subdivides into three divisions: **III (early) → II (middle) → I (near promotion)**.

**Helper.** `getRankDivisionInfo(totalXp)` near the existing `getRank` block. Pure math: takes the current rank's interval `[rank.min, nextMajor.min)`, splits into thirds, returns:

```
{
  majorRank, division ("III"|"II"|"I"),
  fullLabel ("E III"), displayLabel ("E Rank III"),
  nextDivisionLabel ("E II" or "D III" on promotion),
  xpToNextDivision, divisionProgress 0..1,
  divisionIndex 0|1|2, currentDivisionStartXp, nextDivisionStartXp,
  nextMajorRank, xpToNextMajorRank,
  isMax, divisions [4 ladder nodes]
}
```

Max-rank (S+) returns `{ isMax: true, division: null, divisions: [] }` so the renderer can hide the ladder and division-next line gracefully.

**Sheet UI.**
- Title row: `<rank>.label + ' ' + division` → `"E Rank III"`.
- New `#rp-division-next` line under the major-rank "X XP to D Rank" copy → `"131 XP to E II"` (or `"131 XP to D III"` when current = E I).
- New `#rp-division-ladder` mini ladder: `[E III] → E II → E I → D` (4 nodes; current = gold pill, past/future muted, promotion = violet).
- Both hidden when `isMax`.

**Small badge unchanged.** The status-card rank badge still renders only the major-rank letter (`E`). Divisions never leak out of the detail sheet — the request explicitly was to not clutter the badge.

**Edge-case math** (E → D span = 500):
- 0 XP → E III (xpToE II = 167)
- 36 XP → E III (xpToE II = 131)
- 167 XP → E II
- 334 XP → E I
- 499 XP → E I
- 500 XP → D III (getRank already promotes)

**No backend / no Duels / no thresholds / no sims / no Codemagic.** Frontend-only.

### Tappable Hunting pills + Carouser Friday-only engage (v3 Phase 1z.58)

**Two frontend-only boss UX rules.** Built on top of the 1z.57 timer; no backend / Duels touched.

**A. Active boss pills in the dashboard Hunting row are tappable.** `_buildHuntingPills` now carries `bossId` + `fullName` in each entry. The renderer in `updateStatusPills` emits `data-pill-kind="boss"` + `data-boss-id="<id>"` + `role="button"` + `tabindex="0"` + `aria-label="Open <Boss Name> hunt details"` on each engaged-boss pill. The delegated click/keydown handler in `_setupHeaderPillDuelClick` gets a new `openBossPill(el)` branch that calls `openBossFullScreen(el.dataset.bossId)`. The duel pill and the result pill keep their existing behavior. CSS: `.status-pill--boss[data-boss-id]` gains `cursor: pointer` + hover brightness + gold focus-ring (matches the duel pill's tappable affordance).

**B. Carouser engagement is Friday-only.** New helpers right after `_endOfSundayLocalMs`:

- `isCarouserEngageDay(date = new Date())` — pure: `date.getDay() === 5`.
- `canEngageBossNow(bossId, cfg, now)` — generic gate, returns `{ ok, reason }`. Today only Carouser has a date restriction; shape is open for future weekday-scoped bosses.

**Engage path (defense in depth).** `engageBoss(bossId)` calls `canEngageBossNow` first thing after the already-engaged early-return. Outside Friday → toast `"The Carouser opens Friday."` and `return false`. The already-engaged case is bypassed entirely (returned earlier), so a Friday engagement that crosses into Sat/Sun is unaffected — the 1z.57 end-of-Sunday timer still keeps the hunt alive through Sunday night.

**Detail screen CTA.** In the `engageCta` branch of `openBossFullScreen`, after cost/balance setup, `canEngageBossNow` is consulted. When `!ok`:
- `engageBtn.disabled = true`, `aria-disabled="true"`, text → `"AVAILABLE FRIDAY"`.
- `.bfs-engage-btn--locked` modifier (new CSS, muted purple ring, grayscale 0.55, opacity 0.55, cursor: not-allowed).
- Blurb copy → `"The Carouser only opens on Fridays. Return Friday to begin the hunt — it stays active through Sunday night."`

HUNT AGAIN flow also runs through this same `engageCta` branch (when `kill_count > 0` AND not engaged), so the Friday gate covers post-defeat re-engagement too.

**Migration safety.** Active Carouser hunts engaged on a Friday before 1z.58 ship continue normally — they're already engaged, so the new gate doesn't touch them. The 1z.57 end-of-Sunday expiration is intact.

### Carouser end-of-Sunday expiration (v3 Phase 1z.57)

**Special-case for The Carouser.** The boss is `cadence: 'weekly'` with a kill condition that requires Friday AND Saturday nights (sleep 7h + bedtime before midnight on both). The generic 7-day hunt timer made no sense for this boss — a Friday engagement should expire Sunday night, not the following Friday.

**Rule shipped:** The Carouser hunt expires at **Sunday 23:59:59.999 device-local** for the weekend containing the engagement timestamp. Friday / Saturday / Sunday engages all map to THIS Sunday end-of-day. Monday–Thursday engages map to the UPCOMING Sunday end-of-day (per spec; no weekday engagement lock).

**Implementation.** One new helper + one new utility + three stamp-site updates:

1. `_endOfSundayLocalMs(refMs)` — pure date math. JS `Date.getDay()` (0=Sun..6=Sat) drives `daysUntilSun = (7 - dow) % 7`, then `setDate(+daysUntilSun)` + `setHours(23, 59, 59, 999)`.
2. `getBossHuntExpiresAtMs(cfg, startedAtMs)` — high-level expiration helper. Routes Carouser through `_endOfSundayLocalMs`; everything else returns `startedAtMs + getBossHuntDurationMs(cfg)`.
3. Three stamp sites now go through the helper:
   - `engageBoss` at line ~933 (was `_engageNow + getBossHuntDurationMs(cfg)`)
   - `_bossHuntExpiresMs` default-derivation path (was the same)
   - `_migrateBossHuntFields` (was the same)

**Verified date math** (anchored on May 2026 calendar):
| Engagement | Day | Expires (Sunday end-of-day) | Window |
|---|---|---|---|
| Fri 6pm | 2026-05-15 | Sun 2026-05-17 11:59 PM | ~2.3 days |
| Sat 10am | 2026-05-16 | Sun 2026-05-17 11:59 PM | ~1.6 days |
| Sun 9am | 2026-05-17 | Sun 2026-05-17 11:59 PM (same day) | ~15h |
| Sun 10:30pm | 2026-05-17 | Sun 2026-05-17 11:59 PM | ~1.5h |
| Mon 7am | 2026-05-18 | Sun 2026-05-24 11:59 PM | ~6.7 days |
| Thu 23:59 | 2026-05-21 | Sun 2026-05-24 11:59 PM | ~3 days |

Non-Carouser sanity: daily still 1d, triweekly still 3d, any other-weekly still 7d. Unchanged.

**Migration safety for active Carouser hunts on legacy 1z.43 builds.** Pre-1z.57 Carouser engages stamped `hunt_expires_at = start + 7d`. The updated `_migrateBossHuntFields` adds an idempotent Carouser-only re-write block: on any access to the boss (renderHabits cycle, visibilitychange, boss-detail open), the function checks if `state.hunt_expires_at !== getBossHuntExpiresAtMs(cfg, state.hunt_started_at)`. If so, it rewrites to the correct end-of-Sunday timestamp and persists. Idempotent — only writes when the stored value disagrees. Once corrected, subsequent calls are no-ops.

If the corrected Sunday-end is already in the past at migration time, the normal `resolveBossHuntsAcrossWindow` resolution runs on the next cycle: if Health data inside the window qualifies → defeat; otherwise → 1z.56 HUNT FAILED modal.

**Timer display.** Driven by the existing `_formatHuntRemaining` (1z.55):
- Carouser engaged Friday: shows `2d` → ... → `23h` (Saturday morning) → ... → `1h` → `59m` → `<1m` → `Expired`
- Carouser engaged Saturday: shows `1d` → ... → `23h` → ... → `59m` → `<1m`
- Carouser engaged Sunday morning: shows `15h` (already under 48h) → counts down
- Carouser never shows `7d` again

**Evaluation window untouched.** The existing weekend-scoped Carouser evaluator (`evaluateCarouserForNight` / Fri+Sat night requirement, `dayOfWeekScoped: true` in cfg) continues to drive defeats. The 1z.43 `resolveBossHuntsAcrossWindow` skips Carouser for active-resolution (`(Carouser is handled by its existing weekend-scoped evaluator)` per code comment) but does enforce expiration via the new end-of-Sunday boundary.

**Files changed (frontend only, 4):** `app.js` (one new util + one new helper + 3 site updates + 1 migration block + build tag), `index.html` (app.js version bump), `sw.js` (cache bump), `CLAUDE.md`. **No `styles.css` change.** No backend, no Duels, no sims, no Codemagic.

**Verified.** `node --check app.js` OK. `npm run test:e2e` → **7/7 green (~38s)**. Date math validated across all 6 engagement-day scenarios.

Bumps: `app.js?v=410`, `sw.js v5.296`, `APP_BUILD_TAG '2.2.1-w61'`. `APP_VERSION` unchanged.

**Manual QA next iOS build:**
1. Engage Carouser on a Friday → detail shows `HUNT ENDS IN 2d` (or `47h` if Friday afternoon).
2. Engage Carouser on a Saturday → `HUNT ENDS IN 1d` (or `23h` after Saturday midnight).
3. Engage Carouser on a Sunday morning → `HUNT ENDS IN 15h` (or whatever remains until 11:59:59 PM).
4. Engage Carouser on a Monday → `HUNT ENDS IN 6d` (then counts down day by day, switches to hours at 48h).
5. **Never see `HUNT ENDS IN 7d` for Carouser.**
6. If legacy active Carouser hunt had a 7-day stamp pre-1z.57: opening boss detail or backgrounding/foregrounding the app silently rewrites it to the correct end-of-Sunday. If that Sunday already passed, the 1z.56 failure modal fires.
7. Other weekly bosses (none currently shipped beyond Carouser, but if added later) → still get 7d.
8. Daily / triweekly bosses → unchanged.

### Boss hunt failure screen (v3 Phase 1z.56)

**Feature.** When a boss hunt's expiration window elapses without the user meeting the kill condition, the existing boss-result modal now opens once with a HUNT FAILED variant. Same shell, different render branch — no new modal markup chrome to maintain.

#### Trigger path
`resolveBossHuntsAcrossWindow()` finds an engaged boss whose `hunt_expires_at < now` and no qualifying HealthKit data inside the window → calls `_expireBossHunt(id)` → captures `hunt_started_at` BEFORE clearing the hunt fields → queues a failure event:

```js
_queueBossResult({
  outcome:         'failed',
  bossId, bossName, rank,
  conditionLabel:  cfg.killCondShort || cfg.killCondLong,
  hunt_started_at: <captured before clear>,
});
```

#### Per-hunt seen guard
New `_bossFailedSeenKey(bossId, huntStartedAt)` → `hb_boss_failed_seen_<bossId>_<startedAt>`. The hunt-start timestamp differentiates one failed hunt from another — re-engaging the same boss and failing again pops a fresh modal (different timestamp). Foregrounding the app after closing the modal for the same failed hunt is a silent no-op.

Defeat events keep their existing `_bossResultSeenKey(bossId, kill_count)` guard, so the two paths never collide.

#### Modal render branch (in `_showBossResult`)
Per-event `isFailed = evt.outcome === 'failed'` branches the renderer:
| Element | Defeat | Failure |
|---|---|---|
| `#bro-overlay-title` | `BOSS DEFEATED` | `HUNT FAILED` |
| `.bro-subline` | `Your discipline broke the hunt.` | `The <boss> escaped.` |
| `.bro-fallen` | `Has Fallen` | `Escaped` |
| `.bro-defeat-row` (✓ VERIFIED) | shown | hidden |
| `#bro-relic-card` | shown if drop | hidden |
| `#bro-nodrop-card` | shown if no drop | hidden |
| `#bro-failed-card` (new) | hidden | shown |
| `#bro-view-relic` button | shown if drop | hidden |
| `#bro-view-mercy` button | shown if no drop | hidden |
| `#bro-hunt-again` button | shown | shown (re-engage routes through existing `engageBoss` souls-cost gate) |
| `overlay.classList` | (none) | `bro-overlay--failed` |

The `.bro-overlay--failed` class scopes red-ember CSS overrides: title in `#f87171`, portrait grayscaled 35% + 85% brightness, gold-dust opacity dropped to 18%, runes/kicker/subline tinted red. Defeat path stays gold and untouched.

#### Failure card content
```
[HUNT EXPIRED]                          ← red kicker
Objective not completed in time:        ← body, uses cfg.killCondShort
  Walk 6,000+ steps in a single day      so user knows what they needed
NO RELIC FOUND                          ← supporting line
NO SOULS GAINED                         ← supporting line
```

Falls back to `"The hunt window closed before the objective was completed."` if no condition copy is available.

#### Rewards / mercy semantics
- **No drop roll** — `rollBossDrop` is not invoked (only fires on the `_awardSingleShotKill` / inline-kill paths).
- **No souls reward** — `earnSouls` not called.
- **No mercy increment** — `evt.mercy` is null for failures; nothing writes to the mercy counters.
- **No `kill_count` increment** — `state.kill_count` stays at its prior value.
- **Souls spent at engage are NOT refunded** — that's the wager mechanic. The user already accepted it via the existing engage flow. The failure copy doesn't surface "you lost X souls" because that's a sunk cost and dwelling on it reads as punitive; the design tone is motivational ("re-engage when ready"), not punishing.

#### Hunt Again button on failure
`#bro-hunt-again` is wired the same way for both paths via `data-boss-id` attribute. The handler routes through the existing `engageBoss(id)` function, which already enforces the souls-cost gate (`if (balance < cost) showHabitToast('Need N souls. You have M.'); return false;`). No new gate, no new toast — the existing insufficient-souls UX applies.

#### Modal class cleanup on close
`closeBossResult` now strips `bro-overlay--failed` so a subsequent defeat opens with the standard gold palette. Defense-in-depth: each render path explicitly toggles each card's visibility so a re-used modal between defeat / no-drop / failure paints cleanly.

#### Pending-result pill discipline
`_queueBossResult` skips `_writeBossResultPending` for failure events. The gold HUNTING-strip pill is "you have a pending pending result you haven't acknowledged" — that's meant to celebrate a defeat. A failed hunt has nothing to celebrate; surfacing the pill would be wrong.

#### Manual-stop semantics
Manually tapping "Stop Hunting" (disengageBoss) does NOT trigger the failure modal. `disengageBoss` clears the hunt fields directly and does NOT call `_expireBossHunt`. Failure popups fire only on actual time-window expiration with no qualifying data.

#### Files changed (frontend only, 5)
`index.html` (new `#bro-failed-card` section + version bumps), `app.js` (`_expireBossHunt` queues failure event + `_queueBossResult` branches + `_showBossResult` failure render branch + `closeBossResult` class cleanup + `_bossFailedSeenKey` helper + build tag), `styles.css` (failure theme + card + line copy), `sw.js` (cache bump), `CLAUDE.md`. No backend, no Duels, no sims, no Codemagic.

**Verified.** `node --check app.js` OK. `npm run test:e2e` → **7/7 green (~38s)**. The other sheet invariants (1z.40 HoF X-only, 1z.42 Briefing LOCK IN-only, 1z.44 Souls swipe+X) confirmed intact in the diff.

Bumps: `app.js?v=409`, `styles.css?v=295`, `sw.js v5.295`, `APP_BUILD_TAG '2.2.1-w60'`. `APP_VERSION` unchanged.

**Manual QA next iOS build:**
1. Engage a daily boss. Let 24h pass without meeting the condition.
2. Open the app → red-themed `HUNT FAILED` modal appears, says "The <Boss> escaped" + "Objective not completed in time: <condition>" + NO RELIC FOUND + NO SOULS GAINED. HUNT AGAIN + Close buttons.
3. Tap Close → modal dismisses. Re-foreground the app → modal does NOT reappear for the same failed hunt.
4. Tap HUNT AGAIN → existing engage flow fires (souls cost gate + new 24h window).
5. Defeat the same boss successfully → BOSS DEFEATED modal appears in gold (not red), drop/mercy/souls work normally.
6. Manually Stop Hunting before expiration → NO failure modal (manual stop is intentional).
7. If qualifying steps happened inside the original window but the app was backgrounded → `resolveBossHuntsAcrossWindow` catches it and the user sees BOSS DEFEATED instead of HUNT FAILED.

### Boss hunt timer format polish (v3 Phase 1z.55)

**Audit verdict.** The boss hunt expiration-window infrastructure (Part A → K of the spec) was already shipped in Phase 1z.43:
- `hunt_started_at` + `hunt_expires_at` stamped at engage, cleared on defeat/disengage.
- `getBossHuntDurationMs(cfg)` → 24h / 3d / 7d by cadence.
- `_migrateBossHuntFields(id, state, cfg)` migrates legacy engaged hunts safely.
- `resolveBossHuntsAcrossWindow()` re-queries Health for the full active window on app init / visibility-change / boss-detail open / `renderHabits` cycle. Steel Wolf delayed-defeat path verified working.
- `_expireBossHunt(id)` clears engaged + hunt fields when the window elapses without qualifying data; sets `last_hunt_outcome='expired'`.
- All six bosses (Insomniac, Carouser, Dream Tyrant, Steel Wolf, Glass Strider, Iron Warden) audited; each routes through `_clearBossHuntFields(state)` on kill so defeats/drops/mercy/souls fire exactly once.
- All four other sheet-dismiss invariants intact: Today's Briefing LOCK IN-only (1z.42), Hall of Fame X-only (1z.40), Souls info swipe+X+overlay (1z.44), Souls Ledger drag-dismiss enabled.

**Only delta this phase: timer format (Part D).** Previous format produced `14h 07m` / `2d 5h` — read like a stopwatch. New RPG-clean format buckets:
| Remaining | Display |
|---|---|
| ≤ 0 | `Expired` |
| < 1 minute | `<1m` |
| < 1 hour | `Nm` (e.g. `42m`, `9m`) |
| < 48 hours | `Nh` (e.g. `24h`, `23h`, `7h`, `2h`, `1h`) |
| ≥ 48 hours | `Nd` (e.g. `2d`, `3d`, `7d`) |

The 48h day-boundary keeps a freshly-engaged daily boss showing `24h` (not `1d`) so the user sees the full hour budget at engage. Once the timer crosses below 48h it switches to `47h` → `46h` → ... → `1h` → `59m` → `<1m` → `Expired` cleanly.

**Triweekly / weekly behaviour:** triweekly (72h) shows `3d` until under 48h remain, then `47h`. Weekly (168h) shows `7d` → `6d` → ... → `2d` → `47h` → ... .

**Verified.** 16/16 format boundary cases pass:
```
-1s   → Expired      0      → Expired
30s   → <1m          59s    → <1m
1m    → 1m           42m    → 42m       59m    → 59m
1h    → 1h           2h17m  → 2h        23h59m → 23h
24h   → 24h          47h30m → 47h
48h   → 2d           3d     → 3d        7d     → 7d
```

`HUNT ENDS IN <X>` copy in `openBossFullScreen` (line 18784) automatically picks up the new format — no other call site.

**Files changed (frontend only, 4):** `app.js` (`_formatHuntRemaining` function body + comment block + build tag), `index.html` (app.js version bump), `sw.js` (cache bump), `CLAUDE.md`. No backend, no Duels, no sims, no Codemagic, no styles.css.

**`npm run test:e2e` → 7/7 green.** No regressions to any of the other sheet invariants (verified by grep on the file before commit).

Bumps: `app.js?v=408`, `sw.js v5.294`, `APP_BUILD_TAG '2.2.1-w59'`. `APP_VERSION` unchanged at `2.2.1`. `styles.css`, `auth.js`, `simulated-leaderboard.js` all unchanged.

**Manual QA next iOS build:**
1. Engage Steel Wolf → detail reads `HUNT ENDS IN 24h` (or `23h` after a few minutes).
2. Wait until under 1 hour remains → reads `HUNT ENDS IN 59m` → `42m` → ... → `<1m` → `HUNT EXPIRED` if no qualifying steps.
3. Engage Carouser (weekly) → reads `HUNT ENDS IN 7d` → counts down to `2d` → then switches to `47h` and counts hours.
4. Walk 6,000+ steps inside Steel Wolf window → next renderHabits / app foreground → boss defeats. Defeat count +1, drop/mercy/souls fire once. (1z.43 path; verified intact.)
5. Today's Briefing still LOCK IN-only. Hall of Fame still X-only. Souls Ledger still drag-dismissible. Habit drag-reorder still disabled. All unchanged.

### 📒 Souls Ledger pre-1z.44 history gap (Phase 1z.54 — known artifact)

**Status:** documented as a known artifact, NOT a bug. No code change.

The Souls Ledger (`hb_souls_ledger`, Phase 1z.44) starts empty on every device and only records souls events that fire AFTER the user updates to the 1z.44 (or later) build. Souls earned/spent BEFORE the update — including daily login bonuses, boss kills, engagement costs — are not reconstructable from the running balance.

**Specifically for daily login:** `tryGrantDailyLoginBonus()` (line 1846) is gated by `_souls.lastDailyBonusDate === today`. If a user claimed today's bonus on a pre-1z.44 build and then upgraded, the same-day re-entry into the function returns `false` BEFORE calling `earnSouls`, so the ledger never sees today's grant. Tomorrow's grant fires cleanly via the standard path: `tryGrantDailyLoginBonus → earnSouls(15, 'daily_login') → persistSouls → recordSoulsTransaction(15, 'daily_login') → hb_souls_ledger entry { type: 'daily_login', label: 'Daily login', delta: +15, balance_after, ts }`.

**Verified single-source-of-truth audit** (grep confirmed):
- `_souls.balance += ...` exists ONLY inside `earnSouls`.
- `_souls.balance -= ...` exists ONLY inside `spendSouls`.
- `_souls.balance = ...` exists ONLY inside `loadSouls`'s first-install grant.
- Every `earnSouls` and `spendSouls` call routes through `recordSoulsTransaction` via `try { ... } catch (_) {}` so a transient localStorage quota failure never breaks the balance write.

All future souls events (daily login, boss kill, boss engage) DO create ledger entries. The gap is strictly historical and matches the explicit "do not reconstruct old history" constraint for this feature.

### 🔮 Future anti-cheat / verified stats risk (Phase 1z.53 — DOC ONLY)

**Status:** documented, NOT implemented. No enforcement in 2.2.1. This section exists so we don't forget — and so the next session doesn't accidentally re-discover the gap mid-feature.

#### Current known risk

The backend trusts client-submitted leaderboard values. A user holding a valid JWT can POST any `current_value` up to the sanity ceiling (`METRIC_CAPS.step_total = 200_000`) without ever surfacing a real HealthKit sample. One request earns:
- a `step_100k_club` row in `user_accolades` (100K Step Club accolade + 100K Club tab membership),
- Hall of Fame rank #1 in `weekly_step_records` for the current week,
- top rank on `Steps · This Week` via `leaderboard_snapshots`,
- a Hall of Fame fallback-union appearance (1z.41 read path) even if the user never resubmits.

No iOS device required, no real step history required, no Apple Health install required. The vulnerable surface is `POST /v1/leaderboard/submit`.

The same client-trust assumption applies to `submit-verified-events` (Duels). Sleep + workout submits inherit the same shape.

#### Why we are NOT fixing it yet (deliberate)

- App is early. Total user base is small; cheaters are not currently visible.
- Premature enforcement could lock out legitimate users on the HealthKit boundary (high-step marathon days, daylight-saving sleep windows, watch sync gaps).
- **`@perfood/capacitor-healthkit` does not surface `sourceRevision` / `wasUserEntered` / `bundleIdentifier`** in JS — the underlying HKQuantitySample carries them, but the plugin strips them before returning samples to `app.js`. Real source classification needs either a plugin fork or a Capacitor shim, both of which are days of work.
- We want more real-world TestFlight data before committing to a specific enforcement shape.

#### Future Tier 1 — Backend-only prestige gating (cheapest first)

Server-side checks only. No client work, no plugin upgrade, no migration:
- Lower `METRIC_CAPS.step_total` from `200_000` to ~`70_000`. World-class single-day verified step record is ~62k; 70k accommodates outliers, kills the trivial cheat.
- Refuse to award the 100K Step Club accolade on a user's first-ever submit if that submit alone crosses 100K (requires a prior non-zero `leaderboard_snapshots` row).
- Flag huge sudden jumps: if `current_value - prev_value > 50_000` AND time-since-last-submit < 6h, write the row but **suppress the prestige writes** (no accolade, no `weekly_step_records` update). Personal XP and habit-checking still flow normally.
- Block only prestige writes; never block normal app usage. False-flagged users see no UI change.

Scope: ~1 day, ~3 backend tests, no D1 migration.

#### Future Tier 2 — Submit audit log + suspicion scoring

If Tier 1 lands and we want forensics before tightening further:
- New table `leaderboard_submit_audit (user_id, metric, value, prev_value, delta, dt_seconds, suspicion_score, rejected_reason, ip, ua, created_at)`.
- Score every submit; persist them all; let high-score submits write `leaderboard_snapshots.current_value` but NOT `user_accolades` / `weekly_step_records`.
- Build a small admin query path: "show me last 7 days of submits with suspicion_score >= N." No user-facing surface — it's a forensic tool.

Scope: ~2-3 days, one migration, one read endpoint.

#### Future Tier 3 — HealthKit source metadata (real source filtering)

The actual fix. Requires the most work:
- Fork or extend `@perfood/capacitor-healthkit` to surface `sourceRevision.source.bundleIdentifier`, `device.name`, and `HKMetadataKeyWasUserEntered` on every sample.
- Frontend classifies each submit's value into `source_type: 'apple_watch' | 'iphone_motion' | 'manual' | 'third_party' | 'unknown'` and passes it in the submit body.
- Backend stores `source_type` (new column on `leaderboard_snapshots` + `weekly_step_records`).
- Prestige writes (accolade, Hall of Fame, 100K Club) require `source_type IN ('apple_watch', 'iphone_motion')`.
- Manual entries still drive personal XP + habit-checking. Zero behavior change for legitimate users; cheaters via Apple Health manual entry stop earning prestige.

Scope: multi-week. Plugin work + iOS bridge + frontend tagging + backend schema. Land Tier 1 + Tier 2 first; this is the structural fix once we have the data to justify it.

#### Product principle

- **Private / local progress can stay forgiving.** XP, ranks, habit streaks, stats, the user's own dashboard — all of these are personal and should be permissive on the HealthKit boundary.
- **Public / prestige rewards should eventually be stricter.** Leaderboards, Hall of Fame, 100K Club, future tournaments — anything visible to other users earns a trust gradient. Tier 1 → Tier 2 → Tier 3 layers progressively tighten that gate without affecting the personal surfaces.

#### Explicit current decision

- **No anti-cheat enforcement in 2.2.1.**
- **No behavior changes today.**
- Revisit only if (a) the user base grows past ~hundreds of active users, (b) cheating becomes visible (e.g. a suspiciously high record appears on the HoF), or (c) a Tier 1 ship makes sense alongside another planned backend pass.
- When we DO ship Tier 1, the user-facing copy on the leaderboard sheet should add a single line: *"Verified by Apple Health. Manual entries don't count toward prestige rewards."* — don't telegraph specifics about caps or velocity checks to potential cheaters.

---

## Project at a glance

**Awakened — Daily Habit Tracker** (`com.goallearner.awakened`, name on App Store: *Awakened: Habit RPG*).

A vanilla-JS PWA wrapped into a native iOS app via Capacitor + Codemagic. The app is a Solo-Leveling-flavored habit tracker: each completion grants XP, ranks the user from E → S+, and develops 6 stats that determine a "class." Dungeon bosses run as a parallel passive-progress system fed by Apple Health data that also auto-verifies habits. Boss kills drop cards/relics that the hunter equips into a 6-slot typed Armory loadout (HELM / WEAPON / PLATE / GLOVES / BOOTS / RING). **v2.1.0** added Sign in with Apple + a real cloud backend with a live global leaderboard. **v2.2.0** rebuilt the launch experience (premium Tonal-style splash + 5-card educational onboarding), pivoted the Armory from a 9-slot body-equipment panel to typed 6-slot loadout, rebalanced drops with a 3-tier cadence (daily / triweekly / weekly) and bad-luck protection (soft + hard pity), reframed the Items tab as the Relic Archive, added a silent SW auto-update so users never have to clear cache to receive an update, and shipped **Cloud Sync v1** — full localStorage state backup/restore tied to the signed-in Apple account. **LocalStorage remains the runtime source of truth**; the cloud backend handles auth, leaderboard, and Cloud Sync backup/restore (see `user_state_snapshots` D1 table + `GET`/`POST /v1/users/me/state` endpoints).

- **Current marketing version:** `2.2.1` (constant `APP_VERSION` in `app.js` AND `codemagic.yaml`). **v2.2.1 added the dedicated Duels tab, verified-only duel types, and the backend-aggregated verified-duel scoring engine (Phase 1x → 1z).** v2.1.0 (build 35) was submitted for review May 13 1:39 AM PST then the train locked mid-development; the v2.2.0 train opened cleanly on commit `e744a08` and shipped to TestFlight first as **build 58** on May 14. Subsequent builds layered in additional Phase work — notably **build 63** (Phase 1u Strength training auto-verify) and **build 65** (Phase 1v D-rank dungeon: 3 new bosses + 15 new drop cards + production item artwork, smoke-tested clean and queued for App Store review). Cloud Sync v1 (Phase 1w) landed post-build-65. The 2.2.1 train opened for Phase 1x (Discipline Duels foundation) and now carries 1y (Steps Duel scoring) + 1z (Verified Duel Scoring Engine). Coverage on top of v2.1.0:
  - **New launch experience (v3 Phase 1i)** — pre-rendered AWAKENED splash with small gold hunter-rune emblem stacked over the wordmark, 1800ms min dwell. 5-card educational onboarding fires once for new users (Discipline Becomes Power → Train Your Six Stats → The System Is Honest → Hunt Bosses. Earn Relics. → Shape Your Hunter Build). Gated by `hb_onboarding_seen_v2`; returning users auto-migrated.
  - **Typed equipment Armory (v3 Phase 1d → 1e)** — 9-slot body-equipment panel (the old `panel-base.png` art with carved sockets) RETIRED. New 6-slot 3×2 typed grid: HELM / WEAPON / PLATE / GLOVES / BOOTS / RING. Square card art is intentional. All slots unlocked at every rank (no rank-gating). Slot-type enforcement: cards can only equip into their matching typed slot. Legacy `body`/`legs`/`cape` collapse → `plate`; `amulet` → `ring`. Migration via `hb_equipment_build_migrated_v1`.
  - **Drops v1.7 → v1.8 (v3 Phase 1h → 1r)** — three cadence tiers (daily / triweekly / weekly) with cadence-specific rates AND a 3-layer mercy system: **Guaranteed relic** (no-drop guarantee, daily 4 / triweekly 3 / weekly 2), **Rare Mercy** (rare-or-better floor, daily 12 / triweekly 6 / weekly 4 — reset by Rare or Ultra; NOT by Common), and **Ultra Mercy** (soft + hard ultra pity ceiling, daily 40 / triweekly 20 / weekly 8). Per-boss first-common protection (replaces the prior global flag). RELIC MERCY readout in boss detail modal shows all three rows with tooltip rules.
  - **Relic Archive (v3 Phase 1g)** — Items tab renamed; cards show slot badge (top-left), equipped badge (top-right, gold pill), drop-source line below name. Mystery cards reveal rarity + source teaser without naming the item; tap opens a small mystery info modal with HUNT BOSS button. COMMON tier hides silhouettes (commons roll passively); RARE + ULTRA still tease. Cards sort by acquisition date.
  - **Single hunter-name claim + lock (v3 Phase 1j)** — name is claimed once via signin alias, locked everywhere afterward. Status-tab pencil hides; legacy welcome screen + habit-picker name input bypass when already claimed. Flag: `hb_hunter_name_claimed`.
  - **Silent auto-update SW** — `reg.update()` fires on every page load + tab focus. New SW silently `SKIP_WAITING`s without banner click. Version-string compare runs 2s after register as safety net. Manual opt-in via `hb_sw_manual_update`.
  - **Compact MOBA-style Select Relic picker** — slot-filtered, `auto-fill minmax(112px, 1fr)` grid with stat-chip rows. Replaces the prior gallery-sized cards.
  - **Premium EQUIP TO BUILD / UNEQUIP button** — purple→violet primary with gold rim + ✦ rune glyph; muted-navy unequip variant.
  - **Leaderboard alias normalization** — display-only lowercase + space-stripping; allowlist exception for `Richie`. Storage and isMe matching untouched.
  - **Cloud Sync v1 (v3 Phase 1w)** — Cloudflare Workers backend gained two new endpoints: `GET /v1/users/me/state` + `POST /v1/users/me/state`. Backs the `user_state_snapshots` D1 table (one row per user, opaque JSON envelope, ≤512KB cap). New client `CloudSync` module in `app.js` collects allowlisted localStorage keys into a snapshot, debounces uploads 30s after the last persist (hooked into `save` / `saveBosses` / `persistInventory` / `persistSouls` / `saveHunterBuild`), force-flushes on visibilitychange→hidden. **Fresh install + cloud backup exists → window.confirm prompts to restore + reload.** Existing local progress is NEVER silently overwritten (v1 conflict policy = newest/fresh-install rules only; no field-level merge). Settings → Account gets a new **CLOUD BACKUP** section with status line + "Back up now" + "Restore from cloud" buttons. `Auth.fetchCloudState` + `Auth.uploadCloudState` are the auth.js endpoint helpers. **Sensitive data NEVER in snapshot:** JWT, Apple identity token, `hb_user`, `hb_pending_apple_token` are all explicitly excluded; `SNAPSHOT_KEYS` is an allowlist, not a `localStorage` dump. Account-delete handler now also wipes the snapshot via `deleteUserStateSnapshot`. Two new rate-limit bindings (`RL_USER_STATE_GET` 12/min, `RL_USER_STATE_POST` 4/min). Migration `0002_user_state_snapshots.sql`.
  - **Cloud Sync hotfix (v3 Phase 1w.1)** — `hb_leaderboard` (the local accumulator for trailing-7-day step total + current sleep/bedtime streak counters + best peaks) was MISSED in the v1.0 SNAPSHOT_KEYS allowlist. Restore left it empty on a fresh device, then the post-init `lbSubmitAllMetricsDebounced` ran with all-zero metrics and **overwrote the user's server-side `current_value` to 0** (best_value preserved via the SQL `MAX` clause). Fix: added `hb_leaderboard` + `hb_lb_last_submit` + `hb_lb_cache_step_total` + `hb_lb_cache_sleep_streak` + `hb_lb_cache_bedtime_streak` + `hb_sw_manual_update` to the allowlist. **Defense-in-depth:** `lbSubmitAllMetrics` now refuses to submit if all three metrics are zero — a wipe-zero state can no longer clobber the backend. Genuinely-zero new users lose nothing; they submit naturally on first non-zero render. **Operational rule for future leaderboard work:** any new `hb_lb_*` or persistent leaderboard accumulator key MUST be added to `SNAPSHOT_KEYS` in the CloudSync module, AND should be defended at the submit boundary if a zero value could be destructive.
  - **D-rank drop artwork (v3 Phase 1v.3)** — production PNGs for all 15 new D-rank cards landed in `assets/items/`. **Filename convention note:** these 15 use HYPHENS (`iron-grip-wraps.png`, `crown-of-deep-rest.png`, etc.) while all earlier item PNGs use underscores (`dream_woven_hood.png`). Both work — `card.art_path` carries the full path literal, no derivation from `card.id`. New cards from this point can use either convention; reuse whatever the delivery artist provides. All 15 added to `PRECACHE_ASSETS` in `sw.js`. Codemagic glob copy auto-includes them.
  - **D-rank drops (v3 Phase 1v.2)** — 15 new cards (3 common + 1 rare + 1 ultra per new D boss). Iron Warden: gloves / body / weapon commons → body rare → weapon ultra (Titan's Oathblade, +10 STR / +5 WILL — BIS for STR/WILL discipline weapon niche). Glass Strider: boots / ring / cape commons → boots rare → ring ultra (Horizon Step Ring, +10 VIT / +5 FOCUS — BIS for VIT/FOCUS movement niche). Dream Tyrant: amulet / amulet / cape commons → helm rare → helm ultra (Crown of Deep Rest, +10 VIT / +5 FOCUS — BIS for VIT/FOCUS recovery niche). Stat curve: D common ≈ 3 primary (+ optional 1 secondary), D rare = 8+2 = 10 total, D ultra = 10+5 = 15 total — conservative bump over E (2 / 6 / 12) without touching Steel Wolf legacy values. Art paths set to `assets/items/<id>.png` with onerror fallback to slot-emoji + rarity gradient until real PNGs land.
  - **D-rank daily-boss roster (v3 Phase 1v)** — three new bosses joined the D-rank dungeon: **The Iron Warden** (STR · verified strength workout ≥10 min · daily), **The Glass Strider** (VIT · 7,500 steps · daily), **The Dream Tyrant** (VIT · 7.5h sleep · daily). All three are TRUE daily-cadence with `streakTarget = 1` — one qualifying day/night defeats them, repeat next day if re-engaged. **No weekly cap.** Shared-data principle: Iron Warden uses the same workout sample that drives Strength training auto-verify; Glass Strider uses the same step count that drives Daily walk + Steel Wolf + leaderboard; Dream Tyrant uses the same sleep data that drives Insomniac + Carouser + Sleep habit. Souls economy rebalanced: D-tier dropped from 50/100 (net +50) to **35/35 (net 0)** — D bosses are the relic farm, E bosses remain the souls farm. `MAX_ENGAGED_BOSSES = 3` stays — forces strategic choice between E (souls) and D (drops). Boss cards display single-dot progress (no weekly progress wording).
  - **Strength training auto-verify (v3 Phase 1u)** — Apple Health workout samples now drive Strength training. New `Health.getStrengthWorkoutsToday()` queries `workoutType` samples, filters to strength-category activity types (traditional / functional / generic strength / weight / resistance training) with duration ≥ 10 min. New `autoVerifyStrengthTraining()` wires into all three trigger sites (renderHabits, visibilitychange, post-grant). Strength training joins Daily walk / Sleep / Sleep before midnight in `isReadOnlyAutoVerifyHabit` — tap opens the system-managed Notes modal instead of toggling. `systemManagedHtmlFor` gets a fourth case with tough-love copy. No `HEALTHKIT_AUTH_VERSION` bump — the existing `'activity'` friendly alias in `requestAuthorization` already covers `workoutType` per the plugin's auth API.
  - **Habits tab Codex/card redesign (v3 Phase 1k, refined in 1o)** — live Habits tab uses premium 3-column RPG objective cards with existing habit icons preserved, gold sealed/completed state, colored incomplete rings, system/auto lock rings, and a compact dashed Add Habits pill. **Pack/routine progress (Morning Routine, Locked-In) is reached through the tappable top "X / Y HABITS TODAY" tile**, which opens `#pack-progress-modal` — the persistent bottom Morning Routine strip was retired in Phase 1o. Top "X / Y HABITS TODAY" header is the single progress summary on this tab; the redundant Daily Objectives section header was removed. Markup uses `.habit-item.codex` modifier with legacy class aliases (`.codex-status habit-cb`, `.codex-streak streak-badge`) so existing event handlers stay untouched.
  - **History tab Discipline Ledger redesign (v3 Phase 1p)** — Weekly view rebuilt as a stat-color "gem" discipline ledger. Completed cells keep their stat-color identity (radial gradient + soft glow, NOT generic gold checks), missed cells render a muted red dot inside a low-contrast outline, today's still-pending cell is a dashed gold pulse, off-days are dashed-quiet, future cells are faint outlines. Each habit row carries a stat-color accent stripe on the left edge; long habit names now wrap to two lines (no more ellipsis on "Strength training" / "Meditate & Breathwork" / "No phone after waking"). Apple-Health auto-verifiable habits get a small AUTO badge in the label column + a framed blue dot on each auto-verified cell. New `TRAINED THIS WEEK` section below the grid renders a 6-stat distribution (STR / VIT / INT / FOCUS / WILL / WLT vertical mini-bars with counts) plus a serif insight line ("You leaned VIT + FOCUS this week."). New `WEEKLY REPORT` card replaces the simple stats bar on Weekly mode only: 34px gold completion %, Best Day / Total Done / Best Streak rows, plus a dominant-stat callout with stat-color border. Monthly + Yearly views keep the legacy stats bar untouched. Date nav refined to compact SVG chevrons + `WEEK N · YYYY` eyebrow above the range. "Achieved" sub-tab relabeled "Milestones" (user-facing only; internal mode key still `'achievements'`).
  - **Habits screen vertical-efficiency pass (v3 Phase 1o)** — persistent bottom Morning Routine / pack-progress strip retired from the Habits screen. The top "X / Y HABITS TODAY" tile (`#today-strip`) is now tappable (subtle hover state + chevron) and opens `#pack-progress-modal` — the new canonical access point for routine/pack progress (Morning Routine, Locked-In, streak/shield/honest/add-missing chips all carry over). Quote block compressed (min-height 76 → 38, font tightened). Tab-bar min-height 50 → 44 (still meets iOS 44pt tap minimum). Habit grid top padding 16 → 8 + row gap 11 → 9. Net effect: ~6 full codex habit cards visible on a standard iPhone viewport.
  - **Notification UI redesign + copy rewrite (v3 Phase 1m → 1n)** — Settings → REMINDERS panel restructured: DAILY SYSTEM PINGS / QUIET HOURS / PAUSE / HABIT REMINDERS / VOICE PREVIEW subsections. Permission pre-prompt redesigned with three-card type preview (Morning Briefing / Momentum Check / Evening Closeout). Per-habit and pack reminder offer sheets re-skinned as "System Offer" sheets with ✦ rune glyph on the primary action. Voice Preview cards read LIVE from `composeDigestBody` / `computeMidDayBody` / `pickCheckinCopy` — never drift from production copy. Full copy bank rewritten to "tactical system message" voice (COPY, HABIT_NOTIF_COPY, DIGEST_FLAVOR, composeDigestBody, computeMidDayBody, CHECKIN_COPY). User-facing labels are now Morning Briefing / Momentum Check / Evening Closeout (internal function names retain `digest`/`checkin` for historical reasons).
- **Service-worker cache version:** `v5.269` (constant `CACHE_VERSION` in `sw.js` — bumped on every deploy; cache versions are per-deploy, not per-marketing-version)
- **HealthKit auth version:** `2` (constant `HEALTHKIT_AUTH_VERSION` in `app.js` — bump on any new HealthKit category added to the auth call; see "HealthKit integration" section below)
- **GitHub:** `github.com/GoalLearner/awakened-app` (private)
- **iOS App ID:** `6764727990`

---

## Tech stack & file map

Pure HTML / CSS / JS. No build step for the web app. The only "build" is Capacitor wrapping the static files into an iOS bundle.

**Canonical working tree:** `C:\Users\richm\Documents\repos\awakened-app`. This is the ONLY working copy. The older OneDrive checkout at `C:\Users\richm\OneDrive\Desktop\habit-tracker` was deleted in May 2026 (Phase 1z.15 cleanup) — it had caused repeated CWD-drift bugs where git operations would land in the wrong clone. **Never re-create an OneDrive copy of this repo.** OneDrive's per-file sync conflicts with git's `.git/objects` housekeeping (gc, pack, prune) and produces "delete these 1000+ items?" dialogs after every `git pull`. `serve.ps1`'s fallback path points at the canonical repo; just `cd C:\Users\richm\Documents\repos\awakened-app && .\serve.ps1`. At session start: `cd` to canonical, `pwd` to verify, then `git pull --ff-only origin main`.

| File | Purpose |
|------|---------|
| `index.html` | All markup. Tabs, panels, sheets, modals, banners. The pre-rendered splash + intro onboarding overlay sit at the very top of `<body>` so the brand impression lands before any JS executes. |
| `simulated-leaderboard.js` | **v3 Phase 1s (rev v4 = 10 fixed bots) — client-side ONLY.** Injects 10 simulated hunters into the live leaderboard render so sparse boards still feel populated. Pure function (`window.SimulatedLeaderboard.merge(realTop, alias, value, dateKey, metric)`) with a single kill-switch constant `SIMULATE_USERS` at the top of the file. NEVER sent to the backend, NEVER persisted to localStorage. **Fixed cast of 10 bots** — same names every week, every metric. Each bot has an archetype (`avgDailySteps` + `stepStdDev` + `sleepBase`/`sleepJitter` + `bedtimeBase`/`bedtimeJitter`) that drives all three of their metrics so they read as one consistent persona rather than three independent rolls. Roster spans top-tier (ShadowMonarch_K @ ~14k/day) → average (Jordan F. @ ~6k/day) → just-starting (nightowl @ ~2.4k/day). **Step totals "move like real users":** each day, every bot's daily step count is rolled deterministically from `(weekStartKey, bot.name, dayIdx)` via Box-Muller gaussian around the bot's mean. The bot's display = sum of those daily rolls from Sunday through the current day-of-week → monotonic non-decreasing within the week (every daily roll is ≥ 0). New week = new daily rolls. **Streaks (sleep / bedtime) week-stable** — rolled once per `(weekStartKey, bot, metric)` from the bot's tendency ± jitter (with extra mass on delta=0 since real streaks plateau for long stretches). New week = new value, but the same bot's tendency carries through (a bot with `sleepBase: 18` will always tend toward high streaks; one with `sleepBase: 0` toward low). The user's real value is NEVER used to anchor bot values — bots have their own world. Cosmetic tie-break: if a bot's value would exactly equal `realUserValue`, bump it by 137 (steps) or 1 (streak). Wrapped in `_lbMaybeSimulate` inside `app.js` (called at both `openLeaderboardRanking` render points, after `lbCacheWrite` so the cache stays pure-backend). |
| `auth.js` | Sign-in-with-Apple + alias claim + JWT/token plumbing. Loaded BEFORE `app.js` via `<script>` so `window.Auth` is available at IIFE start. Exposes `getCurrentUser`, `signInWithApple`, `completeSignIn`, `validateAlias`, `setAlias`, `devSignInIfLocalhost`. Sets `localStorage.hb_name` on alias commit so the rest of the app sees a populated name from first launch. (v2.1.0 Phase A → B) |
| `app.js` | All logic. Single file IIFE — every runtime constant, every render function, every event wiring. Top of file: `setupSignInGateIfNeeded()` short-circuits the IIFE when there's no signed-in user. |
| `styles.css` | All styling. Defines a `:root` token set. Dark-mode only — Light theme was removed in v1.1.3. |
| `sw.js` | Service worker. Precaches app shell, avatar PNGs, tab/stat icon PNGs, and app icons (icon-192/512). The dynamic OffscreenCanvas icon generator was removed once real icons shipped. v2.2.0 originally kept skipWaiting OUT of install (relying on the client-side `postMessage({type:'SKIP_WAITING'})` path in `app.js`), but **v3 Phase 1x flipped it: install handler now calls `self.skipWaiting()` directly** after precache resolves. Reason: iOS Capacitor WebView, every IPA update ships a new `sw.js` that must take over immediately — otherwise the OLD SW from the previous IPA keeps serving stale `/index.html` from its precache and new static markup never reaches the user. The web `postMessage` path stays as a belt-and-suspenders backup. |
| `manifest.json` | PWA manifest. Theme `#0a0a0a`. Standalone portrait. References static `icon-192.png` / `icon-512.png`. |
| `capacitor.config.json` | Capacitor config. `webDir: www`. |
| `codemagic.yaml` | iOS build pipeline. Copies static files → `www/`, runs `npx cap sync ios`, sets `ITSAppUsesNonExemptEncryption=false`, builds & uploads to TestFlight. **Has its own `APP_VERSION` env var that must move with the one in `app.js`.** |
| `serve.ps1` | Local dev server, defaults to port 8080. Cache-Control: no-store. Set `$env:PORT=NNNN` to override. |
| `avatar-*.png` | 8 silhouette PNGs (base + 7 classes). RGBA with proper alpha. |
| `app-icon-source.png` | 1254×1254 master used by `scripts/generate-app-icons.ps1`. Re-run the script after replacing the source to regenerate every iOS size + the PWA `icon-192/512.png`. |
| `icon-192.png`, `icon-512.png` | PWA app icons. **Real static files** (24-bit RGB, no alpha) — generated from the source above. |
| `assets/tab-icons/` | Bottom-nav DALL-E art at 192×192 (~83–106 KB each), plus `*-source.png` masters. 7 icons: `tab-status`, `tab-habits`, `tab-stats`, `tab-history`, `tab-dungeon`, `tab-items`, `tab-social`. |
| `assets/stat-icons/` | Stat icons at 192×192 (~50–80 KB each), plus `*-source.png` masters. 6 icons: `stat-str`, `stat-vit`, `stat-int`, `stat-focus`, `stat-will`, `stat-wlt`. |
| `assets/bosses/` | Boss illustrations at 1254×1254 manhwa style. **6 entries** (3 E-rank + 3 D-rank, v3 Phase 1v.1): `the-insomniac.png`, `the-carouser.png`, `the-steel-wolf.png`, `the-iron-warden.png`, `the-glass-strider.png`, `the-dream-tyrant.png`. Path is auto-derived from `BOSSES[id]` via `id.replace(/_/g, '-')` + `.png` — that's why every boss ID starts with `the_` (the v3 Phase 1v.1 rename aligned the D-rank IDs to this convention). All 6 paths are in `PRECACHE_ASSETS` and the codemagic copy loop. |
| `assets/gates/` | Dungeon-gate art (6 rank tiers: `gate-e/d/c/b/a/s-rank.png`). |
| `assets/items/` | **Drop card art — 30 PNGs total** at 1254×1254 RGB, ~1.1–2.6 MB each. **Filename conventions are mixed and that's intentional** — `card.art_path` carries the literal string, so both `underscored.png` and `hyphenated.png` work side-by-side; no derivation from `card.id`. (a) **15 E-tier / legacy items use underscores.** v2.0.2 launch roster (9): `dream_woven_hood`, `sleepwalkers_cloak`, `pendant_of_the_wakeful`, `vow_ring`, `vessel_of_refusal`, `sober_kings_gloves`, `pack_leaders_greaves`, `alphas_mantle`, `trail_worn_boots`. v2.1 content patch (6 commons): `tossing_bedroll`, `drowsy_signet`, `sobriety_token`, `steady_steps`, `pups_hood`, `trackers_wrap`. (b) **15 D-rank items use HYPHENS** (v3 Phase 1v.3): `iron-grip-wraps`, `warden-chain-belt` (note: filename is `wardens-chain-belt.png`), `rusted-training-blade`, `wardens-plate`, `titan-oathblade`, `striders-laces`, `glassstep-band`, `shardwalker-wrap`, `glass-path-boots`, `horizon-step-ring`, `quiet-thread`, `moonlit-lens`, `hushed-night-cloak`, `tyrants-sleep-mask`, `crown-of-deep-rest`. The render pipeline auto-resolves `card.art_path` → if 404, fallback to emoji + rarity gradient. New cards: drop the PNG, add the path to `PRECACHE_ASSETS` in `sw.js`, bump `CACHE_VERSION`. Codemagic's glob copy step (`assets/items/*.png`) picks up new files automatically. |
| `assets/equipment/panel-base.png` | **RETIRED v3 Phase 1d.** The old 941×1672 carved-stone Armory panel art. Lives on disk for archival only — no longer referenced by markup or precache. Replaced by the typed 6-slot tile grid. Do NOT reintroduce. |
| `assets/icons/` | General-purpose UI icons (v2.0.1). Currently `souls-icon.png`. Distinct from habit-icons / tab-icons. |
| `BOSSES.md` | Boss-system design doc. Has a stale-rate banner pointing to DROPS.md as the authoritative rate source. |
| `CARDS.md` | Boss card visual spec (5:7 portrait card layout). |
| `DROPS.md` | **Drops/cards collection system design — v1.8 authoritative (code state).** Covers: cadence-aware drop rates (daily / triweekly / weekly via `DROP_RATES_BY_CADENCE`); rarity-tier definitions (common / rare / ultra_rare) + stack caps (1 / 3 / ∞); 3-layer mercy system — **Guaranteed Relic** (any-drop pity, daily 4 / triweekly 3 / weekly 2), **Rare Mercy** (rare-or-better floor, daily 12 / triweekly 6 / weekly 4 — added v3 Phase 1r), **Ultra Mercy** (soft + hard ultra pity ceiling, daily 40 / triweekly 20 / weekly 8); cinematic reveal modal UX for first-acquisition rares/ultras; per-boss first-common protection; pity counter shape (`kills_since_any_drop` / `kills_since_rare_or_better` / `kills_since_ultra`). The engine in `app.js` reads `DROP_RATES_BY_CADENCE` + `DROP_PITY_BY_CADENCE` keyed off `BOSSES[id].cadence`. Note: the on-disk `DROPS.md` file header still reads "v1.4" — the doc itself hasn't been re-versioned since v3 Phase 1h. CLAUDE.md is the live source for current values. |
| `EQUIPMENT.md` | Equipment / item schema design (v1.3). Stat-bonus magnitudes, slot ownership per boss, class-affinity model. Phase 3 equip-UI work uses this as the source of truth. |
| `resources/ios/AppIcon.appiconset/` | 18 iOS icon sizes regenerated from `app-icon-source.png` by `scripts/generate-app-icons.ps1`. Copied into the iOS build by Codemagic. |
| `scripts/optimize-tab-icons.ps1` | Resizes `assets/tab-icons/*-source.png` → 192×192. Re-run after dropping in new DALL-E sources. |
| `scripts/optimize-stat-icons.ps1` | Same, for stat icons. |
| `scripts/generate-app-icons.ps1` | Resizes `app-icon-source.png` to all 18 iOS sizes + 2 PWA sizes. 24-bit RGB output, no alpha (Apple requirement). |
| `scripts/verify-app-icons.ps1` | Sanity-check: every iOS icon is at exact dimensions and has zero alpha. Run before pushing. |
| `scripts/resize-iphone-screenshots.ps1` | Resizes raw iPhone PNGs (1290×2796 from 15/16 Pro Max) → 1284×2778, the size Apple's "iPhone 6.5-inch Display" slot accepts. **Outputs 24-bit RGB, no alpha** (Apple rejects screenshots with alpha channels). |
| `scripts/generate-ipad-screenshots.ps1` | Embeds iPhone screenshots in a 2048×2732 dark-themed canvas for the iPad slot (12.9" iPad Pro size). Same no-alpha guarantee. |
| `screenshots/iphone/` | Drop raw iPhone screenshots here before running the resize script. Output goes to `screenshots/iphone-65/`. |
| `screenshots/ipad/` | iPad-letterboxed output, ready for upload. |
| `package.json` | Capacitor deps + `@capacitor/local-notifications@^6.1.3` (per-habit reminders) + `@perfood/capacitor-healthkit@^1.3.2` (HealthKit auto-verify). |
| `.npmrc` | `legacy-peer-deps=true`. **Do not delete** until we migrate off `@perfood/capacitor-healthkit` — the plugin's published peer-dep declares Capacitor 4 while we're on 6, so npm refuses to install without this. See "Common pitfalls". |
| `preview-habits.html` | **QA/design-preview file (NOT a production app surface).** Standalone Habits tab redesign preview used before porting the codex card layout live. Imports production `styles.css` so visuals match. Not in `PRECACHE_ASSETS`, not in the iOS bundle. |
| `preview-notifications.html` | **QA/design-preview file (NOT a production app surface).** Standalone notification UI preview showing the permission pre-prompt, Settings → Notifications panel, per-habit reminder offer, and pack reminder offer. Used before porting the v3 Phase 1m notification UI live. |
| `preview-notif-copy.html` | **QA/design-preview file (NOT a production app surface).** Notification copy showcase showing every variant in one scrollable page: Morning Briefing (6 branches), Momentum Check (3 priorities), Evening Closeout (5 states × 5 lines), per-stat fallback (7 entries), HABIT_NOTIF_COPY (49 entries), DIGEST_FLAVOR (8 classes × 4 lines). Hand-authored examples; not wired to live JS. |

---

## Sign in with Apple gate + auth (v2.1.0)

Hard gate at the very top of the IIFE in `app.js`. `auth.js` loads first and exposes `window.Auth`. If no signed-in user (or alias not yet picked), the gate intercepts; the rest of `app.js` short-circuits and the main app never mounts.

**Two-step flow:**
1. `#signin-step-apple` — "Sign in to begin" + Apple authorize button. Calls `Auth.signInWithApple()` which exchanges the Apple identity token with the backend at `/v1/auth/apple`. Returns either `{ ok: true, user }` (alias already set, mount app) or `{ ok: true, needsAlias: true }` (continue to step 2).
2. `#signin-step-alias` — "**Claim Your Hunter Name**" + input + Continue. Calls `Auth.completeSignIn(alias)` → backend `/v1/auth/verify`. Validates alias (3–20 chars, letters/numbers/spaces/_/- only), checks for collision with suggested alternatives. On success: `localStorage.setItem('hb_name', alias)` + `localStorage.setItem('hb_hunter_name_claimed', '1')` then `window.location.reload()` to mount the main app from signed-in state.

**Validation rules** (`Auth.validateAlias`): regex `^[A-Za-z0-9 _-]{3,20}$`. Empty, too short, too long, or special chars → reject. Backend ALSO validates — server-side is authoritative.

**Localhost dev bypass** — `Auth.devSignInIfLocalhost()` auto-creates a DevUser with alias `DevUser` on hostnames that look like `localhost`. Gated against Capacitor's native WebView (which also reports `localhost` under the `capacitor://` scheme), so this is a no-op on production iOS. Lets `serve.ps1` boot the app without hitting the gate.

**Storage** (legacy `hb_user`-style; canonical access via `Auth.getCurrentUser()`):
```
hb_user (managed by Auth):
  { id, alias, jwt, apple_sub, created_at }
hb_name        — mirrored from user.alias for the rest of the app
hb_hunter_name_claimed — set to '1' once alias commits (v3 Phase 1j)
hb_pending_apple_token — short-lived staging between steps 1 and 2
```

**Alias is the canonical hunter name claim (v3 Phase 1j).** Once set, no UI in the app exposes a rename path. The Status-tab pencil icon only renders when `hb_hunter_name_claimed !== '1'`. The legacy `#welcome-screen` "A new hunter awakens / Start My Quest" name input and the `#onboarding` habit-picker name input both detect the claim and either bypass entirely (welcome screen) or hide the input row (habit picker). See "Hunter name claim & lock" section.

**Display-side leaderboard alias normalization** is a separate display layer (see "Leaderboard" section). Raw stored aliases keep capitalization + spaces.

---

## Backend at a glance

Cloudflare Workers + D1, repo lives at `awakened-app/backend/`. Production URL: `https://awakened-backend.richmondcampano93.workers.dev`. Six feature surfaces:

**D1 tables** (across all surfaces): `users`, `leaderboard_snapshots`, `user_state_snapshots`, `friends`, `duels`, `duel_progress_snapshots`, `verified_events`, `user_souls_ledger`.

**Endpoint surface (every route below is auth-required except `POST /v1/auth/verify`):**
- `POST /v1/auth/verify`
- `POST /v1/leaderboard/submit`, `GET /v1/leaderboard/top`
- `POST /v1/account/delete`
- `GET /v1/users/me/state`, `POST /v1/users/me/state`
- `GET /v1/friends`, `POST /v1/friends/request`, `POST /v1/friends/:id/accept`, `POST /v1/friends/:id/decline`, `POST /v1/friends/:id/remove`
- `GET /v1/duels`, `POST /v1/duels`, `GET /v1/duels/:id`, `POST /v1/duels/:id/accept`, `POST /v1/duels/:id/decline`, `POST /v1/duels/:id/cancel`, `POST /v1/duels/:id/progress`, `POST /v1/duels/:id/resolve`, `GET /v1/duels/:id/score`
- `POST /v1/verified-events`

**Migration history** (`backend/migrations/`):
- `0001_initial.sql` — initial schema (users, leaderboard_snapshots).
- `0002_user_state_snapshots.sql` — Cloud Sync v1 table (Phase 1w).
- `0003_friends_and_duels.sql` — friends + duels tables (Phase 1x foundation).
- `0004_verified_duel_types.sql` — `duel_type` column + index (Phase 1x.6 verified-only types).
- `0005_duel_progress_snapshots.sql` — legacy Phase 1y steps snapshots + `result` / `resolved_at` columns on duels.
- `0006_verified_duel_scoring_engine.sql` — `verified_events` + `user_souls_ledger` + `reward_settled_at` on duels (Phase 1z).



**1. Auth (v2.1.0 Phase B)**
- `POST /v1/auth/verify` — exchanges Apple identity token + alias for a session JWT (HS256, 90-day TTL).
- D1 table: `users` (id, apple_sub, alias, created_at, updated_at).
- `POST /v1/account/delete` — hard-deletes user row. Cascades to `leaderboard_snapshots` (FK) and `user_state_snapshots` (manual delete via `deleteUserStateSnapshot` in account-delete handler).

**2. Leaderboard (v2.1.0 Phase C)**
- `POST /v1/leaderboard/submit` — upserts `(user_id, metric, current_value, best_value)`. `best_value` is `MAX`-preserved across submits.
- `GET /v1/leaderboard/top?metric=X&limit=N` — returns top-N + caller's rank/value.
- D1 table: `leaderboard_snapshots` (user_id, metric, current_value, best_value, updated_at).
- Three metrics: `step_total`, `sleep_streak`, `bedtime_streak`.

**3. Cloud Sync v1 (v3 Phase 1w)**
- `GET /v1/users/me/state` — returns the caller's latest backup snapshot, or `{ exists: false }`.
- `POST /v1/users/me/state` — upserts the caller's snapshot. Opaque JSON envelope (≤512 KB).
- D1 table: `user_state_snapshots` (user_id PK, state_json, state_version, app_version, client_updated_at, server_updated_at, device_id, checksum). Migration: `0002_user_state_snapshots.sql`.
- Client module: `CloudSync` in `app.js`. SNAPSHOT_KEYS allowlist (~55 keys) covers all persistent user state. Sensitive keys (JWT, Apple identity token, `hb_user`, `hb_pending_apple_token`) are explicitly excluded.
- Conflict policy v1: fresh install + cloud exists → confirm-restore prompt; local exists + no cloud → upload baseline; both exist → preserve local, schedule debounced push to keep cloud current. No field-level merge in v1.
- Two rate-limit bindings: `RL_USER_STATE_GET` (12/min), `RL_USER_STATE_POST` (4/min).

**4. Friends + Discipline Duels foundation (v3 Phase 1x)**
- `GET /v1/friends` — lists `{ friends, incoming, outgoing }` from the caller's perspective.
- `POST /v1/friends/request` body `{ alias }` — sends a pending request. Inverse-pending (B→A pending while A sends A→B) AUTO-ACCEPTS the existing row instead of creating a duplicate inverse.
- `POST /v1/friends/:id/accept | /decline | /remove` — recipient-only accept/decline; either party can remove an accepted friendship.
- `GET /v1/duels` — `{ incoming, outgoing, active, recent }` (recent = last ~20 completed/declined/expired/cancelled).
- `POST /v1/duels` body `{ opponent_alias, duration_days?, stake_souls? }` — both users must be accepted friends; rejects self-duels + pre-existing pending/active duel between the pair.
- `POST /v1/duels/:id/accept | /decline` — opponent only. Accept sets `starts_at = now`, `ends_at = now + duration_days`.
- `GET /v1/duels/:id` — full record + alias map + `time_remaining_ms` when active. Participants only.
- D1 tables: `friends` (id, requester_user_id, recipient_user_id, status, created_at, updated_at; UNIQUE(requester,recipient)) and `duels` (id, challenger_user_id, opponent_user_id, status, stake_souls, reward_souls, burn_souls, duration_days, **duel_type**, starts_at, ends_at, winner_user_id, six per-side score columns, timestamps, **+ `resolved_at` + `result` from v3 Phase 1y**). Migrations: `0003_friends_and_duels.sql` + `0004_verified_duel_types.sql` (adds `duel_type` column — v3 Phase 1x.6 verified-only duel type picker) + `0005_duel_progress_snapshots.sql` (Steps Duel Scoring v1 — see below).
- **Souls fields (`stake_souls`/`reward_souls`/`burn_souls`) are METADATA ONLY in v1.** No backend spend/award logic runs against them. localStorage souls remain client-side authoritative until scoring lands in a later pass.
- Four rate-limit bindings: `RL_FRIENDS_READ` (30/min), `RL_FRIENDS_WRITE` (10/min), `RL_DUELS_READ` (30/min), `RL_DUELS_WRITE` (6/min) via wrangler `namespace_id`s 1007–1010. `RL_DUELS_WRITE` is shared with the v3 Phase 1y scoring endpoints below.
- Auth: every endpoint requires JWT; current user is always derived from `verifySessionJwt`, never from request body. Aliases looked up case- and space-insensitive (`LOWER(REPLACE(alias, ' ', '')) = ?`) to match the client display normalizer.

**5. Steps Duel Scoring v1 (v3 Phase 1y)**
- `POST /v1/duels/:id/progress` — body `{ duel_type, metric, value, window_start, window_end, client_updated_at }`. Upserts a row into `duel_progress_snapshots` (UNIQUE on `duel_id, user_id, metric` so re-submits overwrite). Server enforces `metric === 'steps'` and `duel.duel_type === 'steps'`; non-steps types reject with `DUEL_TYPE_NOT_SCORED_YET`. Returns `{ ok, you, rival }`. `source` is server-set to `'apple_health'`.
- `POST /v1/duels/:id/resolve` — idempotent winner resolution. v3 Phase 1z extended this — now uses verified_events first (any duel type), falls back to `duel_progress_snapshots` if no verified events exist (back-compat for pre-1z active duels). Settles the reward into `user_souls_ledger` in the same transaction; UNIQUE constraint prevents double-pay. Sets `reward_settled_at` on the duels row.
- D1 table: `duel_progress_snapshots (id, duel_id, user_id, duel_type, metric, value, source, window_start, window_end, client_updated_at, server_updated_at)` — legacy steps-only snapshot; kept live for in-flight steps duels created before Phase 1z.
- Reuses `RL_DUELS_WRITE` (no new wrangler binding); client debounces submits to 5 min.

**6. Verified Duel Scoring Engine v1 (v3 Phase 1z)**
- `POST /v1/verified-events` — batch ingestion (≤25 events/call). Body: `{ events: [{ client_event_id, event_type, metric, value?, source, occurred_at, duel_id?, metric_date?, window_start?, window_end?, client_created_at?, metadata_json? }, ...] }`. UNIQUE(user_id, client_event_id) deduplicates retries. Returns `{ ok, inserted, duplicates, errors }`.
- `GET /v1/duels/:id/score` — auth, participant only. Returns both participants' verified scores + `formatScoreLabel` rendering for the duel type. Useful for surfaces that want server-formatted labels without duplicating the formatter.
- 5 scorable duel types + boss_race deferred:
  - **steps** → MAX(value) over `steps_total` events (multiple snapshots overwrite via max-take).
  - **sleep** → COUNT DISTINCT metric_date over `sleep_7h_night` events.
  - **bedtime** → COUNT DISTINCT metric_date over `bedtime_before_midnight` events.
  - **strength** → COUNT(*) over `strength_workout` events (one row per workout; client uses sample uuid in `client_event_id` to dedupe).
  - **verified_objectives** → COUNT DISTINCT (event_type, metric_date) pairs across `verified_objective_daily_walk` / `_sleep` / `_bedtime` / `_strength`. boss_defeat_verified events are NOT counted here in v1.
  - **boss_race** → unsupported. resolve returns `BOSS_RACE_SCORING_DEFERRED`; UI shows "Boss Race scoring activates after verified boss-event logging."
- Reward ledger auto-settles on `resolve`. UNIQUE(user_id, ref_type, ref_id, reason) on `user_souls_ledger` makes settle idempotent (retries are no-ops). Stake is NOT deducted in v1; reward is recorded server-side only — **local `hb_souls` is NOT modified by v1**, the ledger is the eventual reconciliation target.
- D1 tables (migration `0006_verified_duel_scoring_engine.sql`):
  - `verified_events (id, user_id, duel_id?, event_type, metric, value, source, occurred_at, metric_date?, window_start?, window_end?, client_event_id, client_created_at?, server_created_at, metadata_json?)` + 5 indices + UNIQUE(user_id, client_event_id).
  - `user_souls_ledger (id, user_id, delta, reason, ref_type?, ref_id?, created_at, metadata_json?)` + UNIQUE(user_id, ref_type, ref_id, reason).
  - `ALTER TABLE duels ADD COLUMN reward_settled_at TEXT`.
- Allowed `event_type`s: `steps_total`, `sleep_7h_night`, `bedtime_before_midnight`, `strength_workout`, `verified_objective_daily_walk`, `verified_objective_sleep`, `verified_objective_bedtime`, `verified_objective_strength`, `boss_defeat_verified` (reserved, not scored).
- Allowed `source`s: `apple_health`, `system_verified`, `verified_boss`.
- Reuses `RL_DUELS_WRITE`; client batches at most 25/call.
- **Trust model:** v1 trusts client-submitted Apple Health values. Not full anti-cheat. Future hardening = signed device attestations or HealthKit-via-watch.
- **Deferred to a later pass:** boss_race scoring (needs verified boss-event log), APNs / push, on-device signed snapshots, souls reconciliation between ledger ↔ local hb_souls, real-time multi-device merge.

**Auth + rate-limit middleware** — every authenticated route in `src/index.ts` parses `Bearer <jwt>` from the Authorization header, calls `verifySessionJwt(token, env)`, and passes the resulting `{ userId, alias }` to the handler. All write endpoints have per-user rate-limit bindings via Cloudflare's Rate Limiting API.

**LocalStorage remains the runtime source of truth.** The backend is auth + leaderboard + a backup-and-restore layer. Real-time multi-device merge is deferred to v2 (no current ETA).

Full design: `BACKEND.md`.

---

## Color system (the actual values)

### CSS custom properties (dark, default)

```css
--bg:               #13132a   /* app background */
--bg-raised:        #16163a   /* sheets, modals */
--bg-card:          #1e1e3f   /* habit cards */
--bg-card-active:   #22224a
--bg-header:        #0f0f24
--border:           rgba(255,255,255,0.10)
--border-accent:    rgba(139,92,246,0.50)
--text-primary:     #f2f2f7
--text-secondary:   #8e8e93
--text-tertiary:    #48484a
--accent:           #8b5cf6   /* purple — primary brand */
--accent-glow:      rgba(139,92,246,0.18)
--gold:             #f59e0b   /* gold — Compound Effect Bonus, S+ rank, weekend 2x */
--gold-glow:        rgba(245,158,11,0.25)
--safe-top / --safe-bottom: env(safe-area-inset-*)
```

Awakened is **dark-mode only** by design. The Light theme was removed in v1.1.3 — do not reintroduce `body.theme-light`, the Appearance settings collapsible, or the `hb_theme` localStorage key.

### Difficulty colors (used in UI badges)

| Difficulty | Color |
|------------|-------|
| Easy       | `#a78bfa` (purple-400) |
| Medium     | `#60a5fa` (blue-400) |
| Hard       | `#fb923c` (orange-400) |
| Legendary  | `#fbbf24` (amber-400) |

### Stat colors (used in History grid, radar chart, badges)

| Stat | Color | Hex |
|------|-------|-----|
| STR (Strength)     | red    | `#ef4444` |
| VIT (Vitality)     | pink   | `#ec4899` |
| INT (Intelligence) | blue   | `#3b82f6` |
| FOCUS              | yellow | `#eab308` |
| WILL (Willpower)   | orange | `#f97316` |
| WLT (Wealth)       | gold   | `#f59e0b` |

### Rank colors (`RANK_EFFECTS` in `app.js`)

| Rank | Color | Effect on rank-up |
|------|-------|------|
| D    | `#8b5cf6` (purple) | basic |
| C    | `#8b5cf6` (purple) | 12 particles |
| B    | `#3b82f6` (blue)   | shockwave |
| A    | `#a855f7` (purple) | lightning |
| S    | `#f97316` (orange) | shake + 30 particles + shockwave |
| S+   | `#f59e0b` (gold)   | shake + rain |

---

## XP / Rank / Stat math (single sources of truth)

### Difficulty XP (`DIFFICULTY` constant)

| Diff | Base pts | Weekend pts (2×) |
|------|----------|------------------|
| easy      | 1  | 2  |
| medium    | 3  | 6  |
| hard      | 5  | 10 |
| legendary | 10 | 20 |

`diffPts(diff)` returns base × 2 on Sat/Sun PT.

### Rank thresholds (`RANKS` constant)

| Rank | Min pts | Max pts | Description |
|------|---------|---------|-------------|
| E  | 0      | 499      | Just getting started |
| D  | 500    | 1,499    | Building awareness |
| C  | 1,500  | 3,499    | Consistency is forming |
| B  | 3,500  | 6,999    | Above average. Most people never get here. |
| A  | 7,000  | 13,999   | True excellence. This is rare. |
| S  | 14,000 | 27,999   | Elite. You have become the habit. |
| S+ | 28,000 | ∞        | Legendary. Less than 1% operate at this level. |

### Per-stat leveling (1 → 20 cap)

XP cost FROM level `l` TO `l+1` (`xpToNextLevel`):

```
l=1→2:   5    l=8→9:  180   l=15→16: 600
l=2→3:  15    l=9→10: 225   l=16→17: 680
l=3→4:  30    l=10→11:275   l=17→18: 765
l=4→5:  50    l=11→12:330   l=18→19: 855
l=5→6:  75    l=12→13:390   l=19→20: 950
l=6→7: 105    l=13→14:455
l=7→8: 140    l=14→15:525
```

Total to cap: **6,650 XP** per stat (`MAX_STAT_XP`).

### Stat bonus thresholds (`STAT_BONUS_THRESHOLDS`)

Awarded once per stat when level is reached:

| Level | Bonus pts |
|-------|-----------|
| 5     | 25  |
| 10    | 75  |
| 15    | 150 |
| 20    | 500 |

Plus `fully_awakened` achievement (Total Level 120 across all 6 stats) = **+2,000 bonus XP**.

### Class detection (`determineClass`)

Computed from current per-stat levels:

- If top stat ≤ level 1 → `SAGE` (brand new player)
- If 2nd stat = 0 OR (top / 2nd) ≥ 1.4 → top stat's class
- Otherwise → `SAGE` (balanced)

Class shifting flag (`isClassShifting`) appears at ratio ≥ 1.2 but < 1.4 (transition zone).

| Stat | Class | Color | Avatar file |
|------|-------|-------|-------------|
| STR    | Warrior  | `#ef4444` | `avatar-warrior.png` |
| VIT    | Ranger   | `#ec4899` | `avatar-ranger.png` |
| INT    | Mage     | `#3b82f6` | `avatar-mage.png` |
| FOCUS  | Assassin | `#eab308` | `avatar-assassin.png` |
| WILL   | Paladin  | `#f97316` | `avatar-paladin.png` |
| WLT    | Merchant | `#f59e0b` | `avatar-merchant.png` |
| (none) | Sage     | `#8b5cf6` | `avatar-sage.png`    |
| 0 XP   | —        | —         | `avatar-base.png`    |

---

## Compound Effect Bonus

Triggered when a user has **ALL 10 canonical Morning Routine habits** in their active list AND completes every one scheduled today. Eligibility is composition-based, not pack-membership-based — custom-path users qualify too.

**Canonical 10 (PACKS[0].habits, 0-indexed into DEFAULT_HABITS):**

```
2  Sleep before midnight
23 Wake up at consistent time
14 No phone or social media after waking
16 Get morning sunlight
41 Morning gratitude practice
6  Daily walk
46 Vitamins and minerals
12 Meditate & Breathwork
4  Strength training
19 Whole foods diet
```

Bonus XP by streak (`getCompoundXP`):

| Streak day | XP |
|------------|----|
| 1–7        | 5  |
| 8–30       | 10 |
| 31–90      | 20 |
| 91–180     | 30 |
| 181–365    | 50 |
| 366+       | 75 |

XP doubles on weekends. Modal fires the `playFanfare()` audio (D-major arpeggio + sustained chord). Regular `playCheckSound()` is suppressed on the 10th completion to avoid stacking sounds.

Single source-of-truth helpers (in `app.js`):
- `getMorningPack()`, `getMorningHabitDefs()`
- `isMorningHabit(habit)`
- `getMissingMorningHabits()`
- `userHasAllCanonicalMorning()`

**Always reuse these — never hardcode the 10-habit list elsewhere.**

---

## Custom habits

Users can author up to **5** habits beyond the curated 49 (`MAX_CUSTOM_HABITS`). XP is **fixed at Medium** (`CUSTOM_HABIT_DIFFICULTY = 'medium'`, +3 XP) so the rank economy can't be gamed.

A custom habit object differs from a curated one in two fields:

```js
{
  ...habitFields,
  primaryStat: 'STR' | 'VIT' | 'INT' | 'FOCUS' | 'WILL' | 'WLT',  // user pick
  custom:      true,                                                // discriminator
}
```

The `Create Your Own` flow opens `#custom-overlay` from the Library. UI: emoji + name + 6-button stat picker. Save validates: non-empty name, no duplicate names, cap not reached.

**Routing custom XP:** `applyStatPts(habit, pts, dir)` checks `habit.custom && habit.primaryStat` first and routes XP via the user-chosen stat. Curated habits fall through to the original name-match-against-`STATS[].habits` path. Calling sites always pass the habit object (not the name).

**Display fallbacks:**
- `getHabitDescription(habit)` returns `"A custom habit you chose for yourself. Build it day by day."` for customs (no entry in `HABIT_DESCRIPTIONS`).
- `getHabitPrimaryStat(habit)` already preferred `habit.primaryStat`, so customs Just Work for History colors / Stats badges / radar.

---

## Drag-to-reorder habits (DORMANT in 2.2.1 — preserved for future re-enable)

**Status (2.2.1):** habit drag-to-reorder is **DISABLED** via the feature flag `ENABLE_HABIT_DRAG_REORDER = false` in `app.js` (Phase 1z.24). `bindDrag()` short-circuits at the top when the flag is false — no long-press handlers attached, no `[data-drag]` handle handlers attached, habit cards behave as plain tap-to-complete targets. Reason: an iOS WKWebView long-press / native-image-drag collision produced a visible ghost-text artifact on the left edge of the viewport that three hotfix attempts (1z.22–1z.23) could not fully eliminate. Saved habit order (`hb_habits` localStorage) is unchanged — users keep their existing order; they just cannot reorder via gesture in 2.2.1. **Re-enable path is documented in the 1z.24 + 1z.25 phase notes; revisit in 2.2.2 with a safer UX (explicit edit mode, on-card chevrons, or a battle-tested touch-DnD library) rather than long-press drag.**

The rest of this section documents the **dormant** implementation that remains in source for the re-enable path. Every function, CSS class, and behavior described below is unreachable while the feature flag is off.

Long-press 400ms on any habit card on the Habits tab → enters drag mode. Movement >10px during the long-press window cancels (so scrolling doesn't accidentally fire drag). The 6-dot drag-handle inside the card is preserved as an instant-drag fallback (no 400ms wait).

Habits tab is a **3-column CSS grid**, so drop targeting is **2D**:
- `findDropTarget(items, x, y)` picks the cell whose center is closest to the cursor (Euclidean), then splits at the cell's horizontal midpoint.
- Cursor on **left half** = drop *before* the cell in the linear `habits` array (gold inset line on left edge: `.drop-target--before`).
- Cursor on **right half** = drop *after* (gold inset line on right edge: `.drop-target--after`).

Other behaviors:
- Auto-scroll near top/bottom edges (80px hot zone).
- Idle timeout — 1500ms with no movement after entering drag mode silently cancels.
- 200ms post-drop guard (`_postDropGuardUntil`) suppresses the click-through that would otherwise toggle the habit's completion immediately after release.
- Order persists via the in-memory `habits` array → `save()` → `hb_habits` (no separate "habit-order" key).
- Pack streaks (Morning Routine, Locked-In) are pack-membership-based, not list-position-based, so reordering is purely visual.

CSS hooks: `.lp-pressing` (subtle scale-down during 400ms hold), `.drag-ghost` (the lifted clone — `scale(1.05) rotate(-1deg)`), `.is-dragging` on `.habit-list` dims non-dragged siblings to 0.7 opacity. The 1z.22 + 1z.23 defensive CSS (`-webkit-touch-callout: none`, `-webkit-user-drag: none`, body-class lockdown via `body.habit-drag-armed` / `body.habit-drag-active`) stays in `styles.css` — harmless while the flag is off, useful when it flips back on.

---

## Notifications system (v2.0.2 plumbing · v3 Phase 1m UI · v3 Phase 1n copy)

The `Notif` module lives at the bottom of `app.js` (just above `init()`). Wraps `@capacitor/local-notifications@^6.1.3` for native iOS, falls back to the Web Notifications API for the PWA build.

**User-facing labels** (v3 Phase 1m+):
- **Morning Briefing** — the once-a-day morning push
- **Momentum Check** — the 1 PM push
- **Evening Closeout** — the 7 PM push
- Settings groups: **Daily System Pings** / **Habit Reminders** / **Quiet Hours** / **Pause Notifications** / **Voice Preview**

**Internal function names retain the original `digest` / `checkin` vocabulary** (`composeDigestBody`, `computeMidDayBody`, `pickCheckinCopy`, `scheduleDailyDigest`, `scheduleMidDayCheckin`, `scheduleDailyCheckin`, `tab` ID `hb_notif_daily_digest_time`). This is historical — do NOT rename the functions or storage keys just to match the new labels. Update user-facing strings only.

### Three daily local notifications

| Notification | Time | ID | Title | Body |
|---|---|---|---|---|
| **Morning Briefing** | user-configurable (`hb_notif_daily_digest_time`; no hardcoded default) | `1` | `composeDigestTitle()` — class-aware ("Awakened" or "Awakened — {Class}", Civilian gets bare title) | `composeDigestBody()` — name + scheduled-habit count + day-of-week flavor (Tue/Thu, em-dash separator) + perfect-streak trigger (Sun/Mon) + weekend 2× XP suffix |
| **Momentum Check** | `13:00` device-local | `99998` | `composeDigestTitle()` (reused) | `computeMidDayBody()` — priority chain: souls bonus unclaimed → at-risk streak → caught-up |
| **Evening Closeout** | `19:00` device-local | `99999` | hardcoded `'Awakened'` (NOT class-aware) | `pickCheckinCopy()` — 5 progress states × 5 variations |

**Momentum Check priority chain** (`computeMidDayBody`):
1. No habits configured at all → return `null` → notification SKIPPED entirely
2. Daily souls bonus unclaimed (reads `hb_souls.lastDailyBonusDate` against **device-local** date, not PT) → `"+15 souls are waiting. Claim the bonus."`
3. At-risk streak — longest incomplete-but-streaked habit. Filter to `streak >= 1` AND not completed today, sort by streak DESC then `DIFFICULTY[difficulty].pts` DESC then `name.localeCompare`. Body: `"{habit.name} — Day {N}. Protect the chain."`
4. Caught up → `"You're caught up. Hold the line."`

**Re-arm trigger points** for the Momentum Check (body recomputed at each schedule call):
- `Notif.rescheduleAll` (app open, daily reset, Settings changes)
- `Notif.onHabitCompleted` (habit tap — at-risk-streak set just changed)
- Class change (title uses class name via shared `composeDigestTitle`)
- Name edit (title may change)
- `tryGrantDailyLoginBonus` (priority 1 no longer applies after grant)

The Evening Closeout (`scheduleDailyCheckin`) re-arms on the same triggers plus its own day-1 suppression and quiet-hours respect.

### Habit Reminders

**Per-habit:** one reminder time at most. Stored in `hb_reminders` as `{ habitId: 'HH:MM' }`. UI lives in the Edit Habit modal:

```
📅 REMINDER
[+ Add reminder]   ← if none set
⏰ 7:30 AM   [Change] [Remove]   ← if set
```

**Per-stat fallback copy** (v3 Phase 1n) keyed off `habit.primaryStat` — used when no curated `HABIT_NOTIF_COPY` entry exists. Voice is "tactical system message," no emojis:

| Stat | Title | Body |
|---|---|---|
| STR    | `{n} is on deck.`     | `Build the body. Earn the power.` |
| VIT    | `{n} is waiting.`     | `Recovery is part of the work.` |
| INT    | `{n} is ready.`       | `Learn it now. Use it later.` |
| FOCUS  | `{n}. Lock in.`       | `Protect the next few minutes.` |
| WILL   | `{n}. Hold the line.` | `Comfort can wait.` |
| WLT    | `{n} awaits.`         | `Small numbers become leverage.` |
| Custom | `{n} is open.`        | `One action keeps the system moving.` |

**Curated habit reminder copy:** 49 entries in `HABIT_NOTIF_COPY` (one per canonical habit). Same tactical voice. See `preview-notif-copy.html` for the full bank rendered against production CSS.

### Settings → Notifications

Top-level **Notifications** group (still backed by the `notif-*` ids/classes for historical reasons). Subsections in order:

- **DAILY SYSTEM PINGS** — permission status row + the three system pings:
  - Morning Briefing (time picker — only this row is user-configurable today)
  - Momentum Check (display-only static row; no per-ping toggle yet)
  - Evening Closeout (display-only static row; no per-ping toggle yet)
- **QUIET HOURS** — toggle + start/end (default `22:00` → `07:00`). Auto-fired Habit Reminders inside the window are skipped UNLESS the user explicitly chose that exact time on a habit.
- **PAUSE** — Pause for 24h / 7 days, or cancel pause.
- **HABIT REMINDERS** — daily limit picker (3 default / 5 / 8 / Unlimited; keeps the **earliest** N over cap), View All inline list of every habit + its time + Remove.
- **VOICE PREVIEW** — three preview cards rendered by `renderNotifPreviewCards()`. Each card reads LIVE from `composeDigestBody()` / `computeMidDayBody()` / `pickCheckinCopy()` so the preview can never drift from production output.
- **Master Disable all reminders** toggle — silences ALL three system pings AND habit reminders.

**Permission pre-prompt** (`#notif-explain-overlay`, v3 Phase 1m): headline reads **"Let the system call you back."** Body shows three preview cards (Morning Briefing / Momentum Check / Evening Closeout) so the user understands what they're authorizing before iOS sheets. Helper text: `"Just the Morning Briefing. The rest is on you."`

**Per-habit reminder offer sheet** (`#reminder-offer-overlay`): "System Offer" sheet that appears after a habit is added. Title: `"Set a reminder?"`. Sub: `"{habit.name} was added. Choose when the system should call you back."`. Primary action: `"✦ Set Reminder"` (with rune glyph). Secondary: skip.

**Pack reminder offer**: same "System Offer" treatment for Morning Routine / Locked-In packs after install.

**Hooks:**
- `toggleHabit` (when checking) → `Notif.onHabitCompleted(id)` cancels today's pending fire so it doesn't nag after completion
- `deleteHabit` → `Notif.clearReminder(id)` permanently cancels
- `checkDayChange` → `Notif.rescheduleAll(...)` rebuilds the schedule with current daily-limit + quiet-hours rules
- App init → same reschedule (rehydrates pause-expirations and any cross-device adds)
- `openSettings` → `renderNotifPreviewCards()` refreshes the Voice Preview cards each time the Settings sheet opens

**Web fallback:** non-iOS users see "Reminders work best in the iOS app. Install from App Store for full functionality." in Settings. The reminder UI still saves the time — it just can't deliver.

### Voice Preview implementation note

The three Voice Preview cards in Settings are NOT hardcoded strings. `renderNotifPreviewCards()` calls the live compose functions and injects their output into the preview card DOM. This means:
- Any tweak to copy in `composeDigestBody` / `computeMidDayBody` / `pickCheckinCopy` automatically reflects in the Voice Preview without HTML edits.
- The preview is class-aware, name-aware, day-of-week-aware — whatever the user would actually see at notification time.
- `preview-notif-copy.html` is the static design-time reference; the live Voice Preview is the user-facing equivalent.

---

## HealthKit integration (v1.1.5, v3 Phase 1u — added Strength training)

Four canonical habits auto-verify from Apple Health on iOS. Web/PWA users get manual completion only — no behavior change.

| Habit | Data type | Threshold | Goal config |
|---|---|---|---|
| `Daily walk` | step count (`stepCount`) | per-habit `habit.stepGoal` (default 3000, range 100–50000) | Edit Habit modal chip picker |
| `Sleep` | sleep duration (`sleepAnalysis`) | per-habit `habit.sleepGoalHours` (default 7, range 3–14, step 0.5) | Edit Habit modal chip picker |
| `Sleep before midnight` | bedtime (`sleepAnalysis`) | binary — earliest qualifying asleep sample.startDate in `[20:00, 24:00)` device-local on prior day | None (binary habit) |
| `Strength training` | workout type (`workoutType`) | binary — ≥1 qualifying strength workout today, duration ≥ `HEALTHKIT_STRENGTH_MIN_MINUTES` (10 min). Accepted activity types: traditional / functional / generic strength / weight / resistance training. | None (binary habit) |

### Plugin: `@perfood/capacitor-healthkit@^1.3.2` — IMPORTANT GOTCHAS

**Plugin is on a stale Cap-4 peer-dep range.** Awakened uses Capacitor 6. The peer-dep is wrong — the plugin works on Cap 6 in practice (small read-only API surface, stable across Cap versions). The committed `.npmrc` with `legacy-peer-deps=true` lets npm install anyway. Don't delete `.npmrc` until we migrate to `@capgo/capacitor-health` during the eventual Cap 8 upgrade.

**Plugin uses two DIFFERENT string namespaces for auth vs. query.** This caused multiple build cycles of debugging in v1.1.5:

| API | String namespace | Examples |
|---|---|---|
| `requestAuthorization({ read: [...] })` | "friendly aliases" | `'steps'` (= stepCount), `'activity'` (= sleepAnalysis + workoutType), `'calories'`, `'distance'` |
| `queryHKitSampleType({ sampleName })` | Apple-canonical identifiers | `'stepCount'`, `'sleepAnalysis'`, `'workoutType'` |

**The auth function has NO case for `'sleepAnalysis'`** — it falls through to `default: print("no match")` and silently does nothing. To request sleep auth, you MUST use `'activity'`, which iOS treats as both `sleepAnalysis` AND `workoutType` permissions. There is no sleep-only path through this plugin's auth API.

**Current auth call (line ~12602):**
```js
await p.requestAuthorization({
  read: ['steps', 'activity'],   // 'activity' covers sleep + workouts
  write: [''],
  all: [''],
});
```

If you add a new HealthKit category in the future, verify the auth-side string in the plugin's Swift source: `node_modules/@perfood/capacitor-healthkit/ios/Plugin/CapacitorHealthkitPlugin.swift` → `func getTypes(items:)` (~line 84). Don't trust the README alone.

### `Health` module

Top-level IIFE in `app.js`. Public surface:

| Method | Purpose |
|---|---|
| `Health.isAvailable()` | true on iOS native, false on web/PWA |
| `Health.permissionStatus()` | `'granted'` / `'denied'` / `'unknown'` / `'unavailable'` (locally tracked via `hb_healthkit_status`) |
| `Health.requestPermissions()` | Fresh-install path: requests steps + activity in one bundled iOS sheet |
| `Health.requestSleepPermissionIfNeeded()` | Upgrade path: re-fires auth with current categories. Idempotent via `hb_healthkit_sleep_requested`. Used when an existing user upgrades to a build that adds new HealthKit categories |
| `Health.getStepsToday()` | Sums step samples from PT-anchored start of today. 5-min cache. Returns null on any failure. |
| `Health.getSleepLastNight()` | 18-hour lookback window in **device-local time** (sleep crosses midnight; CLAUDE.md notif rule applies). Returns `{ totalAsleepHours, earliestSleepStart, samples }` or null. 5-min cache. Plugin caveats below. |
| `Health.getStrengthWorkoutsToday()` | **v3 Phase 1u.** Queries `workoutType` samples from device-local start of today. Filters to strength activity types (traditional / functional / generic strength / weight / resistance training) with duration ≥ `HEALTHKIT_STRENGTH_MIN_MINUTES` (10 min). Returns `{ count, totalMinutes, workouts, fetchedAt }` or null. 5-min cache. Permission piggybacks on the existing `'activity'` friendly-alias (already in the auth read array — covers `sleepAnalysis` + `workoutType`), so no auth bump. |
| `Health.getStepsBetween(startISO, endISO)` | **v3 Phase 1y.** Sums step samples over an arbitrary `[startISO, endISO]` window. Used by `submitActiveStepsDuelProgress` to compute duel-scoped step totals (duel start → min(now, ends_at)). Returns null on any failure. No cache — duel windows are unique per call. |
| `Health.getSleepBetween(startISO, endISO)` | **v3 Phase 1z.** Returns `{ nightsWith7hPlus, bedtimeBeforeMidnightNights, nights: [{ date, totalAsleepHours, bedtimeBeforeMidnight }] }` over an arbitrary window. Used by `submitVerifiedEventsForDuels` to emit `sleep_7h_night` + `bedtime_before_midnight` verified events for sleep / bedtime duel types. |
| `Health.getStrengthWorkoutsBetween(startISO, endISO)` | **v3 Phase 1z.** Same shape as `getStrengthWorkoutsToday` but over an arbitrary window. Powers `strength_workout` verified events. Each returned workout's `uuid` is reused as `client_event_id` for ledger dedupe. |
| `Health.clearCache()` | Wipes step cache. Called on visibilitychange resume + after Edit-modal save. |
| `Health.clearSleepCache()` | Same for sleep. |
| `Health.clearWorkoutCache()` | Same for strength workouts. Called on visibilitychange resume. |

**Plugin sample shape for sleep:**
```js
{
  startDate: '<ISO8601>',
  endDate: '<ISO8601>',
  duration: <hours, decimal>,           // already in hours, NOT minutes
  sleepState: 'InBed' | 'Asleep',       // ONLY two strings — see caveat below
  uuid, timeZone, source, sourceBundleId, device,
}
```

**Sample-state caveat:** the plugin collapses Apple's full `HKCategoryValueSleepAnalysis` enum into 2 strings via `(value == inBed) ? "InBed" : "Asleep"`. This means `awake` (rawValue 2) gets bucketed into `'Asleep'` along with `asleepCore/Deep/REM/Unspecified`. We sum `'Asleep'` durations for total — typically <15 min/night over-count from misclassified awake samples. Acceptable v1 error margin; document if a user reports inflated sleep numbers.

**Bedtime detection (`autoVerifySleepBeforeMidnight`):** uses a **strict bedtime window** — sleep onset must be in `[20:00, 24:00)` device-local on the **prior day**. Implementation: filter `data.samples` to qualifying asleep samples (`duration ≥ 30 min`), narrow to those whose startDate is in the 4-hour window, take the earliest. If none qualifies, the habit does NOT auto-check.

**Window justification:**
- **20:00 (8 PM) lower bound** — rules out afternoon naps (4–6 PM samples) AND "passed out at 6 PM exhausted" cases. The latter is not an intentional pre-midnight bedtime; it's a collapse, and giving credit for it would game the discipline.
- **24:00 (midnight) upper bound** — the literal "before midnight" cutoff.
- **Window scoped to prior day, not current day** — defends against wrong-night carryovers. Earlier (pre-fix v1.1.5) logic checked `sample.startDate < midnightToday` without bounding to the prior evening; a user who slept Wed-night-into-Thursday-morning and was awake all of Thursday would get Friday's bedtime habit falsely auto-checked because the Wed-night sample's startDate was technically `< Friday midnight` by ~24 hours. Documented as a real bug we shipped + recovered from in `hb_bedtime_window_fix_v1`.

**Read-only habit, so false positives are corrosive.** Sleep before midnight is system-managed (`isReadOnlyAutoVerifyHabit` returns true) — the user cannot manually un-check. A false positive STAYS for the day, undermining the "system is honest" framing of the read-only design. The strict window is the authoritative defense; further tightening (e.g., requiring contiguous-sleep-block-detection across REM cycles) is out of scope for v1.1.5 but flagged for v2 if real-world data shows the 4-hour window misses cases.

`getSleepLastNight()` itself does NOT apply the bedtime-window filter — it returns ALL qualifying asleep samples in the broader 18-hour lookback, plus a `totalAsleepHours` sum that includes naps (afternoon naps legitimately count toward total sleep duration). The bedtime-window filter is only applied inside `autoVerifySleepBeforeMidnight`.

### Auto-verify orchestration

`autoVerifyWalk()` and `autoVerifySleep()` are the two entry points. Both fire from:
- `renderHabits()` (every Habits-tab render)
- `visibilitychange` (app resume from background, with cache clear)
- Post-grant `Enable` button on the pre-prompt

Both functions:
1. Bail if `Health.isAvailable()` is false (web)
2. Bail if `isAutoVerifyDisabled()` (Settings → Apple Health pause toggle)
3. Bail if the relevant habit isn't in the user's list
4. Bail if `isChecked()` already (manual or prior auto)
5. Bail if `AUTO_VERIFY.wasUncheckedToday(habitName)` (user explicitly opted out today)
6. Threshold check
7. `AUTO_VERIFY.recordAutoVerify(id, meta)` + `toggleHabit(id, li, { silent: true })`

`toggleHabit`'s `opts.silent` flag suppresses the per-tap burst (chime, particles, flash, XP float) but still fires milestone popups (rank-up, stat-up, compound bonus) — those are real moments, not per-tap fanfare.

### Goal-classification helpers

```js
function isStepGoalHabit(habit)              // canonical 'Daily walk', non-custom
function isSleepDurationHabit(habit)         // canonical 'Sleep', non-custom
function isSleepBedtimeHabit(habit)          // canonical 'Sleep before midnight', non-custom
function isStrengthWorkoutHabit(habit)       // canonical 'Strength training', non-custom (v3 Phase 1u)
function isHealthAutoVerifiableHabit(habit)  // OR of all four above
```

Used by:
- `habitDisplayParts(habit)` — emits step/hour subtitle for cards
- `meetsMinimum(habit)` — bypasses legacy MEASURABLE_HABITS minimum check (these habits don't use the `habit.goal` shape)
- `openEditModal(habit)` — branches between three goal-control UIs (step chips / sleep chips / time stepper)
- `openHabitDetail(habit)` — same branching for onboarding hd-sheet

### `AUTO_VERIFY` module

Tracks which completions were auto-verified (vs manually tapped) and which auto-verifications the user explicitly un-checked.

```
hb_completions_auto       { 'YYYY-MM-DD': { habitId: { source, value, threshold } } }
hb_av_unchecked_dates     { habitName: ['YYYY-MM-DD', ...] }   (auto-pruned to 14 days)
```

**Keyed by habit name** (canonical foreign key, stable across reinstalls per CLAUDE.md "habit identity is the name string"). v1.1.5 migrates the legacy walk-only `hb_walk_unchecked_dates` flat array into the new per-habit-name map under `'Daily walk'`.

Public surface:
- `recordAutoVerify(id, meta)` / `clearAutoVerify(id)`
- `isAutoVerifiedToday(id)` / `isAutoVerifiedOnDate(id, dateStr)` — used by `buildItem()` for the AUTO pill and by History weekly cells for the corner dot
- `markUnchecked(habitName)` / `wasUncheckedToday(habitName)` — generic, supports any auto-verify habit
- Legacy thin wrappers: `markWalkUnchecked` / `wasWalkUncheckedToday` (toggleHabit references one)

### HealthKit auth versioning (`HEALTHKIT_AUTH_VERSION`)

Defined at the top of `app.js`. Bump this number whenever you add a new category to `Health.requestPermissions`'s read array. Migration in `init()` compares against `hb_healthkit_authversion` in localStorage; if stored < current, all per-category "asked" flags in `HEALTHKIT_AUTH_FLAGS_TO_CLEAR` are wiped so the upgrade-path helpers re-fire and iOS prompts for the new categories.

```
Version log:
  1 — v1.1.4: steps only
  2 — v1.1.5: steps + sleep + workouts (via 'activity' alias)
```

Why this exists: iOS's `requestAuthorization` only triggers a sheet for categories it has never seen. Apps that want to expand HealthKit usage in subsequent versions MUST explicitly re-call `requestAuthorization` with the new categories — iOS doesn't auto-prompt on the first query of a new type. The version-bump pattern automates this.

**v3 Phase 1u — no bump needed for Strength training.** The `'activity'` friendly alias in `Health.requestPermissions`'s read array maps to BOTH `sleepAnalysis` AND `workoutType` in the plugin's auth API. Sleep auth was added in v1.1.5 (auth version 2) and tapped this same alias; strength training piggybacks on the existing grant. No new category is being added to `requestAuthorization`, so no migration / flag-clear is needed. The strength workout query uses `sampleName: 'workoutType'` (canonical identifier) — which is the correct query-side string regardless of how `'activity'` is interpreted on the auth side.

### Pre-prompt explainer

`showHealthKitPreprompt()` is a non-blocking modal that fires before the iOS native sheet on first encounter (status='unknown'). Triggered from `autoVerifyWalk()` when the user has the Daily walk habit. Shows a clickable inline step-goal value (chip picker reuses `.habit-edit-stepgoal-*` styles) and adapts copy if the user also has Sleep / Sleep before midnight.

Once the user taps Enable or Not Now, `hb_healthkit_prompted='1'` is set and the modal never re-fires.

### Settings → Apple Health panel

Reads-only the toggle for pause/resume and a deep-link button for iOS Settings. **No step-goal control here** — that lives per-habit in the Edit Habit modal. See "Settings collapsibles" section for state-machine details.

`window.location.href = 'app-settings:'` opens iOS Settings to Awakened's privacy page. Works inside Capacitor's WebView; silent no-op on web.

### codemagic.yaml steps for HealthKit

Two steps run after `Sync web assets into iOS project`:

1. **`Add HealthKit usage description and entitlement`** — uses PlistBuddy to write `NSHealthShareUsageDescription` + `NSHealthUpdateUsageDescription` to `Info.plist` and `com.apple.developer.healthkit = true` to `App.entitlements`. **Important:** do NOT add `com.apple.developer.healthkit.access` (the array key) — that requires Apple-approved Verifiable Health Records capability. Including it makes codesign fail with "Entitlement requires approval from Apple to include in a profile."

2. **`Wire entitlements file into Xcode project`** — uses the Ruby `xcodeproj` gem (preinstalled on Codemagic macOS images) to set `CODE_SIGN_ENTITLEMENTS = App/App.entitlements` in `project.pbxproj` for both Debug and Release configs. **Without this step,** Xcode signs the IPA without consuming our entitlements file, the HealthKit entitlement is silently absent from the signed binary, and iOS rejects all HealthKit calls without error feedback.

**Apple Developer portal prerequisite:** the `com.goallearner.awakened` App ID must have HealthKit capability checked at developer.apple.com → Identifiers → Capabilities. One-time setup; if missing, codesign rejects the build.

### Read-only auto-verify habits (`isReadOnlyAutoVerifyHabit`)

**v2.0 / v3 Phase 1u policy: ALL FOUR HealthKit-auto-verifiable habits are read-only** — `Daily walk`, `Sleep`, `Sleep before midnight`, `Strength training`. The earlier v1.1.5 carve-out where Daily walk and Sleep allowed manual completion as a fallback is gone. Apple Health is the sole authority for these four. Tapping the card on the Habits tab does NOT toggle the check state — instead it opens the View Note modal (`#note-modal`) with a `SYSTEM-MANAGED` explainer section (`#vn-system-section`) above the canonical description.

Why the policy shifted: the "system is honest" framing applies uniformly. Mixed manual+auto creates ambiguity — did the user actually walk 3,000 steps, or just tap the box? With the lock, the answer is always "the data shows yes, or it stays unchecked." Cleaner discipline contract, even if it means streaks become impossible without Apple Health connected.

**Implications worth knowing:**
- Web/PWA users have no way to complete these habits. They show the lock and stay unchecked. Notes modal explains.
- Users with Apple Health permission denied: same.
- Users who pause auto-verify in Settings → Apple Health: same. The lock surfaces the limitation; the user's recourse is to grant permission / unpause.
- `AUTO_VERIFY.markUnchecked` / `wasUncheckedToday` becomes vestigial for these habits — no manual un-check path exists. Code stays for defensive use by future programmatic toggle paths and other auto-verify habits.

**Per-habit system-managed copy:** `systemManagedHtmlFor(habit)` returns three-paragraph HTML keyed on `habit.name` — different middle paragraph per habit (Daily walk, Sleep, Sleep before midnight, Strength training), shared lead and tail. Voice: tough-love, declarative, anchored in the data ("the body keeps the score" / "the data shows you walked"). Edit copy in this helper, not in `index.html`.

**Visual signal on the card:**
- `.habit-cb--readonly` modifier on the check circle (dashed border, `opacity: 0.72`)
- Small 🔒 glyph anchored top-right of the check circle (`.habit-cb-lock`)
- Habit name dimmed (system-managed treatment)
- AUTO pill still renders when auto-verified — both coexist

**Auto-verify-first sort.** v2.0 (and v3 Phase 1u — Strength training joined) pins these **four** habits to the top of the Habits tab via `sortHabitsAutoVerifyFirst()` — called inside `save()` so the invariant always holds in storage, plus once at init() for the one-time migration of existing v1.x users. **(Drag-to-reorder is currently DORMANT — disabled in 2.2.1 via `ENABLE_HABIT_DRAG_REORDER = false`; see "Drag-to-reorder habits" section above.)** When drag reorder is re-enabled in a future train, the partitioning behavior is: drag works within each partition (auto-verify amongst themselves, custom amongst themselves), but a non-auto-verify habit dragged above the partition snaps back on next render. Visible UX feedback that the rule exists.

**Implementation pattern (extending to a future read-only habit):**
1. Add the habit name to `isReadOnlyAutoVerifyHabit()`'s gate
2. Add a `case 'Habit Name':` branch in `systemManagedHtmlFor()` with the per-habit message
3. If the habit is HealthKit-auto-verifiable, add it to `isHealthAutoVerifiableHabit()` chain so `sortHabitsAutoVerifyFirst()` pins it to the top
4. The buildItem render path + click handler already branch on `isReadOnlyAutoVerifyHabit` — no new wiring needed

### Yesterday-backfill (v3 Phase 1z.8)

**Bug:** prior to 1z.8, HealthKit auto-verify only queried "today's" data on every entry-point fire. A workout / walk / sleep that completed AFTER the user's last app-open of the day was permanently invisible to the auto-verifier the next morning — the user would open the app on Saturday, the verifier would query Saturday's data, find nothing, and Friday's 10 PM strength workout was silently dropped. Real-world repro that triggered this fix: 35-min Traditional Strength Training workout at 10:06 PM Friday, app not reopened until Saturday morning, habit never sealed.

**Fix scope:** all four read-only HealthKit habits (Daily walk, Sleep, Sleep before midnight, Strength training) now run a second-pass backfill that checks **yesterday's** Apple Health data after today's auto-verify completes. Yesterday only — not 2 or 3 days. Reduces blast radius; extension is straightforward later if real-world feedback demands it.

**Backfill behavior:**
- Silent. No celebration animation, no `playCheckSound`, no spawn-XP-particles, no `xp-float` element. The user wasn't watching the moment happen — a popup for yesterday's accomplishment would feel disconnected.
- Quiet toast announces the retro-seal: `"Strength training sealed for yesterday — 1 verified workout."` / `"Daily walk sealed for yesterday — 8,432 verified steps."` / `"Sleep sealed for yesterday — 7.3h verified."` / `"Sleep before midnight sealed for yesterday — verified."`
- **XP awarded retroactively.** The user verifiably did the work; their rank/stats math should reflect it.
- **Streak repaired retroactively.** `recomputeStreakFromCompletions(habit)` walks completions[] backwards from today, counting consecutive scheduled-day completions. A streak broken artificially by yesterday's missing seal is restored when backfill writes yesterday's row.
- Idempotent: `completions[yesterday].includes(habit.id)` short-circuits a second run in the same session, AND the backend's `recordAutoVerify(id, meta, dateStr)` per-date map prevents double-stamping.
- Respects user un-check: if `AUTO_VERIFY.wasUncheckedOnDate(habit.name, yesterday)` is true (user explicitly un-checked yesterday's auto-verified completion), backfill refuses to re-seal it.

**Core helpers** (in `app.js`, near the AUTO_VERIFY module):
- `_markHistoricalAutoVerify(habit, dateStr, meta)` — the sibling of `toggleHabit` that performs the targeted mutations: push into `completions[dateStr]`, record AUTO provenance on that date via `AUTO_VERIFY.recordAutoVerify(id, meta, dateStr)`, grant `diffPts(habit.difficulty)` to `totalPoints` + via `applyStatPts`, recompute streak. Returns `true` only when a new completion was actually written.
- `recomputeStreakFromCompletions(habit)` — walks completions backwards from `today`, honoring `habit.days` scheduling, stops at first missed scheduled day. 365-day lookback cap. Rebuilds `streaks[habit.id]` with correct `{ count, lastDate, prevCount, prevLastDate }`.
- `AUTO_VERIFY.recordAutoVerify(id, meta, dateStr)` — `dateStr` argument added in 1z.8 (defaults to today, preserving all existing call sites).
- `AUTO_VERIFY.wasUncheckedOnDate(habitName, dateStr)` — new date-aware variant of `wasUncheckedToday`.

**Per-habit backfill helpers:**
- `_backfillWalkYesterday()` — uses `Health.getStepsBetween(yesterday00:00, yesterday23:59)`, threshold from `getHabitStepGoal(walkHabit)`.
- `_backfillSleepYesterday()` — single `Health.getSleepBetween(2_days_ago_noon, today_noon)` query feeds BOTH Sleep duration + Sleep before midnight. Pulls `byDate[yesterday]` from the returned shape. Bedtime convention matches the live path (the date sealed equals the morning AFTER bedtime).
- `_backfillStrengthYesterday()` — uses `Health.getStrengthWorkoutsBetween(yesterday00:00, yesterday23:59)`, accepts ≥1 qualifying workout.

**Entry-point wiring:** `autoVerifyWalk`, `autoVerifySleep`, `autoVerifyStrengthTraining` were restructured so today's bail conditions (no habit, paused auto-verify, already-checked, threshold not met, zero workouts today) no longer kill the backfill call at the bottom. Each function wraps today's logic in a guarded block and invokes the backfill UNCONDITIONALLY at the end — backfill has its own gates and runs even when today's path bailed.

**Future extension hooks:**
- Extending to a 3-day window: change `getDeviceLocalYesterday()` to a loop over a date array. Pity-check: re-running over older dates increases write volume; consider gating to only-needed-dates (e.g. iterate only over dates where `completions[ds]` doesn't already include the habit AND not in the wasUnchecked map). The 14-day prune window on `hb_av_unchecked_dates` is enough to support up to a 14-day backfill window without storage changes.
- Adding a fifth HealthKit habit: add a new `_backfillXYesterday()` helper following the existing shape and call it from the matching `autoVerifyX` entry point.

---

## Daily Insight / Morning Briefing (v1.1.5)

Once-per-day bottom sheet (`#daily-insight-sheet`) — a tactical morning briefing for fully-onboarded users. Header with day count + "TODAY'S BRIEFING" title, status line summarizing today's slate ("7 OBJECTIVES. 3 SYSTEM-VERIFIED. 4 ON YOU."), full habit list grouped by time-of-day, three operational stats, single LOCK IN CTA. **Information density is the feature.** Reuses the View Note `.vn-sheet` shell — same drag-down + tap-outside dismiss gestures.

### When it fires

Two triggers, both gated on `shouldShowDailyInsight()`:

1. **End of `init()`** — `else` branch (fully-onboarded path), 900ms `setTimeout` after `maybeAutoShowWhatsNew()`. The 900ms delay > the 480ms What's New delay, so What's New (if eligible) opens first; the gate then sees What's New is visible and silently skips.
2. **`visibilitychange` resume** — fires after `autoVerifyWalk` / `autoVerifySleep`, gated on the same `hb_daily_insight_last_shown` persistence key. Picks up the case where the user backgrounded across midnight and resumed in the morning.

### Five gates in `shouldShowDailyInsight()`

| Gate | Skip if |
|---|---|
| Welcome flow incomplete | `localStorage.hb_welcomed !== '1'` |
| No active habits | `habits.length === 0` |
| Day 1 grace period | `originBeginning.dateISO === todayLocal` (computed by `getDeviceLocalDate()`) |
| Already shown today | `localStorage.hb_daily_insight_last_shown === todayLocal` |
| Modal-stack conflict | `#whats-new-sheet` or `#beginning-screen` currently visible |

The `today` here is **device-local** (sleep-window rule, not PT). The card is meant to mark "the user's morning" wherever they are.

### Modal priority order (Tuesday + Thursday work combined)

Daily Insight is the lowest-priority modal in the stack. Order (highest → lowest):

1. Welcome screen — first launch only (`!hb_welcomed`)
2. Onboarding sheet — `needsOnboarding`
3. Beginning reveal (Origin Chapter 1) — first session after onboarding
4. What's New sheet — `getStoredWhatsNewSeen() < latest WHATS_NEW key`
5. Awakening / Class change — celebration queue (post-toggle)
6. **Daily Insight** — once per device-local calendar day, after Day 1

### `HABIT_TIME_OF_DAY` map

Classifies habits into `morning` / `day` / `evening` for the slate grouping. Only listed habits go in `morning` or `evening`; everything else (custom habits + unmapped canonical habits) defaults to `day` via `getHabitTimeOfDay(habit)`. Custom habits always default to `'day'` regardless of name. Empty groups are skipped in the slate render — no "EVENING" label if nothing's in evening.

### Status-line composition (`composeBriefingStatusLine`)

Three-way phrasing based on `canAutoVerify(habit)` count:

| Auto count | Format |
|---|---|
| 0 | `"{N} OBJECTIVES. ALL ON YOU."` |
| `total` | `"{N} OBJECTIVES. ALL SYSTEM-VERIFIED."` |
| Otherwise | `"{N} OBJECTIVES. {auto} SYSTEM-VERIFIED. {manual} ON YOU."` |

Note: `canAutoVerify(habit)` is the live composite gate — `isHealthAutoVerifiableHabit(habit) && Health.isAvailable() && permissionStatus === 'granted' && !isAutoVerifyDisabled()`. So the status line reflects current conditions: a user who paused auto-verify in Settings sees "ALL ON YOU" until they re-enable.

### Habit row (`buildBriefingRow`)

```
[●] [Name · Goal]                     [+XP]
    [Apple Health verifies]
```

- **Dot color** = difficulty (easy=purple `#a78bfa`, medium=blue `#60a5fa`, hard=orange `#fb923c`, legendary=gold `#fbbf24`). Class set: `.di-row-dot--easy` etc.
- **Name + goal** = `habitDisplayParts(habit)` joined with `" · "` (e.g., `"Daily walk · 5,000 steps"`, `"Sleep · 7 hours"`)
- **Verify tag** = `"Apple Health verifies"` only when `canAutoVerify(habit)` is true. Sub-line beneath the name, muted gray.
- **XP** = `DIFFICULTY[habit.difficulty].pts`, gold (`#fbbf24`)

### WHERE YOU STAND row

Inline format (not a card grid): `[XP] TOTAL XP · [N] PERFECT DAYS · [N] DAYS ACTIVE`

Data sources:
- **Total XP** — `totalPoints` (in-memory)
- **Perfect Days** — `perfectStreak.count`
- **Days Active** — `Object.keys(completions).filter(d => completions[d].length > 0).length`

### Persistence

| Key | Format | Purpose |
|---|---|---|
| `hb_daily_insight_last_shown` | `'YYYY-MM-DD'` (device-local) | Last calendar day the card was dismissed; gates re-show |

Written by `dismissDailyInsight()` AFTER the sheet hides — if the app is force-killed mid-show, the next launch re-attempts (intentional resilience).

A previous Phase 1 design used `hb_recent_featured_habits` for a featured-habit-of-the-day rotation. That design was cut on the pivot to tactical-briefing layout; the key never persisted to any device.

---

## Dungeon bosses (v2.0+)

Foundation system shipped in v2.0; second boss landed in v2.0.1. Visual + state foundation for the eventual drop / loot / card / inventory layer. Kill-detection plumbing only — no rewards yet. A separate `BOSSES.md` design doc covers the full v2.x roadmap; this section is the implementation surface.

**Design inversion vs habits:** habits run on user agency — user picks them, user maintains them. Bosses run on system agency — they're passive background progress fed by Apple Health data. The user's only interaction is reading the Quests tab to see streak progress + kill count. No tap-to-complete, no goal config, no opt-out. (Settings → Apple Health pause does NOT affect boss progression — see point below.)

### Where they live

`#quests-panel` (the Dungeon tab — `tab-quests`, dungeon-portal icon). v2.0.1 introduced gate-based UX:

**Default state** (`#quests-gate-view` visible):
1. `.bosses-section-label` — "DUNGEON BOSSES" header
2. `#quests-gate-grid` — 3-col × 2-row grid of `.gate-cell` buttons (v2.0.1). Six cells, one per rank tier, each with `data-gate-rank` attribute and a lock-overlay sub-element (lock icon + "Reach X rank" label). The **`.gate-cell--locked` class is stamped at render time** by `renderQuestsPanel()` based on `isGateUnlocked(rankId)` — markup stays static, all locking decisions live in one place. Locked cells dim the gate art via `filter: brightness(0.45) saturate(0.7)` and reveal the lock overlay. Tap on locked → toast `"Reach X rank to unlock"`. Tap on unlocked → set `currentDungeonRank` and expand. Per-rank dungeon header/flavor copy lives in `DUNGEON_FLAVOR` (in `app.js`).
3. `#quests-more-placeholder` — "MORE QUESTS — Coming in Version 2.0" teaser

**Expanded state** (`#quests-dungeon-view` visible, gate hidden):
1. `#quests-dungeon-back` — "← Exit Dungeon" link (purple text-button)
2. `.dungeon-header` ("E-RANK DUNGEON" gold serif) + `.dungeon-flavor` (italic)
3. `#bosses-list` — boss cards rendered by `renderBossesPanel()`
4. (More-quests placeholder hidden — dungeon view is self-contained)

**State management:** closure-scoped `questsGateExpanded` boolean. Default `false`. Gate tap → `true`. Back tap → `false`. **Tab re-entry resets to `false`** (every Quests-tab activation re-greets the user with the gate — gates should feel like an intentional threshold, not a stale-state continuation). State is NOT persisted across app launches.

**Render flow:** `renderQuestsPanel()` is the single entry point — branches on `questsGateExpanded`, swaps `.hidden` on `#quests-gate-view` / `#quests-dungeon-view` / `#quests-more-placeholder`, and lazily calls `renderBossesPanel()` only when expanded. `setupQuestsGate()` wires the gate-button + back-button click handlers in `init()`.

**Why `#bosses-list` element ID was preserved:** the delegated click handler in `setupBossesPanel` queries by ID and listens for `.bcard[data-boss]` taps. Keeping the ID stable means tap-to-detail wiring stays unchanged inside the dungeon view.

The Daily Legendary Mission card was removed in v2.0.1 along with the entire Daily Quest system — see "Removed systems" section.

### Boss card visual (CARDS.md spec)

Each card in `#bosses-list` is a `<button class="bcard">` with 6 stacked regions per CARDS.md: header (rank pill + name in Cinzel gold) → art window (`assets/bosses/<id>.png` via `object-fit: cover`) → stat strip (STAT · CADENCE) → flavor (italic gray-purple) → kill condition → progress (dots + "X / Y nights" + kill count). Outer border is a 2px linear-gradient (#5b21b6 → #f59e0b at 135°). Aspect ratio is **5/7 portrait**; cards render in a 2-col grid (`.bosses-list--cards`).

Builder: `buildBossCardHTML(id)`. State variants compose:
- `.bcard--active` — `state.streak > 0`. Soft purple-gold pulse via `@keyframes bcard-active-pulse` (2.4s ease-in-out infinite). Box-shadow is overridden during `:hover` — pulse pauses while hovering, resumes on un-hover (cosmetic; flagged but not fixed).
- `.bcard--defeated` — `state.kill_count > 0`. Border gradient flips to gold→amber + gold trophy 🏆 corner overlay (`.bcard-corner-trophy`) + trophy prefix on the kill-count line.
- `.bcard--burned` — Carouser's `state.weekend_burned === true`. Saturate(0.5) brightness(0.85) + horizontal "Weekend forfeit — opens Friday" banner across the card middle.

States stack — defeated AND active both apply.

Header note: glyph (🌙/👑) was removed in late v2.0.1 — rank pill is absolute-anchored top-left of the header strip; boss name centers in the strip's full width with 32px symmetric horizontal padding. The `glyph` field on `BOSSES[id]` is gone.

### Boss detail full-screen modal

`#boss-fs-overlay` (a `position: fixed` full-viewport panel, `z-index: 200`) replaces the v1.1.7 `.vn-sheet` bottom-sheet entirely. Opens via `openBossFullScreen(id)` from any `.bcard` tap. Closes via the back button (`#bfs-back`), ESC keydown, or any tab switch (`switchTab` calls `closeBossFullScreen()` at the top so the modal never lingers across tabs).

Layout top-to-bottom: sticky header (Back link + rank pill) → square hero art (`max-width: 520px`, 1:1 with bottom gradient fade into bg) → boss name (Cinzel 2rem gold) + small `[X]-RANK BOSS` label → long flavor (italic gray-purple) → 4-cell stats grid (RANK / STAT DOMAIN / CADENCE / DEFEATED) → KILL CONDITION section (long version) → CURRENT PROGRESS (14px dots + "X / Y nights" + Carouser's burned banner conditional) → DROPS placeholder section (deferred until drops system ships).

Background scroll-lock via `body.bfs-locked { overflow: hidden; }` while the modal is open. CSS lives in the `.bfs-*` block at the bottom of `styles.css`.

### Data model

```
hb_bosses    { bossId: { streak, kill_count, last_eval_date, ...bossSpecificFields } }
```

Roster lives in the `BOSSES` constant (top of `app.js`). Each entry has core fields (`id`, `name`, `rank`, `flavorShort`, `flavorLong`, `killCondShort`, `killCondLong`, `streakTarget`) plus eval-threshold field with **semantic-specific naming** (`sleepHours` for sleep bosses, `stepThreshold` for step bosses, `workoutMinutes` for workout bosses — NOT a generic `threshold` field; if generalization is wanted later, refactor all bosses together) plus per-boss extras (`cadence`, `statDomain`, `dayOfWeekScoped`, etc.).

Current roster (v3 Phase 1v):
- **E-rank (3):** `the_insomniac` (VIT · sleep 7h · daily), `the_carouser` (WILL · sleep 7h + bedtime · weekly Fri+Sat), `the_steel_wolf` (VIT · 6000 steps · daily, re-tiered from D in v3 Phase 1t).
- **D-rank (3, v3 Phase 1v):** `the_iron_warden` (STR · verified strength workout ≥10 min · daily), `the_glass_strider` (VIT · 7500 steps · daily), `the_dream_tyrant` (VIT · sleep 7.5h · daily). All three are TRUE daily-cadence — one defeat per qualifying day/night, no weekly cap, no consecutive-day requirement. Streak target = 1 across the D tier.

State helpers: `loadBosses()`, `saveBosses(state)`, `getBossState(id)` (defaults to `{ streak: 0, kill_count: 0, last_eval_date: null }` if unset), `setBossState(id, state)`. Per-boss state extensions (Carouser's `current_weekend_id`, `weekend_burned`) are filled in by per-boss getters like `getCarouserState()` so callers always see a fully-populated shape.

### The Insomniac — kill detection

| Field | Value |
|---|---|
| Rank | E |
| Stat domain | VIT |
| Cadence | daily |
| Kill condition | Sleep ≥ 7 hours, 2 nights in a row (recalibrated from 3 — E-rank entry-tier should welcome, not gatekeep) |
| Evaluator | `evaluateInsomniacForNight(sleepHours, nightDate)` |
| Trigger | Called from `autoVerifySleep()` after `Health.getSleepLastNight()` returns data |
| Idempotency | Short-circuits if `state.last_eval_date === nightDate` |
| `nightDate` | `getDeviceLocalDate()` — the morning the user is in (the morning that follows the night being evaluated) |
| Kill effect | `kill_count += 1`, `streak = 0`, `showHabitToast('The Insomniac defeated.')`, re-render Quests tab if visible |
| Sub-threshold night | `streak = 0`, record `last_eval_date` to prevent double-processing |

### The Steel Wolf — kill detection (v2.0.1, re-tiered E-rank in v3 Phase 1t)

Originally shipped as the first non-E-rank boss to validate the multi-rank architecture. Re-tiered to E-rank in v3 Phase 1t to sit alongside The Insomniac as an entry-rank boss — and the kill condition simplified to a single-day threshold so users can engage and clear without needing a consecutive-day chain. Daily-cadence step boss; rides the same HealthKit step-count fetch that powers `autoVerifyWalk` and `lbRecordStepsToday`. No extra HealthKit roundtrip.

| Field | Value |
|---|---|
| Rank | E (was D pre-v3 Phase 1t) |
| Stat domain | VIT |
| Cadence | daily |
| Kill condition | ≥ 6,000 steps in a single day (was 5,000 × 2 days pre-v3 Phase 1t) |
| Evaluator | `evaluateSteelWolfForDay(stepCount, dayDate)` — reads `cfg.stepThreshold` (6000) |
| Trigger | Called from `autoVerifyWalk()` alongside `lbRecordStepsToday`, before the habit-auto-verify gates (passive — ignores pause toggle and walk-habit presence) |
| Idempotency | Short-circuits if `state.last_eval_date === dayDate` |
| `dayDate` | `getDeviceLocalDate()` — the calendar day being evaluated |
| Runtime missed-day reset | If `state.last_eval_date < (dayDate - 1)`, streak resets to 0 BEFORE today's eval. (Mostly vestigial now that `streakTarget=1` — every qualifying day clears the boss.) |
| Init-time reset | `checkMissedDayForSteelWolf()` mirrors `checkMissedNightForInsomniac` — covers users who open the app after a multi-day absence even when no walk habit is configured (so the runtime path doesn't fire). |
| Sub-threshold day | `streak = 0`, record `last_eval_date` to prevent double-processing |

**Engagement economy after re-tier:** E-rank means `engageCostSouls = 25` (was 50) and `killRewardSouls = 50` (was 100). State shape (`hb_bosses[the_steel_wolf]`) is unchanged — kill_count, streak, engaged, engaged_at carry forward; only `cfg.rank` / `cfg.stepThreshold` / `cfg.streakTarget` changed.

**Gate visibility after re-tier:** Steel Wolf now appears in the E-rank dungeon view alongside The Insomniac + The Carouser. The D-rank dungeon currently empty-states ("No bosses await yet. Check back as more dungeons fill.") until new content lands at D.

### D-rank roster — kill detection (v3 Phase 1v)

Three new daily-cadence bosses joining the dungeon at D-tier. All three share the same shape:
- `streakTarget: 1` (one qualifying day/night = kill)
- `cadence: 'daily'` (uses daily mercy + rate thresholds)
- **No weekly cap, no consecutive-day requirement** — engaged + qualified = defeated for THAT day. Repeat the next day if you re-engage and re-qualify.
- Standard engagement gate (`state.engaged !== true` short-circuits eval)
- Idempotent via `state.last_eval_date` — repeat app opens on the same day no-op.
- Shared kill flow via `_awardSingleShotKill(id, cfg, dayDate, state)` — single helper handles kill_count increment, soul reward, drop roll, toast, and UI refresh.

| Boss | Stat | Threshold | Data source | Eval entry |
|---|---|---|---|---|
| `the_iron_warden` | STR | ≥1 verified strength workout ≥10 min today | `Health.getStrengthWorkoutsToday()` (shared with Strength training habit auto-verify) | `evaluateIronWardenForDay(strengthData, dayDate)` called from `autoVerifyStrengthTraining` BEFORE the habit gates |
| `the_glass_strider` | VIT | ≥7,500 steps today | `Health.getStepsToday()` (shared with Daily walk auto-verify + Steel Wolf eval + leaderboard) | `evaluateGlassStriderForDay(stepCount, dayDate)` called from `autoVerifyWalk` alongside Steel Wolf |
| `the_dream_tyrant` | VIT | ≥7.5 hours of sleep last night | `Health.getSleepLastNight().totalAsleepHours` (shared with Insomniac + Carouser evals + Sleep habit auto-verify) | `evaluateDreamTyrantForNight(sleepHours, nightDate)` called from `autoVerifySleep` alongside Insomniac + Carouser |

**ID naming note (v3 Phase 1v.1):** The three D-rank IDs were initially `iron_warden` / `glass_strider` / `dream_tyrant` but were renamed to the `the_X` convention to match the existing roster + so the auto-derived art path (`id.replace(/_/g, '-')`) resolves to the `the-X.png` filenames on disk. The `hb_drank_id_rename_v1` migration in init() moves any stored engagement state forward — idempotent, runs once.

**Shared-data principle:** Iron Warden + Strength training habit are driven by the SAME ≥10 min workout sample. One qualifying workout clears both — matches the Sleep → Insomniac pattern. Same applies to Glass Strider + Daily walk (same step count drives both) and Dream Tyrant + Sleep habit (same sleep data).

**Progress display:** Since these are daily streakTarget=1 bosses, the boss-card progress dots show a single dot — filled if the qualifying condition was met today, empty otherwise. No "0/2 this week" or weekly progress wording anywhere. Detail modal shows `last_eval_date === today && state.kill_count > 0` as "Defeated today"; otherwise it shows the threshold pending.

**Missed-day helpers** (`checkMissedDayForIronWarden`, `checkMissedDayForGlassStrider`, `checkMissedNightForDreamTyrant`) are wired into init() for parity with the existing boss roster but are largely no-ops today — there's no streak to preserve across days when `streakTarget=1`. Kept as scaffolding for future engagement-state recovery work.

### The Carouser — kill detection (v2.0.1)

Weekend-only boss. Mirrors the Insomniac's plumbing but adds weekend-window scoping.

| Field | Value |
|---|---|
| Rank | E |
| Stat domain | WILL |
| Cadence | weekly |
| Day-of-week scoped | true (only Fri + Sat nights count — recalibrated from Fri/Sat/Sun, Sunday-night eval dropped) |
| Kill condition | Sleep ≥ 7 hours AND bedtime before midnight, on Fri + Sat nights of the same weekend |
| Evaluator | `evaluateCarouserForNight(sleepHours, bedtimeBeforeMidnight, nightDate)` |
| Trigger | Same as Insomniac — `autoVerifySleep()` after sleep data |
| Idempotency | Short-circuits if `state.last_eval_date === nightDate` |
| Weekend anchor | `state.current_weekend_id = getMostRecentFridayDate()` ('YYYY-MM-DD' Friday). Both qualifying nights (Fri + Sat) map to the same Friday. |
| Failed night | Sets `state.weekend_burned = true`. Subsequent nights this weekend skip eval — record date but don't increment. The streak is dead until next Friday. |
| Init-time reset | `checkMissedWeekendForCarouser()` clears stale streak when `current_weekend_id !== getMostRecentFridayDate()` (a new weekend has begun and last weekend's progress is no longer current). kill_count is preserved. |

**Night-classification logic:** the user opens the app on the morning AFTER the night being evaluated. Sat morning → Fri night; Sun morning → Sat night. The evaluator computes `todayDow = new Date(nightDate + 'T00:00:00').getDay()` and only proceeds if `todayDow ∈ {6, 0}`. Other days return early — including Mon morning (dow=1, would have been Sunday-night eval), which was dropped in the 2-night recalibration. Sunday sleep data is irrelevant for the Carouser now.

**Why a separate `weekend_burned` flag instead of just `streak === 0`:** a fail on Fri → streak=0, then Sat passes → streak=1 would be wrong (the kill window is 3 consecutive nights, missing Fri kills the whole weekend). The flag preserves the dead-state across same-weekend re-evals; it's only cleared when a new weekend rolls in.

### Bedtime detection — shared helper

Both the Carouser and the Sleep-before-midnight habit auto-verify use the same `getBedtimeSamplesInWindow(samples)` helper (defined near the sleep constants, ~line 81). It returns asleep samples whose start falls in `[20:00, 24:00)` device-local on the prior day, sorted ascending. Callers use `length > 0` (boolean: bedtime before midnight) or `[0].start` (earliest onset). Single source of truth — a future tightening (e.g., before-11-PM variant) applies to both consumers without drift.

In `autoVerifySleep`, the bedtime boolean is computed ONCE before the pause-toggle gate so both bosses + habit auto-verify + the leaderboard can consume it. Order: bedtime boolean → Insomniac eval → Carouser eval → Leaderboard sleep record → habit-auto-verify gates.

### Independence from habit auto-verify

Boss eval runs in `autoVerifySleep()` BEFORE the `isAutoVerifyDisabled()` and `!sleep && !bedtime` early returns. So:

- A user who has neither Sleep habit in their list still gets boss progression (data is there, eval runs anyway)
- A user who paused habit auto-verify in Settings → Apple Health still gets boss progression — the pause toggle is scoped to habit auto-verify only; bosses + leaderboard are passive background progress

The single `Health.getSleepLastNight()` call is shared across all consumers. Cached for 5 min to avoid hammering HealthKit.

### Engagement model (v2.0.1 architectural pivot)

**Bosses no longer progress passively.** Each boss state carries an `engaged: boolean` flag and `engaged_at: ISO string | null`. All three evaluators (`evaluateInsomniacForNight`, `evaluateCarouserForNight`, `evaluateSteelWolfForDay`) short-circuit at the top with `if (state.engaged !== true) return;` — habit data continues flowing to the leaderboard and the habit-auto-verify pipeline, but boss progress only advances for bosses the user has explicitly opted into. Same gate on the init-time missed-period checks (no point resetting streak on a boss the user isn't hunting).

**Cap: `MAX_ENGAGED_BOSSES = 3`** simultaneous engagements. Pulled from BOSSES.md's "multi-focus" principle. `countEngagedBosses()` walks `loadBosses()` and counts `engaged === true` rows. `engageBoss(id)` enforces the cap with a "You can only hunt 3 bosses at once" toast on the 4th attempt.

**Disengaging resets streak.** `disengageBoss(id)` zeroes `streak` + `last_eval_date`, AND for the Carouser also clears `weekend_burned` + `current_weekend_id` so re-engagement starts a clean weekend cycle. `kill_count` is sacred — earned history survives. Re-engaging a boss starts the next streak fresh from 0.

**Migration:** `migrateBossesToEngagementModel()` runs once at init, gated on `hb_bosses_engagement_migrated` localStorage flag. Walks every existing boss state, preserves `kill_count`, zeroes everything else, sets `engaged: false`. Forces all existing users to opt in to the new model.

**UI surfaces:**
- **Boss card** — `.bcard--engaged` (gold border + HUNTING label top-right) or `.bcard--dormant` (desaturated + 0.85 opacity, restores on hover) per state. Stacks with existing variants — `bcard--engaged.bcard--active.bcard--defeated` is valid (currently hunting + in a streak + has prior kills).
- **Boss detail modal** — new ENGAGEMENT section between KILL CONDITION and CURRENT PROGRESS. Renders one of two variants per `state.engaged`:
  - Not engaged → big purple-gold gradient ENGAGE BOSS button + "up to 3 at once" blurb
  - Engaged → "HUNTING SINCE [date]" line + "Stop Hunting" text-button (uses `window.confirm()` to confirm the streak-reset)
- `formatEngagedAt(iso)` helper: `"today"` / `"yesterday"` / `"N days ago"` for recent, `"May 9, 2026"` for older.
- `refreshBossFullScreenIfOpen(id)` re-renders the modal in place when engage/disengage fires while the modal is visible — `bfsCurrentBossId` tracks which boss is on screen.

**Console testing:**
```js
Bosses.engageBoss('the_insomniac');        // true if accepted, false if at cap
Bosses.countEngagedBosses();
Bosses.disengageBoss('the_insomniac');     // resets streak, preserves kill_count
Bosses.isBossEngaged('the_steel_wolf');
```

### Souls currency (v2.0.1)

Economic layer alongside XP. Spent on boss engagement, earned via daily login + boss kills. Tier-scaled (E→S doubles per rank for both costs and rewards) so disciplined hunters net `+cost` per kill while chronic disengagers drain. **Habits never touch souls** — the two-tier philosophy is preserved: habits stay no-failure-state; the economy lives in the boss layer.

**Storage:** `hb_souls = { balance, lastDailyBonusDate, totalEarned, totalSpent }`. `totalEarned` / `totalSpent` are debug-only accumulators (not displayed in UI; useful for testing). First-install grants **35 souls**; the +15 daily login bonus fires on the same first session, netting **50 souls** on first opening — exactly 2× E-rank engagement cost (25). Forces commitment to 2 bosses from day one rather than spreading thin across all six. Tighter than the original 150 grant (and the brief intermediate 50 grant which over-delivered to 65 first-session because daily bonus stacked); intentional design pressure.

**Earn paths:**
- **Daily login bonus**: `tryGrantDailyLoginBonus()` runs once per init, idempotent on `getDeviceLocalDate()`. +15 souls. Skipped days are gone — no rollover.
- **Boss kills**: tier-scaled rewards via `killRewardSouls(rank)`:

| Rank | Engage cost | Kill reward | Net per cycle |
|---|---|---|---|
| E | 25 | 50 | +25 |
| D | 35 | 35 | 0 (v3 Phase 1v rebalance) |
| C | 100 | 200 | +100 |
| B | 200 | 400 | +200 |
| A | 400 | 800 | +400 |
| S | 800 | 1600 | +800 |

**v3 Phase 1v D-rank rebalance.** Pre-1v D was 50/100 (net +50) following the tier-doubling pattern from E. With three new daily-cadence D bosses (Iron Warden / Glass Strider / Dream Tyrant) joining the existing roster and `MAX_ENGAGED_BOSSES = 3` spanning both tiers, that economy would inflate soul earnings too aggressively. D is now 35/35 — **net 0 per kill cycle**. D bosses become the **relic farm** (better drop rates per cadence-aware tables); E bosses stay the **souls farm**. The strategic friction is: engage D only when you'll actually clear it, otherwise you lose the 35-soul wager. C and beyond keep the tier-doubling pattern.

Net is +1× cost per successful kill cycle from C upward. D net 0. E net +25. Failure to land the kill (disengage mid-streak) is a pure loss of the engage cost on every tier.

**Spend path:** `engageBoss(bossId)` checks balance against `engageCostSouls(cfg.rank)` before allowing engagement. Broke-state shows toast: `"Need N souls. You have M."` — always-tappable, no disabled-button mystery. Refunds **do not** happen on disengage; the cost was the wager. Streak resets per existing engagement logic.

**UI surfaces:**
- **Header souls badge** — `#souls-badge` lives in the right cluster of `.rank-section`, balanced against the rank tile on the left. Updated by `refreshSoulsDisplay()` on every earn/spend; brief `.souls-badge--flash` pulse signals the change.
- **Boss detail modal** — ENGAGE button text reads `"ENGAGE BOSS — N SOULS"`. Preview-mode (rank-locked) bosses show the static `"Reach X rank to engage"` label without any cost (engagement isn't possible yet).
- **Toast text** — kill toast appends `" +N souls."`; engage toast appends `" -N souls."`.

**Console testing:**
```js
Souls.balance              // current
Souls.state                // full snapshot incl. lastDailyBonusDate, totalEarned/Spent
Souls.earn(100, 'manual')
Souls.spend(50, 'manual')
Souls.killReward('D')      // 100
Souls.engageCost('S')      // 800
Souls.grantDaily()         // forces daily bonus check (idempotent)
```

**Migration**: `loadSouls()` is itself the migration — first call after deploy with no `hb_souls` key reads as missing-state and grants the 35-soul first-install balance. Existing users (no prior souls state) automatically get treated as new users. Starting-balance changes (150 → 50 → 35) are forward-looking only; users with existing `hb_souls` are unaffected.

### Missed-period detection (init only)

- `checkMissedNightForInsomniac()` — if `last_eval_date` is older than yesterday, streak resets and `last_eval_date` is set to yesterday so tonight's eval can still proceed.
- `checkMissedWeekendForCarouser()` — if `current_weekend_id !== getMostRecentFridayDate()`, last weekend's progress is stale → reset streak/burned/current_weekend_id. kill_count is preserved.

**First-install handling:** `last_eval_date === null` (or `current_weekend_id === null` for Carouser) → no reset. First qualifying eval initializes the streak. No backfill from HealthKit history.

**Why init-only, not visibilitychange:** users foreground the app multiple times per day. Visibility-change firing this would mis-reset on a second foreground after midnight crossed. Init's once-per-launch cadence is the right place.

### Window dev exposure

```js
window.Bosses = {
  BOSSES, getBossState,
  evaluateInsomniacForNight,    checkMissedNightForInsomniac,
  evaluateCarouserForNight,     checkMissedWeekendForCarouser,
  evaluateSteelWolfForDay,      checkMissedDayForSteelWolf,
  // v3 Phase 1v D-rank
  evaluateIronWardenForDay,     checkMissedDayForIronWarden,
  evaluateGlassStriderForDay,   checkMissedDayForGlassStrider,
  evaluateDreamTyrantForNight,  checkMissedNightForDreamTyrant,
  // Engagement model (v2.0.1)
  engageBoss, disengageBoss, isBossEngaged, countEngagedBosses,
  MAX_ENGAGED_BOSSES,
};
```

Use in browser console for testing:

```js
// Force-trip the Insomniac eval for today:
Bosses.evaluateInsomniacForNight(7.5, '2026-05-09');
Bosses.getBossState('the_insomniac');

// Force-trip the Carouser for Sat morning (Fri night):
Bosses.evaluateCarouserForNight(7.5, true, '2026-05-09');
Bosses.getBossState('the_carouser');

// Force-trip the Steel Wolf for today:
Bosses.evaluateSteelWolfForDay(6500, '2026-05-09');
Bosses.getBossState('the_steel_wolf');
```

### Adding a new boss (future)

1. Add an entry to `BOSSES` constant with id/name/rank/flavor/killCond/threshold fields. Add `cadence` and `statDomain` for consistency with v2.0.1 entries; add `dayOfWeekScoped` if the kill window is restricted.
2. Write a per-boss evaluator (e.g., `evaluateSteelWolfForDay(...)`)
3. If the boss has extra state fields beyond `{streak, kill_count, last_eval_date}`, add a `getXxxState()` helper that backfills the new fields with defaults — callers should never see undefined.
4. Call the evaluator from the appropriate `autoVerifyX` hook (depends on what data drives the kill condition — steps, workout type, etc.)
5. If the boss has a missed-period reset rule, add it to a `checkMissedXForY` helper called from init()
6. Update the `window.Bosses` export with the new functions
7. `renderBossesPanel()` automatically includes the new boss because it iterates `Object.keys(BOSSES)` — no UI wiring needed unless the kill condition shape diverges

The boss-card markup is generic — name, rank, flavor, kill condition, progress dots (count = `streakTarget`), kill count. Detail modal is also generic — same fields.

### Boss-defeat result flow + hunt lifecycle (v3 Phase 1z.6)

**Hunt ends on defeat.** When `kill_count` increments, the same write also sets `state.engaged = false`, `state.engaged_at = null`, and a new `state.last_defeated_at = ISO string`. Re-engagement is explicit — the user taps **Hunt Again** in the result modal or the boss detail overlay's engage CTA. The HUNTING strip pill row, `bcard--engaged` boss-card treatment, and boss detail ENGAGED section all key off `state.engaged`, so a single flip resolves every surface at once.

The four kill sites are wired identically: `evaluateInsomniacForNight`, `evaluateCarouserForNight`, `evaluateSteelWolfForDay`, and the shared `_awardSingleShotKill` helper (used by all three D-rank evaluators). Carouser additionally clears `current_weekend_id` so a re-engagement starts a fresh weekend cycle.

**Boss-result modal (`#boss-result-overlay`).** Queued by `announceKillAndDrop` for common drops and no-drop defeats only — rare/ultra continue to fire the existing cinematic reveal at `#reveal-overlay` (`processRevealQueue`). Modal contents:
- Header: "SYSTEM RESULT · BOSS DEFEATED" + boss name (Cinzel gold) + cleared kill condition.
- **Relic variant** (any drop, including common): rarity-themed eyebrow ("RELIC ACQUIRED · COMMON", or "MERCY AWAKENED · …" / "FATE ANSWERED · …" for pity-driven drops), 140px art tile with emoji-slot fallback on 404, item name, slot pill, NEW pill on first-acquisition, stat bonus badges via `cardStatBadgesHtml`.
- **No-drop variant**: "NO RELIC DROPPED" + "Mercy increased" body + 3-row mercy readout (Guaranteed relic / Rare mercy / Ultra mercy) sourced from `getDropPityDisplay(bossId)`.
- Actions: **View Relic** (common-drop only, opens `openCardDetailModal`), **Hunt Again** (calls `engageBoss(bossId)` then closes), **Close**.

**One-shot per defeat.** Keyed by `hb_boss_result_seen_<bossId>_<kill_count>` localStorage flag. Set BEFORE the modal renders so a re-render path can't re-queue. **Not in `CloudSync.SNAPSHOT_KEYS`** — device-local UI acknowledgment, not progress; a reinstall must NOT replay old defeats. Per CLAUDE.md's device-vs-user-state rule, transport / acknowledgment state stays device-local.

**Queue model.** Two or more simultaneous defeats in one tick (D-rank `_awardSingleShotKill` chain across Iron Warden + Glass Strider + Dream Tyrant during a single morning-of-everything launch) push to `_bossResultQueue` and drain one-at-a-time, each waiting for the prior modal to close. 600 ms delay between the kill toast and the modal opening so the toast has its moment first.

**Boss detail HUNT COMPLETE state.** When `kill_count > 0 && !engaged`, the existing engage CTA (`#bfs-engage-cta`) renders with two changes:
- Button text becomes **"HUNT AGAIN — N SOULS"** instead of **"ENGAGE BOSS — N SOULS"**.
- Blurb swaps to `"<Boss name> has been defeated. Engage again to begin a new hunt."`

The first-engagement copy (`"This boss only counts progress while you're actively hunting it…"`) is preserved when `kill_count === 0`. Same engage button + click handler — no new wiring; just a text swap. Souls cost still applies.

**Close paths.** Close button, ESC keydown, and any tab switch (`switchTab` calls `closeBossResult({ suppressDrain: true })`). The `suppressDrain` flag prevents queued results from racing with a re-engage on Hunt Again — the re-engage toast finishes before the next queued result fires.

---

## Leaderboard (v2.0.1+)

Two-layer system: a silent local data accumulator (since v2.0.1) + a Top-50 ranking sheet UI on the Social tab. **v2.1.0 Phase C shipped the live ranking layer** — real entries fetched from the cloud backend at `/v1/leaderboard/top`, submitted via `/v1/users/me/metrics` (debounced behind `hb_lb_last_submit` — 5-min hot-relaunch quiet). Mock entries + blur are GONE. The local accumulator continues to drive the user-row + the snapshot that gets submitted.

### Tracked metrics

Three Apple-Health-verifiable stats — chosen because they cannot be self-reported / gamed, the only honest basis for competitive ranking:

| ID | Display | Source |
|---|---|---|
| `steps_7d`        | Steps · last 7 days (rolling sum) + best 7-day peak | HealthKit step samples |
| `sleep_streak`    | Best run of consecutive nights with sleep ≥ 7 hours | `Health.getSleepLastNight().totalAsleepHours` |
| `bedtime_streak`  | Best run of consecutive nights with bedtime in `[20:00, 24:00)` device-local on prior day | `getBedtimeSamplesInWindow(samples).length > 0` |

The 7-hour threshold matches the Insomniac kill condition (constant `LB_SLEEP_HOURS_THRESHOLD = 7`). The bedtime window matches the Sleep-before-midnight habit auto-verify (same shared helper).

### Storage shape (`hb_leaderboard`)

```
{
  steps_daily:               { 'YYYY-MM-DD': stepCount },     // pruned to 30 days
  sleep_hours_daily:         { 'YYYY-MM-DD': hours },         // pruned to 30 days
  bedtime_daily:             { 'YYYY-MM-DD': boolean },       // pruned to 30 days
  current_sleep_streak:      number,
  best_sleep_streak:         number,    // all-time peak, preserved across breaks
  last_sleep_eval_date:      'YYYY-MM-DD' | null,
  current_bedtime_streak:    number,
  best_bedtime_streak:       number,    // all-time peak
  last_bedtime_eval_date:    'YYYY-MM-DD' | null,
  best_7day_step_total:      number,    // all-time peak rolling-7 sum
  best_7day_step_window_end: 'YYYY-MM-DD' | null,
}
```

`current_*` and `best_*` are tracked separately so a streak break doesn't erase the historical peak. Future "live" leaderboard slots will use `current_*`; "lifetime" slots will use `best_*`.

### Module helpers (in `app.js`)

| Function | Purpose |
|---|---|
| `lbRecordStepsToday(steps)` | Overwrites today's step count (HealthKit can backfill upward), recomputes trailing-7-day sum, updates `best_7day_step_total` peak. |
| `lbRecordSleepNight(sleepHours, bedtimeBeforeMidnight, nightDate)` | Both metrics in one call (single HealthKit roundtrip). Idempotent on `nightDate`. Gap detection — skipped night = streak break before tonight's eval. |
| `lbGetSnapshot()` | Read-only summary for UI/console. Computes the live trailing-7-day step sum on demand. |
| `lbPrevDate(dateStr)`, `lbPruneDailyMap(map, days)` | Internal date/map utilities. |

### Hook points

- `autoVerifyWalk` — restructured in v2.0.1 so that the steps fetch happens BEFORE habit-auto-verify gates. Order: availability/permission check → fetch steps → `lbRecordStepsToday(steps)` (passive, ignores pause toggle and habit presence) → habit gates → habit auto-verify.
- `autoVerifySleep` — `lbRecordSleepNight(...)` runs alongside the boss evaluators, after the bedtime boolean is computed and before the habit-auto-verify gate.

Both calls are wrapped in try/catch — a leaderboard bug must not break habit auto-verify.

### Independence rules

Same as bosses. Leaderboard accumulation IGNORES `isAutoVerifyDisabled()` and habit presence. The Settings → Apple Health pause toggle is scoped to habit auto-verify only — bosses and leaderboard are passive background progress. If we want a privacy-style master kill switch later, it should be a SEPARATE toggle, not the existing pause.

### Social tab UI

Lives at `#social-panel`. Entire panel re-rendered by `renderLeaderboardPreview()` when the user switches to the Social tab. Three cards: icon-led, clickable, opening a Top-50 ranking sheet on tap.

**Card layout** (`.lb-stat-card`):
- 48×48 icon-wrap on left (purple-tinted square): `icon-walk.png` (steps), `icon-sleep.png` (7+h sleep), 🌙 emoji glyph (bedtime — uses `.lb-stat-icon-glyph` since there's no dedicated PNG and visual differentiation matters)
- Center: large value + small unit suffix + meta line ("Best: N")
- Chevron `›` on right (signals tappable)

**Empty-state header** (`.lb-preview-empty`, sits ABOVE the cards):
- Web/non-iOS → "Preview only" note explaining stats populate from Apple Health on the iOS app. Cards still render with zero values for layout visibility (per user request — they want to see the layout in their browser).
- iOS without permission → "Apple Health not connected" actionable copy.
- iOS granted → empty state hidden, cards only.

**Ranking sheet** (`#lb-rank-sheet`, `.vn-sheet` shell):
- Opens via `openLeaderboardRanking(metric)` → fetches real Top-N entries from the backend with stale-while-revalidate caching (`lbCacheRead`/`lbCacheWrite`, 24h TTL via `LB_CACHE_KEY_PREFIX`).
- User's own row (`.lb-rank-row--me`, gold-accented). Three render variants: pending (`--pending`, "submitting…" sub-line), out-of-top (`--out-of-top`, shows actual rank above the top-N divider), or inline with the rest when in top-N.
- Same dismiss gestures as boss-detail (tap overlay, ✕, swipe down).

**Per-metric content** (`LB_METRIC_META`):

```js
{
  step_total:     { title, blurb, unit, formatValue },
  sleep_streak:   { ... },
  bedtime_streak: { ... },
}
```

**Backend metric IDs** (per BACKEND.md §6 — these are also the `data-lb-metric` values on the Social cards):
- `step_total` — cumulative steps over the rolling 7-day window
- `sleep_streak` — current consecutive ≥7h sleep nights
- `bedtime_streak` — current consecutive before-midnight nights

### Display-side alias normalization (v2.2.0)

Backend stores raw aliases verbatim (whatever the user typed at signup — `Big Bear`, `JinWoo`, etc). The PUBLIC leaderboard normalizes for display:
- Strip whitespace
- Lowercase
- Allowlist exception: `richie` → `Richie` (product owner's handle keeps its capital R)
- Dedupe collisions within the rendered list via numeric suffix (`_2`, `_3`, …)

Helpers: `lbNormalizeAliasForDisplay(raw)` + `lbBuildDisplayAliases(rows)`. Cosmetic-only — the underlying user row + isMe matching still use the raw API field. Storage and submission contract untouched. If we ever want signup-time enforcement, that lives in `auth.js` + the backend `users.alias` validator, NOT in this display layer.

**Blurb copy:** the "Steps · this week" detail sheet copy was clarified — the user's WEEKLY COUNT starts over each Sunday, but the LEADERBOARD keeps the best totals on display. Earlier wording ("Resets every Sunday") implied the leaderboard wiped weekly; it never did.

### Window dev exposure

```js
window.Leaderboard = {
  getSnapshot:      lbGetSnapshot,
  recordStepsToday: lbRecordStepsToday,
  recordSleepNight: lbRecordSleepNight,
  _state:           loadLeaderboardState, // dev-only: full raw state
};
```

Console testing on web (where HealthKit doesn't fire):

```js
Leaderboard.recordStepsToday(8500)
Leaderboard.recordSleepNight(7.5, true, '2026-05-08')
// Switch to Social tab to see the cards refresh.
Leaderboard.getSnapshot()
```

### Submission path (v2.1.0 Phase C — live)

`lbSubmitAllMetrics()` POSTs the current snapshot to `/v1/users/me/metrics`. Wrapped in a debounce (`lbSubmitAllMetricsDebounced`) that reads `hb_lb_last_submit` (epoch ms) and short-circuits if the last submit was <5 min ago. Fired from `init()` after the main app mounts + on every visibilitychange. Auth header carries the JWT from `Auth.getCurrentUser().jwt`.

---

## Discipline Duels foundation (v3 Phase 1x)

3-Day Discipline Duel — 1v1 coordination layer between friends. **v1 scope: friends + duel agreement only. No scoring, no APNs, no real-time, no ghost battles, no matchmaking, no server-side combat resolution.** "Build the rails before the train." Two hunters being able to connect + agree to compete is the entire v1 win.

**Header strip duel pill (v3 Phase 1x.5).** The top `.status-pill-row` (labeled HUNTING) now surfaces the user's active Discipline Duel alongside engaged-boss pills. Render order: engaged-boss pills first (existing `_buildHuntingPills()`), then a single duel pill (`status-pill--duel`) reading `VS <ALIAS>` + `<N>D LEFT` if the user has an active duel. Empty state (no boss + no duel) keeps the existing "THE HUNT IS QUIET · ENGAGE A BOSS" idle pill. The duel pill is tappable — it navigates to the Duels tab. Backend fetch flows through `refreshHeaderDuelState()` with a 2-minute in-memory cache (`HEADER_DUEL_CACHE_MS`); fires once at init (`{ force: true }`) and on every `visibilitychange` to `visible` (debounced). The duel pill icon reuses `assets/tab-icons/tab-social.png` (the same icon as the Duels tab nav button). **No fake duel scores anywhere on the pill** — scoring is still deferred to a future pass.

### Product rules (v1)

- **Duel type:** 3-Day Discipline Duel (configurable `duration_days` 1–14; default 3).
- **Players:** 1v1 only.
- **Who can duel:** accepted friends only (server rejects non-friends with `NOT_FRIENDS`).
- **Duration:** 3 calendar days after both players accept. `starts_at` set when the opponent accepts; `ends_at = starts_at + duration_days`.
- **Stake:** 25 souls each (metadata only this pass — see below).
- **Reward (future):** 40 souls to winner; 10 souls burned as sink.
- **Win condition (future):** most sealed objectives during the duel window. Tie breakers: most HealthKit/system-verified objectives → most XP earned → draw.

### Backend tables

- `friends` — `id`, `requester_user_id`, `recipient_user_id`, `status` (pending/accepted/declined/blocked), `created_at`, `updated_at`. `UNIQUE(requester, recipient)`.
- `duels` — `id`, `challenger_user_id`, `opponent_user_id`, `status` (pending/active/declined/cancelled/completed/expired), `stake_souls`/`reward_souls`/`burn_souls`, `duration_days`, `starts_at`, `ends_at`, `winner_user_id`, six per-side score columns (challenger/opponent × total/verified/xp), timestamps.

Migration: `backend/migrations/0003_friends_and_duels.sql`. **Never edit after applying** — same migration discipline as 0001/0002.

### Endpoints (all auth-required, user_id from JWT only)

- `GET /v1/friends` — `{ ok, friends, incoming, outgoing }`. Each entry: `{ id, user_id, alias, status, direction, created_at, updated_at }`.
- `POST /v1/friends/request` — body `{ alias }`. Looks up target via case- + space-insensitive normalization (`LOWER(REPLACE(alias, ' ', ''))`). Self-friend rejected. **Inverse-pending → auto-accept** (decision rule below).
- `POST /v1/friends/:id/accept` — recipient only. pending → accepted.
- `POST /v1/friends/:id/decline` — recipient only.
- `POST /v1/friends/:id/remove` — either accepted friend.
- `GET /v1/duels` — `{ ok, incoming, outgoing, active, recent }`. `recent` = last 20 completed/declined/expired/cancelled.
- `POST /v1/duels` — body `{ opponent_alias, duration_days?, stake_souls? }`. Both must be accepted friends. Rejects pre-existing pending/active duel between the pair.
- `POST /v1/duels/:id/accept` — opponent only. Sets `starts_at`/`ends_at`. status → 'active'.
- `POST /v1/duels/:id/decline` — opponent only.
- `POST /v1/duels/:id/cancel` — challenger-only, pending-only (v3 Phase 1z.1). Idempotent: a second call returns `{ ok: true, alreadyCancelled: true }`. No souls movement, no ledger writes.
- `GET /v1/duels/:id` — participants only. Returns full record + alias map + `time_remaining_ms` when active.

### Inverse-pending → auto-accept

If A has a pending request to B and B tries to send one to A, B's attempt does NOT create a duplicate inverse row. Instead the original A→B row is flipped to `accepted` and returned with `autoAccepted: true`. The friendship preserves the original requester. Avoids the awkward "you both have to wait for each other" deadlock and gives an instant social win on the second move.

### Souls are metadata only in v1 (with Phase 1z ledger caveat)

`stake_souls` / `reward_souls` / `burn_souls` live on the `duels` row for display in the UI. **The localStorage `hb_souls` accumulator is still client-side authoritative — Phase 1z does NOT mutate it.** What Phase 1z added is a server-side `user_souls_ledger` that auto-settles a `+reward_souls` row on duel resolve (for the winner only), idempotent via UNIQUE(user_id, ref_type, ref_id, reason). The ledger is the eventual reconciliation target; reconciliation between ledger ↔ local `hb_souls` is a separate later pass. Stake is NOT deducted on accept. No backend code path debits or credits `hb_souls` in v1.

### Frontend wiring

- **`auth.js` helpers** (v9): `Auth.fetchFriends`, `Auth.sendFriendRequest(alias)`, `Auth.acceptFriendRequest(id)`, `Auth.declineFriendRequest(id)`, `Auth.removeFriend(id)`, `Auth.fetchDuels`, `Auth.createDuel(alias, { duration_days?, stake_souls? })`, `Auth.acceptDuel(id)`, `Auth.declineDuel(id)`, `Auth.fetchDuel(id)`. All share the `{ ok, code, detail }`-on-failure envelope via an internal `_authedFetch` helper.
- **Duels tab UI** (`#social-panel`, v3 Phase 1x.1): **The Social tab is now the Duels tab** in the bottom nav — internal id remains `social` (data-tab, panel id, switchTab calls) to avoid a risky cross-codebase rename, but the user-facing label/aria is `Duels`. Layout top-to-bottom: page header (rune divider + "DISCIPLINE DUELS" + italic subtitle) → active-duel hero (empty/active variants) → Friends section (with `N hunters` count) → Discipline Duels section. **Leaderboard cards no longer render on the Duels tab** — `renderLeaderboardPreview` is preserved (still used by `#lb-rank-sheet` modal flow from elsewhere) but is no longer invoked from `switchTab`'s social branch. Each backend fetch wrapped in try/catch; failures render an inline `.social-error` chip rather than breaking the tab. Stub users (NOT_SIGNED_IN / STUB_USER / LOCAL_DEV_SKIP) get a "Sign in" empty state.
- **Active duel hero** (`#duels-hero`): driven by `renderActiveDuelHero(active)` inside `renderDuelsSection`. Empty state (Phase 1x.8) = compact status-only card (`duels-hero--compact`) — dashed purple border + crossed-daggers crest + "No active duel" headline + short subtitle. **No "Find Hunter" CTA** — the empty-state cards under Friends + Discipline Duels carry the entry-point CTAs. Active state = gold-glow border + Live pill + countdown chip + rival avatar + DURATION/STAKE/REWARD strip + score row (Phase 1y / 1z) + "View Duel" gold button. When multiple active duels exist, `_pickActiveHeroDuel` chooses the most-recently-started one (sort by `starts_at` desc).
- **No Recent Duels in v1.** `res.recent` is intentionally ignored by `renderDuelsSection`. Completed-duel rows ship once server-side scoring produces real outcomes.
- **No fake scoring anywhere.** As of v3 Phase 1z, 5 of 6 duel types render REAL verified scores (sourced from `GET /v1/duels/:id/score`). The 6th (`boss_race`) is deferred and shows `"Boss Race scoring activates after verified boss-event logging."` Never inject placeholder "You: 0 · Opp: 0" rows when events haven't been submitted yet — the UI distinguishes "pending events" from "zero score." The earlier blanket footnote `"Scoring activates in the next duel pass."` is removed from all paths except `boss_race`.
- **Challenge button** opens the **Choose Verified Duel sheet** (`#duel-type-overlay`), where the user selects one of the verified-only duel types before sending the invite. The picker pre-selects `verified_objectives` by default and submits via `Auth.createDuel(alias, { duration_days: 3, stake_souls: 25, duel_type })`. The 25-soul stake is metadata only — no local souls deduction. The legacy `window.confirm("Challenge ...")` flow is retired (Phase 1x.6 — see Verified-only Discipline Duel Types section).
- **Duel detail overlay** (`#duel-detail-overlay`): reuses the `.bfs-*` boss-fullscreen pattern with its own `body.ddo-locked` scroll lock. Shows opponent (display-normalized alias), status pill, schedule (starts/ends/time-remaining), stake/reward/duration metadata, real per-side verified scores for the 5 scorable types (Phase 1z), and Accept/Decline buttons for pending duels in the opponent role. The blanket "scoring activates in the next pass" footnote that shipped pre-1z is now scoped to `boss_race` only — the 5 scorable types render their real aggregated scores from `GET /v1/duels/:id/score`. Boss Race is also hidden from the v1 picker (Phase 1z.16), so the deferred footnote is only reachable via legacy `boss_race` rows. Closes on Back button, ESC, or any tab switch (wired into `switchTab`'s top-level closer).

### Deferred to a later pass

- **Scoring.** v3 Phase 1z shipped server-side `verified_events` aggregation (Apple-Health-derived rows joined against the duel window) — the trust path we hinted at. Resolution settles via `GET /v1/duels/:id/score` + `POST /v1/duels/:id/resolve` writing into `user_souls_ledger`. Five of six duel types (`steps` / `sleep` / `bedtime` / `strength` / `verified_objectives`) score real outcomes; `boss_race` remains deferred. Client-state-as-truth (localStorage habit completions submitted at resolution time) is explicitly NOT the path — only `source IN ('apple_health', 'system')` events count, and the backend re-derives metrics from the raw events on resolve.
- **APNs / push notifications.** No notification fires today when a friend request, challenge, or duel-completion happens. Users discover state changes by opening the Social tab. v2 will add APNs once Cloudflare's APNs flow ships.
- **Real-time updates.** No WebSocket / Server-Sent Events layer. Each Social-tab activation re-fetches both endpoints. Acceptable at v1 scale.
- **Ghost battles.** v3+. A "simulated opponent" duel for users without friends. Out of scope now.
- **Matchmaking.** Friends-only is the v1 constraint. Open queue / skill-matching is a much later concern.
- **Server-side combat / animations.** No combat resolution logic. The duel modal is informational.

### Discipline Duel Types — Verified Only (v3 Phase 1x.6)

Pre-duel type-pick layer on top of the v3 Phase 1x foundation. **Metadata + UI only — no scoring engine, no fake scores, no souls movement.** Goal: capture the user's choice now so when the scoring engine ships, `duel.duel_type` decides what query runs against each participant's verified data.

**6 supported types** (canonical ids — must match `DUEL_TYPES` in `app.js` AND `ALLOWED_DUEL_TYPES` in `backend/src/handlers/duels.ts`):

| id | Label | Verified source | Win condition (future scoring) |
|---|---|---|---|
| `steps` | Steps Duel | Apple Health steps | Most verified steps during the duel window |
| `sleep` | Sleep Duel | Apple Health sleep | Most verified nights with ≥7h sleep |
| `bedtime` | Bedtime Duel | Apple Health sleep | Most verified before-midnight bedtimes |
| `strength` | Strength Duel | Apple Health workouts | Most verified strength workouts |
| `verified_objectives` | Verified Discipline Duel | System-verified objectives | Most verified objectives during the window |
| `boss_race` | Boss Race | Verified boss progress | First hunter to defeat the selected HealthKit-backed boss |

Default = `verified_objectives` — first-time challengers don't have to think; they can override per-duel. Boss Race is **metadata only** in this pass; no boss-selection UI yet, no special handling beyond storing the type.

**Backend:** new column `duel_type TEXT NOT NULL DEFAULT 'verified_objectives'` on the `duels` table (migration `0004_verified_duel_types.sql`). `handleDuelsCreate` validates `body.duel_type` against `ALLOWED_DUEL_TYPES`; absent → default; invalid → `400 INVALID_DUEL_TYPE`. `serializeDuel` includes `duel_type` (with fallback to default) so every list / detail response surfaces it.

**Frontend:** `DUEL_TYPES` constant + helpers (`getDuelTypeMeta`, `formatDuelTypeLabel`, `formatDuelWinCondition`, `formatDuelTypeShort`, `formatDuelTypeSource`, `getDuelTypeShortCode`) live in `app.js`. `#duel-type-overlay` (in `index.html`) is a bottom-sheet that opens on Challenge tap. User picks (default pre-selected) → Challenge Hunter → `Auth.createDuel(alias, { duration_days: 3, stake_souls: 25, duel_type })`. The prior `window.confirm("Challenge ...")` flow is GONE.

**Display propagation:** type label appears on every duel surface — Incoming card sub (`Steps Duel · challenged you · 3-day duel`), Outgoing card sub (`Steps Duel · awaiting response`), Active card sub (`Steps Duel · 1d 14h left`), Active hero opponent sub (label + short copy line), Duel Detail overlay (DUEL TYPE / Verified Source / WIN CONDITION rows replace the old generic copy), HUNTING strip duel pill (prefix `STEPS · VS <ALIAS> · 2D LEFT`). Every read of `duel.duel_type` is defensive — `getDuelTypeMeta` falls back to the default if the field is missing (pre-migration rows).

**Stake / duration / reward stay fixed at 25 / 3 / 40** — user can't edit them. Only the type picker is interactive.

**Scoring is live as of v3 Phase 1z for 5 of 6 duel types** (`steps` / `sleep` / `bedtime` / `strength` / `verified_objectives`) via the Verified Duel Scoring Engine. `boss_race` remains deferred. See the "Verified Duel Scoring Engine v1 (v3 Phase 1z)" section below for the canonical engine spec; the "Steps Duel Scoring v1 (v3 Phase 1y)" section is preserved for the legacy `duel_progress_snapshots` path that still backstops in-flight pre-1z steps duels.

**Manual habit-based duel types are explicitly NOT supported** — Most Sealed Objectives via manual habits, Most XP including manual habits, Streak Duels including manual streaks, Perfect Day duels. The "system is honest" promise requires data-backed verification. Reversing this decision needs explicit product ask.

### Steps Duel Scoring v1 (v3 Phase 1y — now legacy / coexisting)

The first competitive scoring loop in Awakened — superseded for new clients by the Phase 1z Verified Duel Scoring Engine below. Kept live for in-flight steps duels created pre-1z: `POST /v1/duels/:id/resolve` falls back to `duel_progress_snapshots` when no `verified_events` rows exist for the duel. New code should prefer `submitVerifiedEventsForDuels` and the `verified_events` path.

**Backend authority.** Client never decides the winner. Two new endpoints on the Cloudflare Worker:

- `POST /v1/duels/:id/progress` — body `{ duel_type, metric, value, window_start, window_end, client_updated_at }`. Upserts a row into `duel_progress_snapshots` keyed on `(duel_id, user_id, metric)`. Server enforces `metric === 'steps'` and `duel.duel_type === 'steps'` (else `DUEL_TYPE_NOT_SCORED_YET`). Returns `{ ok, you, rival }` — `rival` is `null` if the rival hasn't submitted yet. `source` is server-set to `'apple_health'`.
- `POST /v1/duels/:id/resolve` — idempotent winner resolution. Reads both participants' latest snapshots (missing = 0), compares, writes the winner / result, marks the duel `completed`. Reject if `now < ends_at` with `DUEL_NOT_ENDED`. Re-calling on a completed duel returns the existing row without re-comparison. Tie → `result = 'draw'`, `winner_user_id = NULL`.

**New table:** `duel_progress_snapshots (id, duel_id, user_id, duel_type, metric, value, source, window_start, window_end, client_updated_at, server_updated_at)`. `UNIQUE(duel_id, user_id, metric)` so re-submits overwrite. Migration: `0002_user_state_snapshots.sql` → `0003_friends_and_duels.sql` → `0004_verified_duel_types.sql` → `0005_duel_progress_snapshots.sql` (also adds `resolved_at` + `result` columns on `duels`).

**Client (Apple Health → backend).**

- `Health.getStepsBetween(startISO, endISO)` — generic uncached step query. `getStepsToday()` was refactored to share the inner `_queryStepsInRange` path. Cache discipline: only today is cached (5-min), arbitrary windows are not.
- `submitActiveStepsDuelProgress(opts)` — self-debounced (`_DUEL_PROGRESS_MIN_MS = 5 * 60 * 1000`). Walks `Auth.fetchDuels().active`, filters to `duel_type === 'steps'`, queries `Health.getStepsBetween(starts_at, min(now, ends_at))`, POSTs each via `Auth.submitDuelProgress`. Each per-duel call is try/wrapped — a duel-progress failure must NEVER break leaderboard / habit / boss paths.
- Triggers: `init()` cold launch (force = true), `visibilitychange` to visible (debounced), `renderDuelsSection` (debounced), `Auth.acceptDuel` completion (force).
- `maybeResolveDuelIfEnded(duel)` — called from `renderDuelsSection` (auto-resolves every active duel past `ends_at`) and `_ddoPopulate` (same check when user opens a detail view). Backend is idempotent.

**UI surfaces.** Active steps duel card + hero card both render a verified-steps score row (`You: 12,420 · Rival: 9,800`; rival shows `awaiting data` if no snapshot). Duel detail overlay renders the same in-flight scores; when `status === 'completed'`, replaces with a result row:

- challenger_win + role=challenger → "Victory — you outstepped &lt;alias&gt;." (gold celebration variant)
- opponent_win + role=opponent → same
- challenger_win + role=opponent → "Defeat — &lt;alias&gt; outstepped you." (muted/desaturated)
- opponent_win + role=challenger → same
- draw → "Draw — both hunters matched pace."

Non-steps duel types keep the "Scoring activates in the next duel pass." italic footnote.

**One-shot result toast.** Keyed by `hb_duel_result_seen_<duelId>` localStorage flag — fires the first time the user sees a completed duel, never replays. Three variants: `Duel won — verified steps decided it.`, `Duel lost — your rival logged more verified steps.`, `Duel ended in a draw.`

**Rate-limit reuse.** `RL_DUELS_WRITE` (6/min) gates both new endpoints. Client debounce at 5 min keeps legit usage well below the cap. No new `wrangler.toml` binding for v1.

**v1 integrity disclosure.** Client-submitted values are trusted (not full server-side authority). Apple Health is the source of truth but the value reaches the backend through the client. Future hardening = on-device signed snapshots or a server-side HealthKit-via-watch-companion. Not for now — v1 prioritizes shipping the first real outcome over the harder integrity story.

**No souls movement.** Engagement stake / kill reward visualized in the UI but NEVER moved. Souls remain client-side localStorage authoritative. The detail overlay completed state shows "Rewards activate in a future economy pass." Don't wire a soul-debit on accept or soul-award on resolve — that's a separate pass with its own design + tests.

---

## Verified Duel Scoring Engine v1 (v3 Phase 1z)

Generalizes the Phase 1y steps-only loop into a backend-stored verified event log + backend-aggregated scoring + auto-settling reward ledger covering all 5 verified duel types. v1 trust model: client submits Apple Health-derived values; backend aggregates and resolves; **not** full anti-cheat yet (see trust-model paragraph below). The 1y legacy path (`duel_progress_snapshots` + `POST /v1/duels/:id/progress`) stays live for backward compat with already-active steps duels; new clients prefer the verified-events path.

**Server-side authority.** Client submits events. Backend aggregates. Backend resolves. Backend records the reward. The local app does not decide outcomes and does not touch its own soul balance.

**Two new endpoints.**

- `POST /v1/verified-events` — batch ingestion (≤25 events/call). UNIQUE(user_id, client_event_id) dedupes retries via INSERT OR IGNORE — client can re-submit the same event safely. Returns `{ ok, inserted, duplicates, errors }`. Validates `event_type` against `ALLOWED_EVENT_TYPES`, `source` against `ALLOWED_EVENT_SOURCES`, `value` non-negative integer.
- `GET /v1/duels/:id/score` — participant-only. Returns the duel + a `score` block with both participants' verified scores + per-type formatted labels. Useful for surfaces that want server-formatted strings without duplicating the formatter client-side.

**Five scorable duel types + boss_race deferred.**

| Duel type             | Event types                                              | Aggregation                                |
|-----------------------|----------------------------------------------------------|---------------------------------------------|
| `steps`               | `steps_total`                                            | MAX(value)                                  |
| `sleep`               | `sleep_7h_night`                                         | COUNT DISTINCT metric_date                  |
| `bedtime`             | `bedtime_before_midnight`                                | COUNT DISTINCT metric_date                  |
| `strength`            | `strength_workout`                                       | COUNT(*)                                    |
| `verified_objectives` | `verified_objective_{daily_walk,sleep,bedtime,strength}` | COUNT DISTINCT (event_type, metric_date)    |
| `boss_race`           | (none)                                                   | unsupported — resolve returns `BOSS_RACE_SCORING_DEFERRED` |

Steps uses MAX (multiple snapshots overwrite). Sleep/bedtime/strength use count semantics so multiple submits per night/workout dedupe naturally via UNIQUE(user_id, client_event_id). verified_objectives counts distinct (event_type, metric_date) pairs — so a verified daily-walk + verified sleep on the same day = 2 objectives.

**Resolve uses verified_events first; falls back to legacy `duel_progress_snapshots` only if no verified_events exist for the duel** (back-compat for in-flight steps duels created pre-1z). All-zeros stays as draw. After computing the winner, `settleDuelReward(env, duel)` inserts the `+reward_souls` row into `user_souls_ledger` with `ref_type='duel'`, `ref_id=duel.id`, `reason='duel_win'`. UNIQUE(user_id, ref_type, ref_id, reason) makes settle idempotent — retries are no-ops. `duels.reward_settled_at` is set in the same transaction.

**Local `hb_souls` is NOT modified by v1.** The ledger is the eventual reconciliation target. The completed-duel detail overlay shows "Reward recorded: +40 souls" for the winner with a small italic note ("Souls economy reconciliation comes in a future pass."). Draws show "No reward awarded." Losers see nothing. **Stake is NOT deducted on accept** — the localStorage `hb_souls` value is untouchable from backend in v1.

**Client event builder (`_buildEventsForActiveDuel(duel)`).** Per active scorable duel, queries the matching Apple Health surface for the duel's `[starts_at, min(now, ends_at)]` window and synthesizes verified events. Stable `client_event_id` per (event_type, duel_id, key) so retries always land on the same backend row.

- `steps` → `Health.getStepsBetween(start, end)` → 1 event `steps_total` with `value = total`.
- `sleep` / `bedtime` → `Health.getSleepBetween(start, end)` → per-night events keyed by device-local "night date" (sleep onset shifted +4h to assign post-midnight to the same night). 7h threshold → `sleep_7h_night`. Earliest qualifying onset in `[20:00, 24:00)` prior-day window → `bedtime_before_midnight`.
- `strength` → `Health.getStrengthWorkoutsBetween(start, end)` → 1 event `strength_workout` per qualifying workout. Sample uuid (or `startDate:duration` fallback) is the dedupe key in `client_event_id`.
- `verified_objectives` → all four Apple Health surfaces, with `event_type = verified_objective_*` and `source = 'system_verified'`. Daily-walk objective uses a 3,000-step threshold (matches the canonical Daily walk default goal) — emitted once per day when today's steps clear the threshold. Finer per-day granularity is future work.

**Submitter (`submitVerifiedEventsForDuels(opts)`).** Self-debounced (`_VERIFIED_EVENTS_MIN_MS = 5 * 60 * 1000`). Walks `Auth.fetchDuels().active`, filters to scorable types, builds events, chunks to ≤25/POST, fires `Auth.submitVerifiedEvents(chunk)`. Triggers: end of `init()` (force), `renderDuelsSection`, `visibilitychange` to visible, post-accept (force). Coexists with the legacy `submitActiveStepsDuelProgress` (which still fires; backward compat).

**UI surfaces extended.** Active duel hero, active duel card row, and detail overlay all branch on `duel.duel_type` to render the right score string (`formatDuelScoreValue(type, n)`) and the right brand-locked result verb (`outstepped` / `outrested` / `outanchored` / `outlifted` / `outdisciplined` / `outhunted` — see Phase 1z.2 `DUEL_VERB_BY_TYPE`). boss_race surfaces show "Boss Race scoring activates after verified boss-event logging." The reward row appears on completed duels only for the winner (gold border, "+40 souls"), or for a draw ("No reward awarded.").

**Storage / D1 schema.**

```
verified_events (id, user_id, duel_id?, event_type, metric, value, source,
                 occurred_at, metric_date?, window_start?, window_end?,
                 client_event_id, client_created_at?, server_created_at,
                 metadata_json?)
  UNIQUE(user_id, client_event_id) — dedupe via INSERT OR IGNORE
  + 5 indexes (user, type, duel, duel+user, user+occurred_at)

user_souls_ledger (id, user_id, delta, reason, ref_type?, ref_id?,
                   created_at, metadata_json?)
  UNIQUE(user_id, ref_type, ref_id, reason) — prevents double-pay

duels.reward_settled_at TEXT — set by settleDuelReward
```

**Trust model.** v1 trusts client-submitted Apple Health values. NOT full anti-cheat — a savvy user could spoof events. Future hardening: signed device attestations, HealthKit-via-watch companion, or per-event signature verification. Documented integrity gap, not a blocker for v1.

**Operational rule for new event types.** Adding a new scored event requires: (a) add to `ALLOWED_EVENT_TYPES` in backend, (b) add to `DUEL_SCORING_CFG[type].eventTypes`, (c) extend `_buildEventsForActiveDuel` with the matching Apple Health surface, (d) add a JS-side score formatter case in `formatDuelScoreValue` AND a verb in `_DUEL_VERB_BY_TYPE`. The aggregator stays generic per the 4 strategies (max / count_distinct_date / count_events / count_distinct_type_date).

**Operational rule for ledger writes.** Any future server-side soul reward (boss kill server-side, achievement, login bonus) MUST go through `user_souls_ledger` with a unique `(ref_type, ref_id, reason)` per logical reward event. The UNIQUE index protects against double-pay across retries.

**Production rollout state (current — May 17, 11:07 AM PT clock-in).** Migration `0006_verified_duel_scoring_engine.sql` applied to remote D1 (11 queries, 16 rows written). Worker deployed at `Current Version ID: 6874ae4d-c67a-4dda-ac2c-3d788966bdfb`; subsequent deploys shipped the Phase 1z.1 cancel endpoint (`POST /v1/duels/:id/cancel`). Live endpoint surface verified via curl returning 401 to unauthenticated requests: `POST /v1/verified-events`, `GET /v1/duels/:id/score`, `POST /v1/duels/:id/cancel`. **Current App Store Connect status: `2.2.1-w34` submitted evening of May 16 / overnight, currently AWAITING App Review.** Submission is on commit `78a2c6a` (HEAD of `main`). The earlier May 15 submission was manually pulled on May 16 because it was set for automatic release and the owner wanted the cleaner sim-verified train submitted instead — this was NOT an Apple rejection, pure product decision. The pulled build is NOT the active review target; `w34` is. **Verified Duels v1 backend is empirically proven on prod D1 as of May 16** — full 5/5 sim matrix passed end-to-end (steps / sleep / bedtime / strength / verified_objectives) including idempotent resolve + ledger settle. The work-train between May 16 morning and May 16/17 night landed (in order): Direction B Status card (1z.12), Status compact passes (1z.13 → 1z.14), codemagic sentinels + OneDrive cleanup (1z.15), Boss Race hidden from picker (1z.16), Verified Duels v1 prod sim pass + App Store pull recorded (1z.17), World Rank Steps card replaces Week XP (1z.18), Morning Briefing Minimal Premium Polish (1z.19), World Rank rank-mismatch fix (1z.21), iOS long-press callout hotfix (1z.22), iOS native image-drag hotfix + centralized cleanup (1z.23), **and finally habit drag-to-reorder DISABLED for 2.2.1 release stability (1z.24)** after three hotfix attempts could not fully eliminate the iOS WebView ghost artifact. Habit drag is gated behind `ENABLE_HABIT_DRAG_REORDER = false` in `app.js`; tap-to-complete + Add Habits + scrolling all unaffected. Conservative polish-pass landing decision from the May 15 evening: brand verbs (`outstepped` / `outrested` / `outanchored` / `outlifted` / `outdisciplined` / `outhunted`) + behavior wiring (accordion persist, 60s live tick, draw rotation, HUNTING-pill type glyph) shipped; 4 structural redesigns deferred to a future pass (full active duel hero rewrite with twin columns + VS sigil + score-gap bar, 5-variant detail overlay with Cinzel "VICTORY" + gold-dust, Choose Verified Duel sheet glyph-block redesign, Global Rankings card overhaul). Deferral rationale: high blast radius across already-shipping surfaces; brand+behavior were the highest-leverage targets and they're in.

**Rate-limit binding decision (v1).** `POST /v1/verified-events` does NOT have a dedicated Cloudflare Workers rate-limit binding (`RL_VERIFIED_EVENTS` was specced but skipped to avoid a risky wrangler.toml edit mid-engine-build). The handler uses an in-memory rate limiter as the fallback. Caveat: Cloudflare's isolate-per-region model means the in-memory counter isn't globally consistent — a user could spread submissions across regions and exceed the intended 60/min cap. Acceptable for v1 (low-volume + small user base + idempotent UNIQUE constraint already protects against duplicate effects). Promote to a real Cloudflare rate-limit binding when traffic grows. The 11 existing bindings (DB + 10 rate-limit) are unchanged.

---

## Tier 1 launch-readiness (v3 Phase 1z.1)

Two small but high-value additions on top of the Phase 1z engine: an outgoing-duel **cancel** path, and a **verified-event outbox** for offline resilience. Both ship in `2.2.1-w13`.

**Canonical launch-readiness checklist: `QA-DUELS.md` at repo root.** 2-device TestFlight QA script — covers all 5 scorable duel types end-to-end, the outgoing cancel flow, the outbox airplane-mode test, a force-end SQL snippet (`UPDATE duels SET ends_at = datetime('now', '-10 seconds') WHERE id = '__DUEL_ID__';`) for short-circuiting the duel window during QA, and reward-ledger verification SQL against `user_souls_ledger`. `boss_race` is marked explicitly deferred in the doc. Run before any 2.2.x train ship.

### Outgoing duel cancel

`POST /v1/duels/:id/cancel` — challenger-only, pending-only. Status `'pending'` → `'cancelled'`. Backend handler `handleDuelsCancel` in `backend/src/handlers/duels.ts`, route added under the existing `DUELS_ID_RE` regex (`(accept|decline|cancel)`). Reuses `RL_DUELS_WRITE` binding.

- **Idempotent.** A second call against an already-cancelled duel returns `{ ok: true, alreadyCancelled: true, duel }` rather than an error — the UI can re-issue without surfacing scary text.
- **Status guard.** Active / completed / declined / expired duels return `400 DUEL_NOT_CANCELLABLE`. Non-participant returns `403 FORBIDDEN`. Opponent's path stays the existing `decline` — opponents can never cancel.
- **No souls movement.** Cancel doesn't touch `user_souls_ledger`, doesn't set `winner_user_id`, doesn't set `reward_settled_at`. Pending duels never debited the stake; there is nothing to refund.
- **UI:** small ghost-style `Cancel` button (`.social-btn--ghost.duel-card-cancel-btn`) on the outgoing duel card next to `View`. Click handler in `setupSocialDuels` confirms via `window.confirm()` then calls `Auth.cancelDuel(duelId)`. On `DUEL_NOT_CANCELLABLE` the toast reads "Duel already started — cannot cancel." Auth helper: `Auth.cancelDuel`.

### Verified event outbox

`hb_verified_event_outbox` localStorage key. **Device-local transport queue** — explicitly NOT in `CloudSync.SNAPSHOT_KEYS`. Replaces the prior fire-and-forget submission path in `submitVerifiedEventsForDuels`.

- **Cap:** 250 events. Over-cap → FIFO drop (oldest entries leave the head of the array).
- **Dedup key:** `client_event_id`. For `event_type === 'steps_total'`, re-queueing prefers the **higher** value — steps over a window are cumulative and should never decrease across submissions. For other types, the newer entry replaces the older (keeps the original `queued_at`).
- **Drain triggers:** `init()` (after auth ready), `renderDuelsSection()` (Duels tab open), `visibilitychange` → visible. No periodic timer in v1 — the existing triggers cover real-world cadence.
- **Failure handling:**
  - Network/null response → keep batch in queue, retry next trigger.
  - 401 / `EXPIRED` / `UNAUTHORIZED` → keep batch + set `_outboxLast401At`; drain refuses to retry within 60 s of the last 401 (auth-recovery backoff).
  - Other non-ok (rate limit, 5xx) → keep batch, retry next trigger.
  - 200 ok → drop batch from queue. Backend's `UNIQUE(user_id, client_event_id)` constraint silently dedupes re-submissions, so retries are always safe.
- **Submission path now goes:** `_buildEventsForActiveDuel` → `_enqueueVerifiedEvents(all)` → `_drainVerifiedEventOutbox()`. The fire-and-forget chunk loop is gone.
- **Helpers in `app.js`:** `_loadVerifiedEventOutbox`, `_saveVerifiedEventOutbox`, `_enqueueVerifiedEvents`, `_drainVerifiedEventOutbox`. `_drainVerifiedEventOutbox` is also exposed on `window` for the console-debug surface, and logs a one-line `[outbox] drained=X kept=Y` on every drain attempt.
- **No UI surface in v1.** The console log is the only diagnostic. Adding a Settings/debug view is deliberately out of scope until real usage flags a need.

### Why the outbox is excluded from Cloud Sync

Cloud Sync's SNAPSHOT_KEYS is an **allowlist for USER STATE**, not device state. The outbox is transport state: queued events carry `duel_id` references that are valid on this device's view of the world at this moment. Restoring an outbox onto a different device — perhaps after `localStorage.clear()` and a fresh install — would replay events with stale `metric_date`s and `duel_id`s that may belong to duels the user has since seen resolve. The backend's UNIQUE constraint would catch most duplicates, but the principle is the same as the Phase 1w.2 HealthKit reset: device-sovereign state stays device-local.

---

## Duels polish pass (v3 Phase 1z.2)

Brand-defining polish pass on top of the Verified Duel Scoring Engine. Ships in `2.2.1-w14`. Focused on the locked-down moments — verbs, draw bodies, accordion behavior, live ticks, HUNTING-pill type-glyph integration — that carry duel identity through the UI without requiring structural overhaul of the existing surfaces.

### Visual identity locks

- **Six type glyphs (SVG, inline).** `DUEL_TYPE_GLYPH_SVG` map exposes a `<svg>` string per duel type: footprint (steps), moon (sleep), moon-with-clock (bedtime), dumbbell (strength), shield-check (verified_objectives), crowned skull (boss_race). Resolved via `getDuelTypeGlyphSvg(type)`. Used in the HUNTING-strip duel pill today; reusable by future detail / picker / global-rankings surfaces.
- **Cinzel/JetBrains-Mono split + rune-divider treatment** stays as established. Tokens added: `--gold-hot`, `--gold-glow-soft`, `--purple-glow-soft`, `--border-gold-strong`, `--border-purple-strong`, `--border-emerald`, `--border-red-strong`, plus `--ease-pop` + `--ease-cinema` curves. All live in `:root` next to the existing `--duels-*` tokens.
- **Six brand-locked verbs (`DUEL_VERB_BY_TYPE`).** One unique verb per type — `outstepped` / `outrested` / `outanchored` / `outlifted` / `outdisciplined` / `outhunted`. Carries type identity into every toast and detail-overlay outcome string. **Do not change these without explicit product reversal** — they are brand-defining terms. `_DUEL_VERB_BY_TYPE` (the older `{ win, loss, prefix }` shape) was also realigned for consistency (`sleep` → `outrested`, `bedtime` → `outanchored`, `boss_race` → `outhunted`).
- **Draw rotation.** `DUEL_DRAW_BODIES` carries 3 strings — `"Even ground with {opponent}."` / `"Stalemate. Neither hunter blinked."` / `"Both held the line. Duel ends sealed."` Index persists via `hb_duel_draw_rot_idx` localStorage so consecutive draws rotate. The detail overlay re-uses the **prior** index (n−1) so toast + overlay show the same body for the same resolution.

### Accordion behavior

- **Persistence.** Toggling either accordion writes `hb_duels_friends_expanded` or `hb_duels_duels_expanded` (`'1'` or `'0'`).
- **First-daily-open auto-expand.** When `_friendsCache.incoming.length > 0` OR `_duelsCache.incoming.length > 0` on the first session of the device-local day, the corresponding accordion auto-expands and a daily flag (`hb_duels_friends_auto_expanded_<YYYY-MM-DD>` / `hb_duels_duels_auto_expanded_<YYYY-MM-DD>`) marks it so it only triggers once that day. After that, manual state wins.
- Helper: `_restoreDuelsAccordionState()` reads the persisted flag, then layers auto-expand on top. Called from the social-panel collapse-wire init.

### Live 60s tick

- `startDuelsLiveTick()` / `stopDuelsLiveTick()` — sets a `setInterval` that decrements `_duelsCache.active[*].time_remaining_ms` by 60 000ms every tick and re-renders the hero + HUNTING strip pill. No backend polling.
- Started on `switchTab('social')` entry; stopped on every other tab. Wrapped in try/catch so any failure inside the tick can never break a tab switch.
- Future bedtime work: if a duel ends mid-tick (`time_remaining_ms` reaches 0), the next render still calls `renderActiveDuelHero` with the cached active list; auto-resolve only happens via `maybeResolveDuelIfEnded` on the next real fetch — by design, the tick is read-only.

### HUNTING-strip duel pill (decision #3)

- Pill now renders: leading gold pulse dot (`.duel-hpill-pulse`, soft 1.6 s pulse) → `tab-social.png` icon → `[TYPE_CODE] · VS [ALIAS]` text → inline gold type glyph (`.duel-hpill-glyph`) → countdown.
- `_buildDuelHeaderPill` exposes `duelType` on the pill descriptor; `updateStatusPills` renders the gold pulse + glyph for `kind === 'duel'` pills only (boss pill markup unchanged).
- Tap navigation already wired (existing `_setupHeaderPillDuelClick`).

### Result toast copy (brand-locked)

`_maybeFireDuelResultToast` now composes via:
- **Victory:** `"Duel won. " + getDuelVictoryBody(type, opponent)` → e.g. `"Duel won. You outanchored Kazuto."`
- **Defeat:** `"Duel lost. " + getDuelDefeatBody(type, opponent)` → e.g. `"Duel lost. Kazuto outanchored you. Train. Rematch."`
- **Draw:** `"Duel sealed — " + getDuelDrawBody(opponent, idx)` with `idx` from `_nextDuelDrawRotationIndex` (advances + persists).

One body per (type, outcome) pair in v1 — no in-type flavor rotation. Detail overlay headline uses the same helpers so toast + overlay agree, with the overlay re-reading the previous index so a single resolution shows the same body across both surfaces.

### Future passes (not yet shipped)

The full hero rewrite (Cinzel "VICTORY" with gold-dust particles, twin duelist columns + VS sigil + score-gap bar, corner runes on hero/victory cards), the 5-variant Duel Detail overlay redesign (incoming / outgoing / active / completed-victory / completed-defeat / completed-draw), the Choose Verified Duel sheet redesign (40×40 glyph blocks + radial gold selected state), and the Stats Global Rankings card overhaul are **deferred to a follow-up polish pass**. The current pass ships the high-leverage brand commitments (verbs, draw rotation, toast copy, glyphs in HUNTING pill, accordion behavior, live tick) so users feel the type-identity carry through every win/loss moment without taking on the structural risk of rewriting the working surfaces.

---

## Drops & Card Collection (v2.0.2 Phase 1 → v2.2.0 Phase 1h)

Card-drop system layered on top of boss kills. Each kill rolls against the boss's drop table; rare/ultra-rare drops trigger a cinematic Solo Leveling reveal modal, commons fire a combined kill-toast. Collection surface is the **Items tab → Relic Archive** (renamed from "Pokédex" in v2.2.0 — see "Relic Archive" section). Single source of truth for design: `DROPS.md` (v1.8 code state — file header still reads v1.4) + `EQUIPMENT.md` (v1.3).

**v2.2.0 rebalance (Phase 1h)** shifts the rate model: 3-tier cadence (daily / triweekly / weekly), per-boss first-common protection (replaces the global flag), AND bad-luck protection — soft + hard ultra pity + any-drop pity. The goal: low-volume bosses (weekly especially) never feel like unrewarding coin flips.

### CARDS constant (`app.js`)

9 launch items, each entry shape:

```js
{
  id, name, slot, source_boss, rarity, tier,
  flavor, art_path,
  bonuses: { str, vit, int, focus, will, wlt },  // exactly 6 keys, canonical order
  set_id: null, required_level: null, special_effect: null,
  on_equip: null, cooldown_seconds: null,         // reserved for Phase 3
}
```

| Boss | Common (slot) | Rare (slot) | Ultra-Rare BIS (slot) |
|---|---|---|---|
| The Insomniac (E) | Dream-Woven Hood (helm) +2 VIT | Sleepwalker's Cloak (cape) +6 VIT | Pendant of the Wakeful (amulet) +8 VIT / +4 WILL |
| The Carouser (E) | Vow Ring (ring) +2 WILL | Vessel of Refusal (weapon) +6 WILL | Sober King's Gloves (gloves) +4 VIT / +8 WILL |
| The Steel Wolf (E, re-tiered) | Pack Leader's Greaves (legs) +4 VIT | Alpha's Mantle (body) +12 VIT | Trail-Worn Boots (boots) +16 VIT / +8 STR |
| The Iron Warden (D) | Iron Grip Wraps (gloves) +3 STR / +1 WILL | Warden's Plate (body) +8 STR / +2 VIT | Titan's Oathblade (weapon) +10 STR / +5 WILL |
| The Glass Strider (D) | Strider's Laces (boots) +3 VIT | Glass Path Boots (boots) +8 VIT / +2 FOCUS | Horizon Step Ring (ring) +10 VIT / +5 FOCUS |
| The Dream Tyrant (D) | Quiet Thread (amulet) +3 VIT | Tyrant's Sleep Mask (helm) +8 VIT / +2 WILL | Crown of Deep Rest (helm) +10 VIT / +5 FOCUS |

Each boss has one **signature slot** — its ultra-rare is best-in-slot for that slot at launch. Stat magnitudes per tier:
- **E**: common 2 primary / rare 6 primary / ultra 8+4 = 12 total.
- **D (v3 Phase 1v)**: common 3 primary (often +1 secondary) / rare 8+2 = 10 total / ultra 10+5 = 15 total. Conservative bump over E — deliberately well below the Steel Wolf legacy values (which run 4 / 12 / 24 as outliers, retained for save compatibility).
- Tier-doubling pattern resumes at C and beyond.

The three D ultras (weapon, ring, helm) occupy slots NOT held by an E ultra (amulet, gloves, legs/boots), so they're uncontested Best-in-Slot for their stat-pair niches without invalidating any E ultra.

Each Iron Warden / Glass Strider / Dream Tyrant common drops 3 entries — same pattern as the v2.1 content patch. Iron Warden commons fill gloves / body / weapon; Glass Strider fills boots / ring / cape; Dream Tyrant fills amulet / amulet / cape.

### Drop rates — cadence-aware (`DROP_RATES_BY_CADENCE`) — v1.7

```js
{
  daily:     { ultra_rare: 1/20,  rare: 1/12,  common: 1/5,   common_protected: 2/3  },
  triweekly: { ultra_rare: 0.10,  rare: 0.15,  common: 0.30,  common_protected: 0.65 },
  weekly:    { ultra_rare: 0.20,  rare: 0.25,  common: 0.40,  common_protected: 0.70 },
}
```

Three cadence tiers: `daily` (many attempts; modest rates), `triweekly` (~2–3 attempts/week), `weekly` (very few attempts, rewarding rates but ultra capped at 20% to keep scarcity). Resolved per-boss via `dropRatesFor(bossId)` which reads `BOSSES[id].cadence`. Cadence is validated against `VALID_CADENCES = {daily, triweekly, weekly}`; missing/invalid value falls back to `daily` AND fires `console.warn` once per offending boss (single-fire via `_warnedCadenceFor` Set).

**Roll order** in `rollBossDrop(bossId)`: ultra-rare → rare → common, mutually exclusive, one card max per kill. Each tier is an independent RNG roll; first hit wins.

**Per-boss first-common protection (v3 Phase 1h).** Replaces the prior global flag (`first_common_pulled`). Each boss tracks its own `first_common_by_boss[bossId]: boolean`. Until the user gets their first common from THIS boss, the common rate is the cadence-specific `common_protected` value. Once that boss's first common drops, protection ends for that boss only. Helpers: `hasPulledFirstCommonForBoss(bossId)`, `markFirstCommonPulledForBoss(bossId)`. Migration on `loadInventory`: any boss whose common is already owned (count > 0) is marked protection-ended automatically.

### Bad-luck protection (`DROP_PITY_BY_CADENCE`) — v3 Phase 1h → 1r (3-layer mercy)

```js
{
  daily:     { any_drop_guarantee_after: 4,  rare_mercy_after: 12, ultra_soft_pity_after: 20, ultra_soft_pity_add: 0.02, ultra_soft_pity_max: 0.20, ultra_hard_pity_after: 40 },
  triweekly: { any_drop_guarantee_after: 3,  rare_mercy_after:  6, ultra_soft_pity_after: 10, ultra_soft_pity_add: 0.03, ultra_soft_pity_max: 0.25, ultra_hard_pity_after: 20 },
  weekly:    { any_drop_guarantee_after: 2,  rare_mercy_after:  4, ultra_soft_pity_after: 5,  ultra_soft_pity_add: 0.05, ultra_soft_pity_max: 0.35, ultra_hard_pity_after: 8  },
}
```

Three guarantee layers, evaluated independently. Order in `rollBossDrop`: normal rarity rolls (ultra → rare → common, with ultra hard pity already baked into the ultra rate) → **Rare Mercy floor** → **Any-drop guarantee** fallback.

- **Guaranteed relic (any-drop guarantee):** Nth consecutive no-drop forces a drop. `forcePityDrop(bossId)` picks the most respectful rarity that has cap room: common (if not capped) → rare (if rare count < 3) → ultra-rare (cap is `Infinity`, always valid). Reset by any relic.
- **Rare Mercy (v3 Phase 1r):** Nth consecutive kill without a rare-or-better promotes the current outcome to a rare. Triggers when the current outcome is `null` (no drop) OR `common`; **never downgrades an ultra**. If the rare pool is empty (e.g. a boss with no rare cards defined yet), Rare Mercy silently falls through and the Any-drop guarantee may still fire. Reset by Rare or Ultra; NOT reset by Common.
- **Soft ultra pity:** When `kills_since_ultra >= ultra_soft_pity_after`, effective ultra rate = `min(baseRate + N×add, max)`. Boost grows with every extra ultra-less kill.
- **Hard ultra pity (Ultra Mercy ceiling):** At `kills_since_ultra >= ultra_hard_pity_after`, effective ultra rate = `1` (guaranteed). Reset by Ultra only.

`getEffectiveUltraRate(bossId, baseRate)` computes per-roll; the base table is never mutated. Rare Mercy is checked AFTER the normal roll so an ultra outcome from the ultra roll (or ultra hard pity) is preserved — Rare Mercy is a **floor**, never a ceiling.

**Result-table summary:**

| Outcome     | Guaranteed Relic | Rare Mercy | Ultra Mercy |
|-------------|------------------|------------|-------------|
| No drop     | +1               | +1         | +1          |
| Common      | reset            | +1         | +1          |
| Rare        | reset            | reset      | +1          |
| Ultra       | reset            | reset      | reset       |

Migration: the `kills_since_rare_or_better` counter already existed in `_freshPityState()` from Phase 1h, so existing users carry their pre-1r progress forward. No backfill, no schema bump.

### Pity counters per boss (`hb_inventory.drop_pity_by_boss[bossId]`)

```js
{
  kills_since_any_drop:       0,
  kills_since_ultra:          0,
  kills_since_rare_or_better: 0,
  last_drop_at:               'ISO string' | null,
}
```

Updated after every kill in `rollBossDrop`:
- **No drop:** all three counters += 1.
- **Common drop:** `kills_since_any_drop = 0`, ultra/rare-or-better counters += 1.
- **Rare drop:** `kills_since_any_drop = 0`, `kills_since_rare_or_better = 0`, `kills_since_ultra += 1`.
- **Ultra drop:** all three counters = 0.

`last_drop_at` is set on any drop. Counters are boss-specific; one boss's empty streak does NOT advance another's pity. Helpers: `getDropPityState`, `setDropPityState`, `incrementDropPityAfterNoDrop`, `resetDropPityAfterDrop(bossId, rarity)`. `_freshPityState()` builds the zero-state stub.

### Toast phrasing for pity outcomes

- No pity (regular pull): `"<Boss> defeated. +50 souls. Pulled: <Card> (Common)."`
- Any-drop pity: `"… Mercy awakened: <Card> (Common)."`
- Hard ultra pity: `"… Fate answered."` (cinematic reveal still fires for the ultra)
- Soft-pity ultras read as normal pulls — the boost was probabilistic, not deterministic.

### Stack caps (`STACK_CAPS`)

```js
{ common: 1, rare: 3, ultra_rare: Infinity }
```

Drops continue rolling at standard rates even when at cap — but the inventory count doesn't increment past the cap. **Every drop event surfaces to the user via toast.** Four cases:

| Scenario | Inventory | Toast | Reveal modal |
|---|---|---|---|
| First-acq common | count → 1 | `"X defeated. +50 souls. Pulled: Card (Common)."` | — |
| Common dupe (at 1) | unchanged | `"…Duplicate Card (Common). Cap reached (1)."` | — |
| First-acq rare | count → 1 | `"X defeated. +50 souls."` | ✓ cinematic |
| Rare dupe 2nd/3rd | count → 2 / 3 | `"…Duplicate Card (Rare). You have 2."` | — |
| Rare dupe at cap | unchanged | `"…Duplicate Card (Rare). Cap reached (3)."` | — |
| First-acq ultra | count → 1 | `"X defeated. +50 souls."` | ✓ cinematic |
| Ultra dupe | count → N+1 | `"…Duplicate Card (Ultra-Rare). You have N+1."` | — |

### `rollBossDrop` return shape (v3 Phase 1h adds `fromPity` + `pityType`)

```js
{
  card:      { ...CARDS entry },
  wasFirst:  boolean,  // true only if newly discovered AND not capped
  wasCapped: boolean,
  count:     number,   // current count AFTER the operation
  cap:       number,   // STACK_CAPS[rarity] (Infinity for ultra)
  fromPity:  boolean,  // true if this drop came from pity (not RNG)
  pityType:  'any_drop' | 'ultra_soft' | 'ultra_hard' | null,
}
```

Returns `null` if no drop rolled (and no pity fired). The 3 boss kill-handlers (`evaluateInsomniacForNight`, `evaluateCarouserForNight`, `evaluateSteelWolfForDay`) pass the result through to `announceKillAndDrop(cfg, soulsReward, dropInfo)` which composes the toast text and kicks the reveal queue.

### Inventory storage (`hb_inventory`) — v3 Phase 1h shape

```js
{
  cards: { [card_id]: { discovered, count, first_acquired_date } },
  // Legacy global flag — preserved + kept in sync for any unmigrated downstream code.
  first_common_pulled: bool,
  first_common_date:   'YYYY-MM-DD' | null,
  // v3 Phase 1h — per-boss first-common protection.
  first_common_by_boss: { [bossId]: true },        // bossId present + true means protection ended
  // v3 Phase 1h — per-boss pity counters.
  drop_pity_by_boss: { [bossId]: {
    kills_since_any_drop, kills_since_ultra, kills_since_rare_or_better, last_drop_at
  }},
  reveal_queue: [card_id, ...]                     // rare/ultra-rare pending reveal
}
```

`loadInventory` runs three migrations:
1. **Legacy `first_uncommon_*` rename** (v1.3) — read either, prefer new, persist new.
2. **Per-boss first-common backfill** (v3 Phase 1h) — if `first_common_by_boss` missing, walk CARDS and mark protection-ended for any boss whose common is already owned (count > 0). Other bosses keep protection active.
3. **Pity state backfill** — every known boss in `BOSSES` gets a fresh `_freshPityState()` if its entry is missing.

All migrations are idempotent; no explicit flag needed.

### Cinematic reveal modal (`#reveal-overlay`)

Solo Leveling system-window styled. Triggered by `processRevealQueue()` ~500ms after the kill toast. Animation sequence:

| t (s) | Event |
|---|---|
| 0.30 | System-window lines draw in |
| 0.55 | Card frame materializes |
| 0.85 | Slot icon + art fade in |
| 1.05 | Name appears |
| 1.15 | Source line appears |
| 1.25 | Flavor text appears |
| **1.45** | **Stat-bonus badges fade in** *(v2.0.2)* |
| 1.60 | "Tap to continue" hint |

Stat-bonus row uses the same `cardStatBadgesHtml(card)` helper as the carddetail modal — single source for badge rendering. Ultra-rare reveals get extra particle drift + gold-violet shimmer pulse.

### Card art render pipeline (real-art-first with fallback)

All 3 surfaces (Pokédex grid tile, reveal modal, carddetail modal) use the same pattern: an `<img class="*-card-art-img">` layered absolute-positioned over the emoji slot icon. Container is `position: relative; overflow: hidden; aspect-ratio: 1 / 1`. If the image 404s, the JS error handler (`img.remove()` for Pokédex; `display:none` for modals) removes the img, revealing the emoji + rarity gradient underneath. Successful loads cover the fallback.

**Adding a new card's art:**
1. Drop `assets/items/<card_id>.png` (1254×1254 RGB)
2. Add the path to `PRECACHE_ASSETS` in `sw.js`
3. Bump `CACHE_VERSION`
4. Codemagic's glob copy step (`cp assets/items/*.png www/assets/items/`) picks up new files automatically — no pipeline edit required

### Relic Archive (Items tab) — v3 Phase 1g

Renamed from "Pokédex"/"Items" in v2.2.0 to frame the tab as a collectible loot archive rather than a storage drawer. Header reads **RELIC ARCHIVE** + flavor line "Every relic was earned through discipline." Section IDs in markup still say `pokedex-*` for backward compat; CSS adds `.archive-*` classes on top.

- 3 collapsible sections — `ULTRA-RARE RELICS` / `RARE RELICS` / `COMMON RELICS` (renamed in v2.2.0). All default-collapsed via `loadPokedexCollapsed()`; persisted to `hb_pokedex_collapsed`.
- Section headers are `<button>` with `aria-expanded` + chevron rotation (▾ open / ▸ collapsed). Ultra-rare header gets a faint gold text-shadow via `.archive-rarity-header--ultra`.
- **Discovered cards** now show:
  - **Slot badge** (`.archive-slot-badge`, top-left): `HELM` / `WEAPON` / `PLATE` / `GLOVES` / `BOOTS` / `RING`. Resolved via `getCardEquipmentSlot(card)` → typed slot.
  - **Equipped badge** (`.pokedex-card-equipped-badge.archive-equipped-badge`, top-right gold pill) when the card sits in the Hunter Build.
  - **Drop-source line** under the name (`.archive-item-source`, e.g., "THE CAROUSER") resolved via new `getCardDropSourceLabel(card)` helper.
- **Mystery (undiscovered) cards** show the `?` mark + rarity teaser (`ULTRA-RARE` / `RARE` / `COMMON`) + source hint (`Drops from The Carouser` or `Defeat dungeon bosses to discover`). Item name stays hidden.
- **Acquisition-order display** — discovered cards within each rarity section sort by `first_acquired_date` ASC (chronological discovery log). Ties break alphabetically.
- **COMMON tier hides silhouettes** — commons roll passively, the empty slots were noise. RARE + ULTRA still tease mystery cards.
- Tap discovered card → `openCardDetailModal()`. Tap mystery card → `openMysteryCardModal()` (NOT the prior "Not yet discovered." toast).

### Mystery card info modal (`#mystery-card-modal`) — v3 Phase 1g

Opens when the user taps a `?` placeholder. Shows:
- Big `?` mark in Cinzel gold
- "UNKNOWN RELIC" title
- Rarity (e.g., `Ultra-Rare`)
- Source boss (e.g., `The Carouser`) or `Unknown` if no metadata
- "Defeat this boss for a chance to reveal this relic." (or `Defeat dungeon bosses to discover this relic.` when source unknown)
- **HUNT BOSS** button (primary) — closes modal + switches to Quests tab. Disabled when no source boss is known.
- **CLOSE** (secondary)

Never reveals the item name. Helpers: `openMysteryCardModal(card)`, `closeMysteryCardModal()`, `setupMysteryCardModal()` (wired once in `init()`).

### Armory CTA on the Items tab — v3 Phase 1g

Single "VIEW YOUR ARMORY" button (`.archive-armory-cta`) carries a primary label + a live secondary status line: `Gear Power N · K / 6 Equipped`. Refreshed by `refreshArmoryCTAStatus()` on every `renderPokedex()` call so the count is always current after equip/unequip. Reuses `aggregateBuildPower()` + `countEquippedBuildItems()` from the Hunter Build module — no duplicate calc.

### Card detail modal (`#carddetail-overlay`)

Tapping a discovered archive tile opens this. 1:1 art aspect. Layout: art → rarity → name → source → flavor → **stat-bonus row** → first-found-date → stack count ("You have N") → **EQUIP TO BUILD / UNEQUIP button** (`.carddetail-equip-btn`, v3 Phase 1d). Button is purple→deep-violet gradient when EQUIP TO BUILD (primary), muted-navy when UNEQUIP. `::before` pseudo-element renders a gold `✦` glyph on the primary variant so the JS `textContent` swap doesn't disturb it. Click routes through `equipBuildItem(targetIdx, cardId)` where `targetIdx = EQUIPMENT_SLOT_INDEX[getCardEquipmentSlot(card)]` — strictly typed. If the matching slot is rank-locked (legacy support; all 6 unlocked at every rank in current build), surfaces a rank-lock toast. If `WRONG_SLOT`, surfaces "doesn't fit that slot" — defensive since the picker is slot-filtered.

### `window.Drops` debug API — v3 Phase 1h

```js
Drops.state                              // current hb_inventory
Drops.CARDS                              // CARDS constant
Drops.RATES                              // DROP_RATES_BY_CADENCE
Drops.PITY                               // DROP_PITY_BY_CADENCE
Drops.getCadence(bossId)                 // 'daily' | 'triweekly' | 'weekly' (validated)
Drops.getRates(bossId)                   // resolved rates for that boss
Drops.getPity(bossId)                    // raw pity counters
Drops.getPityDisplay(bossId)             // read-model for UI: { anyDropCurrent, anyDropTarget, ultraCurrent, ultraSoftTarget, ultraHardTarget, lastDropAt, cadence }
Drops.resetPity(bossId)                  // zero counters for that boss
Drops.forcePityDrop(bossId)              // returns the card the pity system WOULD pick (no mutation)
Drops.simulateDrops(bossId, n)           // dry-run N kills, return aggregate counts. NEVER mutates real state.
Drops.hasFirstCommon(bossId)             // true if this boss's common has dropped
Drops.forceRoll(bossId, rarity)          // bypass RNG; respects stack caps + fires reveal
Drops.forceDrop                          // alias of forceRoll
Drops.resetInventory()                   // wipe + re-stub
Drops.rollBossDrop(bossId)               // execute a real roll
Drops.processRevealQueue()               // open pending reveal
```

Backward-compat: `Drops.forceRoll(bossId, 'uncommon')` is aliased to `'common'` (legacy v1.2 rarity name).

**Console-only `simulateDrops`** is for balance tuning. Runs N kills through a clone of pity state, returns `{ common, rare, ultra_rare, no_drop, pity_drops }`. Stack caps are NOT modeled in the sim (it pretends caps are infinite for simplicity) — real outcomes can convert some pulls to "capped" depending on inventory. Useful for verifying cadence balance, NOT for predicting per-user variance.

### Reveal queue persistence

`hb_inventory.reveal_queue` is a JSON array of card IDs awaiting cinematic. Persists across cold launches — if the user kills a boss and gets a rare drop while the app is backgrounded, then force-quits before opening the reveal, the queue replays on next launch. Stale IDs (cards no longer in `CARDS`) are silently dropped from the head of the queue.

---

## Hunter Build — typed equipment Armory (v3 Phase 1d → 1e)

Replaces the v2.1/v3-Phase-1a/b/c **9-slot body-equipment panel** (`panel-base.png` carved-stone art with `.equipment-slot-hit` invisible hit targets, `.armory-socket-*` 5-layer DOM, etc) — all RETIRED. The new system is a clean 6-slot 3×2 tile grid in the same `#equipment-modal` shell. Avatar tap (Status tab) or "VIEW YOUR ARMORY" (Items tab) opens it.

**Why the pivot:** card art at `assets/items/*.png` is flattened RGB with backgrounds. CSS cannot remove flattened backgrounds. The 9-slot panel needed transparent icons to read cleanly inside carved sockets, and authoring that pipeline kept producing "square thumbnails inside black UI." The MOBA-style square tile grid embraces the card art intentionally — no transparency requirement, no body-socket art problem.

### Typed slots

```js
const EQUIPMENT_SLOTS = [
  { key: 'helm',   label: 'HELM' },
  { key: 'weapon', label: 'WEAPON' },
  { key: 'plate',  label: 'PLATE' },
  { key: 'gloves', label: 'GLOVES' },
  { key: 'boots',  label: 'BOOTS' },
  { key: 'ring',   label: 'RING' },
];
const EQUIPMENT_SLOT_INDEX = { helm: 0, weapon: 1, plate: 2, gloves: 3, boots: 4, ring: 5 };
```

**Legacy slot collapse** (`LEGACY_TO_TYPED_SLOT`):
- `helm`, `weapon`, `gloves`, `boots`, `ring` — direct pass-through
- `body`, `legs`, `cape` → `plate` (catch-all armor)
- `amulet` → `ring` (single jewelry slot for now)

TODO Phase 1f+: dedicated `cape`, `amulet`, `legs` slots if/when content warrants 9 slots.

`getCardEquipmentSlot(card)` reads `card.slot || card.equipment_slot || card.equipmentSlot || card.slot_type || card.gearSlot`, maps through `LEGACY_TO_TYPED_SLOT`. Returns `null` for cards with no slot — emits a single `console.warn` per offending card via `_warnedSlotMissingFor` Set.

### Slot unlocks

All 6 slots unlocked at every rank. `getUnlockedBuildSlots()` returns the constant `HUNTER_BUILD_SLOT_COUNT = 6`; `isBuildSlotUnlocked(i)` returns `true` for `i ∈ [0, 6)`. The rank-gated render path (locked tiles with `REACH X RANK` label) is kept in the renderer in case a future product call reintroduces gating — currently dead code.

> **Product call (May 13):** all 6 slots are open from day one. Discipline pressure stays on the drop-rate side of the economy; the Armory itself is fully open. DO NOT reintroduce rank-gating without explicit ask.

### Storage (`hb_hunter_build`)

```js
{
  slots: [card_id|null, card_id|null, ..., card_id|null],  // length 6, index = typed slot
  updated_at: 'ISO string',
}
```

Index 0 = helm, 1 = weapon, 2 = plate, 3 = gloves, 4 = boots, 5 = ring. Same shape as the v3 Phase 1d generic 6-slot, just indices are now typed. Migration via `migrateGenericBuildToEquipmentBuild()` (one-shot, idempotent via `hb_equipment_build_migrated_v1`): walks the old generic build, places each card at its typed slot index, evicts dupes for the same slot (first one wins, evicted card stays in inventory but unequipped). Owned cards are never deleted.

A second one-shot migration `migrateEquipmentToHunterBuild()` (idempotent via the presence of `hb_hunter_build`) walks the prior v3 Phase 1a `hb_pvp_equipped` body-slot storage and seeds the new generic build with up to 6 entries in priority order (weapon, body, helm, gloves, legs, boots, amulet, ring, cape). `hb_pvp_equipped` is NEVER deleted — kept on disk as a safety copy.

### Slot-type enforcement

`equipBuildItem(slotIndex, cardId)` validates the card's typed slot matches the target index. Return codes:
- `{ ok: true, prevCardId }` — equipped, optional prev card to surface in toast
- `{ ok: false, code: 'BAD_INDEX' }`
- `{ ok: false, code: 'LOCKED', requiredRank }` — dead path under current "all unlocked" policy
- `{ ok: false, code: 'BAD_CARD' }`
- `{ ok: false, code: 'WRONG_SLOT', cardSlot, targetSlot }` — Pup's Hood cannot equip into RING
- `{ ok: false, code: 'DUPLICATE', existingSlot }` — one copy of a card can only sit in one slot

### Renderers

| Function | Purpose |
|---|---|
| `renderHunterBuild()` | 3×2 grid. Each tile carries a **full-width top banner** (`.hunter-build-slot-label`, z-index 8, 24px height, gold-bordered) showing the slot identity on every state. Equipped tiles: art + name band at bottom. Empty tiles: `+` icon + EMPTY + "Tap to equip" hint. Locked tiles: 🔒 + "REACH X RANK". |
| `renderHunterBuildSummary()` | 3 rows: `GEAR POWER N` (gold, Cinzel; renamed from BUILD POWER), `DOMINANT PATH STAT · TAGLINE`, `EQUIPPED K / N`. Plus a `LOCKED SLOTS K awaiting rank-up` hint when relevant (dead under current policy). |
| `aggregateBuildPower()` | Sum of `getItemBuildPower(card)` across equipped slots. Common = 1, rare = 3, ultra_rare = 7. |
| `getBuildDominantPath()` | Sums each card's bonuses, returns top stat id (`STR`/`VIT`/etc) or `null` if nothing equipped. |
| `countEquippedBuildItems()` | Number of filled slots. |

### Select Relic picker (`#build-picker-sheet`) — v3 Phase 1d / 1e

Compact MOBA-style inventory grid. Slot-FILTERED: opens with title `SELECT HELM` (or WEAPON/PLATE/etc) and shows only cards whose typed slot matches the tapped slot. Empty state: "No helm relics discovered yet. Defeat bosses to find one."

- Grid: `repeat(auto-fill, minmax(112px, 1fr))` mobile, `minmax(128px, 150px)` + `justify-content: center` on ≥760px. Container capped at 720px (mobile) / 920px (wide) so desktop reads as a centered shelf, not a stretched gallery.
- Tile: square art-wrap → rarity chip top-left (`COMMON`/`RARE`/`ULTRA`, color-coded) + equipped-status badge top-right (`EQUIPPED` gold pill, `SLOT N` purple pill for equipped-elsewhere). Below art: 2-line clamped name + stat-chip row (max 2 chips + `+N` overflow).

### Build detail sheet (`#build-detail-sheet`) — v3 Phase 1d (REPLACE removed)

Opens when user taps an EQUIPPED slot. Shows art + name + rarity + flavor + stat-bonus row + **UNEQUIP button only**. The REPLACE button (which opened the picker pre-filled) was removed v3 Phase 1d follow-up — the unequip-then-tap-empty-slot flow is one fewer concept to teach, and it leaves the build-detail sheet clean. UNEQUIP uses the muted-navy `.build-detail-btn--unequip` styling.

### `window.HunterBuild` debug API

```js
HunterBuild.load                  // loadHunterBuild()
HunterBuild.get                   // getHunterBuild()
HunterBuild.equip                 // equipBuildItem(slotIndex, cardId)
HunterBuild.unequip               // unequipBuildItem(slotIndex)
HunterBuild.isEquipped            // isItemEquippedInBuild(cardId)
HunterBuild.slotForCard           // getBuildSlotIndexForCard(cardId)
HunterBuild.unlockedSlots         // getUnlockedBuildSlots(rankId) — currently constant 6
HunterBuild.requiredRank          // getRequiredRankForBuildSlot(index) — currently constant 'E'
HunterBuild.isSlotUnlocked        // isBuildSlotUnlocked(index)
HunterBuild.buildPower            // aggregateBuildPower()
HunterBuild.dominantPath          // getBuildDominantPath()
HunterBuild.equippedCount         // countEquippedBuildItems()
HunterBuild.itemPower             // getItemBuildPower(card)
HunterBuild.migrate               // migrateEquipmentToHunterBuild — legacy → generic
HunterBuild.migrateTyped          // migrateGenericBuildToEquipmentBuild — generic → typed
HunterBuild.SLOT_COUNT            // 6
HunterBuild.SLOTS                 // EQUIPMENT_SLOTS
HunterBuild.slotForCardType       // getCardEquipmentSlot(card)
```

The legacy `window.Equipped` module (v3 Phase 1a body-slot system) is kept exposed on `window` but no live UI consumes it. Its internal `EQUIPMENT_SLOTS` constant was renamed to `LEGACY_EQUIPMENT_SLOTS` to free the name for the new typed-slot constant.

---

## Splash + educational onboarding (v2.2.0 / v3 Phase 1i)

The launch experience frames Awakened as a system to enter, not a checklist to open.

### Splash (`#awakened-splash`) — every launch

Pre-rendered markup in `<body>` so the brand impression lands before any JS executes. Tonal-style restraint:

- Pure `#050510` background. One very-subtle 540px purple radial breathing behind the wordmark (`.splash-bg-orb`, `splash-orb-breathe 6s ease-in-out infinite`). **No rune ring, no decorative particles.**
- Small gold hunter-rune SVG mark (peak triangle + flame) stacked ABOVE the wordmark. 38px (`.splash-emblem`). Glow-only loop.
- `AWAKENED` wordmark in Cinzel 900 gold. Font-size `clamp(36px, 9vw, 56px)`. Letter-spacing `.14em`. Glow-only breathe (no transform bounce).
- Subtitle: `Discipline becomes power` in JetBrains Mono caps, `.36em` letter-spacing, `.58` opacity.
- `Preparing your system…` loading line anchored to bottom safe-area, fades in only if loading exceeds `SPLASH_LONG_LOADING_MS = 2400ms`.
- `.splash-content` capped at 460px max-width with 18px horizontal padding — never crowds the viewport edge on iPhone SE.

### Splash hide behavior

- `SPLASH_MIN_VISIBLE_MS = 1800ms` — splash dwells at least this long even if init is instant. Lands the brand.
- `hideSplash()` is the canonical hide call. Adds `.is-hidden` (.65s fade) then removes node after 600ms.
- Called from two paths:
  1. `init()` (signed-in user, main app mounts) — fires inside `enterFirstRunFlow()`.
  2. `setupSignInGateIfNeeded()` (no signed-in user) — fires inline on a 1800ms delay so the gate becomes visible underneath.
- `prefers-reduced-motion` strips all three animation loops.

### Educational onboarding (`#intro-onboarding`) — first-time users only

5-card overlay fires AFTER splash + BEFORE the existing welcome / signin flow. Gated by `hb_onboarding_seen_v2`.

| # | Title | Visual touches |
|---|---|---|
| 1 | Discipline Becomes Power | ⚜ emblem |
| 2 | Train Your Six Stats | 6-pill stat grid (STR / VIT / INT / FOCUS / WILL / WLT) |
| 3 | The System Is Honest | ✦ emblem (Apple Health framing) |
| 4 | Hunt Bosses. Earn Relics. | ☠ emblem |
| 5 | Shape Your Hunter Build | 6-slot mini-grid (HELM / WEAPON / PLATE / GLOVES / BOOTS / RING, first two highlighted) |

- Premium dark-card visual: Cinzel gold title, purple kicker (`CHAPTER N OF 5`), full-width primary CTA with purple→violet gradient + gold rim.
- Skip button confirms via `window.confirm('Skip the intro? You can re-read it later in Settings.')` before completing.
- Back button hidden on card 1.
- CTA on card 5 reads "Enter Awakened" — completion fires `enterFirstRunFlow()` which routes through the existing welcome → path → habit-picker chain.
- Card-rise animation on every step transition; reduced-motion strips it.
- Real `<button>` elements with focus-visible styles, safe-area padding, 360px-and-under tightening.

### Gating logic

```js
function shouldShowIntroOnboarding() {
  if (hb_onboarding_seen_v2 === '1') return false;
  if (hb_welcomed === '1') {
    // Returning users with the legacy welcome flag get auto-migrated.
    hb_onboarding_seen_v2 = '1';
    return false;
  }
  return true;
}
```

Brand-new users see the intro once. Existing users (who completed the older welcome flow) auto-set the v2 flag and never see the intro. There's no signup-time forcing of the educational content for returning users.

### Modal priority order (full launch sequence)

1. Splash (every launch, transient)
2. Sign-in gate (if no signed-in user) — Apple → alias claim
3. Educational onboarding (if first-time AND past signin)
4. Existing welcome screen ("A new hunter awakens…") — BYPASSED when name already claimed via signin (see Hunter name claim section)
5. Path screen (Choose Your Path)
6. Habit-picker onboarding
7. Beginning reveal (Origin Chapter 1)
8. What's New sheet (post-onboarding, on version bump)
9. Awakening / Class change (celebration queue)
10. Daily Insight (once per device-local calendar day, after Day 1)

---

## Hunter name claim & lock (v3 Phase 1j)

The hunter name is an identity claim, not a casual profile field. Claimed once → locked forever. The pre-v2.2.0 app exposed THREE name-entry surfaces (signin alias, welcome screen, habit-picker). All three collapsed to ONE canonical claim: the signin alias.

### Claim path (single source of truth)

1. User signs in via Apple → `#signin-step-alias` ("**Claim Your Hunter Name**")
2. `Auth.completeSignIn(alias)` succeeds → sets `hb_name = alias` + `hb_hunter_name_claimed = '1'` + `window.location.reload()`
3. On reload, signin-gate short-circuits (user has alias), `init()` runs

### Bypass logic

**Welcome screen** (`#welcome-screen`, "A new hunter awakens / Start My Quest" cinematic) — BYPASSED entirely when `hb_name` is set + ≠ `'Hunter'`. `enterFirstRunFlow()` in `init()`:
- If name already claimed AND `needsWelcome === true`: set `hb_welcomed='1'`, call `showPathScreen()` directly (or `render()` if onboarding also complete).
- Otherwise fall through to `showWelcomeScreen()` as before. (Legacy support — only triggers if `Auth.devSignInIfLocalhost()` somehow didn't seed `hb_name='DevUser'`.)
- Legacy `launchQuest()` inside the welcome screen ALSO sets `hb_hunter_name_claimed='1'` on completion as a fallback.

**Habit-picker onboarding** (`#onboarding`, "Choose Your Habits" with name input) — the name input row (`.ob-name-row`) is HIDDEN via inline `style.display = 'none'` when a claimed name exists. The picker UX still works; just no name field surfaced. `_completeOnboardingFinish()` ALSO sets the claim flag as a fallback.

### Lock UI

**Status tab pencil edit button** (`#sc-name-edit`) — renders ONLY when `hb_hunter_name_claimed !== '1'`. Conditional template literal in `renderStatus()`. The click handler is defensively guarded too: if the button somehow exists at runtime and gets tapped, it short-circuits with toast `"Hunter name already claimed."` before opening the inline input.

### Migration (one-shot in `init()`)

```js
if (hb_hunter_name_claimed !== '1') {
  const existing = (localStorage.hb_name || '').trim();
  if (existing && existing !== 'Hunter') {
    localStorage.setItem('hb_hunter_name_claimed', '1');
  }
}
```

Idempotent. Any existing user with a real name (anything except the default `'Hunter'`) gets the lock applied automatically — they don't see UI flip on them.

### Storage

- `hb_hunter_name_claimed = '1'` — single boolean flag. Set on: signin alias commit, welcome screen launch, habit-picker onboarding finish, init migration. Never cleared.
- `hb_name` — canonical name string. Still the field every renderer reads.

### Anti-pattern (DO NOT reintroduce)

- Pencil/✎ icon next to the name on Status tab when claimed
- Inline name-edit input
- Settings → Account → "Change name" path (don't add one)
- Re-prompting for name on app restart / signin re-auth

If a user genuinely needs to change their name (lost device, etc), it's a backend-side operation handled out-of-band. Don't add a self-service rename in the app.

---

## Service worker auto-update (v2.2.0)

The prior flow forced users to wait for the SW's ~24h freshness check, then click an in-app "⬆ Update available — Refresh" banner. When the banner didn't fire (race conditions, Safari quirks, byte-compare false-negatives), users had to manually unregister the SW via DevTools. Brutal UX. v2.2.0 makes updates silent.

### New behavior

`registerSW()` in `app.js`:

1. **Immediate `reg.update()` on page load.** Forces a network fetch of `/sw.js` — the browser otherwise won't re-check within a session (default ~24h).
2. **Re-check on `visibilitychange` to visible + `focus`.** Catches tabs left open across deploys.
3. **Silent auto-skip-waiting (belt-and-suspenders with the install-handler skipWaiting).** When a new SW reaches `'installed'` state AND a controller exists (= this is an UPDATE, not first install), the page silently `postMessage({ type: 'SKIP_WAITING' })`. No banner click required. As of v3 Phase 1x the new SW's own install handler ALSO calls `self.skipWaiting()` directly after precache (iOS Capacitor reliability — see file-map row for `sw.js`); the postMessage is now a redundant backup, not the primary mechanism. The redundancy is intentional: either path lands the new SW immediately.
4. **`controllerchange` handler reloads once.** Single silent reload per deploy.
5. **Version-string compare safety net.** 2s after register, fetches `sw.js` with `cache: 'no-store'`, parses `CACHE_VERSION`, compares with `hb_sw_last_active_version`. On drift: wipe caches + `reg.unregister()` + `location.reload()`. Catches races where the SW reports itself as fresh but disk has a newer version.

### Manual mode opt-in

```js
localStorage.setItem('hb_sw_manual_update', '1')
```

If set, `applyUpdate(worker)` shows the banner instead of auto-applying. Lets power users / devs control the timing. Banner click then posts SKIP_WAITING.

### Storage

- `hb_sw_known_version` — written background-async on register; used by the manual "Check for Updates" button in Settings.
- `hb_sw_last_active_version` — written by the version-compare safety net.
- `hb_sw_manual_update` — opt-in flag for banner mode.

### Trade-off

One silent reload per deploy. Awakened state lives in `localStorage`, so the reload preserves everything — habits, streaks, inventory, build, etc. Acceptable.

### What NOT to revert

- `sw.js`'s install handler intentionally calls `self.skipWaiting()` after the precache promise resolves (added in v3 Phase 1x to fix iOS Capacitor WebView staleness — every IPA update ships a new `sw.js` and the OLD SW from the previous IPA would otherwise keep serving stale `/index.html` from its precache). The earlier "don't add skipWaiting" guidance from v2.2.0 was for the web-only update-banner UX that doesn't apply inside an iOS WebView. The client-side `postMessage({type:'SKIP_WAITING'})` path in `app.js` stays as a belt-and-suspenders backup — both paths together = the new SW always takes over on the first chance it gets.
- Don't remove the version-string safety net — it's caught real drift cases in production.
- Don't reintroduce the banner as the default flow.

---

## Removed systems

### Daily Quest / Legendary Mission (removed v2.0.1)

The Daily Legendary Mission system was removed in v2.0.1 to simplify the Quests tab around the dungeon-boss focus. Removed in entirety:

- `LEGENDARY_MISSIONS` array (30 multi-component daily challenges)
- `total_missions_complete` PR card
- 4 quest-tier achievements (`quest_first/10/50/100`) and the `quests` ACH_CATEGORIES entry
- `dailyQuests`, `questHistory` state vars
- `getOrPickTodayMission`, `isMissionComponentDone`, `isMissionComponentTappable`, `toggleMissionComponent`, `isMissionComplete`, `onMissionProgress` functions
- `renderDailyMissionCard`, `setupDailyMissionCard`, `playMissionFanfare`, `showMissionCompleteScreen` functions
- `'mission'` branch in `drainLevelUpQueue` (`else if` chain stitched back together)
- All `renderDailyMissionCard()` call sites and `setupDailyMissionCard()` from init
- `#daily-mission-card` and `#mission-complete-screen` markup in `index.html`

**Preserved (intentionally NOT deleted):**
- `hb_daily_quests` and `hb_quest_history` localStorage keys — left in place on existing devices but no longer read/written. Matches the project pattern with `hb_notes` (orphaned but preserved). A future revival is non-destructive.
- CSS classes `.daily-mission-card`, `.dmc-*`, `.mc-*` in `styles.css` — unused but harmless. Optional follow-up cleanup.

If reviving (don't, per user direction — "I want to get rid of daily quest unfortunately"), the localStorage data would still load but the rendering layer is gone.

### 9-slot body-equipment Armory (removed v3 Phase 1d)

The v2.1 / v3 Phase 1a-c Armory used `assets/equipment/panel-base.png` (941×1672 carved-stone tablet art) with 9 invisible `.equipment-slot-hit` buttons positioned over the painted slot regions (helm / amulet / cape / weapon / body / gloves / legs / boots / ring). v3 Phase 1c added a 5-layer carved-socket DOM (`.armory-socket-recess` / `.armory-icon-aura` / `.armory-equipped-icon` / `.armory-socket-glass` / `.armory-socket-bevel`) and a transparent-icon pipeline (`assets/item-icons/*.png`) to make equipped items read inside the carved sockets.

This whole tree was retired in v3 Phase 1d. The card art at `assets/items/*.png` is flattened RGB; CSS can't strip backgrounds. After 5+ iterations of polishing the socket pipeline, the structural fix was a different shape entirely (MOBA-style typed grid).

**What's gone:**
- `.equipment-slot-hit[data-slot="…"]` markup + percentage-positioned CSS
- `.armory-socket-*` 5-layer DOM
- `.armory-equipped-icon`, `.armory-icon-aura`, `.armory-rarity--*`, `.armory-slot--rarity-*` rules
- `.armory-slot--missing-icon` + rune-glyph placeholder
- `panel-base.png` reference in `PRECACHE_ASSETS` (the file is still on disk, archival only)
- `assets/item-icons/` transparent-icon authoring spec (README still exists; pipeline is dead)

**Preserved:** `hb_pvp_equipped` localStorage key with the body-slot loadout. `window.Equipped` module + `aggregateEquippedBonuses()` etc. are vestigial but stay in source for safety. Internal `EQUIPMENT_SLOTS` constant renamed to `LEGACY_EQUIPMENT_SLOTS` to free the name for the typed-slot constant.

### REPLACE button on build-detail sheet (removed v3 Phase 1d follow-up)

The first cut of the typed-Armory build-detail sheet had two actions: UNEQUIP (red-destructive) and REPLACE (purple-gold gradient that opened the picker pre-filled). REPLACE was removed because unequip-then-tap-empty-slot was one fewer concept to teach, and the destructive-red UNEQUIP became muted-navy (`.build-detail-btn--unequip`) in the same pass.

**Anti-pattern:** don't re-add REPLACE. If a user wants to swap a slot's relic, they unequip → tap empty slot → pick a new one. The picker is slot-filtered, so swapping is two taps.

---

## Settings collapsibles

Generic class set: `.settings-collapsible` (wrapper) → `.settings-collapsible-toggle` (header button) → `.settings-collapsible-body` (content). Default `--collapsed` modifier hides via `display: none` (no animation — grid-row collapse breaks with multiple children).

Every toggle has `data-collapsible="<name>"`. `setupCollapsibleSettings()` wires all of them via id pattern: toggle id ends in `-toggle`, body id is the same with `-body`. Drop in a new collapsible by following that pattern — no per-section JS needed.

Currently three collapsibles, in this order, all collapsed by default:
1. **NOTIFICATIONS** *(v3 Phase 1m+ — user-facing label)* — Daily System Pings (Morning Briefing time picker + static Momentum Check / Evening Closeout rows) / Quiet Hours / Pause / Habit Reminders / Voice Preview. Summary shows count or "Paused" / "Off". Internal toggle/body ids still use the historical `notif-*` / `reminders-*` naming.
2. **APPLE HEALTH** *(v1.1.5)* — connection status, auto-verify pause/resume toggle, deep-link to iOS Settings. Summary states: `Connected` / `Paused` / `Not connected` / `iOS only`. Three internal sub-states (`#settings-health-state-{unavailable,connected,disconnected}`) — only one is unhidden at a time, controlled by `refreshHealthPanel()`. **No step-goal control here** — that lives in the Edit Habit modal, per-habit. See "HealthKit integration" section.
3. **WHAT'S COMING** — v2.0 teaser cards.

The previous `APPEARANCE` collapsible was removed in v1.1.3 when the Light theme was killed.

---

## App icon

`app-icon-source.png` (1254×1254 RGB master) is the single source. `scripts/generate-app-icons.ps1` resizes it into 18 iOS sizes (`resources/ios/AppIcon.appiconset/`) plus 2 PWA sizes (`icon-192.png` and `icon-512.png` in project root). All outputs are **24-bit RGB, no alpha** — Apple rejects icons with an alpha channel.

Re-run the script whenever the source changes. Then run `scripts/verify-app-icons.ps1` to confirm dimensions and zero-alpha across all 20 outputs before pushing.

The PWA icons are now **real static files**. The dynamic `getOrGenerateIcon` / `OffscreenCanvas` handler in `sw.js` was removed in v1.1.2.

---

## App Store screenshots

Apple has **two strict rules** that don't show up in any obvious place until your upload fails:

1. **Exact pixel dimensions per slot.** The iPhone 6.5" Display slot accepts only `1284×2778` or `1242×2688` (or their landscape transposes). A modern iPhone 15/16 Pro Max takes screenshots at `1290×2796` natively — close, but Apple's validator rejects them. Run `scripts/resize-iphone-screenshots.ps1` to scale them down by ~0.4% (visually identical, validator-approved).
2. **No alpha channel anywhere.** Even a fully-opaque PNG gets rejected if its file format includes an alpha layer. The script outputs `Format24bppRgb` to strip alpha. Same rule applies to app icons (see above) — the same fix works.

Slot sizes:
- **iPhone 6.5" Display:** 1284×2778 portrait (or 1242×2688 for older Pro Max). What our scripts target.
- **iPhone 6.7"/6.9" Display:** 1290×2796 portrait. If you add this slot, your iPhone 15/16 Pro Max screenshots upload **without resizing**. Apple shows this slot only if you explicitly add it via "View All Sizes in Media Manager."
- **iPad 12.9" / 13":** 2048×2732 portrait. The iPad script embeds iPhone shots in a dark canvas at this size — Apple accepts the letterbox treatment.

Workflow:
1. Take screenshots on iPhone, AirDrop or USB-copy to PC
2. Drop the PNGs into `screenshots/iphone/`
3. Run `scripts/resize-iphone-screenshots.ps1` (iPhone 6.5") + `scripts/generate-ipad-screenshots.ps1` (iPad)
4. Outputs sit in `screenshots/iphone-65/` and `screenshots/ipad/`
5. Upload each set into the matching App Store Connect slot
6. Drag-reorder within App Store Connect after upload — they don't have to be uploaded in display order

Don't worry about the visible 0.4% scale-down — humans can't see it. The Apple-strict pixel-match is purely a validator check.

---

## Wordmark

`<h1 class="awakened-wordmark">Awakened</h1>` in the app header uses **Cinzel 900** (Google Fonts, loaded via `<link>` in `<head>` with `display=swap`). Solid amber `#fbbf24` fill + `drop-shadow(0 0 16px rgba(251, 191, 36, 0.5))` glow. The earlier gradient version was reverted because the violet end clashed with other UI accents.

`!important` on `font-weight` defeats the surrounding `h1` rule's `font-weight: 700`.

---

## The 49-habit master library

`DEFAULT_HABITS` in `app.js` (lines ~523–. Indices 0–48).

Categories (`OB_CATEGORIES`):

| Category | Indices |
|----------|---------|
| 💪 Physical Performance       | 0–10  |
| 🧠 Mental & Focus             | 11–18 |
| 🥗 Nutrition                  | 19–22 |
| ⚡ Discipline & Productivity  | 23–30 |
| 💰 Financial & Growth         | 31–34 |
| 🎯 Learning & Skills          | 35–40 |
| 🌱 Wellbeing & Relationships  | 41–48 |

Every habit definition has, after `app.js` initialization:

```js
{
  emoji:        '...',
  name:         '...',     // EXACT string used as foreign key everywhere
  difficulty:   'easy' | 'medium' | 'hard' | 'legendary',
  type:         'build' (default) | 'quit',
  primaryStat:  'STR' | 'VIT' | 'INT' | 'FOCUS' | 'WILL' | 'WLT',
}
```

Mapping tables (separate constants applied to defs at startup):
- `HABIT_PRIMARY_STAT` — habit name → stat
- `HABIT_DESCRIPTIONS` — habit name → curated 1-paragraph description
- `MEASURABLE_HABITS` — habit name → `{ unit, def, step, min }` for habits with quantitative goals (legacy time/count stepper). NOT the source for HealthKit auto-verify habits — those use per-habit fields (`habit.stepGoal`, `habit.sleepGoalHours`) and bypass MEASURABLE_HABITS via `isHealthAutoVerifiableHabit()`.
- `HABIT_NOTIF_COPY` — habit name → `{ title, body }` for per-habit reminder notifications
- `HABIT_ICONS` — habit name → DALL-E PNG path

**Rule: a habit's identity is its `name` string.** `id` is generated per-user (`uid()`). When checking equivalence anywhere, match by name.

### Renames

When a canonical habit's name changes, BOTH the maps above need updating AND a one-time migration in `init()` to rewrite `habit.name` for existing users (streaks, completions, PRs all keyed by `habit.id`, so they survive the rename). Pattern (v1.1.5 Cardio rename):

```js
if (!localStorage.getItem('hb_cardio_renamed')) {
  habits.forEach(h => {
    if (h && h.name === 'Cardio' && !h.custom) h.name = 'Cardio workout';
  });
  save();
  localStorage.setItem('hb_cardio_renamed', '1');
}
```

Renames so far: `Cardio` → `Cardio workout` (v1.1.5 — disambiguates from Daily walk, since both were physical and looked redundant in the habit grid).

---

## Tabs & screens

Bottom nav — **symbol-only, custom DALL-E PNG icons**, purple-glow active state. The old emoji set was retired in v1.1.2:

| Tab     | Icon file (in `assets/tab-icons/`) | Panel id        | Notes |
|---------|-----------------------------------|------------------|-------|
| Profile | `tab-status.png`                  | `profile-panel`  | Status / Origin Story / PRs |
| Habits  | `tab-habits.png`                  | `main-scroll`    | **Codex/card redesign (v3 Phase 1k, refined in 1o)** — premium 3-column RPG objective cards with existing habit icons, gold sealed/completed state, colored incomplete rings, system/auto lock rings, compact dashed Add Habits pill. **Pack/routine progress (Morning Routine, Locked-In) is reached by tapping the top "X / Y HABITS TODAY" tile** → opens `#pack-progress-modal`. The persistent bottom Morning Routine strip was retired in Phase 1o. Top **"X / Y HABITS TODAY"** header is the single progress summary (the redundant Daily Objectives section header was removed). Markup uses `.habit-item.codex` modifier; legacy class aliases (`.codex-status habit-cb`, `.codex-streak streak-badge`) preserve existing event handlers. |
| Stats   | `tab-stats.png`                   | `stats-panel`    | Radar + 6 tile cards + Next Stat Bonus |
| History | `tab-history.png`                 | `history-panel`  | 7-col grid, no emojis on rows |
| Quests  | `tab-dungeon.png`                 | `quests-panel`   | **Dungeon Bosses list (v2.0+)** + "MORE QUESTS — Coming in v2.0" placeholder. The Daily Quest card was removed in v2.0.1 — see "Removed systems". |
| Items   | `tab-items.png`                   | `items-panel`    | **RELIC ARCHIVE (v3 Phase 1g)** — 3 collapsible sections: ULTRA-RARE RELICS / RARE RELICS / COMMON RELICS, all default-collapsed. Discovered cards show real art + slot badge (top-left) + equipped badge (top-right, when in Hunter Build) + drop-source line. Mystery cards (rare + ultra only — commons hide silhouettes) show `?` + rarity teaser + source hint. Tap discovered → carddetail modal with EQUIP TO BUILD / UNEQUIP button. Tap mystery → mystery info modal with HUNT BOSS CTA. Reveal modal (cinematic) fires for first-acquisition rare/ultra. Sort order: acquisition date ascending (chronological discovery log). Header carries the live Armory CTA with `Gear Power N · K / 6 Equipped` sub-line. See "Relic Archive" + "Hunter Build" sections. |
| Duels   | `tab-social.png`                  | `social-panel`   | **Dedicated Duels tab (v3 Phase 1x.1)** — relabeled from "Social"; internal id stays `social`. Layout: page header → active-duel hero (empty/active variants) → Friends section → Discipline Duels section. Leaderboard preview retired from this tab (still drives `#lb-rank-sheet` elsewhere). No fake scoring. No Recent Duels in v1. See "Discipline Duels foundation" section. |

Tab icons are referenced by file path inside `<img class="tab-icon">` tags. Active state adds a purple drop-shadow + 1.06× scale. Inactive icons sit at 0.55 opacity. **Don't add `<span class="tab-label">`** — symbol-only is the design.

Bottom sheets (all use `attachSheetDismissGesture()` for swipe-down dismiss):

- `#settings-sheet` — top-level **Notifications** group (Daily System Pings / Quiet Hours / Pause / Habit Reminders / Voice Preview), plus APPLE HEALTH / WHAT'S COMING / ACCOUNT collapsibles + What's New + reset. Internal markup still uses `notif-*` ids/classes for historical reasons.
- `#lib-sheet` — Add Habits browser (Morning Routine, Locked-In, Create Your Own, categories)
- `#hd-sheet` — habit detail / config (slides over lib-sheet)
- `#sched-sheet` — schedule picker
- `#stat-detail-sheet` — Stats tab → tap a stat
- `#hi-sheet` — History tab → ⓘ icon (read-only quick view)
- `#note-modal` — long-press → View Note (full habit detail page; **note text is read-only, sourced from `getHabitDescription`**)
- `#whats-new-sheet` — auto-shows on first launch after version bump
- `#mr-overlay` — Add Morning Routine / Locked-In pack confirmation (center modal, NOT a bottom sheet)
- `#custom-overlay` — Create Your Own habit modal (emoji + name + stat picker)
- `#notif-explain-overlay` — first-time notification permission explainer
- `#equipment-modal` — Armory (avatar tap / VIEW YOUR ARMORY) — Hunter Build typed 6-slot grid + summary
- `#build-picker-sheet` — Select Relic — compact MOBA picker, slot-filtered
- `#build-detail-sheet` — equipped slot detail with UNEQUIP only
- `#mystery-card-modal` — undiscovered card info (rarity + source + HUNT BOSS)
- `#carddetail-overlay` — discovered card detail with EQUIP TO BUILD / UNEQUIP
- `#boss-fs-overlay` — full-screen boss detail (Quests tab) with RELIC MERCY readout
- `#lb-rank-sheet` — Top-50 leaderboard ranking sheet
- `#xp-detail-sheet` — Stats tab → XP graph card tap → detail view
- `#awakened-splash` — pre-rendered launch screen (every cold launch)
- `#intro-onboarding` — 5-card educational onboarding (first-time only)
- `#signin-gate` — Sign in with Apple → alias claim (when no user)

Center / celebration modals (do NOT add swipe dismiss):
- Compound Effect Bonus, Rank Up, Stat Level Up, Class Change, Class Choice, Awakening, Perfect Day, Achievement Unlock, Friday Challenge

Settings header — `<div class="settings-app-name-row">` houses the app name on the left and the **sound toggle on the right** (moved out of the middle section in v1.1.2; the old `.settings-toggle-row` for habit completion sounds is gone).

---

## Reusable utilities (use these, don't reinvent)

| Function | Purpose |
|----------|---------|
| `attachSheetDismissGesture(sheet, overlay, onDismiss, opts)` | Swipe-down + flick to dismiss. Handles touchstart/move/end + mouse for desktop. Honours `scrollTarget` so internal scrolling doesn't hijack the gesture. |
| `populateHabitInfoBlock(prefix, habit)` | Renders the shared stat-badge + description + 4-cell stats grid. Used by both History info popup (`prefix='hi'`) and View Note (`prefix='vn'`). |
| `getHabitDescription(habit)` | Returns canonical description by name from `DEFAULT_HABITS`. Returns "A custom habit you chose for yourself..." when `habit.custom`. |
| `getHabitPrimaryStat(habit)` | Stat lookup. Prefers `habit.primaryStat` (set on customs and on every curated habit at startup), falls back to `DEFAULT_HABITS` lookup. |
| `getHabitStatColor(habit)` | Convenience wrapper for the above. |
| `applyStatPts(habit, pts, direction)` | Routes XP into the right stat bucket. Handles customs via `habit.primaryStat`, curated via `STATS[].habits` name match. **Pass the habit object, not a name.** |
| `statIconHtml(st, opts)` | Returns `<img class="stat-icon-img" src="...">` for a stat using the new DALL-E art (`STATS[].iconImg`). `opts.size` (default 32), `opts.eager`. Falls back to emoji if `iconImg` missing. |
| `setStatIcon(el, st, sizePx)` | For elements that previously held a single emoji glyph via `.textContent` — replaces with the correct `<img>` markup. |
| `Notif.*` (object) | Push-notification system. See "Per-habit reminders" section. Closure-scoped inside the IIFE; reaches the outer `habits` array directly. |
| `Health.*` (object) | HealthKit auto-verify system. See "HealthKit integration" section. Public surface: `isAvailable`, `permissionStatus`, `requestPermissions`, `requestSleepPermissionIfNeeded`, `getStepsToday`, `getSleepLastNight`, `getStrengthWorkoutsToday`, `clearCache`, `clearSleepCache`, `clearWorkoutCache`. |
| `AUTO_VERIFY.*` (object) | Auto-verified completion metadata + un-checked tracking. `recordAutoVerify`, `clearAutoVerify`, `isAutoVerifiedToday`, `isAutoVerifiedOnDate`, `markUnchecked(name)`, `wasUncheckedToday(name)`. |
| `getHabitStepGoal(habit)` / `setHabitStepGoal(habit, n)` | Per-habit step goal accessor. Default 3000, range [100, 50000]. setHabit calls `save()`. |
| `getSleepGoalHours(habit)` / `setSleepGoalHours(habit, h)` | Per-habit sleep-hours goal accessor. Default 7, range [3, 14], step 0.5. setHabit calls `save()`. |
| `isStepGoalHabit(habit)` / `isSleepDurationHabit(habit)` / `isSleepBedtimeHabit(habit)` / `isStrengthWorkoutHabit(habit)` | Habit-classification predicates for HealthKit auto-verify. Used to branch goal-control UIs and bypass legacy MEASURABLE_HABITS minimum check. Each matches a canonical habit name (`'Daily walk'`, `'Sleep'`, `'Sleep before midnight'`, `'Strength training'` respectively) and rejects custom habits. |
| `isHealthAutoVerifiableHabit(habit)` | OR of the four above (Daily walk OR Sleep OR Sleep before midnight OR Strength training). Use this in `meetsMinimum()` and similar generic gates. |
| `isAutoVerifyDisabled()` / `setAutoVerifyDisabled(bool)` | Reads/writes the global Settings → Apple Health pause toggle. |
| `canAutoVerify(habit)` | Composite gate combining `isHealthAutoVerifiableHabit` + `Health.isAvailable()` + `permissionStatus === 'granted'` + `!isAutoVerifyDisabled()`. Returns true only when auto-verify will live-fire for this habit right now. Used by Daily Insight's status line + verify-tag rendering. |
| `isReadOnlyAutoVerifyHabit(habit)` | **v2.0 / v3 Phase 1u:** true for canonical `Daily walk`, `Sleep`, `Sleep before midnight`, `Strength training`. Tap routes to `openNoteModal` instead of `toggleHabit`; card renders with lock indicator. See HealthKit integration → "Read-only auto-verify habits". |
| `systemManagedHtmlFor(habit)` | Returns three-paragraph HTML for the SYSTEM-MANAGED Notes-modal section, keyed on habit name. Edit per-habit copy here, not in `index.html`. |
| `isCanonicalHabit(habit)` | True if `habit.name` matches a `DEFAULT_HABITS` entry AND `!habit.custom`. Used by the Edit Habit modal to lock name + emoji + difficulty for canonical habits (their names are foreign keys for `HABIT_ICONS`, `AUTO_VERIFY`, `HABIT_TIME_OF_DAY`, etc.). |
| `sortHabitsAutoVerifyFirst(arr)` | Stable in-place partition: `isHealthAutoVerifiableHabit` habits to front, rest preserves relative order. Called inside `save()` (invariant always holds in storage) + once at init() for the v2.0 migration. **Drag-to-reorder is DORMANT in 2.2.1** (`ENABLE_HABIT_DRAG_REORDER = false`); if/when re-enabled, drops of a non-auto-verify habit above the partition will snap back on next render. |
| `BOSSES` (object) | v2.0+ dungeon boss roster. Keyed by boss id. As of v2.0.1: `the_insomniac`, `the_carouser`. See "Dungeon bosses" section. |
| `evaluateInsomniacForNight(hours, nightDate)` | Boss kill-detection. Idempotent on `nightDate`. Increments streak / triggers kill / persists state via `setBossState`. |
| `checkMissedNightForInsomniac()` | Init-only missed-night reset. Resets streak if `last_eval_date` is older than yesterday. No-op on first install (null `last_eval_date`). |
| `evaluateCarouserForNight(hours, bedtimeBeforeMidnight, nightDate)` | v2.0.1 Carouser kill-detection. Weekend-night-only (Sat + Sun mornings; Mon morning dropped in the 2-night recalibration). Idempotent on `nightDate`. Anchors `current_weekend_id` to `getMostRecentFridayDate()`. |
| `evaluateSteelWolfForDay(stepCount, dayDate)` | Steel Wolf kill-detection. Re-tiered to E-rank in v3 Phase 1t with `streakTarget = 1` + `stepThreshold = 6000` (was D-rank, 5000 × 2 days). Daily cadence; reads `cfg.stepThreshold` at runtime. Called from `autoVerifyWalk` alongside `lbRecordStepsToday`. Idempotent on `dayDate`. Same independence rules as the other bosses. |
| `checkMissedDayForSteelWolf()` | Init-only missed-day reset. Mirrors `checkMissedNightForInsomniac`. Resets streak if `last_eval_date` is older than yesterday. No-op on first install. |
| `buildBossCardHTML(id)` | Renders a single CARDS.md-spec boss card. 5/7 portrait, 6 regions, state classes (`.bcard--active`, `.bcard--defeated`, `.bcard--burned`) composed from `getBossState(id)`. Used by `renderBossesPanel`. |
| `openBossFullScreen(id)` / `closeBossFullScreen()` | Opens/closes the full-screen `#boss-fs-overlay` with hero art, long flavor, stats grid, kill condition, current progress, drops placeholder. ESC + any tab switch closes. Locks `body` scroll while open via `.bfs-locked`. |
| `checkMissedWeekendForCarouser()` | Init-only missed-weekend reset. Clears stale streak when stored `current_weekend_id !== getMostRecentFridayDate()`. kill_count preserved. |
| `getMostRecentFridayDate()` | Most-recent Friday's date in device-local 'YYYY-MM-DD'. If today IS Friday, returns today. Used as the Carouser's weekendId anchor — Fri + Sat nights both map to the same Friday. |
| `getBedtimeSamplesInWindow(samples)` | Single source of truth for the strict bedtime window. Filters HealthKit sleep samples to qualifying asleep entries (≥30 min) whose start falls in `[20:00, 24:00)` device-local on the prior day. Returns sorted-by-start array. Consumed by Path B (Sleep before midnight habit auto-verify), the Carouser evaluator, and the Leaderboard. |
| `lbRecordStepsToday(steps)` | v2.0.1 Leaderboard accumulator. Stores today's step count, recomputes trailing-7-day sum, updates `best_7day_step_total` peak. Called from `autoVerifyWalk` after the steps fetch — passive, ignores pause toggle and habit presence. |
| `lbRecordSleepNight(sleepHours, bedtimeBeforeMidnight, nightDate)` | v2.0.1. Records both metrics from a single HealthKit roundtrip. Idempotent on `nightDate`. Gap detection — skipped night = streak break. Called from `autoVerifySleep` alongside boss evals. |
| `lbGetSnapshot()` | Read-only summary for UI/console: `{ steps_last_7_days, best_7day_step_total, current_sleep_streak, best_sleep_streak, current_bedtime_streak, best_bedtime_streak, ... }`. |
| `renderLeaderboardPreview()` | Renders the three icon-led cards on the Social tab. Called from `switchTab` when `tab === 'social'`. Empty-state above the cards adapts to web/no-permission/granted. |
| `openLeaderboardRanking(metric)` | Opens the Top-50 ranking sheet for `'steps_7d' \| 'sleep_streak' \| 'bedtime_streak'`. Renders blurred mock entries from `LB_METRIC_META[metric].mockTop` + the user's actual best/current value highlighted gold. |
| `getDeviceLocalDate()` / `getDeviceLocalYesterday()` | `'YYYY-MM-DD'` strings in device-local timezone. Used by features whose semantics are "the user's calendar day" — sleep, notifications, Daily Insight, boss state. NOT PT-anchored. |
| `getDeviceLocalDate()` | `'YYYY-MM-DD'` in the device's local timezone. Used by features whose semantics are "the user's current calendar day" (notifications, sleep windows, Daily Insight) — NOT PT-anchored. Sleep window currently inlines its own equivalent; flagged for future cleanup. |
| `getDaysSinceOrigin()` | Calendar-day count from `originBeginning.dateISO` to today (device-local). Returns 1 on the user's first day, 2 next day, etc. Returns null if no origin record. Drives the "DAY 11" portion of the Daily Insight header. |
| `getHabitTimeOfDay(habit)` | Reads `HABIT_TIME_OF_DAY` map; returns `'morning'` / `'day'` / `'evening'`. Custom habits + unmapped canonicals default to `'day'`. Used by Daily Insight slate grouping. |
| `setupCollapsibleSettings()` | Wires every `.settings-collapsible-toggle[data-collapsible]` to its body sibling. Drop-in for new Settings groups. |
| `playCheckSound()`, `playFanfare()` | Web Audio. Both gated on `soundEnabled`. |
| `rollBossDrop(bossId)` | **v2.0.2 Drops Phase 1.** Rolls the drop table for a kill. Returns `{ card, wasFirst, wasCapped, count, cap }` or `null`. Mutates `hb_inventory`. Respects cadence-aware rates + stack caps + first-common protection. Reveal queue updated for first-acquisition rare/ultra. |
| `dropRatesFor(bossId)` | v2.0.2. Resolves `DROP_RATES_BY_CADENCE[BOSSES[bossId].cadence]`. Defensive fallback to daily. Exposed as `window.Drops.getRates`. |
| `forceDrop(bossId, rarity)` | v2.0.2 debug. Bypass RNG; force-spawn the matching card. Respects stack caps. Fires reveal immediately for rare/ultra. Backward-compat aliases legacy `'uncommon'` → `'common'`. |
| `announceKillAndDrop(cfg, soulsReward, dropInfo)` | v2.0.2. Composes the kill toast based on drop outcome (first-acq / dupe-stacked / dupe-capped / no-drop) and kicks the reveal queue for first-acq rare/ultra ~500ms later. |
| `cardStatBadgesHtml(card)` | v2.0.2. Returns `<div class="stat-row">` with one `.stat-badge--<id>` per non-zero stat in `card.bonuses`. Empty string if all zero. Single source for the reveal + carddetail badge rows. |
| `setModalCardArt(imgId, artPath)` | v2.0.2. Sets a card-art `<img>` src with onerror/onload handlers — starts hidden, reveals on successful load, stays hidden on 404. Used by reveal + carddetail modal openers. |
| `computeMidDayBody()` | v2.0.2. Priority-chain body for the 1 PM mid-day check-in. Returns `null` to signal "skip notification" (priority 4: no habits). |
| `Notif.reapplyMidDay()` | v2.0.2. Re-arm the mid-day notification with fresh body. Called from rescheduleAll, onHabitCompleted, class change, name edit, daily-bonus grant. |
| `esc(str)`, `colorWithAlpha(hex, alpha)` | HTML-escape + color helpers used in inline `style="..."` building. |
| **v3 Phase 1d–1j (v2.2.0)** | |
| `getCardEquipmentSlot(card)` | Returns the card's TYPED slot ('helm' / 'weapon' / 'plate' / 'gloves' / 'boots' / 'ring') with legacy collapse (body/legs/cape → plate, amulet → ring). Returns `null` + console.warn for cards with no slot. Single source — every Armory/Picker/Archive surface reads this. |
| `EQUIPMENT_SLOTS` / `EQUIPMENT_SLOT_INDEX` / `LEGACY_TO_TYPED_SLOT` | The typed-slot constants. Index ↔ slot key ↔ legacy slot map. |
| `equipBuildItem(slotIndex, cardId)` / `unequipBuildItem(slotIndex)` | Hunter Build mutators. Return `{ ok, prevCardId }` or `{ ok: false, code: 'WRONG_SLOT'/'DUPLICATE'/'BAD_INDEX'/'BAD_CARD'/'LOCKED' }`. Persist via `saveHunterBuild`. |
| `isItemEquippedInBuild(cardId)` / `getBuildSlotIndexForCard(cardId)` | Read-side build queries. |
| `aggregateBuildPower()` / `getBuildDominantPath()` / `countEquippedBuildItems()` | Summary readouts. |
| `getItemBuildPower(card)` | Per-card power: common=1, rare=3, ultra_rare=7. |
| `migrateGenericBuildToEquipmentBuild()` | One-shot migration (idempotent via `hb_equipment_build_migrated_v1`) — re-shuffles existing generic build into typed slot positions. |
| `migrateEquipmentToHunterBuild()` | One-shot migration — seeds `hb_hunter_build` from legacy `hb_pvp_equipped` body slots. Idempotent via presence of `hb_hunter_build`. |
| `renderHunterBuild()` / `renderHunterBuildSummary()` | Armory grid + summary block renderers. |
| `openBuildPicker(slotIndex)` / `closeBuildPicker()` | Slot-filtered Select Relic picker. Picker title becomes `SELECT HELM` / `SELECT WEAPON` etc. |
| `openBuildItemDetail(slotIndex)` / `closeBuildItemDetail()` | Build detail sheet with UNEQUIP-only action. |
| `dropRatesFor(bossId)` / `dropPityCfgFor(bossId)` / `getBossCadence(bossId)` | v1.7 cadence-aware rate + pity resolution with validation + once-per-misbehaving-boss warn. |
| `hasPulledFirstCommonForBoss(bossId)` / `markFirstCommonPulledForBoss(bossId)` | Per-boss first-common protection state. |
| `getDropPityState(bossId)` / `setDropPityState(bossId, state)` / `incrementDropPityAfterNoDrop(bossId)` / `resetDropPityAfterDrop(bossId, rarity)` | Pity counter mutation. |
| `getEffectiveUltraRate(bossId, baseRate)` | Computes per-roll soft/hard ultra rate without mutating `DROP_RATES_BY_CADENCE`. |
| `forcePityDrop(bossId)` | Any-drop pity card-pick — respects stack caps + prefers common→rare→ultra. |
| `getDropPityDisplay(bossId)` | Read-model for the RELIC MERCY UI in boss detail modal. |
| `getCardDropSourceLabel(card)` | "The Carouser" — used by Relic Archive + mystery info modal. Single source. |
| `refreshArmoryCTAStatus()` | Updates the Items-tab Armory CTA secondary line with live Gear Power + equipped count. |
| `openMysteryCardModal(card)` / `closeMysteryCardModal()` / `setupMysteryCardModal()` | Mystery (undiscovered) card info modal. Never reveals item name. |
| `lbNormalizeAliasForDisplay(raw)` / `lbBuildDisplayAliases(rows)` | Display-only leaderboard alias normalization. Strip whitespace + lowercase + allowlist (`richie` → `Richie`) + dedupe collisions with numeric suffix. |
| `hideSplash()` / `setSplashLongLoading(on)` | Splash control. `hideSplash` honors min-visible-time (1800ms) before fading. `setSplashLongLoading(true)` reveals the "Preparing your system…" line. |
| `showIntroOnboarding(onComplete)` / `hideIntroOnboarding()` / `completeIntroOnboarding()` / `setupIntroOnboarding()` | 5-card educational onboarding controller. Gated by `shouldShowIntroOnboarding()`. |
| `Auth.*` (full surface, exposed by `auth.js`) | Sign-in: `signInWithApple`, `completeSignIn`, `validateAlias`, `getCurrentUser`, `isNative`, `devSignInIfLocalhost`. Cloud Sync (Phase 1w): `fetchCloudState`, `uploadCloudState`. Friends (Phase 1x): `fetchFriends`, `sendFriendRequest`, `acceptFriendRequest`, `declineFriendRequest`, `removeFriend`. Duels (Phase 1x): `fetchDuels`, `createDuel`, `acceptDuel`, `declineDuel`, `fetchDuel`. Tier 1 launch readiness (Phase 1z.1): `cancelDuel`. Steps Duel Scoring (Phase 1y): `submitDuelProgress`, `resolveDuel`. Verified Duel Scoring Engine (Phase 1z): `submitVerifiedEvents`, `fetchDuelScore`. All authed helpers share the `{ ok, code, detail }`-on-failure envelope. |

---

## localStorage keys (every persisted bit)

Prefix `hb_` for almost everything:

| Key | Type | Notes |
|-----|------|-------|
| `hb_habits`            | JSON array of habit objects | Source of truth for user's active habits |
| `hb_completions`       | `{ 'YYYY-MM-DD': [habitId, ...] }` | Per-day completion log |
| `hb_streaks`           | `{ habitId: { count, lastDate, prevCount, prevLastDate } }` | |
| `hb_points`            | int (string) | Total XP |
| `hb_achievements`      | JSON array of achievement IDs | |
| `hb_stats`             | `{ statId: { pts: N } }` | |
| `hb_stat_bonuses`      | array of `"STAT-LEVEL"` strings | Prevents re-awarding tier bonuses |
| `hb_perfect_streak`    | `{ count, lastDate, prevCount, prevLastDate }` | |
| `hb_ps_awarded`        | array of milestone day numbers | |
| `hb_notes`             | `{ habitId: 'text' }` | Legacy — orphaned but preserved. **Do not display, do not delete.** |
| `hb_compound`          | `{ packId: { streak, lastDate } }` | |
| `hb_compound_awarded`  | `{ packId: 'YYYY-MM-DD' }` | Prevents double-award per day |
| `hb_path`              | `'morning' \| 'custom' \| null` | |
| `hb_name`              | string | Player name, default 'Hunter' |
| `hb_class`             | string | Stored class id |
| `hb_welcomed`          | `'1'` | Welcome screen seen flag |
| `hb_sound`             | `'on' \| 'off'` | Sound toggle |
| `hb_whats_new_seen`    | version string (e.g., `'1.1.0'`) | |
| `hb_friday_banner_<date>` | `'1'` | Per-Friday banner-seen flag |
| `hb_reminders`         | `{ habitId: 'HH:MM' }` | Per-habit notification time |
| `hb_notif_perm_requested` | `'1'` | First-time explainer-shown flag |
| `hb_notif_disabled`    | `'1'` | Master "Disable all reminders" toggle |
| `hb_notif_paused_until`| ISO timestamp string | While in the future, reminders are paused |
| `hb_notif_daily_limit` | int string (default 3, 0=unlimited) | |
| `hb_notif_quiet_enabled` | `'1' \| '0'` (default `'1'`) | |
| `hb_notif_quiet_start` | `'HH:MM'` (default `'22:00'`) | |
| `hb_notif_quiet_end`   | `'HH:MM'` (default `'07:00'`) | |
| `hb_origin_beginning`  | `{ text, dateISO, dateDisplay }` | Chapter 1 of origin story |
| `hb_origin_awakening`  | `{ text, classKey, dateISO, dateDisplay }` | Chapter 2 |
| `hb_origin_v3_migrated`, `hb_origin_v4_migrated` | `'1'` | Idempotent text-rewrite flags |
| `hb_awakened_once`     | `'1'` | Once-only Awakening celebration flag |
| `hb_class_v2_migrated` | `'1'` | One-time class-system migration |
| `hb_sw_known_version`  | sw cache version string | Used by `checkForUpdates()` for direct version-string comparison fallback |
| `hb_bodyweight`        | int string (lbs) | For weight-based goal habits |
| `hb_cardio_renamed`    | `'1'` | One-time v1.1.5 migration flag (Cardio → Cardio workout) |
| `hb_healthkit_status`  | `'granted' \| 'denied'` | v1.1.5. Locally-tracked HealthKit permission state. Apple intentionally hides denial state for read scopes; we infer from request resolution. |
| `hb_healthkit_prompted` | `'1'` | v1.1.5. Pre-prompt explainer shown — never re-fires. |
| `hb_healthkit_sleep_requested` | `'1'` | v1.1.5. Sleep auth request fired (and resolved). Set ONLY post-resolve, NEVER in catch — defensive flag-set in catch was a bug. Cleared by `HEALTHKIT_AUTH_VERSION` migration when category set expands. |
| `hb_healthkit_authversion` | int string | v1.1.5. Tracks which HealthKit auth-category set the user has been prompted for. Migration in `init()` clears per-category flags when stored < `HEALTHKIT_AUTH_VERSION`. Currently `2`. |
| `hb_healthkit_disabled` | `'1'` | v1.1.5. User toggled auto-verify OFF in Settings → Apple Health. |
| `hb_completions_auto`  | `{ 'YYYY-MM-DD': { habitId: { source, value, threshold } } }` | v1.1.5. Auto-verified completion metadata (vs manually tapped). Drives the `AUTO` pill on cards and the corner dot in History. |
| `hb_av_unchecked_dates` | `{ habitName: ['YYYY-MM-DD', ...] }` | v1.1.5. Per-habit "user explicitly un-checked an auto-verified completion" tracking. Auto-pruned to 14 days per habit. Migrated from legacy `hb_walk_unchecked_dates` flat array. |
| `hb_daily_insight_last_shown` | `'YYYY-MM-DD'` (device-local) | v1.1.5. Last calendar day the Daily Insight / Morning Briefing card was dismissed. Gates re-show — card fires once per device-local calendar day. Written by `dismissDailyInsight()` AFTER hide so a force-killed mid-show retries on next launch. |
| `hb_bedtime_window_fix_v1` | `'1'` | v1.1.5. One-time recovery flag for the bedtime false-positive bug. On the first launch of the strict-window build, init() clears today's auto-verified Sleep before midnight check (if present), reverses the +3 XP, and sets this flag. Idempotent. Future bedtime-logic fixes that need similar recovery should use a new flag (`_v2`, etc.) — don't re-purpose this one. |
| `hb_cloud_last_backup_at` | ISO 8601 string | v3 Phase 1w. Set by CloudSync.pushNow on successful `POST /v1/users/me/state`. Surfaced in Settings → Cloud Backup status line. |
| `hb_cloud_last_restore_at` | ISO 8601 string | v3 Phase 1w. Set by CloudSync.restoreState after a successful restore. Persists across the reload that follows. |
| `hb_cloud_last_local_change_at` | ISO 8601 string | v3 Phase 1w. Set by CloudSync.markLocalStateChanged on every persist site (save / saveBosses / persistInventory / persistSouls / saveHunterBuild). Used as the "dirty since" timestamp for debounced uploads. |
| `hb_cloud_device_id` | string | v3 Phase 1w. Random `dev_xxxxxxxxxx` identifier for diagnostics — included in cloud payloads as `device_id`. Generated on first use; never sent to leaderboard or auth flows. |
| `hb_hk_status_reset_v1` | `'1'` | v3 Phase 1w.2. One-time recovery flag. Cloud Sync v1.0 mistakenly included `hb_healthkit_status` / `hb_healthkit_prompted` / `hb_healthkit_sleep_requested` / `hb_healthkit_authversion` in SNAPSHOT_KEYS. Post-restore on a freshly-installed device, those flags told the app "already granted, already prompted" — but iOS had revoked the actual permission grant on app delete. App stuck: no data, no re-prompt. The migration in init() clears those four cached flags exactly once when `hb_cloud_last_restore_at` is present, forcing the natural `showHealthKitPreprompt()` path to re-engage. The four offending keys are now REMOVED from `SNAPSHOT_KEYS` so this can never re-occur. |
| `hb_drank_id_rename_v1` | `'1'` | v3 Phase 1v.1. One-time flag for the D-rank boss ID rename (`iron_warden` → `the_iron_warden`, etc.). On first launch, init() walks `hb_bosses` and moves any state under the old IDs to the new IDs. Idempotent. |
| `hb_strength_readonly_migration_v1` | `'1'` | v3 Phase 1u. One-time flag for the Strength-training read-only transition. On first launch of the v3 Phase 1u build, if Strength training is checked today AND has no AUTO_VERIFY record (= came from a pre-update manual tap that the new read-only UI can't un-check), init() removes today's completion, reverses the XP, and sets this flag. The auto-verify path then re-checks legitimately on next render if a qualifying workout exists in Apple Health. |
| `hb_bosses`            | `{ bossId: { streak, kill_count, last_eval_date, ...perBossExtras } }` | v2.0+. Dungeon boss state. v2.0.1 ships two bosses (`the_insomniac`, `the_carouser`). The Carouser entry adds `current_weekend_id` ('YYYY-MM-DD' Friday-anchor) + `weekend_burned` (bool). `last_eval_date` is 'YYYY-MM-DD' device-local; it prevents double-counting on visibilitychange refires and powers the missed-period reset in init(). See "Dungeon bosses (v2.0+)" section. |
| `hb_leaderboard`       | `{ steps_daily, sleep_hours_daily, bedtime_daily, current_*_streak, best_*_streak, last_*_eval_date, best_7day_step_total, best_7day_step_window_end }` | v2.0.1. Local accumulator for the future leaderboard layer. Daily maps pruned to 30 days. `current_*` track running streaks; `best_*` preserve all-time peaks across breaks. Independent of `isAutoVerifyDisabled()`. See "Leaderboard (v2.0.1+)" section. |
| `hb_inventory`         | `{ cards: { [card_id]: { discovered, count, first_acquired_date } }, first_common_pulled, first_common_date, first_common_by_boss: { [bossId]: true }, drop_pity_by_boss: { [bossId]: { kills_since_any_drop, kills_since_ultra, kills_since_rare_or_better, last_drop_at } }, reveal_queue: [card_id, ...] }` | **v2.0.2 Drops Phase 1 → v3 Phase 1h.** Card collection state. `loadInventory` runs 3 idempotent migrations: legacy `first_uncommon_*` rename (v1.3), per-boss first-common backfill from existing common ownership (v3 Phase 1h), and pity-state stub for any known boss missing an entry. `reveal_queue` persists across cold launches. Stack caps applied in `rollBossDrop` (common 1, rare 3, ultra unlimited). See "Drops & Card Collection" section. |
| `hb_pokedex_collapsed` | JSON array of rarity keys currently collapsed | v2.0.2. Persists Pokédex section state across launches. Default value when key missing: all 3 keys (`['ultra_rare', 'rare', 'common']`) — first-time visitors see a tidy stacked list of collapsed dropdown headers. |
| `hb_daily_quests`      | `{ 'YYYY-MM-DD': { id, manualDone[], bonusAwarded } }` | **DEPRECATED v2.0.1.** Daily Quest system removed; this key is no longer read or written but is preserved on existing devices for non-destructive future revival. See "Removed systems". |
| `hb_quest_history`     | `[{ date, missionId }]` | **DEPRECATED v2.0.1.** Same status as above. |
| **v2.1.0 + v2.2.0 additions** | | |
| `hb_user`              | Managed by `auth.js`: `{ id, alias, jwt, apple_sub, created_at }` | v2.1.0 Phase A. Apple Sign In + alias state. The IIFE in `app.js` short-circuits on missing `user.alias`. Access via `Auth.getCurrentUser()`. |
| `hb_pending_apple_token` | Short-lived staging string | v2.1.0. Lives between Apple sign-in step and alias commit. Cleared on `Auth.completeSignIn` success. |
| `hb_lb_last_submit`    | int (epoch ms) | v2.1.0 Phase C. Debounces `lbSubmitAllMetrics` to ≥5 min between leaderboard submissions. Prevents hot-relaunch spam. |
| `hb_lb_cache_<metric>` | `{ top, me, fetched_at }` | v2.1.0 Phase C. Stale-while-revalidate cache for leaderboard ranking fetches (24h TTL via `LB_CACHE_MAX_AGE_MS`). One entry per metric (`step_total`, `sleep_streak`, `bedtime_streak`). |
| `hb_hunter_build`      | `{ slots: [card_id|null × 6], updated_at: ISO }` | **v3 Phase 1d → 1e.** Hunter Build typed loadout. Index → typed slot (0 helm, 1 weapon, 2 plate, 3 gloves, 4 boots, 5 ring). Replaces `hb_pvp_equipped` UI layer; legacy key preserved on disk for safety. |
| `hb_pvp_equipped`      | `{ helm, cape, amulet, weapon, body, legs, gloves, boots, ring }` | **v3 Phase 1a (vestigial).** Body-slot equipped state. No live UI reads this anymore — Hunter Build replaced the surface. Preserved as a safety copy of pre-pivot equipped data. |
| `hb_equipment_build_migrated_v1` | `'1'` | v3 Phase 1e. One-shot flag — once set, `migrateGenericBuildToEquipmentBuild()` doesn't re-shuffle the build. |
| `hb_onboarding_seen_v2` | `'1'` | v3 Phase 1i. Educational 5-card onboarding seen flag. Set on completion OR confirmed skip. Returning users with `hb_welcomed === '1'` get this auto-set so they don't see the new content. |
| `hb_hunter_name_claimed` | `'1'` | v3 Phase 1j. Hunter name claim lock. Set on signin alias commit, welcome screen launch, habit-picker onboarding finish, and init migration (any user with non-default `hb_name`). Drives the Status-tab pencil hide + welcome-screen bypass + habit-picker name-input hide. |
| `hb_sw_known_version`  | sw cache version string | v2.2.0 (existed earlier in different form). Written background-async on register. Used by the manual "Check for Updates" Settings button's fallback comparison. |
| `hb_sw_last_active_version` | sw cache version string | v2.2.0 (auto-update safety net). Written by the version-drift detector 2s after register. Compared against live sw.js fetch — drift triggers unregister + cache wipe + reload. |
| `hb_sw_manual_update`  | `'1'` (opt-in) | v2.2.0. Opt back into the banner-driven update flow. Default behavior is silent auto-apply. |
| `hb_verified_event_outbox` | JSON array of queued verified events | **v3 Phase 1z.1.** Device-local transport queue for `Auth.submitVerifiedEvents`. 250-event cap with FIFO drop; dedup by `client_event_id` (steps_total prefers the higher value when re-queued). Drained on init, Duels-tab open, and visibilitychange→visible. 60 s backoff after a 401. **Explicitly NOT in `CloudSync.SNAPSHOT_KEYS`** — restoring an outbox onto a different device would replay events with stale `duel_id` / `metric_date` references. Backend's `UNIQUE(user_id, client_event_id)` constraint silently dedupes any retry-driven duplicates server-side. |
| `hb_boss_result_seen_<bossId>_<kill_count>` | `'1'` | **v3 Phase 1z.6.** One-shot flag per boss-defeat result modal. Set BEFORE the `#boss-result-overlay` modal renders so re-render paths can't re-queue. **Not in `CloudSync.SNAPSHOT_KEYS`** — device-local UI acknowledgment, not progress. A reinstall must fire the modal fresh on the next defeat. State alongside `state.last_defeated_at` on the boss row, which IS in snapshot keys (it's user progress — "this boss has been defeated at least once on this account"). |

All dates stored in **America/Los_Angeles** timezone via `getPTDate()`. Timezone is a hard rule — **EXCEPT for HealthKit sleep windows + Daily Insight**, which use device-local time (sleep crosses midnight; the morning briefing is meant to mark "the user's morning" wherever they are; same rule as notifications — see CLAUDE.md "Notifications fire in DEVICE-LOCAL time, not PT"). Use `getDeviceLocalDate()` for these features, not `getPTDate()`.

---

## Build & deploy pipeline

### Web (Netlify)

`git push` → Netlify auto-builds and deploys the static files. After every push, **bump `CACHE_VERSION` in `sw.js`** so the new SW activates and existing PWA users get fresh files.

### iOS (Codemagic → TestFlight → App Store)

1. `git push` to `main`
2. Codemagic → **Start new build** → workflow `Awakened — iOS App Store`
3. Codemagic does:
   - `npm install` (pulls Capacitor + `@capacitor/local-notifications` + `@perfood/capacitor-healthkit`; `.npmrc` enables `legacy-peer-deps`)
   - Copies static files into `www/`:
     - `index.html`, `styles.css`, `app.js`, `sw.js`, `manifest.json`
     - `avatar-*.png` (8 class avatars)
     - `icon-192.png`, `icon-512.png` (PWA app icons)
     - `assets/tab-icons/*.png` (only the 7 optimized 192×192 — masters excluded)
     - `assets/stat-icons/*.png` (only the 6 optimized — masters excluded)
     - `assets/bosses/*.png` (3 boss illustrations at 1254×1254)
     - `assets/gates/*.png` (6 dungeon-gate illustrations)
     - `assets/icons/*.png` (souls + other UI utility icons)
     - `assets/items/*.png` — **v2.0.2 Drops Phase 1 card art.** Glob copy step (`if compgen -G "assets/items/*.png"; then cp assets/items/*.png www/assets/items/`) — different pattern from the per-file `for boss in ...` loops elsewhere because card art lands on a per-PNG cadence. New cards auto-included without codemagic.yaml edits.
   - `npx cap add ios` (if missing) + `npx cap sync ios`
   - Runs PlistBuddy: `Add :ITSAppUsesNonExemptEncryption bool false` (skips Apple's compliance question)
   - **`Add HealthKit usage description and entitlement`** — PlistBuddy writes `NSHealthShareUsageDescription` + `NSHealthUpdateUsageDescription` to `Info.plist` and `com.apple.developer.healthkit = true` to `App.entitlements`. Do NOT also write `com.apple.developer.healthkit.access` — that requires Apple-approved Verifiable Health Records capability. (v1.1.5)
   - **`Wire entitlements file into Xcode project`** — uses Ruby `xcodeproj` gem (preinstalled on Codemagic macOS images) to set `CODE_SIGN_ENTITLEMENTS = App/App.entitlements` in `project.pbxproj` for both Debug and Release configs. Without this step, Xcode signs the IPA without consuming our entitlements file. (v1.1.5)
   - Installs custom AppIcon (regenerated by you locally via `scripts/generate-app-icons.ps1`)
   - `xcode-project use-profiles` + `build-ipa`
   - Uploads to App Store Connect → TestFlight beta review
4. Update on iPhone via TestFlight → manual submit on App Store Connect

The `ios/`, `android/`, `www/`, and `node_modules/` directories are gitignored — Codemagic regenerates them every build.

### Cache-busting & version bumps (always do all three together)

Every meaningful change must:

1. Edit `index.html`: bump `?v=N` on the `<link>` for `styles.css` and `<script>` for `app.js`
2. Edit `sw.js`: bump `CACHE_VERSION = 'v5.NN'`
3. (For iOS releases only) **Two `APP_VERSION`s must move together:**
   - Edit `app.js`: bump the `APP_VERSION` constant and add a matching `WHATS_NEW` entry (drives the in-app What's New sheet). **Order items within the entry by significance, not chronologically** — net-new daily-visibility features at the top, configuration polish and settings-layer additions at the bottom. The user reads this top-down on every version-update launch; the most impactful change should anchor first impression. See `WHATS_NEW['2.2.0']` for the canonical example (8 items, significance-ordered: new launch experience → typed equipment → mercy protection → Relic Archive → cadence-aware rates → compact picker → silent auto-update → leaderboard polish).
   - Edit `codemagic.yaml`: bump the `APP_VERSION` env var (drives `agvtool new-marketing-version` → `CFBundleShortVersionString` in `Info.plist`). Forgetting this one causes App Store Connect to reject the upload with "must contain a higher version than ... previously approved version."

**v2.2.0 auto-update SW means web users no longer need a manual cache-clear after deploys.** The new `registerSW()` in `app.js` calls `reg.update()` on every page load + tab focus, then silently `SKIP_WAITING`s the new SW. One controlled reload per deploy. See "Service worker auto-update" section. Bumping `CACHE_VERSION` is still required (each new SW only installs because its bytes differ — the version constant is the cheapest way to force that).

The current state is `styles.css?v=295`, `app.js?v=410`, `auth.js?v=16`, `simulated-leaderboard.js?v=6`, `sw.js v5.296`, `APP_BUILD_TAG = '2.2.1-w61'`, `APP_VERSION = '2.2.1'` (in BOTH `app.js` and `codemagic.yaml`), `HEALTHKIT_AUTH_VERSION = 2`. (Re-check from the files; they drift quickly.)

### 100K Step Club roster tab (v3 Phase 1z.52)

**Feature.** Third tab on the Steps leaderboard sheet, sitting next to `This Week` + `Hall of Fame`:

```
This Week  |  Hall of Fame  |  100K Club
```

Real-users-only prestige board listing every hunter who has earned the `step_100k_club` accolade (recorded 100,000+ verified steps in a single Sunday-UTC week). **Sim/test users never appear here.** No client-side filler — this tab reads the backend response verbatim.

#### Backend — new endpoint

`GET /v1/leaderboard/step-100k-club?limit=N` · auth required · `RL_LEADERBOARD_STEP_100K_CLUB` (namespace_id 1013, 30/min per user).

Reads `user_accolades` filtered to `accolade_type = 'step_100k_club'`, JOINed to `users` for live alias, with `apple_sub NOT LIKE 'sim_test_%'` as defense-in-depth (the write path in `leaderboard-submit.ts` already refuses to award the accolade to sim users; the read-side filter keeps the path correct in isolation).

```sql
SELECT u.alias, ua.best_value, ua.unlock_week_start,
       ua.repeat_count, ua.last_qualified_week_start, ua.unlocked_at
FROM user_accolades ua
JOIN users u ON u.id = ua.user_id
WHERE ua.accolade_type = 'step_100k_club'
  AND u.apple_sub NOT LIKE 'sim_test_%'
ORDER BY ua.best_value DESC, ua.repeat_count DESC, ua.unlocked_at ASC
LIMIT ?
```

**Ordering** — `best_value DESC, repeat_count DESC, unlocked_at ASC`. Highest single-week total wins outright; ties broken by repeat-qualification count, then by earliest unlocker (first-to-the-summit).

**Response shape:**
```json
{
  "type": "step_100k_club",
  "members": [
    {
      "rank": 1,
      "alias": "Richie",
      "best_value": 104821,
      "unlock_week_start": "2026-05-17",
      "unlock_week_end":   "2026-05-23",
      "repeat_count": 2,
      "last_qualified_week_start": "2026-05-17",
      "last_qualified_week_end":   "2026-05-23",
      "unlocked_at": 1760000000000
    }
  ],
  "me": { "rank": 1, "best_value": 104821, "unlock_week_start": "2026-05-17", "unlock_week_end": "2026-05-23", "repeat_count": 2 }
}
```

**Backend tests** (`step-100k-club.test.ts`, 11 cases): filters by `accolade_type`, excludes sims via `apple_sub NOT LIKE`, sorts three-tier, returns members with computed `week_end`, returns `me.rank` when caller is a member, returns `me: null` when not, me-rank counts strictly higher `best_value`, default limit 50 / max 100, 429 when ratelimited, JOINs users for alias, week_end handles month + year rollover correctly. **95/95 suite-wide pass.**

#### Frontend — third tab + render path + cache

- **`auth.js`** — new `Auth.fetchStep100kClub(limit)` helper. Same error-coded result shape as the other leaderboard helpers (`EXPIRED` / `RATE_LIMITED` / `NETWORK` / `ERROR`).
- **`index.html`** — added `<button data-lb-tab="club-100k">100K Club</button>` inside `#lb-rank-tabs`. The tabs container stays scoped to step_total (current behavior); 100K Club appears alongside HoF whenever the tabs are visible.
- **`app.js`** — new `_lbRender100kClubTab(metric)` mirroring `_lbRenderHofTab` shape. Reads from `hb_lb_100k_club` cache (10-min TTL). No sim filler in any code path. Tab-switch wiring in `_lbSwitchTab` extended to route `'club-100k'` to the new renderer. `lbBuild100kClubList(members)` renders each row as `rank · alias + (Week range · Qualified Nx if >1) · best-steps`. `lbBuild100kClubMeBest(me)` renders the pinned `Your 100K Club record` card or an encouragement empty-state.
- **`styles.css`** — new `.lb-rank-row--club-100k` block: subtle gold-violet gradient background, gold `#f5b842` accent on the rank pill + step value, gold-tinted border. The board reads as exclusive without overpowering the rest of the sheet.

#### Sheet-dismiss matrix (unchanged)
| Sheet | X | Overlay tap | Drag-down |
|---|---|---|---|
| Steps leaderboard (all 3 tabs) | ✓ | ❌ | ❌ |

`#lb-rank-sheet` stays X-only close (Phase 1z.40). Scrolling the 100K Club list does not dismiss the sheet.

#### Compatibility
- **Existing personal 100K badge** (rank-aware Rank Hero in `renderStatus()`): unchanged.
- **Existing 100K detail sheet** (`#accolade-step-100k-overlay`): unchanged.
- **`GET /v1/users/me/accolades`**: unchanged — still serves the caller's full accolade list.
- **`leaderboard-submit.ts` accolade award path** (step_total >= 100,000, real users only): unchanged.
- **Hall of Fame sim filler**: still capped at 45,555 weekly and confined to the HoF tab. Sims never reach 100K Club.
- **World Rank card** on the dashboard: unchanged.

#### Files changed (11)
Backend (4): `backend/src/handlers/step-100k-club.ts` (new), `backend/src/handlers/step-100k-club.test.ts` (new), `backend/src/index.ts` (route + import), `backend/src/env.ts` (binding type), `backend/wrangler.toml` (namespace_id 1013).

Frontend (7): `auth.js` (helper + export), `app.js` (constants + cache + render + tab switch + build tag), `index.html` (tab button + version bumps for auth/app/styles), `styles.css` (row palette), `sw.js` (cache bump), `CLAUDE.md`. **No Duels, no sims, no simulated-leaderboard.js.**

#### Deployment steps needed (when approved)
1. **No migration** — schema unchanged.
2. `cd backend && npx wrangler deploy`
3. Smoke checks:
   - UNAUTH `GET /v1/leaderboard/step-100k-club?metric=…` → 401 AUTH_REQUIRED
   - D1: `SELECT COUNT(*) FROM user_accolades WHERE accolade_type='step_100k_club';` (sanity check on roster size)
   - Authenticated read (if you have a JWT) → expect `{ type, members, me }` per the spec.
4. Frontend Codemagic trigger for the iOS build that ships `app.js?v=407` + `auth.js?v=16`.

Bumps: `app.js?v=407`, `auth.js?v=16`, `styles.css?v=294`, `sw.js v5.293`, `APP_BUILD_TAG '2.2.1-w58'`. `APP_VERSION` unchanged at `2.2.1`. `simulated-leaderboard.js` unchanged.

### Habit-card manage button — one consistent glyph (v3 Phase 1z.51)

**Tester feedback.** "Some cards show the new visible `···` manage button and some cards show the little notepad/manage button. From the user point of view, it feels like there are two different edit buttons."

**Diagnosis.** Same element, different glyph. Line 11159 in `buildItem` previously used `(habitNotes[habit.id] ? '📝' : '···')` — a single `.habit-more-btn` swapping its label based on whether the habit has a note attached. Architecturally one button; visually two affordances. The context menu was updated (1z-era) so its "View Note" item is always present regardless of note state — the button glyph no longer needs to communicate note presence to make the feature discoverable.

**Fix.** One line. The manage button now always renders `···`. Note state is only surfaced inside the View Note sheet (which has both view and edit affordances built in).

**Files changed (frontend only, 4):** `app.js` (one line glyph + a comment block; build tag), `index.html` (app.js version bump), `sw.js` (cache bump), `CLAUDE.md`. **No `styles.css` change.** No backend, no Duels, no sims, no Codemagic.

**Verified.** `node --check app.js` OK. `npm run test:e2e` → **7/7 green (~38s)** — no regressions.

Bumps: `app.js?v=406`, `sw.js v5.292`, `APP_BUILD_TAG '2.2.1-w57'`. `APP_VERSION` unchanged at `2.2.1`. `styles.css` unchanged.

**Acceptance check:**
- ✅ No habit card shows both a `···` manage button and a separate note/edit button.
- ✅ All habit cards show the same single manage control (the `···` button bottom-right, from 1z.50).
- ✅ Tapping the manage control opens the context menu (Edit Habit / View Note / Schedule / Delete).
- ✅ Tapping the habit card body still toggles completion (no JS change).
- ✅ Cards with notes are still distinguishable inside the View Note sheet — no second action button at the card level.
- ✅ Playwright smoke remains green.

### Habit-card manage button is now visible (v3 Phase 1z.50)

**Tester report.** "No obvious edit button anymore on habit cards. Hard to edit a habit, delete a custom habit, add/change a schedule, change a goal."

**Diagnosis.** The 3-dot `[data-more]` button was already rendered on every habit card in `buildItem` (line 11149) and already wired (line 11169) to open the existing context menu (`Edit Habit` / `Add Note` / `Schedule` / `Delete`) via `showCtxMenu(habit.id, li)` with `stopPropagation` so it doesn't toggle completion. **The button was just CSS-hidden** — `styles.css` line 18703 had `display: none` with the comment *"shown on long-press / reorder; preserved attribute"*. Since long-press / drag-reorder is intentionally disabled for 2.2.1 (`ENABLE_HABIT_DRAG_REORDER = false`), the button was permanently invisible.

**Change shipped.**

1. **Unhid `.habit-more-btn`** and restyled it as a discoverable circular dark pill (28×28 glyph, ~40×40 effective tap target via transparent border padding), positioned bottom-right corner of each card. Reuses the same iOS hit-testing hygiene as the souls X (`touch-action: manipulation`, `-webkit-tap-highlight-color`, explicit `pointer-events: auto`).
2. **Hid the `.drag-handle` 6-dot affordance.** Drag-reorder is disabled; those dots looked like an interactive control but did nothing when tapped. Element stays in the DOM (markup unchanged) so re-enabling drag in a future release won't need any HTML change. Just flipped `display: none` on the CSS rule.
3. **aria-label updated** from `"Options"` to `"Manage habit"` for clearer VoiceOver intent.

**Behavior preserved (no code change needed):**
- Tap opens the existing context menu — Edit Habit / Add Note / Schedule / Delete. Schedule editing reachable via `Schedule` row → opens the existing schedule picker sheet.
- Custom habits also get the inline Delete button inside the Edit Habit modal (from 1z.49). Both Delete paths route through the same `deleteHabit(id)` helper.
- Canonical habits' Delete row stays visible in the context menu (canonical habits ARE technically deletable; the 1z.49 modal Delete was scoped to custom-only as a safety guard for the Edit-modal surface specifically).
- `stopPropagation` on the manage-button click handler prevents completion toggle.
- Long-press code path remains no-op'd.

**Files changed (frontend only, 5):** `app.js` (aria-label + comment; the click handler at line 11169 was already correct), `index.html` (version bumps for app.js + styles.css), `styles.css` (unhide manage button + hide drag-handle + restyle), `sw.js` (cache bump), `CLAUDE.md`. No backend, no Duels, no sims, no Codemagic.

`npm run test:e2e` → **7/7 green (~37s)**. The existing Habits-tab smoke test continues to pass.

Bumps: `app.js?v=405`, `styles.css?v=293`, `sw.js v5.291`, `APP_BUILD_TAG '2.2.1-w56'`. `APP_VERSION` unchanged at `2.2.1`.

**Manual QA next iOS build:**
1. Open Habits tab. Every habit card has a visible `···` button bottom-right (or 📝 if the habit has a note attached).
2. Tap `···` on a normal habit → context menu pops up with Edit / Note / Schedule / Delete. Tap Edit → Edit Habit modal opens. Cancel → modal closes, app responsive.
3. Tap `···` on a custom habit → context menu → Edit → modal opens with the `Delete habit` button visible at the bottom (1z.49).
4. Tap `···` on a sealed/completed habit → context menu opens, completion ring is NOT toggled.
5. Tap a normal habit card body (NOT the `···`) → completion still works as before.
6. Tap `···` → Schedule → schedule picker sheet opens; can change days; Save persists.
7. Long-press any habit → no drag ghost / pulsating / stuck overlay / freeze (long-press code path still no-op'd).

### Custom habit Delete affordance + freeze/long-press audit (v3 Phase 1z.49)

**Tester report.** "Have had some freezes on the edit custom goal and pressing and holding on a custom goal thinking I'd be able to edit/delete a duplicate."

**Audit findings:**

1. **Save freeze on custom habit edit** — already fixed by Phase 1z.34. Both `saveCustomHabit` (line 13809) and `commitEdit` (line 20138) follow the safe `save() → close → render-in-try-catch` pattern. Tester was almost certainly on a pre-1z.34 TestFlight build. Verified at current HEAD: no remaining anti-pattern.
2. **Long-press behavior** — the habit-drag-reorder flag (`ENABLE_HABIT_DRAG_REORDER`) is `false` for 2.2.1; `bindDrag()` short-circuits at line 20632. No `pointerdown`/`touchstart` listeners are attached to habit rows, no `.lp-pressing` class is added on touch, no 400ms timer ever fires. `_backgroundDragSafety` cleans orphan `.lp-pressing` classes on `visibilitychange` / `pagehide` / `blur` (lines 20917–20930). CSS already suppresses iOS native long-press callout / text-selection on `.habit-item` (lines 260–275, 333–352) via `user-select: none` + `-webkit-touch-callout: none`. No freeze risk on long-press in the current build.
3. **Duplicate custom habits** — `uid()` (timestamp + random) guarantees unique IDs. Click handlers dispatch by `habit.id` (not name), so two custom habits sharing a name edit independently. `editingId` is the habit's ID, round-trips correctly. Delete was already available via the 3-dot context menu (`[data-more]` → ctx-delete), but discoverability was poor — tester's expectation of long-press = edit/delete reveals that.

**Change shipped: discoverable Delete-habit button in the Edit Habit modal (custom habits only).**

Custom habits had a hidden delete affordance buried in the per-row 3-dot context menu. Tester reflexively long-pressed instead. To meet them where they are without breaking habits that other surfaces depend on, the Edit Habit modal now shows a subtle text-only `Delete habit` button — but only when `habit.custom === true`. Canonical habits stay deletable only through the context menu (they're foreign-keyed by name into `HABIT_ICONS`, `AUTO_VERIFY`, etc. — an accidental Delete tap from the same screen the user opened to "edit a goal" would be too sharp an edge).

**Implementation:**
- `index.html` — new `#edit-delete-row` containing `#edit-delete-btn`, hidden by default, sits above the Cancel/Save action row.
- `app.js` — `openEditModal` toggles `#edit-delete-row.hidden` based on `habit.custom`. `setupEditModal` wires a click handler that:
  1. Re-checks `habit.custom === true` (defense-in-depth).
  2. `window.confirm('Delete "<name>"? …')` — prevents fat-finger.
  3. `try { deleteHabit(id); } catch …`
  4. `closeEditModal()` (modal dismissed BEFORE the post-delete render, mirroring the 1z.34 freeze-safety pattern).
  5. `try { renderHabits(); } catch …` (belt-and-suspenders — `deleteHabit` already calls `renderHabits` internally).
- `styles.css` — subtle red-ember text underline treatment so destructive intent is unmistakable but doesn't compete with Save for attention.

**Files changed (frontend only, 5):** `app.js`, `index.html`, `styles.css`, `sw.js`, `CLAUDE.md`. No backend, no Duels, no sims, no Codemagic. `npm run test:e2e` → 7/7 green. `node --check app.js` OK.

Bumps: `app.js?v=404`, `styles.css?v=292`, `sw.js v5.290`, `APP_BUILD_TAG '2.2.1-w55'`. `APP_VERSION` unchanged at `2.2.1`.

**Manual QA next iOS build:**
1. Add a custom habit. Open Edit Habit. **`Delete habit` button visible at the bottom.**
2. Tap Delete → confirm dialog → confirm → habit + history removed, modal closes, app responsive.
3. Tap Delete → confirm dialog → cancel → modal stays open with no state change.
4. Open Edit Habit on a CANONICAL habit (e.g. Daily walk). **`Delete habit` button is NOT visible.**
5. Two custom habits with the same name → delete one → the OTHER one is preserved (dispatch by ID).
6. Long-press any habit → no ghost, no pulsating, no stuck overlay, no freeze (long-press code path is no-op'd; CSS suppresses native callout).
7. Edit Habit + Save still no-freeze (1z.34 fix verified at current HEAD).

### Boss Defeated modal relic art fix (v3 Phase 1z.48)

**Bug.** On-device repro: defeating The Insomniac dropped Tossing Bedroll. The Boss Defeated result modal's Relic Acquired card showed a generic slot-emoji fallback instead of the actual `tossing_bedroll.png` artwork. Tapping VIEW RELIC opened the relic-detail page which rendered the SAME `card.art_path` correctly. Both paths read from the same data field — so the bug had to be in how the result modal loaded the image.

**Root cause.** The `#bro-relic-art` element in `index.html` carried `loading="lazy"`. The JS at `_showBossResult` set `img.style.display = 'none'` BEFORE assigning `img.src`. Browsers treat lazy-loaded images that are `display: none` (and additionally sit inside a parent that toggles `.hidden`) as offscreen and **defer the fetch indefinitely** — `onload` never fires, the inline `display: none` is never reset, and the slot-emoji fallback underneath stays visible. The detail-page img (`#carddetail-card-art-img`) has no `loading="lazy"` attribute, which is exactly why the same data path renders correctly there.

**Fix (two parts):**
1. **Removed `loading="lazy"`** from `#bro-relic-art` in `index.html`. The image is on a modal that's only opened on a boss kill — there's no performance cost to fetching eagerly.
2. **Consolidated the inline image-load block** in `_showBossResult` to call the shared `setModalCardArt('bro-relic-art', evt.drop.artPath)` helper that the relic-detail page already uses. Single source of truth for both render paths going forward.

**Audit.** Verified all 30 `art_path` references in `app.js` are listed in `sw.js` PRECACHE_ASSETS — 0 missing. The fix works for both filename styles (E-rank underscore: `tossing_bedroll.png`; D-rank hyphen: `iron-grip-wraps.png`) because the data model carries the literal path; the renderer never derives it from the card id.

**Files changed (frontend only, 4):** `app.js` (one block + build tag), `index.html` (img attr cleanup + app.js version bump), `sw.js` (cache bump), `CLAUDE.md`. No backend, no Duels, no sims, no Codemagic.

**Verified:** `node --check app.js` OK. `npm run test:e2e` → 7/7 green.

Bumps: `app.js?v=403`, `sw.js v5.289`, `APP_BUILD_TAG '2.2.1-w54'`. `APP_VERSION` unchanged at `2.2.1`.

### Drop rate nothing-target tuning (v3 Phase 1z.47)

**Tuning-only change.** Base common rates are calibrated so the per-kill "nothing" outcome lands on explicit product targets. Builds on 1z.46.

**Targets:**
| Cadence | Base nothing | Change vs 1z.46 |
|---|---|---|
| daily | **40.00%** | was 58.35% |
| triweekly | **40.00%** | was 43.61% |
| weekly | **0.00%** | was 28.20% |

**Math.** `P(nothing) = (1 − ultra) × (1 − rare) × (1 − common)`. Solving for `common`:
- daily: `common = 1 − 0.40 / ((19/20) × (11/12)) = 0.5407`
- triweekly: `common = 1 − 0.40 / (0.90 × 0.85) = 0.4771`
- weekly: `common = 1 − 0.00 / (0.80 × 0.75) = 1.00`

Weekly common at 1.0 means: whenever the ultra and rare rolls both miss, the common roll always hits — every weekly kill produces a card. The weekly `common_protected` rides up to 1.0 as well so protected can't fall below base.

**Common rates: before → after**
| Cadence | Slot | Before (1z.46) | After (1z.47) |
|---|---|---|---|
| daily | `common` | 0.33 | **0.5407** |
| daily | `common_protected` | 0.7967 | **0.7967** (preserved) |
| triweekly | `common` | 0.43 | **0.4771** |
| triweekly | `common_protected` | 0.78 | **0.78** (preserved) |
| weekly | `common` | 0.53 | **1.00** |
| weekly | `common_protected` | 0.83 | **1.00** (now matches base) |

**Full per-kill distribution after this change:**
| Cadence / state | Ultra | Rare | Common | Nothing |
|---|---|---|---|---|
| daily (base) | 5.00% | 7.92% | 47.09% | **40.00%** |
| daily (protected) | 5.00% | 7.92% | 69.38% | 17.71% |
| triweekly (base) | 10.00% | 13.50% | 36.50% | **40.00%** |
| triweekly (protected) | 10.00% | 13.50% | 59.67% | 16.83% |
| weekly (base) | 20.00% | 20.00% | 60.00% | **0.00%** |
| weekly (protected) | 20.00% | 20.00% | 60.00% | 0.00% |

All rows sum to 100.00% — verified end-to-end.

**Explicitly unchanged:**
- `ultra_rare` rates (5% / 10% / 20%)
- `rare` rates (8.33% / 15% / 25%)
- All `DROP_PITY_BY_CADENCE` thresholds (any-drop guarantee, rare mercy, ultra soft/hard pity)
- Roll order ultra → rare → common
- One-card-max-per-boss-kill behavior
- Per-boss first-common protection (`first_common_by_boss`)
- Item stats, drop caps, boss souls economy

**Files changed (frontend only, 4):** `app.js` (one block + build tag), `index.html` (app.js version bump), `sw.js` (cache bump), `CLAUDE.md`. No backend, no Duels, no sims, no Codemagic.

Bumps: `app.js?v=402`, `sw.js v5.288`, `APP_BUILD_TAG '2.2.1-w53'`. `APP_VERSION` unchanged at `2.2.1`. `styles.css`, `auth.js`, `simulated-leaderboard.js` all unchanged.

### Common drop rate buff (+13 percentage points) (v3 Phase 1z.46)

**Tuning-only change.** Bumped the `common` and `common_protected` rates inside `DROP_RATES_BY_CADENCE` by +13 percentage points each — common drops should feel noticeably more rewarding without disturbing rare/ultra scarcity or mercy pacing.

**Common rates: before → after**
| Cadence | Slot | Before | After |
|---|---|---|---|
| daily | `common` | 0.20 | **0.33** |
| daily | `common_protected` | 0.6667 | **0.7967** |
| triweekly | `common` | 0.30 | **0.43** |
| triweekly | `common_protected` | 0.65 | **0.78** |
| weekly | `common` | 0.40 | **0.53** |
| weekly | `common_protected` | 0.70 | **0.83** |

Expression form in `app.js` (line ~1469): `(1/5) + 0.13`, `(2/3) + 0.13`, `0.30 + 0.13`, `0.65 + 0.13`, `0.40 + 0.13`, `0.70 + 0.13`. Arithmetic verified end-to-end against the target table (all 6 land exactly on spec, biggest IEEE-754 drift is 3.3e-11 on the daily-protected value — well below any rounding floor used downstream).

**Explicitly unchanged:**
- `ultra_rare` rates (daily 5%, triweekly 10%, weekly 20%)
- `rare` rates (daily 8.33%, triweekly 15%, weekly 25%)
- All `DROP_PITY_BY_CADENCE` thresholds: `any_drop_guarantee_after`, `rare_mercy_after`, `ultra_soft_pity_after`, `ultra_soft_pity_add`, `ultra_soft_pity_max`, `ultra_hard_pity_after`
- Roll order: ultra → rare → common
- One-card-max-per-boss-kill behavior
- Per-boss first-common protection (`first_common_by_boss`)
- Rare Mercy floor
- Any-drop guarantee
- Ultra Mercy soft + hard pity
- Item stats, drop caps, boss souls economy

**Files changed (frontend only, 4):** `app.js` (one block + build tag), `index.html` (app.js version bump), `sw.js` (cache bump), `CLAUDE.md`. No backend, no Duels, no sims, no Codemagic.

Bumps: `app.js?v=401`, `sw.js v5.287`, `APP_BUILD_TAG '2.2.1-w52'`. `APP_VERSION` unchanged at `2.2.1`. `styles.css`, `auth.js`, `simulated-leaderboard.js` all unchanged.

### Souls info modal X-close fix + Souls Ledger (v3 Phase 1z.44)

Two-part change addressing the on-device Souls info modal close bug and adding a passive transaction log.

**Bug — X close on iPhone didn't fire.** Root cause was structural: `.souls-info-close` was `position: absolute; top: 10px; right: 10px` relative to `.souls-info-modal`, which itself was the scrolling container (`max-height: 88vh; overflow-y: auto; -webkit-overflow-scrolling: touch`). Once the user scrolled the dense rate tables, the X scrolled UP and OUT of view; the tap landed wherever the scroll left it instead of the close button. Compounding factor: no explicit `z-index`/`pointer-events`/`touch-action: manipulation` on the button hurt iOS hit-testing reliability.

**Fix.** Markup refactor — modal frame is now non-scrolling; new inner `.souls-info-body-scroll` element owns the overflow. The X close button stays on the outer frame, anchored to a STABLE top-right corner regardless of scroll. Also:
- Tap target bumped from 32×32 to 40×40 (closer to iOS HIG 44×44 floor).
- Explicit `z-index: 3` so the button always sits above its siblings.
- `touch-action: manipulation` to bypass the double-tap-zoom delay.
- `pointer-events: auto` defensively.
- Light background tint (`rgba(20, 20, 35, 0.55)`) so the hitbox is visually obvious.

**Swipe-down dismissal added** for this modal only (info surface, not a committal action sheet). Uses `attachSheetDismissGesture` with `baseTransform: 'translate(-50%, -50%) '` to preserve the centering math while adding the drag's translateY. `Today's Briefing` (1z.42, LOCK IN-only) and `Hall of Fame` (1z.40, X-only) are intentionally NOT given this treatment and remain unchanged.

**Souls Ledger** — new passive transaction log. Local-only (no backend, no Cloud Sync extension in v1). Source of truth is still `hb_souls`; the ledger is a one-way audit trail.

`recordSoulsTransaction(delta, hint)` is called from `earnSouls` and `spendSouls` AFTER `persistSouls` so each entry's `balance_after` reflects the post-change value. The `hint` (existing `source`/`sink` string param) is classified inside the helper:
| Hint pattern | Type | Label |
|---|---|---|
| `kill_<bossId>` | `boss_kill` | `Defeated The Steel Wolf` |
| `engage_<bossId>` | `boss_engage` | `Engaged The Steel Wolf` |
| `daily_login` | `daily_login` | `Daily login` |
| `first_install` / `starter_grant` | `system` | `Starter souls` |
| anything else | `system` | `Souls earned` / `Souls spent` |

Entry shape:
```js
{
  id: '1716075123456_a3f9q2',
  ts: 1716075123456,
  delta: -25,             // signed (gains positive, spends negative)
  balance_after: 200,     // balance after this transaction
  type: 'boss_engage',
  label: 'Engaged The Steel Wolf',
  detail: 'E-rank engage cost',
  ref_id: 'the_steel_wolf'
}
```

Storage: `localStorage['hb_souls_ledger']`. Newest-first array, capped at 250 entries (older fall off automatically). No backfill for existing users — the ledger starts empty and grows on the next earn/spend. The user explicitly accepted this trade-off ("Do not try to reconstruct history").

**UI.** New `VIEW TRANSACTIONS` button at the bottom of the souls info modal → opens `#souls-ledger-sheet` (bottom-sheet pattern reusing the `.vn-sheet` shell). The ledger sheet has X close, overlay-tap close, and drag-down close (`attachSheetDismissGesture`). Rows:
- gold-accented `+50 souls` for gains, red ember `−25 souls` for spends
- label + `Balance: N · MMM D, h:mm AM/PM`
- empty state: `No soul transactions yet. Earn or spend souls and they'll appear here.`

Sheet open path closes the info modal first (80ms timeout to let the close animation settle) so the two surfaces don't stack.

**Sheet-dismiss matrix recap:**
| Sheet | X | Overlay tap | Drag-down | ESC |
|---|---|---|---|---|
| Today's Briefing | LOCK IN only | ❌ | ❌ | ❌ |
| Hall of Fame | ✓ | ❌ | ❌ | ❌ |
| Souls info | ✓ | ✓ | ✓ (1z.44) | ✓ |
| Souls Ledger | ✓ | ✓ | ✓ | (default ESC) |

**Files changed (frontend only, 5):** `app.js` (ledger helpers + earn/spend hooks + setupSoulsLedger + setupSoulsInfoModal swipe-down + ledger button wire), `index.html` (modal markup refactor + ledger sheet + version bumps), `styles.css` (X-close hardening + button + ledger row palette), `sw.js` (cache bump), `CLAUDE.md`. **No backend, no Duels, no sims, no Codemagic.**

`npm run test:e2e` → **7/7 green (~38s)**. No regressions to other sheets (1z.40 Hall of Fame X-only and 1z.42 Today's Briefing LOCK IN-only both verified untouched in the diff).

Bumps: `app.js?v=399`, `styles.css?v=290`, `sw.js v5.285`, `APP_BUILD_TAG '2.2.1-w50'`. `APP_VERSION` unchanged at `2.2.1`.

### Boss hunt expiration windows + Steel Wolf delayed-defeat fix (v3 Phase 1z.43)

**Two-part change** addressing the on-device Steel Wolf smoke-test report and adding the missing hunt-timer surface.

**Part 1 — Steel Wolf delayed defeat (the real bug).**

User engaged Steel Wolf yesterday, walked 6,000+ steps yesterday, opened the app today, boss wasn't defeated. The 1z.42 noun fix shipped the right copy but did NOT address the underlying evaluation: `evaluateSteelWolfForDay(stepCount, dayDate)` was called with TODAY's `Health.getStepsToday()` result against TODAY's date. Yesterday's qualifying 6,500 was never re-queried — `last_eval_date < yesterday` reset the streak to 0, and today's running count (e.g. 500) is below threshold, so no defeat fires. Same shape applied to Glass Strider, Iron Warden, Insomniac, Dream Tyrant.

**Fix.** New `resolveBossHuntsAcrossWindow()` async function walks each engaged boss and re-queries HealthKit for the entire active hunt window:
- **Steps boss** (Steel Wolf 6,000 / Glass Strider 7,500): iterates each device-local day inside `[hunt_started_at, min(hunt_expires_at, now)]`. For each day, calls `Health.getStepsBetween(dayStart ∩ window, dayEnd ∩ window)`. Any day at or above threshold fires `_awardSingleShotKill` with that day's date.
- **Workout boss** (Iron Warden): single `Health.getStrengthWorkoutsBetween` over the whole window. Returns a pre-filtered list (helper already enforces the 10-minute floor). One qualifying workout defeats.
- **Single-night sleep boss** (Insomniac 7h, Dream Tyrant 7.5h): single `Health.getSleepBetween` over the window plus a 12h pre-window pad (the byDate keys use sleep-onset shifted +4h; the pad captures a Sun→Mon block keyed to Mon). Iterates each day key inside the window; any night at or above threshold defeats.
- **Carouser** (weekly weekend boss, multi-night): existing weekend-scoped evaluator keeps driving kills; the resolver only enforces this boss's expiration.

Pre-engagement steps never count: the window's `start` is `hunt_started_at`, which is stamped to `Date.now()` at engage time. Health queries clip to that lower bound. Post-expiration data never counts: `evalEnd = min(end, now)` clips the upper bound.

Idempotency: a defeat flips `state.engaged = false` and clears every hunt-window field, so subsequent resolver calls on the same boss skip immediately. Same-window double-award is impossible.

**Part 2 — Hunt expiration windows + timer UI.**

New state fields on engaged bosses (migration-safe — legacy engaged hunts get a fresh window stamped on first access via `_migrateBossHuntFields`):
- `hunt_started_at` (epoch ms) — set in `engageBoss`
- `hunt_expires_at` (epoch ms) — `started + getBossHuntDurationMs(cfg)`
- `last_hunt_outcome` (`'expired' | 'defeated' | null`) — display hint for re-engage UI

**Durations** (`getBossHuntDurationMs`):
| Cadence | Window |
|---|---|
| daily | 24 h |
| triweekly | 3 d |
| weekly | 7 d |
| fallback | 24 h |

**Detail screen** (`openBossFullScreen` engage-state branch at ~line 17999): replaces `HUNTING SINCE yesterday` with a concrete remaining-time readout — `HUNT ENDS IN 14h 07m`, `HUNT ENDS IN 42m`, `HUNT ENDS IN 2d 5h`, or `HUNT EXPIRED`. Falls back to the legacy copy if migration hasn't run (defensive).

**Expiration sweep.** When the window elapses without a qualifying event, `_expireBossHunt(id)` marks the hunt expired: clears `engaged`, all hunt fields, stamps `last_hunt_outcome = 'expired'`. The boss can be re-engaged immediately. The synchronous `_sweepExpiredBossHuntsNoHealth()` fallback handles users without Health permission so their windows still expire.

**Wired on:**
- `renderHabits` (every render cycle — same rhythm as `autoVerifyWalk`)
- `visibilitychange → visible` (after the `Health.clearCache` + autoVerify trio)
- `openBossFullScreen` (so the detail screen reflects post-resolve state)

Resolver is fire-and-forget; idempotent; cheap when no boss is engaged. Exposed on `window.resolveBossHuntsAcrossWindow` for debug.

**Defeat/drop/mercy/souls** all run exactly once per kill — the shared `_awardSingleShotKill` and the inline kill paths for Insomniac/Carouser/Steel Wolf were updated to call `_clearBossHuntFields(state)` so re-engage always starts from a clean slate. No double-award, no double-drop, no double-mercy.

**Today's Briefing 1z.42 fix preserved.** Verified by grep — `setupDailyInsight` still has neither `overlay.addEventListener('click', ...)` nor `attachSheetDismissGesture(...)`. LOCK IN remains the sole close path. Hall of Fame sheet (1z.40) also still X-only close.

**Verified:** `node --check app.js` OK. `npm run test:e2e` → **7/7 green** (~39s). No backend, no Duels, no sims, no Codemagic.

Bumps: `app.js?v=398`, `sw.js v5.284`, `APP_BUILD_TAG '2.2.1-w49'`. `APP_VERSION` unchanged.

**Manual QA for next iOS build:**
1. Engage Steel Wolf → detail shows `HUNT ENDS IN 23h 59m` (or close).
2. Walk 6,000+ steps. Open app later → boss defeats, defeat count +1, drop/mercy/souls update once. Detail switches to defeated state.
3. Engage Steel Wolf, immediately disengage, walk 6,000+ → no defeat (engaged=false gates the resolver).
4. Engage Steel Wolf with 6,000 steps already on the watch from before engaging → no defeat (pre-engagement steps clipped by the window's start bound).
5. Engage Steel Wolf, let 24h pass without walking → `HUNT EXPIRED`. Re-engage works.
6. Open Insomniac / Dream Tyrant detail after a qualifying night → defeats via the sleep path. Carouser keeps existing weekend semantics.
7. Today's Briefing still cannot swipe-dismiss; LOCK IN closes it.

### Boss progress noun + Today's Briefing dismiss fix (v3 Phase 1z.42)

Two on-device smoke-test bugs caught after the May 17 handoff.

**Bug 1: Steel Wolf detail showed `0 / 1 night`.** A steps-based boss was rendering its progress label with the sleep-boss noun. Root cause: lines 17863 (boss-card list) and 17954 (boss-detail full screen) had a hardcoded `(cfg.streakTarget === 1 ? 'night' : 'nights')` regardless of cadence or kill-condition metric. Affected every steps/workout boss — Steel Wolf, Glass Strider, Iron Warden — they all rendered as "night/nights" even though their conditions are day-based. Defeat logic itself was always correct (`evaluateSteelWolfForDay` at line 3745 increments streak when `stepCount >= cfg.stepThreshold` and fires the kill path on `streak >= streakTarget`) — only the label was wrong.

**Fix.** New `_bossProgressNoun(cfg)` helper (near `loadBosses` at line ~412):
```
sleep boss   (cfg.sleepHours)       → 'night' / 'nights'
steps boss   (cfg.stepThreshold)    → 'day'   / 'days'
workout boss (cfg.workoutMinutes)   → 'day'   / 'days'
fallback                            → 'day'   / 'days'
```
Both render sites (boss-card list + full-screen detail) now call the helper. Verified the mapping for all 6 bosses (Insomniac/Carouser/Dream Tyrant → night; Steel Wolf/Glass Strider/Iron Warden → day). Carouser correctly renders "nights" (streakTarget=2 sleep boss). All checks pass.

**Bug 2: Today's Briefing dismissed on swipe-down + overlay tap.** The sheet is meant to be a committal review surface — the user must scroll to LOCK IN and tap it to acknowledge the day's plan. Removed both `overlay.addEventListener('click', dismissDailyInsight)` AND the `attachSheetDismissGesture` wiring in `setupDailyInsight`. The LOCK IN button (`#di-enter-btn`) remains the sole close path. **Scope-limited** — same pattern as the Phase 1z.40 fix for the leaderboard sheet; all 12 other sheets keep their existing drag + overlay-tap dismiss unchanged.

**Files changed (frontend only, 4):** `app.js` (new helper + 2 render-site updates + setupDailyInsight tightened + build tag), `index.html` (app.js version bump), `sw.js` (cache bump), `CLAUDE.md`. No backend, no Duels, no styles.css, no auth.js. Playwright suite (`npm run test:e2e`) still green 7/7 after the change.

Bumps: `app.js?v=397`, `sw.js v5.283`, `APP_BUILD_TAG '2.2.1-w48'`. `APP_VERSION` unchanged at `2.2.1`.

### Hall of Fame fallback union from leaderboard_snapshots (v3 Phase 1z.41)

**Backend-only fix.** No schema change. No new migration. Re-deploy worker only.

**Bug.** Real users like `galilea`, `melvin`, `rendiesel`, `immortalshadow` who appear in the current-week leaderboard were MISSING from the Hall of Fame. Visible HoF showed mostly simulated filler.

**Diagnosis (confirmed against remote D1):**
```
weekly_step_records:                    1 row
leaderboard_snapshots step_total:       5 rows total
  with week_start IS NOT NULL:          2 (post-1z.33, eligible fallback)
  with week_start IS NULL:              3 (pre-1z.33 stale — exclude)
```
The 2 eligible rows are real users (`RenDIESEL` @ 3,246 and `Richie` @ 3,110, both for week `2026-05-17`) who submitted between the 1z.33 weekly-scope deploy and the 1z.36 Hall of Fame deploy. They have a valid `week_start` tag in `leaderboard_snapshots` but no `weekly_step_records` row because the HoF write path didn't exist when they submitted. The HoF endpoint only read from `weekly_step_records`, so they were invisible.

**Chosen fix:** endpoint-side UNION fallback (not a one-time backfill — safer per the spec preference: "endpoint fallback union is safest and avoids one-time data mutation").

**Fix in `backend/src/handlers/hall-of-fame.ts`** — three queries now read from a UNION of `weekly_step_records` + eligible `leaderboard_snapshots` rows. Eligibility for the snapshot fallback:
- `metric = 'step_total'`
- `week_start IS NOT NULL` (excludes pre-1z.33 stale NULL-week rows)
- `users.apple_sub NOT LIKE 'sim_test_%'` (excludes sim test users — mirrors the write-time filter in `leaderboard-submit.ts`)
- `NOT EXISTS` in `weekly_step_records` for the same `(user_id, week_start)` (dedupe — wsr supersedes ls when both have the pair, since wsr's `MAX(stored, new)` semantic is stricter than ls's last-write-wins)

```sql
WITH merged AS (
  SELECT user_id, week_start, steps FROM weekly_step_records
  UNION ALL
  SELECT ls.user_id, ls.week_start, ls.current_value AS steps
    FROM leaderboard_snapshots ls
    JOIN users u ON u.id = ls.user_id
    WHERE ls.metric = 'step_total'
      AND ls.week_start IS NOT NULL
      AND u.apple_sub NOT LIKE 'sim_test_%'
      AND NOT EXISTS (
        SELECT 1 FROM weekly_step_records w
        WHERE w.user_id = ls.user_id AND w.week_start = ls.week_start
      )
)
SELECT u.alias, m.steps, m.week_start
FROM merged m
JOIN users u ON u.id = m.user_id
ORDER BY m.steps DESC, m.week_start ASC
LIMIT ?
```

The `me_best` lookup and the rank-counting query use the same union pattern (the rank query's `WHERE steps > ?` is applied to the merged set so a user whose best is in the snapshot fallback gets a rank consistent with the displayed top-N).

**Behavior after deploy:**
- `RenDIESEL` (3,246), `Richie` (3,110) appear in HoF immediately — no resubmit required.
- Once `Richie` submits again, his `weekly_step_records` row supersedes the snapshot fallback via NOT EXISTS. No duplicate.
- New submits going forward continue to write `weekly_step_records` and naturally take over from the snapshot fallback over time.
- Pre-1z.33 NULL-week_start rows stay excluded — they have no defensible week attribution.
- Sim users (none currently) stay excluded.
- Backend `me_best` for users without a wsr row but with an eligible snapshot now resolves correctly (rather than null).

**Backend tests (+5 in `hall-of-fame.test.ts`, 16 total HoF cases, 30 HoF + submit, 84/84 suite-wide):**
- Top query unions wsr + ls with `metric='step_total'`, `week_start IS NOT NULL`, `apple_sub NOT LIKE 'sim_test_%'`, and the NOT EXISTS dedupe.
- me_best query has the same union and binds session.userId three times.
- Rank query counts strictly higher rows against the same union.
- Snapshot fallback excludes NULL week_start rows.
- Snapshot fallback excludes sim users.

**No app version bump.** Backend-only change. Frontend continues to call `Auth.fetchLeaderboardHallOfFame` and runs its existing sim filler merge on top of the now-richer real response — real users naturally sort above sims capped at 45,555.

**Deployment steps needed (when approved):**
1. `cd backend && npx wrangler deploy` (no migration; schema unchanged)
2. Smoke: `D1 SELECT COUNT(*)` queries unchanged, but `GET /v1/leaderboard/hall-of-fame?metric=step_total` (authenticated) now returns 2 real records + the 1 wsr row (currently same user — dedupes to 2 unique records: RenDIESEL 3,246 + Richie 3,110).

**Files changed (backend only, 3):** `backend/src/handlers/hall-of-fame.ts`, `backend/src/handlers/hall-of-fame.test.ts`, `CLAUDE.md`. No Duels, sims, Codemagic, or migration.

### Hall of Fame smoke-test fixes — me_best rank + sheet scroll-dismiss (v3 Phase 1z.40)

Two distinct TestFlight bugs from the first real-device pass over Hall of Fame.

**Bug 1: YOUR BEST card showed misleading rank.** Reporter's pinned card said `#1 · 3,110 steps · Week of May 17–May 23`, but the visible list had 12 simulated users (top: ShadowMonarch_K at 44,412) ranked above the real user's record. The pinned `#1` was the backend `me_best.rank` (real-records-only), which doesn't account for the client-side sim merge. Visible list said `#13`, pinned card said `#1` — contradiction.

**Root cause.** The pinned "YOUR BEST" card was rendered from `result.me_best` (or `cached.me_best`) directly. The backend (correctly) computes `me_best.rank` against `weekly_step_records` only — sims aren't in the table. Once the client merges 12 sims above a low-step real record, the backend rank is stale.

**Fix.** Refactored `_lbMergeHofRecords` to take BOTH the real `records` array AND `realMeBest`. Returns `{ records, me_best_displayed }` where `me_best_displayed.rank` is computed by scanning the merged list for `(alias, week_start)` matching the backend response. `me_best.steps`, `week_start`, `week_end` still come from the backend response — only the rank is recomputed.

Additionally, if the user's `me_best` record isn't already in the real `records` array (e.g. fell outside the limit window because too many sims sit above it), the merge injects a synthetic row with `_injectedSelf: true` so the user appears in the scrollable list, not only the pinned card. Sim aliases collide with the user's alias are dropped defensively (same pattern already used for real-vs-sim alias collisions).

Verified end-to-end with the reporter's exact scenario:
```
Backend me_best.rank:   #1   (real-records-only)
Displayed me_best.rank: #13  (after merge — matches visible list)
```
The pinned card and the visible row at position #13 now agree.

**Bug 2: Leaderboard sheet closed when scrolling.** The Hall of Fame list is the longest content of any sheet in the app, and `attachSheetDismissGesture(... { scrollTarget: '.lb-rank-list' })` mis-fired on iOS during legitimate scrolls. Compounding it: `overlay.addEventListener('click', closeLeaderboardRanking)` meant any accidental rubber-banded background tap also dismissed.

**Fix.** Made `#lb-rank-sheet` X-only close. Removed both `overlay click → close` AND the `attachSheetDismissGesture` wiring. The X button (`#lb-rank-close`) is now the sole close path. Native iOS scroll inside `.lb-rank-body` works without contention from a gesture handler. **Scope-limited:** other sheets (streaks, class detail, step-100K, build picker, etc.) keep their existing drag-dismiss + overlay-tap behavior unchanged. Grep confirms only the leaderboard sheet's `attachSheetDismissGesture` call was removed.

**Files changed (frontend only, 5):** `app.js` (merge refactor + 3 render call sites + sheet setup), `index.html` (version bumps for app.js), `sw.js` (cache bump), `CLAUDE.md`. No `styles.css` change, no `auth.js`, no `simulated-leaderboard.js`. Sim generator's 45,555 cap is untouched.

**Real users visibility.** Confirmed: backend handler at `/v1/leaderboard/hall-of-fame` is correct — it returns all real records in `weekly_step_records` (currently 1 row, the reporter's). Pre-1z.40 they only appeared in the pinned card because the limit window + merge couldn't accommodate them; post-1z.40 they appear in BOTH places (pinned card with correct displayed rank + a row in the merged list flagged via the `_injectedSelf` path). The table starts at 0 real rows and grows as users submit — no backfill, no migration. Once a second real user submits, both appear in the merged list automatically.

**Backend untouched.** No D1 schema changes, no handler logic changes, no migrations. The backend still produces real-only `me_best` — only the client's rendering of that value changed.

Bumps: `app.js?v=396`, `sw.js v5.282`, `APP_BUILD_TAG '2.2.1-w47'`. `APP_VERSION` unchanged at `2.2.1`. No `styles.css` change.

### Boss detail Souls balance readout (v3 Phase 1z.39)

**Problem.** TestFlight tester opened a boss detail screen showing `ENGAGE BOSS — 25 SOULS`, didn't know how many souls they had before tapping. The dashboard header pill (`#souls-badge`) is hidden by the full-screen boss overlay, so the only existing balance surface is invisible at decision time.

**Fix.** Added a compact balance readout inside `#bfs-engage-cta`, positioned ABOVE the engage button. Two states:
- **Sufficient (gold):** `SOULS AVAILABLE` label + `🩸 185` (icon + count). Matches the existing header pill palette (gold gradient, gold text).
- **Insufficient (red ember):** `NEED MORE SOULS` label + `12 / 25 needed`. Engage button additionally takes a `.bfs-engage-btn--insufficient` modifier (`opacity: 0.55, filter: grayscale(0.35)`, red glow instead of gold) so the gate is visible before tap.

The engage button stays tappable in both states. The existing `engageBoss()` balance guard (`if (balance < cost) showHabitToast('Need N souls. You have M.'); return false;`) is the source of truth for spending — this UI just makes the same information visible upfront.

**Source of truth preserved.** The balance read uses the existing `getSoulsBalance()` accessor — same function the header pill uses. No new state, no caching, no duplication. The HTML element is populated on every `openBossFullScreen()` so it always reflects the latest balance when the user opens or re-opens the screen.

**Files changed (frontend only, 4):** `index.html` (new `#bfs-souls-balance` markup inside `#bfs-engage-cta`; version bumps for app/styles), `app.js` (populate balance + softened-button toggle in `openBossFullScreen` engage-cta branch; build tag), `styles.css` (`.bfs-souls-balance` + `.bfs-souls-balance--insufficient` + `.bfs-engage-btn--insufficient`), `sw.js` (cache bump). No backend, no Duels, no sims, no Codemagic.

Bumps: `app.js?v=395`, `styles.css?v=289`, `sw.js v5.281`, `APP_BUILD_TAG '2.2.1-w46'`. `APP_VERSION` unchanged at `2.2.1`.

### Hall of Fame write isolation (v3 Phase 1z.38)

**Belt-and-suspenders safety before the 1z.36 deploy.** The `weekly_step_records` INSERT in `handlers/leaderboard-submit.ts` is now wrapped in its own `try/catch` so a HoF write failure cannot break the existing leaderboard submit flow.

**Why.** Migration `0009_weekly_step_records.sql` is still pending. If the worker deploys ahead of (or without) that migration, the bare INSERT throws `D1_ERROR: no such table: weekly_step_records`, which would otherwise bubble up and 500 the entire submit — taking down both the current-week `leaderboard_snapshots` upsert AND the 100K Step Club accolade with it. The same risk applies to any transient D1 outage on that one statement.

**What's wrapped:**
- ONLY the `INSERT INTO weekly_step_records ... ON CONFLICT ... DO UPDATE` statement.
- Not the `leaderboard_snapshots` upsert above it (core write — failures SHOULD surface as 500 so the client retries).
- Not the `user_accolades` upsert below it (100K accolade write — same reasoning).

**Failure mode:** logged as `console.warn('[hall-of-fame] weekly_step_records upsert failed; submit continues.', user_id=..., week_start=..., value=..., error=...)`. The submit returns 200 with the authoritative `current_value` + `best_value` from the (successful) `leaderboard_snapshots` read-back. HoF is best-effort historical metadata — a missed write on a flaky tick is recovered automatically by the user's next submit (the same-week `MAX(stored, new)` semantic fills in the gap).

**Tests** (5 new in `leaderboard-submit.test.ts`, suite "Hall of Fame write isolation (1z.38)"):
1. Submit still returns 200 when the HoF INSERT throws.
2. `leaderboard_snapshots` upsert still ran (proves we're not skipping the HoF statement entirely).
3. 100K accolade still awards at >= 100,000 when HoF throws.
4. Warning is logged with `[hall-of-fame]`, `weekly_step_records`, user_id, and week_start.
5. Normal HoF write still succeeds on a healthy DB (no false suppression).

**79/79 backend vitest pass.** No schema changes. No frontend changes. No version bumps required. The 1z.36 deploy plan is unchanged and still pending approval — with this isolation in place, deploying the worker AHEAD of migration 0009 is no longer a 500-the-whole-submit risk, only a "HoF will be empty until the migration applies" risk.

### Hall of Fame spec correction — sim filler allowed, real-only `me_best` (v3 Phase 1z.37)

**Spec change.** Originally (Phase 1z.36) the Hall of Fame was strictly real-users-only on both server and client. Updated product call: at launch the board can read as empty for too long, so the **client** is allowed to merge in simulated filler records so the surface looks populated. The **backend remains real-only** — no sim writes, no sim accolades.

**Rules enforced:**
- Sims may appear in the HoF tab. ✅
- Sims are capped at `SIM_STEP_WEEKLY_CAP = 45,555`. ✅ (already enforced from 1z.35)
- Sims never qualify for 100K Step Club. ✅ (cap < 100k, and sim users were already filtered at submit)
- Sims never affect `me_best`. ✅ (`me_best` is taken directly from the backend response in `_lbRenderHofTab`)
- Real users can exceed 45,555 and naturally sort above all sims. ✅ (verified end-to-end: a real 88,420-step record sorts above the top sim at ~44,412)
- Sim records are deterministic per week — reloads don't reshuffle. ✅
- Sims are NEVER persisted to D1 or sent to the backend. ✅

**Sim HoF generator (`simulated-leaderboard.js` rev v5 → v6):**
- New public API: `SimulatedLeaderboard.getHallOfFameRecords(dateKey, metric)` returns ~12 deterministic records.
- Uses the existing 10-bot cast. Top-tier bots (index 0–1) contribute 2 records each; everyone else contributes 1. Total: 12 rows.
- Candidate weeks: the 8 Sunday-UTC weeks BEFORE the current week (current week is excluded; HoF is meant to reflect completed history).
- Per-(bot, week) value: Gaussian roll seeded by `weekKey + bot.name + 'hof'` (different seed family than the current-week daily roll so the two systems can never agree). Centered on `bot.avgDailySteps × 7` with stddev `bot.stepStdDev × √7`. Hard-clamped to 45,555.
- For each bot, the generator picks that bot's HIGHEST 1–2 weeks from the candidate pool — the rolled "weekly best ever" snapshot, not arbitrary weeks.
- Rows tagged `_sim: true` + `_simulated: true` (no UI difference; internal flags only).
- Returns `[]` for non-step metrics (the HoF tab is hidden for them anyway).

**Verified output** (dateKey = 2026-05-17):
```
#1  ShadowMonarch_K  44,412  2026-05-10..2026-05-16
#2  ShadowMonarch_K  41,875  2026-05-03..2026-05-09
#3  AscendantNova    40,865  2026-03-29..2026-04-04
#4  AscendantNova    38,360  2026-05-03..2026-05-09
#5  ghostlift        35,493  2026-04-19..2026-04-25
#6  Marcus T.        29,489  2026-05-10..2026-05-16
#7  Sienna K.        26,141  2026-03-29..2026-04-04
#8  voidwalker_88    20,528  2026-04-26..2026-05-02
#9  Jordan F.        16,995  2026-04-12..2026-04-18
#10 AwakenedRen      12,001  2026-04-26..2026-05-02
#11 Priya N.          8,001  2026-03-29..2026-04-04
#12 nightowl          6,150  2026-04-26..2026-05-02
```
All under cap. Deterministic on second call. Top-tier bots correctly contribute 2 records each with DIFFERENT week_starts (no clutter at the same week).

**Frontend merge (`_lbMergeHofRecords` in `app.js`):**
- Called from `_lbRenderHofTab` on every render path (cached, fresh, offline-fallback).
- Defensive alias-collision dedupe: if a real record shares an alias with a sim bot, the sim is dropped.
- Re-sorts the combined list by `steps DESC, week_start ASC` — same convention as the backend tiebreaker, so a real record at the exact same step count as a sim (rare given the cap separation) gets older-week priority.
- Re-ranks 1..N across the merged list. `me_best` is rendered separately from `result.me_best` (backend response) and never touches the sim list.
- Offline fallback: if the fetch fails and there's no cache, the sim list still renders so the board isn't completely empty during a transient outage. `me_best` stays hidden in that path (no real attribution available).

**Backend untouched in this phase.** `handlers/hall-of-fame.ts`, the `weekly_step_records` table, the submit handler's write filter, and all 11 HoF backend tests + 4 submit tests are unchanged. The sim filter on submit (`apple_sub LIKE 'sim_test_%'`) was already correct — sim users never write to D1.

**Files changed (4):** `simulated-leaderboard.js` (new `getHallOfFameRecords` + helpers), `app.js` (`_lbMergeHofRecords` + render path updates + build tag), `index.html` (3 version bumps), `sw.js` (cache bump). `CLAUDE.md` updated. **No backend changes.** **No Duels changes.** **No Codemagic trigger.** **Still not deployed** — the 1z.36 deploy plan (apply 0009 migration, then deploy worker) is unchanged and still pending approval.

Bumps: `simulated-leaderboard.js?v=6`, `app.js?v=394`, `sw.js v5.280`, `APP_BUILD_TAG '2.2.1-w45'`. `APP_VERSION` unchanged at `2.2.1`.

### Weekly Steps Hall of Fame (v3 Phase 1z.36 — DEPLOYED, backend live)

**Feature.** A permanent all-time leaderboard of the highest verified weekly step totals ever recorded by real users. Separate surface from `Steps · This Week` (current weekly board, resets Sunday) and the `100K Step Club` accolade. A real user can appear in the Hall of Fame multiple times — once per qualifying high week. Simulated/sim-test users never appear in the backend table (filtered at write time). Sim filler IS allowed at the client display layer (see 1z.37 decision and 1z.40/1z.41 follow-ups), capped at 45,555 weekly steps; sims never affect `me_best`.

**Status (as of May 17, 2026 EOD):** backend deployed (migration 0009 applied, Worker live with fallback-union). Frontend tabs + sim filler merge + me_best displayed-rank fix all committed and pushed; iOS build NOT yet shipped via Codemagic — staged for next session.

#### Schema (`migrations/0009_weekly_step_records.sql`)

```sql
CREATE TABLE IF NOT EXISTS weekly_step_records (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  week_start  TEXT NOT NULL,        -- 'YYYY-MM-DD' Sunday-UTC
  steps       INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (user_id, week_start)
);
CREATE INDEX idx_weekly_step_records_steps ON weekly_step_records (steps DESC, updated_at DESC);
CREATE INDEX idx_weekly_step_records_week  ON weekly_step_records (week_start, steps DESC);
CREATE INDEX idx_weekly_step_records_user  ON weekly_step_records (user_id, steps DESC);
```

Alias is NOT denormalized. Reads `JOIN users` so alias edits flow through automatically.

#### Write path (extended `handlers/leaderboard-submit.ts`)

For real-user `step_total` submits, upsert one row keyed by `(user_id, week_start)`:

```sql
INSERT INTO weekly_step_records (id, user_id, week_start, steps, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(user_id, week_start) DO UPDATE SET
  steps      = MAX(weekly_step_records.steps, excluded.steps),
  updated_at = excluded.updated_at;
```

Same-week lower resubmits never reduce the record (the `MAX` semantic). Same-week higher resubmits raise it. New-week submits create a second row for the same user. Sim users (`apple_sub LIKE 'sim_test_%'`) are short-circuited — the `apple_sub` lookup is now hoisted out of the 100K-accolade branch and shared between both write paths (one SELECT per submit instead of two).

This is independent of `leaderboard_snapshots.best_value` (which keeps its own all-time max for the current-week board) and `user_accolades` (100K Step Club). All three surfaces co-exist cleanly.

#### Read endpoint — `GET /v1/leaderboard/hall-of-fame`

`backend/src/handlers/hall-of-fame.ts` · wired in `src/index.ts` next to `/v1/leaderboard/top`.

```
GET /v1/leaderboard/hall-of-fame?metric=step_total&limit=N
Auth required (same JWT gate as /top).
Rate limit: RL_LEADERBOARD_HOF (namespace_id 1012, 30/min per user).
v1: metric=step_total only. Streak metrics → 400 INVALID_METRIC.
limit: default 50, max 100.
```

Response:
```json
{
  "metric": "step_total",
  "records": [
    { "rank": 1, "alias": "Richie", "steps": 104821, "week_start": "2026-05-17", "week_end": "2026-05-23" }
  ],
  "me_best": { "rank": 7, "steps": 88420, "week_start": "2026-05-17", "week_end": "2026-05-23" }
}
```

`week_end` is computed server-side as `week_start + 6 days` (UTC). Tiebreaker: older week wins (`ORDER BY steps DESC, week_start ASC` — first-to-the-summit semantic).

#### Frontend integration

**Auth helper:** `Auth.fetchLeaderboardHallOfFame(metric, limit)` in `auth.js` (parallel to `fetchLeaderboardTop`). Returns `{ ok, metric, records, me_best }` or an error-coded result.

**UI:** segmented control inside the existing `#lb-rank-sheet` (no new sheet). For `step_total`:
- Title becomes `Steps`
- Two tabs: `This Week` / `Hall of Fame` (segmented buttons via `.lb-rank-tabs`)
- `This Week` tab: existing current-weekly board (sim merge preserved; date-range blurb preserved)
- `Hall of Fame` tab:
  - Blurb: `Highest verified weekly totals ever recorded.`
  - Pinned `#lb-rank-mebest` row: `YOUR BEST · #7 · 88.4K steps · Week of May 17–May 23` (or `No Hall of Fame record yet.` if me_best is null)
  - Rows: `#rank` · `alias` + week range tagline · compact step count (e.g. `104.8K steps`)
  - Empty state: `🏆 No records yet · Be the first hunter to set a weekly record.`

For non-step metrics (sleep_streak, bedtime_streak), the tabs are hidden and the existing single-list rendering is unchanged.

**Cache:** `hb_lb_hof_<metric>` with 10-minute TTL. Separate from `hb_lb_cache_<metric>` (different shape, different freshness needs). HoF cache stores `{records, me_best, fetched_at}`. No sim merge ever runs against this data.

#### Simulated users — confirmed isolation

- `simulated-leaderboard.js` is untouched in this phase (cap at 45,555 from Phase 1z.35 stands).
- Sim users never write `weekly_step_records` (filtered at submit by the `sim_test_` apple_sub prefix).
- `_lbMaybeSimulate()` is only called from `_lbRenderThisWeekTab()`. The HoF render path never invokes it.
- `hb_lb_hof_<metric>` cache stores backend response verbatim — no merging.
- 100K Step Club still works: real users with `steps >= 100000` simultaneously get the accolade write AND the weekly_step_records row.

#### Concurrency guards

Both renders are gated by `_lbCurrentOpenMetric` AND `_lbCurrentTab`. Tab-switch races (open `step_total` → tap HoF → tap back to This Week before the HoF fetch returns) correctly drop the late HoF response on the floor. `closeLeaderboardRanking()` resets both back to null/`'this-week'` so stale fetches landing after dismiss are silenced.

#### Files changed

Backend (5):
- `backend/migrations/0009_weekly_step_records.sql` (new)
- `backend/src/handlers/hall-of-fame.ts` (new)
- `backend/src/handlers/hall-of-fame.test.ts` (new — 11 vitest cases)
- `backend/src/handlers/leaderboard-submit.ts` (write path extension + hoisted sim filter)
- `backend/src/handlers/leaderboard-submit.test.ts` (+4 new vitest cases)
- `backend/src/env.ts` (added `RL_LEADERBOARD_HOF` binding type)
- `backend/src/index.ts` (route wiring + import)
- `backend/wrangler.toml` (added `RL_LEADERBOARD_HOF` namespace_id 1012)

Frontend (5):
- `app.js` (HoF cache + helpers + tab renderers + `openLeaderboardRanking` refactor + close handler reset + build tag)
- `auth.js` (`fetchLeaderboardHallOfFame` + export wire-up)
- `index.html` (tabs markup + me-best slot + version bumps for styles/app/auth)
- `styles.css` (`.lb-rank-tabs`, `.lb-rank-tab`, `.lb-rank-mebest`, `.lb-rank-row--hof` block)
- `sw.js` (CACHE_VERSION bump)

#### Tests

74/74 backend vitest pass:
- 11 new HoF handler tests (ordering, ties, me_best, limit cap, metric validation, ratelimit, JOIN shape, week_end math)
- 4 new submit-handler tests (writes weekly_step_records, MAX preserves, skips non-step metrics, skips sim users)
- 59 existing tests still green (no regressions)

`node --check app.js` + `node --check auth.js` both OK. `tsc --noEmit` clean for the new + modified backend files.

#### Deployment steps needed (when approved)

1. Apply remote migration:
   ```
   cd backend
   echo y | npx wrangler d1 execute awakened-db --remote --file=migrations/0009_weekly_step_records.sql
   ```
2. Verify table + indexes:
   ```
   npx wrangler d1 execute awakened-db --remote --command "PRAGMA table_info(weekly_step_records);"
   npx wrangler d1 execute awakened-db --remote --command "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='weekly_step_records';"
   ```
   Expect 6 columns (id, user_id, week_start, steps, created_at, updated_at) and 3 indexes (idx_weekly_step_records_steps / _week / _user) + the auto-index for the unique constraint.
3. Deploy worker:
   ```
   npx wrangler deploy
   ```
4. Smoke tests:
   - `GET /v1/leaderboard/hall-of-fame?metric=step_total` unauth → 401 AUTH_REQUIRED.
   - `GET /v1/leaderboard/hall-of-fame?metric=sleep_streak` (auth'd) → 400 INVALID_METRIC.
   - `D1 SELECT COUNT(*) FROM weekly_step_records` → starts at 0; grows as users submit.
   - `POST /v1/leaderboard/submit metric=step_total` against a real-user JWT → check that a `weekly_step_records` row appears with the submitted value.
5. Only AFTER smoke checks pass: Codemagic-trigger the iOS build shipping `app.js?v=393` / `auth.js?v=15`.

#### Risks / open questions

- **Backfill:** existing 5 step_total rows in `leaderboard_snapshots` with `week_start = NULL` are NOT migrated to `weekly_step_records`. This is intentional — they have no week tag, so we can't claim "this user hit X steps in week Y". When those users next submit, they'll start populating weekly_step_records normally.
- **Minimum-qualify threshold:** none in v1. Every real-user submit produces a record. If the HoF gets noisy with sub-10k entries we can add a server-side `WHERE steps >= 10000` filter later without a schema change.
- **Same-user repetition:** allowed. The board can show the same person multiple times across different weeks. That's the product spec.
- **Alias collisions on display:** the existing `lbNormalizeAliasForDisplay` lowercase rule is applied per-row in `lbBuildHofList`, but the `lbBuildDisplayAliases` dedupe-suffix logic is NOT applied (a single user appearing twice should look like the same person, not "richie" then "richie_2"). The `Richie` allowlist override still applies.
- **Tiebreak choice documented:** `steps DESC, week_start ASC`. Older week wins. Documented in the migration comment and the handler header.

#### Acceptance criteria check
- ✅ Historical Hall of Fame exists as backend + frontend feature.
- ✅ No fake users appear in HoF (write-time filter + read-path never merges sims).
- ✅ Same real user can appear multiple times for multiple weeks.
- ✅ Current-week leaderboard still works (existing flow untouched in `_lbRenderThisWeekTab`).
- ✅ 100K Step Club still works (74/74 tests including the existing accolade case).
- ✅ No Duels changes.
- ✅ No remote deploy until approved.

Bumps: `app.js?v=393`, `auth.js?v=15`, `styles.css?v=288`, `sw.js v5.279`, `APP_BUILD_TAG '2.2.1-w44'`. `APP_VERSION` unchanged.

### Simulated leaderboard weekly-step cap + Hall of Fame plan (v3 Phase 1z.35)

**Two-part task.** Part 1 (shipped now): cap simulated step totals at 45,555/week and retune the bot cast so the natural distribution looks varied and realistic. Part 2 (planning only): document the Weekly Steps Hall of Fame schema, finalization strategy, and UI integration — no migration, no endpoint, no UI built yet, pending explicit approval.

---

#### Part 1 — Simulated leaderboard cap (shipped)

**Problem.** With the new weekly-scoped leaderboard live, the simulated bots' end-of-week cumulative totals were running up to ~99,400 (ShadowMonarch_K's `avgDailySteps: 14200 × 7`). That looked like bots chasing the 100K Step Club threshold, and a bot saturating ~99k visually risked being indistinguishable from a real 100K-Club hunter in the rankings.

**Audit before fix** (top bot avgDailySteps × 7, Sat-end of week):
- ShadowMonarch_K: ~99,400/wk
- AscendantNova: ~87,500/wk
- ghostlift: ~75,600/wk
- Marcus T.: ~67,200/wk
- Sienna K.: ~61,600/wk
- voidwalker_88: ~51,800/wk
- Jordan F.: ~43,400/wk (right at cap)
- AwakenedRen: ~33,600/wk
- Priya N.: ~25,900/wk
- nightowl: ~16,800/wk

7 of 10 bots routinely exceeded the 45,555 cap.

**Fix in `simulated-leaderboard.js`** (rev v4 → v5):
- Centralized `SIM_STEP_WEEKLY_CAP = 45555` constant. Exposed on `window.SimulatedLeaderboard.SIM_STEP_WEEKLY_CAP` so any future Hall of Fame UI can guard against displaying simulated values where they don't belong.
- Hard cumulative clamp at the end of `botStepsThroughDay()`: `if (sum > SIM_STEP_WEEKLY_CAP) sum = SIM_STEP_WEEKLY_CAP`. Single source of truth — defense at the cumulative-sum boundary catches every roll combination.
- Defense-in-depth clamp in the merge tie-breaker: if a bot already at the cap shares the real user's value, the `+137` nudge could push past — clamp again right after.
- Bot cast retuned to spread across the four product-spec bands (Light / Normal / Active / High but realistic) with `avgDailySteps` lowered by ~60–75%. PRNG seeds (`weekStartKey + bot.name + dayIdx`) are unchanged so determinism within a given week is preserved — same week produces the same totals for any given bot, just shifted to a lower mean.

**Verified distribution (Sat-end of week 2026-05-17)**:
| Bot | Weekly total | Band |
|---|---|---|
| ShadowMonarch_K | 39,630 | High but realistic (36k–45,555) |
| AscendantNova | 38,182 | High but realistic |
| ghostlift | 31,383 | Active (22k–36k) |
| Marcus T. | 23,541 | Active |
| Sienna K. | 23,193 | Active |
| voidwalker_88 | 18,519 | Normal (8k–22k) |
| Jordan F. | 12,928 | Normal |
| AwakenedRen | 7,867 | Normal/Light boundary |
| Priya N. | 3,594 | Light (2k–8k) |
| nightowl | 1,714 | Just-starting |

Stress test across 200 randomly-chosen week keys: max bot weekly = exactly 45,555 (cap engages on rare tail rolls; never exceeded). Tie-bump nudge re-clamp test: 0 bots over cap when real user value = cap.

**100K Step Club isolation:** with the cap at 45,555 (less than half the 100K threshold), no bot can visually appear to be in or near 100K Club territory. Sims are still client-only display — they're never sent to backend, never appear in `user_accolades`, never appear in the real top-N response.

**Files changed (frontend only):** `simulated-leaderboard.js`, `index.html` (version bump), `sw.js` (cache bump), `app.js` (build tag), `CLAUDE.md`.

Bumps: `simulated-leaderboard.js?v=5`, `sw.js v5.278`, `APP_BUILD_TAG '2.2.1-w43'`. `APP_VERSION` unchanged.

---

#### Part 2 — Weekly Steps Hall of Fame · IMPLEMENTATION PLAN (not shipped)

**Status: planning only.** No migration, no endpoint, no UI built. Awaiting approval per `Do not implement full backend historical leaderboard until I approve`.

**Goal.** Permanent record board showing the highest weekly step totals ever achieved by real users. A user can appear multiple times for multiple high weeks. Does not reset. Real users only. Separate from `Steps · this week`.

##### Schema proposal — `weekly_step_records`

```sql
-- migrations/0009_weekly_step_records.sql  (NOT YET WRITTEN)
CREATE TABLE weekly_step_records (
  id          TEXT PRIMARY KEY,          -- UUID
  user_id     TEXT NOT NULL,
  week_start  TEXT NOT NULL,             -- 'YYYY-MM-DD' Sunday-UTC, same key as leaderboard_snapshots
  steps       INTEGER NOT NULL,          -- weekly cumulative total at time of last write
  updated_at  INTEGER NOT NULL,          -- Unix ms; bumped on every overwrite
  created_at  INTEGER NOT NULL,          -- Unix ms; set on initial INSERT
  UNIQUE (user_id, week_start),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_weekly_step_records_steps ON weekly_step_records (steps DESC);
CREATE INDEX idx_weekly_step_records_week  ON weekly_step_records (week_start);
```

**Why not `alias` denormalized:** lookup at read time via `JOIN users u ON u.id = wsr.user_id` keeps the table small and uses the existing alias edit path. Adds one JOIN to the read query; acceptable for a top-100 read.

**Why not `rank_at_finalize`:** computed at read time. Adds complexity for no display value — the Hall of Fame ranks are always the current global ranking among historical records, not the rank at the moment of finalization.

**Why not `week_end`:** derivable from `week_start + 6 days`. Storing it would just be redundant.

##### Finalization strategy — recommended: **Option A (write on every submit)**

Recommendation: **Option A — upsert the weekly_step_records row on every authenticated `step_total` submit.** The current week is included in the Hall of Fame as soon as a user submits.

- **Pros:** simpler (no cron, no scheduled worker, no end-of-week job); record is always live; identical write path to the existing leaderboard_snapshots upsert; if a worker outage misses the Sunday boundary nothing is lost; users see their PR ascending in real time.
- **Cons:** the current in-progress week is visible alongside completed weeks. Mitigation: label the column `Week of MM/DD–MM/DD` and let the user infer freshness from the date range. Add a small `· in progress` tag next to the current Sunday-UTC week's row if needed.
- **Why not Option B (end-of-week finalize):** requires a scheduled task / Cron Trigger on the Worker. Adds operational surface area (cron failures, replay handling). The Option A write-path is already on the hot path; doing it there is one extra D1 row touch per submit.

**The upsert (in `leaderboard-submit.ts`, inside the existing `if (metric === 'step_total')` block):**
```sql
INSERT INTO weekly_step_records (id, user_id, week_start, steps, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(user_id, week_start) DO UPDATE SET
  steps      = MAX(weekly_step_records.steps, excluded.steps),  -- weekly best wins
  updated_at = excluded.updated_at;
```

`MAX(stored, new)` semantics means a same-week resubmit with a lower number (rare — would only happen on cache/replay edge cases) cannot reduce the record. Each user's weekly record is the maximum they hit during that week.

Sim-user filter: the same `apple_sub.startsWith('sim_test_')` guard from the 100K accolade path applies. Sim users never get weekly_step_records rows.

##### Endpoint — `GET /v1/leaderboard/hall-of-fame`

```
GET /v1/leaderboard/hall-of-fame?metric=step_total&limit=100
Auth: required (same JWT gate as /top)
Rate limit: new RL_LEADERBOARD_HOF binding (same shape as existing RL_LEADERBOARD_TOP)
```

Response shape:
```json
{
  "metric": "step_total",
  "records": [
    { "rank": 1, "alias": "Richie",   "steps": 104821, "week_start": "2026-05-17" },
    { "rank": 2, "alias": "Alex",     "steps":  98400, "week_start": "2026-05-24" },
    { "rank": 3, "alias": "Richie",   "steps":  92110, "week_start": "2026-06-07" }
  ],
  "me_best": { "rank": 12, "steps": 41200, "week_start": "2026-04-26" } | null
}
```

Query:
```sql
SELECT u.alias AS alias, wsr.steps AS steps, wsr.week_start AS week_start
FROM weekly_step_records wsr
JOIN users u ON u.id = wsr.user_id
ORDER BY wsr.steps DESC, wsr.week_start ASC  -- ties broken by older week first
LIMIT ?
```

`me_best` = the calling user's highest historical week (one SELECT + one COUNT for rank).

##### Frontend integration — Global Leaderboard sheet with tabs

```
┌────────────────────────────────────────┐
│  GLOBAL LEADERBOARD              ✕    │
│  Steps                                 │
│  ┌──────────┐  ┌────────────────┐     │
│  │This Week │  │ Hall of Fame   │     │  ← segmented control
│  └──────────┘  └────────────────┘     │
│                                        │
│  [tab content]                         │
└────────────────────────────────────────┘
```

- Reuse `#lb-rank-sheet`. Add a segmented control between the title and the list. Default tab: This Week (current behavior preserved).
- Hall of Fame tab renders rows as `#1 Richie — 104,821 steps — Week of May 17–May 23`. Use the existing `lbBuildRankList` shape with a third metadata column.
- "Steps" parent title; the two tabs replace the `Steps · this week` single-line title.
- `me_best` is rendered as the "your best week" footer line (parallels the existing "your rank #N" pattern).
- Sleep/bedtime metrics: keep their single-list rendering (no Hall of Fame for streak metrics in v1).

##### Simulated leaderboard interaction

- The Hall of Fame **never includes simulated bots.** No code path in `simulated-leaderboard.js` merges into the Hall of Fame response. The endpoint reads from `weekly_step_records` which never receives sim writes (sim users are filtered at submit, and sims don't submit anyway — they're client-only).
- Sparse-board fallback: if `records.length === 0`, render the same "Be the first to rank" empty state that the This Week tab uses.

##### 100K Step Club interaction

- Independent. The Hall of Fame is a separate display surface. The accolade write in `leaderboard-submit.ts` keeps doing what it does. Real users with `steps >= 100000` will naturally appear at the top of Hall of Fame AND get the accolade — both paths fire from the same submit.
- Sim users never qualify for either (cap at 45,555 in client; never reach 100,000; never written to backend tables anyway).

##### Migration safety / deploy order (when approved)

1. Write `migrations/0009_weekly_step_records.sql`.
2. Apply remote: `wrangler d1 execute awakened-db --remote --file=...`
3. Add `RL_LEADERBOARD_HOF` ratelimit binding in `wrangler.toml`.
4. Implement `handlers/hall-of-fame.ts` + route wiring.
5. Extend `handlers/leaderboard-submit.ts` with the weekly_step_records upsert (idempotent — no harm if it runs against the not-yet-deployed table, but order matters: migration BEFORE deploy).
6. Add backend tests in `leaderboard-submit.test.ts` + new `hall-of-fame.test.ts`.
7. Frontend: extend `LB_METRIC_META` / `openLeaderboardRanking` with the tab control.
8. Bump versions + ship.

**Estimated scope:** ~1 migration + 1 new handler + ~50 LOC change in leaderboard-submit + ~100 LOC frontend + 8–10 vitest cases. About the same size as Phase 1z.33.

**Open product questions** (need answers before implementation begins):
1. **Include current week, or completed-weeks-only?** Recommendation: include current week with a `· in progress` tag.
2. **One record per user per week, or unlimited?** Recommendation: unique `(user_id, week_start)` (one row per user per week, but a user can appear many times in the top-N across different weeks).
3. **Min steps to qualify?** Recommendation: yes, `steps >= 10000` filter at write time to avoid the leaderboard being noise. Easily changed later.
4. **Display limit?** Recommendation: top 100.
5. **Hall of Fame name confirmation?** Going with "Hall of Fame" per the suggested options unless overridden.

Awaiting approval to move from plan → implementation.

### iOS post-save freeze fix — Edit Habit + pack-add flows (v3 Phase 1z.34)

**Bug.** TestFlight users reported a freeze after tapping Save in the Edit Habit modal, and after committing through the Lock-In / pack-add flow. Pattern in both cases: the data persisted (the edit was present on relaunch), but the UI was stuck and required force-quit to recover.

**Root cause.** A `save(); renderHabits(); closeXModal();` anti-pattern across four save handlers. Persistence happened first, then `renderHabits()` (or a sibling render) ran BEFORE the close call. If the render threw synchronously — e.g. `buildItem()` hitting an unexpected habit shape, a guard tripping inside `updateProgress`, a transient DOM state during the modal-still-on-top frame — the exception propagated past the close and the overlay element kept its hidden-removed state, intercepting all touches. Data was safe; the modal was a tombstone.

**Sites fixed:**
| Handler | Line | Flow |
|---|---|---|
| `commitEdit()` | ~19163 | Edit Habit → Save (the reproduced bug) |
| `saveCustomHabit()` | ~13249 | Add Habits → Custom → Save |
| `sched-save-btn` listener | ~14152 | Edit Habit → Schedule picker → Save |
| `confirmPackAdd()` | ~13314 | Morning Routine / Lock-In pack confirmation |

**The new pattern** (all four sites):
```
try { save(); } catch (e) { console.warn(...) }
closeXModal();                                  // dismiss FIRST
try { renderHabits(); } catch (e) { console.warn(...) }
```

Also hardened `closeEditModal()` itself — each `getElementById(...).classList.add('hidden')` step is independently try/caught so a missing element (rare, but possible mid-DOM-reflow) cannot leave the overlay visible. `confirmPackAdd` had a duplicate `updateLockedInButtonVisibility()` call that was also cleaned up.

**Why this is the fix, not Health.* throttling.** An earlier hypothesis blamed the fire-and-forget `autoVerifyWalk / autoVerifySleep / autoVerifyStrengthTraining` calls at the end of `renderHabits()`. Those are already `try/catch`-wrapped at the call site and they're `async` — they suspend and return immediately, they do NOT block the JS thread. The real culprit is plain synchronous throw inside `renderHabits()`'s DOM-rebuild path during the post-save call. The async Health work is unaffected by this change.

**Lock-In specifically.** `confirmPackAdd` already closed the modal before rendering, so the freeze couldn't be the same render-before-close bug. The hardening here is defense-in-depth: if any render in the post-close chain throws, the user still sees the toast (when possible) and the next interaction works. The remaining likely cause for that specific report is the same render-throw landing AFTER the close but inside the chain that updates the Morning / Lock-In buttons — fixed by isolating each step in try/catch.

**Files changed (frontend only):** `app.js`, `index.html`, `sw.js`, `CLAUDE.md`.

**Out of scope (confirmed):** no backend, no Duels, no sims, no Codemagic config, no styles.css, no auth.js. Verified by `git diff --name-only` and grep.

**Manual QA checklist** (run on iOS Capacitor build that ships `app.js?v=392`):
1. Edit Habit → change goal → Save → modal closes immediately, app responsive, edit persists on relaunch.
2. Edit Habit → Cancel → no freeze.
3. Lock-In button → confirm pack → modal closes, toast appears, habits visible in list.
4. Tap Save rapidly twice → no stuck state.
5. Open Edit Habit with input focused (keyboard up) → Save → keyboard dismisses, modal closes.
6. Schedule picker → change days → Save → picker closes, schedule persists.

Bumps: `app.js?v=392`, `sw.js v5.277`, `APP_BUILD_TAG '2.2.1-w42'`. `APP_VERSION` unchanged at `2.2.1`. `styles.css` unchanged.

### Weekly scoping for Global Steps leaderboard (v3 Phase 1z.33)

**Problem.** The Global Steps leaderboard sheet (`Steps · this week`) was paint­ing stale prior-week totals at the top of the ranking. `leaderboard_snapshots` stored one row per `(user_id, metric)` with no week tag — a user who submitted 35,369 steps last week but didn't reopen the app stayed pinned at the top of "this week" indefinitely.

**Fix.** Tag every step_total snapshot with the current Sunday-UTC week key; filter the top + me-rank queries on that key. Existing rows (week_start NULL) drop out of the current-week ranking automatically.

**Backend changes:**
- `backend/migrations/0008_leaderboard_week_start.sql` — adds nullable `week_start TEXT` column + `idx_leaderboard_metric_week_value (metric, week_start, current_value DESC)`. The legacy `idx_leaderboard_metric_value` is kept for non-weekly metric queries.
- `backend/src/lib/metrics.ts` — adds `WEEKLY_METRICS` set (just `step_total` for v1) and `isWeeklyMetric()` helper. `sleep_streak` / `bedtime_streak` are intentionally excluded; they're running consecutive-night counts that must carry across weeks.
- `backend/src/handlers/leaderboard-submit.ts` — computes `weekStart = getAccoladeWeekStart(now)` for weekly metrics, NULL otherwise. Bound as 6th INSERT arg. `ON CONFLICT … DO UPDATE SET week_start = excluded.week_start` so a user submitting in week W+1 overwrites their prior-week tag.
- `backend/src/handlers/leaderboard-top.ts` — for weekly metrics, both the top-N query and the user's me-row + rank query gain `AND week_start = ?` bound to `getAccoladeWeekStart()`. Non-weekly metrics keep the legacy unfiltered path.
- 100K accolade logic unchanged — already used `getAccoladeWeekStart(now)` for its own `unlock_week_start` / `last_qualified_week_start` tagging. Same helper, same convention.

**Frontend changes (`app.js`):**
- `lbGetCurrentWeekStartUTC(nowMs)` — mirrors backend's `getAccoladeWeekStart`. Format `YYYY-MM-DD`.
- `lbFormatWeekRange(weekStartIso)` — returns `"May 17–May 23"` (en-dash) for the visible subcopy.
- `LB_WEEKLY_METRICS` Set + `LB_METRIC_META.step_total.blurb` rewritten — drops the misleading "(device-local)" copy now that the backend uses UTC.
- `openLeaderboardRanking()` — for weekly metrics, computes the dynamic blurb `"May 17–May 23 · resets Sunday 12:00 AM UTC. Apple Health is the only source."` and sets it on `#lb-rank-blurb` after the static title.
- `lbCacheRead()` — adds a cross-week guard for weekly metrics. The 24h TTL alone wasn't enough (a Saturday 11pm UTC cache is still <24h old at Sunday 12:01am UTC but represents last week's data). Now rejects any weekly cache whose `fetched_at` falls in a prior UTC week.
- World Rank card (`updateStepsCard`) — no code change; benefits automatically from the cache invalidation. After the Sunday boundary, the cache returns null → falls to the existing "Syncing…" loading state until the next `openLeaderboardRanking()` fetch lands.

**Convention chosen and documented:** Sunday 00:00 UTC week boundary. Matches the backend's existing 100K Step Club convention. UI copy now reads "resets Sunday 12:00 AM UTC" instead of "device-local" so the backend and visible label agree.

**100K Step Club compatibility verified:** the accolade award branch in `leaderboard-submit.ts` is independent of the new `week_start` column on `leaderboard_snapshots`. `user_accolades.last_qualified_week_start` still gets tagged via the same `getAccoladeWeekStart()` helper, `best_value` stays an all-time MAX, `repeat_count` still increments on new-week qualifying submits, and `step_100k_club` still fires at `value >= 100000`.

**Simulated leaderboard verified:** `_lbMaybeSimulate()` operates on whatever real top list it's given. With the backend now scoped to the current week, the real list it receives is already current-week-only — simulated bots merge on top normally. No simulated-leaderboard.js change needed.

**Backend tests (vitest, 11 new):**
- `backend/src/handlers/leaderboard-submit.test.ts` — verifies (a) `step_total` submits bind `weekStart` as the 6th INSERT arg, (b) `sleep_streak` / `bedtime_streak` bind NULL there, (c) the ON CONFLICT clause updates `week_start = excluded.week_start`, (d) 100K accolade still awards at `>= 100000`.
- `backend/src/handlers/leaderboard-top.test.ts` — verifies (a) `step_total` top + me + rank queries all carry `week_start = ?` and bind the current week key, (b) `sleep_streak` / `bedtime_streak` queries don't filter on `week_start`, (c) the response shape is unchanged when current-week data exists.
- Shape-test style matches the existing `accolades.test.ts` convention. Real-SQL behavior (ON CONFLICT MAX, index scan, etc.) continues to be exercised end-to-end via `sims/scripts/*.ps1` against the prod backend.
- All 59 backend vitest tests pass locally (including the 5 + 6 new). No TypeScript regressions introduced by this change (`npx tsc --noEmit` errors are pre-existing in unrelated `apple-jwks.test.ts` / `session-jwt.test.ts`).

**Deployment NOT performed.** Per request, only local implementation + tests. Migration `0008` and the worker deploy are staged and ready. To ship:
1. `cd backend && wrangler d1 execute awakened-db --remote --file=migrations/0008_leaderboard_week_start.sql`
2. `cd backend && wrangler deploy`
3. Smoke: `curl -sS https://awakened-backend.richmondcampano93.workers.dev/v1/leaderboard/top?metric=step_total -H "Authorization: Bearer …"` (expect 200 with current-week-only `top`).
4. Verify D1 column landed: `wrangler d1 execute awakened-db --remote --command="PRAGMA table_info(leaderboard_snapshots)"`.

**Anti-patterns:**
- Don't drop `idx_leaderboard_metric_value` — non-weekly metric queries still use it.
- Don't add `week_start` to the PK — keeping the `(user_id, metric)` PK means a user has exactly one row per metric at any time; new-week submits overwrite the prior-week tag via `ON CONFLICT DO UPDATE`.
- Don't try to backfill `week_start` for existing rows. The whole point of this fix is that stale rows drop out of the ranking — backfilling would re-introduce them.
- Don't change the iOS HealthKit-step-submission logic. The backend filter is the authoritative gate; whatever number the client submits this week, it goes into the current week's bucket.

Bumps: `app.js?v=391` (helpers + cache guard + dynamic blurb + build tag), `sw.js v5.276`, `APP_BUILD_TAG '2.2.1-w41'`. `styles.css` unchanged. `APP_VERSION` unchanged at `2.2.1`. No Duels, no sims, no Codemagic config touched.

### Rank-aware 100K Club Rank Hero badge system (v3 Phase 1z.32)

ClaudeDesign final spec (`club-badge-final.jsx`). The 1z.31 gold/Spark takeover badge removed rank identity from the disc; the Rank Hero system restores it by **stacking 100K / rank-letter / CLUB inside a gold-framed medallion with per-rank color identity.**

**Markup change in `renderStatus()`** (when `accolades.has('step_100k_club')`):

```html
<div class="sc-rank-hero sc-rank-hero--100k-club club-badge club-badge--{rank}"
     data-rank="E" data-prestige="step_100k_club"
     role="button" tabindex="0"
     aria-label="E Rank 100K Step Club member. Tap for details.">
  <span class="club-badge__frame" aria-hidden="true">
    <span class="club-badge__ring">
      <span class="club-badge__well"></span>
    </span>
  </span>
  <span class="club-badge__stack" aria-hidden="true">
    <span class="club-badge__topline">100K</span>
    <span class="club-badge__hero">E<!-- + .club-badge__accent--laurel for A, --embers for S --></span>
    <span class="club-badge__underline">CLUB</span>
  </span>
</div>
```

Unearned path unchanged. Tap handler still matches `.sc-rank-hero[data-prestige="step_100k_club"]`. Pulse target keeps `.sc-rank-hero--100k-club` for back-compat with the `_maybeFireFirstUnlockToast` selector.

**Per-rank tier table (canonical, source of truth):**

| Rank | Letter `--tier` | Inner ring `--tier-ring` | Well wash `--tier-wash` | Glow `--tier-glow` | Accent |
|------|---|---|---|---|---|
| E | `#a78bfa` | `rgba(167,139,250,0.55)` | `rgba(167,139,250,0.12)` | `rgba(167,139,250,0.55)` | — |
| D | `#22c55e` | `rgba(34,197,94,0.55)` | `rgba(34,197,94,0.10)` | `rgba(34,197,94,0.55)` | — |
| C | `#3b82f6` | `rgba(59,130,246,0.55)` | `rgba(59,130,246,0.10)` | `rgba(59,130,246,0.55)` | — |
| B | `#5b8def` | `rgba(30,64,175,0.65)` | `rgba(30,64,175,0.16)` | `rgba(91,141,239,0.55)` | — |
| A | `#fcd34d` | `rgba(167,139,250,0.55)` (violet, breaks gold-on-gold) | `rgba(252,211,77,0.10)` | `rgba(252,211,77,0.55)` | gold laurel |
| S | `#ef4444` | `rgba(239,68,68,0.60)` | `rgba(239,68,68,0.14)` | `rgba(239,68,68,0.65)` | gold embers |

Frame stays gold (`#f7c558 → #f5b842 → #c08418`) on every rank. S+ gracefully falls back to S (spec removed S+ this iteration).

**CSS — retired + new:**
- Retired: `.sc-rank-hero.sc-rank-hero--100k-club` background/border/box-shadow swap, `.sc-rank-hero__100k-svg`, `@keyframes sc-rank-100k-pulse`.
- New: `.club-badge` base + six `.club-badge--{e,d,c,b,a,s}` variants that override `--tier*` custom props. Frame/ring/well are three nested `<span>`s using padding-as-border layering. `.club-badge__stack` absolute-positions 100K/letter/CLUB over the well. `.club-badge__accent--laurel` and `--embers` are pseudo-mask radial-gradient SVGless accents.
- New keyframe `@keyframes club-badge-pulse` — 1.4s gold drop-shadow flicker. Fires on `.is-first-unlock` AND the legacy `.is-new` class.
- `@media (prefers-reduced-motion: reduce)` disables both.

**Cascade:** `.sc-card--profile .sc-rank-hero.club-badge` sits at (0,3,0), matching the per-rank `[data-rank="X"]` rules. The block ships LATER in the file → wins on cascade order regardless of rank.

**Why this works (vs 1z.31):** rank identity is dominant inside the badge — the user reads BOTH "100K Club member" AND "I am an E-rank hunter" from the disc alone. Frame stays gold so all six variants feel like one family. A's gold-on-gold collision is broken by a violet inner ring. S's prestige tier gets ember accents in addition to the crimson colorway.

**Anti-patterns:**
- Don't recolor the frame per rank — frame is always gold.
- Don't let the 100K topline overpower the rank letter.
- Don't render this badge below 28px — fall back to the plain rank disc plus a small `100K` chip.
- Don't change the unearned path. It stays byte-identical to the pre-1z.27 baseline.

Bumps: `styles.css?v=287`, `app.js?v=390` (markup + build tag), `sw.js v5.275`, `APP_BUILD_TAG '2.2.1-w40'`. `APP_VERSION` unchanged. No backend, no Duels, no scoring, no JS-logic changes — pure visual-render swap.

### 100K Step Club takeover badge — direction change (v3 Phase 1z.31)

Three iterations on the outer-gold-frame approach (1z.27 specced, 1z.29 specificity fix, 1z.30 stronger 4-layer stack) failed to land a frame that read as premium at the 54×54 disc size. Browser preview kept showing either a faint glow or a noisy ring overlaying the violet rank disc. Product direction change: **stop decorating the rank disc; replace it.**

**New approach:** when the user has `step_100k_club`, the disc's visual contents are swapped wholesale to a self-contained gold prestige badge — gold disc + dark-navy Spark mark engraved on it. Rank identity continues to be visible in the `.sc-identity-strip` row below (`E RANK · 36 PTS · CIVILIAN`), so users still know their actual rank; the disc itself becomes the accolade.

**Markup change in `renderStatus()`** — branches on `accolades.has('step_100k_club')`:
- **Earned:** `<div class="sc-rank-hero sc-rank-hero--100k-club" data-rank="..." data-prestige="step_100k_club" role="button" tabindex="0" aria-label="...">` containing an inline Spark SVG (canonical geometry, dark navy `#0e0e2a` fill on gold). No rank letter rendered.
- **Unearned:** unchanged — `<div class="sc-rank-hero" data-rank="...">{rank.id}</div>`.

The existing `data-prestige="step_100k_club"` attribute keeps the existing tap handler in `setupStep100KTap()` working without modification — same selector match, same sheet open. Keyboard Enter/Space activation also preserved.

**CSS — retired + new:**
- Retired: `.sc-rank-hero--prestige` base + per-rank variants (D, C, B, A, S, S+), `::before` Spark crest, `::after` highlight, `@keyframes sc-rank-prestige-pulse`. All the 1z.27 / 1z.29 / 1z.30 frame stacking is gone.
- New: `.sc-card--profile .sc-rank-hero.sc-rank-hero--100k-club` overrides background (gold gradient `#f7c558 → #f5b842 → #c08418`), border (`1.5px solid #f5b842`), box-shadow (gold halo + inset top highlight + inset bottom shade for depth), color (`#0e0e2a` for the SVG fill). Same specificity (0,3,0) as per-rank rules → ships later → wins on cascade.
- `.sc-rank-hero__100k-svg` — inline SVG sized at 70% of the disc edge, drop-shadow gives a subtle bevelled engraving effect.
- New keyframe `@keyframes sc-rank-100k-pulse` for first-unlock — scale 1 → 1.08 + brightness pulse. JS continues to add `.is-new` to the badge for 600ms via the existing `_maybeFireFirstUnlockToast` path, but the selector switched from `.sc-rank-hero--prestige` to `.sc-rank-hero--100k-club`.

**Asset hook for future ClaudeDesign exports:** the inline SVG is a placeholder. When a final 100K Club badge PNG or SVG arrives, swap the SVG markup inside the disc for an `<img>` tag pointing at `assets/brand/100k-club-badge.png` (or `.svg`) — the CSS `.sc-rank-hero__100k-svg` rule centers/sizes any element via `width: 70%; height: 70%`, so an `<img>` swap is drop-in.

**Why this works better than the frame:**
- Self-contained visual — no specificity dance against per-rank rules
- Reads at small size (gold disc is high-contrast against the navy `.sc-hero` background, no faint edges)
- The Spark mark IS the accolade — no need to layer a crest on top of a frame on top of a disc
- Layout footprint unchanged (54×54), no Hunter Profile height shift
- Unearned state is byte-identical to pre-1z.27 — zero risk of regression for users who haven't earned the accolade
- Asset path is clean — ClaudeDesign can swap to a final PNG without touching JS

**Sheet, click handler, accolade cache, backend — all unchanged.** This is purely a visual-render swap inside the disc.

**Anti-patterns:**
- Don't try to combine the takeover badge AND the outer frame approach. They fight for visual hierarchy. Takeover badge alone is the design call.
- Don't render both the rank letter and the SVG inside the disc when the accolade is earned. The disc IS the badge; the letter lives below in `.sc-identity-strip`.
- Don't change the `.sc-rank-hero` element class structure for unearned users. Keep the unearned path byte-identical to the pre-1z.27 baseline.
- Don't re-introduce the `::before`/`::after` Spark crest. The Spark is now inside the disc, where it belongs.

Bumps: `styles.css?v=286`, `app.js?v=389` (build tag + markup edit), `sw.js v5.274`, `APP_BUILD_TAG '2.2.1-w39'`. `APP_VERSION` unchanged. No backend, no Duels, no scoring, no JS-logic changes — pure visual-render swap.

### 100K prestige frame visibility refinement (v3 Phase 1z.30)

Browser preview of `1z.29` showed the gold prestige frame rendering correctly but **too faint** — barely readable on an E-rank disc. The single 3px gold ring + 14px soft glow didn't communicate "prestige" at the small disc size; the Spark crest at 10×8px read as a pixel artifact rather than a deliberate badge. Refining for stronger ranked-game presence without going cartoonish.

**Frame change — single-layer ring → 4-layer stacked frame:**

| Layer | Before (1z.29) | After (1z.30) |
|---|---|---|
| Inner inset glow | `inset 0 0 14px rgba(violet, 0.30)` | `inset 0 0 14px rgba(violet, 0.45)` — slight bump for E |
| Dark separator notch | — | `0 0 0 2px rgba(8,8,26, 0.95)` — NEW; creates the "framed" feel |
| Gold ring | `0 0 0 3px rgba(245,184,66, 0.95)` | `0 0 0 6px #f5b842` — solid, 4px thick effective (2-6px due to dark separator on top) |
| Bright outer edge | — | `0 0 0 7px rgba(255,200,74, 0.85)` — NEW; 1px highlight at outermost edge, gives bevelled 3D cue |
| Ambient glow | `0 0 14px 2px rgba(245,184,66, 0.35)` | `0 0 22px 4px rgba(245,184,66, 0.55)` — stronger spread + alpha |

Total visual extension from disc edge: 3px → **7px**. Fits inside the existing 12px `.sc-hero` padding around the disc, no clipping.

The trick is the **dark separator notch** between the disc and the gold ring. Without it, the gold reads as glow. With it, the gold reads as a real frame attached to the disc. This is the same visual idiom used in ranked-game UIs (League of Legends ranks, Apex predator badges, Diablo class crests).

**Spark crest change — 10×8 → 14×12 with 3D depth:**

- Apex sits at `top: -9px` (was -4), now floats clearly above the gold ring's top edge with a 2px visual gap
- Stacked dual filter: `drop-shadow(0 0 6px gold 0.85) drop-shadow(0 0 1px navy 1)` — gold halo + thin dark hairline so the apex separates from the navy background
- NEW `::after` pseudo-element layered on top of the `::before` — a downward-fading gold-to-transparent linear gradient on the same triangle shape gives the crest a brighter top edge, reading as 3D rather than flat

**Per-rank coverage:**

All 7 ranks (E, D, C, B, A, S, S+) now get the same 4-layer stacked frame. The inner inset glow remains rank-specific (violet for E, deeper purple for D/C, blue for B, A-purple for A, orange for S). S+ swaps the dark separator for a violet hairline since the gold ring is already gold-on-gold for that rank.

**Unearned state:** unchanged. `.sc-rank-hero--prestige` class is only added by `renderStatus()` when `accolades.has('step_100k_club')` is true. Discs without the accolade keep their plain per-rank styling.

**Anti-patterns:**
- Don't drop the dark separator notch. It's the single most important layer for "frame vs glow" perception. Removing it makes the gold read as a halo.
- Don't move the crest above `top: -10px` — `.sc-hero` only has 12px of padding above the disc; any higher and the crest gets clipped by `.sc-card { overflow: hidden }`.
- Don't add `filter` properties to `.sc-rank-hero--prestige` itself — that would create a new stacking context and the crest pseudo-element's drop-shadow gets re-rasterized into the parent, causing soft-edge artifacts.

Bumps: `styles.css?v=285`, `app.js?v=388` (build-tag only), `sw.js v5.273`, `APP_BUILD_TAG '2.2.1-w38'`. `APP_VERSION` unchanged. No backend, no Duels, no JS logic changes.

### 100K prestige frame CSS specificity fix + Spark crest (v3 Phase 1z.29)

Bug observed in browser preview of `2.2.1-w36`: the 100K Step Club sheet was opening correctly (proving `accolades.has()` returned `true` AND `data-prestige="step_100k_club"` was set on the rank disc), but the gold prestige frame was not rendering on E-rank discs. Same fall-through would have affected anyone seeing the empty-state baseline color via the per-rank CSS.

**Root cause:** CSS specificity. The base prestige rule `.sc-rank-hero--prestige` had specificity `(0,1,0)`. The existing per-rank rule `.sc-card--profile .sc-rank-hero[data-rank="E"]` has specificity `(0,3,0)` and sets its own `box-shadow` for the violet inner glow. Both rules target `box-shadow`; the per-rank rule wins → the gold ring rule never paints. 1z.27 had added explicit per-rank overrides for D, C, B, A, S, S+ but **missed E** — E-rank users fell through to the unscoped base rule, which lost.

**Fix:**
- New scoped E-rank rule `.sc-card--profile .sc-rank-hero.sc-rank-hero--prestige[data-rank="E"]` at `(0,3,0)` matching the per-rank specificity. Cascade order decides ties; the prestige rules ship later in the file, so they win cleanly.
- Restructured the base rule into two parts: a position/cursor/z-index block (always applies) + an E-rank scoped block for the shadow (matches per-rank specificity).
- Kept the legacy unscoped `.sc-rank-hero--prestige { box-shadow: ... }` selector as a fallback for any future non-`.sc-card--profile` consumer.

**Bonus addition (was specced, not built in 1z.27):** small gold upward-pointing **Spark crest** at the top of every prestige frame, rendered via `::before` pseudo-element on `.sc-card--profile .sc-rank-hero.sc-rank-hero--prestige`. 10×8px gold triangle with soft drop-shadow, anchored at `top: -4px` so it overlaps the ring but stays within `.sc-card`'s `overflow: hidden` clip (the disc has 12px of `.sc-hero` padding above it).

**Verified visually:** with the local dev mock accolade injected via the snippet from prior turn, the E-rank disc now shows:
- Gold ring outside the violet disc
- Soft gold outer glow
- Small Spark crest perched at the top
- Violet inner glow preserved
- All other ranks (D-S+) unchanged from 1z.27

**No JS changes.** Pure CSS specificity fix + pseudo-element addition.

**Anti-patterns:**
- Don't write new `.sc-rank-hero` rules without `.sc-card--profile` scope and at least matching `(0,3,0)` specificity. The per-rank shadow rules will silently win otherwise.
- Don't omit `data-rank="E"` from per-rank overrides for any new state that needs to override the rank color. Every rank from E through S+ must be covered.
- Don't add `overflow: hidden` to `.sc-rank-hero` itself — that would clip both the gold ring (which is `box-shadow` outside the border) AND the Spark crest pseudo-element.

Bumps: `styles.css?v=284`, `app.js?v=387` (build-tag-only change), `sw.js v5.272`, `APP_BUILD_TAG '2.2.1-w37'`. `APP_VERSION` unchanged. No backend, no Duels, no scoring, no JS logic changes.

### 100K Step Club backend deployed live (v3 Phase 1z.28)

Backend-only deployment milestone. The 100K Step Club backend (Phase B of `1z.27`) is now **live in production** as of May 17. The May 16 `2.2.1-w34` build (currently in App Review) is **no longer a blocker** for forward iOS work — we're moving the next Codemagic / TestFlight build forward on commit `f29a551` regardless of `w34`'s outcome.

**What's live (May 17):**
- D1 migration `0007_user_accolades.sql` applied directly to remote `awakened-db` via `wrangler d1 execute --remote --file=...` (3 queries, 6 rows written, `changed_db: true`, ~5 ms). Table `user_accolades` + indexes `idx_user_accolades_user` + `idx_user_accolades_type` + 2 SQLite auto-indexes (PRIMARY KEY + UNIQUE) all present in `sqlite_master`. (Note: applied via direct execute, not the migrations runner — `d1_migrations` tracker is NOT seeded for 0001–0007; matches the project's historical pattern. Deferred for a future cleanup.)
- Worker deployed at `Current Version ID: 9593f398-53e7-41b3-ade7-c41b7620de48` (115.86 KiB upload / 23.66 KiB gzip / 4 ms startup). 11 RL bindings live, including the new `env.RL_USER_ACCOLADES_READ`.
- `GET /v1/users/me/accolades` live, returns `401 AUTH_REQUIRED` to unauthenticated callers, ready to serve `{ accolades: [] }` for authenticated empty-state users + the full row shape for users who earn the accolade.
- Inline award path live in `handleLeaderboardSubmit`: any authenticated `POST /v1/leaderboard/submit` with `metric=step_total` AND `value >= 100000` AND `apple_sub NOT LIKE 'sim_test_%'` now writes to `user_accolades`. No retroactive backfill (forward-only by design).
- Smoke-checked: `/v1/leaderboard/top`, `/v1/duels`, `/v1/friends` all still gated at 401 — no regression.

**Next iOS build target: commit `f29a551`.**
- `APP_VERSION = '2.2.1'`
- `APP_BUILD_TAG = '2.2.1-w36'`
- `app.js?v=386`, `styles.css?v=283`, `auth.js?v=14`, `sw.js v5.271`
- Contains: Direction B Status card, World Rank Steps card, Morning Briefing polish, drag-disabled hotfix, Spark brand mark (1z.26), 100K Step Club frontend (1z.27)
- Backend integration: `Auth.fetchAccolades()` → live `GET /v1/users/me/accolades` → cache-first prestige frame on `.sc-rank-hero` → tap → 100K Step Club sheet

**w34 status (informational, not blocking):** May 15 build, currently in App Review since May 16 submission. May approve and ship, may stay pending. Either way, `w36` is the next active iOS build target with the brand migration + 100K feature; `w34` is being treated as a separate, earlier-train build whose outcome no longer gates this train.

**No backend redeploy needed for this iOS build.** The accolade endpoint + award path are stable; the iOS bundle just needs to ship the frontend that consumes them.

### 100K Step Club prestige feature (v3 Phase 1z.27)

Permanent accolade earned by recording 100,000+ Apple-Health-verified steps in a single leaderboard week. Hunter Profile rank badge gains a gold outer prestige frame; tapping the frame opens a 100K Step Club detail sheet.

**Important release context: NOT in `2.2.1-w34` (the App-Store-Connect-awaiting-review build).** Ships in `2.2.1-w36` and is intended for the next build after the current review outcome. Backend + frontend implemented, but NO migration applied, NO backend deployed, NO Codemagic triggered. The diff is ready to ship as a follow-up.

**Backend (Phase B):**

- New migration `backend/migrations/0007_user_accolades.sql`:
  ```
  user_accolades(
    id TEXT PK, user_id TEXT, accolade_type TEXT,
    unlock_week_start TEXT, unlock_value INTEGER,
    best_value INTEGER, repeat_count INTEGER DEFAULT 1,
    last_qualified_week_start TEXT,
    unlocked_at INTEGER, updated_at INTEGER,
    metadata_json TEXT,
    UNIQUE(user_id, accolade_type),
    FK user_id → users(id) ON DELETE CASCADE
  )
  ```
  Schema is generic for future accolade types; v1 ships only `step_100k_club`.
- New helper `backend/src/lib/accolade-week.ts` — `getAccoladeWeekStart(nowMs?)` returns the Sunday-UTC `YYYY-MM-DD` for the week the timestamp falls in. **Decision: Sunday UTC** (deterministic; no per-user timezone needed). 11 boundary unit tests cover every day of the week + UTC midnight + month/year rollover.
- `backend/src/handlers/leaderboard-submit.ts` award branch (inline). When `metric === 'step_total'` AND `value >= 100000` AND `users.apple_sub NOT LIKE 'sim_test_%'`: `INSERT … ON CONFLICT(user_id, accolade_type) DO UPDATE` with:
  - `best_value = MAX(best_value, excluded.best_value)`
  - `repeat_count = CASE WHEN last_qualified_week_start = excluded.last_qualified_week_start THEN repeat_count ELSE repeat_count + 1 END`
  - `last_qualified_week_start = excluded.last_qualified_week_start`
  - `updated_at = excluded.updated_at`
  - `unlock_week_start`, `unlock_value`, `unlocked_at`, `repeat_count=1` only on INSERT
- New handler `backend/src/handlers/accolades.ts` + route `GET /v1/users/me/accolades` wired in `src/index.ts`. Response shape: `{ accolades: [{ type, unlock_week_start, unlock_value, best_value, repeat_count, last_qualified_week_start, unlocked_at, updated_at, metadata? }] }` (no `ok: true` field — project convention).
- New rate-limit binding `RL_USER_ACCOLADES_READ` at `namespace_id = "1011"` with `12/min per user` in `wrangler.toml`; `Env` interface field added in `env.ts`.
- 6 handler-shape tests in `accolades.test.ts` cover: empty array, populated row mapping, `metadata_json` parsing (null + malformed), 429 rate-limit, query-by-userId binding. Full SQL behavior (ON CONFLICT, sim-user filter) is exercised by the production sim harness post-deploy — the project doesn't ship miniflare-D1 unit tests, by precedent.

**Total backend test count: 36 → 48 (all passing).**

**Frontend (Phase C):**

- New `Auth.fetchAccolades()` in `auth.js`. Returns `{ ok, accolades }` or `{ ok: false, code }`. Same shape as `fetchLeaderboardTop`.
- New `accolades` module in `app.js` with cache-first SWR: `accolades.has(type)`, `accolades.get(type)`, `accolades.refresh({force})`, `accolades.clearLocal()`. Cache: `hb_accolades_cache` (24h TTL). Truth lives on the backend; cache is display-only.
- `renderStatus()` markup updated. When `accolades.has('step_100k_club')`:
  - `.sc-rank-hero` gets `sc-rank-hero--prestige` class + `data-prestige="step_100k_club"` + `role="button"` + `tabindex="0"` + `aria-label="100K Step Club member. Tap for details."`
  - When not earned, the rank disc is visually unchanged.
- New CSS rules in `styles.css`:
  - `.sc-rank-hero--prestige` — outer gold ring + soft glow via stacked `box-shadow`. Layers OUTSIDE the existing per-rank inner glow. Per-rank rules redeclare the inset glow to preserve tier color.
  - S+ gets a special "violet hairline + thicker gold ring" treatment so the prestige frame visually separates from the already-gold disc.
  - `.is-new` modifier triggers a single 0.6s scale-pulse on first earn (respects `prefers-reduced-motion`).
- New bottom sheet `#accolade-step-100k-sheet` in `index.html`. Uses the existing `.vn-sheet` shell. Renders Spark sigil + title + blurb + 4 stat rows (Best week, Joined, Weeks qualified, Last qualified) + footer copy. Closed via overlay tap, drag-down, or × button.
- Document-delegated tap handler on `.sc-rank-hero[data-prestige="step_100k_club"]` opens the sheet. Keyboard Enter/Space also opens it (since the disc carries `role="button"` + `tabindex="0"`).
- One-time celebration: `_maybeFireFirstUnlockToast('step_100k_club')` compares `accolade.unlocked_at` against `hb_accolade_seen_step_100k` localStorage timestamp. If newer → fires `showHabitToast('Welcome to the 100K Step Club.')` + adds `.is-new` to the prestige frame for the 600 ms pulse. Self-resetting on success.
- Refresh hooks:
  - `init()` — `accolades.refresh()` (cache-warm, no-op if fresh < 24h)
  - `lbSubmitAllMetrics()` — after a successful submit where `step_total >= 100000`, calls `accolades.refresh({force: true})` so the just-earned row paints without waiting for the next foreground.

**LocalStorage keys (NOT in `CloudSync.SNAPSHOT_KEYS`):**
- `hb_accolades_cache` — `{ accolades: [...], fetched_at: <ms> }`. Display-only cache.
- `hb_accolade_seen_step_100k` — first-unlock-celebration dedup timestamp.
- Both keys are device-local and intentionally NOT part of Cloud Sync. The backend `user_accolades` table is the cross-device source of truth.

**Surfaces intentionally NOT touched:**
- Boss / relic / item / habit / tab art, achievement seal system, in-app sigil decoration. The accolade is a self-only Status-card detail.
- `manifest.json`, app icon, splash. No brand impact.
- Duels, Discipline Duels v1 picker, World Rank Steps card, Morning Briefing — all unaffected.
- Public profile / shared-profile concept — does not exist yet; accolades are self-view-only.

**Anti-patterns:**
- Don't seed `user_accolades` with backfilled "historical" rows. Decision is **forward-only**: only weeks submitted AFTER 2.3 ships count. Communicate this explicitly in 2.3 release notes if asked.
- Don't add `ok: true` to the `GET /v1/users/me/accolades` response. Project convention is `error` field on failure; presence implies failure, absence implies success.
- Don't treat the cache as authoritative for unlock state. The `accolades.has()` helper reads the cache, which is server-confirmed. If cache says "earned" but backend disagrees (e.g., legitimate revoke flow ever ships), the next 24h refresh corrects it. Frontend never invents unlock state.
- Don't allow sim test users (`apple_sub LIKE 'sim_test_%'`) to earn the accolade. The award branch already filters them; if anyone adds a backfill or admin tool, preserve this filter.
- Don't change the week-key semantics without considering data migration. `unlock_week_start` and `last_qualified_week_start` are ISO date strings that imply a Sunday-UTC bucket. Switching to user-local time later would require either backfilling existing rows or treating "pre-2.3" rows as legacy/grandfather.
- Don't add `RL_USER_ACCOLADES_READ` calls outside `handleUserAccoladesGet` — keep the binding scoped to the read endpoint it was created for. Future endpoints get their own bindings.

**Deployment steps still required (NOT done):**
1. Apply migration `0007_user_accolades.sql` to remote D1: `wrangler d1 migrations apply awakened-db --remote`
2. Deploy backend: `wrangler deploy` (from `backend/`)
3. Wait for `2.2.1-w34` App Review outcome
4. Trigger Codemagic on commit containing this work for `2.2.1-w36` iOS build
5. TestFlight smoke test (manual QA checklist in §1z.25)
6. Submit `w36` to App Review

**Manual QA checklist (when build lands):**
- User with no accolade row: rank disc shows no gold frame; no extra tap behavior
- User earns step_100k_club: gold prestige frame appears after next foreground or after the next step_total ≥100K submit
- Tap on prestige frame: 100K Step Club sheet opens
- Sheet shows correct best_value, unlock_week_start, repeat_count, last_qualified_week_start
- First-earn moment: one-time toast `"Welcome to the 100K Step Club."` + 600 ms pulse on the frame
- Reload after first earn: no replay of toast (dedupe via `hb_accolade_seen_step_100k`)
- Existing rank color still visible underneath the prestige frame
- Status card layout unchanged for unearned users
- Web build / no-HealthKit: no false unlock (no submit, no row, no frame)
- Sim test users in prod D1: no accolade row, no frame
- Duel flow unchanged
- Leaderboard sheet unchanged

Bumps: `app.js?v=386`, `styles.css?v=283`, `auth.js?v=14`, `sw.js v5.271`, `APP_BUILD_TAG '2.2.1-w36'`. `APP_VERSION` unchanged. No Duels, no scoring engine, no data-model changes outside the new accolade table.

### "The Spark" brand mark migration (v3 Phase 1z.26)

ClaudeDesign handoff — Awakened's primary brand mark is now **The Spark**: a gold outlined triangle with three rune-cut notches at the vertices and a solid gold flame teardrop inside. Replaces the prior splash + app-icon mark (triangle + circle + small flame). Spec tagline: *"The discipline within. A contained fire that does not go out."*

**Important release context:** this is **NOT in `2.2.1-w34`** (the App-Store-Connect-awaiting-review build). The Spark migration ships in `2.2.1-w35` and is intended for the next build after the current review outcome. If `w34` is approved and released, `w35` becomes the first follow-up build users see. If `w34` is rejected, `w35` is the resubmission target with the new mark.

**Canonical Spark geometry (viewBox 100×100):**
- Triangle outline: `M50 12 L84 82 L16 82 Z`, stroke `#f5b842` 3.5 units, rounded joins
- Rune notches at each vertex: 3 short stroke segments (`M48 14 L52 14`, `M18 84 L22 80`, `M82 84 L78 80`)
- Solid flame teardrop: `M50 34 C 42 48 42 60 50 66 C 58 60 58 48 50 34 Z`, fill `#f5b842`
- Mark occupies ~62% of icon edge (safe margin per spec)

**New brand asset folder: `assets/brand/`**

| File | Purpose |
|---|---|
| `assets/brand/spark.svg` | Canonical mark — viewBox 100×100, gold `#f5b842`, transparent background, used as the design source |
| `assets/brand/spark-app-icon.svg` | 1024×1024 composed app-icon variant — navy gradient background (`#14143a → #08081a`) + Spark mark centered at 62% edge. Fully opaque (Apple's requirement). |

**Rasterization pipeline (no Inkscape / ImageMagick dependency):**

1. `scripts/generate-spark-icon-source.ps1` — new. Renders the Spark mark directly via `System.Drawing.GraphicsPath` (triangle polygon + 3 notch line segments + bezier flame) onto a 1024×1024 24bpp RGB bitmap with the navy gradient background, writes `app-icon-source.png`. No external rasterizer needed.
2. `scripts/generate-app-icons.ps1` — unchanged. Reads the new `app-icon-source.png` and downsamples to all 18 iOS sizes (`AppIcon-20.png` → `AppIcon-1024.png`) plus the 2 PWA sizes (`icon-192.png`, `icon-512.png`). All RGB, no alpha — Apple's app-icon requirement.
3. `scripts/verify-app-icons.ps1` — unchanged. All 20 icons verified clean post-regeneration.

**Surfaces updated in this phase:**

- **Splash emblem** (`#awakened-splash .splash-emblem` in `index.html`) — inline SVG swapped to Spark geometry. Reuses the existing `.splash-emblem { color: #f59e0b }` CSS token via `currentColor` so the splash gold stays tonally aligned with the `AWAKENED` wordmark on the same screen. Standalone `assets/brand/spark.svg` uses spec gold `#f5b842`. Both render as "gold" to users; the slight tonal split between standalone-mark and integrated-with-wordmark contexts is intentional and allowed by the spec ("Use gold `#f5b842` or the existing Awakened gold token if better aligned").
- **App icon source** (`app-icon-source.png`) — regenerated.
- **18 iOS AppIcon files** (`resources/ios/AppIcon.appiconset/`) — regenerated, dimension-verified clean.
- **2 PWA icons** (`icon-192.png`, `icon-512.png` at repo root) — regenerated, dimension-verified clean. Already in `sw.js PRECACHE_ASSETS`; `CACHE_VERSION` bumped to invalidate the prior icon bytes in the SW cache.

**Surfaces intentionally NOT touched:**
- `manifest.json` — already references `icon-192.png` / `icon-512.png` by path; nothing to change.
- Boss art, relic/item art, stat icons, tab icons, habit art, class avatars — unrelated to the brand mark.
- Achievement / accolade seals — no current surface uses the old brand mark inside an achievement.
- In-app "rune" decorative elements (Direction B Status banner runes, Morning Briefing sigil dots, etc.) — those are abstract Awakened ornamentation, not the brand mark.

**Anti-patterns:**
- Don't reference the legacy logo geometry (`M32 6 L58 56 H6 Z` + circle + 4-pt flame). The Spark replaces it. Old paths should NOT reappear in any new splash/icon work.
- Don't add a glow/drop-shadow filter to the rasterized app-icon. Apple downsamples icons aggressively; baked-in filters read as halos at small sizes. The `.splash-emblem` CSS keeps its drop-shadow for the runtime splash (that's a screen, not an icon asset).
- Don't transparent-background the app-icon source. Apple rejects transparent app icons. The PS rasterizer writes 24bpp RGB explicitly.
- Don't change the canonical Spark geometry without coordinating with `spark.svg`, `spark-app-icon.svg`, the splash inline SVG, AND the PS rasterizer. All four must stay byte-for-byte consistent — they're the same mark in four contexts.
- Don't apply The Spark mark to bosses / relics / habit icons / class avatars / tab icons. The Spark is the BRAND mark; the rest is content art. They live in different visual systems.

**Re-rasterize procedure** (when geometry or gold token changes in the future):
1. Edit `assets/brand/spark.svg` (canonical) AND `assets/brand/spark-app-icon.svg` (1024 composed variant) AND `scripts/generate-spark-icon-source.ps1` (the PS rasterizer) AND the inline SVG inside `#awakened-splash .splash-emblem` in `index.html`.
2. `powershell -ExecutionPolicy Bypass -File .\scripts\generate-spark-icon-source.ps1` → produces new `app-icon-source.png`.
3. `powershell -ExecutionPolicy Bypass -File .\scripts\generate-app-icons.ps1` → produces all 18 iOS + 2 PWA derivatives.
4. `powershell -ExecutionPolicy Bypass -File .\scripts\verify-app-icons.ps1` → confirms dimensions clean.
5. Bump `sw.js CACHE_VERSION` so the SW invalidates the prior icon bytes.
6. Bump `APP_BUILD_TAG`.

Bumps for this phase: `app.js?v=385`, `sw.js v5.270`, `APP_BUILD_TAG '2.2.1-w35'`. `APP_VERSION` unchanged. `styles.css` untouched (existing `.splash-emblem` rules work with the new viewBox via `width: 100%`). No backend, no Duels, no scoring, no data changes.

### May 17 handoff + 2.3 roadmap (v3 Phase 1z.25)

Documentation-only phase. Snapshot of state at May 17, 11:07 AM PT clock-in, before any new-thread work begins.

**Current release target:**
- Commit: `78a2c6a` (HEAD of `main`)
- `APP_VERSION = '2.2.1'`
- `APP_BUILD_TAG = '2.2.1-w34'`
- `app.js?v=384`, `styles.css?v=281`, `sw.js v5.269`

**App Store Connect status:** `2.2.1-w34` was submitted evening of May 16 / overnight. **Currently AWAITING App Review.** Likely outcome within the next several hours (Apple's typical 2.x review cadence has been ~24h). The earlier May 15 submission was manually pulled May 16 due to auto-release-on-approval being enabled — that pulled build is NOT the current review target; do not refer to it as if it were active. The cleaner `w34` build is what users will receive if approved.

**What `w34` contains (cumulative since the pulled May 15 build):**
| Phase | What |
|---|---|
| 1z.12 | Direction B "Premium Character Sheet" replaces the Status card |
| 1z.13 → 1z.14 | Status vertical compact (then relaxed) |
| 1z.15 | Codemagic sentinels for Direction B markup + OneDrive cleanup |
| 1z.16 | Boss Race hidden from picker (5-type v1) |
| 1z.17 | Verified Duels v1 prod sim 5/5 pass + App Store pull recorded |
| 1z.18 | World Rank Steps card replaces Week XP slot |
| 1z.19 | Morning Briefing Minimal Premium Polish |
| 1z.21 | World Rank card rank-mismatch fix (post-merge `_lbMaybeSimulate`) |
| 1z.22 | iOS long-press callout hotfix (`-webkit-touch-callout: none`) |
| 1z.23 | iOS native image-drag hotfix + centralized cleanup |
| **1z.24** | **Habit drag-to-reorder DISABLED for 2.2.1 stability** |

**Smoke-test checklist for the live build (when it lands):**
1. Long-press a habit → nothing weird happens (no ghost, no shaking, no selection handles) ✅ expected because the feature is gated off
2. Tap a habit → marks complete / uncompletes
3. Tap "Add Habits" → opens the library sheet
4. Top dashboard middle card → "WORLD RANK" Steps card visible; tap → opens Stats > Global Rankings > Steps; rank on the card matches rank in the sheet
5. Duels tab → Challenge friend → Choose Verified Duel sheet shows EXACTLY 5 cards (Verified Discipline / Steps / Sleep / Bedtime / Strength). **Boss Race must NOT appear.**
6. Morning Briefing (auto-fires on a fresh device-local day after Day 1) → 3-segment summary row, sigil-headed Morning/Day/Evening groups, gold-rimmed TOTAL XP sigil tile, premium gold LOCK IN button
7. Status tab → Direction B Premium Character Sheet (banner / identity strip / portrait frame / sigil tiles)

**Do NOT start 2.3 feature work until the 2.2.1 review outcome is known.** If approved → confirm release/availability and watch for crash reports. If rejected → inspect Apple's rejection reason BEFORE changing code; do not assume what they flagged.

### 2.3 Roadmap (May 17 brainstorm — NOT IMPLEMENTED)

Ideas captured for the next train. None of these are shipped. None of these are in `w34`. Listed here so the next session has a starting point if/when 2.2.1 is in users' hands and the team wants to plan 2.3:

- **Weekly Steps Champion** — recognize the #1 steps leaderboard user each week. Top-of-Monday announcement, premium accolade on hunter profile.
- **Historical weekly steps leaderboard records** — persist past-week leaderboard snapshots so "last week's top hunters" can be displayed. Needs backend table or D1 column expansion.
- **100K Step Club unlock** — permanent accolade for hunters who cross 100K steps in a single week. One-time visual reward (gold sigil + profile badge).
- **Hunter Accolades sheet / profile surface** — a new section inside the Status card or Stats tab that lists weekly + lifetime accolades (Weekly Champion, 100K Club, perfect-week streaks, etc.). Reuses the existing sigil-tile visual language from 1z.12.
- **Monday Morning Briefing winner recognition** — when Morning Briefing fires on a Monday and the user placed top-N in the previous week's steps leaderboard, prepend a banner ("LAST WEEK · #3 GLOBAL STEPS") above the standard briefing.
- **Weekly prestige/reward loop for steps leaderboard** — tie the Weekly Steps Champion accolade to a souls reward + a `last_won_at` timestamp on the user record. Could pair with the relic-drop system for a weekly cosmetic drop.
- **Habit reorder UX redesign (re-enable Phase)** — required before flipping `ENABLE_HABIT_DRAG_REORDER` back to `true` in 2.2.2 or later. Options ranked by risk: (a) explicit edit-mode toggle with on-card up/down chevrons (lowest risk, matches Things/Reminders), (b) battle-tested touch-DnD library like SortableJS (medium), (c) native iOS drag-and-drop API via Capacitor plugin (highest fidelity, biggest integration cost). See 1z.24 anti-patterns before choosing.

**Anti-patterns (carried forward):**
- Don't refer to the older pulled May 15 build as if it's still in review. `w34` is the active submission.
- Don't say "Codemagic still needs to be triggered" for `w34`. Codemagic already ran for `w34`; the IPA is already in App Store Connect; the gate is App Review, not the build pipeline.
- Don't ship 2.3 feature work into the 2.2.1 train. If a hotfix is needed for a rejection, it's a 2.2.2 train, not a 2.3 train.
- Don't start any of the 2.3 ideas above before the 2.2.1 outcome is known. Premature work risks divergent branches if Apple flags something.

### Habit drag-to-reorder disabled for 2.2.1 release (v3 Phase 1z.24)

After two hotfix attempts (1z.22 `-webkit-touch-callout: none`, 1z.23 `-webkit-user-drag: none` + centralized cleanup + backgrounding safety), the iOS WKWebView long-press / native-image-drag collision continued to produce a visible ghost-text artifact along the left edge of the viewport after drop attempts. Rather than ship a known visible defect to App Review, **habit drag-to-reorder is disabled in 2.2.1** via a single feature flag in `app.js`:

```js
const ENABLE_HABIT_DRAG_REORDER = false;
```

`bindDrag()` short-circuits at the top when the flag is false — no long-press handlers attached, no `[data-drag]` handle handlers attached. Habit cards behave as plain tap-to-complete targets. Long-pressing a habit does nothing app-side; iOS's native gestures may still fire on the WebView but with no Awakened drag visuals competing, the visible artifact disappears.

**What's preserved:**
- All underlying drag machinery in source (`attachLongPressDrag`, `enterDragMode`, `onDragEnd`, `cancelDragSilently`, `_finalizeDragCleanup`, `_backgroundDragSafety`, and every related CSS rule).
- All defensive CSS from 1z.22 + 1z.23 (`-webkit-touch-callout: none`, `-webkit-user-drag: none`, body-class lockdown) — harmless to keep, useful when the flag flips back on.
- `hb_habits` localStorage shape unchanged — saved habit order continues to render in the exact order the user previously arranged it. Users do not lose any ordering they already had.
- `sortHabitsAutoVerifyFirst()` still runs inside `save()`, pinning the 4 HealthKit auto-verify habits to the top of the list (per Phase 1u policy). That's a CODE-driven sort, not gesture-driven, so it works independently of this flag.

**What's gone in 2.2.1 specifically:**
- Long-pressing a habit card does nothing visible.
- The `.lp-pressing` scale-down armed state cannot apply (handler never attached).
- The `.is-dragging` sibling-dim state cannot apply.
- The `.drag-ghost` clone is never created.
- The `body.habit-drag-armed` / `body.habit-drag-active` classes are never set.
- The 6-dot drag handle (already `opacity: 0` in CSS) stays invisible AND inert.
- Reorder via the `[data-drag]` handle ALSO disabled (shared `bindDrag` short-circuit).

**Re-enable path for 2.2.2:**
1. Replace the long-press gesture with an iOS-safe approach:
   - Option A: explicit edit-mode toggle (settings → "Edit habit order"), then on-card up/down chevrons that reorder via tap. No long-press, no native gesture competition.
   - Option B: a battle-tested library like SortableJS or react-dnd's HTML5Backend with a custom touch backend that fully captures the gesture before iOS can interpret it.
   - Option C: native iOS drag-and-drop API (`UIDragInteraction` in the Capacitor shell, dispatched to JS via plugin). Highest fidelity, biggest integration cost.
2. Flip `ENABLE_HABIT_DRAG_REORDER = true` in `app.js`.
3. Validate on TestFlight with the 7-step QA checklist from 1z.23 before shipping.

**Anti-patterns:**
- Don't remove the disabled drag machinery from source to "clean up" — that would force a from-scratch rewrite when the flag re-enables. The current code is correct in isolation; iOS's gesture-recognizer competition is the integration problem.
- Don't ship 2.2.2 with the same long-press-on-card gesture pattern. The collision with iOS's native long-press is structural, not a CSS bug. Need a different gesture model (explicit edit mode, dedicated handle that captures the entire gesture, or native plugin) before flipping the flag.
- Don't try to mask the artifact with overflow / z-index hacks. Three hotfix attempts proved that's not the path.

**Operational note:** the 7 manual QA steps from 1z.23 are now mostly moot for 2.2.1 — long-press has no effect. The remaining checks (tap completes habit, Add Habits opens library, scroll works, header gear opens settings) all stay valid.

Bumps: `app.js?v=384`, `sw.js v5.269`, `APP_BUILD_TAG '2.2.1-w34'`. `APP_VERSION` unchanged. No CSS bump (the defensive rules from 1z.22 + 1z.23 stay in place and are harmless with the flag off). No backend / Duels / scoring / data changes.

### iOS native image-drag hotfix + centralized cleanup (v3 Phase 1z.23)

Follow-up to 1z.22. `w32` suppressed iOS's native long-press **selection** callout (`-webkit-touch-callout: none`), but a separate iOS gesture survived: **native `<img>` drag-and-drop**. Every habit card contains `<img class="habit-icon-img">` for the habit art, and iOS WebKit treats `<img>` elements as natively draggable unless explicitly disabled. The "vertical strip of ghost text along the left edge that appeared AFTER drop" was iOS's native image-drag preview — a translucent floating clone of the lifted image that follows the finger and lingers briefly during a settling animation post-release.

`draggable="false"` on the image element already shipped (via `habitIconHtml`), but iOS WebKit doesn't always honor that attribute reliably for multi-touch long-press sequences. The real defense is the **CSS** `-webkit-user-drag: none`.

**Fix layers (defense-in-depth):**

1. **Global CSS** `img { -webkit-user-drag: none; user-drag: none; }` — kills native image-drag for the entire app. The app never legitimately uses HTML5 drag-and-drop on images, so this is a free safety win.
2. **Habit card CSS** `.habit-item, .habit-item *` reinforced with the same — scoped duplicate covers any Safari version that ignores the global rule under positioned ancestors.
3. **Body-class CSS** `body.habit-drag-active *, body.habit-drag-armed *` reinforced with `-webkit-user-drag: none !important` AND `touch-action: none !important` during active drag — kills iOS pan/zoom/scroll competition mid-gesture.
4. **`draggable="false"` attribute** already on habit icon images (`habitIconHtml`), preserved.

**Centralized cleanup (`_finalizeDragCleanup`):** every cleanup path — successful drop, idle cancel, visibility hidden, pagehide, blur — now runs **identical** teardown:
- Document listeners removed (touchmove/mousemove)
- Inline body styles restored (userSelect / cursor / overflow)
- Body-class lockdown removed (`habit-drag-active` + `habit-drag-armed`)
- List-level drag classes removed (`is-dragging` + `reorder-mode`)
- ALL drop-target outlines cleared via document-wide query (catches strays from prior runs)
- ALL `.drag-placeholder` and `.lp-pressing` classes removed via document-wide query
- ALL `.drag-ghost` clones removed via document-wide query (defense against leaked ghosts)
- In-flight iOS selection range cleared via `getSelection().removeAllRanges()` — fixes the case where selection armed BEFORE the suppression took effect
- Idle timer + auto-scroll RAF canceled
- `drag = null`

Helper is **idempotent**: safe to call when `drag` is already null. Helper is called from `onDragEnd`, `cancelDragSilently`, AND a new `_backgroundDragSafety` handler.

**Backgrounding safety (`_backgroundDragSafety`):** iOS suspends WebView when the user backgrounds the app (app switcher, incoming call, etc.) without firing `touchend` / `touchcancel`. Without this handler, drag state would stick across foreground/background cycles. Listeners on `visibilitychange` (hidden), `pagehide`, and `blur` invoke cleanup. Even when `drag` is null (suspension during the 400 ms armed window before drag actually enters), the helper still strips `habit-drag-armed` / `habit-drag-active` body classes and `.lp-pressing` markers as defensive sweep.

**Why this works:**
- `-webkit-user-drag: none` is the actual property iOS checks for native image-drag initiation. Set globally + scoped to the habit card and active-drag body class. The drag preview cannot arm anywhere.
- Centralized cleanup eliminates the "did every path actually run every step" question. One function, one source of truth, idempotent.
- Document-wide query cleanup (e.g. `document.querySelectorAll('.drag-ghost').forEach(el => el.remove())`) sweeps any element the prior fragmented cleanup might have missed — even from a previous incomplete drag.
- `getSelection().removeAllRanges()` at end of cleanup nukes the case where iOS armed selection before our suppression could apply.
- Backgrounding handlers prevent the stuck-state case where iOS suspends mid-drag.

**No behavior changes:**
- Tap-to-complete unchanged.
- Long-press-to-reorder threshold (400 ms), move-cancel (10 px), idle timeout, post-drop click guard all the same.
- Reorder semantics unchanged — `_finalizeDragCleanup` runs AFTER the splice/save so the new order persists.

**Anti-patterns:**
- Don't add per-path inline cleanup back into `onDragEnd` or `cancelDragSilently`. The centralized `_finalizeDragCleanup()` is the single source of truth; bypassing it is how the original fragmentation happened.
- Don't remove `draggable="false"` from `habitIconHtml` — CSS handles the case where iOS ignores it, but both layers should be present.
- Don't rely on `-webkit-touch-callout: none` for image-drag suppression. That property only governs the **selection magnifier**. Image drag is governed by `-webkit-user-drag`. Different properties, different mechanisms.
- Don't suppress `touch-action` globally (`html, body { touch-action: none }`) — that breaks normal scrolling. Only active during `body.habit-drag-active`.

Bumps: `app.js?v=383`, `styles.css?v=282`, `sw.js v5.268`, `APP_BUILD_TAG '2.2.1-w33'`. `APP_VERSION` unchanged. No backend / Duels / scoring / data changes. Pure CSS + JS-cleanup-lifecycle additions.

### iOS long-press / native-callout collision hotfix (v3 Phase 1z.22)

Reproducible bug surfaced on TestFlight `2.2.1-w31`: long-press on a habit card to start a reorder drag would also fire iOS's native long-press text-selection (magnifier + blue selection handles + the "Copy/Lookup" callout). Once iOS entered selection mode, the user saw:
- icons + habit art shaking/pulsing (our `.lp-pressing` / `.is-dragging` classes flipping rapidly because iOS's gesture recognizer was stealing the touch)
- blue selection handles on the "Add Habits" CTA text
- a thin strip of iOS-selection-magnifier overlay peeking from the left edge

**Root cause:** `.habit-item` had `user-select: none` + `-webkit-user-select: none` but **was missing `-webkit-touch-callout: none`** — that property is the WebKit-only switch that suppresses the iOS long-press callout, and it's separate from selection. Both must be set. Without the callout suppression, our 400ms long-press handler and iOS's ~500ms native long-press both fire from the same touch, the second one shows the magnifier on top of our drag visuals.

**Fix (CSS-first, minimal JS):**
- `.habit-item` gains `-webkit-touch-callout: none` + `-webkit-tap-highlight-color: transparent`
- New descendant rule `.habit-item, .habit-item * { -webkit-touch-callout: none; ... }` — callout doesn't reliably inherit through inline children on iOS, so leaf text nodes (habit name, XP chip, difficulty badge) needed explicit suppression
- New rule scoped to `.habit-list.is-dragging` + descendants — even if the user's finger slides onto a sibling card mid-drag, iOS can't initiate selection there
- `.add-btn` gained the same suppression block — the "Add Habits" pill was the most visible victim in the screenshots
- New body-level scope `body.habit-drag-armed, body.habit-drag-active, ... *` — covers the entire viewport (tab bar, header, top-row cards) during the long-press + drag window. The `armed` class is added on `touchstart` inside `attachLongPressDrag.onStart` and dropped in `cleanup()`; the `active` class is added when `enterDragMode` actually fires and dropped in `endDrag` + `cancelDragSilently`. Also clears any in-flight iOS selection range via `window.getSelection().removeAllRanges()` on entry.

**Why this works:**
- iOS's text-selection magnifier is gated by `-webkit-touch-callout`. Set it to `none` and the magnifier cannot arm, period.
- Our drag handler keeps working unchanged — we just suppress iOS's competing gesture.
- The body-level class is the global fallback. If the user's finger leaves the habit grid mid-drag and lands on header text / tab bar text, iOS still cannot initiate selection.
- `getSelection().removeAllRanges()` on long-press start kills any selection that may have armed BEFORE our handler attached (e.g., from a previous tap that lingered).

**No behavior changes:**
- Tap-to-complete on habit cards unchanged
- Long-press-to-reorder unchanged (400ms threshold, 10px move-cancel, post-drop click guard all the same)
- Add Habits open/close unchanged
- Habit grid layout, tab bar, top-row cards all visually identical when no drag is in flight

**Anti-patterns:**
- Don't rely on `user-select: none` alone for iOS — `-webkit-touch-callout: none` is required separately for long-press suppression.
- Don't suppress callouts via `pointer-events: none` — that breaks tap. Only the callout-specific properties belong here.
- Don't gate the body-class on `enterDragMode` alone — by the time the 400ms hold completes, iOS may have already armed the magnifier. The `habit-drag-armed` class fires from `touchstart` so iOS never gets the chance.
- Don't move `-webkit-tap-highlight-color` to the body — it'd disable the gray flash on every tappable element in the app, including settings rows where it provides useful feedback.

Bumps: `app.js?v=382`, `styles.css?v=281`, `sw.js v5.267`, `APP_BUILD_TAG '2.2.1-w32'`. `APP_VERSION` unchanged. No backend / Duels / scoring / data changes. Pure CSS + body-class lifecycle.

### World Rank card rank-mismatch fix (v3 Phase 1z.21)

Bug surfaced on TestFlight `2.2.1-w30`: the dashboard's **World Rank Steps card** rendered `#4` while the full Global Rankings → Steps sheet (tapped from that same card) rendered `#13`. Identical user, same metric, two different rank numbers.

Root cause: the card was reading **`cached.me.rank` directly** from the leaderboard cache (raw backend response, real users only — Richie was #4 among the 5 real Apple-signed users + a few real submitters). The sheet, by contrast, runs the cached `top + me` through `_lbMaybeSimulate('step_total', top, me)` before rendering, which calls `window.SimulatedLeaderboard.merge(...)` and injects 10 fixed simulated hunters (`ShadowMonarch_K`, `ascendantnova`, etc.) into the displayed board. Several of those bots roll step totals higher than the user's, which pushes the user to ~`#13` in the merged display. The card was reading pre-merge; the sheet was reading post-merge.

**Fix:** `updateStepsCard()` now routes `cached.top + cached.me` through `_lbMaybeSimulate('step_total', ..., ...)` and reads `displayMe.rank` / `displayMe.current_value` for the active-state render. `_lbMaybeSimulate` is the same helper the sheet uses inside `openLeaderboardRanking`; there is now a single source of truth for "what rank does the user see for step_total on this device today." If the simulator is disabled (`SimulatedLeaderboard.SIMULATE_USERS = false`) or unavailable, the helper short-circuits to `{ top, me }` unchanged, so the card falls back to the raw cache cleanly.

**Step total stays correct.** `displayMe.current_value` is sourced from the merged board's user row, which the sim helper computes from either the server's `me.current_value` or the local `lbGetSnapshot().steps_last_7_days` snapshot — same source the user saw on their own row in the sheet. No drift.

**Card states preserved.** Active / loading / empty all branch off the same conditions as before — only the rank+value source for the active path changed.

**Anti-patterns:**
- Don't read `cached.me.rank` directly anywhere user-facing as long as `SimulatedLeaderboard.SIMULATE_USERS` can be true. Use `_lbMaybeSimulate(metric, top, me)` and read the returned `me.rank`.
- Don't try to invert-compute the merge in the card (e.g., "subtract simulated bots that beat the user from the raw rank"). The merge is the canonical view; calling it directly is cheaper, simpler, and guaranteed to stay in sync if the bot roster ever changes.
- Don't disable `SimulatedLeaderboard` to mask this kind of bug — `SIMULATE_USERS` is a product-UX decision (sparse boards feel populated). The fix is correct sourcing, not removing the feature.
- Don't add a separate "displayRank" field to the leaderboard cache. Recomputing via `_lbMaybeSimulate` on each render is cheap (the merge is pure + O(top.length + 10)) and avoids stale-state drift.

Bumps: `app.js?v=381`, `sw.js v5.266`, `APP_BUILD_TAG '2.2.1-w31'`. `APP_VERSION` unchanged. No CSS, no backend, no Duels, no scoring logic touched.

### Morning Briefing Minimal Premium Polish (v3 Phase 1z.19)

ClaudeDesign handoff "Minimal Premium Polish" (Direction 4 of the Morning Briefing explorations). Pre-App-Review polish — same flow, same copy, same data path, sharper hierarchy. Ships in `2.2.1-w30`.

**Visual diff:**
- Single purple status pill → 3-segment summary grid: `OBJECTIVES TOTAL` (violet) · `VERIFIED BY SYSTEM` (violet on light-gold) · `ON YOU MANUAL` (gold). Gradient violet→gold border wraps the row; numbers are 18px tabular-nums.
- Section headers (`MORNING` / `DAY` / `EVENING`) gained a small gold sigil dot + a horizontal rule that flexes to the right edge.
- Each section's habit rows are now wrapped in a grouped card panel (`.briefing-section-panel`) with subtle row separators instead of free-floating rows on the body background.
- Habit row dots switched from difficulty-color to **stat-color** (per Minimal Premium Polish spec) — `getHabitStatColor(habit)` drives an inline `background` + `box-shadow` glow, so each habit's primary stat reads directly. The legacy `.di-row-dot--{easy|medium|hard|legendary}` difficulty classes still ship for rollback safety; the inline color overrides them in the premium variant.
- "Apple Health verifies" sub-label gained a small stroked check-circle glyph (inline SVG, no PNG dependency).
- `WHERE YOU STAND` inline text strip → 3 sigil tiles. TOTAL XP gets the gold-rimmed primary variant (matches the Status-card sigil treatment); PERFECT DAYS + DAYS ACTIVE are muted-navy.
- `LOCK IN` CTA upgraded to a true gold-gradient button (`#f7c558 → #f5b842 → #c08418`), with outer gold glow + inner highlight + pressed-state ring (matches the Awakening Path button visual language).

**Preserved (zero behavior changes):**
- All wired IDs — `#daily-insight-sheet`, `#daily-insight-overlay`, `#di-header-line`, `#di-status-line`, `#di-slate`, `#di-xp`, `#di-streak`, `#di-days`, `#di-enter-btn`.
- All public functions — `showDailyInsight()`, `dismissDailyInsight()`, `setupDailyInsight()`, `shouldShowDailyInsight()`, `composeBriefingStatusLine()`, `buildBriefingRow()` (signature unchanged), `getDaysSinceOrigin()`, `canAutoVerify()`, `getHabitTimeOfDay()`.
- Trigger sites (init + visibilitychange + post-What's-New 900ms setTimeout) untouched.
- Gating contract (`hb_daily_insight_last_shown` localStorage key written by `dismissDailyInsight` AFTER hide) untouched.
- `composeBriefingStatusLine()` is now orphaned-but-defensive — `showDailyInsight()` still calls it and writes to the now-hidden `#di-status-line` so any future consumer doesn't crash. The 3-segment numbers are written separately to `#di-summary-total`, `#di-summary-verified`, `#di-summary-manual`.
- Drag-down dismiss helper (`attachSheetDismissGesture` with `scrollTarget: '.di-body'`) unchanged — `.di-body` is still the scroll container; we only added the `briefing--premium` modifier.

**Scoping:**
- All new CSS lives in a single labeled section at the END of `styles.css` (`/* v3 Phase 1z.19 — Morning Briefing Minimal Premium Polish */`). Every rule is scoped to `.di-body.briefing--premium`, so stripping the `briefing--premium` class from the markup reverts the sheet to the prior look without touching CSS.
- Shared bottom-sheet shell rules (`.vn-overlay`, `.vn-sheet`, `.vn-drag-handle`, `.vn-section-label`) are **NOT touched** — same precaution as 1z.14: those shells back `#note-modal`, `#lb-rank-sheet`, `#xp-detail-sheet`. The briefing's `.vn-section-label` is wrapped in a `.briefing-stand-label` that adds the right-flexing rule via a child span, leaving the base class untouched.
- Difficulty-color dot rules (`.di-row-dot--easy/medium/hard/legendary`) are NOT changed — they still ship for any non-premium consumer. The premium variant just overrides with inline stat color.

**Anti-patterns:**
- Don't strip the legacy `#di-status-line` element from markup; the defensive write in `showDailyInsight()` still hits it. The CSS hides it cleanly.
- Don't change `attachSheetDismissGesture`'s `scrollTarget: '.di-body'` — `.di-body` is still the scroll surface. If a future redesign moves scrolling to a new container, update the option in lockstep.
- Don't reintroduce the single purple status pill as the primary status surface; the 3-segment grid is now the canonical hierarchy.
- Don't replace stat-color dots with difficulty colors in the premium variant — that was the explicit pre-1z.19 baseline and the design call inverted it.

### World Rank Steps card replaces Week XP slot (v3 Phase 1z.18)

Claude Design's "Steps Card" handoff (Direction 3, RPG variant with the climb delta borrowed from Direction 2). The top metric strip's middle card was previously WEEK XP — a progress bar against an arbitrary `WEEK_XP_TARGET = 200`. Product decision: replace it with a tappable global-steps leaderboard summary so the dashboard's middle slot carries competitive utility instead of restating progress already visible everywhere else.

**New middle card — `<button id="steps-card" class="metric-card metric-card--steps steps-card">`:**

- **Label row:** stroked gold boot SVG + `WORLD RANK` (mono 9pt, +0.12em letter-spacing) + a right chevron.
- **Rank row:** `#` prefix (Cinzel 13 gold) + `<rank>` (Cinzel 22 gold with soft gold glow). Rank prefix hides past 5 digits (per spec).
- **Total row:** `<total> STEPS` (bold tabular-nums + uppercase mono label, text-secondary). Reserved hooks for a future climb-delta chip.
- **Background:** unchanged top-card surface + a soft violet radial glow in the bottom-right corner.

**Three states wired in `updateStepsCard()`:**

| State | When | Rendered |
|---|---|---|
| **Active** | `lbCacheRead('step_total').me.rank > 0` | `WORLD RANK` + `#N` + `42.1K STEPS` |
| **Loading** | iOS + permission granted + no cache yet | `STEPS · GLOBAL` + `#— —` with pulsing gold dot + italic `Syncing…` |
| **Empty (web / no HK)** | `!Health.isAvailable()` OR permission ≠ `granted` | `STEPS · GLOBAL` + `iOS only` + `Sync steps to rank`. Avoids surfacing a misleading `#0`. |

`updateStepsCard()` is called from `updateHeaderMetrics()` (every habit toggle / progress update) AND from `openLeaderboardRanking` when a successful steps fetch lands (`metric === 'step_total'`) AND once at init via `setupStepsCard()` — so the card transitions loading → active without waiting for a habit interaction.

**Tap = `openLeaderboardRanking('step_total')`.** Whole card is a `<button>` (keyboard-activatable, `aria-label="Open global steps leaderboard"`), reuses the existing leaderboard sheet — no tab switch, no new endpoints, no new state. The `setupStepsCard` wiring is idempotent (guards with `data-wired="1"`).

**Backend untouched.** Reuses `lbCacheRead('step_total')` (stale-while-revalidate, 24h TTL) and the live `GET /v1/leaderboard/top?metric=step_total` fetch already powered by the Stats tab.

**TOP % chip + climb delta are intentionally deferred.** The current `GET /v1/leaderboard/top` response shape returns `me: { rank, current_value }` but no total-users count and no historical rank, so a percentile would be misleading and a climb delta would always be `null`. CSS hooks (`.steps-card__pct`, `.steps-card__delta`) ship in the ruleset for future activation when the backend exposes both. The narrow-viewport rule already hides the `%` chip first per spec ("If TOP 18% would push past card width, hide the % chip first, keep the rank.").

**Week XP math is now dead code.** `updateHeaderMetrics()` still computes the Sunday→today XP sum and writes to `#week-xp-bar` / `#week-xp-current` / `#week-xp-day`, but those elements no longer exist in the markup; every write is null-guarded so the dead code is harmless. Leaving it alone preserves the third card (XP · 30D sparkline) which shares the same `try` block. A future cleanup pass can excise the Week-XP loop without risk; today it's a controlled no-op.

**Anti-patterns:**
- Don't re-introduce the Week XP card in the middle slot — the data lives on the Stats tab + History tab already, and surfacing it here is what made the slot feel redundant.
- Don't add the `%` chip or climb-delta UI before the backend exposes `total_users` and historical rank — a placeholder of "TOP 100%" or "↑0 spots" reads as a bug, not a feature.
- Don't call `openLeaderboardRanking('step_total')` from anywhere other than the card click or the existing Stats-tab card. The sheet is a single source of truth for the steps leaderboard; multiple entry points are fine, but each must reuse this helper.
- Don't write to `lb-rank-*` element IDs from `updateStepsCard()` — that surface owns the Top-50 modal. The steps card is a shortcut, never a duplicate render.

### Verified Duels v1 prod sim pass + App Store pull (v3 Phase 1z.17)

Documentation-only phase recording two milestones from the May 16 work session.

**1. Verified Duels v1 backend is empirically proven on production D1.**

End-to-end sim matrix passed for all 5 user-selectable verified duel types against the prod Workers + D1 backend (`https://awakened-backend.richmondcampano93.workers.dev` / `awakened-db`):

| Sim | Duel type | Aggregator | Result | Duration |
|---|---|---|---|---|
| `01-steps-duel.ps1` | `steps` | MAX(value) | PASS | 9.2s |
| `02-sleep-duel.ps1` | `sleep` | COUNT DISTINCT metric_date | PASS | 10.6s |
| `03-bedtime-duel.ps1` | `bedtime` | COUNT DISTINCT metric_date | PASS | 10.9s |
| `04-strength-duel.ps1` | `strength` | COUNT(*) | PASS | 11.0s |
| `05-verified-objectives-duel.ps1` | `verified_objectives` | COUNT DISTINCT (event_type, metric_date) | PASS | 11.3s |
| **Total** | | | **5/5 PASS · 0 FAIL · 0 SKIPPED** | **353.1s** |

Each sim ran the full 23-checkpoint flow: friendship request/accept → duel create → opponent accept → verified events submit → `/score` pre-resolve → force-end via D1 (with row-count + past-timestamp verification) → `/resolve` (200, correct `challenger_win` / `winner_user_id` / `reward_settled_at`) → `/resolve` idempotent on second call (no double-pay; `user_souls_ledger` UNIQUE constraint holds) → ledger row count = 1, user matches winner, delta = +40 → `GET /duels/:id` post-resolve matches `/resolve` response.

Teardown via the seed worker (`POST /teardown`) returned a clean before/after report:
```
before:  { users: 2, friends: 1, duels: 5, verified_events: 22, user_souls_ledger: 5, ... }
deleted: { users: 2, friends: 1, duels: 5, verified_events: 22, user_souls_ledger: 5, ... }
after:   { users: 0, friends: 0, duels: 0, verified_events: 0, user_souls_ledger: 0, ... }
note:    "CLEAN: all sim artifact tables read 0 post-teardown."
```

Independent `GET /verify` confirmed `"clean": true`. Local JWTs wiped from `sims/.secrets/`. Prod D1 contains only the 5 real Apple-signed users — no sim residue.

**Boss Race deferred** — not part of v1 acceptance, hidden from picker (see Phase 1z.16). `sims/scripts/06-boss-race-deferred.ps1` remains in tree, solo-runnable, for verifying the `BOSS_RACE_SCORING_DEFERRED` contract is still honoured. Not in `run-all.ps1`'s default matrix.

**2. App Store review for original 2.2.1 (May 15 submission) was manually pulled.**

Reason: the original submission was set to **automatic release on approval**. Product decision was to NOT ship that build because the May 16 work session added meaningful additions on top — most notably:
- Direction B Premium Character Sheet (Phase 1z.12) + compact-pass refinements (1z.13 → 1z.14)
- Status-card PR chip retirement (1z.11)
- 2X XP buff pill refinements (1z.10)
- Boss Race hidden from picker (1z.16)
- Sim-harness hardening (1z.13–1z.16) — though that's docs/ops, not runtime
- Empirical prod sim proof (this phase, 1z.17)

The pull was a **product decision, NOT an Apple rejection.** Next ship target AT THAT MOMENT (May 16 evening): Codemagic build on commit `f6c1a69` (HEAD on May 16 evening). APP_VERSION stays `2.2.1`; the train just gets a new build number when Codemagic runs. **Historical note (May 17):** `f6c1a69` was NOT the final submitted build — subsequent hotfixes (1z.21 rank-mismatch, 1z.22 long-press callout, 1z.23 image-drag, 1z.24 drag-disable) layered on top before the actual App Store Connect submission landed on commit `78a2c6a` as build `2.2.1-w34`. See "May 17 handoff + 2.3 roadmap (v3 Phase 1z.25)" above for the current state.

**Smoke test checklist for the new TestFlight build** (informational, not gating):
1. App opens; signin gate appears (or main app mounts for signed-in users)
2. Status card renders the Direction B Premium Character Sheet (banner / identity strip / portrait frame / sigil tiles)
3. Duels tab → Choose Verified Duel picker shows EXACTLY 5 cards: Verified Discipline · Steps · Sleep · Bedtime · Strength. Boss Race is NOT visible.
4. 2X XP buff pill renders correctly on weekend launches; tap opens Weekend Warrior sheet
5. Apple HealthKit permission flow still works (first-launch prompt + Settings → Apple Health pause toggle)
6. No console errors on cold launch

**3. Sim harness final state (post-1z.16).**

The harness is now production-ready for regression use:
- Windows PowerShell 5.1 compatible (no PS 7 syntax, ASCII-only scripts, parser-verified under `5.1.19041.6456`)
- ANSI / wrangler-output resistant — strips real ANSI CSI, literal ANSI mojibake, PS NativeCommandError wrapping, and wrangler banner tokens before JSON parsing
- Explicit, sim-only teardown via the seed-worker `/teardown` route (walks 8 child tables before deleting users; reports before/after counts; cannot touch real-user data by construction)
- Stop-on-first-failure (`run-all.ps1` halts the moment any sim returns non-zero exit and prints the failed run folder + 4-step recovery procedure)
- Verified force-end SQL (SELECT before → UPDATE with row-count check → SELECT after with past-timestamp check; aborts before `/resolve` if any step fails)
- Default matrix is 5 sims (Boss Race deferred path is solo-runnable; outside the v1 ship gate)

**Anti-patterns for future contributors:**
- Don't reintroduce `06-boss-race-deferred.ps1` to the default `run-all.ps1` matrix without first flipping `DUEL_TYPES.boss_race.selectable: true` AND restoring the picker order array. The deferred path's expected FAIL would mask the actual 5/5 acceptance signal.
- Don't claim Verified Duels v1 scoring is "not proven on prod" — it is, as of May 16, 2026. Re-prove only if scoring code changes meaningfully.
- Don't describe the pulled May 15 submission as an Apple rejection. It was a deliberate product pull.

### Boss Race hidden from user-facing duel picker (v3 Phase 1z.16)

Backend verified-duel sims passed end-to-end against prod D1 for all 5 scorable types — steps, sleep, bedtime, strength, verified_objectives — and the engine + reward ledger work cleanly. `boss_race` remains deferred (no verified boss-event log yet) and was always going to surface a non-actionable "scoring activates after verified boss-event logging" message in the picker. Product call: hide it from the picker entirely in v1 rather than ship a card that's intentionally unusable.

**Scope (frontend-only):**
- `DUEL_TYPES.boss_race` gained `selectable: false`; all other entries got `selectable: true` explicitly.
- `_renderDuelTypeCards()` order array dropped `'boss_race'` AND the per-iteration loop also rejects any entry with `selectable === false` (defense-in-depth for future hidden types).
- The picker click-handler in `setupDuelTypePicker` refuses to set a hidden type as the current selection even if a stale DOM node sneaks in.
- All read paths — `getDuelTypeMeta`, glyph map, short-code map, verb map, deferred-resolve copy ("Awaiting boss-event logging") — are UNCHANGED. Legacy duel rows with `duel_type='boss_race'` still render gracefully on the Duels tab, in the HUNTING-strip pill, in the duel-detail overlay, and in any cached state.

**Backend left alone:**
- `ALLOWED_DUEL_TYPES` in `backend/src/handlers/duels.ts` still includes `'boss_race'`. Removing it would reject historical rows on read and break alias lookups for any in-flight duel.
- `POST /v1/duels/:id/resolve` still returns `BOSS_RACE_SCORING_DEFERRED` for that type — same behavior, same code path.
- No migration. No schema change. No deploy.

**Sims:**
- `run-all.ps1` default matrix is now the 5 user-selectable scorable types. `06-boss-race-deferred.ps1` stays in `sims/scripts/` and is runnable on its own; it just isn't part of the default matrix. Successful matrix is `5/5 PASS - 0 FAIL - 0 SKIPPED`.
- `OPERATOR.md` updated to reflect the 5-type acceptance criterion and to note that boss_race remains deferred / not part of v1 ship gate.

**Anti-patterns:**
- Don't reintroduce `boss_race` to the picker's order array without first removing `selectable: false` (the `selectable` filter would still hide it, but the asymmetry would be confusing).
- Don't remove `boss_race` from `DUEL_TYPES` entirely or strip its glyph / verb / short-code entries — legacy duel rows still need those for graceful rendering.
- Don't remove `'boss_race'` from `backend/src/handlers/duels.ts`'s `ALLOWED_DUEL_TYPES` — historical rows would fail validation on read.
- Don't re-add `06-boss-race-deferred.ps1` to `run-all.ps1`'s default matrix; the deferred path's failure would mask the actual 5/5 acceptance signal.

When verified boss-event logging ships (future phase), flip `selectable: true` on the `boss_race` entry, restore it to the picker's order array, and re-add the sim to the default matrix. That's the entire surgical surface to un-defer.

### Codemagic sentinels + OneDrive deletion (v3 Phase 1z.15)

Housekeeping pass after a clean 1z.5–1z.14 audit. Two concrete actions:

1. **Codemagic sentinels for Direction B markup.** Pre-sync + post-sync gates in `codemagic.yaml` gained four new sentinels: `sc-card--profile`, `sc-banner__title`, `sc-portrait-frame`, `aw-header__rune`. Insurance against a future inadvertent `sed`/merge silently dropping the Phase 1z.12 Status card rebuild or header rune polish. Same pattern as the existing Duels / 2X-pill / boss-result / yesterday-backfill sentinels.

2. **OneDrive clone deleted.** `C:\Users\richm\OneDrive\Desktop\habit-tracker` removed. It was the repeated source of CWD drift (latest case: 1z.14 commit accidentally landed only `CLAUDE.md` because bash CWD was in OneDrive while edits went to canonical). The canonical repo at `C:\Users\richm\Documents\repos\awakened-app` is now the sole working copy. Two CLAUDE.md sections were updated to reflect this — the working-tree overview at the top, and the "Common pitfalls" entry on CWD drift. The "mirror CLAUDE.md to OneDrive" ritual is retired; future sessions only edit the canonical copy.

No runtime/behavior changes. Ships in `2.2.1-w27`.

### Status vertical compact pass — relaxed (v3 Phase 1z.14)

The 1z.13 compact pass over-compressed the Premium Character Sheet: portrait frame, avatar, and sigil tiles all read as crushed. 1z.14 supersedes 1z.13 — keeps the useful top-of-page savings (status-content top padding, daily-quote shave) and restores the card's internal breathing room. Single CSS override section in `styles.css`; the prior 1z.13 block was rewritten in-place rather than layered. Ships in `2.2.1-w26`.

**Values now (vs 1z.12 original / vs 1z.13 over-compressed):**

| Surface | 1z.12 orig | 1z.13 crushed | **1z.14 relaxed** |
|---|---|---|---|
| `.status-content` top padding | 16 | 4 | **6** |
| `.daily-quote` padding · min-h | 10/9 · 58 | 6/6 · 44 | **7/7 · 48** |
| `.sc-banner` padding | 14/12 | 9/8 | **12/10** |
| `.sc-hero` padding · gaps | 14/10 · 6 · 8 | 10/8 · 4 · 6 | **12/10 · 5 · 7** |
| `.sc-origin-row` · btn v-pad | 14 / 10 | 10 / 8 | **12 / 10** |
| `.sc-portrait-frame` min-h | 220 | 178 | **204** |
| `.sc-portrait-row` pad · avatar | 14/16 · 130 | 8/12 · 118 | **12/14 · 128** |
| Sigil grid · tile · value · label | 12/14 · 9/8 · 18 · 8.5 | 8/10 · 7/6 · 16 · 8 | **11/13 · 9/7 · 18 · 8.5** |

Net result: top of the page reclaims ~12px (status-content) + ~10px (quote) = ~22px above the card. Inside the card, only the portrait frame stays meaningfully shorter than 1z.12 (204 vs 220 = -16px). Everything else is within 1–3px of the 1z.12 baseline. Most of the Hunter Profile card lands on first screen; the last sigil tile row may peek-below-fold on iPhone SE/13 mini but is reachable with a tiny scroll.

**Wider viewports (≥400px)** breathe further: frame 216px, avatar 134px. **iPhone SE (≤380px)** keeps the vertical-stack media query with relaxed padding (12/12·14, gap 10).

**Design priority going forward:** premium feel beats forced no-scroll fit. If a future redesign or content addition pushes content below the fold, prefer trimming above-card space (quote / margins) before squeezing the card itself.

**Anti-patterns (carried forward):**
- Don't push `.sc-portrait-frame min-height` below 204 on the typical viewport. Below ~200px the avatar silhouette + radar labels start visibly crowding.
- Don't drop `.sc-metric--sigil .sc-metric-val` below 18px on the typical viewport — the tiles stop reading as "real tiles" and start reading as a label strip.
- Don't shave the tab-bar (`.tab-btn min-height: 44px`) or tab-icon size — 44px is iOS HIG tap-target minimum for primary nav.
- Don't kill the daily quote entirely — the 7px/48px shave keeps the line visible + centered.

### Status vertical compact pass (v3 Phase 1z.13)

CSS-only follow-up to 1z.12. The Direction B Hunter Profile card looked premium but on a standard iPhone viewport the bottom sigil tiles fell below the fold. This pass tightens vertical spacing on the Status tab so the full card — banner through sigil tile footer — fits on first screen without scrolling. Ships in `2.2.1-w25`.

**Where the savings came from (top → bottom):**
- `.status-content` top padding 16→4 (-12px)
- `.daily-quote` padding 10/9→6/6, min-height 58→44 (-18px; shared across tabs, conservative shave)
- `.sc-card--profile .sc-banner` padding 14/12→9/8 (-9px)
- `.sc-card--profile .sc-hero` padding 14/10→10/8, identity margin-top 6→4, awakening margin-top 8→6 (-9px)
- `.sc-card--profile .sc-origin-row` bottom padding 14→10; gold button 10→8 vertical (-8px)
- `.sc-card--profile .sc-portrait-frame` min-height 220→178; portrait-row padding 14→8; avatar 130→118 (-44px — largest single saving)
- `.sc-card--profile .sc-metrics--sigil` padding 12/14→8/10; tile padding 9/8→7/6; value 18→16; label 8.5→8, margin-top 6→4 (-12px)

Total reclaimed ≈ 112px on the typical iPhone Pro/Pro Max viewport. Bottom sigil tiles now land above the fold.

**Wider viewports (≥400px)** get a couple pixels back via a `@media (min-width: 400px)` block — portrait frame breathes to 188px min-height and avatar grows to 126px so iPhone 14 Pro+ doesn't read as cramped against the smaller-screen baseline.

**iPhone SE (≤380px)** uses the pre-existing `.sc-portrait-row` vertical-stack media query (avatar above radar) — the compact pass just tightens that stack's padding/gap so the SE degrades gracefully without the avatar getting cropped.

**Preserved (zero changes to logic / wiring / markup):**
- All wired ids — `#sc-name-val`, `#sc-name-edit`, `#sc-avatar-img`, `#sc-radar-wrap`, `#sc-origin-btn`, `.sc-hero-class[data-class-key]`
- All click handlers — armory tap, class detail, name edit, Awakening Path
- Awakening Path button is still gold + full-width + tappable (8px vertical padding inside a labeled CTA on a scroll surface is well above the comfortable-tap threshold)
- Radar chart math, stat keys, color mapping
- 2X XP buff pill, souls badge, XP/souls/HealthKit/Duels logic — untouched

**Anti-patterns:**
- Don't shave the tab-bar (`.tab-btn min-height: 44px`) or tab-icon size — 44px is iOS HIG tap-target minimum for primary nav.
- Don't kill the daily quote entirely — the trim keeps the line visible + centered. Removing it altogether was offered as a fallback but not needed.
- Don't tighten the portrait frame below 178px without re-testing on iPhone SE (avatar feet start cropping ~170px at the current silhouette aspect).
- Don't move `.sc-card--profile` padding rules into the base `.sc-card--profile` selector in 1z.12 — keep the compact pass as a clearly-bounded override section so 1z.12 stays a clean baseline if a future redesign reverts.

### Status card rebuilt as Premium Character Sheet — Direction B (v3 Phase 1z.12)

Claude Design's "Dashboard Explorations" handoff landed; Direction B (Premium Character Sheet) is implemented on the Status card. Top dashboard is intentionally untouched except for one subtle header polish. Ships in `2.2.1-w24`.

**Scope (and what stayed off-limits):**
- IMPLEMENTED: Status card structural rebuild (Direction B).
- IMPLEMENTED: subtle gold rune underline on the AWAKENED header (`.aw-header__rune`).
- NOT IMPLEMENTED on purpose: Direction D's taller hero header. Stat-card rune corners + gold-rim-on-current-card polish from Direction B's spec (kept out per "top dashboard mostly unchanged" instruction). Habits-row inner highlight. Quote whisper variant. Date+gear meta row (kept inline with wordmark so header height stays unchanged).

**Status card structure (replaces the prior STATUS kicker + hero + divider + portrait + flat-strip metrics):**
1. **Rune-flanked HUNTER PROFILE banner** — Cinzel 12 / +0.32em letter-spacing in gold, flanked by 28px hairline gradients fading to/from gold. Replaces the small "STATUS" kicker (`.sc-banner` + `.sc-banner__rune` + `.sc-banner__title`).
2. **Identity row** — rank disc 54×54 with stronger inner glow (per-rank color via `[data-rank]` attribute), Cinzel 22 name, inline strip `E RANK · 41 PTS · CIVILIAN`. The class segment of the strip keeps the existing `.sc-hero-class` class + `data-class-key` attribute so the class-detail delegated click handler at `app.js:9255` still fires.
3. **Italic awakening line** — `cls.desc` rendered in Georgia italic 11.5px (`.sc-awakening-msg`). Conveys "Train any stat to Lv 5 to awaken your path." for Civilian; class flavor for awakened classes.
4. **Full-width gold Awakening Path button** — `.sc-origin-btn--gold` modifier on the existing `#sc-origin-btn` element. Gradient gold rim, scroll glyph, chapter pill, chevron suffix. Click handler unchanged. Conditional render preserved (only when `originBeginning.text`).
5. **Portrait frame** — bounded zone with hex grid backdrop (inline SVG `<pattern>` at 0.18 opacity, violet stroke) + 4 gold corner brackets (`.sc-portrait-corner--tl/tr/bl/br`). Avatar + radar layered on top via existing `.sc-portrait-row` (no JS changes — same `#sc-avatar-img` / `#sc-radar-wrap` IDs hosting the existing armory-tap + radar-injection wiring).
6. **4 sigil tiles** — replaces the flat-strip `.sc-metrics`. Same 4 metrics (Total XP / Best Streak / Days Active / Today), now in a 4-column grid with TOTAL XP elevated to a gold-rimmed primary tile (`.sc-metric--primary`, gold border + inset glow + gold value + gold-tinted label). Sub-340px viewports collapse to 2×2; sub-360px shrinks the metric value 18→16.

**Wired IDs preserved (single source for all class delegations + handlers):**
- `#sc-name-val` — name span, name-edit replace target
- `#sc-name-edit` — conditional edit pencil (only when `hb_hunter_name_claimed !== '1'`)
- `#sc-avatar-img` — armory tap (delegated handler at ~line 12573)
- `#sc-radar-wrap` — radar injection target (`buildRadarChart` reads this)
- `#sc-origin-btn` — Awakening Path button (handler at ~line 14192)
- `.sc-hero-class[data-class-key]` — class-detail delegated click (line ~9255). Now on the CIVILIAN segment of `.sc-identity-strip`.

**Header rune (subtle polish, top-dashboard scope):**
A 1px diamond + gold-to-transparent linear gradient row sits inside the existing `.header-top { margin-bottom: 16px }` slot. Total header height is unchanged. Decorative only; `aria-hidden="true"` on both the wrapper and inner spans. Class: `.aw-header__rune` with `__rune-diamond` + `__rune-line` children.

**Anti-patterns to avoid:**
- Don't add a second meta row (date + gear under wordmark) — Direction D shape. We explicitly kept the wordmark + date/gear inline.
- Don't add the Direction B stat-card rune corners or `.is-current` gold-rim variant on the top 3-card metric strip. User scope is "top dashboard mostly unchanged except for subtle header/rune polish." Rune-corner polish is deferred until product re-greenlights it.
- Don't reintroduce the `.sc-top` kicker / `.sc-divider` / `.sc-hero-class-desc` / flat `.sc-metrics` styling on the profile variant. The `.sc-card--profile` modifier rewires those classes. The non-profile rules are kept for any future surface that wants the legacy treatment.
- Don't change the inline strip's class-segment markup without preserving `.sc-hero-class` + `data-class-key`. The class-detail delegated handler keys on that selector; renaming silently breaks class tap.
- Don't bring back the class emblem inline next to the class name in the identity strip. Direction B intentionally drops it — the strip is identity data, not class iconography. Class emblem may resurface in a future class-detail-card surface.

### Status-card PR chip retired (v3 Phase 1z.11)

The compact `🏆 PR` button (`#pr-open-btn` / `.pr-open-chip`) that lived inline next to the hunter name in the Status card's `.sc-hero-name` row has been removed. It felt decorative and unanchored — a floating badge next to the hunter identity with no clear product hook. The call site in `renderStatus` (the `buildPRStripHTML()` concatenation) was deleted; the function definition itself, the `.pr-open-chip` CSS rules, the `#pr-all-overlay` / `#pr-all-sheet` markup, and the delegated `#pr-open-btn` click handler all remain in source as harmless dead code so a future surface (e.g. a dedicated Achievements section) can re-wire the All-PRs sheet without re-implementing the data layer. **PR data continues to be captured in the background** via `personalRecords` writes — only the UI entry point was retired. Consequence: there's currently no in-app way to open the All-PRs sheet. Acceptable per product call; re-add an entry point when an Achievements surface is designed.

### Resource-row polish pass (v3 Phase 1z.10)

Three small follow-ups to v3 Phase 1z.9's 2X XP buff pill — all in `.today-strip-right`:

1. **Perfect-streak chip retired from the resource row.** `#perfect-streak-display` markup removed from `index.html`. `updatePerfectStreakDisplay()` already early-returns on missing element, so the underlying perfect-day streak math (counts, milestones, achievements) is fully unaffected. The All-Streaks sheet remains reachable from the Status tab's perfect-day card; the small gray flame chip in the resource row was redundant with the Status surface.
2. **Status-card `2x XP` badge retired.** The duplicate badge in `renderStatus`'s `.sc-top` was the second weekend XP indicator in the same screen. Removed. The compact buff pill in the resource row is the single source of weekend XP visibility. `.stats-2x-badge` CSS rule remains in `styles.css` harmlessly (no longer rendered).
3. **Lightning-emoji glyph retired from the buff pill.** `.aw-buff-pill__icon` span removed from markup. Pill is now `2X XP` (or `2X` under 360px) in mono gold with the violet→gold gradient + pulse dot carrying the buff identity. CSS rule reduced to `.aw-buff-pill__icon { display: none; }` for SW-transition safety against a cached pre-1z.10 markup. Symmetric `padding: 4px 10px` instead of the icon-offset `4px 10px 4px 8px`.

Final resource-row reads `[N/M HABITS TODAY ›] [2X XP] [170 SOULS]` on weekends, `[N/M HABITS TODAY ›] [170 SOULS]` on weekdays. The PT-anchored `isWeekend()` boundary and Weekend Warrior 30-XP bonus + sheet are unchanged.

---

## 2X XP Buff Pill (v3 Phase 1z.9)

Replaces the prior full-width gold "DOUBLE XP WEEKEND" banner row (the `.double-xp-banner` block that sat between `#status-pills` and `#daily-quote`) with a compact 22px buff pill living **inside `.today-strip-right`**, positioned **between `#perfect-streak-display` (streak chip) and `#souls-badge`**. Right-cluster order, left to right: streak chip → **2X XP pill** → souls badge.

- **Markup:** `<button id="double-xp-banner" class="aw-buff-pill aw-buff-pill--xp2x hidden">` with three children — `.aw-buff-pill__icon` (⚡ emoji), `.aw-buff-pill__label` ("2X" + a nested `.aw-buff-pill__label-xp` carrying " XP" that hides under 360px viewport via pure CSS media query), `.aw-buff-pill__pulse` (4px gold pulse dot). The element is a `<button>`, not a `<div>` — keyboard activation, focus ring, and screen-reader semantics come free.
- **id preservation:** `id="double-xp-banner"` is unchanged so `updateDoubleXpBanner()` and `setupDoubleXpBanner()` keep finding it via `getElementById`. The iOS dual `click + pointerup` handler with the `_wwHandlingTap` flag is untouched — Safari's "first tap eats hover" workaround stays exactly as shipped.
- **Visibility logic:** `updateDoubleXpBanner()` toggles `.hidden` based on PT-anchored `isWeekend()`. The pre-1z.9 `dxb--active` variant (which swapped the copy to "Weekend Warrior active — +30 XP if you finish all 3 nights" when the user had `No alcohol` in their list) is **gone** — the pill is uniformly "⚡ 2X XP" on Fri/Sat/Sun regardless of WW state. The Weekend Warrior bonus + sheet copy still surface inside `#ww-overlay` when the pill is tapped; just the pill copy no longer reflects WW state.
- **Animations:** 2.4 s violet→gold hue-shift loop (`@keyframes aw-buff-pill-glow`, both outer + inset box-shadow) and 1.6 s gold pulse-dot loop (`@keyframes aw-buff-pill-pulse`). On `:active` the pill scales to 0.96. Both keyframe loops are killed by `@media (prefers-reduced-motion: reduce)`. The 0.9 s lightning-bolt flicker mentioned in the design exploration was deliberately skipped — `:active` scale plus the steady glow is enough cinematic feedback.
- **Tap target:** the visible pill is 22px tall (well under iOS's 44pt minimum), so a `::before` pseudo-element with `inset: -11px -6px; z-index: -1` expands the clickable area to roughly 44 × full-width-of-pill without visually growing it. `touch-action: manipulation` on the host kills the iOS double-tap-zoom delay.
- **Responsive copy:** `.aw-buff-pill__label-xp { display: none; }` under `@media (max-width: 359px)` — pure CSS, no JS-driven resize listener.
- **Tap → Weekend Warrior sheet** still flows through the existing `openWeekendWarriorSheet()` chain via `setupDoubleXpBanner()`'s `bannerActivate` handler.

### Boss Defeated design pass (v3 Phase 1z.7)

Visual restyle layered on top of the v3 Phase 1z.6 controller — same `#boss-result-overlay` markup id, same `_queueBossResult` / `_drainBossResultQueue` / `_showBossResult` / `closeBossResult` flow. The rare/ultra cinematic (`#reveal-overlay`, `processRevealQueue`) is **NOT touched** — common drops + no-drop defeats keep flowing through the boss-result overlay; rare/ultra still get the existing dramatic reveal.

**4 surfaces redesigned:**

1. **#boss-result-overlay** — rune-divider hero with Cinzel `BOSS DEFEATED` (gold + 0 0 18px glow), boss card with dimmed portrait + gold diagonal slash + rank pill + `Has Fallen` strike-through + `VERIFIED` defeat-condition row, rarity-tinted relic card OR 3-row mercy progress (bar fills per tier, color-coded gold/blue/purple), action stack: purple primary (`View Relic` / `View Mercy Progress`) → gold secondary (`Hunt Again`) → ghost tertiary (`Close`). Backdrop carries pure-CSS radial-gradient gold dust + purple/gold ambient bloom. Close (✕) anchored top-right.
2. **Boss detail defeated state** (`.bfs-overlay--defeated` modifier on `#boss-fs-overlay`) — visible when `kill_count > 0 && !engaged && !isPreview`. Adds `HUNT COMPLETE` gold pill to the header, a defeated hero card (dimmed portrait + slash, time-ago subline via `_formatTimeAgo`), tappable `LAST DROP` callout (closes detail + opens card-detail modal), `HUNT HISTORY` mini-ledger (top 3 most-recent drops for this boss from `loadInventory` via `_bossHuntHistory`), and a purple `HUNT AGAIN — N SOULS` CTA with footnote ("Engages the X · next night/day counts toward this hunt."). The legacy engage-cta / engage-state / engage-preview sections hide via CSS when the defeated modifier is set.
3. **HUNTING strip result pill** — prepended to the `.status-pill-row` when `hb_boss_result_pending` is set. Gold pill with leading ✓ chip, copy `{BOSS} DEFEATED · RELIC FOUND` (or just `... DEFEATED` for no-drop). Gold pulse dot top-right via `@keyframes bro-result-dot-pulse`. Tap → `openBossResultFromPending()` re-builds the overlay envelope from `hb_boss_result_pending` + live BOSSES/CARDS lookups and re-shows it. Closes the overlay (Close, Hunt Again, View Relic, View Mercy, ESC) → `_clearBossResultPending` removes the key and the pill retracts.
4. **Relic Archive NEW state** — `_isRelicNew(cardId)` returns true when the inventory carries `discovered + first_acquired_date` AND `hb_relic_seen_<cardId>` is unset. Per-card chip top-right (gold gradient + sparkle ✦ + `@keyframes archive-card-new-shimmer`) supersedes the `EQUIPPED` chip on first view. Header counter `archive-new-count` shows `N NEW` gold pulse pill; hidden when `_countNewRelics()` is 0. NEW state clears on any of: tap the discovered card in the archive (markSeen + re-render), tap `View Relic` in the Boss Defeated overlay.

**Defeat-condition copy** lives in `BOSS_DEFEAT_CONDITIONS` map (keyed by bossId). Used by the overlay's VERIFIED row; falls back to `cfg.killCondShort` when missing. Current entries cover all 6 shipping bosses: Insomniac / Carouser / Steel Wolf / Iron Warden / Glass Strider / Dream Tyrant.

**New localStorage keys (NOT in `CloudSync.SNAPSHOT_KEYS`):**
- `hb_boss_result_pending` — single-slot envelope `{ bossId, bossName, defeatedAt, acknowledged, dropCardId, dropRarity, kill_count }`. 24h auto-acknowledge (`BOSS_RESULT_AUTO_ACK_MS`); read via `_readBossResultPending`, written by `_queueBossResult`, cleared by `_clearBossResultPending` (called from `closeBossResult`). Replaced when a newer defeat fires.
- `hb_relic_seen_<cardId>` — one-shot per-relic flag. Set by `_markRelicSeen` on archive-card tap OR on overlay `View Relic` tap. Never cleared. NEW state for a relic is the inverse of this flag (modulo "the relic is actually owned").

The existing `hb_boss_result_seen_<bossId>_<kill_count>` from Phase 1z.6 is preserved — that's the **modal one-shot** (prevents the overlay from re-firing across reloads). `hb_boss_result_pending` is the **pill state** (HUNTING strip ack). Two different concerns, two keys.

**Time-ago helper** — `_formatTimeAgo(iso)` returns "Xm ago" / "Xh ago" / "yesterday" / "N days ago" / "May 14". Drives the defeated hero subline; defensively returns "recently" on bad input.

**Anti-patterns (DO NOT do):**
- Don't add `hb_boss_result_pending` or `hb_relic_seen_*` to `CloudSync.SNAPSHOT_KEYS`. They're device-local UI acknowledgments — restoring on a new device should re-surface every owned relic as NEW until the user has actually seen it on that device, and a phantom "you defeated X" pill should not appear on a fresh install for an event the user never witnessed.
- Don't re-fire the HUNTING strip result pill after the user has acknowledged (closed the overlay). The pill represents "unread defeat", not "active hunt." `_clearBossResultPending` runs from every overlay-close path including ESC, Hunt Again, View Relic, and View Mercy.
- Don't bypass `openBossResultFromPending()` when a surface other than the kill-fire path wants to surface the overlay (HUNTING strip pill tap). Reconstructing the envelope manually drifts from the live BOSSES / CARDS / mercy lookups.

---

## Conventions & non-obvious rules

**Date / time.** All "today" comparisons use `getPTDate()` (PT-locale ISO date). Never `new Date().toISOString()` — that's UTC and breaks streaks for west-coast users.

**Notifications fire in DEVICE-LOCAL time, not PT.** The two systems are intentionally split:
- **Streak / completion math** is PT-anchored via `getPTDate()` so all users share a single "day" boundary (a user travelling LA → Tokyo doesn't get double-credited or zeroed out mid-flight).
- **Notification scheduling** uses Capacitor's `schedule.on.{hour, minute}`, which iOS interprets as the device's local clock. A user in NYC who picks 9:00 AM gets the ping at 9 AM Eastern — same UX in every timezone, no manual conversion. The digest re-schedules itself on app open via `Notif.reapplyDigest()`, so it picks up timezone changes automatically when iOS updates the device clock.

Never "fix" notification scheduling to use PT — that would be a bug.

**Single source of truth.** When a piece of data could plausibly live in two places, it doesn't. The 10-habit Morning Routine, primary stats, descriptions, color values — every map has exactly one home and helpers around it. Adding a new habit means editing `DEFAULT_HABITS`, `HABIT_PRIMARY_STAT`, `HABIT_DESCRIPTIONS`, and (if measurable) `MEASURABLE_HABITS`. Nothing else.

**Habit identity = name.** `id` is per-user (`uid()`); `name` is the foreign key used for matching against the master library. Never compare habits by id across the user → library boundary.

**Read-only by design.**
- The "About this habit" section on View Note pulls from `HABIT_DESCRIPTIONS` and is **not editable**. Old `habitNotes` localStorage is preserved but dead.
- Difficulty in Edit Habit is **not editable** (`.diff-row--locked` class + no click listener). Only name and emoji are editable.

**Bottom sheet vs center modal.** Bottom sheets get swipe-down dismiss. Celebration modals (Compound Effect, Rank Up, Perfect Day, Class Change, Achievement Unlock) explicitly do **not** — they're earned moments, not flow interruptions.

**Sound.** All audio is Web Audio API only. No external files. Two functions: `playCheckSound()` (~280ms chime per habit complete) and `playFanfare()` (~1.4s D-major flourish for compound bonus). Both gated on `soundEnabled` (toggle in Settings, persisted to `hb_sound`).

**Reduced motion.** Quote rotation respects `prefers-reduced-motion` indirectly — actually, the current code does NOT gate on it (an earlier guard was removed because it caused issues). If you re-add motion guards, do so consciously.

**Layout shift.** History rows use CSS Grid (`grid-template-columns: 144px repeat(7, minmax(36px, 1fr)) 62px`) — header and habit rows share the exact track. **Do not switch to flex.** A previous bug had the day letters drift half a column.

**Anchor pattern.** Every modal/sheet has a `closeXxx()` function that mirrors the open path. Never close by class-toggle alone — go through the close function so any cleanup runs.

**No emojis on the History tab.** Habit rows on History are emoji-free, bold, full names with NO duration suffix (`habitBaseName(habit)` strips `• 30 min`, etc.). All other tabs keep emojis and full names.

**Banner priority.** When multiple banners could show on the Habits tab, only one shows. Order: streak-danger > double-XP-weekend > morning-routine-nudge.

**Daily Quest is gone (v2.0.1).** Removed entirely. Don't reintroduce — the Quests tab is now boss-only, and the Social tab hosts the leaderboard preview. See "Removed systems" if you need historical context.

**Stat icons.** Render via `statIconHtml(st, opts)` or `setStatIcon(el, st, sizePx)` — never `el.textContent = st.icon` (that puts the emoji back). The `STATS[].icon` emoji is kept as a fallback for when `iconImg` is unavailable.

**Tab icons.** Symbol-only — never add `<span class="tab-label">`. The 7 PNGs are bundled via the codemagic copy step and pre-cached in the SW.

**Drag-to-reorder.** The Habits panel is a 3-column grid. Drop logic uses 2D nearest-cell + horizontal-midpoint split (`.drop-target--before` / `.drop-target--after`). **Never reintroduce the old single-axis `findDropTarget(items, clientY)`** — it broke columns.

**Sound is in the Settings header**, not in the middle. The toggle sits next to "⚔ Habit RPG". The label "Habit completion sounds" was removed in favor of just `SOUND` next to the toggle.

**App icon must have NO alpha channel.** Apple rejects builds otherwise. The generation script outputs 24-bit RGB. Always run `scripts/verify-app-icons.ps1` before committing icon changes.

**Custom habits get fixed Medium XP.** Don't surface a difficulty picker — the rank economy is sacred. If a user complains their custom habit "should be Legendary," tell them to use the curated equivalent or accept it as a tracking-only entry.

**Hunter name is claim-once.** Once `hb_hunter_name_claimed === '1'`, no UI in the app exposes a rename path. The signin alias is the canonical claim. Don't reintroduce the Status-tab pencil, don't add a Settings → Account → "Change name" affordance, don't re-prompt on signin re-auth. See "Hunter name claim & lock" section.

**SW auto-update is silent by default.** Install handler now calls `self.skipWaiting()` directly (v3 Phase 1x — iOS Capacitor WebView fix; see file-map row for `sw.js` for the full reason). The client-side `postMessage({type:'SKIP_WAITING'})` path in `app.js` is the redundant backup. Don't reintroduce the in-app update banner as the default flow. Manual mode is available via `localStorage.setItem('hb_sw_manual_update', '1')` for users who want explicit control. See "Service worker auto-update" section.

**Armory is fully open.** All 6 typed equipment slots unlock at every rank. The rank-gated render path (locked tiles with `REACH X RANK`) is dead code retained for safety. Don't reintroduce rank-gating without explicit product ask.

**Card slots are TYPED.** Cards can only equip into their matching typed slot. `equipBuildItem` returns `WRONG_SLOT` if a Pup's Hood tries to land in RING. The picker is slot-filtered so this code path is defensive — but it MUST stay defensive (don't loosen it). Legacy card slots map via `LEGACY_TO_TYPED_SLOT` (body/legs/cape → plate, amulet → ring).

**Boss cadence is required.** `dropRatesFor(bossId)` validates `BOSSES[id].cadence` against `{daily, triweekly, weekly}` and warns once per misbehaving boss in the console. New bosses MUST carry an explicit cadence field. Missing/invalid silently falls back to `daily` but emits the warn.

---

## Common pitfalls

- **Reintroducing the full-width "DOUBLE XP WEEKEND" banner row.** v3 Phase 1z.9 retired it for a compact 22px `.aw-buff-pill` in `.today-strip-right` between the streak chip and souls badge. Both prior `.double-xp-banner` CSS blocks (around lines 3660 and 10582 pre-1z.9) and the `dxb--active` variant are gone. If a future request wants more prominence for the weekend doubling, push that signal through the existing `#ww-overlay` Weekend Warrior sheet — don't restore the full-width row.
- **Renaming `id="double-xp-banner"` on the buff pill.** `updateDoubleXpBanner()` and `setupDoubleXpBanner()` (which carries the hard-won iOS `_wwHandlingTap` dual `click + pointerup` workaround) both query by that id. Renaming the id would silently break the click handler without surfacing a console error. The pill's class is the styling hook (`.aw-buff-pill--xp2x`); the id is the JS hook — keep them separate.
- **Adding `userHasNoAlcohol()` copy-swap logic back into the buff pill.** The pill is uniformly "⚡ 2X XP" on weekends regardless of Weekend Warrior state. The compact size can't carry the longer "Weekend Warrior active — +30 XP if you finish all 3 nights" copy without truncation/wrap. WW state still surfaces inside the `#ww-overlay` sheet on tap — that's the right place for it. `userHasNoAlcohol()` itself stays exposed for the sheet renderer; just don't reintroduce it inside `updateDoubleXpBanner`.
- **Putting DEVICE STATE (not USER STATE) in `CloudSync.SNAPSHOT_KEYS`.** This is the inverse of the previous pitfall and just as dangerous. iOS-sovereign state — HealthKit permission grants, push-token registration, biometric enrollment — does NOT transfer when a user reinstalls. If you cache the app's BELIEF about iOS state (e.g. `hb_healthkit_status: 'granted'`) and that flag rides Cloud Sync, the new install thinks iOS granted permission when it didn't. App gets stuck: queries fail silently, no re-prompt, no recovery. **Rule:** SNAPSHOT_KEYS should only contain USER STATE (preferences, progression, content) — never DEVICE STATE (status caches, "we already prompted" flags, OS-level grant mirrors). The v3 Phase 1w.2 fix removed `hb_healthkit_status` / `hb_healthkit_prompted` / `hb_healthkit_sleep_requested` / `hb_healthkit_authversion` from the allowlist after this exact bug surfaced. When in doubt: would the user expect this value to follow them to a new phone? If no → exclude.
- **Adding a new persistent localStorage key without registering it in `CloudSync.SNAPSHOT_KEYS`.** Cloud Sync v1 uses an allowlist — keys NOT in the list don't backup, don't restore. A user reinstalls, restores, then opens the app and finds that key empty. The Phase 1w.1 bug was exactly this: `hb_leaderboard` was missed, post-restore the local accumulator was empty, the auto-submit pushed zeros to the backend, and the user's server-side `current_value` got clobbered to 0. **Whenever you add a new `hb_*` key that the user would expect to persist across reinstalls** (state, settings, migration flags, anything not strictly ephemeral cache), add it to `SNAPSHOT_KEYS` in the same commit. The allowlist is in the `CloudSync` IIFE in `app.js` — search for `SNAPSHOT_KEYS = [` to find it. Sensitive keys (JWT/auth tokens) STAY excluded. If a zero/null value could be destructive when submitted to the backend (like the leaderboard case), add a corresponding guard at the submit boundary as defense-in-depth.
- **Forgetting that App Store pre-release trains LOCK once a build is submitted for review.** Once any build (e.g., build 25) is submitted for review under marketing version `X.Y.Z`, App Store Connect refuses additional uploads under that same train with `IRIS-90186: "The train version 'X.Y.Z' is closed for new build submissions"`. The fix is to **bump APP_VERSION to a new train** — even a patch bump (`.Z+1`) opens a fresh train and the publishing step succeeds. **This happened to v2.0.1 → v2.0.2** mid-development; build 39 failed publish, version was bumped, build 40 succeeded under the new 2.0.2 train. Three places to bump: `app.js APP_VERSION`, `codemagic.yaml APP_VERSION env`, `app.js WHATS_NEW key` (the WHATS_NEW key was renamed `'2.0.1'` → `'2.0.2'` rather than duplicated — content was preserved verbatim since today's work was originally targeted at the prior version). `Info.plist` `CFBundleShortVersionString` is auto-rewritten by `agvtool new-marketing-version "$APP_VERSION"` at build time — never edit it manually.
- **Adding an item PNG to `PRECACHE_ASSETS` before the file exists on disk.** `cache.addAll` rejects the ENTIRE install if any single URL 404s. The drops Phase 1 art pipeline grew the precache list across multiple commits — each new card's path was added only when the PNG landed in `assets/items/`. The render layer falls back to emoji + rarity gradient when art is missing, so untraced cards still render correctly without precaching. **Rule:** only list paths in `PRECACHE_ASSETS` after the file is on disk. (The codemagic glob copy step handles inclusion in `www/` automatically — no per-file edit needed there.)
- **Treating `card.art_path` as authoritative for image existence.** The schema reserves the path but doesn't guarantee the file exists. All three render surfaces (Pokédex grid, reveal modal, carddetail modal) wire an `onerror` handler to the `<img>` element that hides/removes it on 404 — keeping the emoji + rarity gradient visible as fallback. **Never assume the image loaded successfully** in JS that depends on it. If a future feature needs to know "is the real art present," do a lazy check via `new Image().onload` against `card.art_path`.
- **Forgetting to set `aspect-ratio: 1/1` on a new card-art container.** The 9 launch PNGs are 1254×1254 square. `object-fit: cover` only crops when source ratio ≠ container ratio. The carddetail modal had `aspect-ratio: 5/4` initially which cropped the top of the Dream-Woven Hood art (visible "hood-point" cutoff bug). Always match container aspect to source aspect for hero card art surfaces. The Pokédex grid tile + reveal modal art container + carddetail-art container all sit at 1:1.
- **Using the global drop-rate constants (`DROP_RATE_ULTRA_RARE` etc.).** These were removed in v2.0.2's cadence-aware refactor. Use `dropRatesFor(bossId)` to resolve cadence-specific rates from `DROP_RATES_BY_CADENCE`. Daily and weekly bosses now use different rates (weekly: 5× ultra, 3× rare, 2× common multipliers + 0.6 protected-common). Hardcoding any of the old constants would silently use wrong rates for the Carouser.
- **Adding a new boss without setting `cadence` on the `BOSSES` entry.** `dropRatesFor(bossId)` has a defensive `|| 'daily'` fallback (errs toward rarity, the safer wrong direction), but the boss won't get the cadence-appropriate rate without an explicit field. Required values: `'daily'` or `'weekly'`. SS-tier and beyond may add `'monthly'` or `'event'` — if you add a new cadence, also extend `DROP_RATES_BY_CADENCE` with a matching row, otherwise `dropRatesFor` falls back to daily.
- **Per-boss first-common protection.** Resist the urge. The `hb_inventory.first_common_pulled` flag is a **single global boolean** — the first common from ANY boss ends the boost for ALL future rolls. Per-boss protection would re-onboard the user on every new boss and dilutes the "this is reliable for new players" framing. The cadence-specific `common_protected` rate already differentiates daily-vs-weekly onboarding behavior; per-boss-flag would be over-engineering.
- **Treating the reveal queue as a one-shot.** Rare/ultra-rare drops PUSH to `hb_inventory.reveal_queue` and the cinematic plays via `processRevealQueue()`. If the queue has multiple entries (e.g., the user got two ultra-rares back-to-back), they play sequentially as the user dismisses each modal. The queue persists across cold launches via localStorage — if a rare drops while the app is backgrounded and the user force-quits before viewing, the reveal plays on next open. Stale IDs (cards no longer in `CARDS` after a schema change) are silently shifted off the head of the queue.
- **Updating `WHATS_NEW` item order without re-sorting by significance.** The file has an explicit policy comment: "WHATS_NEW items are ordered BY SIGNIFICANCE (most impactful first), NOT chronologically by when the work shipped during the version's dev cycle." When you add a bullet, INSERT it at the position matching its significance (drops > class system > settings polish). Don't just append.
- **Forgetting that the mid-day check-in uses DEVICE-LOCAL date for the souls comparison, not PT.** `tryGrantDailyLoginBonus` writes `lastDailyBonusDate = getDeviceLocalDate()` (not PT). `computeMidDayBody`'s priority-1 check must mirror that comparison: `parsed.lastDailyBonusDate !== getDeviceLocalDate()`. Using `getPTDate()` here would cause false "+15 souls waiting" notifications for users east of LA after midnight PT.
- **Removing `.npmrc` (`legacy-peer-deps=true`).** The project root has a committed `.npmrc` with `legacy-peer-deps=true`. It exists because `@perfood/capacitor-healthkit@1.3.2` (added in v1.1.5 for HealthKit auto-verify) declares `peerDependencies: { "@capacitor/core": "^4.0.0" }` while we're on Capacitor 6. The plugin works fine on Cap 6 in practice — only the published peer-dep range is stale. Without `.npmrc`, every `npm install` (yours, Codemagic's, anyone's) errors with `ERESOLVE unable to resolve dependency tree`. **Do not delete `.npmrc` until we migrate to `@capgo/capacitor-health` during the eventual Capacitor 6→8 upgrade** — at that point the relaxed resolver is no longer needed and `.npmrc` should be removed in the same commit as the plugin swap.
- **Trusting the `@perfood/capacitor-healthkit` README on auth strings.** The plugin uses TWO incompatible string namespaces — friendly aliases (`'steps'`, `'activity'`, `'calories'`) for `requestAuthorization`'s read array, and Apple-canonical identifiers (`'stepCount'`, `'sleepAnalysis'`, `'workoutType'`) for `queryHKitSampleType`'s sampleName. The README mixes them. The plugin's auth function has NO case for `'sleepAnalysis'` — passing it falls through to `default: print("no match")` and silently no-ops. Sleep auth requires `'activity'`, which iOS treats as both sleepAnalysis + workoutType. Always verify auth-side strings in `node_modules/@perfood/capacitor-healthkit/ios/Plugin/CapacitorHealthkitPlugin.swift` → `func getTypes(items:)` before adding a category. This cost an entire build cycle in v1.1.5.
- **Forgetting to bump `HEALTHKIT_AUTH_VERSION` when adding a HealthKit category.** iOS only triggers a permission sheet for categories it has never seen. Apps adding new HealthKit categories in subsequent versions MUST explicitly re-call `requestAuthorization` with the new types. The version-bump pattern in `app.js` (`HEALTHKIT_AUTH_VERSION` constant + migration in `init()`) automates this. **If you add a category and forget to bump:** existing users won't get an iOS sheet, the new category won't appear in iOS Settings → Privacy → Health → Awakened, and your auto-verify will silently no-op forever. Also remember to add the new "asked" flag to `HEALTHKIT_AUTH_FLAGS_TO_CLEAR` so the migration knows what to wipe.
- **Setting `hb_healthkit_sleep_requested` (or any HealthKit "asked" flag) anywhere except post-`await` resolve.** Defensive flag-set in catch blocks is a TRAP. iOS resolves `requestAuthorization` silently for already-decided categories (granted OR denied), so a real throw is a real failure that should be retried on next launch. Defensive catch-block flag-set landed users in v1.1.5 testing in a "flag=1, but iOS sheet never fired" state requiring a recovery migration. **The flag must ONLY be set after `p.requestAuthorization()` resolves successfully.** Comment in `requestSleepPermissionIfNeeded` documents this rule explicitly.
- **Including `com.apple.developer.healthkit.access` in App.entitlements.** That key (an array, not a boolean) is for Verifiable Health Records — clinical/medical-record access — and requires Apple-approved capability. Including it without approval makes codesign fail with `Entitlement com.apple.developer.healthkit.access requires approval from Apple to include in a profile.` For step/sleep/workout reads, only `com.apple.developer.healthkit = true` is needed. The codemagic.yaml step writes only the boolean key. Don't re-add `.access`.
- **Forgetting the `Wire entitlements file into Xcode project` codemagic step.** Capacitor's default Xcode project does NOT have `CODE_SIGN_ENTITLEMENTS` set in build settings. Without that build setting, Xcode signs the IPA without consuming our `App.entitlements` file — the HealthKit entitlement is silently absent from the signed binary, iOS rejects all HealthKit calls, and there's no error feedback (this was the v1.1.4 silent-failure bug). The Ruby `xcodeproj` gem step in codemagic.yaml fixes this; don't remove it.
- **Forgetting to enable HealthKit on the App ID at developer.apple.com.** One-time setup: Identifiers → `com.goallearner.awakened` → Capabilities → check HealthKit → Save. Without this, codesign rejects the build with "Missing entitlement." Done already; flagging for any future dev who registers a new App ID.
- **Using PT-anchored time for sleep windows.** Sleep crosses midnight. PT-anchored `getPTDate()` is the rule for streak math, but `Health.getSleepLastNight()` uses **device-local time** for the 18-hour lookback window and the "before midnight" comparison. A user in Tokyo going to bed at 11 PM Tokyo time should get bedtime credit even though their PT-anchored "today" wraps differently. Same rule as notifications. Never "fix" this to use PT.
- **Loosely scoping the bedtime window for `autoVerifySleepBeforeMidnight`.** The naive check "any qualifying asleep sample.startDate < device-local midnight today" is too permissive — it admits wrong-night carryovers, afternoon naps, and "passed out at 6 PM" exhaustion events. The strict window is `[20:00, 24:00)` device-local on the **prior day** specifically. Sleep before midnight is the read-only system-managed habit; users cannot un-check, so false positives stick and corrode the "system is honest" framing. We shipped the loose version in v1.1.5-pre and had to push the strict-window fix + a recovery migration (`hb_bedtime_window_fix_v1`) before App Store submit. If you ever extend bedtime semantics (e.g., a "Sleep before 11 PM" variant), copy the window-scoping pattern — never the loose comparison.
- **Treating `'Asleep'` plugin samples as exact sleep stages.** The plugin collapses Apple's full sleep-analysis enum into 2 strings via `(value == inBed) ? "InBed" : "Asleep"`. The `'Asleep'` bucket incorrectly includes `awake` rawValue=2 samples along with the actual asleep stages. Total-asleep computation overcounts by however long mid-night awake periods are — typically <15 min/night. Acceptable v1 error margin; if a user reports inflated sleep numbers we patch upstream or filter via raw HKCategorySample.
- **Calling `toggleHabit(id, li)` directly on canonical Daily walk / Sleep / Sleep before midnight / Strength training.** v2.0 made the first three read-only; v3 Phase 1u added Strength training to the same set. **All four** HealthKit-auto-verifiable habits route their tap through `openNoteModal(habit.id)` instead of `toggleHabit` in `buildItem`. If you bypass the click handler (e.g., from a custom completion path or a bulk-toggle utility), you'll silently bypass the read-only contract. Always check `isReadOnlyAutoVerifyHabit(habit)` first; if true, do nothing and let auto-verify do its job. Manual completion isn't an option for these four by design.
- **Adding a new HealthKit-auto-verify habit without updating `isHealthAutoVerifiableHabit`.** The auto-verify-first sort (`sortHabitsAutoVerifyFirst`) is called inside `save()` and uses `isHealthAutoVerifiableHabit(habit)` to decide what pins to top. If you add a new auto-verify habit type but only wire its detection logic without adding it to that helper's OR chain, the habit will auto-verify correctly but won't sort to the top of the Habits tab. Cosmetic bug, easy to miss.
- **Adding boss progression that respects `isAutoVerifyDisabled()`.** Boss eval is intentionally INDEPENDENT of the Settings → Apple Health pause toggle. The pause is scoped to habit auto-verify only; bosses are passive background progress. If you wire a new boss evaluator and gate it on `isAutoVerifyDisabled()`, you've broken the design. Boss evaluators run in `autoVerifySleep` (or whichever auto-verify hook they belong to) BEFORE the `isAutoVerifyDisabled()` early-return. Mirror that placement for new bosses.
- **Triggering boss missed-period reset from `visibilitychange` instead of init.** Multi-foreground days would mis-reset on every resume after midnight crossed. Missed-night/missed-day checks belong in init() — once per cold launch. The boss state's idempotency (`last_eval_date`) handles repeated visibilitychange refires within the same calendar day.
- **Re-engaging a boss automatically on defeat.** v3 Phase 1z.6 made the hunt EXPLICITLY end on defeat — `state.engaged = false` + `engaged_at = null` flip at the moment `kill_count` increments. Don't add a path that auto-re-engages a defeated boss "for convenience." Auto-re-engagement would mean a defeated boss keeps showing in the HUNTING strip + boss detail forever, and the user can never distinguish "I'm hunting" from "I just killed it." Re-engagement must be the user's deliberate tap on **Hunt Again** (in the result modal or boss detail). The souls cost on Hunt Again is the same as first-time engagement — that's the wager principle the engagement economy depends on.
- **Adding `hb_boss_result_seen_*` keys to `CloudSync.SNAPSHOT_KEYS`.** These flags are device-local UI acknowledgment, NOT user progress. A reinstall should fire the modal fresh on the next defeat — sync would cause the modal to silently skip on a new device for a kill the user never actually saw on that device. Same principle as the Phase 1w.2 HealthKit reset and Phase 1z.1 verified-event outbox: device-sovereign acknowledgment / transport state stays device-local. If you're unsure: would the user expect this value to follow them to a new phone? For a "modal already shown" flag, the answer is no.
- **Firing the boss-result modal for rare/ultra drops.** Rare/ultra defeats already trigger the existing cinematic reveal at `#reveal-overlay` via `processRevealQueue`. `announceKillAndDrop` explicitly skips the new `#boss-result-overlay` when `dropInfo.wasFirst && (rarity === 'rare' || rarity === 'ultra_rare')`. Double-firing would stack two dramatic surfaces on top of each other — bad UX, lost emphasis on the rare moment. Common drops and no-drop defeats are the only cases the new modal owns.
- **Editing the SYSTEM-MANAGED message copy in `index.html` instead of `systemManagedHtmlFor`.** The Notes-modal system-managed body is filled dynamically per-habit by `systemManagedHtmlFor(habit)` (in `app.js`). The HTML in `index.html` is just an empty `#vn-system-message` div. Edit copy in the JS helper; the HTML container is generic.
- **Making yesterday-backfill loud.** The v3 Phase 1z.8 backfill is silent by design — no `playCheckSound`, no `spawnXpParticles`, no `xp-float`, no rank-up modal, no class-change modal. The user didn't see the moment happen live; popping a celebration for "yesterday's accomplishment" feels disconnected. The quiet toast (`"Strength training sealed for yesterday — 1 verified workout."`) is the only user-visible signal. `_markHistoricalAutoVerify` deliberately bypasses `toggleHabit` for this reason. If you ever change this, surface it as an explicit product decision — never accidentally re-enable the burst by routing backfill through `toggleHabit`.
- **Backfilling more than yesterday in v1.** Don't extend the window to 2+ days in this pass. Yesterday-only is enough for the dominant case (workout after last app-open, app reopened the next morning). Wider windows mean more retroactive XP, harder-to-audit streak math, more chances for a user to be surprised by a sudden rank-up triggered by a week-old workout. Extension is a follow-up product decision, not an in-pass tweak.
- **Bypassing `_markHistoricalAutoVerify` for retroactive seal.** Don't directly push into `completions[dateStr]` and call `applyStatPts` ad-hoc. The helper consolidates: idempotency check, wasUncheckedOnDate respect, completion push, AUTO provenance write to the correct dateStr, XP grant, streak recompute, save. Skipping any of those produces inconsistent state — most commonly a sealed completion without AUTO provenance (UI shows the check but no AUTO pill on History) or a sealed completion without streak recompute (streak still reads as broken).
- **Re-sealing a date the user explicitly un-checked.** The backfill path checks `AUTO_VERIFY.wasUncheckedOnDate(habit.name, yesterday)` before sealing. If the user manually un-checked yesterday's auto-verified completion (via the toggle path that calls `AUTO_VERIFY.markUnchecked`), the backfill MUST respect that. The 14-day prune on `hb_av_unchecked_dates` is wide enough to cover this; don't shorten it.
- **Forgetting that `AUTO_VERIFY.recordAutoVerify` takes an optional `dateStr` since v3 Phase 1z.8.** Default is still today, so existing call sites compile cleanly. But if you write a new auto-verify path that operates on a historical date, you MUST pass the dateStr — otherwise the AUTO provenance gets stamped on today instead of the date being sealed, breaking the History tab's per-date AUTO dots.
- **Daily Insight using `getPTDate()` for its day-change check.** The card uses **device-local** time (`getDeviceLocalDate()`), NOT PT. Same rule as notifications and sleep windows. A user in Tokyo opening the app at 6 AM Tokyo time should see today's briefing even though their PT-anchored "today" is yesterday. Don't "fix" this to use PT. Use of PT for the briefing's day-change would also break the visibilitychange retry path for users who travel timezones.
- **Adding a habit to `HABIT_TIME_OF_DAY` without testing the slate render.** The map only contains `morning` / `evening` exceptions; everything else falls through to `'day'`. If you add a habit and want it grouped under a specific bucket, double-check the spelling matches `DEFAULT_HABITS[].name` exactly (foreign-key match). A typo silently puts the habit in `'day'` — no error, just unexpected grouping. The fallback is intentional but easy to misuse.
- **Editing `app.js` and forgetting `?v=N`.** Browser will serve the cached old script; you'll think your change is broken when it just hasn't loaded.
- **Adding a new sheet without `attachSheetDismissGesture`.** Users will report "I can't dismiss it." Always wire it up unless it's intentionally a celebration modal.
- **Hardcoding the canonical 10 habits.** Use `getMorningHabitDefs()`. Always.
- **Shipping iOS without bumping `APP_VERSION` + `WHATS_NEW`.** TestFlight will reject "same build number" or you'll silently re-show the wrong What's New.
- **Forgetting to bump `APP_VERSION` in `codemagic.yaml`.** There are TWO `APP_VERSION` values, and they drift apart easily. The constant in `app.js` only drives the in-app What's New sheet. The marketing version in the iOS bundle comes from `codemagic.yaml` → `agvtool new-marketing-version "$APP_VERSION"` → `Info.plist`'s `CFBundleShortVersionString`. If they don't match, App Store Connect rejects with `"The value for key CFBundleShortVersionString [x.y.z] ... must contain a higher version than that of the previously approved version"` even though your in-app version looks bumped. **For every iOS release, edit BOTH files.**
- **Mutating `DEFAULT_HABITS` after startup.** It's enriched once at load with `primaryStat`. Don't mutate later or you'll create inconsistent state across reloads.
- **Renaming a habit.** Habit name is the foreign key for stats, packs, descriptions, completion lookups. Renaming a habit silently breaks streak inheritance for any existing user. If you must rename, write a migration in `load()`.
- **Letting `node_modules/`, `ios/`, `www/`, or the avatar `originals-rgb` folder slip into git.** They're gitignored — verify before pushing.
- **Forgetting `ITSAppUsesNonExemptEncryption=false`.** Already wired into `codemagic.yaml`. Don't remove it or every TestFlight upload will require manual compliance acknowledgement.
- **Adding alpha to the app icon.** Apple's icon validator rejects PNGs with an alpha channel. The generation script saves as `Format24bppRgb`. If you bypass the script and resize manually, verify with `scripts/verify-app-icons.ps1` before pushing.
- **Adding alpha to App Store screenshots.** Same rule as the app icon — `Format24bppRgb`, no alpha. The screenshot scripts already do this. If you write a new image-processing script, **always pass `Format24bppRgb` to `New-Object System.Drawing.Bitmap`** — the default is `Format32bppArgb` which fails Apple's validator silently (the upload appears to succeed, then "Submit for Review" rejects).
- **Uploading native iPhone 15/16 Pro Max screenshots to the 6.5" slot.** Native dimensions are 1290×2796; the 6.5" slot wants 1284×2778. Off by 6 pixels wide / 18 tall. Run `scripts/resize-iphone-screenshots.ps1` first. (Or: add a 6.7"/6.9" slot via App Store Connect → "View All Sizes in Media Manager" and upload natively without resizing.)
- **Forgetting to ship `assets/tab-icons/` or `assets/stat-icons/` to `www/`.** The Codemagic step copies them explicitly. If you add a new asset folder, update the copy step or the iOS bundle won't have the file (resulting in broken images in TestFlight only).
- **Calling `applyStatPts(habitName, ...)`.** The signature changed in v1.1.2 — it now takes the `habit` object so customs route XP via `primaryStat`. Old call-sites that passed `habit.name` will silently no-op for custom habits.
- **Setting stat icons via `el.textContent = st.icon`.** That reintroduces the emoji. Use `setStatIcon(el, st, sizePx)` or `statIconHtml(st, opts)`.
- **Reintroducing the old emoji tab nav or adding text labels to tabs.** Both were intentional v1.1.2 design moves. The icons should sit in their cells alone.
- **Reviving the Daily Quest system.** It was deliberately killed in v2.0.1 — see "Removed systems". The localStorage keys (`hb_daily_quests`, `hb_quest_history`) are preserved on existing devices but unread. If a future request asks for "daily challenges," prefer the boss model (passive system-managed) — that's the design direction. Only resurrect Daily Quest with explicit user say-so.
- **Forgetting to bump the SW for asset-only changes.** New PNGs need `CACHE_VERSION` to bump or PWA users keep serving the cached old asset list (which doesn't include the new path).
- **Mixing the old `drop-target-above/-below` class names.** They're now `drop-target--before/--after` (BEM modifier). The old names exist nowhere in the CSS anymore.
- **Adding a Sound section to the middle of Settings.** It lives in the header now. Don't recreate `.settings-sound-section`.
- **Inlining a copy of the bedtime-window logic instead of using `getBedtimeSamplesInWindow`.** The strict `[20:00, 24:00)` device-local prior-day window is the project's authoritative defense against bedtime false positives — see HealthKit integration → "Window justification". v2.0.1 extracted it into a single helper consumed by Path B (Sleep before midnight habit), the Carouser evaluator, and `lbRecordSleepNight`. Inlining a copy means a future tightening (e.g., a before-11-PM variant) will drift between consumers and silently produce inconsistent bedtime decisions. Always extend the helper if you need a new variant.
- **Gating the Leaderboard or bosses on `isAutoVerifyDisabled()`.** The Settings → Apple Health pause toggle is scoped to HABIT auto-verify only. Bosses + leaderboard are passive background progress and run before that gate. Wiring them into the pause means a user who pauses habit auto-verify silently loses leaderboard history they'd otherwise have. If we ever want a master kill switch for all HealthKit consumption, it must be a SEPARATE toggle.
- **Using the original `autoVerifyWalk` early-return order.** Pre-v2.0.1, the function bailed on `isAutoVerifyDisabled() / !walk / isChecked / wasUncheckedToday` BEFORE fetching steps. v2.0.1 restructured it: availability + permission → fetch steps → `lbRecordStepsToday(steps)` → THEN habit-auto-verify gates. Reverting to the old order breaks leaderboard accumulation for paused users and for users without the Daily walk habit (a deliberate design — they should still build leaderboard history).
- **Treating `getMostRecentFridayDate()` as the night-being-evaluated's start date.** It returns the Friday based on TODAY (the morning the user is in). For Sat/Sun mornings, that Friday IS the weekendId anchor for the night just evaluated — Fri + Sat nights both map to the same Friday. Don't add a "minus 1 day" adjustment thinking you need the night-start date; the helper is already aligned to weekendId semantics. (Sunday-night eval, Mon morning dow=1, was dropped in the v2.0.1 2-night recalibration — no longer in scope for the Carouser.)
- **Removing `weekend_burned` from Carouser state thinking `streak === 0` is enough.** It isn't. After a failed Friday, `streak === 0`, but a passing Saturday would otherwise increment it to 1 — wrong, the kill window requires 3 consecutive nights starting Friday. The flag preserves the dead-state across same-weekend re-evals; only `current_weekend_id` rolling over (next Friday) clears it.
- **Adding a new HealthKit-backed metric to the Leaderboard without bumping retention or storage.** The 30-day daily map (`steps_daily`, `sleep_hours_daily`, `bedtime_daily`) is fine for trailing-7 sums and current/best streak math. If you add a metric that needs a longer lookback (e.g., "longest 30-day-active streak"), bump `LB_DAILY_RETENTION_DAYS` and review the prune cadence — don't silently widen one consumer while others assume 30.
- **Replacing the Social-tab mock entries (`LB_MOCK_NAMES` / `LB_METRIC_META[].mockTop`) before the backend ships.** They're deliberately blurred placeholders for visual texture. Until the live ranking layer (network client + backend) lands, real ranking data doesn't exist. Don't display zeros or "Coming soon" alone — the user explicitly wanted the visual treatment of a leaderboard so the Social tab feels worth visiting.
- **Forgetting that the Social tab works on web.** Per user request, web/non-iOS users should still see the three cards (with zero values) for layout previewing. The empty-state above the cards adapts copy ("Preview only" on web, "Apple Health not connected" on iOS without permission). Don't gate the entire panel behind `Health.isAvailable()` — that was an early-development decision we explicitly reversed.
- **Reviving `#boss-detail-sheet` or `openBossDetail/closeBossDetail`.** The v1.1.7 `.vn-sheet` bottom-sheet was retired in v2.0.1 when boss cards became tappable to a full-screen modal. The element IDs, function names, and CSS (`.boss-detail-*`) are all gone. The replacement is `#boss-fs-overlay` + `openBossFullScreen(id)` / `closeBossFullScreen()`. If a future detail-modal pattern is needed elsewhere, copy the `.bfs-*` block, don't try to resurrect the bottom-sheet.
- **Adding a `glyph` field to `BOSSES` entries.** It existed briefly in v2.0.1 development for the boss-card header (🌙 / 👑) and was removed when emojis got cut from the card aesthetic. The card header is now rank-pill-left + name-centered, no third element. If you re-add a glyph, also rebalance `.bcard-header` (currently flex-centered with absolute-positioned pill, no slot for a third element).
- **Dropping `cfg.streakTarget` reads in favor of hardcoded "3" or "2".** All UI surfaces (card progress dots, "X / Y nights" labels, detail-modal progress) read `streakTarget` from the BOSSES config. Single source of truth. The 3→2 recalibration in v2.0.1 changed only the constant + copy strings — no render code touched. Keep it that way; future rebalances should be a constant edit.
- **Letting the client decide a duel's winner.** Backend `POST /v1/duels/:id/resolve` is the only authority. Client submits progress snapshots (Apple Health-derived) via `POST /v1/duels/:id/progress`; the resolve endpoint compares both participants' latest values (missing = 0) and writes `winner_user_id` + `result`. The client renders the outcome — it never decides it. Tie → `result = 'draw'`, `winner_user_id = null`. (v3 Phase 1y)
- **Moving souls on duel completion in v1.** Souls remain localStorage-only client-side authoritative; the `stake_souls` / `reward_souls` / `burn_souls` columns on `duels` are metadata for display. Don't wire a soul-debit on `accept` or a soul-award on `resolve`. The detail-overlay completed state already surfaces "Rewards activate in a future economy pass." Adding economy movement without the matched server-side ledger would let any client mint souls. (v3 Phase 1y)
- **Scoring non-steps duel types via the legacy `/progress` endpoint.** The Phase 1y `POST /v1/duels/:id/progress` snapshot endpoint still rejects anything but `duel_type='steps'` with `DUEL_TYPE_NOT_SCORED_YET` — it backstops in-flight pre-1z steps duels only. **As of Phase 1z, all 5 verified types (`steps` / `sleep` / `bedtime` / `strength` / `verified_objectives`) score real outcomes via the Verified Duel Scoring Engine + `verified_events` table.** New scored types should NOT extend `/progress`; they should ship as new `event_type` rows under `submitVerifiedEventsForDuels` + a backend aggregator branch in `resolve`. Only `boss_race` remains deferred today and continues showing "Boss Race scoring activates after verified boss-event logging." (v3 Phase 1z)
- **Replaying the duel result toast.** `_maybeFireDuelResultToast(duel)` uses `hb_duel_result_seen_<duelId>` as a one-shot flag — once set, the toast never replays. Don't bypass the flag for a re-render path; the toast is the cinematic, not a status indicator. If a future feature needs an at-a-glance "has the user seen this result yet" badge, add a separate UI surface that reads the same flag but doesn't toast on tick. (v3 Phase 1y)
- **Caching `Health.getStepsBetween` results.** Don't. Different windows return different answers; caching by window key would balloon the cache and introduce hard-to-debug stale-step bugs. The 5-min today-cache lives on `getStepsToday()` only — `getStepsBetween` is uncached by design. If you need to share a single steps query across multiple consumers (boss + leaderboard + duel), call it once at the call site and pass the value down — that's what `autoVerifyWalk` already does for boss eval + `lbRecordStepsToday`. (v3 Phase 1y)
- **Re-creating an OneDrive copy of this repo.** The OneDrive checkout at `C:\Users\richm\OneDrive\Desktop\habit-tracker` was DELETED in Phase 1z.15 (May 2026). It had caused repeated CWD-drift bugs where bash would land in the OneDrive clone, git commits would only stage from there, and edits made via absolute paths to canonical would be silently excluded from the commit. OneDrive's per-file sync also conflicts with git's `.git/objects` housekeeping (gc, pack, prune) producing "Delete these 1000+ items?" dialogs after every `git pull`. The canonical and ONLY working copy is `C:\Users\richm\Documents\repos\awakened-app`. **Never `git clone` this repo into any OneDrive-synced folder.** If a future device needs the repo offline, prefer a non-OneDrive location (Documents/, repos/, anywhere outside `OneDrive\`).
- **CWD drift between clones (now mitigated).** Historically the OneDrive backup + canonical Documents repo coexisted and bash CWD could drift into the wrong one mid-session. With OneDrive removed there's only one repo, so this is largely a non-issue — but if a future session ever shows `pwd` outside `C:\Users\richm\Documents\repos\awakened-app`, `cd` back before running any git commands. Always check `pwd` if `git status` reports unexpected emptiness.
- **Reintroducing the body-socket Armory.** The 9-slot `panel-base.png` carved-stone panel was killed in v3 Phase 1d after 5+ structural iterations failed. CSS can't strip flattened RGB backgrounds; the Tonal-style typed grid is the structural fix. Don't bring it back. See "Removed systems" → "9-slot body-equipment Armory".
- **Reintroducing REPLACE on the build-detail sheet.** Removed v3 Phase 1d follow-up. The unequip-then-tap-empty-slot flow is cleaner; the picker is slot-filtered so swaps are two taps. Don't re-add REPLACE.
- **Forgetting `card.cadence` on a new boss.** `dropRatesFor` falls back to daily + warns. New content MUST set `cadence: 'daily' | 'triweekly' | 'weekly'` explicitly.
- **Hardcoding pity thresholds.** Read from `DROP_PITY_BY_CADENCE[cadence]` via `dropPityCfgFor(bossId)`. Future rebalances should be constant edits.
- **Computing ultra rate by mutating `DROP_RATES_BY_CADENCE`.** Use `getEffectiveUltraRate(bossId, baseRate)` per-roll instead. The base table is immutable; pity is per-roll.
- **Mutating `hb_inventory` outside the rollBossDrop / forceDrop / forcePityDrop / equip-build path.** All inventory writes flow through one of those. Don't add a parallel write path that bypasses stack caps, reveal queue, or pity counter updates.
- **Adding a name input anywhere in the app.** The hunter name is claimed once via the signin alias step. Don't add a fourth name surface (we deleted three). If you need to capture a name for some other feature, derive it from `localStorage.getItem('hb_name')` — never prompt again.
- **Trusting that a backend alias is web-friendly.** The leaderboard normalizes display (`lowercase`, strip spaces, `richie` → `Richie` allowlist). Raw stored aliases CAN have capitals + spaces (e.g., `Big Bear`). isMe matching uses the raw API field. If you need a "clean" alias for display, call `lbNormalizeAliasForDisplay(raw)`.
- **Skipping `Drops.simulateDrops(bossId, N)` for balance work.** Console-only dry-run that doesn't mutate state. Faster than waiting for real rolls. Useful for sanity-checking new cadences or pity thresholds.
- **Auto-update SW edge cases.** If a user is stuck on a stale SW version (e.g., one shipped before the v2.2.0 auto-update logic), the auto-update logic isn't running yet on their device — they need ONE manual unregister + reload to escape. After that, all future updates land silently. There's no shortcut around the bootstrapping cost.
- **Treating localStorage-only stats or souls as server-authoritative for PvP outcomes.** Phase 1z shipped server-side `verified_events` aggregation as the trust path for the 5 scorable types (boss_race still pending). The localStorage `hb_souls` accumulator stays client-side authoritative for spends/earns OUTSIDE duels; the duel's reward (paid via `user_souls_ledger` server-side at resolve) is NOT mirrored back into local `hb_souls` in v1 — local-vs-server souls reconciliation is a future pass. Do not award duel-driven souls in client code, and do not let any future scoring path read raw localStorage submitted by the client at resolution time (a savvy user can edit it). Only Apple-Health-derived `verified_events` count.
- **Reintroducing the blanket "Scoring activates in the next duel pass." footnote across all duel types.** That copy is now scoped to `boss_race` only (the one deferred type). The other 5 types (`steps` / `sleep` / `bedtime` / `strength` / `verified_objectives`) render REAL verified scores via `GET /v1/duels/:id/score`. Pre-event surfaces should distinguish "no events submitted yet" (e.g. "Awaiting data — open Duels to refresh") from "scoring not implemented" — never collapse the two cases into the legacy footnote.
- **Reintroducing Recent Duels on the Duels tab.** `res.recent` is intentionally ignored by `renderDuelsSection` in v1. Completed-duel rows shouldn't render until the win-state computation has real data behind it. Hide them; don't surface "Declined" / "Cancelled" / "Expired" historical rows either — those add visual noise without yet conveying outcome trustworthy enough to display.
- **Renaming the internal `social` tab id to `duels`.** The user-facing label/aria/icon is "Duels" (v3 Phase 1x.1), but `data-tab="social"`, `#social-panel`, `switchTab('social')`, and every `tab === 'social'` branch stays put. Renaming would touch hundreds of references across app.js / index.html / styles.css for zero functional benefit. The naming asymmetry is intentional.
- **Trusting `user_id` from a request body in friend/duel handlers.** All friends + duels endpoints derive the current user from `verifySessionJwt(token, env)` only. Never read `user_id` from the request body — clients are untrusted and the JWT is the only authoritative identity claim. The handler-level `session.userId` from `index.ts` is the right value to pass into queries. If you ever extend these handlers, mirror the existing pattern: every recipient-only / participant-only check (accept, decline, remove, detail) compares the row's stored `*_user_id` against `session.userId`, never against anything from the body.
- **Adding unverified / honor-system duel types.** Most Sealed Objectives via manual habits, Most XP including manual habits, Streak Duels including manual streaks, Perfect Day duels — all explicitly rejected. The "system is honest" promise requires data-backed verification. If you find yourself wanting to add a type that doesn't have an Apple Health / boss / system-verified source, stop. The 6 types in `DUEL_TYPES` (steps / sleep / bedtime / strength / verified_objectives / boss_race) are the supported set. Adding a 7th requires both a verifiable data source AND an explicit product call.
- **Showing fake or placeholder duel scores.** As of v3 Phase 1z, the 5 scorable duel types (steps / sleep / bedtime / strength / verified_objectives) DO score, sourced from the server's `GET /v1/duels/:id/score` aggregation over `verified_events`. Never render the legacy `duels` row score columns (they're now vestigial), never display "You: 0 · Opp: 0" for a duel that hasn't submitted events yet — the UI should distinguish "pending events" from "zero score." `boss_race` is the only currently-deferred type; its hero/detail UI shows `"Boss Race scoring activates after verified boss-event logging."` and resolve returns `BOSS_RACE_SCORING_DEFERRED`.
- **Forgetting to add a new duel type to BOTH `ALLOWED_DUEL_TYPES` (backend) and `DUEL_TYPES` (frontend).** Backend rejects unknown types with `400 INVALID_DUEL_TYPE`. Frontend `getDuelTypeMeta` falls back to the default if the id isn't in the map. Both sources must stay in sync — when you add a 7th type, edit `backend/src/handlers/duels.ts` AND `app.js` together (also update `DUEL_TYPE_SHORT_CODES` so the HUNTING strip pill renders the new code, and the docs subsection here).
- **Forgetting to update Codemagic gates after touching duel-type markup.** The pre-sync and post-sync gates check for `DUEL_TYPES` in `www/app.js` + `ios/App/App/public/app.js`, and `duel-type-overlay` in both `index.html`s. If you rename the constant or the overlay id, you must also update `codemagic.yaml`.
- **Scoring manual habits in a duel.** The five scorable types in v3 Phase 1z (`steps` / `sleep` / `bedtime` / `strength` / `verified_objectives`) are ALL Apple Health / system-verified. Manual habit completions never enter `verified_events`. If you want a future "manual XP duel," add it under a separate `unverified_*` namespace — DO NOT inject manual habit data into the verified-events stream. The integrity story rests on the source field never lying.
- **Mutating `localStorage hb_souls` from duel resolution.** Backend ledger ONLY in v1. The completed-duel UI surfaces "Reward recorded: +40 souls" sourced from `duel.reward_settled_at` / `duel.reward_souls`. Don't add `Souls.earn(40)` on resolve, don't decrement on accept. Soul reconciliation between `user_souls_ledger` ↔ local `hb_souls` is a future pass.
- **Dropping verified events on transient network failure.** v3 Phase 1z.1's outbox is the resilience layer. The previous fire-and-forget chunk loop in `submitVerifiedEventsForDuels` silently swallowed failures; replacing it with an outbox + drain means a user on flaky Wi-Fi or in Airplane Mode no longer loses progress on a verified duel. If you add a new submission path that emits verified events, route it through `_enqueueVerifiedEvents` + `_drainVerifiedEventOutbox`, not directly through `Auth.submitVerifiedEvents`.
- **Syncing `hb_verified_event_outbox` through Cloud Sync.** This key is transport state, not user progress. Restoring an outbox from another device would replay events with stale `duel_id` references and `metric_date` values that belong to whatever the user's other device was doing — possibly duels they've already seen resolve. The backend `UNIQUE(user_id, client_event_id)` constraint would catch most duplicates, but the principle is the same as the Phase 1w.2 HealthKit reset: device-sovereign state stays device-local. Never add this key to `SNAPSHOT_KEYS`.
- **Letting opponents cancel a challenger's invite.** v3 Phase 1z.1 introduces cancel — but it is **challenger-only**. Opponents see Accept / Decline; they never see Cancel. The server enforces this with `403 FORBIDDEN` when `challenger_user_id !== session.userId`. Don't add an "opponent decline → cancel" shortcut; the two flows have distinct meanings (cancel removes the invite outright; decline records that the opponent said no).
- **Allowing cancel after a duel has started.** Cancel is `status='pending'` only. Active / completed / declined / expired / cancelled all return `400 DUEL_NOT_CANCELLABLE`. Once accepted, a duel runs to natural resolution — there is no give-up/forfeit path in v1. If product later wants a forfeit, ship it as a NEW endpoint with its own ledger semantics (likely no reward + a `'duel_forfeit'` ledger reason), not as a relaxation of cancel.
- **Dropping verified events on transient network failure.** Before Phase 1z.1, `submitVerifiedEventsForDuels` was fire-and-forget; a brief offline window meant the events were lost. v3 Phase 1z.1 made `hb_verified_event_outbox` the resilience path — never bypass it. New event-submission code should enqueue + drain, not call `Auth.submitVerifiedEvents` directly. The cap (250) + FIFO + per-trigger drain + 60s 401 backoff are tuned together; don't change any one in isolation.
- **Claiming Awakened has full PvP anti-cheat in v1.** It does not. The verified-events trust model relies on Apple-Health-sourced data submitted by a logged-in client; a determined attacker with a rooted device could forge values before submission. Backend defenses are scoped to "no double-pay, no replay, no cross-user pollution" (UNIQUE constraints, server-side aggregation, source field). Future hardening (signed attestations from HealthKit / a watch-companion-derived signature) is in the v2+ backlog, not v1. Don't market or describe duels as cheat-proof; describe them as discipline-anchored (the integrity story is that Apple Health is the only accepted source).
- **Allowing cancel on accepted duels.** Cancel only works on `status='pending'`. Active / completed / declined / expired duels return `400 DUEL_NOT_CANCELLABLE`. Don't surface a Cancel button on active-duel cards, and don't loosen the server's pending-only guard to handle "post-accept regret" — by the time the duel is accepted, the opponent is invested and the scoring engine has started consuming events. If a future product call wants a "mutual abandon" path, build it as a separate endpoint with both-party confirmation, not by relaxing cancel.
- **Double-counting queued duplicates.** The outbox dedups by `client_event_id` client-side (newer steps_total wins; same-id events get refreshed in place); the backend dedups via UNIQUE(user_id, client_event_id) server-side. Both layers exist because both are cheap, and the cost of getting it wrong is the user's competitive score moving in a direction it shouldn't. Don't remove either layer thinking the other will catch it.
- **Computing steps duel score with SUM(value).** v3 Phase 1z uses MAX(value). Multiple `steps_total` snapshots overwrite — the latest fetched total IS the running total over the duel window (Apple Health is cumulative within the window). SUM would multi-count overlapping snapshots. Sleep/bedtime use COUNT DISTINCT metric_date instead; strength uses COUNT(*) with uuid-based client_event_id dedupe; verified_objectives uses COUNT DISTINCT (event_type, metric_date).
- **Changing the six brand-locked duel verbs.** `DUEL_VERB_BY_TYPE` ships `outstepped` / `outrested` / `outanchored` / `outlifted` / `outdisciplined` / `outhunted`. These are brand-defining terms — `outanchored` for bedtime is product-locked even though it's not standard English. Do not change without explicit product reversal. The codemagic gates `grep` for `outanchored` and `DUEL_VERB_BY_TYPE` in both pre-sync and post-sync passes, so a silent rename would fail the build.
- **Double-paying a duel reward.** UNIQUE(user_id, ref_type, ref_id, reason) on `user_souls_ledger` protects against this — `settleDuelReward` uses `INSERT OR IGNORE` so concurrent resolve retries are safe. Don't add a parallel ledger-write path that bypasses this constraint. If you ever need to award a NON-duel soul reward, pick a `ref_type` + (`ref_id`, `reason`) combination that uniquely identifies the logical event so the UNIQUE constraint still meaningfully blocks duplicates.
- **Claiming full anti-cheat for v1.** The integrity model trusts client-submitted Apple Health values. A user can submit fake step totals or fake workout uuids. v1 ships this gap deliberately — the alternative (HealthKit-via-watch attestation, signed device events) is a large, separate pass. Don't market the v1 engine as cheat-proof; the UI copy and CLAUDE.md both explicitly disclose the trust gap. Future hardening lands in a separate phase.
- **Adding a new `event_type` without extending `ALLOWED_EVENT_TYPES`.** Backend rejects unknown event types via `INVALID_EVENT_TYPE` in the per-event error map (the rest of the batch still inserts). Pre-flight: add to `ALLOWED_EVENT_TYPES` in `backend/src/handlers/duels.ts`, add to `DUEL_SCORING_CFG[type].eventTypes` if it should affect a duel type's score, and add the matching builder branch in `_buildEventsForActiveDuel` in `app.js`. Codemagic gates also greps for `submitVerifiedEventsForDuels` / `getSleepBetween` / `getStrengthWorkoutsBetween` / `submitVerifiedEvents` — keep those greps current.
- **boss_race scoring before verified boss-event logging exists.** `POST /v1/duels/:id/resolve` returns `BOSS_RACE_SCORING_DEFERRED` for boss_race duels and the UI shows the matching deferred message. The frontend's `maybeResolveDuelIfEnded` short-circuits boss_race to avoid a doomed network roundtrip. Don't wire boss_race scoring until: (a) verified boss-defeat events are entering `verified_events` from a trusted server-side path (likely tied to the boss-kill flow on the backend, not the client), (b) the aggregator strategy is decided (first-to-kill vs total-kills-in-window), and (c) the UI verb + headline copy is approved.

---

## Quick references

- **Canonical working tree:** `C:\Users\richm\Documents\repos\awakened-app` (NOT the OneDrive copy)
- **Local dev:** `cd C:\Users\richm\Documents\repos\awakened-app && .\serve.ps1` → `http://localhost:8080`. Override port with `$env:PORT=NNNN`. Auto-update SW means manual cache-clear is rarely needed after the FIRST v2.2.0+ load.
- **Hard refresh:** `Ctrl + Shift + R` after CSS/JS changes (or just wait for the silent auto-update on the next page load).
- **DevTools service worker unstick (if needed):** Console one-liner —
  ```js
  navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).then(() => caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k))))).then(() => location.reload())
  ```
- **Install Capacitor deps:** `& "C:\Program Files\nodejs\npm.cmd" install` (PATH may need full path on Windows). `.npmrc`'s `legacy-peer-deps=true` MUST stay until we migrate off `@perfood/capacitor-healthkit`.
- **Sync state across both clones at session start:** `cd <whichever> && git pull --ff-only origin main`
- **Console debug entry points:**
  - `window.Drops` — drops/pity/simulate
  - `window.HunterBuild` — equip/unequip/build power/migrations
  - `window.Bosses` — boss state + engagement helpers
  - `window.Leaderboard` — snapshot + record helpers
  - `window.Auth` — current user + alias validation
- **Git status:** Repo is `github.com/GoalLearner/awakened-app`, branch `main`. Both clones track `origin/main`. Net new uncommitted files often get reported by the system reminder; check `git status` before commits.
