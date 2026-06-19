# PvP — Realtime Duels: Build Report (W404/W405)

**Status: BUILT, verified, and shipping DORMANT behind a flag. Ready to go live the
moment the backend is deployed.** Server-authoritative, two real players on two
different phones anywhere in the world, over Durable Objects + WebSockets.

Date: 2026-06-19 · Marketing target version when enabled: **2.3.0**

---

## 1. What was built

A complete, server-authoritative PvP duel system that **reuses the shipped Arena
combat engine and battle UI** — the combat math was solved, so it was lifted to the
server and proven byte-identical, never re-derived.

- **Transport:** Cloudflare **Durable Objects + WebSockets** (one `MatchRoom` DO per
  match, addressed by `idFromName(code)`), with an **HTTP-poll fallback**. This is the
  correct answer for "two phones anywhere on the globe."
- **Authority:** the DO is the single source of truth. Clients send move **intents**;
  the DO runs the engine and broadcasts the result. The client **never** computes an
  outcome.
- **Matchmaking:** **invite-by-code** (deterministic, solo-testable). 6-char
  unambiguous codes (no 0/O/1/I). Open-queue is scaffolded (a `pvp_queue` table) but
  intentionally deferred — see §7.
- **Turn model:** simultaneous move selection, server-ordered resolution (the shipped
  priority/edge rules), **45 s turn timer** with auto-resolve on timeout, **reconnect**
  (deterministic replay), and **disconnect/forfeit** resolution (120 s grace).
- **Economy hooks:** ranked ELO (K=32/24/16/12 by bracket) + a durable D1 match record.
  Invite duels are unranked in v1.

### The hard problem, solved
Running the **same** combat math server-side without forking it. Approach: lift the
pure, deterministic core of the app.js Arena engine into `backend/src/pvp/combat-core.js`
and **prove parity** — identical combatant + seed + move sequence yields byte-identical
`{won, turns, pHP, bHP}`. The DO survives hibernation by **deterministic replay** of
`{seed, combatants, moveHistory}` (the same trick the reconnect + turn-timeout paths use).

---

## 2. Files

**Backend (Cloudflare Worker + D1):**
- `backend/src/pvp/combat-core.js` — server lift of the Arena engine (the PvP API:
  `buildCombatant`, `pvpStartBattle`, `pvpResolveTurn`, `pvpResult`, `defaultMoveForTimeout`).
- `backend/src/pvp/combat-core.d.ts` — TS declarations.
- `backend/src/pvp/match-room.ts` — the `MatchRoom` Durable Object (the authoritative
  match engine: create/join/submit/forfeit, WS hibernation, turn alarm, ELO, D1).
- `backend/src/handlers/pvp.ts` — worker-edge auth + routing to the DO.
- `backend/src/env.ts` — `MATCH` DO binding.
- `backend/src/index.ts` — routes + `export { MatchRoom }`.
- `backend/wrangler.toml` — DO binding + **`new_sqlite_classes` migration (free tier)**.
- `backend/migrations/0021_pvp.sql` — `pvp_matches`, `pvp_ratings`, `pvp_queue`.
- `backend/src/lib/cors.ts` — pass 101/WebSocket upgrades through untouched.

**Frontend (vanilla JS app):**
- `app.js` — `window.PvP` (transport) + the duel controller (reuses the `.pkb` stage +
  `_pkbPlay` beat director), the lobby, the result card, the `PVP_ENABLED` ship gate,
  and the `__pvpDemo`/`__pvpDemoTurn` preview hooks.
- `auth.js` — `Auth.getBackendBase()` (PvP owns its own fetch + WS URLs).
- `styles.css` — namespaced `.pvp-*` styling.

**Tests:**
- `backend/src/pvp/combat-core.smoke.mjs` — 12/12 (determinism, validation, cooldown).
- `backend/src/pvp/combat-core.parity.mjs` — 3/3 client↔server byte-identical.
- `backend/src/pvp/match-room.itest.mjs` — **9/9** full-match integration (below).

---

## 3. Verification done (this session)

| Gate | Result |
|---|---|
| `Arena.selfTest()` (shipped combat engine untouched) | **37 / 37 pass** |
| `combat-core.smoke.mjs` | 12 / 12 |
| `combat-core.parity.mjs` (client↔server) | 3 / 3 byte-identical |
| `match-room.itest.mjs` (HTTP match, WS match, forfeit, turn-timeout) | **9 / 9** |
| Backend `tsc --noEmit` (non-test) | 0 errors |
| Client duel flow in web preview (lobby → battle → turn drain → KO → result) | clean, 0 console errors |

The integration test drives full matches against the live `MatchRoom` DO under
`wrangler dev`: create → join → poll/submit → KO over **HTTP**; two WebSocket clients
auto-play and **both receive `match_end` and agree on the winner**; forfeit; and a
silent side triggering the turn-timeout alarm. The client rendering seam (synthetic
session → the shipped `_pkbPlay` → KO → result, **without** firing the Ascent
`arenaFinalizeBattle`) was verified visually in the preview via `__pvpDemo()`.

---

## 4. GO-LIVE CHECKLIST (run on the MacBook, from the repo root)

PvP currently ships **dormant** (`PVP_ENABLED = false` in app.js) so the iOS build is
safe to ship before the backend exists. To turn it on:

1. **Deploy the worker** (registers the `MatchRoom` Durable Object + the SQLite
   migration — free tier, no plan upgrade needed):
   ```
   cd backend && npx wrangler deploy
   ```
2. **Apply the D1 migration** (NOT `migrations apply` — use the file form):
   ```
   npx wrangler d1 execute awakened-db --remote --file=migrations/0021_pvp.sql
   ```
3. **Smoke the deployed endpoint** (optional): a `GET /v1/pvp/state?code=ZZZZZZ` with a
   real Bearer token should return `{"ok":false,"code":"NO_MATCH"}` (not a 500).
4. **Flip the flag:** set `const PVP_ENABLED = false;` → `true` in `app.js`, then bump
   the frontend version markers (sw `CACHE_VERSION`, `app.js?v=`, `APP_BUILD_TAG`).
5. **Bump the marketing version** to `2.3.0`: `const APP_VERSION = '2.3.0';` in app.js.
6. **Build + ship iOS** with the usual `prep-local-build.sh` one-liner.

> Order matters: steps 1–2 (backend) MUST precede step 4 (flip). The flag exists
> precisely so an auto-triggered iOS build can never ship a Duel button whose backend
> isn't live yet.

---

## 5. Two-phone manual test (after go-live)

1. Phone A: sign in → **The Ascent** → **Duel a Friend** → **Create a duel**. A 6-char
   code appears.
2. Phone B (different account, anywhere): **Duel a Friend** → type the code → **Join**.
3. Both phones drop into the battle screen. Each picks a move; when both have locked in,
   the exchange animates **identically on both phones** and HP agrees.
4. Play to a KO → both see the mirror result (VICTORY / DEFEAT).
5. Re-test the edge paths: one player taps **EXIT** (forfeit → other wins); one player
   backgrounds the app for >2 min (disconnect → other wins); one player sits idle a full
   turn (45 s timeout auto-resolves, no stall).

---

## 6. Architecture notes for future me

- **Perspective:** the DO's per-slot view already labels `me`/`opp` from the recipient's
  side, so HP/status/effectiveness need no flipping. Only the turn `events` array is in
  server orientation (`p`=p1, `b`=p2); the **joiner** (slot `b`) flips each event's side
  so "you" always renders at the bottom of the same stage.
- **The one client divergence from Ascent:** `_pkbDrained` branches on `_arSess._pvp` to
  skip `arenaFinalizeBattle` (no floor climb / titles / daily-lives) and show the duel
  result. Everything else — the stage, beats, crits, super/weak toasts, clutch, KO — is
  the shipped UI.
- **Free tier:** the `MatchRoom` DO uses `new_sqlite_classes` (SQLite-backed storage), so
  it runs on the Workers **free** plan. No paid plan required.

---

## 7. Known limitations / deferred (honest list)

- **Joiner status-line wording (cosmetic):** the verbatim DoT/heal/buff log lines
  (e.g. "You are burning…") are authored in the creator's orientation, so for the
  **joiner** those *status* lines can read from the wrong subject. The hit/miss/dodge
  beats (the 95% case) auto-correct because the UI re-derives "You used X" from the
  (flipped) event side. Outcome, HP, winner, and fairness are unaffected. Fix later by
  authoring those lines per-recipient in the DO broadcast.
- **Open-queue matchmaking:** deferred. The `pvp_queue` table exists; the directive
  said invite-by-code first, open queue "if time." Invite-by-code is complete + tested.
- **HTTP fallback animation:** the poll fallback snaps HP instead of animating beats
  (the `/state` endpoint carries the view, not the per-turn event stream). WebSocket —
  the default everywhere modern — gets the full animated experience.
- **Opponent avatar:** rendered as a monogram (real avatar sync across accounts is a
  separate, larger feature).

---

## 8. Adversarial review (W406) — done

Three independent skeptical reviewers swept the backend DO, the client controller, and
the combat-core lift. Outcome:

**Combat-core parity:** verdict **faithful lift, no outcome-changing divergence** — every
resolution-relevant line is logic-identical to the app.js engine; the only deltas are
comments, display-only event fields, and the expected `bAttuned` generalization (verified
backward-compatible). (Cosmetic: three move `desc` strings use ASCII `-25%` vs the
client's Unicode `−25%`; engine never reads `desc`.)

**Fixed real bugs (W406):**
- **Client (critical):** a rejected submit (`STALE_TURN`/`ILLEGAL_MOVE`) used to soft-lock
  the player in "waiting" forever — now unwinds the optimistic submit + resyncs.
- **Client (high):** the turn timer + "Your move" status vanished after turn 1 (the shared
  `_pkbDrained` non-done branch is the Ascent prompt) — now the `_pvp` branch re-arms the
  duel turn UI. Verified in preview across multiple turns.
- **Client (medium/low):** added `_pkbPlay` re-entrancy dedup (by turn number) so a
  redelivered `turn_result` can't double-drain HP; `connect()` now tears down the prior
  socket + guards stale-socket listeners so reconnects don't leak.
- **Backend (real):** the single DO alarm slot was clobbered by the disconnect-grace timer,
  delaying turn timeouts after a reconnect flicker — now the grace alarm never pushes later
  than the live turn deadline, and reconnect restores it. Also a clean lobby-abandon path
  for a creator bailing before anyone joins.

**Assessed NOT a bug (Cloudflare input gates):** the reviewer flagged read-modify-write
races across `doSubmit`/`doJoin`/`doForfeit`/`alarm`. Verified these are prevented by the
DO **input gate**: every mutating path does `load → synchronous mutate → decisive save`
with no non-storage `await` in between, so no second event interleaves before the decision
is persisted (every `env.DB` call comes *after* the save). Documented this as a hard
invariant in `match-room.ts` so a future edit can't silently re-open the window. No mutex
refactor applied — it would risk regressing a 9/9-passing engine for no gain.

Post-fix: `Arena.selfTest()` 37/37, backend `tsc` 0 errors, `match-room.itest` 9/9, client
flow re-verified in preview (multi-turn timer restore + KO + result, 0 console errors).
