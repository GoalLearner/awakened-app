# HANDOFF — May 12, 2026 (Tuesday)

Session-start handoff doc. Standing instruction: every fresh session opens by writing one of these so context is pinned. This is the first such doc; it becomes the template for future handoffs.

---

## 1. Session meta

| Field | Value |
|---|---|
| Session start | Tuesday, May 12, 2026 · 11:34 AM PST |
| Day of week / trading-day relevance | Tuesday — **non-trading day** in Richie's schedule. Full focus available for Awakened work without market-watch interruption. |
| Prior session end | Monday, May 11, 2026 · ~9:05 PM PST |
| Prior session final commit | `b26b6b9` — *design: BACKEND.md v1.1 — alias case normalization (lowercase everyone except Richie) + Phase A retrospective* |
| Prior session energy state | Late-night win after 8 hours of work culminating in build 50 success. v2.0.2 fully shipped (drops Phase 1 art + 3-notif + cards) and Phase A sign-in gate validated on TestFlight. Win-tinged exhaustion. |
| Hours between sessions | ~14.5 hours (call it a real sleep) |

---

## 2. Where the app is right now

| Field | Value |
|---|---|
| `main` branch HEAD | `b26b6b9` |
| `APP_VERSION` (in `app.js` + `codemagic.yaml`) | `2.0.2` |
| Last successful TestFlight build | Build **50** of train `2.0.2` (commit `630bbe6`, manual-signing pivot) |
| `sw.js` `CACHE_VERSION` | `v5.139` |
| `index.html` cache busts | `styles.css?v=203`, `app.js?v=268`, `auth.js?v=1` |
| Working tree | **Clean** except 4 untracked scratch PNGs (see §7) |
| Open PRs / unmerged branches | None. `main` is the only working branch. |
| Origin sync | `main` is in sync with `origin/main` at `b26b6b9` |
| HealthKit auth version | `2` (unchanged from v1.1.5) |

All values re-read from disk this morning — not memory.

---

## 3. What shipped yesterday (5/11)

**v2.0.2 — drops Phase 1 + 3-notification cadence (morning batch):**

- 9-card launch roster across 3 bosses (Insomniac / Carouser / Steel Wolf) with real DALL·E art at 1254×1254 RGB; full Pokédex on the Items tab with collapsible rarity sections, stat-bonus badges (`+8 VIT / +4 WILL` style chips), stack caps (common max 1, rare max 3, ultra unlimited), cadence-aware drop rates (5× / 3× / 2× multipliers for weekly bosses), cinematic Solo Leveling reveal modal for rare + ultra-rare drops with full animation timing
- Notification system expanded from 2 daily pings to 3: morning configurable + 1 PM mid-day (souls / streak / caught-up conditional body) + 7 PM evening (shifted from 6 PM)
- `EQUIPMENT.md v1.3` + `DROPS.md v1.4` design docs locked
- TestFlight build **40** (v2.0.2 train) went green at 3:08 PM PST

**v2.1 Phase A — Sign in with Apple gate (evening batch):**

- `auth.js` module with `window.Auth` namespace (`getCurrentUser`, `getJwt`, `clearUser`, `isJwtNearExpiry`, `validateAlias`, `signInWithApple`, `completeSignIn`)
- Mandatory `#signin-gate` overlay (two-step flow: Apple HIG-compliant button → alias picker with pre-fill from Apple's `givenName`)
- Settings → Account section scaffold (sign out functional; delete-account shows "Coming in Phase B" toast)
- `@capacitor-community/apple-sign-in@7.1.0` integrated; codemagic.yaml writes `com.apple.developer.applesignin` entitlement
- `BACKEND.md v1.0 → v1.1` (added alias case normalization design)

**The signing rabbit hole** — 8 Codemagic build cycles (41–49) burned diagnosing layered failures:
1. CocoaPods iOS deployment target mismatch (plugin v7 requires iOS 14, Capacitor default was 13) — fixed by sed-bumping the Podfile + project.pbxproj
2. Stale provisioning profile cache → cached profile didn't include `applesignin` entitlement
3. Apple Developer Portal "Sign in with Apple" capability needed to be configured as **primary App ID** (the dialog's hidden requirement — Edit → "Enable as a primary App ID" → Save)
4. `app-store-connect fetch-signing-files` from custom scripts fails under auto-signing — `CM_CERTIFICATE_PRIVATE_KEY` env var is NOT exposed (it's only exposed under manual signing)
5. Build 49's `security cms -D` profile-inspection diagnostic proved auto-signing's profile genuinely lacked the entitlement

**Build 50 (manual-signing pivot)** went green at ~9:00 PM PST. iOS-side validation confirmed:
- Sign-in gate appears mandatory on first launch
- Apple Sign-In flow completes; alias picker pre-fills
- `hb_user` written with `jwt: 'PHASE_A_STUB'`
- Settings → Account section displays `@alias` correctly
- Sign-out clears `hb_user` and re-shows the gate cleanly

---

## 4. Current v2.1 train status

| Phase | Status | Estimated remaining cost |
|---|---|---|
| **Phase A — iOS Sign in with Apple integration** | ✅ **Shipped** to TestFlight 5/11 (build 50, commit `630bbe6`) | — |
| **Phase B — Backend skeleton** | Not started. Design locked in `BACKEND.md v1.1`. | ~4.5 hours focused |
| **Phase C — Client wiring** | Not started. Design locked. | ~1–2 hours |
| **Phase D — Export/import** | Not started. Design locked. | ~half day |
| **Phase E — Privacy posture** | Not started. Design locked. | ~half day |

`APP_VERSION` stays at `2.0.2` through all Phase B–E development. Bumps to `2.1.0` only when the full train is ready for App Store submission.

---

## 5. Phase B prerequisites (before any Phase B code is written)

### Required manual setup

1. **Cloudflare account** (~15 min, one-time):
   - Sign up at [cloudflare.com](https://cloudflare.com) (free tier is sufficient — covers tens of thousands of users at our scale)
   - Install Wrangler CLI: `npm install -g wrangler`
   - Authenticate: `wrangler login` (opens browser)
   - Generate JWT signing secret: `openssl rand -hex 32` → save the value somewhere safe (1Password, similar). It'll be set as a Cloudflare secret during Phase B implementation via `wrangler secret put JWT_SIGNING_KEY`.

2. **Capture Richie's Apple `sub`** (NEW from `BACKEND.md v1.1`):
   - Install TestFlight build 50 on iPhone (should already be available)
   - Complete the sign-in flow with your Apple ID, picking alias "Richie"
   - Connect iPhone via cable + open Safari Web Inspector against the device
   - In the WebView console: `JSON.parse(localStorage.getItem('hb_user')).sub`
   - Copy the value (looks like `001234.abcdef0123456789abcdef0123456789.0123`)
   - This becomes the `RICHIE_APPLE_SUB` Cloudflare secret — drives the alias case-normalization allowlist (everyone forced lowercase EXCEPT Richie).

### Decision checkpoints before Phase B kickoff

- **Alias-collision behavior:** default per `BACKEND.md §13 Q2` is REJECT-with-server-suggested-alternatives (`409 ALIAS_TAKEN` + `{ suggested: ['name42', 'name_X', ...] }`). Any revisions wanted now that Phase A is real? (Probably none — the design is sound. Flagging for explicit re-confirm.)
- **`auth.js` refactor before Phase B wires real backend calls:** on-device validation last night didn't surface any need to restructure the auth scaffolding. The `PHASE_A_STUB` JWT marker is one line in `signInWithApple()` and gets replaced with a real `fetch(/v1/auth/verify)` in Phase C. All other auth helpers (`getCurrentUser`, `clearUser`, `isJwtNearExpiry`, etc.) are forward-compatible with real JWTs. **No refactor needed.**
- **Architectural revisions:** none surfaced overnight. The mandatory-gate UX worked as designed; the alias picker pre-fill from Apple's `givenName` is a nice quality-of-life touch users will appreciate.

---

## 6. Key decisions locked from last session

These are locked design contracts — implementation can proceed without re-litigating any of them:

| Area | Decision |
|---|---|
| Backend stack | **Cloudflare Workers + D1** (NOT Firebase, NOT Supabase, NOT AWS Lambda) |
| Auth provider | **Sign in with Apple** (mandatory gate at first launch, no skip) |
| iOS code signing | **Manual** — uses uploaded cert `awakened-distribution` + uploaded profile `awakened-app-store-manual`. Auto-signing was confirmed broken for our Sign in with Apple capability. |
| Database primary key | **Internal UUID v4** on `users.id`; `users.apple_sub` is `UNIQUE NOT NULL` foreign-key column |
| Alias uniqueness | **Case-insensitive**, enforced by `UNIQUE INDEX ON LOWER(alias)` |
| Alias collision strategy | **REJECT** with `409 ALIAS_TAKEN` + server-suggested suffix variants. Client re-prompts with tappable suggestion chips. |
| Alias case normalization | All users **forced lowercase** EXCEPT a hardcoded `PRESERVED_CASE_SUBS` set. v2.1 launch contains exactly one entry: Richie's Apple `sub`. (Captured via Phase A TestFlight as a prereq for Phase B.) |
| Profanity filter | **Server-side, hand-rolled blocklist** of ~50–100 entries with case + leetspeak normalization. Optional client-side pre-validation for instant feedback. |
| JWT lifetime | **90 days** from issue; silent refresh via Apple `SignInWithApple.authorize()` when <14 days remaining |
| Cross-device sync | **Deferred to v2.2**. JSON export/import button in Settings is the v2.1 mitigation. |
| Endpoint versioning | **`/v1/` prefix** on all endpoints; breaking changes ship as `/v2/` and run alongside |
| Apple Services ID | **None separate** — bundle ID `com.goallearner.awakened` serves as the audience claim. Services ID would only be required for web-side Sign in with Apple, which Awakened doesn't have. |

---

## 7. Stale PNG scratch files status

Still untracked at project root, untouched through 5/11:

- `app-icon-source.backup.png`
- `app-icon-source.white.backup.png`
- `black-background.png`
- `new-logo.png`

All flagged for delete; all confirmed not load-bearing (the active app icon source is `app-icon-source.png`; nothing in `codemagic.yaml` or the app references these four). Carrying forward to today as a low-priority bounded-cleanup candidate. Safe to delete via `rm` whenever.

---

## 8. Open items / technical debt

| Item | Severity | Notes |
|---|---|---|
| Stale auto-signing provisioning profile in Codemagic | Low (cosmetic) | The original `Awakened App Store` auto-signing profile may still be visible in Codemagic's iOS provisioning profiles tab alongside the new manual `awakened-app-store-manual`. Codemagic ignores it under manual-signing config; can be deleted from the dashboard whenever for cleanup. **Not blocking.** |
| `CLAUDE.md` cache-bust state sentence | Low | Per yesterday's docs refresh (commit `80abf93`), CLAUDE.md line ~1471 should read `styles.css?v=203, app.js?v=268, auth.js?v=1, sw.js v5.139, APP_VERSION = '2.0.2'`. Verify against actual state when CLAUDE.md is next touched. |
| `hb_user.jwt: 'PHASE_A_STUB'` literal on every Phase A user | Critical for Phase B/C | Single grep-target marker. All Phase A users have this stub JWT in their local state. Phase C's first action: client sends fresh Apple identityToken on next sign-in attempt → backend issues a real JWT → stub gets replaced transparently. **Migration is silent.** Documented in `auth.js` header comment. |
| Capacitor `@perfood/capacitor-healthkit` peer-dep range | Low (existing debt) | Plugin's published peer-deps declare Capacitor 4 while we're on Capacitor 6. `.npmrc` `legacy-peer-deps=true` works around this. Carries forward indefinitely until we migrate to `@capgo/capacitor-health` during a future Capacitor 6→8 upgrade. **Not Phase B-blocking.** |
| 4 scratch PNGs (see §7) | Low (cosmetic) | Persistent untracked-files noise in `git status`. |

Nothing in this list blocks Phase B kickoff.

---

## 9. What Richie will decide this morning

*(awaiting Richie's direction this session)*

---

## 10. Suggested next moves (ranked, but Richie decides)

| # | Option | Effort | Rationale |
|---|---|---|---|
| A | **Cloudflare prereq setup + capture `RICHIE_APPLE_SUB`** | ~15–20 min | Unblocks Phase B implementation. Self-contained one-time setup. Even if you don't start Phase B today, having Cloudflare ready means future-you can dive in cold. |
| B | **Phase B implementation kickoff** | ~4.5 hours focused | Build the Cloudflare Workers + D1 backend per `BACKEND.md §12`. 4 endpoints + Apple JWKs verification + JWT issuer + profanity filter + alias normalization. End state: live backend that Phase C clients will talk to. |
| C | **Deeper on-device Phase A validation** | ~30–60 min | Edge-case validation of the sign-in gate. Specifically: (a) what happens if user denies Face ID mid-Apple-Sign-In; (b) force-quit during alias picker — does the user resume at the alias picker or get re-prompted for Apple Sign-In; (c) device rotation mid-sign-in; (d) sign-in attempt while offline (gate should show an inline network-error message gracefully). Surfaces any Phase A polish needed before Phase C wires real backend calls. |
| D | **Bounded cleanup pass** | ~15–20 min | Delete the 4 scratch PNGs at root, delete the stale auto-signing profile in Codemagic dashboard, verify CLAUDE.md cache-bust sentence reflects current state. Zero feature impact. Reduces `git status` noise to actually-meaningful changes. |
| E | **Non-Phase-B feature work** | varies | The codebase is stable. If you'd rather use this session for content (more habits in the curated library, more drops, more boss roster expansion), polish (UI refinements surfaced from yesterday's TestFlight session), or bug-hunting, that's fine — Phase B can land any day this week. |

**My weak preference:** Option A this morning (15 min, unblocks future-you) + Option C (light validation, ensures Phase B builds on a solid Phase A). If those land cleanly, Option B becomes natural for an afternoon block.

**No presumption that Phase B starts today.** The session-flex norm holds.

---

## 11. State snapshot

For quick re-read at session end / next-morning handoff cross-check:

```
HEAD:                    b26b6b9
APP_VERSION:             2.0.2
Last TestFlight build:   50 (train 2.0.2)
Cache-bust state:        styles.css?v=203, app.js?v=268, auth.js?v=1, sw.js v5.139
Last commit message:     design: BACKEND.md v1.1 — alias case normalization
                         (lowercase everyone except Richie) + Phase A retrospective
Commits made 5/11:       16
Files changed 5/11:      22 (4349 +, 135 -)
Working tree:            clean (only 4 ignored scratch PNGs untracked)
Origin sync:             main is in sync with origin/main
Phase A:                 ✅ shipped 5/11 (build 50)
Phase B:                 not started (Cloudflare account + RICHIE_APPLE_SUB prereqs)
v2.1 train target:       all phases A→E, then APP_VERSION bumps 2.0.2 → 2.1.0
```

---

*End of handoff. Awaiting Richie's direction.*
