# OPERATOR.md — Duel sim runbook

Step-by-step terminal walkthrough for running the duel sims against
the production backend. Read this top-to-bottom before running anything.

**Backend target:** `https://awakened-backend.richmondcampano93.workers.dev`
**Production D1:** `awakened-db` (UUID `b9c67e10-c88c-4b71-b1e0-413d1e84a5fa`)
**Canonical repo:** `C:\Users\richm\Documents\repos\awakened-app`

---

## 0 · Pre-flight

Open two PowerShell windows. Confirm both are in canonical (NOT OneDrive):

```powershell
cd C:\Users\richm\Documents\repos\awakened-app
pwd
# expected: C:\Users\richm\Documents\repos\awakened-app
git pull --ff-only origin main
```

Confirm wrangler auth + repo state:

```powershell
cd backend
wrangler whoami
# expected: logged in as richmondcampano93@gmail.com
wrangler d1 list
# expected: row for awakened-db with UUID b9c67e10-...
```

---

## 1 · Seed two test users (one-time per sim batch)

In **Terminal A** (will stay running):

```powershell
cd C:\Users\richm\Documents\repos\awakened-app\backend
npx wrangler dev scripts/seed-sim-users.ts --remote --port 8788
```

Expected output (final lines):

```
⛅️ wrangler 4.x.x
─────────────────
[wrangler:info] Ready on http://localhost:8788
```

Leave this terminal alone — it's hosting the seed Worker.

In **Terminal B**, run the seed call:

```powershell
curl -X POST http://localhost:8788/seed
```

Expected response (one line, formatted here for readability):

```json
{
  "ok": true,
  "alpha": {
    "id": "<uuid>",
    "alias": "sim_alpha",
    "apple_sub": "sim_test_alpha",
    "jwt": "eyJhbGciOi..."
  },
  "bravo": {
    "id": "<uuid>",
    "alias": "sim_bravo",
    "apple_sub": "sim_test_bravo",
    "jwt": "eyJhbGciOi..."
  }
}
```

**Save the JWTs + user IDs to disk** (Terminal B):

```powershell
cd C:\Users\richm\Documents\repos\awakened-app
$resp = (Invoke-WebRequest -Method POST -Uri http://localhost:8788/seed -UseBasicParsing).Content | ConvertFrom-Json
Set-Content -LiteralPath sims/.secrets/alpha.jwt    -Value $resp.alpha.jwt    -NoNewline
Set-Content -LiteralPath sims/.secrets/alpha.userid -Value $resp.alpha.id     -NoNewline
Set-Content -LiteralPath sims/.secrets/bravo.jwt    -Value $resp.bravo.jwt    -NoNewline
Set-Content -LiteralPath sims/.secrets/bravo.userid -Value $resp.bravo.id     -NoNewline
```

Verify:

```powershell
ls sims/.secrets/
# expected: alpha.jwt, alpha.userid, bravo.jwt, bravo.userid
```

If JWTs are already saved from a prior batch, `/seed` is idempotent
— it returns the existing user_ids with freshly-minted JWTs. Re-run
the `Set-Content` lines to refresh.

You can close Terminal A now (`Ctrl+C`) or leave it for teardown later.

---

## 2 · Run one sim (start with 01-steps to verify)

Terminal B:

```powershell
cd C:\Users\richm\Documents\repos\awakened-app
powershell -ExecutionPolicy Bypass -File .\sims\scripts\01-steps-duel.ps1
```

Note: use `powershell` (Windows PowerShell 5.1) — not `pwsh` (PowerShell 7).
The sim scripts are ASCII-only and use no PS7-exclusive syntax (no
ternary, no null-coalescing, no pipeline chains), so they work
identically under both shells. If you do have `pwsh` installed and
prefer it, swap in `pwsh -File .\sims\scripts\01-steps-duel.ps1`.

Expected output (final line):

```
PASS  01-steps-duel  -> C:\...\sims\runs\20260516-220511-01-steps
```

If you see `FAIL` instead, open the per-run dir's `summary.md` to
find which checkpoint missed. Common causes:

- Backend rate limit hit (sleep 60s, retry)
- JWT expired (re-run seed)
- prod backend not reachable (check `Invoke-WebRequest https://awakened-backend.richmondcampano93.workers.dev/`)

---

## 3 · Run the full matrix

```powershell
powershell -ExecutionPolicy Bypass -File .\sims\scripts\run-all.ps1
```

Runs all 6 sims sequentially (01 → 06). Per-run output lands in
`sims/runs/<timestamp>-<label>/`. Final summary printed to console:

```
PASS  01-steps-duel   (12 checks · 4.2s)
PASS  02-sleep-duel   (11 checks · 3.8s)
PASS  03-bedtime-duel (11 checks · 3.9s)
PASS  04-strength     (11 checks · 4.1s)
PASS  05-verified-obj (12 checks · 4.4s)
PASS  06-boss-race    ( 3 checks · 1.1s)

6/6 PASS
```

---

## 4 · Teardown (when done)

In Terminal A (still running the seed Worker), or restart it:

```powershell
cd C:\Users\richm\Documents\repos\awakened-app\backend
npx wrangler dev scripts/seed-sim-users.ts --remote --port 8788
```

Terminal B:

```powershell
Invoke-WebRequest -Method POST -Uri http://localhost:8788/teardown -UseBasicParsing | Select-Object -ExpandProperty Content
```

`/teardown` performs an **explicit, sim-only cleanup**. It walks every
table the sim harness touches and deletes ONLY rows that join back to
the synthetic allowlist (`apple_sub IN {'sim_test_alpha','sim_test_bravo'}`)
or carry a sim-prefixed `client_event_id` (`'sim-alpha-%'` / `'sim-bravo-%'`).
It does NOT rely on `ON DELETE CASCADE` — most child tables (`friends`,
`duels`, `verified_events`, `user_souls_ledger`,
`duel_progress_snapshots`, `user_state_snapshots`) were added without
CASCADE in later migrations, so deleting just the users would leave
orphans.

Deletion order (child rows first, then parent users):

1. `verified_events` — by `user_id IN <sim ids>` OR `client_event_id LIKE 'sim-alpha-%'` / `'sim-bravo-%'`
2. `user_souls_ledger` — by `user_id IN <sim ids>`
3. `duel_progress_snapshots` — by `user_id IN <sim ids>` (legacy Phase 1y)
4. `duels` — by `challenger_user_id` OR `opponent_user_id` in sim ids
5. `friends` — by `requester_user_id` OR `recipient_user_id` in sim ids
6. `user_state_snapshots` — by `user_id IN <sim ids>`
7. `leaderboard_snapshots` — by `user_id IN <sim ids>` (CASCADE-protected, explicit for parity)
8. Sweep orphan `verified_events` by `client_event_id` prefix (defense-in-depth against partial prior teardowns)
9. `users` — by `apple_sub IN <synthetic allowlist>`

Expected response (sample — counts will vary):

```json
{
  "ok": true,
  "before": {
    "users": 2, "friends": 1, "duels": 1, "verified_events": 2,
    "user_souls_ledger": 1, "duel_progress_snapshots": 0,
    "user_state_snapshots": 0, "leaderboard_snapshots": 0
  },
  "after": {
    "users": 0, "friends": 0, "duels": 0, "verified_events": 0,
    "user_souls_ledger": 0, "duel_progress_snapshots": 0,
    "user_state_snapshots": 0, "leaderboard_snapshots": 0
  },
  "deleted": {
    "users": 2, "friends": 1, "duels": 1, "verified_events": 2,
    "user_souls_ledger": 1, "duel_progress_snapshots": 0,
    "user_state_snapshots": 0, "leaderboard_snapshots": 0
  },
  "note": "CLEAN: all sim artifact tables read 0 post-teardown."
}
```

Every value in `after` MUST be 0 and `note` MUST start with "CLEAN:".
If the worker returns a "WARNING" note, inspect the per-table counts
in `after` and follow up with manual SQL via wrangler d1 execute.

### Independent verification (read-only)

```powershell
Invoke-WebRequest -Uri http://localhost:8788/verify -UseBasicParsing | Select-Object -ExpandProperty Content
```

Expected response after a clean teardown:

```json
{
  "ok": true,
  "clean": true,
  "counts": {
    "users": 0, "friends": 0, "duels": 0, "verified_events": 0,
    "user_souls_ledger": 0, "duel_progress_snapshots": 0,
    "user_state_snapshots": 0, "leaderboard_snapshots": 0
  },
  "note": "CLEAN: zero sim artifacts present."
}
```

`/verify` is read-only (no DELETE), safe to call at any point.

### Real-user safety check

To independently confirm the real-user count is unchanged (5 users
across the synthetic allowlist exclusion):

```powershell
cd C:\Users\richm\Documents\repos\awakened-app\backend
wrangler d1 execute awakened-db --remote --command "SELECT COUNT(*) AS n FROM users WHERE apple_sub NOT IN ('sim_test_alpha','sim_test_bravo');"
```

Expected: `"n": 5`. If the count changed, STOP and investigate — the
teardown logic should be incapable of touching real-user rows, so any
drift implies an external cause.

Wipe local secrets:

```powershell
Remove-Item sims/.secrets/*.jwt
Remove-Item sims/.secrets/*.userid
```

Stop the seed Worker (`Ctrl+C` in Terminal A).

---

## Troubleshooting

**"JWT file not found"** → run `/seed` (section 1).

**"DUEL_NOT_ENDED"** on `/resolve` → the verified force-end step
should now catch this BEFORE `/resolve` is called. If the sim still
proceeded to `/resolve` and got DUEL_NOT_ENDED, it means the harness
is out of date — pull latest. Otherwise open
`runs/<ts>/responses/*force-end-*.json` to see whether the SELECT
before, UPDATE, or SELECT after failed; the most common cause is a
wrangler `Authentication error [code: 10000]` (re-run
`wrangler login`).

**"force-end: rows_written > 0" FAILED** → the UPDATE matched 0
rows. Inspect the SELECT-before response to see the actual status
(it may already be `completed`/`cancelled`) or the actual duel id.

**wrangler `Authentication error [code: 10000]`** → the OAuth token
expired or got revoked. Run `wrangler login` and retry the sim from
a fresh seed.

**"DUEL_TYPE_NOT_SCORED_YET"** on `boss_race` is **expected** — that's
the deferred type.

**Worker port already in use** → Kill any stray `wrangler dev` process
(`taskkill /F /IM workerd.exe`) and retry.

**Rate limit hit** (`429` responses) — slow down. The sims hit
`RL_DUELS_WRITE` (6/min per user) and `RL_FRIENDS_WRITE` (10/min)
caps. The bundled `run-all.ps1` already sleeps 75 s between scripts
+ 3 s between the two `/resolve` calls inside a single script, both
of which keep the per-user 60-s sliding window drained. If running
sims by hand, wait 60–75 s between scripts.

**`409` on create duel** ("DUEL_ALREADY_EXISTS_BETWEEN_PAIR" or
similar) — there's an unresolved pending/active duel between the
sim pair from a prior run that didn't reach `/resolve`. Either:
- Re-run the prior script so its duel resolves, or
- Run `POST /teardown` against the seed worker to wipe everything
  and start clean (then re-seed JWTs and resume).

**`400` on submit verified-events** with empty body — the script
sent a malformed batch. Most common cause: a single-element
`@(-1) | ForEach-Object {...}` pipeline auto-unwrapped into a bare
hashtable; wrap the whole pipeline in `@(...)` to force array
context.

### What an aborted run-all looks like (real example, May 16)

First two scripts pass, rest fail in a cascade:

| Run | Status | Diagnosis |
|---|---|---|
| 01-steps | PASS | clean |
| 02-sleep | FAIL (idempotent `/resolve` 429) | back-to-back resolve hit `RL_DUELS_WRITE` cap |
| 03-bedtime | FAIL (create 429) | window still hot from 01+02 |
| 04-strength | FAIL (alpha events 429 + bravo events 400) | rate-limit + the single-element bravo array bug |
| 05-verified-objectives | FAIL (create 409) | 04's strength duel never reached `/resolve`, so it's still active and the same pair can't open a second active duel |
| 06-boss-race | FAIL (create 409) | same active-duel collision |

Fixes shipped 2026-05-16: pacing bumped to 75 s + 3 s, bravo array
bug fixed in `04-strength-duel.ps1`. To recover from this state,
run `POST /teardown` then `POST /seed` again, then `run-all.ps1`.

**JWT expired** (after 90 days) → re-run `/seed`; JWTs are minted fresh.
