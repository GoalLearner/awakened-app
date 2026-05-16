# QA — Discipline Duels v1 (2-device launch readiness)

This is the precise checklist for the **manual 2-device pass** before the v2.2.1 Duels surface is declared launch-ready. You will need:

- Two iPhones (any model running iOS 16+; iPhone 15/16 Pro Max ideal so HealthKit data flows easily)
- Two Apple IDs (each signed into one of the iPhones)
- A TestFlight install of the latest internal build on each device
- A Mac (or any machine) with `wrangler` configured for the `awakened-backend` Worker + D1 (`awakened-db`)
- Safari + macOS for inspecting `localStorage` via the Web Inspector if needed for `hb_souls`

Device A = challenger. Device B = opponent. Aliases below are placeholders — write the actual ones into the checklist as you go.

---

## 0. Setup

- [ ] Device A: TestFlight install → open Awakened → Sign in with Apple → claim alias **`__ALIAS_A__`**.
- [ ] Device B: same with alias **`__ALIAS_B__`**.
- [ ] Both: grant HealthKit permission when prompted (steps + activity scopes).
- [ ] Both: confirm Status tab shows the claimed alias (pencil icon NOT shown — name is locked).
- [ ] Capture **`hb_souls`** starting value on both devices:
  - On iOS: hard to read without Safari Web Inspector. Optional — read via DevTools when running the same JWT in desktop Safari at https://awakened-app.netlify.app/.
  - Acceptable alternative: take a screenshot of the Status tab's souls badge value. Re-screenshot after every duel resolution and verify the value matches expectations.
- [ ] Both devices: settle on the same backend version (Settings → Account → "Version 2.2.1 (build N)").

---

## 1. Friend handshake

- [ ] Device A → Social tab → tap **+ Add Friend** → type `__ALIAS_B__` → Send.
- [ ] Device B → Social tab → sees incoming friend request → tap **Accept**.
- [ ] Both devices show each other under **Friends**.
- [ ] Optional: from Device B, try the **decline** path on a second test request → confirm it disappears for both sides.
- [ ] Optional: from Device A, remove the friend → confirm it disappears for both sides. **Re-add** before continuing.

---

## 2. Duel creation — all 5 scorable types

For each of the 5 scorable duel types, do the following from Device A:

- [ ] Tap **+ Duel** on the friend row for `__ALIAS_B__`.
- [ ] In the duel-type picker, pick the type from the table below.
- [ ] Confirm the create flow completes — Device A sees an **Outgoing · Pending** card.
- [ ] Device B sees an **Incoming** card with Accept / Decline.
- [ ] Device B taps **Accept** → both devices see an **Active** duel card with timer counting down.

| Type | Label in picker | Server `duel_type` |
|---|---|---|
| Steps | Steps Showdown | `steps` |
| Sleep | Sleep Discipline | `sleep` |
| Bedtime | Lights Out First | `bedtime` |
| Strength | Iron Will | `strength` |
| Verified Objectives | Verified Wins | `verified_objectives` |

Skip — and DO NOT mark launch-ready: **`boss_race`** ("Boss Race"). The scoring engine for that type is deferred. Confirm by attempting to create one: the picker may show the option but the active card renders `"Boss Race scoring activates after verified boss-event logging."` Mark this row "deferred."

---

## 3. Progress submission cadence

For each ACTIVE duel created above, do the following on BOTH devices:

- [ ] Open the app → switch to **Duels** tab. Confirm the active duel card renders without spinning loaders.
- [ ] Tap into the duel → verify the **Score** rows show real values (or "awaiting data" when zero is genuinely correct).
- [ ] Background the app → reopen → confirm progress refreshes within a few seconds.
- [ ] In Settings → Apple Health (or iOS Settings → Health → Data Access → Awakened), confirm permissions are still granted.

**Sanity-check the score endpoint directly** for at least one duel:

```bash
# Replace __DUEL_ID__ + __JWT__. JWT comes from localStorage.hb_user.jwt on
# the device you want to "view as" — read via Safari Web Inspector on a
# desktop browser signed in with the same Apple ID, or just trust the UI.
curl -H "Authorization: Bearer __JWT__" \
  https://awakened-backend.richmondcampano93.workers.dev/v1/duels/__DUEL_ID__/score
```

- [ ] Returns 200 with a per-participant score breakdown that matches the UI.

---

## 4. Forced end-of-duel — the critical SQL fake-end

This is how the tester forces a duel to end without waiting `duration_days`. Run from any machine with `wrangler` configured:

```bash
# In repo root or anywhere; the --remote flag is what makes this hit production.
wrangler d1 execute awakened-db --remote \
  --command="UPDATE duels SET ends_at = datetime('now', '-10 seconds') WHERE id = '__DUEL_ID__';"
```

Then on the device:

- [ ] Reopen the app → switch to Duels tab. The auto-resolve should fire within ~2 seconds.
- [ ] Both devices show a result toast ("You won!" / "You lost." / "Draw.").
- [ ] The duel moves from **Active** to **Past Duels** (or wherever recently-completed duels land).
- [ ] The winning device's `hb_souls` badge **does NOT change** (Phase 1z policy: ledger is server-side, client `hb_souls` is not mutated in v1).

Repeat the fake-end for each of the 5 scorable duel types, with these intentional permutations:

- [ ] Type `steps` — challenger wins (higher step count).
- [ ] Type `steps` — opponent wins.
- [ ] Type `sleep` — challenger never submitted (only opponent has data) → opponent wins by default.
- [ ] Type `bedtime` — both have zero qualifying nights → resolve must be **Draw**, no reward row.
- [ ] Type `strength` — both have at least one qualifying workout → whoever has more wins; ties = Draw.
- [ ] Type `verified_objectives` — at least one of each verified event type → check the result reflects the sum.

**Idempotency:** after each resolve, re-run the `wrangler` UPDATE to push `ends_at` further back, then reopen the Duels tab again. The resolver should **NOT** create a second ledger row. Confirm via the SQL in §5.

---

## 5. Reward ledger SQL verification

After each duel resolution, verify the ledger rows:

```bash
wrangler d1 execute awakened-db --remote \
  --command="SELECT user_id, delta_souls, reason, created_at FROM user_souls_ledger WHERE ref_type='duel' AND ref_id='__DUEL_ID__';"
```

- [ ] **Winner only** — exactly 1 row with `delta_souls = +reward_souls` and `reason = 'duel_win'`.
- [ ] **Loser** — 0 rows for this `ref_id`.
- [ ] **Draw** — 0 rows for this `ref_id`.
- [ ] After re-running the resolve (idempotency check) — still exactly 1 row (UNIQUE constraint protected against duplicate).
- [ ] The `duels` row has `reward_settled_at` non-null for winner-resolved duels; null for draws.

```bash
wrangler d1 execute awakened-db --remote \
  --command="SELECT status, winner_user_id, reward_settled_at FROM duels WHERE id='__DUEL_ID__';"
```

- [ ] Status is `'completed'`. `winner_user_id` is set on a clear winner, null on a draw.

---

## 6. Legacy `duel_progress_snapshots` fallback

Phase 1z's resolver tries `verified_events` first, then falls back to the legacy `duel_progress_snapshots` table for in-flight `steps` duels that were started BEFORE the Phase 1z migration. There are unlikely to be such duels in current data after the production rollout.

- [ ] Look for any active duel with no `verified_events` rows yet — manually inspect with:
  ```bash
  wrangler d1 execute awakened-db --remote \
    --command="SELECT id, duel_type, status FROM duels WHERE status='active';"
  ```
  Then for each:
  ```bash
  wrangler d1 execute awakened-db --remote \
    --command="SELECT COUNT(*) FROM verified_events WHERE duel_id='__DUEL_ID__';"
  ```
- [ ] If a steps-type duel exists with **0 verified_events** AND non-zero `duel_progress_snapshots` rows, force-end it (§4) and confirm the resolver still picks a winner from the legacy snapshots.
- [ ] If no such duel exists in current data, mark this section: **"Skip — no pre-1z fallback row available."**

---

## 7. Outgoing-duel **Cancel** (v3 Phase 1z.1)

- [ ] Device A: create a new duel of any type vs `__ALIAS_B__`. **Do not have Device B accept.**
- [ ] Device A: Outgoing card shows a small ghost-style **Cancel** button next to View.
- [ ] Tap Cancel → confirm prompt → tap OK.
- [ ] Toast: "Duel cancelled."
- [ ] The card disappears from Device A's Outgoing list.
- [ ] Device B: reopen Duels tab → the incoming card is gone. **Opponent can no longer accept** (the option is simply absent from the list).
- [ ] **Race-condition check.** Repeat with timing twist: Device A taps Cancel while Device B's app is foregrounded on the incoming card.
  - [ ] On Device B, if Accept is tapped just after Device A cancelled, the response is a clean error (no orphan active duel). Acceptable toast text: anything that explains the duel is no longer available.
- [ ] **Idempotency.** From Device A, immediately tap Cancel on the (now-gone) card — there should be no such card. If you somehow have a stale UI, tap a second time: the server returns `alreadyCancelled: true` and the toast reads "Duel already cancelled."
- [ ] **Not-cancellable.** Create another duel → have Device B accept → from Device A try to cancel via the API:
  ```bash
  curl -X POST -H "Authorization: Bearer __JWT_A__" \
    https://awakened-backend.richmondcampano93.workers.dev/v1/duels/__DUEL_ID__/cancel
  ```
  Expected: `400 DUEL_NOT_CANCELLABLE`. The UI does not surface a Cancel button on accepted duels — this is just a server-contract sanity check.
- [ ] **Opponent cannot cancel.** Try cancelling a pending duel from Device B's JWT against the same duel:
  ```bash
  curl -X POST -H "Authorization: Bearer __JWT_B__" \
    https://awakened-backend.richmondcampano93.workers.dev/v1/duels/__DUEL_ID__/cancel
  ```
  Expected: `403 FORBIDDEN`.

---

## 8. Verified Event Outbox — offline resilience (v3 Phase 1z.1)

The outbox is invisible in the UI. Verify via Safari Web Inspector + console logs.

- [ ] Device A: enable Airplane Mode (turn off Wi-Fi AND cellular).
- [ ] Walk around, accumulate some steps. Foreground the app → switch to Duels tab → background → foreground a few times to fire submission triggers.
- [ ] In the device console (or via Mac Safari → Develop → connected iPhone → console), look for log lines like `[outbox] drained=0 kept=N` — N should grow as triggers fire offline.
- [ ] Also confirm via Safari Web Inspector: `localStorage.getItem('hb_verified_event_outbox')` returns a JSON array of N events with `client_event_id`, `event_type`, `value`, `queued_at`.
- [ ] Disable Airplane Mode → reopen Duels tab → console log shows `[outbox] drained=X kept=0` (or whatever residual).
- [ ] Backend score for the active duel reflects the drained events (run the curl from §3 again — value should match what the outbox flushed).
- [ ] **No double-counting.** The backend's `UNIQUE(user_id, client_event_id)` should silently dedupe. Force a re-drain by closing/reopening the app while the queue is empty — confirm the score does not double.
- [ ] **Cloud Sync isolation.** Trigger a Cloud Sync backup (Settings → Cloud Backup → "Back up now") while the outbox has events queued. Then on a different device or after `localStorage.clear()`, restore from cloud. Confirm `localStorage.getItem('hb_verified_event_outbox')` is **null or empty** after restore — the outbox is transport state and must NOT travel through Cloud Sync.

---

## 9. Bonus edge cases

- [ ] Force-quit the app mid-duel-action → reopen → no orphan UI.
- [ ] Toggle Settings → Apple Health → Pause auto-verify → ensure duels still fire score submissions (boss/leaderboard rule: passive systems are independent of the habit pause toggle). Confirm via the curl from §3 — the score keeps moving even while paused.
- [ ] Friend-list profanity / collision attempts: try sending a friend request to a non-existent alias → clean error. Try a self-duel via `+ Duel` → clean SELF_DUEL error.
- [ ] Rate limit: rapidly tap Cancel/Accept/Decline → eventually surfaces a `RATE_LIMITED` toast (`RL_DUELS_WRITE` binding). No client crash.

---

## ✅ Launch-ready acceptance criteria

Check ALL of the following before declaring v1 Duels launch-ready:

- [ ] All 5 scorable duel types complete a create → accept → resolve cycle correctly on 2 devices.
- [ ] Reward ledger writes exactly one row per win, zero per loss/draw, never duplicates on re-resolve.
- [ ] `hb_souls` localStorage NEVER mutates as part of duel resolution (Phase 1z policy).
- [ ] Outgoing-cancel works for the challenger; opponent gets 403; accepted duels get 400.
- [ ] Outbox flushes after offline use without double-counting; outbox key absent from Cloud Sync snapshots.
- [ ] `boss_race` correctly shows the deferred message and is NOT marked launch-ready.
- [ ] No crashes, no UI orphans, no silently-failing actions across the full 2-device run.

When this list is fully checked, the Tier 1 launch-readiness pass is complete.

---

## 🏋️ Appendix — Strength Training auto-verify QA (v3 Phase 1z.4)

Standalone Strength-training auto-verify test. Runs on a single device.

**Setup**
1. Open Settings → Apple Health → confirm "Connected" + auto-verify NOT paused.
2. In DevTools / Safari Inspector (or via the in-app Notes modal of Strength training to confirm copy), confirm the habit is in the user's active list.

**Happy path**
1. Open Apple Fitness, Apple Watch, or any iOS app that records workouts (Peloton, Seven, etc).
2. Start a **Traditional Strength Training** or **Functional Strength Training** workout.
3. Train for **at least 10 minutes** (`HEALTHKIT_STRENGTH_MIN_MINUTES`).
4. End + save the workout.
5. Confirm the workout appears in Apple Health → Workouts under today's date.
6. Open Awakened → Habits tab.
7. **Expected:** Strength training card shows SEALED state (gold check + AUTO badge).

**If it doesn't seal — debug path**

Enable verbose HealthKit logging:
```js
localStorage.setItem('hb_debug_healthkit', '1'); location.reload();
```

Then re-open Habits tab and check DevTools / Safari Web Inspector console for `[HK]` and `[HK/autoVerifyStrength]` lines. The logs reveal:
- Whether the HealthKit query window matched today
- Raw sample count returned by the plugin
- The shape of the first sample (especially `workoutActivityType` — is it a string like `'traditionalStrengthTraining'`, a prefixed string like `'HKWorkoutActivityTypeFunctionalStrengthTraining'`, or a NUMBER like `50`?)
- Per-sample filter decisions (`ACCEPT` / `REJECT-DURATION` / `REJECT` with reason)
- The final autoVerifyStrengthTraining gating step that bailed

Common causes (in order of likelihood):
1. **Workout logged as non-strength category** (e.g. "Other", "HIIT", "Core Training"). Re-save in Apple Health under Traditional or Functional Strength Training.
2. **Workout < 10 minutes duration.** `HEALTHKIT_STRENGTH_MIN_MINUTES` is the floor.
3. **Workout not yet synced from Watch.** Open Apple Health app first to force sync; then return to Awakened.
4. **HealthKit permission revoked at iOS level.** Settings → Privacy → Health → Awakened → confirm Workouts permission.
5. **Plugin returns numeric `workoutActivityType` enum value not in the allowlist.** Currently allowlisted numerics: 20 (functional), 50 (traditional). If the debug log shows a different number for what's clearly a strength workout, add it to `STRENGTH_NUMERIC_TYPES` in the Health module.

Turn debug off when done:
```js
localStorage.removeItem('hb_debug_healthkit'); location.reload();
```

**Accepted strength workout types**

The filter (`_isStrengthWorkoutSample`) accepts both string and numeric `workoutActivityType` values:
- Strings (case-insensitive, includes match): `strengthTraining`, `traditionalStrengthTraining`, `functionalStrengthTraining`, `weightTraining`, `resistanceTraining`, prefixed variants like `HKWorkoutActivityTypeFunctionalStrengthTraining`.
- Numerics: 20 (functional), 50 (traditional). HIIT (30), Core Training (21), and other strength-adjacent activities are deliberately excluded — they're not pure strength.


---

## 6. Boss defeat / relic drop QA (v3 Phase 1z.6)

The defeat moment must be visible. Hunt ends after defeat. This is a single-device test — no friend coordination needed.

### Setup

- [ ] Device A: open Awakened → Quests tab → enter the E-Rank dungeon.
- [ ] Engage **The Insomniac** (or any boss you can force-trip via console — Insomniac is simplest).
- [ ] Confirm: HUNTING strip pill shows the boss name + streak progress. Boss card has the gold `bcard--engaged` treatment.
- [ ] Confirm: boss detail overlay shows the **HUNTING SINCE** line + **Stop Hunting** button.

### Force-trip a defeat (console)

```js
// On the Awakened tab, open DevTools / Safari Web Inspector console:
Bosses.evaluateInsomniacForNight(7.5, getDeviceLocalDate());
```

Repeat if `streakTarget > 1` — Insomniac needs 2 consecutive nights with the new device-local dates.

### Verification checklist

- [ ] **Modal fires.** `#boss-result-overlay` appears 600 ms after the kill toast. Header reads "SYSTEM RESULT · BOSS DEFEATED" + boss name in gold Cinzel.
- [ ] **Common drop case:** relic card renders with art (or emoji fallback if 404), slot pill, NEW pill if first-acquisition, stat badges. "View Relic" + "Hunt Again" + "Close" all visible.
- [ ] **No-drop case:** "NO RELIC DROPPED" + 3-row mercy block (Guaranteed relic / Rare mercy / Ultra mercy). View Relic button hidden.
- [ ] **Rare/ultra drop case:** modal does NOT fire — existing cinematic `#reveal-overlay` covers it. (Use `Drops.forceRoll('the_insomniac', 'rare')` to trip a rare without waiting for RNG; confirm no extra modal layers on top.)
- [ ] **One-shot:** close the modal, then re-trigger `Bosses.evaluateInsomniacForNight(...)` for the same kill_count — modal does NOT re-fire. Verify `localStorage.getItem('hb_boss_result_seen_the_insomniac_<N>')` is `'1'`.
- [ ] **HUNTING strip drops the boss.** Status header pill row no longer shows the defeated boss.
- [ ] **Boss card flips.** Dungeon list card loses the `bcard--engaged` gold treatment.
- [ ] **Boss detail flips to HUNT COMPLETE.** Open the boss detail overlay: ENGAGE section now shows the engage CTA with copy `"The Insomniac has been defeated. Engage again to begin a new hunt."` + button labeled `HUNT AGAIN — N SOULS`.
- [ ] **Hunt Again button works.** Tap it: modal closes, souls debit (toast), state.engaged flips back to true, HUNTING strip re-shows the boss, boss card re-engaged.
- [ ] **Tab switch closes modal.** Re-trip a defeat; while modal is visible, tap a different bottom-nav tab. Modal hides immediately.
- [ ] **ESC closes modal.** (Desktop browser test.) Re-trip a defeat; press ESC. Modal hides.
- [ ] **View Relic button.** Tap on a common-drop result: opens `#carddetail-overlay` showing the card art + EQUIP TO BUILD button. Closing carddetail returns user to neutral state (Quests tab).

### Cloud Sync isolation

- [ ] `hb_boss_result_seen_*` keys are NOT in `CloudSync.SNAPSHOT_KEYS`. Verify via:

```js
// Confirm none of the result-seen keys are allowlisted.
Object.keys(localStorage).filter(k => k.startsWith('hb_boss_result_seen_'));
// → array of seen-flags from local testing
// Now: install fresh on a second device + restore. None of those keys should arrive.
```

A reinstall must NOT carry old result-seen flags. If a user reinstalls and re-evaluates a kill, the modal should fire fresh.
