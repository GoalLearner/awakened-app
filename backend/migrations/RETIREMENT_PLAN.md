# Duels/PvP Subsystem Retirement Plan

**Phase 1z.279, w160 — Migration / SQL audit report**

This document records the migration audit produced during Phase 5 of
the permanent Duels/PvP retirement (Phases 1-4 already committed:
`7966029` frontend, `9a3bb98` DOM, `b64dc78` backend handlers,
`fc71120` tests). Phase 5 made zero file changes and ran zero SQL.
It defines the contract for the eventual final cleanup migration
that drops the duel-only tables from D1.

**STATUS: AUDIT ONLY. Nothing in this plan has been applied to
production D1. Do not run any of the SQL below without first
verifying the gating signals in the "Transition window" section.**

---

## Migration inventory

| # | File | Touches duels? | Status |
|---:|---|---|---|
| 0001 | `0001_initial.sql` | No | Permanent — core schema |
| 0002 | `0002_user_state_snapshots.sql` | No | Permanent — Cloud Sync |
| **0003** | **`0003_friends_and_duels.sql`** | **Partial** | Partially flaggable (friends half stays) |
| **0004** | **`0004_verified_duel_types.sql`** | **Yes** | Flaggable for future drop |
| **0005** | **`0005_duel_progress_snapshots.sql`** | **Yes** | Flaggable for future drop |
| **0006** | **`0006_verified_duel_scoring_engine.sql`** | **Yes** | Flaggable for future drop |
| 0007 | `0007_user_accolades.sql` | No | Permanent — accolades |
| 0008 | `0008_leaderboard_week_start.sql` | No | Permanent — leaderboard |
| 0009 | `0009_weekly_step_records.sql` | No | Permanent — HoF |
| 0010 | `0010_leaderboard_weekly_sum_source.sql` | No | Permanent — leaderboard |
| **0011** | **`0011_duel_duration_seconds.sql`** | **Yes** | Flaggable for future drop |
| 0012 | `0012_public_profile_summary.sql` | No | Permanent — friend rank badges |
| 0013 | `0013_public_profile_achievements.sql` | No | Permanent — friend feed |
| 0014 | `0014_public_achievement_events.sql` | No | Permanent — friend feed |

5 migrations touch duels (bold). 9 are duel-free and permanent.

**Migration discipline reminder**: SQLite migrations are immutable
once applied. Do NOT edit `0003/0004/0005/0006/0011` in place. The
future cleanup must be a NEW migration file at the next sequential
number.

---

## Per-object analysis

### Tables created by duel migrations

| Object | Created by | Used today by | Drop status |
|---|---|---|---|
| `friends` | 0003 | Friends subsystem (active) | **PERMANENT KEEP** |
| `duels` | 0003 | `handleDuelsResolve` (preserved) | **Hold** until both preserved endpoints removed |
| `duel_progress_snapshots` | 0005 | `getDuelProgress` (called by `handleDuelsResolve`) | **Hold** until `handleDuelsResolve` removed |
| `verified_events` | 0006 | Written by `handleVerifiedEventsSubmit`; read by `getDuelVerifiedScores` / `hasAnyVerifiedEventForDuel` (both inside `handleDuelsResolve`) | **Hold** until both preserved endpoints removed |
| `user_souls_ledger` | 0006 | **ONLY** written by `settleDuelEconomy` and read by `getUserSoulsBalance` — both inside `handleDuelsResolve`. **No non-duel backend code touches this table.** Frontend `hb_souls` localStorage is independent of this. | **Hold** until `handleDuelsResolve` removed |

### Columns added to existing tables

| Object | Added by | Used today by | Drop status |
|---|---|---|---|
| `duels.duel_type` | 0004 | `handleDuelsResolve`, `serializeDuel` | Held with `duels` table |
| `duels.resolved_at` | 0005 | `handleDuelsResolve`, `serializeDuel` | Held with `duels` table |
| `duels.result` | 0005 | `handleDuelsResolve`, `serializeDuel` | Held with `duels` table |
| `duels.reward_settled_at` | 0006 | `settleDuelEconomy`, `serializeDuel` | Held with `duels` table |
| `duels.duration_seconds` | 0011 | `serializeDuel` | Held with `duels` table |

### Indexes (all on duel tables)

- `duels`: `idx_duels_challenger`, `idx_duels_opponent`, `idx_duels_status`, `idx_duels_ends_at`, `idx_duels_type`
- `duel_progress_snapshots`: `idx_duel_progress_duel`, `idx_duel_progress_user`
- `verified_events`: `idx_verified_events_user`, `idx_verified_events_type`, `idx_verified_events_duel`, `idx_verified_events_duel_user`, `idx_verified_events_user_occurred`
- `user_souls_ledger`: `idx_souls_ledger_user`, `idx_souls_ledger_ref`, `uq_souls_ledger_duel_win`

### Critical non-obvious finding

**`user_souls_ledger` is duel-only in the backend.** Despite its
generic-sounding name, every INSERT/SELECT against it in the entire
backend codebase routes through duel code paths (`settleDuelEconomy`
writes, `getUserSoulsBalance` reads). The frontend's souls ledger
lives in `localStorage['hb_souls_ledger']` and is fully independent
of this backend table. So `user_souls_ledger` is safe to drop along
with the other duel tables — it does NOT need to be preserved for
non-duel souls economy.

Verified via comprehensive grep across `backend/src/`:
- `handlers/duels.ts` — sole reader/writer
- `scripts/seed-sim-users.ts` — count queries (will need updating)
- No other handler, no non-script reference

---

## Draft cleanup migration

When transition gating signals fire (see next section), the cleanup
should be a single migration file added at the next sequential
number (likely `0015_drop_duels_subsystem.sql` or later if other
migrations land between now and then):

```sql
-- 0015_drop_duels_subsystem.sql (DRAFT — DO NOT APPLY YET)
--
-- v3 Phase 1z.279 — Final cleanup after Duels permanent retirement.
-- Drops the four duel-only tables and their indexes. Run only when
-- ALL of the following are true:
--
--   1. App Store / TestFlight analytics confirm < 1% of active
--      install base on pre-w160 builds.
--   2. zero `POST /v1/duels/:id/resolve` requests in last 30 days
--      (verify via wrangler tail).
--   3. zero `POST /v1/verified-events` requests with non-zero
--      payload in last 30 days.
--   4. at least 60 days have elapsed since w160 hit App Store.
--   5. duels.ts has been deleted (final code cleanup in same PR).
--   6. POST /v1/duels/:id/resolve and POST /v1/verified-events
--      routes have been removed from index.ts.
--   7. RL_DUELS_WRITE binding removed from env.ts + wrangler.toml.
--   8. seed-sim-users.ts no longer queries verified_events /
--      user_souls_ledger / duel_progress_snapshots (or those refs
--      are guarded for empty/missing tables).

-- duels table + its 5 indexes
DROP INDEX IF EXISTS idx_duels_challenger;
DROP INDEX IF EXISTS idx_duels_opponent;
DROP INDEX IF EXISTS idx_duels_status;
DROP INDEX IF EXISTS idx_duels_ends_at;
DROP INDEX IF EXISTS idx_duels_type;
DROP TABLE IF EXISTS duels;

-- duel_progress_snapshots + its 2 indexes
DROP INDEX IF EXISTS idx_duel_progress_duel;
DROP INDEX IF EXISTS idx_duel_progress_user;
DROP TABLE IF EXISTS duel_progress_snapshots;

-- verified_events + its 5 indexes
DROP INDEX IF EXISTS idx_verified_events_user;
DROP INDEX IF EXISTS idx_verified_events_type;
DROP INDEX IF EXISTS idx_verified_events_duel;
DROP INDEX IF EXISTS idx_verified_events_duel_user;
DROP INDEX IF EXISTS idx_verified_events_user_occurred;
DROP TABLE IF EXISTS verified_events;

-- user_souls_ledger + its 3 indexes
DROP INDEX IF EXISTS idx_souls_ledger_user;
DROP INDEX IF EXISTS idx_souls_ledger_ref;
DROP INDEX IF EXISTS uq_souls_ledger_duel_win;
DROP TABLE IF EXISTS user_souls_ledger;

-- friends table: KEEP. Still in active use by the friends subsystem.
-- Migration 0003 originally created both `friends` and `duels`;
-- the friends half stays.
```

**DO NOT run this migration yet.** It is a draft for a future
cleanup step.

---

## Transition window — gating signals for the final cleanup

Before applying the cleanup migration, all of the following must be
true:

| Signal | How to verify | Status at audit time |
|---|---|---|
| No `POST /v1/duels/:id/resolve` requests in last 30 days | `wrangler tail` log analysis | UNKNOWN — needs monitoring |
| No `POST /v1/verified-events` requests with non-zero queue | Same | UNKNOWN — needs monitoring |
| App Store analytics show < 1% of active install base on pre-w160 builds | App Store Connect → Analytics → App Versions | UNKNOWN — depends on release timing |
| Calendar gate: at least 60 days since w160 hit App Store | Calendar | w160 not yet released at audit time |

**Trigger criterion**: drop the tables once ALL three of (a) zero
traffic to either preserved endpoint for 30 consecutive days, (b)
< 1% of installs on pre-w160 builds, AND (c) at least 60 days since
w160 release have been confirmed.

---

## Ops scripts affected

### `backend/scripts/seed-sim-users.ts`

References `verified_events`, `user_souls_ledger`, and
`duel_progress_snapshots` for sim-user row counts and cleanup. After
the future cleanup migration drops these tables, this script will
need updating (each query against a dropped table will fail with
`D1_ERROR: no such table`).

**Recommendation**: when authoring the future cleanup migration,
update `seed-sim-users.ts` in the same PR to either remove the
duel-table queries or guard them with `try/catch`.

### `backend/scripts/cleanup_contaminated_weekly_leaderboard_2026_05_31.sql`, `sanitize-hk-flags-auto.sql`, `sanitize-hk-flags.sql`

Zero duel references. Permanent keep.

---

## Risk analysis for the future drop

| Risk | Severity | Mitigation |
|---|:-:|---|
| A pre-w160 client calls `/v1/duels/:id/resolve` after table drop → 500 error | Low | Handler returns 500 cleanly via try/catch around D1 ops; client (pre-w160) already swallows errors at the caller (`reconcileDuelSoulsForCompletedDuels`'s `try { resp = await Auth.resolveDuel } catch (_) { resp = null; }` pattern). Worst case: legacy duel never settles for that user — but they've upgraded by then, so the path is dead anyway. |
| A pre-w160 client tries to drain its outbox after table drop → 500 error | Low | Outbox drain handler swallows D1 errors; queue stays full but harmlessly idle until user upgrades to w160+. |
| `user_souls_ledger` turns out to be used somewhere I missed | Critical | Grep'd entire `backend/src` directory; only `handlers/duels.ts` and `scripts/seed-sim-users.ts` reference it. Frontend `hb_souls` is independent. Confidence: HIGH at audit time. Verify again immediately before applying the drop. |
| Schema migration ordering breaks if 0003-0011 are rewritten instead of being supplemented | Critical | DO NOT edit migrations 0003/0004/0005/0006/0011 in place. SQLite migrations are immutable once applied. Add a NEW migration that drops; never modify history. |
| Migration applied to wrong env (local vs remote) | Medium | Use `--local` for dry-runs; only run `--remote` after dry-run succeeds and gating signals are confirmed. |

---

## Final cleanup checklist (future single PR)

When the gating signals fire, do these in one PR:

1. Add new cleanup migration `0015_drop_duels_subsystem.sql` (draft
   above).
2. Delete the entire `backend/src/handlers/duels.ts` file.
3. Remove the two preserved routes + `DUELS_RESOLVE_RE` regex from
   `backend/src/index.ts`.
4. Remove `handleDuelsResolve` and `handleVerifiedEventsSubmit`
   imports from `backend/src/index.ts`.
5. Remove `RL_DUELS_WRITE` binding from `backend/src/env.ts` and
   `backend/wrangler.toml`.
6. Update `backend/scripts/seed-sim-users.ts` to remove the
   duel-table queries.
7. Strip remaining `_classifySoulsEvent` `duel_win` / `duel_loss`
   classifier branches from `app.js` (the legacy ledger row
   handling — by this point all pre-retirement local ledger rows
   will be 60+ days old; safe to drop the special-case rendering).
8. Apply migration:
   ```
   wrangler d1 execute awakened-db --local  --file=migrations/0015_drop_duels_subsystem.sql
   wrangler d1 execute awakened-db --remote --file=migrations/0015_drop_duels_subsystem.sql
   ```
9. Deploy worker.
10. Delete or archive this `RETIREMENT_PLAN.md` document (its job
    is done).

That single future PR completes the Duels retirement at the storage
layer.

---

## References

- Phase 1 commit (frontend): `7966029`
- Phase 2 commit (DOM): `9a3bb98`
- Phase 3 commit (backend handlers): `b64dc78`
- Phase 4 commit (tests): `fc71120`
- Phase 5: this document (no code commit at audit time, though
  this file itself ships as documentation)
- Phase 6: final cross-cut sweep + 3 straggler test stubs
- Final cleanup migration: NOT YET — future PR per checklist above
