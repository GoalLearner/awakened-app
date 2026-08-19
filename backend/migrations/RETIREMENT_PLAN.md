# Duels/PvP Subsystem Retirement Plan — REVISED W820

**⚠️ THIS PLAN WAS REWRITTEN 2026-08-20 (W820, Train 1 "Honest Rails" C1).**
The original Phase-1z.279 draft (authored at w160, when `verified_events`
was duel-only) had become **catastrophically unsafe to execute**: three of
its steps would destroy live production systems that were built ON TOP of
the "retired" tables after the draft was written. If you are reading this
to perform the final cleanup, use ONLY the revised sections below. The
original draft SQL has been removed so it can never be pasted by accident.

---

## What changed since the original audit (why the old plan was dangerous)

| Original claim (w160) | Reality today (w820) |
|---|---|
| `verified_events` is "written by `handleVerifiedEventsSubmit`; read by duel code" → droppable | **`verified_events` is the LIVE co-op raid progress transport.** Migration `0020_verified_events_boss_instance.sql` added `boss_instance_id`; `handlers/coop-boss.ts` aggregates hunt progress from it (~lines 324/344); the client posts steps/flights/sleep totals to `POST /v1/verified-events` on every co-op sync (`app.js` `_coopSubmitMySteps`). **Dropping it destroys every active hunt. PERMANENT KEEP.** |
| Gating signal: "zero `POST /v1/verified-events` in 30 days" | **Can never fire** — that endpoint is now the primary co-op transport. Removed. |
| Checklist: "Remove `RL_DUELS_WRITE` from env.ts + wrangler.toml" | **`RL_DUELS_WRITE` is reused by ranked PvP** (create/join/find/rematch — see `wrangler.toml` ~line 171). Removing it breaks PvP. **KEEP the binding**; optionally rename in a dedicated change. |
| `handleVerifiedEventsSubmit` removed with duels.ts | **KEEP** — it serves co-op. Only `handleDuelsResolve` + the `/v1/duels/:id/resolve` route + `duels.ts` internals are retireable. |

Unchanged and still true: `duels`, `duel_progress_snapshots`, and
`user_souls_ledger` are duel-only and remain droppable; `friends` is
permanent; migrations 0003/0004/0005/0006/0011 are immutable — cleanup
must be a NEW migration at the next sequential number.

---

## Revised droppable set

| Object | Status |
|---|---|
| `duels` (+ 5 `idx_duels_*` indexes, all columns) | Droppable once `handleDuelsResolve` + route are removed |
| `duel_progress_snapshots` (+ 2 indexes) | Droppable (only reader is `getDuelProgress` inside `handleDuelsResolve`) |
| `user_souls_ledger` (+ 3 indexes) | Droppable — verified duel-only; frontend `hb_souls_ledger` is independent. **Re-verify by grep immediately before applying.** |
| `verified_events` | **PERMANENT KEEP** (live co-op transport). Optionally drop ONLY the two duel-specific indexes `idx_verified_events_duel`, `idx_verified_events_duel_user` — the `duel_id` column itself stays (immutable history; harmless NULLs). |
| `friends` | PERMANENT KEEP |

## Revised draft cleanup migration

```sql
-- 00XX_drop_duels_subsystem.sql (DRAFT — DO NOT APPLY without the gates below)
-- W820 revision: verified_events is EXCLUDED — it is the live co-op raid
-- progress store (see 0020). Only the three duel-only tables drop.

DROP INDEX IF EXISTS idx_duels_challenger;
DROP INDEX IF EXISTS idx_duels_opponent;
DROP INDEX IF EXISTS idx_duels_status;
DROP INDEX IF EXISTS idx_duels_ends_at;
DROP INDEX IF EXISTS idx_duels_type;
DROP TABLE IF EXISTS duels;

DROP INDEX IF EXISTS idx_duel_progress_duel;
DROP INDEX IF EXISTS idx_duel_progress_user;
DROP TABLE IF EXISTS duel_progress_snapshots;

DROP INDEX IF EXISTS idx_souls_ledger_user;
DROP INDEX IF EXISTS idx_souls_ledger_ref;
DROP INDEX IF EXISTS uq_souls_ledger_duel_win;
DROP TABLE IF EXISTS user_souls_ledger;

-- Optional (safe either way): duel-specific indexes on the KEPT
-- verified_events table. The table and its other indexes MUST remain.
DROP INDEX IF EXISTS idx_verified_events_duel;
DROP INDEX IF EXISTS idx_verified_events_duel_user;

-- DO NOT ADD: DROP TABLE verified_events  ← live co-op raid data (0019/0020)
-- DO NOT ADD: anything touching friends
```

## Revised gating signals

1. Zero `POST /v1/duels/:id/resolve` requests in 30 consecutive days
   (`wrangler tail` or check-annotations).
2. < 1% of active installs on pre-w160 builds (App Store Connect →
   Analytics → App Versions).
3. ≥ 60 days since w160 hit the App Store. *(Long since satisfied —
   w160 shipped in the 2.2.5 era; signals 1-2 still require checking.)*

## Revised final-cleanup checklist (one PR)

1. New migration per the revised draft above (next sequential number).
2. Delete `handleDuelsResolve` and the duel-only internals from
   `backend/src/handlers/duels.ts`. **KEEP `handleVerifiedEventsSubmit`**
   (move it to its own module, e.g. `verified-events.ts`, in the same PR).
3. Remove the `/v1/duels/:id/resolve` route + `DUELS_RESOLVE_RE` from
   `index.ts`. **KEEP the `/v1/verified-events` route.**
4. **KEEP `RL_DUELS_WRITE`** (ranked PvP uses it). Optional follow-up:
   rename to `RL_PVP_LEGACY_WRITE` in a dedicated change with its own test.
5. Update `seed-sim-users.ts`: remove/guard queries against the three
   dropped tables; its `verified_events` queries may stay.
6. Strip `_classifySoulsEvent` `duel_win`/`duel_loss` branches in `app.js`.
7. Dry-run `--local`, then `--remote`, then deploy the worker.
8. Archive this document.

---

*Historical context (original w160 inventory, post-deploy fix-ups, and risk
analysis) is preserved in git history — `git show fc71120^:backend/migrations/RETIREMENT_PLAN.md`
region — and intentionally not reproduced here so stale SQL cannot be copied.*
