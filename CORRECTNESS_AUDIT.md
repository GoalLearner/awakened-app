# Correctness / data-integrity audit — 2026-06-16

A 7-system read-only audit (souls, bosses, XP/rank, habits/streaks, notifications,
date/time, ascent), each finding **independently verified against the real code**
before any change. Same discipline as the leaderboard/sync review the day before:
verify first — confident audit findings are often wrong.

## ✅ FIXED (verified genuine, logic-tested, committed)

| Audit | Commit | Fix |
|---|---|---|
| **G2 + G8** souls | W350 `4ce2ab0` | `spendSouls` can't drive the balance negative; `loadSouls` clamps a corrupted negative balance. Defensive — no live-behavior change (callers pre-check). |
| **G3** notifications | W351 `06c9b87` | Permission-recovery called `rescheduleAll()` with no args → threw on `habitsList.find` → the `catch` skipped `reapply*`, so reminders didn't re-arm until next cold-open. Now passes `(habits, today, completions[today]||[])`. |
| **G4 + G9** ascent | W352 `1e5b808` | `arenaFinalizeBattle` persists wins/losses then runs a throwable title step; on throw, `_finalized` stayed unset → re-finalize double-counted records (forfeit dropped the loss). Made the title step non-throwing → finalize completes once. |
| **G6** flights (time) | W353 `4c6dad2` | Weekly flights backfill used the device-local week but the sum uses the PT week → non-PT users near the Sun-midnight-PT boundary understated flights. Now mirrors `lbSumCurrentWeekSteps` (PT week, always includes today). |

## ❌ REJECTED on verification (confident audit findings that were wrong)

- **G1 — boss "double-kill" (rated CRITICAL):** `_clearBossHuntFields` already sets
  `engaged=false`, and `_awardHuntKillFromBackfill` re-reads state and guards on
  `engaged!==true` — the normal double-award is already blocked. The proposed
  `last_eval_date===dayDate` guard would **regress** a legitimate same-day
  re-engage-and-rekill. Residual async-race is theoretical and unaddressed by that fix.
- **G5 — perfect-streak resurrect via uncheck (rated HIGH/"exploitable"):** the stale
  `count` after complete-then-uncheck is **masked everywhere it matters** — display gates
  on `lastDate===today||yesterday` (shows 0), milestones use the fresh count, and the
  next completion resets based on `lastDate`. Never a wrong displayed streak. Not a bug.

## ⚠️ DEFERRED (genuine but needs a supervised/careful fix — NOT shipped autonomously)

- **G7 — weekly-reset notification fire time** (`app.js` ~16911): a PT calendar date is
  fed into a device-local `new Date(y,m,d)`, so for non-PT users the Saturday-passed
  check can mis-fire the weekly-reset reminder by a day. REAL, but the correct fix needs
  DST-aware PT-instant math (the naive `-07:00` hardcode is wrong in PST) **and** an
  on-device notification-timing test. Left for a deliberate fix.
- **N1 — daily digest ignores quiet hours** (`setDailyDigest`): the digest fires even
  inside quiet hours, unlike its 3 sibling schedulers. But the digest time is **explicitly
  user-chosen** (like per-habit reminders, which are allowed to land in quiet hours), so
  honoring it may be intended. This is a **product decision**, not a clear bug — owner's call.

## ✅ CLEAN (no genuine bug found)

- **XP / RANK / STATS** — all award paths double-guarded (Sets + per-day date keys),
  all subtractions `Math.max(0,…)`, RANKS/`getRank` correct, loads `parseInt(…)||0`.
- **Leaderboard / sync / backend** (prior review) — upsert branches, read handlers,
  accolade/champion awards (idempotent), guest adoption, CloudSync (confirm-gated) all sound.
- Boss single-day evaluators (Iron Warden/Glass Strider/Dream Tyrant/etc.) already carry
  `last_eval_date` guards; daily-login bonus is idempotent; ascent floor double-advance is
  blocked by `> highestCleared`.

---

# Round 2 — 2026-06-16 (drops/inventory, habits CRUD, social/guild, achievements)

## ✅ FIXED (verified, logic-tested, committed)

| Audit | Commit | Fix |
|---|---|---|
| **V1** drops | W354 `0287493` | A mythic drop matched no branch in `resetDropPityAfterDrop` → pity counters never reset → skewed every later drop-rate/hard-pity calc for that boss. Mythic now resets all three (joins the ultra_rare branch). |
| **V2 + V3** souls | W355 `394d255` | Completes W350: `spendSouls` now returns a bool and `buyRelic` + boss-engage abort the grant if the charge fails (enforces the "never grant before charging" invariant that W350's silent no-op had quietly broken). |
| **V4** habits | W356 `57838ad` | `deleteHabit` now removes the orphaned `habitNotes[id]` (was leaking into `hb_notes`). |
| **V5** social | W357 `42d4361` | Four public-event ids carried a `Date.now()` suffix → a crash before the seen-marker re-emitted with a new id → backend UNIQUE didn't dedup → friend feed showed it twice. Made them deterministic (match their eventKey), like `boss_kill`/`step_milestone_bucket`. |

## ❌ REJECTED / ⚠️ DEFERRED

- **V6 — bidirectional duplicate friend rows (backend):** leaning FALSE-ALARM (Cloudflare D1
  serializes writes per DB; the read-check-insert is sequential awaits). A fix would be a D1
  schema migration — **NOT touched** (never blind-apply migrations). Verify-by-query first.
- **V5 `verified_streak`:** left with its `Date.now()` id — re-reaching a band after a break may
  be an intentional re-announce. Verify the seen-marker reset semantics before making it deterministic.
- **V7–V10 — `Array.isArray` guards on `days`/`completions`:** defensive-only; every in-app write
  path writes arrays, so corruption needs external/cloud-restore tampering. Optional hardening, not urgent.

## ✅ CLEAN (round 2)
- **MISC** (achievements / one-time bonuses / state restore) — all idempotency guards confirmed.
- **SOCIAL** — guild-activity dedup, friend-activity authorization (viewer-scoped), event
  attribution (verified-JWT userId), and boss-kill/step-milestone dedupe (deterministic ids) all sound.

_8 fixes total across both rounds (W350–W357). selfTest stayed 37/37 throughout; production read-only; IAP/purchase untouched._
