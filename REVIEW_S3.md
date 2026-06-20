# REVIEW_S3 — PvP stack hardening review (2026-06-19/20)

A no-new-features audit of everything added this session: the realtime ranked PvP
stack (W404→W415) plus the polish/handoff work that followed (W416→W433 — tier
emblems, music default, anti-farm, the Arena hub, Ascent ceremony, ladder/VS/result
redesigns, combat + defender + focus VFX, seasons + placement, Echo Mode). Goal:
clean, correct, non-redundant, dead-code-free, no latent problems. **No new features.**

Surface: `288406c^..HEAD` (3d77494) — **36 files, +5,566 / −36**.

## SACRED — do not break
- **Combat engine + battle UI are reused, not forked.** `combat-core.js` is a
  byte-identical transcription of the app.js Arena engine. Parity 3/3, smoke 12/12.
  After ANY change near `combat-core.js`, arena resolution, or the `.pkb` UI →
  re-run smoke + parity and confirm STILL byte-identical. A cleanup that alters
  combat output by one float is NOT made.
- **Server-authoritative invariants:** MMR/ELO math, rematch gating (loss banked
  before rematch reachable), the DO input-gate atomicity, bot-replay determinism
  (rebuild re-picks the bot move → 0/400 divergence). Don't "simplify" without
  re-proving via the existing tests.
- **Live app at 2.3.1, PVP_ENABLED=true.** Backend changes require redeploy + prod
  smoke. Committed-source refactors that aren't deployed desync prod from main — avoid or deploy.

## Surface inventory (grouped)

### Backend — engine (SACRED)
- `backend/src/pvp/combat-core.js` (549) — lifted engine; must stay byte-identical.
- `backend/src/pvp/combat-core.d.ts` (72) — type surface.
- Tests: `combat-core.smoke.mjs` (12/12), `.parity.mjs` (3/3), `.draw.mjs` (9/9), `.pvp-attune.mjs` (6/6).

### Backend — match server
- `backend/src/pvp/match-room.ts` (668) — MatchRoom DO. Largest correctness surface.
- `backend/src/handlers/pvp.ts` (222) — create/join/find/state/submit/rating/leaderboard/history.
- `backend/src/pvp/bots.ts` (44) — bot roster (server content).
- `backend/src/pvp/elo.ts` (18) — K-factor, eloTier thresholds.
- `backend/src/pvp/seasons.ts` (42) — season window, soft reset, lazy roll.
- `backend/src/pvp/match-room.itest.mjs` (390) — integration test (40/40).

### Backend — wiring / config / schema
- `backend/src/env.ts` (+6), `backend/src/index.ts` (+53), `backend/src/lib/cors.ts` (+6 — WS 101 passthrough).
- `backend/wrangler.toml` (+15 — MATCH DO, new_sqlite_classes, RLs).
- `backend/migrations/0021_pvp.sql` (57), `0022_pvp_seasons.sql` (32).

### Client
- `app.js` (+1920) — PvP module (`window.PvP`), `_pvp*` lobby/VS/result/history/ladder/hub/
  share/ceremony/Echo, the `.pkb` VFX hooks (W428/429/431), tier emblems, dispatch.
- `styles.css` (+730) — all `.pvp-*`, `.pkb-*`, `.arena-*` CSS.
- `auth.js` (+9 — getBackendBase), `index.html` (asset/version), `sw.js` (cache version).

### Docs (not shipped)
- `PVP.md`, `PVP_BUILD_REPORT.md`, `PVP_ROADMAP_S2.md`.

## Per-phase checklist

### Phase 1 — Dead code / redundancy / duplication
- [ ] Unused functions / vars / imports (backend + client).
- [ ] Demo/preview hooks (`__pvpDemo/__pvpLobby/__pvpLadder/__pvpVs/__pvpHistory/__pvpCeremony/__pvpDemoTurn`)
      — keep if a real owner test aid, remove if pure scaffolding. **Rule to state + apply.**
- [ ] Unused CSS classes (esp. after the W421/425/426/427 redesigns replaced earlier markup,
      and W433 which removed `.pvp-hub-find .glint`).
- [ ] Duplicated logic that can drift: tier/ELO helpers (client `_pvpTier` vs server `eloTier`
      vs `_PVP_TIER_BR`/`_PVP_TIER_PAL`), placement constant (`PVP_PLACEMENT_MATCHES` vs
      `PVP_PLACEMENT_GAMES`), K-factors, timeout constants, share-card data shaping, teardown paths.
- [ ] Hardcoded thresholds duplicated across files (tier bands client vs server).

### Phase 2 — Correctness / latent bugs
- [ ] Ugly paths: disconnect/reconnect, double-submit/stale-turn, timeout-alarm vs late-move race,
      rematch decline/expire/one-side-bails, forfeit-on-quit from EVERY screen, match_end during
      VS or result, rematch-waiting fallback timer.
- [ ] Teardown leak-free: every WS close, every timer (VS / rematch-wait / turn), every listener
      cleared on every exit path. Chase orphaned sockets + timer leaks.
- [ ] Determinism: bot-replay AND human-replay keep RNG in lockstep with the live broadcast.
      Confirm the WS determinism itest covers BOTH; add a human-replay case if it only covers bots.
- [ ] Error handling: failed fetch (rating/history/leaderboard), dropped socket mid-handshake,
      backend 500. Spinners that stick, states that wedge.
- [ ] Client-trusted values that should be server-authoritative (share card, result, rank band).

### Phase 3 — Schema / deploy / config
- [ ] Indexes match the queries actually run (leaderboard sort, history-by-player, season scope).
- [ ] Columns added but unused; alias denormalization stays consistent on upsert.
- [ ] `wrangler.toml` coherent — every binding the handlers reference exists; no dangling refs.
- [ ] **prod == main** — deployed worker matches committed source (no tested-not-deployed,
      no deployed-not-committed). Explicitly verify (rapid-redeploy desync risk).
- [ ] Version/cache discipline: `APP_BUILD_TAG` matches source AND built app.js; sw cache version correct.

### Phase 4 — Regression + finalize
- [ ] Full suite green: smoke 12/12, parity 3/3, draw 9/9, attune 6/6, `Arena.selfTest`,
      itest 40/40, backend `tsc` 0.
- [ ] Preview spot-check anything changed (DOM eval; screenshots flaky this session).
- [ ] Redeploy worker IF backend changed; prod smoke (health 200, routes 401-gated, WS rejects bad token).
- [ ] Findings written below; recommendations for the real two-phone build noted.

## Method
Read-only multi-agent auditors fan out across subsystems + dimensions and return
structured findings; each finding is adversarially verified before action. The main
loop makes all edits + runs all tests (keeps the SACRED combat constraints under
direct control). Highest-risk surface (rematch + bot mode + MMR) gets a dedicated
adversarial-review pass.

---

## FINDINGS (appended as phases complete)

### Baseline (pre-review) — green established
smoke 12/12 · parity 3/3 (client↔server byte-identical) · draw 9/9 · attune 6/6 ·
backend tsc 0 · itest **40/40** · vitest 295/295. This is the regression gate.

**F0 (FIXED, pre-existing, non-PvP) — flaky test.**
`public-achievement-events.test.ts` smuggle-leak assertions did `JSON.stringify(binds)`
then `not.toMatch(/47/)` / `/82/` / `/487/` etc. `binds[0]` is a server-generated random
UUID (`crypto.randomUUID()`) whose 32 hex chars frequently contain a 2–3 digit pattern →
the suite false-failed ~1 run in 5. `serverAt` (binds[9]) is NOT a factor (mocked via
`vi.setSystemTime`). Fix: scan `binds.slice(1)` — the random id can't carry smuggled input,
so excluding it preserves the protective intent and removes the flake. Verified 0/15 runs.
Out of the PvP surface, but fixed because a flaky baseline makes regression detection
unreliable for the whole review.

### Independent main-loop pass (cross-checked against real code)

**F1 (FIXED) — determinism test gap: human-replay lockstep was untested.**
The WS determinism regression (live session HP === per-turn REBUILD HP, i.e. no RNG drift
on replay) was asserted only for BOT matches (itest test 8). Human-vs-human — the newer
path — only checked final-winner agreement. Added the per-turn lockstep assertion to the
human WS match (test 2). The first cut compared absolute `pHP` to the viewer's `me.hp`,
which is slot-relative (`viewBySlot` gives me/opp relative to `m.you`), so the joiner at
slot `b` flipped the mapping — the test caught its own mis-mapping (r2=4 mismatches),
confirming the view code is correct and the test needed `m.you`-aware mapping. Now 41/41.
Commit 03eef23.

**F2 (VALIDATED CORRECT — no change) — DO alarm multiplexing.** One alarm slot serves
turn-deadline, disconnect-grace, and rematch-offer-expiry. `alarm()` disambiguates by current
state; the `now < deadlineMs - 1000` guard re-arms on an early (grace) fire so a premature
turn-timeout can't trigger. Disconnect grace (120s) > turn deadline (≤45s) always, so the
single slot stays at the deadline and grace is enforced opportunistically across turn alarms.
Sound. (match-room.ts:380-412, 442, 484-489.)

**F3 (VALIDATED — no change) — server-authoritative invariants hold.**
- Loss banked before rematch: `endMatch` awaits `persistEnd` (ELO write) BEFORE `broadcastEnd`,
  so a client can't reach a rematch offer until the loss is committed. (414-423.)
- ELO double-apply impossible: `persistEnd` sets `m.persisted=true` + saves BEFORE the rating
  write; combined with the DO input-gate, it runs once. (573-576.)
- Anti-farm (W420): `handlePvpCreate` hardcodes `ranked:false` and ignores the client flag
  (pvp.ts:37,44); a crafted `ranked:true` to /create is forced false. Find=ranked. itest test 6.
- Season ELO (W432): `seasonBase` resets a prior-season row (soft-reset elo, w/l/d=0, keep peak);
  `seasonUpsert` absolute-SETs. Correct for both continue + reset. (607-625.)

**F4 (VALIDATED — no change) — client teardown is leak-free.** `_pvpTeardown` closes the WS
and clears every timer (turn `_pvpTimerId`, VS auto-advance `_pvpVsTimer` + countdown
`_pvpVsCountTimer`, ceremony `_pvpCerTimer`, rematch-fallback `_pvpRematchTimer`).
`_pvpExit` adds the forfeit-confirm on live paths; the W433 EXIT button sits only on the
pre-match hub (no live match) and routes through the tower-teardown path; leaving during
'searching' forfeits the just-created match (`_pvpFindMatch` post-await guard). (11502-13.)

**F5 (DECISION — keep) — demo/preview hooks (`__pvpDemo/__pvpLobby/__pvpLadder/__pvpVs/`
`__pvpHistory/__pvpCeremony/__pvpDemoTurn`).** Rule applied: KEEP a hook that is (a) documented
as a deliberate test aid, (b) inert unless explicitly called (zero production behavior), and
(c) provides preview-QA otherwise impossible (the duel UI needs two phones + real Apple JWTs).
All qualify, match the app's existing `__bk*`/Playwright-hook convention (app.js:14286,16434),
and I used them this session to verify seasons + Echo Mode. Kept.

**F6 (CLEAN) — W433 left no orphan CSS.** The `.pvp-hub-find .glint` rule AND `@keyframes
pvpHubGlint` were both removed with the markup; zero stray refs in styles.css/app.js.

**F7 (DEFERRED-BY-DESIGN) — tier-threshold duplication (client `_pvpTier` app.js:10293 vs
server `eloTier` elo.ts).** Identical bands (Awakened≥3000…Silver≥1500). NOT safely
centralizable: two runtimes (TS worker + vanilla-JS client) with no shared module system.
Currently consistent; canonical spec is PVP.md §12.2; the server already returns authoritative
`tier` in rating/view responses, so a future refactor could have the client consume that
instead of recomputing — larger change, deferred. K-factor is server-only (correct).

### Phase 3 — schema / deploy / config (deterministic checks)
- **prod == main: CONFIRMED.** Only backend change since the deployed commit (2e4d020, worker
  version acc136df) is a `*.test.ts` file — not bundled into the worker. Earlier prod smoke
  showed the season columns + season-scoped query live. No source/deploy desync.
- **Indexes match queries (EXPLAIN QUERY PLAN on local D1):** rank query uses
  `idx_pvp_ratings_season (season_id=? AND elo>?)` cleanly; leaderboard uses the season index
  (only the `last_match_at` tiebreaker needs a temp b-tree — fine for a small per-season set);
  history uses MULTI-INDEX OR across `idx_pvp_matches_p1`/`_p2`. No missing index.
- **Version/cache knobs internally consistent:** sw v5.765 / app.js?v=874 / styles.css?v=467 /
  APP_BUILD_TAG 2.3.1-w433. (prep-local-build.sh's table confirmed all-OK at build time.)

---

## Multi-agent audit (9 read-only auditors + adversarial verification)

27 raw findings → **18 confirmed, 3 refuted, 6 nits** (30 agents, 1.7M tokens). Every dead-code
claim was re-grepped for hidden callers; every correctness/leak claim was traced to a reachable
path; combat-core.js was independently confirmed a faithful byte-identical transcription (be-engine#1).
The main loop made all edits + ran all tests; combat parity stayed 3/3 byte-identical throughout.

### Fixed + DEPLOYED (backend — worker version f74fedba, prod smoked)
- **be-matchroom#1 (MEDIUM, real bug):** `resetForRematch` carried stale `connected`/`lastSeen`
  into the new match → a player who dropped >grace ago and rejoined a rematch over HTTP-poll was
  force-forfeited on turn 1 (wrong winner + wrong ranked ELO). Fixed by clearing `m.lastSeen`
  only (NOT `connected` — the client flashes a "disconnected" banner on `oppConnected===false`).
  **Gold-standard regression test** (itest 9b): proven to FAIL without the fix
  (`reason:"disconnect"`) and PASS with it. Made `DISCONNECT_GRACE_MS` env-overridable
  (`PVP_DISCONNECT_GRACE_MS`) for the test; prod default unchanged (120s).
- **be-matchroom#2 (LOW):** redundant `'state'` frame after the terminal `match_end` on KO/timeout
  → guarded both broadcasts on `phase === 'active'`.
- **be-handlers#1 (LOW):** Find Match picked the Echo off raw prior-season ELO → now projects
  `softResetElo` so the Echo matches the player's current standing.
- **be-elo-bots-seasons#2 (NIT):** corrected the misleading "Diamond+" roster comment.

### Fixed (client — committed; live-match paths code-reviewed, need a two-phone run to fully exercise)
- **cl-flow#1 (MEDIUM):** HTTP-poll fallback wedged the board after a submit (resolved turn
  arrives as `'state'`, `_pvpSyncTurnUI` bails on `_pkbBusy`). Added `_pvpPollReconcile` — snaps
  HP + re-arms moves when holding the submit lock and the server shows a fresh advanced turn.
  Never fires on WS (animate clears `_pvpSubmitPending` first).
- **cl-result-share#1 (MEDIUM):** a late re-render wiped an in-flight rematch UI → `_pvpRenderResult`
  now captures + restores the prior rematch state.
- **cl-result-share#2 (MEDIUM):** the late-end branch called `_pvpPatchResultRating`, a no-op
  targeting a `#pvp-mmr` host the shipped card never renders → dropped a late authoritative rating.
  Now re-renders the live card (rematch-safe); removed the dead `_pvpRatingResultHtml`/`_pvpPatchResultRating`.
- **cl-result-share#3 (LOW):** empty `.catch` stranded the hub on its loading spinner → added a
  tap-to-retry (`_pvpRatingError` + `pvpretry`).

### Dead code removed (Phase 1)
- Functions: `_pvpRankBandHtml` (W421 orphan), `_pvpStreakMilestoneHtml` (W427 orphan),
  `_pvpRatingResultHtml`/`_pvpPatchResultRating` (with cl-result-share#2).
- ~50 orphan CSS rules: `.pvp-rankband`/`.pvp-rb-*`, `.pvp-mmr-*`, `.pvp-streak-moment`,
  `.pvp-rankchange`/`.pvp-rc-*`+`pvpIgnite`, old `.pvp-vs-*`+keyframes (→`.pvp-vs2-*`),
  `.pvp-tower-cta*` (→`.arena-entry`), `.pvp-big*`, `.pvp-links`/`.pvp-ladder-link`.
  Each verified 0 emissions in app.js first; braces balanced; renders confirmed. styles.css −98 lines.
- **Audit conflict resolved (cl-result-share#3 vs cl-dead-dup#1):** `_pvpRankBandHtml` is DEAD
  (0 callers); the live hub loading state is `.pvp-hub-loading`, not the rank band.

### REFUTED by verification (3) — correctly NOT acted on
- **be-engine#1:** "combat-core diverges" → actually a CONFIRMATION it's byte-identical + the PvP
  draw detection is additive (PvE output unchanged). The SACRED guarantee holds.
- **cl-determinism#1:** "WS determinism only covers bots" → ALREADY FIXED earlier this session
  (itest test 2 human-replay lockstep, commit 03eef23).
- **be-elo-bots-seasons#3:** "cross-season read shows stale placement momentarily" → a UX nit, not
  a bug (the projection is correct; placement commits on the next match, by design).

### Deferred (documented, deliberately not changed)
- **be-schema-config#2 (NIT):** `idx_pvp_matches_code` indexes a column no query filters on.
  Dropping it needs a new prod migration (0023) for a tiny write-overhead win — not worth it now.
- **be-schema-config#1 / pvp_queue (LOW dead-code):** the `pvp_queue` table is scaffold (never
  read/written) for the future open human queue — kept INTENTIONALLY (the open queue is surfaced
  as "coming soon" in Echo Mode, W433). Not dead, dormant-by-design.
- **be-elo-bots-seasons#1 / F7:** tier+K-factor cross-runtime duplication — not safely
  centralizable; cross-ref comments would force a needless redeploy/SW-bump. See F7.
- **Bot roster ceiling (be-elo-bots-seasons#2 main point):** the Echo roster tops at 2560
  (Diamond). With Echo Mode now the primary ladder, 2600+ players can't climb past Diamond via
  Echo. **Recommend the owner add Master/Awakened Echoes** (content/balance call) — deferred as
  it edges into a new feature; no prod player is near 2560 yet.
- **Nits left as-is (documented):** `sendToSlot`'s unused `m` param (be-matchroom#3); DO-passthrough
  `{ok,code}@200` vs `{error,detail}` error-shape asymmetry (be-handlers#2); asymmetric rate-limit
  coverage on forfeit/rematch (be-handlers#3); `p1/p2_combatant_json` written-never-read = an
  intentional dispute/audit snapshot (be-schema-config#3); reconnect test could also assert the
  snapshot HP (cl-determinism#2). None worth a redeploy/risk for the value.

## Final regression (Phase 4) — all green
smoke 12/12 (sample byte-identical to baseline) · parity **3/3 byte-identical** · draw 9/9 ·
attune 6/6 · backend tsc 0 · itest **44/44** (stable in isolation across 4 runs — see note) ·
vitest **295/295**. Backend redeployed (f74fedba) + prod smoked (health 200, routes 401-gated,
WS rejects bad token, season query live). prod == main.

**itest timing note:** one transient failure occurred only when all 7 suites ran concurrently
(tsc+vitest compiling under load slowed the real timers past a 3s-deadline / 2s-grace sleep).
In isolation the itest is stable 44/44. Run it NOT concurrently with vitest for reliable timing.

## For the owner's real two-phone build (what code review can't reach)
These client paths are code-reviewed + render-verified but were NOT exercised with two real phones
+ real Apple JWTs (the networked server paths ARE proven by itest 44/44 on identical server code):
1. **HTTP-poll fallback recovery (cl-flow#1):** force a real device onto the poll transport (kill
   the WS) mid-match and confirm the board re-arms + HP snaps after a submit.
2. **Rematch UI under a late rating (cl-result-share#1/#2):** tap Rematch right as the result lands
   on a slow connection; confirm the offer/wait UI survives + the ELO still updates.
3. **Rematch after a real disconnect (be-matchroom#1):** background one phone past the grace, accept
   a rematch, confirm the present player is NOT force-forfeited on turn 1 (the fix; itest 9b proves
   the server logic).
