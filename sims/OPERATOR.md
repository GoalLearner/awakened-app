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
pwsh sims/scripts/01-steps-duel.ps1
```

Expected output (final line):

```
PASS  01-steps-duel  → C:\...\sims\runs\20260516-220511-01-steps
```

If you see `FAIL` instead, open the per-run dir's `summary.md` to
find which checkpoint missed. Common causes:

- Backend rate limit hit (sleep 60s, retry)
- JWT expired (re-run seed)
- prod backend not reachable (check `Invoke-WebRequest https://awakened-backend.richmondcampano93.workers.dev/`)

---

## 3 · Run the full matrix

```powershell
pwsh sims/scripts/run-all.ps1
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
curl -X POST http://localhost:8788/teardown
```

Expected:

```json
{ "ok": true, "deleted_users": 2 }
```

This deletes `sim_alpha` + `sim_bravo` rows. Foreign-key CASCADE
wipes friends + duels + verified_events + user_souls_ledger +
user_state_snapshots + leaderboard_snapshots rows for those users
automatically.

Verify the teardown:

```powershell
curl http://localhost:8788/whoami
# expected: { "ok": true, "users": [] }
```

Wipe local secrets:

```powershell
Remove-Item sims/.secrets/*.jwt
Remove-Item sims/.secrets/*.userid
```

Stop the seed Worker (`Ctrl+C` in Terminal A).

---

## Troubleshooting

**"JWT file not found"** → run `/seed` (section 1).

**"DUEL_NOT_ENDED"** → the `force-ends-at-past.sql` step didn't run
or didn't match the duel id. Re-check the SQL in the run's `sql/`
directory matches the duel ID from the response.

**"DUEL_TYPE_NOT_SCORED_YET"** on `boss_race` is **expected** — that's
the deferred type.

**Worker port already in use** → Kill any stray `wrangler dev` process
(`taskkill /F /IM workerd.exe`) and retry.

**Rate limit hit** (`429` responses) — slow down. The sims hit
`RL_DUELS_WRITE` (6/min) and `RL_FRIENDS_WRITE` (10/min) caps.
Wait 60s between full-matrix runs.

**JWT expired** (after 90 days) → re-run `/seed`; JWTs are minted fresh.
