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

- **V6 — bidirectional duplicate friend rows (backend):** **CONFIRMED FALSE ALARM** by read-only
  prod query (2026-06-16): 5 friend rows, **0** bidirectional dups, **0** same-direction dups. The
  `friends` table has `UNIQUE(requester_user_id, recipient_user_id)` enforcing same-direction
  uniqueness at the DB level, and no `(A→B)`+`(B→A)` pairs exist. No schema change made (and none
  warranted) — never blind-apply migrations.
- **V5 `verified_streak`:** left with its `Date.now()` id — re-reaching a band after a break may
  be an intentional re-announce. Verify the seen-marker reset semantics before making it deterministic.
- **V7–V10 — `Array.isArray` guards on `days`/`completions`:** defensive-only; every in-app write
  path writes arrays, so corruption needs external/cloud-restore tampering. Optional hardening, not urgent.

## ✅ CLEAN (round 2)
- **MISC** (achievements / one-time bonuses / state restore) — all idempotency guards confirmed.
- **SOCIAL** — guild-activity dedup, friend-activity authorization (viewer-scoped), event
  attribution (verified-JWT userId), and boss-kill/step-milestone dedupe (deterministic ids) all sound.

---

# Round 3 — 2026-06-16 (onboarding/first-run, day-reset, skins, stats/share-cards)

**Outcome: 0 new autonomous fixes — and that is the valuable result.** Four read-only finder
agents produced 7 confident "high" findings; verification against the real code rejected 3
(one of which would have been catastrophic) and deferred 4 (a dormant, off-limits system).
Plus one deferred round-2 item was completed:

| Item | Verdict | Why |
|---|---|---|
| **W358** `e90d8c7` | ✅ SHIPPED | Completed V5: `verified_streak` event id made deterministic + **source-scoped** (the seen-marker is per-(source,band), so a bare band-only id would have wrongly deduped a real workout-30 *and* sleep-30 into one feed entry). All five PAE ids now deterministic. |
| #1 onboarding XP double-grant | ❌ REJECTED | The +25 grant at `app.js:41750` is guarded by its own persisted flag `hb_onboarding_first_xp_awarded_v1`, checked+set in one synchronous block. The interrupted-onboarding path grants **exactly once**, not twice. Comment documents the intent verbatim. |
| #2 + #3 streaks/completions use PT not device-local | ❌ REJECTED (would have been **catastrophic**) | The agent inverted the comment at `app.js:16014`: it says device-local is for features that are *not* the **"PT-anchored streak day."** Streaks/completions are **intentionally** PT-anchored to align with the PT leaderboard. The "fix" would shift every user's streak boundary up to 7h, break existing streak continuity, and desync from the leaderboard. |
| #4–#7 skins/entitlements (no ownership check, not loaded at init, no invalid-file fallback, silent entitlement-fetch catch) | ⚠️ DEFERRED | The skins IAP is **dormant** (shipped without skins, gated behind `IAP_ENABLED`) → zero live impact (no one can own/equip a premium skin), and the entitlement code is adjacent to the owner's parallel RevenueCat track. Real for when skins go live; not touched autonomously. Logged here. |

Round 3 confirms onboarding idempotency, the (intentional) PT-anchored day model, and stats/share-card
computations are sound; the only real issues are in the dormant, off-limits skins system.

---

---

# Round 4 — 2026-06-16 (combat math, relic effects, drop/pity economy, XP/stat curves)

**1 genuine fix of 9 findings.** The calculation-heavy systems surfaced one real, near-universal
data-integrity bug; the other 8 were verified down to defensive smells, intentional UX, or an
unreachable condition.

| Item | Verdict | Why |
|---|---|---|
| **W359** `6f786cd` | ✅ SHIPPED (high) | `canSellRelic` blocked selling an equipped relic via `isCardEquipped` (the **dead legacy** slot system) instead of `isItemEquippedInBuild` (the **live** Hunter Build). For ~every user the legacy store is empty/stale, so the guard never fired → selling the last copy orphaned the build slot (count:0 card still referenced). Now checks the live build. |
| rare-mercy downgrades mythic → rare (`10668`) | ❌ REJECTED | **Unreachable.** The rare-mercy block is inside the `else` (non-dropTable) branch; mythic is produced **only** by the `cfg.dropTable` path (Erebus), and dropTable bosses run **no pity** (comment, 10630). Mythic never reaches rare-mercy. The agent missed the if/else mutual exclusivity. |
| stat level-up multi-fire / invalid level (`24563`) | ❌ REJECTED | Agent itself says "design-correct for normal progression." The undefined-oldLv case makes the loop condition `NaN<=newLv` false → loop skips safely. `statLevel` is bounded by `while(lv<20)`. No live bug. |
| AI damage-cap formula ≠ actual (`6916`) | ❌ REJECTED | The AI uses a probability-weighted cap for an **expected-value estimate**; actual combat uses the per-turn binary cap. Both are correct for their purpose — an AI heuristic approximation, not a data-integrity bug. |
| rank-division rounding (`17685`) / NaN divisionProgress (`17692`) | ❌ REJECTED | Both low-confidence; agent's own analysis concludes "benign" / "Not NaN" — the `Math.max(1,…)` and clamp guards hold. |
| displayed damage shows 1 when <0.5 (`7160`) | ❌ REJECTED | Intentional UX — never show "0 damage" for a landed hit; HP uses the true fractional value. |
| stat bonus past S+ cap (`18910`) | ❌ REJECTED | Not a bug: `totalPoints` is lifetime XP and **should** keep growing past the last rank threshold; the rank correctly stays S+ and the leaderboard ranks by XP. No double-grant. |
| `statLevel` no final `[1,20]` clamp (`18866`) | ⚠️ DEFERRED | Defensive-only; the `while(lv<20)` loop + `!pts→1` already bound it. No live trigger. A `Math.max(1,Math.min(20,…))` clamp is cheap hardening if desired later. |

---

_10 fixes total across rounds 1–4 (W350–W359). About **25 candidate findings were rejected or
deferred** after verification vs 10 shipped — including two that would have been catastrophic if
applied blindly (the PT→device-local streak rewrite in R3, and a confident "mythic gets downgraded"
that is actually unreachable in R4). The verify-before-fix discipline held on every round. selfTest
stayed 37/37; production read-only; IAP/purchase untouched. A round-5 (migrations / notif / restore /
persistence) is in progress._
