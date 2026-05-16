# CLAUDE.md — Awakened (Habit RPG)

Onboarding doc for any future Claude session working on this project. Reflects the actual state of the code (not what it might become). All values are extracted from the source.

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
- **Service-worker cache version:** `v5.256` (constant `CACHE_VERSION` in `sw.js` — bumped on every deploy; cache versions are per-deploy, not per-marketing-version)
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
| `simulated-leaderboard.js` | **v3 Phase 1s (rev v4 = 10 fixed bots) — client-side ONLY.** Injects 10 simulated hunters into the live leaderboard render so sparse boards still feel populated. Pure function (`window.SimulatedLeaderboard.merge(realTop, alias, value, dateKey, metric)`) with a single kill-switch constant `SIMULATE_USERS` at the top of the file. NEVER sent to the backend, NEVER persisted to localStorage. **Fixed cast of 10 bots** — same names every week, every metric. Each bot has an archetype (`avgDailySteps` + `stepStdDev` + `sleepBase`/`sleepJitter` + `bedtimeBase`/`bedtimeJitter`) that drives all three of their metrics so they read as one consistent persona rather than three independent rolls. Roster spans top-tier (ShadowMonarch_K @ ~14k/day) → average (Jordan F. @ ~6k/day) → just-starting (nightowl @ ~2.4k/day). **Step totals "move like real users":** each day, every bot's daily step count is rolled deterministically from `(weekStartKey, bot.name, dayIdx)` via Box-Muller gaussian around the bot's mean. The bot's display = sum of those daily rolls from Sunday through the current day-of-week → monotonic non-decreasing within the week (every daily roll is ≥ 0). New week = new daily rolls. **Streaks (sleep / bedtime) week-stable** — rolled once per `(weekStartKey, bot, metric)` from the bot's tendency ± jitter (with extra mass on delta=0 since real streaks plateau for long stretches). New week = new value, but the same bot's tendency carries through (a bot with `sleepBase: 18` will always tend toward high streaks; one with `sleepBase: 0` toward low). The user's real value is NEVER used to anchor bot values — bots have their own world. Cosmetic tie-break: if a bot's value would exactly equal `realUserValue`, bump it by 137 (steps) or 1 (streak). Wrapped in `_lbMaybeSimulate` inside `app.js` (called at both `openLeaderboardRanking` render points, after `lbCacheWrite` so the cache stays pure-backend). |
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

**Auto-verify-first sort.** v2.0 (and v3 Phase 1u — Strength training joined) pins these **four** habits to the top of the Habits tab via `sortHabitsAutoVerifyFirst()` — called inside `save()` so the invariant always holds in storage, plus once at init() for the one-time migration of existing v1.x users. Drag-to-reorder still works within each partition (auto-verify amongst themselves, custom amongst themselves), but a non-auto-verify habit dragged above the partition snaps back on next render. Visible UX feedback that the rule exists.

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
- **Duel detail overlay** (`#duel-detail-overlay`): reuses the `.bfs-*` boss-fullscreen pattern with its own `body.ddo-locked` scroll lock. Shows opponent (display-normalized alias), status pill, schedule (starts/ends/time-remaining), stake/reward/duration metadata, "scoring activates in the next pass" footnote, and Accept/Decline buttons for pending duels in the opponent role. Closes on Back button, ESC, or any tab switch (wired into `switchTab`'s top-level closer).

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

**Production rollout state (current — end of May 15 work session).** Migration `0006_verified_duel_scoring_engine.sql` applied to remote D1 (11 queries, 16 rows written). Worker deployed at `Current Version ID: 6874ae4d-c67a-4dda-ac2c-3d788966bdfb`; subsequent deploys shipped the Phase 1z.1 cancel endpoint (`POST /v1/duels/:id/cancel`). Live endpoint surface verified via curl returning 401 to unauthenticated requests: `POST /v1/verified-events`, `GET /v1/duels/:id/score`, `POST /v1/duels/:id/cancel`. iOS bundle: Codemagic build on commit `5c54eda` (HEAD of `main` at end-of-day May 15) passed all pre-sync + post-sync gates and published 2.2.1 build to TestFlight. **App Store submission for 2.2.1 was queued for the evening of May 15**; review window expected ~24h matching the 2.2.0 cadence. Conservative polish-pass landing decision: brand verbs (`outstepped` / `outrested` / `outanchored` / `outlifted` / `outdisciplined` / `outhunted`) + behavior wiring (accordion persist, 60s live tick, draw rotation, HUNTING-pill type glyph) shipped; 4 structural redesigns deferred to a future pass (full active duel hero rewrite with twin columns + VS sigil + score-gap bar, 5-variant detail overlay with Cinzel "VICTORY" + gold-dust, Choose Verified Duel sheet glyph-block redesign, Global Rankings card overhaul). Deferral rationale: high blast radius across already-shipping surfaces; brand+behavior were the highest-leverage targets and they're in.

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
| `sortHabitsAutoVerifyFirst(arr)` | Stable in-place partition: `isHealthAutoVerifiableHabit` habits to front, rest preserves relative order. Called inside `save()` (invariant always holds in storage) + once at init() for the v2.0 migration. Drag-to-reorder snaps back on next render if user drops a non-auto-verify habit above the partition. |
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

The current state is `styles.css?v=273`, `app.js?v=370`, `auth.js?v=13`, `simulated-leaderboard.js?v=4`, `sw.js v5.256`, `APP_BUILD_TAG = '2.2.1-w20'`, `APP_VERSION = '2.2.1'` (in BOTH `app.js` and `codemagic.yaml`), `HEALTHKIT_AUTH_VERSION = 2`. (Re-check from the files; they drift quickly.)

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

**SW auto-update is silent by default.** Don't put `self.skipWaiting()` in `sw.js`'s install handler — the auto-skip happens client-side via `postMessage` so first-install vs update can be distinguished. Don't reintroduce the in-app banner as the default flow. Manual mode is available via `localStorage.setItem('hb_sw_manual_update', '1')` for users who want explicit control. See "Service worker auto-update" section.

**Armory is fully open.** All 6 typed equipment slots unlock at every rank. The rank-gated render path (locked tiles with `REACH X RANK`) is dead code retained for safety. Don't reintroduce rank-gating without explicit product ask.

**Card slots are TYPED.** Cards can only equip into their matching typed slot. `equipBuildItem` returns `WRONG_SLOT` if a Pup's Hood tries to land in RING. The picker is slot-filtered so this code path is defensive — but it MUST stay defensive (don't loosen it). Legacy card slots map via `LEGACY_TO_TYPED_SLOT` (body/legs/cape → plate, amulet → ring).

**Boss cadence is required.** `dropRatesFor(bossId)` validates `BOSSES[id].cadence` against `{daily, triweekly, weekly}` and warns once per misbehaving boss in the console. New bosses MUST carry an explicit cadence field. Missing/invalid silently falls back to `daily` but emits the warn.

---

## Common pitfalls

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
