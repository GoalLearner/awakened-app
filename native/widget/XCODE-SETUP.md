# Awakened Widget — Xcode setup checklist (one-time, MacBook)

Everything the web app needs is already committed (`app.js` bridge + the Swift
files in this folder). This is the **one-time native wiring** to create the
widget target and turn on the capabilities. After this, the widget updates
automatically on every build — no repeat setup.

**Order matters.** Do the portal work in the browser FIRST, install the
profiles, and only THEN touch Xcode. Adding a capability in Xcode first forces
Xcode to regen a profile via a live call to Apple that has failed before.

Bundle ids used below:
- Main app: `com.goallearner.awakened`
- Widget extension (NEW): `com.goallearner.awakened.AwakenedWidget`
- App Group: `group.com.goallearner.awakened`

---

## Part A — Apple Developer portal (browser first)

1. **App Group** (create once):
   `Certificates, IDs & Profiles → Identifiers → App Groups → +`
   → id `group.com.goallearner.awakened`, description "Awakened Shared".

2. **Main App ID** `com.goallearner.awakened`:
   - Enable **App Groups** → Edit → tick `group.com.goallearner.awakened`.
   - Confirm **HealthKit** is still enabled (it already is).
   - Save.

3. **NEW widget App ID** — `Identifiers → + → App IDs → App`:
   - Description "Awakened Widget", Bundle ID (explicit)
     `com.goallearner.awakened.AwakenedWidget`.
   - Enable **App Groups** (tick the group) **and** **HealthKit**.
   - Save.

4. **Provisioning profiles** (App Store / distribution, against the
   **Jun 10 2027 / LK8FVGBQPL** distribution cert):
   - **Regenerate** the existing "Awakened App Store Manual" profile so it picks
     up the App Groups addition on the main App ID.
   - **Create** a new App Store profile for `...AwakenedWidget`
     (name it e.g. "Awakened Widget App Store Manual").
   - **Download both** and double-click to install.

> Why regen the main profile: adding App Groups to its App ID invalidates the
> old profile. Your NEXT archive of the app must sign with the regenerated one.
> (This does NOT affect any build already in App Review — those are immutable.)

---

## Part B — Xcode (only after the profiles are installed)

5. **Add the widget target:**
   `File → New → Target… → Widget Extension`.
   - Product Name: **AwakenedWidget**
   - Uncheck "Include Configuration App Intent" (this is a StaticConfiguration widget).
   - Uncheck "Include Live Activity".
   - Finish → **Activate** the scheme when prompted.
   - Set the new target's Bundle Identifier to `com.goallearner.awakened.AwakenedWidget`.
   - Set its Deployment Target to match the app (iOS 15+ is fine).

6. **Replace the template source** with the committed files:
   - Delete the auto-generated `AwakenedWidget.swift` / bundle file Xcode made.
   - Drag into the **AwakenedWidget** target (check "Copy items if needed",
     target = AwakenedWidget only):
     - `native/widget/AwakenedWidget.swift`
     - `native/widget/AwakenedWidgetView.swift`
   - Keep the template's generated `Assets.xcassets` + `Info.plist`.

7. **Add the bridge plugin to the MAIN APP target:**
   - Drag `native/bridge/WidgetBridgePlugin.swift` into the **App** target
     (target = App only). Capacitor 6 auto-registers it — no other step.

8. **Capabilities — App target** (`App → Signing & Capabilities`):
   - `+ Capability → App Groups` → tick `group.com.goallearner.awakened`.
   - Verify **HealthKit** is present (already there).
   - Signing: pick the regenerated "Awakened App Store Manual" profile.

9. **Capabilities — AwakenedWidget target**:
   - `+ Capability → App Groups` → tick `group.com.goallearner.awakened`.
   - `+ Capability → HealthKit`.
   - Xcode creates `AwakenedWidgetExtension.entitlements`. Confirm it matches
     `native/widget/AwakenedWidgetExtension.entitlements` (App Group + HealthKit).
   - Signing: pick the new "Awakened Widget App Store Manual" profile.

10. **Widget Info.plist — add the HealthKit usage string** (the extension queries
    HealthKit, so it needs its own):
    - `AwakenedWidget/Info.plist` → add
      `Privacy - Health Share Usage Description`
      (`NSHealthShareUsageDescription`) =
      "Awakened shows your step progress on your home-screen widget."

11. **Build & run** the app scheme once (so the app writes state). Then long-press
    the home screen → **+** → search "Awakened" → add the small widget.

---

## Verify

- Widget shows your streak + rank immediately (from the App Group state the app
  wrote on launch/save).
- Steps ring fills within a refresh cycle. Force it: open the app, do anything
  that saves, background it — the app calls `WidgetCenter.reloadAllTimelines()`.
- If steps show "—": HealthKit read wasn't granted to the extension. Confirm the
  widget target has the HealthKit capability + the usage string, and that Health
  permission was granted in the app.

## Gotchas
- If `window.Capacitor.Plugins.WidgetBridge` is undefined at runtime, the plugin
  file wasn't added to the **App** target (step 7).
- If the tile is blank on iOS 17, the `containerBackground` path in
  `AwakenedWidgetView` handles it — make sure both view files are in the target.
- Every future archive after adding App Groups signs with the **regenerated**
  profile; if signing errors, re-download it (Part A step 4).
