# Duel sims — backend smoke test harness

Parametric end-to-end smoke tests for the Verified Duel Scoring Engine
(Phase 1z) and the Tier 1 launch-readiness additions (Phase 1z.1).
Hits the production backend at:

    https://awakened-backend.richmondcampano93.workers.dev

## Folder layout

| Path | Purpose | Tracked |
|---|---|---|
| `sims/scripts/` | curl/PowerShell scripts per duel type | ✅ yes |
| `sims/sql/` | D1 SQL snippets (force ends_at into past, seed teardown) | ✅ yes |
| `sims/.secrets/` | JWTs for the two test users | ❌ gitignored |
| `sims/runs/<timestamp>/` | per-run request/response JSON + markdown summary | ❌ gitignored |
| `sims/README.md` | this file | ✅ yes |

## Test users

Production D1 currently has 5 real Apple-signed users (no test accounts).
Two synthetic test users are seeded via `backend/scripts/seed-sim-users.ts`
(run via `wrangler dev --remote`):

| Alias | apple_sub (synthetic) | Role |
|---|---|---|
| `sim_alpha` | `sim_test_alpha` | challenger |
| `sim_bravo` | `sim_test_bravo` | opponent |

Their `apple_sub` values intentionally do NOT match Apple's real prefix
format (`NNNNNN.<hex>`) so they're trivially distinguishable from real
users in any future audit.

Their JWTs are saved to `sims/.secrets/alpha.jwt` and `.../bravo.jwt`
after the seed script runs. JWTs are HS256, 90-day TTL — re-seed after
they expire.

**Cleanup:** `POST http://localhost:8788/teardown` against the seed
worker performs an explicit, sim-only cleanup of every table the
harness touches (friends, duels, verified_events, user_souls_ledger,
duel_progress_snapshots, user_state_snapshots, leaderboard_snapshots,
users). Most child tables were added in later migrations without
`ON DELETE CASCADE`, so the teardown does NOT rely on cascade — child
rows are deleted explicitly BEFORE the parent users. Response carries
before/after artifact counts; every `after` count MUST be 0. See
`OPERATOR.md` §4 for the full deletion order and verification flow.

## Smoke test matrix

Five scorable duel types from Phase 1z + boss_race deferred. One script
per type lives in `sims/scripts/`:

1. `01-steps-duel.ps1` — steps_total events, MAX(value) aggregation
2. `02-sleep-duel.ps1` — sleep_7h_night events, COUNT DISTINCT metric_date
3. `03-bedtime-duel.ps1` — bedtime_before_midnight events, COUNT DISTINCT metric_date
4. `04-strength-duel.ps1` — strength_workout events, COUNT(*) with uuid dedupe
5. `05-verified-objectives.ps1` — mixed objective events, COUNT DISTINCT (type, date)
6. `06-boss-race-deferred.ps1` — verifies BOSS_RACE_SCORING_DEFERRED is returned

Each script:
1. Creates a friendship between sim_alpha and sim_bravo (idempotent)
2. Creates a duel of the matching type, alpha → bravo
3. Bravo accepts the duel (status → active)
4. Both users submit verified_events via `POST /v1/verified-events`
5. SQL forces `ends_at` 10 seconds into the past
6. Calls `POST /v1/duels/:id/resolve`
7. Verifies the response: status='completed', winner_user_id, result, reward_settled_at
8. Verifies `user_souls_ledger` has the +reward_souls row for the winner
9. Calls `/resolve` a SECOND time to verify idempotency (no double-pay)
10. Writes per-run output to `sims/runs/<timestamp>/<type>/`

## Run output format

Each run directory contains:

- `summary.md` — pass/fail per step, total duration, any unexpected responses
- `requests/` — every HTTP request as a numbered JSON file (no auth headers)
- `responses/` — matching response JSON files
- `sql/` — SQL snippets actually executed (with the duel_id filled in)
- `result.json` — final pass/fail boolean + error if any

JWTs are NEVER written to run output. Auth headers are scrubbed from
requests/. The scripts read JWTs from `sims/.secrets/` at runtime only.

## Running the sims

After test users are seeded:

```powershell
cd C:\Users\richm\Documents\repos\awakened-app
powershell -ExecutionPolicy Bypass -File .\sims\scripts\01-steps-duel.ps1
powershell -ExecutionPolicy Bypass -File .\sims\scripts\02-sleep-duel.ps1
# ... etc
```

Or run all sequentially:

```powershell
powershell -ExecutionPolicy Bypass -File .\sims\scripts\run-all.ps1
```

Scripts are Windows PowerShell 5.1 compatible (ASCII-only, no PS7-
exclusive operators). They work identically under `pwsh` (PowerShell 7+)
if you have it installed.

## Safety rules

- **Never run sims against Richie's real account.** Test users only.
- **Never commit `sims/.secrets/` or `sims/runs/`.** Both gitignored.
- **Never log JWTs in stdout.** Scripts read from `.secrets/` and pass as headers; verify the request capture scrubs Authorization.
- **Tear down test users + all their data when sims are done.** Call `POST http://localhost:8788/teardown` against the seed worker (it must be running via `wrangler dev --remote`). The worker performs the full explicit cleanup and returns before/after counts. Follow up with `GET /verify` for a read-only confirmation.

## Future

- Add a `regression.ps1` wrapper that runs the full matrix and diffs
  outputs against a `sims/baseline/` snapshot. Useful before each train ship.
- Add boss_race scoring once Phase 1z+ activates verified boss events.
- Add outbox resilience sim (offline → enqueue → online → drain → verify backend
  dedup via UNIQUE constraint).
- Add reward ledger idempotency hammer (concurrent /resolve retries).
