# Native HealthKit fix spec — proper multi-source dedup (supersedes the W347/W348 JS interim)

_For the Mac/Xcode session. Spec only — no Swift in this web repo. Status: PROPOSED._

## Why

`_queryStepsInRange` / `_queryFlightsInRange` / `_queryActiveEnergyInRange` (app.js) call the
`@perfood/capacitor-healthkit` plugin's `queryHKitSampleType`, which returns **raw per-source
samples**, then sum them in JS. iPhone + Apple Watch (+ 3rd-party apps) each log samples for the
same activity, so the naive sum double-counts (the **rendiesel** bug: ~15k real → ~30k).

**W347/W348** added a JS interim: dedupe by `sourceBundleId`, prefer the **max single source** when
>1 source. That kills the egregious 2× over-count, but it's an approximation — it slightly
**under-counts** the rare *complementary* case (e.g. phone in the morning, watch in the afternoon,
non-overlapping). The OS already knows the correct merged total; we should ask it directly.

## The fix

Use **`HKStatisticsQuery` with `.cumulativeSum`** instead of summing raw samples. HealthKit's
statistics query performs Apple's own **source de-duplication / merge** (it's exactly what the Health
app shows), handling both the overlap and complementary cases correctly.

### Swift (in the HealthKit plugin — `CapacitorHealthkitPlugin.swift`)

Add a method (e.g. `queryHKitStatistics`) that runs a cumulative-sum query:

```
let type = HKQuantityType.quantityType(forIdentifier: .stepCount)!   // or .flightsClimbed / .activeEnergyBurned
let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
let q = HKStatisticsQuery(quantityType: type,
                          quantitySamplePredicate: predicate,
                          options: .cumulativeSum) { _, stats, _ in
    let total = stats?.sumQuantity()?.doubleValue(for: HKUnit.count()) ?? 0   // .count() / .count() / .kilocalorie()
    // resolve the Capacitor call with { total }
}
healthStore.execute(q)
```

- Unit per metric: steps → `HKUnit.count()`, flights → `HKUnit.count()`, active energy →
  `HKUnit.kilocalorie()`.
- `.cumulativeSum` does the source merge — **do not** also sum samples on top of it.

### JS (app.js) — once the native method exists

Replace the body of `_queryStepsInRange` / `_queryFlightsInRange` / `_queryActiveEnergyInRange` to call
the new statistics method and read its single `total`, e.g.:

```
const result = await p.queryHKitStatistics({ sampleName: 'stepCount', startDate, endDate });
return result && typeof result.total === 'number' ? Math.round(result.total) : null;
```

Then the W347/W348 per-source dedup blocks can be **removed** (the native query supersedes them). Keep
the same null-on-failure contract and the `setStatus('granted')` confirm-on-first-read behavior.

## Packaging note

`@perfood/capacitor-healthkit` is a third-party plugin in `node_modules`, so adding a native method
means either:
1. **`patch-package`** a small addition to the vendored plugin (committed patch), or
2. a tiny **custom Capacitor plugin** exposing just the statistics query, or
3. upstreaming a PR.

Owner's call. Option 1 is the lowest-friction for a single method.

## Verification (on device, with an Apple Watch paired)

1. Walk a known amount with **both** iPhone + Watch active.
2. Compare the app's step total to the **Apple Health app**'s daily total — they should now match
   (statistics query == Health app number).
3. Confirm single-source (iPhone only, Watch off) is unchanged.
4. Re-check flights + active energy the same way.

## Until then

The W347/W348 JS interim is live and safe (single-source unaffected; multi-source no longer 2×). This
native fix is the accuracy upgrade, not an urgent correctness gap.
