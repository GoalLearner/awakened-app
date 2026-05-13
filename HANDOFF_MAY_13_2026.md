# HANDOFF — May 13, 2026

Session close: ~9:30 PM Tue May 12, 2026 PST. This doc is for tomorrow-Richie (or a fresh Claude Code thread) to resume zero-gap.

Today was the biggest single ship in Awakened's history. 17 commits since HANDOFF_MAY_12_2026.md (committed 6260309 this morning). Backend went live. v3 design spec authored. Content patch + art + balance change + UI hygiene all landed. No code regressions, working tree clean, in sync with `origin/main`.

---

## Yesterday's commits (chronological, after this morning's HANDOFF)

Pulled from `git log --since="2026-05-12 00:00" --reverse`. Excludes the morning's HANDOFF commit itself (`6260309`) — it sits at the start of the day, before this run.

| # | Hash | Subject | What it did |
|---|---|---|---|
| 1 | `4623319` | fix: daily walk preset default 3000 → 8000 | Bumped the canonical Daily walk preset target; one-time migration via `hb_walk_target_migrated_v1` flag rewrites stale 3000 targets for existing users. |
| 2 | `1e3778c` | fix: localhost dev bypass for Phase A sign-in gate | Added `LOCALHOST_DEV_STUB` so web-dev sessions can skip the mandatory Sign in with Apple gate without dropping the production rule. Capacitor-native excluded via `isNative()` check. |
| 3 | `6b149f3` | v2.1 Phase B (1/3): /backend/ scaffold + auth modules | Cloudflare Workers + D1 backend scaffolded. `apple-jwks.ts` (RS256 verify), `session-jwt.ts` (HS256 issue/verify), `profanity.ts`, `alias-suggestions.ts`. Wrangler config, env types, D1 migrations. |
| 4 | `7b7847d` | v2.1.0 Phase B (2/3): backend endpoints + client wiring | 4 endpoints went live: `/v1/auth/verify`, `/v1/leaderboard/submit`, `/v1/leaderboard/top`, `/v1/account/delete`. Client `auth.js` wired to call them. `APP_VERSION` bumped to 2.1.0 in both `app.js` + `codemagic.yaml`. |
| 5 | `a9dc5ac` | debug: temporary aud-claim logging for Phase B validation | Two `console.log` lines in `apple-jwks.ts` to diagnose an `APPLE_BUNDLE_ID` secret-truncation bug (stored 2 chars instead of 24). Fixed via Cloudflare web dashboard. |
| 6 | `7aaa1bd` | ci: remove temporary aud-length diagnostic logs | Debug logs deleted now that Phase B is validated end-to-end on real device. |
| 7 | `15e0ccd` | ui+e: Settings Account redesign + wire delete-account to live backend | Account section restyled with identity card + Sign out + Delete my account. Delete now POSTs to `/v1/account/delete` with type-DELETE confirmation modal. |
| 8 | `7c5ada9` | v2.1.0 Phase C — wire live leaderboard | `lbSubmitAllMetrics()` orchestrator + 5-min debounce via `hb_lb_last_submit`. `openLeaderboardRanking()` rewritten as async with stale-while-revalidate cache (`hb_lb_cache_<metric>`, 24h TTL). Mock entries deleted from Social tab. Leaderboard ranking goes live. |
| 9 | `4a9b5d9` | v2.1 Phase D: JSON export/import data safety net | `Auth.exportToFile()` + `parseBackupFile()` + `applyBackup()`. Settings → Account adds Backup + Restore buttons. Restore wipes `hb_user` to force re-auth. |
| 10 | `5cd59d3` | v2.1 Phase E (code pass): sign-out overlay + Privacy Policy link | 600ms "Signing out…" overlay before clearing state + reloading. New Settings → LEGAL section linking to the existing privacy policy at heartfelt-froyo. Civilian-respect framing. |
| 11 | `b794a18` | fix(phase-d): use Capacitor Filesystem + Share for iOS export | Standard Blob+anchor-click silently fails in Capacitor WebView. Native path now writes JSON to Documents/ via `@capacitor/filesystem`, then opens iOS share sheet via `@capacitor/share`. Web/PWA path unchanged. |
| 12 | `2d1982a` | design: v3 PvP spec — PVP.md v1.0 | 21-section, ~9.6K-word authoritative design doc for v3 turn-based 1v1 PvP combat. Locks combat model, equipment dimensions, damage formula, type pentagon, moveset acquisition, matchmaking, ELO, Civilian tutorial, AI bots, persistence schema, 6-phase implementation roadmap. |
| 13 | `192ae53` | v2.1 content: +6 common cards (2 per boss in unfilled slots) | Tossing Bedroll, Drowsy Signet, Sobriety Token, Steady Steps, Pup's Hood, Tracker's Wrap added to `CARDS`. Drop-pool refactor — `rollBossDrop` now picks uniformly from per-rarity arrays. `bonus_ranges` schema field added for v3 PvP variable rolls. Migration flag `hb_inventory_commons_v3_migrated`. |
| 14 | `979c437` | v2.1 content: integrate art for 6 new common cards + delete stale root PNGs | 6 DALL-E PNGs (1254×1254 RGB) moved from repo root → `assets/items/`. 4 stale scratch PNGs at root deleted. `PRECACHE_ASSETS` extended with 6 new paths. |
| 15 | `c82fef8` | balance: drop rate rebalance — daily 50/15/5, weekly 70/40/25 | Common + rare rates boosted; ultra-rare unchanged. First-common protection refactored from flat-replacement → multiplier (×1.33 capped at 0.95) so protection always boosts regardless of cadence baseline. DROPS.md → v1.6. |
| 16 | `f46f8b1` | ui: remove all 'Leaderboard Coming Soon' stale framing | Two surfaces fixed post-Phase C ship: Social tab YOUR VERIFIED STATS panel + metric detail modal. Metric labels updated (no more misleading "7 days" text). |
| 17 | `3c58fd1` | leaderboard: steps metric switches from rolling-7 to calendar-week | `step_total` now sums Sunday 00:00 → Saturday 23:59:59 device-local, resets every Sunday. New helper `lbSumCurrentWeekSteps()`. Best peak semantics shift from "best rolling-7 ever" → "best calendar week ever." Backend payload unchanged. |

**17 commits, not 14** — the prompt-spec said 14 but the actual count from `git log` is 17. The four extra are the morning's walk-preset migration, localhost dev bypass, the temporary debug-logging pair (added + removed), which were strictly grouped with the same day's work.

---

## Repo state at session close

- **HEAD:** `3c58fd1` (`leaderboard: steps metric switches from rolling-7 to calendar-week (Sun→Sat)`)
- **Branch:** `main`, in sync with `origin/main`
- **`APP_VERSION`:** `2.1.0` (in both `app.js` and `codemagic.yaml`)
- **`sw.js` `CACHE_VERSION`:** `v5.152`
- **`app.js` cache-bust:** `?v=279`
- **`auth.js` cache-bust:** `?v=7`
- **`styles.css` cache-bust:** `?v=208`
- **`HEALTHKIT_AUTH_VERSION`:** `2`
- **Working tree:** clean — no uncommitted changes, no untracked files
- **Repo location:** `C:\Users\richm\OneDrive\Desktop\habit-tracker` (NOT `Documents\awakened-app\` — that's a phantom path that surfaced briefly mid-session; this OneDrive working tree is the authoritative clone)

---

## What's live in production

- **Backend Worker:** `https://awakened-backend.richmondcampano93.workers.dev`
- **D1 database:** `awakened-db` (id `b9c67e10-c88c-4b71-b1e0-413d1e84a5fa`)
- **Production users:** 1 (Richie). Real apple_sub identity, real session JWT, real leaderboard data.
- **4 live endpoints:**
  - `POST /v1/auth/verify`
  - `POST /v1/leaderboard/submit`
  - `GET  /v1/leaderboard/top?metric=X&limit=N`
  - `POST /v1/account/delete`
- **TestFlight current:** build 55 is what's currently on Richie's phone.
- **Build 56 status:** **TO BE UPDATED — current status: not yet triggered as of session close.** Update this line after Codemagic kicks off.

---

## v3 PvP design — locked

v3 PvP is async-style turn-based 1v1 combat. AI bots at launch (live human PvP deferred to v3.5+). 9 equipment slots (helm/cape/amulet/weapon/body/legs/gloves/boots/ring). 6 stats from habits drive combat: STR = physical damage scaling, VIT = HP + per-turn regen, INT = magic damage scaling, FOCUS = accuracy + crit + turn-order tiebreaker, WILL = dodge + flat damage reduction, WLT = souls payout multiplier + (v3.5) wager system. 8 classes with PvP bonuses; Civilian locked out of ranked (tutorial mode only — Class Awakening unlocks ranked). Type Pentagon adds 5 move types (Physical / Magic / Holy / Shadow / Nature) as a NEW item dimension with 1.5× / 1.0× / 0.66× type effectiveness. Damage formula is the "Deep" model — full Pokémon-style chain with STAB (1.2×), class affinity (1.5× from EQUIPMENT.md, stacks with class PvP +20%), crit, dodge, type multipliers, gear-WILL flat reduction, ±10% variance. Movesets: 4 moves per fight, hybrid acquisition — 30 stat-tree moves (6 trees × 5 milestone levels) + 3 specialty moves from rare cards + 3 signature moves from ultra-rare cards = 36 moves at full v3.0 launch roster. Standard ELO with base 1500, K-factor by bracket (32/24/16/12), 7 visible tier badges Bronze → Awakened (3000+). No daily-cap rate limiting — ELO IS the rate limiter; no status effects at launch (deferred v3.5+); no wagers at launch (deferred v3.5+). Estimated full-build timeline: 4–6 months across 6 phases per PVP.md §20.

Full spec lives in `/PVP.md` v1.0 (commit `2d1982a`), 9,636 words, 21 sections. Read top-down once; reference §6 (damage formula) + §16 (worked example fight) for the math; reference §20 (implementation phases) when scoping the v3 work.

---

## v2.1 content patch (today's content work)

**6 new common cards added — CARDS count is now 15 (was 9):**

| Card | Boss | Slot | Tier | Bonuses (mid) | Range (v3 PvP) |
|---|---|---|---|---|---|
| Tossing Bedroll | Insomniac | body | E | +2 VIT | VIT [1, 3] |
| Drowsy Signet | Insomniac | ring | E | +2 VIT | VIT [1, 3] |
| Sobriety Token | Carouser | amulet | E | +2 WILL | WILL [1, 3] |
| Steady Steps | Carouser | boots | E | +2 WILL | WILL [1, 3] |
| Pup's Hood | Steel Wolf | helm | D | +3 VIT, +1 STR | VIT [2, 5], STR [1, 2] |
| Tracker's Wrap | Steel Wolf | cape | D | +3 VIT | VIT [2, 5] |

Each existing boss now drops in **5 slots** instead of 3 (added body+ring for Insomniac, amulet+boots for Carouser, helm+cape for Steel Wolf). All 6 cards have real DALL-E art at 1254×1254 RGB, integrated to `assets/items/`. The drop-pool engine picks uniformly from per-rarity arrays — when a common rolls, each of the boss's 3 commons gets 1/3 chance.

Variable stat-roll ranges (`bonus_ranges`) defined per PVP.md v1.0 design for v3 implementation. v2.x uses the midpoint (`bonuses` field) as the fixed value; v3 PvP engine will read the ranges and roll variable values per equip.

---

## Drop rate rebalance (today)

| Cadence | Tier | Old rate | **New rate** |
|---|---|---|---|
| Daily | ultra_rare | 5% | **5% (unchanged)** |
| Daily | rare | 8.3% | **15%** |
| Daily | common | 20% | **50%** |
| Weekly | ultra_rare | 25% | **25% (unchanged)** |
| Weekly | rare | 25% | **40%** |
| Weekly | common | 40% | **70%** |

**Combined any-drop probability per kill:**
- Daily: ~30% → **~59.6%**
- Weekly: ~66% → **~86.5%**

Design rationale: commons are entry-tier gear with modest stat bonuses (~+2 per piece). Reliable drops should feel earned, not RNG lottery. Weekly cadence gets the larger relative boost (1.75× common, 1.6× rare) to compensate for ~3.5× fewer attempt opportunities per month. Ultra-rares kept stable — endgame scarcity preserved.

Stack caps unchanged (common 1, rare 3, ultra ∞). First-common protection mechanic refactored from flat-replacement → multiplier (×1.33 capped at 0.95) so protection always boosts regardless of cadence baseline. DROPS.md v1.5 → v1.6.

---

## Leaderboard steps metric — calendar-week reset (today, late)

Final commit of the day (`3c58fd1`): the `step_total` leaderboard metric switched from rolling-7-day to **calendar-week (Sunday 00:00 → Saturday 23:59:59, device-local)**. Every user's score resets to ~0 on Sunday morning and grows through the week. The leaderboard is now a **weekly competition** rather than a perpetual rolling window.

Implementation: new helper `lbSumCurrentWeekSteps(stepsDaily)` walks back `today.getDay() + 1` days summing daily entries. Both `lbRecordStepsToday` and `lbGetSnapshot` call it. Field name `steps_last_7_days` kept on the snapshot for callsite compatibility — semantics are now "current calendar-week sum." `best_7day_step_total` peak field kept too; future updates trigger only when the running week sum exceeds it.

**Behavioral consequence worth flagging:** on the first Sunday after build 56 ships, every user's leaderboard score drops to wherever they've walked that Sunday so far (typically near zero). The ranking re-sorts. This is by design but might briefly look like a bug to users. Worth a What's New note if you decide on a 2.1.1 bump.

Backend payload shape unchanged. The semantic shift is purely client-side.

---

## What's NOT yet on phone (build 56 ships these)

Build 55 (currently installed) has Phases A–E client work but not today's content + balance + hygiene work. Build 56 will ship:

- Phase D Capacitor Filesystem fix (build 55 had this — confirmed)
- PVP.md doc (not user-visible, just in repo)
- 6 new common cards with real art
- Drop rate rebalance (commons 50% / rares 15% daily; 70% / 40% weekly)
- "Leaderboard Coming Soon" stale-copy cleanup (Social tab + metric detail modal)
- Calendar-week steps metric

---

## Build 56 validation checklist

Once Codemagic build 56 lands on phone:

1. Install build 56 over build 55 via TestFlight.
2. **Privacy Policy:** Settings → LEGAL → tap Privacy Policy → opens heartfelt-froyo URL.
3. **Sign-out polish:** Settings → Account → Sign out → "Signing out…" overlay for ~600ms → sign-in gate reappears.
4. **Pokédex Common section:** Items tab → expand Common → 9 cards visible (3 original + 6 new).
5. **Real card art:** new common cards show real DALL-E art, not the emoji+gradient placeholder.
6. **Social tab header:** says **LEADERBOARD · LIVE** (not "COMING SOON").
7. **Metric detail modal:** opens with **GLOBAL LEADERBOARD** header (not "TOP 50 COMING SOON").
8. **Metric labels:** steps card reads "X steps this week" with "Best week: N" meta line. Sleep card reads "sleep streak · 7+ hr." Bedtime card reads "bedtime streak · before midnight." No "7 days" / "rolling" phrasing anywhere.
9. **Drop rate sanity:** kill a daily-cadence boss a few times → expect commons to drop roughly every other kill (50%). Kill the Carouser a few weekends → expect ~70% common drops.
10. **New cards in rotation:** when a common drops from a boss, each of that boss's 3 commons has 1/3 chance of being the drop.
11. **Sunday reset (next Sunday morning):** Social tab steps card resets to ~0 + accumulates through the day. Best-week peak preserved.

---

## Next session's natural priorities (rough order)

1. **TRIGGER + VALIDATE BUILD 56** if not done before sleep.

2. **v2.2 — TWO NEW VERIFIABLE METRICS** (Richie's confirmed scope for tomorrow):

   **a) STRENGTH SESSIONS** — HealthKit Workout type, Functional Strength Training + Traditional Strength Training combined. Cadence (daily vs weekly) and shape (cumulative count vs streak) TBD at session start. Anchors future bosses with strength-training kill conditions (Iron Will, Tactician already designed in BOSSES.md to use this data).

   **b) ACTIVE ENERGY BURNED** — HealthKit Active Energy. Cumulative metric. Anchors movement-broad bosses and gives iPhone-only users (no Apple Watch) a passive metric they can compete on without per-workout logging.

   Estimated scope: **4–5 hours** including client HealthKit queries, backend `metric_id` registration, leaderboard UI for 2 new cards, metric detail modals. `HEALTHKIT_AUTH_VERSION` likely bumps 2 → 3 since neither workout type nor Active Energy is in the current auth bundle (we have `'steps'` + `'activity'`; `'workoutType'` is technically covered by `'activity'` but Active Energy may need a new category — verify against the plugin's Swift `getTypes` function before bumping). No new D1 tables needed — `leaderboard_snapshots` is metric-agnostic.

3. **Phase E externals** — required for public App Store submission, not currently done:
   - Privacy policy doc update reflecting v2.1 backend data collection (alias + 3 leaderboard metrics leave device; everything else local-only). After v2.2 ships, update again to cover the 2 new metrics.
   - App Store Connect privacy nutrition labels.
   - Both are external work (web-form + doc editing), not code.

4. **New boss redesign + new boss shipping.** Richie flagged that several of the 7 designed-but-not-shipped bosses have weak or fragile kill conditions — specifically The Restless Mind's mindfulness condition is brittle given tracking concerns (requires user to log meditation through a HealthKit-compatible app, and there's no programmatic way to detect HealthKit-pipe quality from the app side). Future session work: audit the BOSSES.md roster, redesign any boss whose kill condition won't reliably verify, then ship the strongest remaining candidate. Liminal (D, sleep composite) is the most engine-friendly next-up.

5. **Public App Store submission** — after Phase E externals land.

6. **v3 PvP Phase 1 implementation** — equipment-equip UI per PVP.md §20 Phase 1: persistent `hb_pvp_equipped` state, equip/unequip handlers in Settings → Combat or a new Combat tab, stat-aggregation function applying class affinity multipliers (1.5× / 1.15× / 0×). ~2 weeks of work per the PVP.md estimate.

---

## Eddie Mora / NZT operating mode reminder

Memory #15 from prior threads: when Richie is in build/execution mode, default to **less friction, less hedging, less "are you sure?", no premature stop-recommendations.** Match energy. Trust his self-assessment. Ship work. He calls his own limit. Don't gate-keep based on hours elapsed or perceived fatigue.

Today's marathon validated this. 17 commits between morning HANDOFF and 9:30 PM PST close. Backend went from spec to live to validated. v3 design went from notes to 9.6K-word authoritative doc. Content patch + art + balance + UI all shipped clean, no regressions.

---

## Open design conversations (need future sessions)

- New boss design — Liminal next? Forgotten Hour? Tactician? (Liminal recommended as natural next-up; rest of roster in BOSSES.md)
- v3 PvP Phase 1 implementation kickoff timing — start immediately after public launch, or stagger?
- Friend system MVP design — when to introduce, what's in v1 (friend search, accept/decline, friend-only leaderboards?)
- Public marketing strategy for v2.1 public launch — what's the user-facing pitch? "First wellness app with a verifiable leaderboard"?
- v2.1.1 vs v2.2 — does the Sunday-reset behavior + drop-rate rebalance + new cards justify a marketing-version bump? Or does it ship under 2.1.0 silently?

---

## Critical context for next-session Claude

- **Repo working tree:** `C:\Users\richm\OneDrive\Desktop\habit-tracker` — **NOT** `Documents\awakened-app\`. The Documents path was a phantom that surfaced mid-session; this OneDrive tree is the authoritative clone. Every commit, every wrangler call, every file edit lives here.
- **Art workflow:** Richie saves DALL-E PNGs to the repo root (Windows quirk — Save As defaults to that path). Claude Code moves them to `assets/items/` in the integration commit. Same workflow used for today's 6 new commons.
- **Codemagic uses manual code signing:** cert `awakened-distribution`, profile `awakened-app-store-manual`. Auto-signing was broken for Sign in with Apple capability (8 build cycles tried before pivoting — commit `630bbe6`). Do not switch back to auto-signing without revalidating.
- **Backend secrets:** edits go through the **Cloudflare web dashboard inline editor**, NOT wrangler interactive prompts. The interactive prompts corrupt long secrets on Windows (validated during the `APPLE_BUNDLE_ID` 2-char vs 24-char incident this morning).
- **Netlify privacy policy:** every deploy of the privacy policy at `heartfelt-froyo-54ffa1.netlify.app` is a one-off — no auto-CI from the main repo. Bump `sw.js CACHE_VERSION` in any commit that touches the privacy-policy URL or text so existing PWA users get the update.
- **iPhone notification scheduling** uses device-local time, NOT PT — different rule from streak/completion math, which IS PT-anchored. Same exception applies to sleep windows + Daily Insight + the new calendar-week steps metric.
- **HealthKit plugin gotchas:** `@perfood/capacitor-healthkit@1.3.2` uses two different string namespaces (`requestAuthorization` wants friendly aliases like `'activity'`; `queryHKitSampleType` wants Apple-canonical IDs like `'sleepAnalysis'`). The `.npmrc` with `legacy-peer-deps=true` is required — the plugin's published peer-dep declares Capacitor 4 while we're on Capacitor 6. Don't delete that file.
- **PvP design is locked, not implemented.** When v3 Phase 1 starts, read PVP.md top-down once; treat the locked decisions (affinity multipliers, class bonuses, type pentagon, damage formula) as non-negotiable. The "Open Design Questions" section in §18 is the only thing eligible for relitigation.

---

## Sign-off

17 commits today. Full backend live. 1 real user flowing real data through 4 endpoints (auth + leaderboard submit + leaderboard top + delete account). v3 PvP design spec exists as authoritative doc. Content patch: 6 new commons with art, drop pools expanded from 3 → 5 slots per boss. Drop rates rebalanced — commons + rares now meaningful, ultras still scarce. Stale UI copy cleaned up. Calendar-week leaderboard introduced.

Sleep was earned. Tomorrow we ship Phase E externals → public App Store submission, or kick off v3 PvP Phase 1 implementation.

HEAD `3c58fd1` on `origin/main`. Working tree clean. Ready to resume cold.
