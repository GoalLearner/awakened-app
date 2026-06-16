# Leaderboard / Health-metric data-integrity audit

_2026-06-16. Read-only audit — no behavior changed by this document._

Triggered by two real bugs found this cycle:
- **galilea** — step-submit **LAG** (real steps reached the board ~14h late; others saw 0). Fixed **W346**.
- **rendiesel** — multi-source step **DOUBLE-COUNT** (~15k real read as ~30k). Fixed **W347**.

This audit checks every *other* leaderboard / Health metric for the same two failure modes.

## 1. Multi-source sample-sum double-count (the rendiesel failure mode)

HealthKit returns one sample **per source** (iPhone + Apple Watch + 3rd-party apps). Naively
summing all samples double-counts the overlapping ones for the same activity.

| Metric | Query | Status |
|---|---|---|
| `step_total` (leaderboard) | `_queryStepsInRange` | ✅ FIXED W347 — per-source dedup |
| `flights_climbed` (leaderboard) | `_queryFlightsInRange` | ✅ FIXED W348 |
| `activeEnergyBurned` | `_queryActiveEnergyInRange` | ✅ FIXED W348 |
| sleep duration | `sleepAnalysis` query | ✅ ALREADY SAFE — samples are session-grouped + deduped (app.js ~43205), never a naive sum |
| workout minutes | workout query → `totalMinutes` | ⚠ LOW STAKES — feeds a **threshold** (Iron Warden boss / `workout_streak`: `totalMinutes ≥ 10`), not a ranking sum. A double-count would make the threshold *easier to pass* (minor fairness), NOT inflate a leaderboard rank. Covered by the native fix. |
| `sleep_streak` / `workout_streak` / `bedtime_streak` | derived | ✅ N/A — day-**counts** (consecutive qualifying days), not sums; no double-count vector |

**Net:** every competitive (leaderboard) SUM metric — steps, flights, energy — is now deduped.
Sleep was already deduped. Workout is a threshold (low stakes). **No remaining rank-inflation vector.**

## 2. Submission timeliness (the galilea LAG failure mode)

All metrics submit through ONE wrapper (`lbSubmitAllMetrics` via `lbSubmitAllMetricsDebounced`), so
W346's force-path applies broadly — **but two of W346's triggers are step-specific:**
- the milestone-force fires only on **step** bucket crossings, and
- the foreground catch-up uses `_lbStepsAdvancedSinceSubmit` — **step-gated**.

⚠ So a **non-step** metric that advances **without** a step change (e.g. flights climbed indoors,
active energy from a stationary workout) does NOT break the 5-min throttle on foreground; it waits
for the throttled submit. **Low impact** (flights/energy usually accompany steps) but a real edge.

→ **Recommendation (future, NOT done here):** generalize the advanced-since-submit check to *any*
weekly metric — track a per-metric `last_submitted` map instead of only `hb_lb_last_step_submitted` —
so flights/energy advances also force a timely submit. Left for a deliberate change, not an overnight one.

## 3. Week-boundary handling

✅ **Sound.** Weekly metrics are keyed on the Pacific-Sunday week start (`lbGetCurrentWeekStartPT`),
tagged `client_pacific_week_v1` (trusted), and the backend has a cross-week guard + self-heal.
Galilea's bug was the **lag**, not the week key — her row was on the correct, trusted week.

## Conclusion

Both reported failure modes are addressed for all **competitive** metrics. What remains is either
**low-stakes** (workout threshold) or a **minor timeliness edge** (non-step foreground submit) — both
flagged here for the native `HKStatisticsQuery` fix and a future per-metric submit-advance
generalization. No code was changed by this audit.
