# native/ — hand-maintained native source (NOT auto-synced)

`ios/` is gitignored (generated on the Mac via `cap add ios`), so native code we
author lives here as the version-controlled source of truth and is copied into
the Xcode project during a one-time setup. `cap sync` does NOT touch these.

## widget/ — W718 Awakened home-screen widget
Small home widget: global Steps-leaderboard position (in the tier color) above
today's step ring (live from HealthKit, fills to the day's goal + "GOAL ✓" cue
on completion). Minimal by request — no letter badge, no trophy; the rank tier
color rides on the `#N` number + ring. Game state is written by the app into a
shared App Group; steps are read live inside the extension so the ring never
goes stale.

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

## readyhunt/ — W1046 the Ready Hunt, on the phone
- `ReadyHuntWatcher.swift` — woken by Apple Health in the background (HealthKit background
  delivery, hourly at best, only while the phone is unlocked), reads today's steps, flights and
  last night's sleep the way `app.js` does, and posts ONE local notification, "A hunt is ready".
  → **App** target (main app).

Unlike the widget and the bridge, this one installs itself: `scripts/prep-local-build.sh`
step 8d copies the file into `ios/App/App/`, adds it to the App target, puts one call at the top
of `application(_:didFinishLaunchingWithOptions:)`, and adds the
`com.apple.developer.healthkit.background-delivery` entitlement. No Xcode clicks.

- **Signing.** Under manual signing, an entitlement the provisioning profile lacks fails the
  Archive. So the script reads the installed profiles and writes the entitlement only when one
  for `com.goallearner.awakened` carries it. If none does, the watcher is installed but asleep
  (iOS never wakes it) and the script prints what to do: re-save and re-download the
  "Awakened App Store Manual" profile, then run the script again.
- **If an archive ever fails on this file:** run the prep step with `READY_HUNT_BG=0` in front.
  It takes all of it out and the app is what it was before.
- **A background wake does not start the web app.** iOS builds the web view on every wake, so
  `app.js` holds its boot while the page is hidden (see "A LAUNCH NOBODY CAN SEE" at the end of
  the file). Without that, every wake would ping app-open, seal vows and sync, and the activity
  numbers would count hunters who never opened the app.

No plugin and no bridge. `app.js` (`_rhWatchSync`, W1046) writes the list of hunts the watcher
may announce to `Library/ready-hunt-watch.json` through `@capacitor/filesystem`, and the watcher
reads that file. The tap is routed by `@capacitor/local-notifications`, because the notification
carries the same `cap_extra` that plugin writes (`{ kind: "hunt", bossId }`); `app.js`
(`_notifOpenHunt`) then looks again and raises the Ready Hunt sheet.

### Data contract (`Library/ready-hunt-watch.json`)
```json
{ "v": 1, "on": true, "at": 1791850000000, "pausedUntil": 0,
  "quiet": { "start": "22:00", "end": "07:00" }, "hold": "",
  "seenDay": "2026-10-12", "seen": ["the_carouser"],
  "hunts": [ { "id": "the_steel_wolf", "name": "The Steel Wolf", "metric": "steps",
               "bar": 6000, "beaten": "2026-10-11", "until": 0 } ] }
```
- `on` — Apple Health granted, notifications not switched off in the app, not in onboarding.
- `at` — when the app last wrote it. Older than 7 days: the watcher says nothing.
- `pausedUntil`, `quiet` — the hunter's own notification settings.
- `hold` — a day on which nothing is announced (a hunter's first day, after the first kill).
- `seenDay` / `seen` — bosses the in-app sheet already announced that day.
- `hunts` — one-number, one-day solo bosses the hunter's rank and souls can start.
  `beaten` = the day it was last beaten; `until` = when a running hunt ends (ms), else 0.

Its own rules: at most 3 notifications a day, at least 2 hours apart, never while the app is
open, one boss announced once a day. Manual Health entries never count (W799).

**Keep in step with `app.js`:** `ReadyHuntMath.total` = `_totalFromHealthSamples`,
`ReadyHuntMath.sleepHours` = `getSleepBetween`. A change to either rule in one file is a change
in both. The watcher only announces; the app checks again before it offers a strike.

## Phase 2 (later)
- Lock-screen variants (`.accessoryCircular` / `.accessoryRectangular`) — same
  extension + data, new views.
- Member card background painted behind the widget (resized/cached image only —
  never full-bleed art; widget memory budget).
- Co-op hunt countdown (medium family) — add `coopEndsAt` + boss name to the
  contract and a `.systemMedium` view.
