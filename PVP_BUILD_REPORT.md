# PvP — Realtime Ranked Duels: Build Report (W404–W409)

**Status: BUILT, verified, and the backend is DEPLOYED LIVE.** The worker (with the
`MatchRoom` Durable Object) and the D1 migration are in production. The client ships
behind `PVP_ENABLED`; flipping it on + an iOS build is the last step. Server-authoritative,
two real players on two different phones anywhere, over Durable Objects + WebSockets,
with a **ranked ELO ladder**.

Date: 2026-06-19 · Marketing version at launch: **2.3.0**

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
- **Ranked ELO ladder (W407/W408):** duels are **ranked by default** — every completed
  match moves both players' rating (win = +K·(1−E), loss symmetric, **draw = 0.5**),
  K=32/24/16/12 by bracket (PVP.md §11.3). 7 tiers Bronze→Awakened (§12.2). The Arena
  lobby shows your tier + ELO + W/L/D + global rank; the result shows the +/- MMR delta.
  `GET /v1/pvp/rating` (own) and `GET /v1/pvp/leaderboard` (top-N) back it; ratings live
  in D1 `pvp_ratings`.
- **Draw (§18.6):** mutual KO (both fall the same turn) and an exact turn-cap tie resolve
  to a DRAW — detected in `pvpResult` only, so the shared engine stays byte-identical.

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
| `combat-core.draw.mjs` (mutual-KO + cap-tie draw logic) | **9 / 9** |
| `combat-core.pvp-attune.mjs` (P2 bAttuned human-foe path) | **6 / 6** |
| `match-room.itest.mjs` (HTTP, WS, forfeit, timeout, reconnect, **ranked MMR**) | **19 / 19** |
| Backend `tsc --noEmit` (non-test) | 0 errors |
| **Deployed worker smoke** (prod): `/health` 200; PvP routes 401-gated; WS rejects bad token | pass |
| Client flow in preview (lobby rank band, win/loss/**draw**, MMR delta) | clean, 0 console errors |

The integration test drives full matches against the live `MatchRoom` DO under
`wrangler dev`: create → join → poll/submit → KO over **HTTP**; two WebSocket clients
auto-play and **both receive `match_end` and agree on the winner**; forfeit; turn-timeout;
a disconnect→reconnect that proves the turn deadline still fires on schedule; and a
**ranked match** asserting symmetric MMR movement + the match_end rating delta against a
real (local) D1. The `bAttuned` test covers the one PvP generalization the Ascent parity
could not: a real weapon-wielding P2 deals the +15% attune (proven by an isolated
same-seed comparison). The client rendering seam (synthetic session → the shipped
`_pkbPlay` → KO/draw → result, **without** firing the Ascent `arenaFinalizeBattle`) was
verified visually in the preview.

---

## 4. GO-LIVE — backend DONE; client flip remains

The worker + D1 migration are **already deployed to production** (this session):

| Step | Status |
|---|---|
| `cd backend && npx wrangler deploy` (registers the `MatchRoom` DO, free-tier SQLite) | ✅ done — Version `1b44e3f9…` |
| `npx wrangler d1 execute awakened-db --remote --file=migrations/0021_pvp.sql` | ✅ done — `pvp_matches`/`pvp_ratings`/`pvp_queue` live |
| Prod smoke (`/health` 200, PvP routes 401-gated, WS rejects bad token) | ✅ done |
| Flip `const PVP_ENABLED = false → true` in app.js + bump version markers | see below |
| Bump `APP_VERSION` to `2.3.0` | see below |
| Build + ship iOS via `prep-local-build.sh` (web auto-deploys on push) | owner |

The dormant flag existed so the frontend could ship before the backend. The backend is
now live, so the flip is safe. If this session flipped it (W409), the only remaining
owner step is the iOS build (web is live on the next deploy).

---

## 5. Two-phone manual test — a real RANKED match (after the flag is on)

This is the one test only you can run (it needs two real Apple-signed accounts). The
function is already proven by `match-room.itest.mjs` (19/19 on identical code), so this
is a confidence check on real devices + real network.

1. Phone A: sign in → **The Ascent** → **Duel a Friend** (now **The Arena**). The
   **YOUR RANK** band shows your tier + ELO (a brand-new account reads **Silver · 1500 ·
   Unranked** until its first match). Tap **Create a duel** → a 6-char code appears.
2. Phone B (a *different* account, anywhere in the world): **Duel a Friend** → type the
   code → **Join**.
3. Both phones drop into the **same battle screen** (identical to an Ascent fight). Each
   picks a move; when both lock in, the exchange animates **identically on both phones**
   and the HP bars agree. The turn timer counts down (45 s); a missed turn auto-resolves.
4. Play to a KO → the winner sees **VICTORY**, the loser **DEFEAT**, each with a
   **Ranked Duel · Result** MMR row: the winner **+~16 ELO** (→ ~1516, still Silver), the
   loser **−~16** (→ ~1484, drops to Bronze under 1500). Reopen the Arena on each phone —
   the rank band reflects the new ELO + W/L record. Run it again and the numbers move
   symmetrically each time.
5. Edge paths to spot-check:
   - **Forfeit:** one player taps **EXIT** → confirms → the other gets **VICTORY** (their
     ELO still rises; the quitter's falls).
   - **Disconnect:** one player backgrounds the app >2 min → the present player wins.
   - **Timeout:** one player sits idle a full turn → it auto-resolves, no stall.
   - **Draw (rare, hard to force):** if both fighters fall on the same turn (e.g. mutual
     burn/bleed death) you'll see a cyan **DRAW** on both phones, ELO barely moves (0 when
     evenly rated).
6. Check the ladder: the global rank in the band + `GET /v1/pvp/leaderboard` reflect both
   accounts.

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
- **Draw without forking the engine:** the shared engine only ever yields a p/b winner
  (it favors p on simultaneous death, coin-flips an exact cap tie). `pvpResult` re-reads
  the final HP state to label a DRAW (mutual KO / exact cap tie); `broadcastTurn` uses
  `pvpResult` so the KO animation never shows a false winner. The engine bytes are
  untouched → parity holds.
- **ELO applied exactly once:** `persistEnd` is guarded by `m.persisted`, and the
  concurrency invariant (load → sync mutate → decisive save before any `env.DB` await)
  means the DO input gate serializes the end paths — no double-apply. Ratings denormalize
  the alias so the leaderboard needs no join. `ranked` is fixed at create time (the joiner
  can't change it).

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

## 9. Adversarial review of the ranked-meta (W409) — done

A second 3-reviewer workflow swept the new draw / ELO / rating-endpoint / client-MMR code.
It **re-confirmed** the draw classification, the ELO math, the unranked/lobby paths, the
SQL parameterization, and — importantly — that **double-applying ELO is structurally
impossible** under the DO input gate (so no defensive dedup was added). It found **6 real
issues (0 high, none rating-integrity)**, all fixed in W409:

- **R1 (med):** a mutual-KO draw played the *defeat* sting + loss haptics to both players
  (cue chosen from `s.won` before the draw branch) → now branches on `drawn` (neutral cue).
- **R2 (med):** the two new reads (`/rating`, `/leaderboard`) had no rate-limit (every
  sibling read does) → both now gated by `RL_HALL_READ` (30/min).
- **R3 (low):** the denormalized alias could be NULL-clobbered by a later empty-alias match
  → `alias = COALESCE(NULLIF(excluded.alias,''), pvp_ratings.alias)`.
- **R4 (low):** "Updating your rank…" could stick forever on a single fetch failure → a
  terminal fallback line now always replaces the spinner.
- **R5 (low):** a draw dimmed only your nameplate → both plates now KO on a draw.
- **R6 (low):** a back-to-back duel's fallback delta could span two matches → the
  `_pvpRating` baseline is refreshed from each result.

Post-fix: backend `tsc` 0, `match-room.itest` **19/19** (stable across runs), draw 9/9,
attune 6/6, client draw/win/lobby re-verified in preview, worker redeployed (Version
`1f5ed79e`). **`PVP_ENABLED` is now `true`; APP_VERSION `2.3.0`.**
