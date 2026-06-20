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
