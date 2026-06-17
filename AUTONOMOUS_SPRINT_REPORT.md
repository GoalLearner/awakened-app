# Autonomous Sprint Report — 2026-06-16

Run while the owner was away (explicit green light, ultracode on). Every change
below is on `main`, auto-pushed, `node --check`-clean, and individually
version-bumped so each commit is build-shippable. Guardrails held: **no economy/
balance changes, no backend migrations or deploys, no IAP, nothing outward-facing.**

## TL;DR
- **6 commits shipped.** Finished the Twin Maw co-op summons, caught a **critical
  missing version-bump** that would have shipped it stale, fixed **5 confirmed
  bugs**, and added **a11y semantics**.
- Two adversarial multi-agent workflows run: a **bug hunt** (8 subsystems, find →
  refute each finding) and a **launch-readiness audit** (deploy / PWA / perf / a11y).
- The audit's deploy/perf/product/a11y items I did **not** auto-fix are captured
  below as a **prioritized backlog** — each needs your environment, on-device
  testing, or a product decision.

## Commits (all on `main`, pushed)
| Hash | What |
|------|------|
| `2c8142a` | Add Twin Maw co-op summons hero art |
| `75d6a2a` | **W376 (frontend)** — cinematic Twin Maw co-op summons (ClaudeDesign) |
| `61561cc` | **W376 (build)** — cache/version knob bump (the summons would not have reached users without this) |
| `fd55f5c` | **W377** — pre-launch correctness sprint: 4 verified fixes |
| `6fcfeab` | **W378** — Arena: exit mid-final-blow now commits the rated result |
| `0f6e2c7` | **W379** — a11y: active-tab `aria-current` + dialog semantics |
| `e3ae8e4` | **W380** — fix a W378 regression caught by self-review (see below) |
| `4b7f189` | **W381** — hunt #2: backup JWT-leak (SECURITY) + notification digest re-arm |

Cache knobs advanced `v5.711 → v5.717` (app.js?v=820 → 826, auth.js?v=30 → 31, build w375 → w381).
`APP_VERSION` (2.2.7) left untouched — that's your release knob.

> **Self-review caught my own bug.** I ran an adversarial regression review over my
> own W377–W379 diff before it could reach your build. W377 and W379 came back
> clean, but it found a **real high-severity regression in W378**: my exit-finalize
> routed *all* decided-but-uncommitted rated fights straight to the tower — fine for
> a loss, but for a **floor-100 WIN** it committed the win yet skipped the summit
> ceremony **and `_hallRecordFinish()`** (the once-per-device eternal Hall ordinal,
> reachable from no other path). Fixed in **W380** by routing wins through the
> canonical `_arFinishSession()` and independently re-verified SAFE. This is exactly
> why I self-reviewed — the regression would otherwise have shipped silently.

---

## Bugs fixed (from the adversarial hunt — all confirmed reachable, not intentional, not economy)

1. **Corrupted/restored `completions` crash-guard** — `app.js` load (~17599). A
   non-array per-date value in `hb_completions` (a malformed cloud-restore
   snapshot; the backend stores state without field-type validation) survived the
   W201 outer-shape coercion and threw on `completions[d].length` at `renderStatus`
   (blanks the Profile tab), `showRankUpScreen` (strands the level-up queue), and
   `checkAchievements`. Fixed centrally: drop any non-array date entry at load.
   **Verified in-app**: injecting `{"d":null,"d2":42}` now boots clean and
   self-heals localStorage to just the valid array (was a `TypeError` on boot).
   *This one central fix closed all three crash sites.*

2. **Co-op resolve retry storm** — `_coopResolve` (~36794). On a failed resolve
   (offline / 429 / network), the still-active+goal-met instance made
   `_coopAfterInstanceUpdate` re-invoke `_coopResolve` immediately — an unthrottled
   request storm draining battery and self-amplifying the shared `RL_DUELS_WRITE`
   rate limit. Fixed: re-entrancy guard + only re-evaluate on success; on failure,
   fall back to the 60s poll / background sync.

3. **Weekly History timezone misalignment** — `getWeekDates` (~19948). Day keys
   were built via `toISOString()` (UTC), shifting the whole grid one column (and
   the "today" mark) for users at **UTC+12:45 and beyond** (NZ-DST, Samoa, Chatham,
   Line Is.). Fixed: use the existing `_localDateKey` (local Y/M/D), matching the
   monthly grid and the PT-anchored completion keys.

4. **Daily Insight modal stacking on resume** — visibilitychange (~48023). The
   resume path fired Daily Insight *without* the one-per-launch guard the
   cold-launch dispatcher uses, pre-mounting it behind an open FA coachmark /
   welcome-back screen. Fixed: route the resume call through
   `_isAnyHigherPriorityModalActive()` (and added `welcome-back-overlay` to it).

5. **Arena rated-loss dodge** — `_arExit` (~9633). A rated fight is *decided* the
   instant `sess.done=true`, but `arenaFinalizeBattle` commits later, at the
   KO/timeout beat during the animation drain. The EXIT pill is ungated, and the
   forfeit branch required `!_arSess.done`, so tapping EXIT during the final-blow
   animation nulled the session **without committing** — refunding the daily life
   and dodging the loss (KO losses too, per the verifier). Fixed: a `done &&
   !_finalized` branch finalizes as-is and `_arClearTimers()` cancels the pending
   drain. Safe because all beat timers route through `_arAfter → _arTimers`, so
   `arenaFinalizeBattle` runs **exactly once** (it is *not* idempotent — it does
   `st.losses += 1` unconditionally; the W352 contract is "finalize once").

### Investigated, NOT a bug (documented so they aren't re-flagged)
- **AUTO_VERIFY maps lack the W201 null-coercion** (`hb_completions_auto` /
  `hb_av_unchecked_dates`) — **refuted/unreachable**: the only writers always
  `JSON.stringify` a plain object, and the hot-path reads are already `try/catch`-
  wrapped. No path produces the literal `"null"`.
- **`checkAchievements` reduce at 18837** — was flagged but is now **covered by
  fix #1**: the load-time normalization guarantees every `completions[d]` is an
  array before that reduce runs.

## Bugs fixed — hunt #2 (highest-stakes subsystems)

A second adversarial hunt (inventory, marketplace, auth/restore, notifications,
stats, rewards, duels). Two confirmed, both fixed in **W381** (`4b7f189`):

6. **SECURITY — backup leaked the session JWT.** The file backup exported every
   `hb_*` key including `hb_user` (the live backend JWT + Apple sub), and restore
   re-wrote it verbatim. Since a backup file is shareable (iCloud/AirDrop/Mail) and
   the backend derives the user purely from the JWT, restoring someone's backup made
   you act as *their* account — and it silently defeated the documented force-re-auth
   (the restore modal promises "you'll be signed out"). Fixed: exclude
   `[hb_user, hb_apple_pending_v1]` from both build and restore (matching the
   CloudSync allowlist, which already omits the JWT). **Verified in-app**: a foreign
   `hb_user` is no longer injected on restore; normal data still restores.
7. **DATA-LOSS — Settings / day-change killed the Morning Briefing.** `rescheduleAll`
   starts with `cancelAll` (wipes the digest, ID 1) but only re-armed habit/checkin
   reminders. The 4 correct call sites pair it with `reapplyDigest`; `rescheduleNow`
   (Settings quiet-hours / pause / un-pause / master toggle) and `checkDayChange`
   (midnight rollover) did not — so any of those silently dropped the digest. Fixed:
   add `reapplyDigest` to both, matching the established pattern.

Two more candidates were correctly **refuted** by the verifiers (a streak-shield
"never re-earns shields" claim — the milestone counter is intentionally monotonic;
and an uncertain partial-restore-corruption case with no constructible trigger).

---

## Backlog — found but deliberately NOT auto-fixed (your call)

Each is real; I left it because it needs your build/deploy environment, on-device
testing, conflicts with another finding, or is a product decision.

### Deploy & release
- **[HIGH] Co-op backend deploy order** — `wrangler deploy` runs no migrations, and
  the verified-events INSERT unconditionally references `boss_instance_id` (0020).
  Deploying the worker before applying **0019 then 0020** would 500 the *entire*
  `/v1/verified-events` path (breaks the legacy duel-outbox drain too), not just
  co-op. You already know this (it's in BACKEND.md + my notes); flagging because
  it's the highest-impact launch hazard. *Did not* change the deploy script to
  `migrations apply` because your own note warns the D1 migrations bookkeeping is
  empty — auto-applying could re-run old migrations. **Apply 0019/0020 by hand
  (remote), in order, then deploy.**
- **[MED] `auth.js` excluded from the iOS freshness gate** —
  `verify-ios-public-assets.sh` REQUIRED-lists + hash-checks app.js/sw.js/
  simulated-leaderboard.js but **not** `auth.js` (Sign in with Apple, JWT,
  backup/restore). A stale `auth.js` in the bundle would pass the gate. Add it to
  REQUIRED + a SHA256 root-vs-iOS compare. *(Left for you — it's a build-gate
  script I can't exercise on Windows; a wrong edit could block your archive.)*
- **[MED] `auth.js?v=` outside the four-knob bump discipline** — with SW
  `ignoreSearch`, a forgotten `auth.js?v=` bump serves stale auth.js on web until
  the next CACHE_VERSION wipe. Easiest: bump `auth.js?v=` whenever `app.js?v=`
  bumps; or add it to the verify gate.
- **[LOW] Duplicate migration number `0014`** (`0014_profile_arena_title` +
  `0014_public_achievement_events`). Both apply (wrangler keys on full filename),
  so prod is fine — but it's a future footgun. Do **not** rename (changes the
  d1_migrations key); just document + use unique prefixes going forward.
- **[LOW] `verify-ios-public-assets.sh` freshness gate silently passes offline** —
  consider requiring `SKIP_FRESHNESS=1` to make an offline build deliberate.

### Performance (mobile WebView, boot/asset critical path)
- **[HIGH] Dungeon-gate PNGs are ~6–10× oversized** — six gate images are
  ~1122×1402 / ~2.5MB each but shown at ~150px (~15MB total). Re-export at ~400px
  WebP (like the battle backgrounds, ≤252KB) → **~15MB → ~1MB**, same paths, no
  code change. *(Asset re-export needs image tooling I don't have here.)*
- **[HIGH] SW precaches ~173MB on install** (243 entries, ~80 multi-MB images).
  Trim PRECACHE_ASSETS to the true app shell + above-the-fold art; let big boss/
  item PNGs fall through to the existing runtime cache-first handler. **Note: this
  conflicts with the PWA-lens finding below** — it's an architectural call
  (offline-everything vs fast install) that's yours to make.
- **[MED] Render-blocking 2.4MB `app.js`** — adding `defer` to auth.js/
  simulated-leaderboard.js/app.js would let HTML paint first (init() already waits
  for DOMContentLoaded). *Left for you*: medium-risk on the critical boot path;
  wants on-device verification of cold-launch beats + the SW update banner.
- **[MED] Inline splash can't paint until 1MB styles.css loads** — moving the
  ~1–2KB of `.awakened-splash` rules into an inline `<style>` lets the branded
  splash paint immediately. Skipped to avoid CSS duplication/drift without your
  call on the maintenance trade-off.
- **[LOW] Legacy welcome screen leaks a `resize` listener + RAF** on the
  non-`launchQuest` teardown path (app.js ~41955/41990). Mirror `launchQuest`'s
  cleanup.

### PWA / service worker
- **[MED] 6 active boss PNGs on disk but missing from PRECACHE** (erebus, tideless-
  marcher, sleepless-ascent, etc.) — inconsistent with the other precached bosses.
  **Conflicts with the perf "trim precache" finding** — resolve the precache
  philosophy first, then make these consistent either way.
- **[LOW] SW version-drift safety net keys off a never-written localStorage key**
  (`hb_sw_last_active_version`) so it stays dormant — point it at
  `SW_KNOWN_VERSION_KEY` which is already seeded.
- **[LOW] `manifest.json` icons use `purpose:"any maskable"`** on one entry — split
  into separate `any` + `maskable` entries (needs a padded maskable variant).

### Accessibility (App Store quality)
- **[HIGH] Habit toggle not keyboard/SR-operable** — the core daily action is a
  `<li>` with a delegated click; no `role`/`tabindex`/`aria-pressed`. *Left for
  you*: medium-risk (touches the primary loop's render + delegated handler); wants
  VoiceOver + keyboard testing on-device.
- **[HIGH→partly done] Overlay dialog semantics + focus management** — I added
  `role="dialog"` + `aria-labelledby` to the boss & co-op overlays (W379). Still
  to do: save/move/restore focus (and `aria-modal="true"`) on open/close — needs
  on-device VoiceOver verification, so I left the focus-trap part.
- **[MED] Viewport disables pinch-zoom** (`maximum-scale=1, user-scalable=no`).
  Removing it helps low-vision users but changes the native-app feel and wants
  on-device layout verification — a product decision.
- **[LOW] Boss-result + content sheets don't move/return focus** — same
  save/move/restore pattern as the overlays above.

---

## How to verify my changes
- Frontend preview: `serve.ps1` (port 8080). I verified each fix by clearing the SW
  cache + reloading and exercising the real code path (e.g. injecting corrupt
  `hb_completions`, driving a mocked co-op invite, switching tabs for `aria-current`).
- The summons + all fixes only reach **production** once the next MacBook build
  ships (and the co-op summons specifically also needs the co-op backend deployed —
  see the deploy-order item above).

*Generated autonomously. Nothing here changed game balance, the economy, or the
backend. All six commits are reversible and individually shippable.*
