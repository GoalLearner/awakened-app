# native/ — hand-maintained native source (NOT auto-synced)

`ios/` is gitignored (generated on the Mac via `cap add ios`), so native code we
author lives here as the version-controlled source of truth and is copied into
the Xcode project during a one-time setup. `cap sync` does NOT touch these.

## widget/ — W718 Awakened home-screen widget
Small home widget: global Steps-leaderboard position · today's step ring (live
from HealthKit, fills to the day's goal + "GOAL ✓" cue on completion) · rank
badge in its tier color. Game state is written by the app into a shared App
Group; steps are read live inside the extension so the ring never goes stale.

- `AwakenedWidget.swift` — WidgetKit target: bundle, widget, timeline provider,
  HealthKit step query, shared-state loader. → **AwakenedWidget** target.
- `AwakenedWidgetView.swift` — the SwiftUI view + swap-in background layer
  (Phase 2: member card art) + hex-color helper. → **AwakenedWidget** target.
- `AwakenedWidgetExtension.entitlements` — App Group + HealthKit (reference).
- `XCODE-SETUP.md` — **the one-time click-by-click** (browser-first).

## bridge/ — the JS↔native hand-off
- `WidgetBridgePlugin.swift` — Capacitor 6 plugin `WidgetBridge.setState(...)`;
  writes the App Group blob + reloads WidgetKit. → **App** target (main app).

The JS side lives in `app.js` (`_pushWidgetState`, W718) and is a safe no-op on
web / on any build without the plugin — so it ships harmlessly ahead of this
native setup.

### Data contract (App Group `group.com.goallearner.awakened`, key `widgetState`)
```json
{ "lbRank": 6, "stepGoal": 8000, "rankTier": "A", "rankColor": "#ef4444",
  "alias": "Richie", "updatedAt": 1784370000000 }
```
- `lbRank` — the user's DISPLAYED global Steps-board position (0 = unknown; app
  persists it in `hb_lb_step_rank` on every Steps-board render). Board rank can't
  be recomputed off-app, so the widget shows the last-seen value.
- `stepGoal` — today's step goal; the ring fills toward it and tops out at 100%.
- Steps are NOT in the contract — the widget queries HealthKit live for them.

## Phase 2 (later)
- Lock-screen variants (`.accessoryCircular` / `.accessoryRectangular`) — same
  extension + data, new views.
- Member card background painted behind the widget (resized/cached image only —
  never full-bleed art; widget memory budget).
- Co-op hunt countdown (medium family) — add `coopEndsAt` + boss name to the
  contract and a `.systemMedium` view.
