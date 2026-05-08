# CLAUDE.md — Awakened (Habit RPG)

Onboarding doc for any future Claude session working on this project. Reflects the actual state of the code (not what it might become). All values are extracted from the source.

---

## Project at a glance

**Awakened — Daily Habit Tracker** (`com.goallearner.awakened`, name on App Store: *Awakened: Habit RPG*).

A vanilla-JS PWA wrapped into a native iOS app via Capacitor + Codemagic. The app is a Solo-Leveling-flavored habit tracker: each completion grants XP, ranks the user from E → S+, and develops 6 stats that determine a "class." There is no backend — every byte of state lives in `localStorage`.

- **Current marketing version:** `1.1.5` (constant `APP_VERSION` in `app.js` AND `codemagic.yaml`)
- **Service-worker cache version:** `v5.74` (constant `CACHE_VERSION` in `sw.js`)
- **HealthKit auth version:** `2` (constant `HEALTHKIT_AUTH_VERSION` in `app.js` — bump on any new HealthKit category added to the auth call; see "HealthKit integration" section below)
- **GitHub:** `github.com/GoalLearner/awakened-app` (private)
- **iOS App ID:** `6764727990`

---

## Tech stack & file map

Pure HTML / CSS / JS. No build step for the web app. The only "build" is Capacitor wrapping the static files into an iOS bundle.

| File | Purpose |
|------|---------|
| `index.html` | All markup. Tabs, panels, sheets, modals, banners. |
| `app.js` | All logic. Single file IIFE — every runtime constant, every render function, every event wiring. |
| `styles.css` | All styling. Defines a `:root` token set. Dark-mode only — Light theme was removed in v1.1.3. |
| `sw.js` | Service worker. Precaches app shell, avatar PNGs, tab/stat icon PNGs, and app icons (icon-192/512). The dynamic OffscreenCanvas icon generator was removed once real icons shipped. |
| `manifest.json` | PWA manifest. Theme `#0a0a0a`. Standalone portrait. References static `icon-192.png` / `icon-512.png`. |
| `capacitor.config.json` | Capacitor config. `webDir: www`. |
| `codemagic.yaml` | iOS build pipeline. Copies static files → `www/`, runs `npx cap sync ios`, sets `ITSAppUsesNonExemptEncryption=false`, builds & uploads to TestFlight. **Has its own `APP_VERSION` env var that must move with the one in `app.js`.** |
| `serve.ps1` | Local dev server, defaults to port 8080. Cache-Control: no-store. Set `$env:PORT=NNNN` to override. |
| `avatar-*.png` | 8 silhouette PNGs (base + 7 classes). RGBA with proper alpha. |
| `app-icon-source.png` | 1254×1254 master used by `scripts/generate-app-icons.ps1`. Re-run the script after replacing the source to regenerate every iOS size + the PWA `icon-192/512.png`. |
| `icon-192.png`, `icon-512.png` | PWA app icons. **Real static files** (24-bit RGB, no alpha) — generated from the source above. |
| `assets/tab-icons/` | Bottom-nav DALL-E art at 192×192 (~83–106 KB each), plus `*-source.png` masters. 7 icons: `tab-status`, `tab-habits`, `tab-stats`, `tab-history`, `tab-dungeon`, `tab-items`, `tab-social`. |
| `assets/stat-icons/` | Stat icons at 192×192 (~50–80 KB each), plus `*-source.png` masters. 6 icons: `stat-str`, `stat-vit`, `stat-int`, `stat-focus`, `stat-will`, `stat-wlt`. |
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

## Drag-to-reorder habits

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

CSS hooks: `.lp-pressing` (subtle scale-down during 400ms hold), `.drag-ghost` (the lifted clone — `scale(1.05) rotate(-1deg)`), `.is-dragging` on `.habit-list` dims non-dragged siblings to 0.7 opacity.

---

## Per-habit reminders (push notifications)

The `Notif` module lives at the bottom of `app.js` (just above `init()`). Wraps `@capacitor/local-notifications@^6.1.3` for native iOS, falls back to the Web Notifications API for the PWA build.

**Per-habit:** one reminder time at most. Stored in `hb_reminders` as `{ habitId: 'HH:MM' }`. UI lives in the Edit Habit modal:

```
📅 REMINDER
[+ Add reminder]   ← if none set
⏰ 7:30 AM   [Change] [Remove]   ← if set
```

**Voice-coded copy** keyed off `habit.primaryStat`:
- STR → "⚔️ Time to train. {n} awaits." / "The path doesn't walk itself."
- FOCUS → "🧠 Stillness now. {n}." / "Five minutes of focus changes the day."
- INT → "📚 {n} is ready." / "The unlearned version of you is no longer enough."
- WILL → "🥶 {n}. Get in the cold." / "Comfort is the enemy."
- VIT → "💧 {n}." / "The body keeps the score."
- WLT → "💰 {n} awaits." / "Compound the small wins."
- Custom → "🔥 {n} awaits." / "Today, you choose."

**Settings → 📲 REMINDERS** (collapsible) controls:
- Permission status + Enable button (native only)
- Daily limit: 3 (default) / 5 / 8 / Unlimited — keeps the **earliest** N when over the cap
- Quiet hours toggle + start/end (default 22:00 → 07:00). Skips auto-fired reminders within the window **unless** the user explicitly chose that exact time on a habit
- Pause for 24h / 7 days, or cancel pause
- Master "Disable all reminders" toggle
- View All — inline list of every habit + its time + Remove

**Hooks:**
- `toggleHabit` (when checking) → `Notif.onHabitCompleted(id)` cancels today's pending fire so it doesn't nag after completion
- `deleteHabit` → `Notif.clearReminder(id)` permanently cancels
- `checkDayChange` → `Notif.rescheduleAll(...)` rebuilds the schedule with current daily-limit + quiet-hours rules
- App init → same reschedule (rehydrates pause-expirations and any cross-device adds)

**Web fallback:** non-iOS users see "Reminders work best in the iOS app. Install from App Store for full functionality." in Settings. The reminder UI still saves the time — it just can't deliver.

---

## HealthKit integration (v1.1.5)

Two canonical habits auto-verify from Apple Health on iOS. Web/PWA users get manual completion only — no behavior change.

| Habit | Data type | Threshold | Goal config |
|---|---|---|---|
| `Daily walk` | step count | per-habit `habit.stepGoal` (default 3000, range 100–50000) | Edit Habit modal chip picker |
| `Sleep` | sleep duration | per-habit `habit.sleepGoalHours` (default 7, range 3–14, step 0.5) | Edit Habit modal chip picker |
| `Sleep before midnight` | bedtime | binary — earliest qualifying asleep sample.startDate < device-local midnight | None (binary habit) |

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
| `Health.clearCache()` | Wipes step cache. Called on visibilitychange resume + after Edit-modal save. |
| `Health.clearSleepCache()` | Same for sleep. |

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

**Bedtime detection:** `getSleepLastNight()` finds the EARLIEST `'Asleep'` sample whose duration ≥ 30 minutes (the nap floor). Edge case: a user who naps 1+ hours in the evening before going to bed at 1 AM will get a false-positive "before midnight" verdict. Rare; user can manually un-check.

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
function isHealthAutoVerifiableHabit(habit)  // OR of the three above
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

Currently only **`Sleep before midnight`** qualifies. Tapping the card on the Habits tab does NOT toggle the check state — instead it opens the View Note modal (`#note-modal`) with a `SYSTEM-MANAGED` explainer section (`#vn-system-section`) above the canonical description. The user has no manual override; Apple Health is the sole authority. Auto-verify still fires normally via `autoVerifySleepBeforeMidnight()`.

Why: bedtime is binary and observable. Manual completion would let the user "lie" to the app — which breaks the habit's whole premise ("the system is honest with you, even when you might not want to be honest with yourself"). Daily walk and Sleep duration both keep manual completion (their auto-verify is an enhancement, not the sole source of truth — a user might walk without their phone, or Apple Watch might miss a sleep block).

**Visual signal on the card:**
- `.habit-cb--readonly` modifier on the check circle (dashed border, `opacity: 0.72`)
- Small 🔒 glyph anchored top-right of the check circle (`.habit-cb-lock`)
- AUTO pill still renders when auto-verified — both coexist

**Implementation pattern (extending to a future binary auto-verify habit):**
1. Add the habit name to `isReadOnlyAutoVerifyHabit()`'s gate
2. The buildItem render path already branches on `isReadOnlyAutoVerifyHabit(habit)` — adds the lock + dashed border + system-managed title
3. The click handler at `buildItem`'s `li.addEventListener('click', ...)` already routes through `openNoteModal(habit.id)` when read-only
4. The `#vn-system-section` markup in index.html is shown via `refreshHealthPanel`'s sibling logic in `openNoteModal` — `sysEl.classList.toggle('hidden', !isReadOnlyAutoVerifyHabit(habit))`

If a future binary habit needs different system-message copy, swap `#vn-system-section` for a switch on `habit.name` inside `openNoteModal`.

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

## Settings collapsibles

Generic class set: `.settings-collapsible` (wrapper) → `.settings-collapsible-toggle` (header button) → `.settings-collapsible-body` (content). Default `--collapsed` modifier hides via `display: none` (no animation — grid-row collapse breaks with multiple children).

Every toggle has `data-collapsible="<name>"`. `setupCollapsibleSettings()` wires all of them via id pattern: toggle id ends in `-toggle`, body id is the same with `-body`. Drop in a new collapsible by following that pattern — no per-section JS needed.

Currently three collapsibles, in this order, all collapsed by default:
1. **REMINDERS** — see above. Summary shows count or "Paused" / "Off".
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
| Habits  | `tab-habits.png`                  | `main-scroll`    | The daily list |
| Stats   | `tab-stats.png`                   | `stats-panel`    | Radar + 6 tile cards + Next Stat Bonus |
| History | `tab-history.png`                 | `history-panel`  | 7-col grid, no emojis on rows |
| Quests  | `tab-dungeon.png`                 | `quests-panel`   | **Daily Quest lives here** + "MORE QUESTS — Coming in v2.0" placeholder |
| Items   | `tab-items.png`                   | `items-panel`    | Coming-soon placeholder |
| Social  | `tab-social.png`                  | `social-panel`   | Coming-soon placeholder |

Tab icons are referenced by file path inside `<img class="tab-icon">` tags. Active state adds a purple drop-shadow + 1.06× scale. Inactive icons sit at 0.55 opacity. **Don't add `<span class="tab-label">`** — symbol-only is the design.

Bottom sheets (all use `attachSheetDismissGesture()` for swipe-down dismiss):

- `#settings-sheet` — collapsibles (APPEARANCE / REMINDERS / WHAT'S COMING) + What's New + reset
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
| `Health.*` (object) | HealthKit auto-verify system. See "HealthKit integration" section. Public surface: `isAvailable`, `permissionStatus`, `requestPermissions`, `requestSleepPermissionIfNeeded`, `getStepsToday`, `getSleepLastNight`, `clearCache`, `clearSleepCache`. |
| `AUTO_VERIFY.*` (object) | Auto-verified completion metadata + un-checked tracking. `recordAutoVerify`, `clearAutoVerify`, `isAutoVerifiedToday`, `isAutoVerifiedOnDate`, `markUnchecked(name)`, `wasUncheckedToday(name)`. |
| `getHabitStepGoal(habit)` / `setHabitStepGoal(habit, n)` | Per-habit step goal accessor. Default 3000, range [100, 50000]. setHabit calls `save()`. |
| `getSleepGoalHours(habit)` / `setSleepGoalHours(habit, h)` | Per-habit sleep-hours goal accessor. Default 7, range [3, 14], step 0.5. setHabit calls `save()`. |
| `isStepGoalHabit(habit)` / `isSleepDurationHabit(habit)` / `isSleepBedtimeHabit(habit)` | Habit-classification predicates for HealthKit auto-verify. Used to branch goal-control UIs and bypass legacy MEASURABLE_HABITS minimum check. |
| `isHealthAutoVerifiableHabit(habit)` | OR of the three above. Use this in `meetsMinimum()` and similar generic gates. |
| `isAutoVerifyDisabled()` / `setAutoVerifyDisabled(bool)` | Reads/writes the global Settings → Apple Health pause toggle. |
| `canAutoVerify(habit)` | Composite gate combining `isHealthAutoVerifiableHabit` + `Health.isAvailable()` + `permissionStatus === 'granted'` + `!isAutoVerifyDisabled()`. Returns true only when auto-verify will live-fire for this habit right now. Used by Daily Insight's status line + verify-tag rendering. |
| `isReadOnlyAutoVerifyHabit(habit)` | True only for the canonical `Sleep before midnight` habit. Tap routes to `openNoteModal` instead of `toggleHabit`; card renders with lock indicator. See HealthKit integration → "Read-only auto-verify habits". |
| `getDeviceLocalDate()` | `'YYYY-MM-DD'` in the device's local timezone. Used by features whose semantics are "the user's current calendar day" (notifications, sleep windows, Daily Insight) — NOT PT-anchored. Sleep window currently inlines its own equivalent; flagged for future cleanup. |
| `getDaysSinceOrigin()` | Calendar-day count from `originBeginning.dateISO` to today (device-local). Returns 1 on the user's first day, 2 next day, etc. Returns null if no origin record. Drives the "DAY 11" portion of the Daily Insight header. |
| `getHabitTimeOfDay(habit)` | Reads `HABIT_TIME_OF_DAY` map; returns `'morning'` / `'day'` / `'evening'`. Custom habits + unmapped canonicals default to `'day'`. Used by Daily Insight slate grouping. |
| `setupCollapsibleSettings()` | Wires every `.settings-collapsible-toggle[data-collapsible]` to its body sibling. Drop-in for new Settings groups. |
| `playCheckSound()`, `playFanfare()` | Web Audio. Both gated on `soundEnabled`. |
| `esc(str)`, `colorWithAlpha(hex, alpha)` | HTML-escape + color helpers used in inline `style="..."` building. |

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
| `hb_daily_quests`      | `{ 'YYYY-MM-DD': { id, manualDone[], bonusAwarded } }` | Daily Quest state per day |
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
2. Edit `sw.js`: bump `CACHE_VERSION = 'v4.NN'`
3. (For iOS releases only) **Two `APP_VERSION`s must move together:**
   - Edit `app.js`: bump the `APP_VERSION` constant and add a matching `WHATS_NEW` entry (drives the in-app What's New sheet). **Order items within the entry by significance, not chronologically** — net-new daily-visibility features at the top, configuration polish and settings-layer additions at the bottom. The user reads this top-down on every version-update launch; the most impactful change should anchor first impression. See `WHATS_NEW['1.1.5']` for the canonical example.
   - Edit `codemagic.yaml`: bump the `APP_VERSION` env var (drives `agvtool new-marketing-version` → `CFBundleShortVersionString` in `Info.plist`). Forgetting this one causes App Store Connect to reject the upload with "must contain a higher version than ... previously approved version."

The current state is `styles.css?v=169`, `app.js?v=214`, `sw.js v5.74`, `APP_VERSION = '1.1.5'` (in BOTH `app.js` and `codemagic.yaml`), `HEALTHKIT_AUTH_VERSION = 2`. (Re-check from the files; they drift quickly.)

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

**Daily Quest lives on the Quests tab, NOT the Habits tab.** It was moved in v1.1.2 to keep the Habits view focused. The card auto-renders when the user switches to `tab-quests`. The `MORE QUESTS — Coming in v2.0` placeholder sits below it so the tab still teases the future.

**Stat icons.** Render via `statIconHtml(st, opts)` or `setStatIcon(el, st, sizePx)` — never `el.textContent = st.icon` (that puts the emoji back). The `STATS[].icon` emoji is kept as a fallback for when `iconImg` is unavailable.

**Tab icons.** Symbol-only — never add `<span class="tab-label">`. The 7 PNGs are bundled via the codemagic copy step and pre-cached in the SW.

**Drag-to-reorder.** The Habits panel is a 3-column grid. Drop logic uses 2D nearest-cell + horizontal-midpoint split (`.drop-target--before` / `.drop-target--after`). **Never reintroduce the old single-axis `findDropTarget(items, clientY)`** — it broke columns.

**Sound is in the Settings header**, not in the middle. The toggle sits next to "⚔ Habit RPG". The label "Habit completion sounds" was removed in favor of just `SOUND` next to the toggle.

**App icon must have NO alpha channel.** Apple rejects builds otherwise. The generation script outputs 24-bit RGB. Always run `scripts/verify-app-icons.ps1` before committing icon changes.

**Custom habits get fixed Medium XP.** Don't surface a difficulty picker — the rank economy is sacred. If a user complains their custom habit "should be Legendary," tell them to use the curated equivalent or accept it as a tracking-only entry.

---

## Common pitfalls

- **Removing `.npmrc` (`legacy-peer-deps=true`).** The project root has a committed `.npmrc` with `legacy-peer-deps=true`. It exists because `@perfood/capacitor-healthkit@1.3.2` (added in v1.1.5 for HealthKit auto-verify) declares `peerDependencies: { "@capacitor/core": "^4.0.0" }` while we're on Capacitor 6. The plugin works fine on Cap 6 in practice — only the published peer-dep range is stale. Without `.npmrc`, every `npm install` (yours, Codemagic's, anyone's) errors with `ERESOLVE unable to resolve dependency tree`. **Do not delete `.npmrc` until we migrate to `@capgo/capacitor-health` during the eventual Capacitor 6→8 upgrade** — at that point the relaxed resolver is no longer needed and `.npmrc` should be removed in the same commit as the plugin swap.
- **Trusting the `@perfood/capacitor-healthkit` README on auth strings.** The plugin uses TWO incompatible string namespaces — friendly aliases (`'steps'`, `'activity'`, `'calories'`) for `requestAuthorization`'s read array, and Apple-canonical identifiers (`'stepCount'`, `'sleepAnalysis'`, `'workoutType'`) for `queryHKitSampleType`'s sampleName. The README mixes them. The plugin's auth function has NO case for `'sleepAnalysis'` — passing it falls through to `default: print("no match")` and silently no-ops. Sleep auth requires `'activity'`, which iOS treats as both sleepAnalysis + workoutType. Always verify auth-side strings in `node_modules/@perfood/capacitor-healthkit/ios/Plugin/CapacitorHealthkitPlugin.swift` → `func getTypes(items:)` before adding a category. This cost an entire build cycle in v1.1.5.
- **Forgetting to bump `HEALTHKIT_AUTH_VERSION` when adding a HealthKit category.** iOS only triggers a permission sheet for categories it has never seen. Apps adding new HealthKit categories in subsequent versions MUST explicitly re-call `requestAuthorization` with the new types. The version-bump pattern in `app.js` (`HEALTHKIT_AUTH_VERSION` constant + migration in `init()`) automates this. **If you add a category and forget to bump:** existing users won't get an iOS sheet, the new category won't appear in iOS Settings → Privacy → Health → Awakened, and your auto-verify will silently no-op forever. Also remember to add the new "asked" flag to `HEALTHKIT_AUTH_FLAGS_TO_CLEAR` so the migration knows what to wipe.
- **Setting `hb_healthkit_sleep_requested` (or any HealthKit "asked" flag) anywhere except post-`await` resolve.** Defensive flag-set in catch blocks is a TRAP. iOS resolves `requestAuthorization` silently for already-decided categories (granted OR denied), so a real throw is a real failure that should be retried on next launch. Defensive catch-block flag-set landed users in v1.1.5 testing in a "flag=1, but iOS sheet never fired" state requiring a recovery migration. **The flag must ONLY be set after `p.requestAuthorization()` resolves successfully.** Comment in `requestSleepPermissionIfNeeded` documents this rule explicitly.
- **Including `com.apple.developer.healthkit.access` in App.entitlements.** That key (an array, not a boolean) is for Verifiable Health Records — clinical/medical-record access — and requires Apple-approved capability. Including it without approval makes codesign fail with `Entitlement com.apple.developer.healthkit.access requires approval from Apple to include in a profile.` For step/sleep/workout reads, only `com.apple.developer.healthkit = true` is needed. The codemagic.yaml step writes only the boolean key. Don't re-add `.access`.
- **Forgetting the `Wire entitlements file into Xcode project` codemagic step.** Capacitor's default Xcode project does NOT have `CODE_SIGN_ENTITLEMENTS` set in build settings. Without that build setting, Xcode signs the IPA without consuming our `App.entitlements` file — the HealthKit entitlement is silently absent from the signed binary, iOS rejects all HealthKit calls, and there's no error feedback (this was the v1.1.4 silent-failure bug). The Ruby `xcodeproj` gem step in codemagic.yaml fixes this; don't remove it.
- **Forgetting to enable HealthKit on the App ID at developer.apple.com.** One-time setup: Identifiers → `com.goallearner.awakened` → Capabilities → check HealthKit → Save. Without this, codesign rejects the build with "Missing entitlement." Done already; flagging for any future dev who registers a new App ID.
- **Using PT-anchored time for sleep windows.** Sleep crosses midnight. PT-anchored `getPTDate()` is the rule for streak math, but `Health.getSleepLastNight()` uses **device-local time** for the 18-hour lookback window and the "before midnight" comparison. A user in Tokyo going to bed at 11 PM Tokyo time should get bedtime credit even though their PT-anchored "today" wraps differently. Same rule as notifications. Never "fix" this to use PT.
- **Treating `'Asleep'` plugin samples as exact sleep stages.** The plugin collapses Apple's full sleep-analysis enum into 2 strings via `(value == inBed) ? "InBed" : "Asleep"`. The `'Asleep'` bucket incorrectly includes `awake` rawValue=2 samples along with the actual asleep stages. Total-asleep computation overcounts by however long mid-night awake periods are — typically <15 min/night. Acceptable v1 error margin; if a user reports inflated sleep numbers we patch upstream or filter via raw HKCategorySample.
- **Calling `toggleHabit(id, li)` directly on the canonical Sleep before midnight habit.** That habit is read-only — the click handler in `buildItem` routes through `openNoteModal(habit.id)` instead. If you bypass the click handler (e.g., from a custom completion path or a bulk-toggle utility), you'll silently bypass the read-only contract. Always check `isReadOnlyAutoVerifyHabit(habit)` first; if true, do nothing and let auto-verify do its job. Manual completion isn't an option for this one by design.
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
- **Putting the Daily Quest back on the Habits tab.** The user explicitly moved it because it was distracting. The render function bails when `currentTab !== 'quests'` for that reason.
- **Forgetting to bump the SW for asset-only changes.** New PNGs need `CACHE_VERSION` to bump or PWA users keep serving the cached old asset list (which doesn't include the new path).
- **Mixing the old `drop-target-above/-below` class names.** They're now `drop-target--before/--after` (BEM modifier). The old names exist nowhere in the CSS anymore.
- **Adding a Sound section to the middle of Settings.** It lives in the header now. Don't recreate `.settings-sound-section`.

---

## Quick references

- **Local dev:** `cd habit-tracker && $env:PORT=8081; .\serve.ps1` → `http://localhost:8081`
- **Hard refresh:** `Ctrl + Shift + R` after CSS/JS changes
- **DevTools service worker:** Application tab → Service Workers → Unregister, then refresh, if updates feel stuck
- **Install Capacitor deps:** `& "C:\Program Files\nodejs\npm.cmd" install` (PATH may need full path on Windows)
- **Git status:** Repo is `github.com/GoalLearner/awakened-app`, branch `main`. Net new uncommitted files often get reported by the system reminder; check `git status` before commits.
