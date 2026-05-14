# CLAUDE.md — Awakened (Habit RPG)

Onboarding doc for any future Claude session working on this project. Reflects the actual state of the code (not what it might become). All values are extracted from the source.

---

## Project at a glance

**Awakened — Daily Habit Tracker** (`com.goallearner.awakened`, name on App Store: *Awakened: Habit RPG*).

A vanilla-JS PWA wrapped into a native iOS app via Capacitor + Codemagic. The app is a Solo-Leveling-flavored habit tracker: each completion grants XP, ranks the user from E → S+, and develops 6 stats that determine a "class." Dungeon bosses run as a parallel passive-progress system fed by Apple Health data that also auto-verifies habits. Boss kills drop cards/relics that the hunter equips into a 6-slot typed Armory loadout (HELM / WEAPON / PLATE / GLOVES / BOOTS / RING). **v2.1.0** added Sign in with Apple + a real cloud backend with a live global leaderboard. **v2.2.0** rebuilt the launch experience (premium Tonal-style splash + 5-card educational onboarding), pivoted the Armory from a 9-slot body-equipment panel to typed 6-slot loadout, rebalanced drops with a 3-tier cadence (daily / triweekly / weekly) and bad-luck protection (soft + hard pity), reframed the Items tab as the Relic Archive, and added a silent SW auto-update so users never have to clear cache to receive an update. Local habit/stat state lives in `localStorage`; the cloud backend handles auth + leaderboard only.

- **Current marketing version:** `2.2.0` (constant `APP_VERSION` in `app.js` AND `codemagic.yaml`). v2.1.0 (build 35) was submitted for review May 13 1:39 AM PST then the train locked mid-development; the v2.2.0 train opened cleanly on commit `e744a08` and shipped to TestFlight as **build 58** on May 14. Coverage on top of v2.1.0:
  - **New launch experience (v3 Phase 1i)** — pre-rendered AWAKENED splash with small gold hunter-rune emblem stacked over the wordmark, 1800ms min dwell. 5-card educational onboarding fires once for new users (Discipline Becomes Power → Train Your Six Stats → The System Is Honest → Hunt Bosses. Earn Relics. → Shape Your Hunter Build). Gated by `hb_onboarding_seen_v2`; returning users auto-migrated.
  - **Typed equipment Armory (v3 Phase 1d → 1e)** — 9-slot body-equipment panel (the old `panel-base.png` art with carved sockets) RETIRED. New 6-slot 3×2 typed grid: HELM / WEAPON / PLATE / GLOVES / BOOTS / RING. Square card art is intentional. All slots unlocked at every rank (no rank-gating). Slot-type enforcement: cards can only equip into their matching typed slot. Legacy `body`/`legs`/`cape` collapse → `plate`; `amulet` → `ring`. Migration via `hb_equipment_build_migrated_v1`.
  - **Drops v1.7 (v3 Phase 1h)** — three cadence tiers (daily / triweekly / weekly) with cadence-specific rates AND pity. Per-boss first-common protection (replaces the prior global flag). Soft ultra pity boosts the rate past a threshold; hard ultra pity guarantees ultra at the ceiling (daily 40 kills / weekly 8 kills). Any-drop pity prevents repeated empty kills (daily 4 / triweekly 3 / weekly 2). RELIC MERCY readout in boss detail modal shows progress toward both guarantees.
  - **Relic Archive (v3 Phase 1g)** — Items tab renamed; cards show slot badge (top-left), equipped badge (top-right, gold pill), drop-source line below name. Mystery cards reveal rarity + source teaser without naming the item; tap opens a small mystery info modal with HUNT BOSS button. COMMON tier hides silhouettes (commons roll passively); RARE + ULTRA still tease. Cards sort by acquisition date.
  - **Single hunter-name claim + lock (v3 Phase 1j)** — name is claimed once via signin alias, locked everywhere afterward. Status-tab pencil hides; legacy welcome screen + habit-picker name input bypass when already claimed. Flag: `hb_hunter_name_claimed`.
  - **Silent auto-update SW** — `reg.update()` fires on every page load + tab focus. New SW silently `SKIP_WAITING`s without banner click. Version-string compare runs 2s after register as safety net. Manual opt-in via `hb_sw_manual_update`.
  - **Compact MOBA-style Select Relic picker** — slot-filtered, `auto-fill minmax(112px, 1fr)` grid with stat-chip rows. Replaces the prior gallery-sized cards.
  - **Premium EQUIP TO BUILD / UNEQUIP button** — purple→violet primary with gold rim + ✦ rune glyph; muted-navy unequip variant.
  - **Leaderboard alias normalization** — display-only lowercase + space-stripping; allowlist exception for `Richie`. Storage and isMe matching untouched.
  - **Habits tab Codex/card redesign (v3 Phase 1k)** — live Habits tab now uses premium 3-column RPG objective cards with existing habit icons preserved, gold sealed/completed state, colored incomplete rings, system/auto lock rings, compact dashed Add Habits pill, and Morning Routine progress bar. Top "X / Y Habits Today" header remains the single progress summary; the redundant Daily Objectives section header was removed. Markup uses `.habit-item.codex` modifier with legacy class aliases (`.codex-status habit-cb`, `.codex-streak streak-badge`) so existing event handlers stay untouched.
  - **History tab Discipline Ledger redesign (v3 Phase 1p)** — Weekly view rebuilt as a stat-color "gem" discipline ledger. Completed cells keep their stat-color identity (radial gradient + soft glow, NOT generic gold checks), missed cells render a muted red dot inside a low-contrast outline, today's still-pending cell is a dashed gold pulse, off-days are dashed-quiet, future cells are faint outlines. Each habit row carries a stat-color accent stripe on the left edge; long habit names now wrap to two lines (no more ellipsis on "Strength training" / "Meditate & Breathwork" / "No phone after waking"). Apple-Health auto-verifiable habits get a small AUTO badge in the label column + a framed blue dot on each auto-verified cell. New `TRAINED THIS WEEK` section below the grid renders a 6-stat distribution (STR / VIT / INT / FOCUS / WILL / WLT vertical mini-bars with counts) plus a serif insight line ("You leaned VIT + FOCUS this week."). New `WEEKLY REPORT` card replaces the simple stats bar on Weekly mode only: 34px gold completion %, Best Day / Total Done / Best Streak rows, plus a dominant-stat callout with stat-color border. Monthly + Yearly views keep the legacy stats bar untouched. Date nav refined to compact SVG chevrons + `WEEK N · YYYY` eyebrow above the range. "Achieved" sub-tab relabeled "Milestones" (user-facing only; internal mode key still `'achievements'`).
  - **Habits screen vertical-efficiency pass (v3 Phase 1o)** — persistent bottom Morning Routine / pack-progress strip retired from the Habits screen. The top "X / Y HABITS TODAY" tile (`#today-strip`) is now tappable (subtle hover state + chevron) and opens `#pack-progress-modal` — the new canonical access point for routine/pack progress (Morning Routine, Locked-In, streak/shield/honest/add-missing chips all carry over). Quote block compressed (min-height 76 → 38, font tightened). Tab-bar min-height 50 → 44 (still meets iOS 44pt tap minimum). Habit grid top padding 16 → 8 + row gap 11 → 9. Net effect: ~6 full codex habit cards visible on a standard iPhone viewport.
  - **Notification UI redesign + copy rewrite (v3 Phase 1m → 1n)** — Settings → REMINDERS panel restructured: DAILY SYSTEM PINGS / QUIET HOURS / PAUSE / HABIT REMINDERS / VOICE PREVIEW subsections. Permission pre-prompt redesigned with three-card type preview (Morning Briefing / Momentum Check / Evening Closeout). Per-habit and pack reminder offer sheets re-skinned as "System Offer" sheets with ✦ rune glyph on the primary action. Voice Preview cards read LIVE from `composeDigestBody` / `computeMidDayBody` / `pickCheckinCopy` — never drift from production copy. Full copy bank rewritten to "tactical system message" voice (COPY, HABIT_NOTIF_COPY, DIGEST_FLAVOR, composeDigestBody, computeMidDayBody, CHECKIN_COPY). User-facing labels are now Morning Briefing / Momentum Check / Evening Closeout (internal function names retain `digest`/`checkin` for historical reasons).
- **Service-worker cache version:** `v5.217` (constant `CACHE_VERSION` in `sw.js` — bumped on every deploy; cache versions are per-deploy, not per-marketing-version)
- **HealthKit auth version:** `2` (constant `HEALTHKIT_AUTH_VERSION` in `app.js` — bump on any new HealthKit category added to the auth call; see "HealthKit integration" section below)
- **GitHub:** `github.com/GoalLearner/awakened-app` (private)
- **iOS App ID:** `6764727990`

---

## Tech stack & file map

Pure HTML / CSS / JS. No build step for the web app. The only "build" is Capacitor wrapping the static files into an iOS bundle.

**Canonical working tree:** `C:\Users\richm\Documents\repos\awakened-app` (moved out of OneDrive May 13). The older `C:\Users\richm\OneDrive\Desktop\habit-tracker` checkout still exists as backup but should NOT be the working copy — OneDrive sync vs `.git/objects` creates "delete these 1000+ items?" dialogs after every `git pull`. `serve.ps1`'s fallback path was updated to point at the new repo (commit `70240d8`); just `cd C:\Users\richm\Documents\repos\awakened-app && .\serve.ps1`. At session start: `git pull` in whichever copy you're using to avoid drift.

| File | Purpose |
|------|---------|
| `index.html` | All markup. Tabs, panels, sheets, modals, banners. The pre-rendered splash + intro onboarding overlay sit at the very top of `<body>` so the brand impression lands before any JS executes. |
| `auth.js` | Sign-in-with-Apple + alias claim + JWT/token plumbing. Loaded BEFORE `app.js` via `<script>` so `window.Auth` is available at IIFE start. Exposes `getCurrentUser`, `signInWithApple`, `completeSignIn`, `validateAlias`, `setAlias`, `devSignInIfLocalhost`. Sets `localStorage.hb_name` on alias commit so the rest of the app sees a populated name from first launch. (v2.1.0 Phase A → B) |
| `app.js` | All logic. Single file IIFE — every runtime constant, every render function, every event wiring. Top of file: `setupSignInGateIfNeeded()` short-circuits the IIFE when there's no signed-in user. |
| `styles.css` | All styling. Defines a `:root` token set. Dark-mode only — Light theme was removed in v1.1.3. |
| `sw.js` | Service worker. Precaches app shell, avatar PNGs, tab/stat icon PNGs, and app icons (icon-192/512). The dynamic OffscreenCanvas icon generator was removed once real icons shipped. v2.2.0: install handler does NOT call `skipWaiting()` — the new auto-update path in `app.js` posts `SKIP_WAITING` silently on update. |
| `manifest.json` | PWA manifest. Theme `#0a0a0a`. Standalone portrait. References static `icon-192.png` / `icon-512.png`. |
| `capacitor.config.json` | Capacitor config. `webDir: www`. |
| `codemagic.yaml` | iOS build pipeline. Copies static files → `www/`, runs `npx cap sync ios`, sets `ITSAppUsesNonExemptEncryption=false`, builds & uploads to TestFlight. **Has its own `APP_VERSION` env var that must move with the one in `app.js`.** |
| `serve.ps1` | Local dev server, defaults to port 8080. Cache-Control: no-store. Set `$env:PORT=NNNN` to override. |
| `avatar-*.png` | 8 silhouette PNGs (base + 7 classes). RGBA with proper alpha. |
| `app-icon-source.png` | 1254×1254 master used by `scripts/generate-app-icons.ps1`. Re-run the script after replacing the source to regenerate every iOS size + the PWA `icon-192/512.png`. |
| `icon-192.png`, `icon-512.png` | PWA app icons. **Real static files** (24-bit RGB, no alpha) — generated from the source above. |
| `assets/tab-icons/` | Bottom-nav DALL-E art at 192×192 (~83–106 KB each), plus `*-source.png` masters. 7 icons: `tab-status`, `tab-habits`, `tab-stats`, `tab-history`, `tab-dungeon`, `tab-items`, `tab-social`. |
| `assets/stat-icons/` | Stat icons at 192×192 (~50–80 KB each), plus `*-source.png` masters. 6 icons: `stat-str`, `stat-vit`, `stat-int`, `stat-focus`, `stat-will`, `stat-wlt`. |
| `assets/bosses/` | Boss illustrations at 1254×1254 manhwa style. 3 entries: `the-insomniac.png`, `the-carouser.png`, `the-steel-wolf.png`. |
| `assets/gates/` | Dungeon-gate art (6 rank tiers: `gate-e/d/c/b/a/s-rank.png`). |
| `assets/items/` | **Drops Phase 1 card art** — 15 PNGs at 1254×1254 RGB, ~1.1–2.2 MB each. Filenames match `CARDS[id]` exactly. v2.0.2 launch roster (9): `dream_woven_hood`, `sleepwalkers_cloak`, `pendant_of_the_wakeful`, `vow_ring`, `vessel_of_refusal`, `sober_kings_gloves`, `pack_leaders_greaves`, `alphas_mantle`, `trail_worn_boots`. v2.1 content patch (6 commons): `tossing_bedroll`, `drowsy_signet`, `sobriety_token`, `steady_steps`, `pups_hood`, `trackers_wrap`. The render pipeline auto-resolves `card.art_path` → if 404, fallback to emoji + rarity gradient. New cards: drop the PNG, add the path to `PRECACHE_ASSETS` in `sw.js`, bump `CACHE_VERSION`. Codemagic's glob copy step (`assets/items/*.png`) picks up new files automatically. |
| `assets/equipment/panel-base.png` | **RETIRED v3 Phase 1d.** The old 941×1672 carved-stone Armory panel art. Lives on disk for archival only — no longer referenced by markup or precache. Replaced by the typed 6-slot tile grid. Do NOT reintroduce. |
| `assets/icons/` | General-purpose UI icons (v2.0.1). Currently `souls-icon.png`. Distinct from habit-icons / tab-icons. |
| `BOSSES.md` | Boss-system design doc. Has a stale-rate banner pointing to DROPS.md as the authoritative rate source. |
| `CARDS.md` | Boss card visual spec (5:7 portrait card layout). |
| `DROPS.md` | **Drops/cards collection system design — v1.4 authoritative.** Cadence-aware drop rates per boss type, rarity-tier definitions, reveal-modal UX. The engine in `app.js` reads `DROP_RATES_BY_CADENCE` keyed off `BOSSES[id].cadence`. |
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

## HealthKit integration (v1.1.5)

Two canonical habits auto-verify from Apple Health on iOS. Web/PWA users get manual completion only — no behavior change.

| Habit | Data type | Threshold | Goal config |
|---|---|---|---|
| `Daily walk` | step count | per-habit `habit.stepGoal` (default 3000, range 100–50000) | Edit Habit modal chip picker |
| `Sleep` | sleep duration | per-habit `habit.sleepGoalHours` (default 7, range 3–14, step 0.5) | Edit Habit modal chip picker |
| `Sleep before midnight` | bedtime | binary — earliest qualifying asleep sample.startDate in `[20:00, 24:00)` device-local on prior day | None (binary habit) |

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

**v2.0 policy: ALL three HealthKit-auto-verifiable habits are read-only** — `Daily walk`, `Sleep`, `Sleep before midnight`. The earlier v1.1.5 carve-out where Daily walk and Sleep allowed manual completion as a fallback is gone. Apple Health is the sole authority for these three. Tapping the card on the Habits tab does NOT toggle the check state — instead it opens the View Note modal (`#note-modal`) with a `SYSTEM-MANAGED` explainer section (`#vn-system-section`) above the canonical description.

Why the policy shifted: the "system is honest" framing applies uniformly. Mixed manual+auto creates ambiguity — did the user actually walk 3,000 steps, or just tap the box? With the lock, the answer is always "the data shows yes, or it stays unchecked." Cleaner discipline contract, even if it means streaks become impossible without Apple Health connected.

**Implications worth knowing:**
- Web/PWA users have no way to complete these habits. They show the lock and stay unchecked. Notes modal explains.
- Users with Apple Health permission denied: same.
- Users who pause auto-verify in Settings → Apple Health: same. The lock surfaces the limitation; the user's recourse is to grant permission / unpause.
- `AUTO_VERIFY.markUnchecked` / `wasUncheckedToday` becomes vestigial for these three habits — no manual un-check path exists. Code stays for defensive use by future programmatic toggle paths and other auto-verify habits.

**Per-habit system-managed copy:** `systemManagedHtmlFor(habit)` returns three-paragraph HTML keyed on `habit.name` — different middle paragraph per habit (Daily walk, Sleep, Sleep before midnight), shared lead and tail. Voice: tough-love, declarative, anchored in the data ("the body keeps the score" / "the data shows you walked"). Edit copy in this helper, not in `index.html`.

**Visual signal on the card:**
- `.habit-cb--readonly` modifier on the check circle (dashed border, `opacity: 0.72`)
- Small 🔒 glyph anchored top-right of the check circle (`.habit-cb-lock`)
- Habit name dimmed (system-managed treatment)
- AUTO pill still renders when auto-verified — both coexist

**Auto-verify-first sort.** v2.0 also pins these three habits to the top of the Habits tab via `sortHabitsAutoVerifyFirst()` — called inside `save()` so the invariant always holds in storage, plus once at init() for the one-time migration of existing v1.x users. Drag-to-reorder still works within each partition (auto-verify amongst themselves, custom amongst themselves), but a non-auto-verify habit dragged above the partition snaps back on next render. Visible UX feedback that the rule exists.

**Implementation pattern (extending to a future read-only habit):**
1. Add the habit name to `isReadOnlyAutoVerifyHabit()`'s gate
2. Add a `case 'Habit Name':` branch in `systemManagedHtmlFor()` with the per-habit message
3. If the habit is HealthKit-auto-verifiable, add it to `isHealthAutoVerifiableHabit()` chain so `sortHabitsAutoVerifyFirst()` pins it to the top
4. The buildItem render path + click handler already branch on `isReadOnlyAutoVerifyHabit` — no new wiring needed

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

Roster lives in the `BOSSES` constant (top of `app.js`). Each entry has core fields (`id`, `name`, `rank`, `flavorShort`, `flavorLong`, `killCondShort`, `killCondLong`, `streakTarget`) plus eval-threshold field with **semantic-specific naming** (`sleepHours` for sleep bosses, `stepThreshold` for step bosses — NOT a generic `threshold` field; if generalization is wanted later, refactor all bosses together) plus per-boss extras (`cadence`, `statDomain`, `dayOfWeekScoped`, etc.). v2.0.1 has three entries: `the_insomniac` (E), `the_carouser` (E), `the_steel_wolf` (D).

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

### The Steel Wolf — kill detection (v2.0.1, D-rank)

First non-E-rank boss; validates the multi-rank architecture. Daily-cadence step boss; rides the same HealthKit step-count fetch that powers `autoVerifyWalk` and `lbRecordStepsToday`. No extra HealthKit roundtrip.

| Field | Value |
|---|---|
| Rank | D |
| Stat domain | VIT |
| Cadence | daily |
| Kill condition | ≥ 5,000 steps in a day, 2 days in a row |
| Evaluator | `evaluateSteelWolfForDay(stepCount, dayDate)` — reads `cfg.stepThreshold` |
| Trigger | Called from `autoVerifyWalk()` alongside `lbRecordStepsToday`, before the habit-auto-verify gates (passive — ignores pause toggle and walk-habit presence) |
| Idempotency | Short-circuits if `state.last_eval_date === dayDate` |
| `dayDate` | `getDeviceLocalDate()` — the calendar day being evaluated |
| Runtime missed-day reset | If `state.last_eval_date < (dayDate - 1)`, streak resets to 0 BEFORE today's eval. A skipped day breaks the streak. |
| Init-time reset | `checkMissedDayForSteelWolf()` mirrors `checkMissedNightForInsomniac` — covers users who open the app after a multi-day absence even when no walk habit is configured (so the runtime path doesn't fire). |
| Sub-threshold day | `streak = 0`, record `last_eval_date` to prevent double-processing |

**Gate visibility note:** Steel Wolf sits behind the locked D-rank gate. Users at E rank cannot tap into the D-rank dungeon to see it — they get the "Reach D rank to unlock" toast. Eval still runs in the background (data is data; the rank-locking is a UI affordance, not a data-layer gate). Once the user crosses D rank via existing rank-unlock logic, the gate unlocks automatically and `renderBossesPanel('D')` shows the Steel Wolf card via the existing rank-filter (`Object.keys(BOSSES).filter(id => BOSSES[id].rank === rankFilter)`).

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
| D | 50 | 100 | +50 |
| C | 100 | 200 | +100 |
| B | 200 | 400 | +200 |
| A | 400 | 800 | +400 |
| S | 800 | 1600 | +800 |

Net is +1× cost per successful kill cycle. Failure to land the kill (disengage mid-streak) is a pure loss of the engage cost.

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
  evaluateInsomniacForNight, checkMissedNightForInsomniac,
  evaluateCarouserForNight,  checkMissedWeekendForCarouser,
  evaluateSteelWolfForDay,   checkMissedDayForSteelWolf,
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

## Drops & Card Collection (v2.0.2 Phase 1 → v2.2.0 Phase 1h)

Card-drop system layered on top of boss kills. Each kill rolls against the boss's drop table; rare/ultra-rare drops trigger a cinematic Solo Leveling reveal modal, commons fire a combined kill-toast. Collection surface is the **Items tab → Relic Archive** (renamed from "Pokédex" in v2.2.0 — see "Relic Archive" section). Single source of truth for design: `DROPS.md` (v1.7) + `EQUIPMENT.md` (v1.3).

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
| The Steel Wolf (D) | Pack Leader's Greaves (legs) +4 VIT | Alpha's Mantle (body) +12 VIT | Trail-Worn Boots (boots) +16 VIT / +8 STR |

Each boss has one **signature slot** — its ultra-rare is best-in-slot for that slot at launch. Stat-magnitude per rarity follows tier-doubling: E uncommon=2, rare=6, ultra=12; D uncommon=4, rare=12, ultra=24; doubles per rank up to S.

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

### Bad-luck protection (`DROP_PITY_BY_CADENCE`) — v3 Phase 1h

```js
{
  daily:     { any_drop_guarantee_after: 4,  ultra_soft_pity_after: 20, ultra_soft_pity_add: 0.02, ultra_soft_pity_max: 0.20, ultra_hard_pity_after: 40 },
  triweekly: { any_drop_guarantee_after: 3,  ultra_soft_pity_after: 10, ultra_soft_pity_add: 0.03, ultra_soft_pity_max: 0.25, ultra_hard_pity_after: 20 },
  weekly:    { any_drop_guarantee_after: 2,  ultra_soft_pity_after: 5,  ultra_soft_pity_add: 0.05, ultra_soft_pity_max: 0.35, ultra_hard_pity_after: 8  },
}
```

- **Any-drop guarantee:** Nth consecutive no-drop forces a drop. `forcePityDrop(bossId)` picks the most respectful rarity that has cap room: common (if not capped) → rare (if rare count < 3) → ultra-rare (cap is `Infinity`, always valid). Returns a card object the caller hands to the existing inventory-mutation path — same persist + reveal-queue + counter-update logic, no shortcuts.
- **Soft ultra pity:** When `kills_since_ultra >= ultra_soft_pity_after`, effective ultra rate = `min(baseRate + N×add, max)`. Boost grows with every extra ultra-less kill.
- **Hard ultra pity:** At `kills_since_ultra >= ultra_hard_pity_after`, effective ultra rate = `1` (guaranteed).

`getEffectiveUltraRate(bossId, baseRate)` computes per-roll; the base table is never mutated.

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
3. **Silent auto-skip-waiting.** When a new SW reaches `'installed'` state AND a controller exists (= this is an UPDATE, not first install), the page silently `postMessage({ type: 'SKIP_WAITING' })`. No banner click required.
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

- Don't add `self.skipWaiting()` to `sw.js`'s install handler. The auto-skip happens client-side via postMessage; doing it server-side would skip waiting for first-install too (where there's no existing controller, which would change reload semantics).
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
| Habits  | `tab-habits.png`                  | `main-scroll`    | **Codex/card redesign (v3 Phase 1k)** — premium 3-column RPG objective cards with existing habit icons, gold sealed/completed state, colored incomplete rings, system/auto lock rings, compact dashed Add Habits pill, Morning Routine progress bar. Top **"X / Y Habits Today"** header is the single progress summary (the redundant Daily Objectives section header was removed). Markup uses `.habit-item.codex` modifier; legacy class aliases (`.codex-status habit-cb`, `.codex-streak streak-badge`) preserve existing event handlers. |
| Stats   | `tab-stats.png`                   | `stats-panel`    | Radar + 6 tile cards + Next Stat Bonus |
| History | `tab-history.png`                 | `history-panel`  | 7-col grid, no emojis on rows |
| Quests  | `tab-dungeon.png`                 | `quests-panel`   | **Dungeon Bosses list (v2.0+)** + "MORE QUESTS — Coming in v2.0" placeholder. The Daily Quest card was removed in v2.0.1 — see "Removed systems". |
| Items   | `tab-items.png`                   | `items-panel`    | **RELIC ARCHIVE (v3 Phase 1g)** — 3 collapsible sections: ULTRA-RARE RELICS / RARE RELICS / COMMON RELICS, all default-collapsed. Discovered cards show real art + slot badge (top-left) + equipped badge (top-right, when in Hunter Build) + drop-source line. Mystery cards (rare + ultra only — commons hide silhouettes) show `?` + rarity teaser + source hint. Tap discovered → carddetail modal with EQUIP TO BUILD / UNEQUIP button. Tap mystery → mystery info modal with HUNT BOSS CTA. Reveal modal (cinematic) fires for first-acquisition rare/ultra. Sort order: acquisition date ascending (chronological discovery log). Header carries the live Armory CTA with `Gear Power N · K / 6 Equipped` sub-line. See "Relic Archive" + "Hunter Build" sections. |
| Social  | `tab-social.png`                  | `social-panel`   | **Live global leaderboard (v2.1.0 Phase C)** — three icon-led stat cards (steps · 7-day, 7+hr sleep streak, before-midnight bedtime streak), each tapping opens the Top-50 ranking sheet with real backend data. See "Leaderboard" section. |

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
| `Health.*` (object) | HealthKit auto-verify system. See "HealthKit integration" section. Public surface: `isAvailable`, `permissionStatus`, `requestPermissions`, `requestSleepPermissionIfNeeded`, `getStepsToday`, `getSleepLastNight`, `clearCache`, `clearSleepCache`. |
| `AUTO_VERIFY.*` (object) | Auto-verified completion metadata + un-checked tracking. `recordAutoVerify`, `clearAutoVerify`, `isAutoVerifiedToday`, `isAutoVerifiedOnDate`, `markUnchecked(name)`, `wasUncheckedToday(name)`. |
| `getHabitStepGoal(habit)` / `setHabitStepGoal(habit, n)` | Per-habit step goal accessor. Default 3000, range [100, 50000]. setHabit calls `save()`. |
| `getSleepGoalHours(habit)` / `setSleepGoalHours(habit, h)` | Per-habit sleep-hours goal accessor. Default 7, range [3, 14], step 0.5. setHabit calls `save()`. |
| `isStepGoalHabit(habit)` / `isSleepDurationHabit(habit)` / `isSleepBedtimeHabit(habit)` | Habit-classification predicates for HealthKit auto-verify. Used to branch goal-control UIs and bypass legacy MEASURABLE_HABITS minimum check. |
| `isHealthAutoVerifiableHabit(habit)` | OR of the three above. Use this in `meetsMinimum()` and similar generic gates. |
| `isAutoVerifyDisabled()` / `setAutoVerifyDisabled(bool)` | Reads/writes the global Settings → Apple Health pause toggle. |
| `canAutoVerify(habit)` | Composite gate combining `isHealthAutoVerifiableHabit` + `Health.isAvailable()` + `permissionStatus === 'granted'` + `!isAutoVerifyDisabled()`. Returns true only when auto-verify will live-fire for this habit right now. Used by Daily Insight's status line + verify-tag rendering. |
| `isReadOnlyAutoVerifyHabit(habit)` | **v2.0:** true for canonical `Daily walk`, `Sleep`, `Sleep before midnight`. Tap routes to `openNoteModal` instead of `toggleHabit`; card renders with lock indicator. See HealthKit integration → "Read-only auto-verify habits". |
| `systemManagedHtmlFor(habit)` | Returns three-paragraph HTML for the SYSTEM-MANAGED Notes-modal section, keyed on habit name. Edit per-habit copy here, not in `index.html`. |
| `isCanonicalHabit(habit)` | True if `habit.name` matches a `DEFAULT_HABITS` entry AND `!habit.custom`. Used by the Edit Habit modal to lock name + emoji + difficulty for canonical habits (their names are foreign keys for `HABIT_ICONS`, `AUTO_VERIFY`, `HABIT_TIME_OF_DAY`, etc.). |
| `sortHabitsAutoVerifyFirst(arr)` | Stable in-place partition: `isHealthAutoVerifiableHabit` habits to front, rest preserves relative order. Called inside `save()` (invariant always holds in storage) + once at init() for the v2.0 migration. Drag-to-reorder snaps back on next render if user drops a non-auto-verify habit above the partition. |
| `BOSSES` (object) | v2.0+ dungeon boss roster. Keyed by boss id. As of v2.0.1: `the_insomniac`, `the_carouser`. See "Dungeon bosses" section. |
| `evaluateInsomniacForNight(hours, nightDate)` | Boss kill-detection. Idempotent on `nightDate`. Increments streak / triggers kill / persists state via `setBossState`. |
| `checkMissedNightForInsomniac()` | Init-only missed-night reset. Resets streak if `last_eval_date` is older than yesterday. No-op on first install (null `last_eval_date`). |
| `evaluateCarouserForNight(hours, bedtimeBeforeMidnight, nightDate)` | v2.0.1 Carouser kill-detection. Weekend-night-only (Sat + Sun mornings; Mon morning dropped in the 2-night recalibration). Idempotent on `nightDate`. Anchors `current_weekend_id` to `getMostRecentFridayDate()`. |
| `evaluateSteelWolfForDay(stepCount, dayDate)` | v2.0.1 Steel Wolf kill-detection (D-rank). Daily cadence; reads `cfg.stepThreshold` (5000). Called from `autoVerifyWalk` alongside `lbRecordStepsToday`. Idempotent on `dayDate` + runtime missed-day reset. Same independence rules as the other bosses. |
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
| `Auth.signInWithApple()` / `Auth.completeSignIn(alias)` / `Auth.validateAlias(alias)` / `Auth.getCurrentUser()` / `Auth.isNative()` / `Auth.devSignInIfLocalhost()` | Exposed by `auth.js`. Used by the sign-in gate. |

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

The current state is `styles.css?v=257`, `app.js?v=336`, `auth.js?v=7`, `sw.js v5.217`, `APP_VERSION = '2.2.0'` (in BOTH `app.js` and `codemagic.yaml`), `HEALTHKIT_AUTH_VERSION = 2`. (Re-check from the files; they drift quickly.)

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

**SW auto-update is silent by default.** Don't put `self.skipWaiting()` in `sw.js`'s install handler — the auto-skip happens client-side via `postMessage` so first-install vs update can be distinguished. Don't reintroduce the in-app banner as the default flow. Manual mode is available via `localStorage.setItem('hb_sw_manual_update', '1')` for users who want explicit control. See "Service worker auto-update" section.

**Armory is fully open.** All 6 typed equipment slots unlock at every rank. The rank-gated render path (locked tiles with `REACH X RANK`) is dead code retained for safety. Don't reintroduce rank-gating without explicit product ask.

**Card slots are TYPED.** Cards can only equip into their matching typed slot. `equipBuildItem` returns `WRONG_SLOT` if a Pup's Hood tries to land in RING. The picker is slot-filtered so this code path is defensive — but it MUST stay defensive (don't loosen it). Legacy card slots map via `LEGACY_TO_TYPED_SLOT` (body/legs/cape → plate, amulet → ring).

**Boss cadence is required.** `dropRatesFor(bossId)` validates `BOSSES[id].cadence` against `{daily, triweekly, weekly}` and warns once per misbehaving boss in the console. New bosses MUST carry an explicit cadence field. Missing/invalid silently falls back to `daily` but emits the warn.

---

## Common pitfalls

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
- **Calling `toggleHabit(id, li)` directly on canonical Daily walk / Sleep / Sleep before midnight.** v2.0 made all three read-only. The click handler in `buildItem` routes through `openNoteModal(habit.id)` instead. If you bypass the click handler (e.g., from a custom completion path or a bulk-toggle utility), you'll silently bypass the read-only contract. Always check `isReadOnlyAutoVerifyHabit(habit)` first; if true, do nothing and let auto-verify do its job. Manual completion isn't an option for these three by design.
- **Adding a new HealthKit-auto-verify habit without updating `isHealthAutoVerifiableHabit`.** The auto-verify-first sort (`sortHabitsAutoVerifyFirst`) is called inside `save()` and uses `isHealthAutoVerifiableHabit(habit)` to decide what pins to top. If you add a new auto-verify habit type but only wire its detection logic without adding it to that helper's OR chain, the habit will auto-verify correctly but won't sort to the top of the Habits tab. Cosmetic bug, easy to miss.
- **Adding boss progression that respects `isAutoVerifyDisabled()`.** Boss eval is intentionally INDEPENDENT of the Settings → Apple Health pause toggle. The pause is scoped to habit auto-verify only; bosses are passive background progress. If you wire a new boss evaluator and gate it on `isAutoVerifyDisabled()`, you've broken the design. Boss evaluators run in `autoVerifySleep` (or whichever auto-verify hook they belong to) BEFORE the `isAutoVerifyDisabled()` early-return. Mirror that placement for new bosses.
- **Triggering boss missed-period reset from `visibilitychange` instead of init.** Multi-foreground days would mis-reset on every resume after midnight crossed. Missed-night/missed-day checks belong in init() — once per cold launch. The boss state's idempotency (`last_eval_date`) handles repeated visibilitychange refires within the same calendar day.
- **Editing the SYSTEM-MANAGED message copy in `index.html` instead of `systemManagedHtmlFor`.** The Notes-modal system-managed body is filled dynamically per-habit by `systemManagedHtmlFor(habit)` (in `app.js`). The HTML in `index.html` is just an empty `#vn-system-message` div. Edit copy in the JS helper; the HTML container is generic.
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
- **Working in the OneDrive copy.** The repo was moved to `C:\Users\richm\Documents\repos\awakened-app` on May 13 because OneDrive sync vs `.git/objects` produces "Delete these 1000+ items?" dialogs every time git does internal housekeeping (gc, pack, prune). The OneDrive copy at `C:\Users\richm\OneDrive\Desktop\habit-tracker` STILL exists as backup. Pick one as canonical and `git pull` at session start. `serve.ps1`'s fallback was updated to point at the new location (commit `70240d8`); always `cd` into the new repo before launching. Yesterday's drift bit us THREE times — same fix each time: cd to the new repo, restart `serve.ps1`, hard-refresh the browser, paste the SW unregister one-liner.
- **Running git commands from the wrong shell when both repos exist.** Commits to one repo don't propagate to the other automatically. `git status` says "nothing to commit" because the shell is in the OneDrive copy while my edits went to the new repo. Always check `pwd` if `git status` reports unexpected emptiness. Fix: `cd /c/Users/richm/Documents/repos/awakened-app` then re-run.
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
