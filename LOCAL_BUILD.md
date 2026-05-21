# Local TestFlight build — MacBook Air + SSD pipeline

The MacBook Air is the canonical local archive/upload machine for Awakened. Codemagic is preserved as a fallback only and **must not be triggered without explicit approval**.

## Machine roles

| Machine | Role |
|---|---|
| **Windows desktop** (ClaudeCode) | Development. Commits + pushes to GitHub. Never builds iOS. |
| **MacBook Air** | Local iOS archive + App Store Connect upload. Pulls from GitHub. |
| **GitHub `origin/main`** | Source of truth between both machines. |
| **Codemagic** | Fallback only. Do not trigger without explicit user approval. |

## Current confirmed-working setup (as of 1z.103)

| Path | Location | Reason |
|---|---|---|
| Xcode.app | Internal Mac disk | Apple signing tools break on external. **Do not move.** |
| Awakened repo | `/Volumes/AwakenedDev/repos/awakened-app` | Frees internal storage. |
| Symlink | `~/Documents/repos/awakened-app` → SSD path | Lets familiar `cd ~/Documents/...` commands still work. |
| Xcode DerivedData | `/Volumes/AwakenedDev/Xcode/DerivedData` | Build artifacts (~2-5 GB per project) off internal. |
| Xcode Archives | `/Volumes/AwakenedDev/Xcode/Archives` | Past archives (~200 MB each) off internal. |
| npm cache | `/Volumes/AwakenedDev/npm-cache` | Off internal. Run once: `npm config set cache /Volumes/AwakenedDev/npm-cache`. |
| node_modules, ios/Pods, www/, ios/App/App/public/ | Inside repo on SSD | Generated artifacts live with the repo. |

**Internal storage state**: ~11 GiB free post-migration. **SSD state**: ~921 GiB free.

## Confirmed-working signing (Release config)

| Field | Value |
|---|---|
| Bundle ID | `com.goallearner.awakened` |
| Team | Richmond Campano |
| Signing | **Manual** (not automatic) |
| Release Provisioning Profile | `Awakened App Store 2026-05-19` |
| Release Signing Certificate | `Apple Distribution: Richmond Campano` |

**Debug signing**: don't worry about it. Debug signing only matters if you Run on a physical iPhone from Xcode (we don't — Archive is the only build that matters). Any Debug-signing warning in Xcode can be ignored.

## Version-train rule (CRITICAL)

**Version `2.2.2` is closed.** App Store Connect rejected build 91 with:

> "This bundle is invalid. The value for key CFBundleShortVersionString [2.2.2] must contain a higher version than that of the previously approved version [2.2.2]."
> "Invalid Pre-Release Train. The train version '2.2.2' is closed for new build submissions."

The next real upload **must** be:

- **Marketing Version**: `2.2.3` or higher (must be strictly greater than the previously approved `2.2.2`)
- **Build Number**: latest TestFlight build + 1 (currently `92+`)

Bump both in:
1. `app.js`'s `APP_VERSION` constant (and possibly `APP_BUILD_TAG`).
2. Xcode App target → General → Identity → Marketing Version + Build.
3. CLAUDE.md handoff knob table.

**Do not bump versions speculatively.** Bump only when ready to upload an actual TestFlight build.

## One-time setup (already done — for reference only)

```bash
# Apple's command-line developer tools
xcode-select --install

# Homebrew (paste from https://brew.sh)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Node + CocoaPods
brew install node cocoapods

# Xcode from the Mac App Store (~12 GB; SKIP iOS Simulator runtimes when prompted)

# xcodeproj Ruby gem (only needed if running scripts/prep-local-build.sh)
sudo gem install xcodeproj

# Apple Developer Apple ID signed in
# Xcode → Settings → Accounts → Add (+)

# SSD relocations
npm config set cache /Volumes/AwakenedDev/npm-cache

# In Xcode → Settings → Locations:
#   Derived Data → Custom → /Volumes/AwakenedDev/Xcode/DerivedData
#   Archives    → Custom → /Volumes/AwakenedDev/Xcode/Archives
```

## Per-build workflow (the actual loop)

### On the Windows desktop (development)

1. ClaudeCode makes code changes.
2. Commit + push to `origin/main`.
3. Tell Richmond when ready to ship a build.

### On the MacBook Air (build + upload)

```bash
# 1. Pull latest
cd /Volumes/AwakenedDev/repos/awakened-app    # or use the ~/Documents symlink
git fetch origin
git pull origin main
git log --oneline -3                          # confirm HEAD matches what's on origin

# 2. Disk check (need ~3 GB free on internal for Xcode caches + ~8 GB on SSD)
df -h /
df -h /Volumes/AwakenedDev

# 3. Install JS deps only if package*.json changed since last build
#    (Cap copy and Xcode don't need this if nothing changed)
npm install --no-audit --no-fund

# 4. REBUILD www/ FROM ROOT SOURCES — CRITICAL.
#    `npx cap copy ios` only copies www/ into ios/App/App/public/.
#    It does NOT pull from the repo root. If www/ is stale, the IPA
#    will ship the new native shell wrapping OLD JavaScript — this
#    is exactly what happened with 2.2.3 build 92 (the IPA reported
#    2.2.3/92 in TestFlight but ran 2.2.2-w15 web code on-device).
#    ALWAYS rebuild www/ before cap copy:
rm -rf www
mkdir -p www
cp index.html app.js styles.css sw.js auth.js simulated-leaderboard.js manifest.json www/
cp icon-192.png icon-512.png app-icon-source.png www/ 2>/dev/null || true
cp -R assets www/assets 2>/dev/null || true
cp -R docs www/docs 2>/dev/null || true
# For the FULL curated asset allowlist (mirrors codemagic.yaml), use
# scripts/prep-local-build.sh instead of the minimal cp lines above.

# 5. Push web assets into the iOS bundle.
#    Use `cap copy ios` for web-only updates (fast; no native dep resolution).
#    Only use `cap sync ios` when native dependencies (Capacitor plugins) change.
npx cap copy ios

# 6. Idempotently ensure HealthKit Info.plist purpose strings are present.
#    Apple rejected 2.2.3 build 91 (ITMS-90683) for missing these keys;
#    build 92 uploaded successfully after they were added. The `ios/`
#    folder is NOT tracked in the GitHub repo, so this script re-applies
#    the Apple-accepted purpose strings every build. Safe + idempotent.
#    (If you're running the full prep flow via prep-local-build.sh
#    instead, you can skip this — that script does the same patch.)
bash scripts/patch-ios-health-plist.sh

# 7. Patch the native iOS AppIcon set with the canonical Awakened icons.
#    `npx cap copy ios` / `cap sync ios` seeds AppIcon.appiconset with
#    Capacitor's default blue icon. Build 93 shipped to a tester's
#    iPhone with that default icon for exactly this reason. The tracked
#    Awakened icons live at resources/ios/AppIcon.appiconset/ (19 PNG
#    sizes + Contents.json, identical to Codemagic's set). This script
#    rm -rfs the default and copies the canonical set in.
bash scripts/patch-ios-app-icon.sh

# 8. VERIFY iOS PUBLIC ASSETS MATCH ROOT SOURCES — DO NOT SKIP.
#    Compares APP_VERSION, APP_BUILD_TAG, app.js?v=, and sw.js
#    CACHE_VERSION between the root sources and ios/App/App/public/.
#    Any mismatch → script exits 1 → DO NOT ARCHIVE. This gate exists
#    specifically because of the 2.2.3 build 92 stale-asset incident.
bash scripts/verify-ios-public-assets.sh

# 9. VERIFY iOS APP ICON IS THE CANONICAL AWAKENED ICON — DO NOT SKIP.
#    Hash-compares the ship-side 1024 marketing icon to the canonical
#    resources/ios/AppIcon.appiconset/AppIcon-1024.png. Mismatch =
#    default Capacitor icon (or other wrong art) is in place → exit 1.
bash scripts/verify-ios-app-icon.sh

# 10. Open Xcode (only if BOTH verify gates passed)
npx cap open ios
```

### In Xcode (GUI archive + upload)

1. **Top destination dropdown** → select **"Any iOS Device (arm64)"**. **NOT** a Simulator. **NOT** Richie's iPhone (that's for Run, not Archive).
2. **App target → Signing & Capabilities** tab → confirm:
   - **Release**: Manual signing, profile `Awakened App Store 2026-05-19`, cert `Apple Distribution: Richmond Campano`.
   - Debug: ignore any warnings here for Archive builds.
3. **App target → General → Identity** → confirm:
   - **Marketing Version**: `2.2.3` (or higher).
   - **Build**: `92` (or latest TestFlight + 1).
4. **Product → Clean Build Folder** (`⇧⌘K`). Recommended before each archive.
5. **Product → Archive**. Takes 5–15 min.
6. When done, **Organizer** opens.
7. Select the new archive → **Distribute App** → **App Store Connect** → **Upload**.
8. Confirm signing — should pre-pick the manual Release profile.
9. Click through prompts → wait for **"Upload Successful"**.
10. App Store Connect ingestion takes 5–15 min. Build appears under TestFlight → iOS Builds.

### Forbidden in this workflow

- ❌ Triggering Codemagic (cost-saving — local is the canonical path now)
- ❌ Selecting a Simulator destination
- ❌ Selecting Richie's iPhone as destination
- ❌ Pressing the Play (▶) button — that's for Run-on-device, not Archive
- ❌ Moving Xcode.app to the SSD
- ❌ Bumping marketing version / build number without explicit user instruction

## Troubleshooting

### Default blue Capacitor app icon on the home screen (the build 93 failure mode)

**Awakened 2.2.3 build 93 shipped to a tester's iPhone with the default blue Capacitor app icon on the home screen** instead of the Awakened gold-triangle-on-navy logo. Symptom: TestFlight installs successfully, the in-app version/build tag fingerprint matches what's on `main`, the web assets are fine — but the home-screen launcher icon is wrong.

**Root cause.** `npx cap copy ios` and `npx cap sync ios` seed `ios/App/App/Assets.xcassets/AppIcon.appiconset/` with Capacitor's default blue icon set. Unless the MacBook explicitly replaces that directory with the tracked Awakened icons, the IPA ships with the default. Codemagic does this replacement step (`codemagic.yaml` line 793-797: `rm -rf ios/App/App/Assets.xcassets/AppIcon.appiconset && cp -R resources/ios/AppIcon.appiconset ios/App/App/Assets.xcassets/`); the lite MacBook flow used to skip it.

**Prevention.** Run `bash scripts/patch-ios-app-icon.sh` after `cap copy` and before opening Xcode. Then run `bash scripts/verify-ios-app-icon.sh` to confirm — it hash-compares the 1024 marketing icon in `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png` against the canonical `resources/ios/AppIcon.appiconset/AppIcon-1024.png` (which is byte-identical to root `app-icon-source.png`). If hashes match, the default Capacitor icon is definitively NOT in place. The `prep-local-build.sh` heavy flow runs both as steps 8b and 11 automatically.

**Recovery if you already uploaded a default-icon build.** Bump the build number in Xcode (e.g. 93 → 94), run the patch + both verify gates, archive, upload. No web/cache knob bump is required for an icon-only correction — `APP_BUILD_TAG`, `app.js?v=`, and `sw.js CACHE_VERSION` can stay at the current values if no web code changed. (Ask before bumping web/cache knobs.)

### Stale web assets inside a fresh native shell (the build 92 failure mode)

**This class of bug uploaded 2.2.3 build 92 with old JS inside.** Symptom: TestFlight shows the new build/version (e.g. `2.2.3 (92)`) and Copy Debug Info inside the running app reports an OLDER build tag (e.g. `2.2.2-w15`). Xcode's `agvtool` / Info.plist controls the native shell version, but the bundled JavaScript bundle lives in `ios/App/App/public/` and is only updated when you (a) refresh `www/` from root sources AND (b) run `npx cap copy ios`. Skipping (a) and only doing (b) is a silent no-op — `cap copy` just copies whatever was already in `www/`.

**Prevention.** Run `bash scripts/verify-ios-public-assets.sh` after every `cap copy` / `cap sync` and before opening Xcode. It compares the four release knobs (`APP_VERSION`, `APP_BUILD_TAG`, `app.js?v=`, `sw.js CACHE_VERSION`) between the root and the iOS public copy. Any mismatch → exit 1 → DO NOT archive.

**Recovery if you already uploaded a stale-asset build.** Bump `APP_BUILD_TAG` (e.g. `-w2`), bump `app.js?v=`, bump `sw.js CACHE_VERSION`, push to `main`, then archive a fresh build (next number — 93 if 92 went out stale) using the full flow with `rm -rf www && <cp commands>` BEFORE `cap copy`. The next build will land with matching native + web versions, and Copy Debug Info will confirm.

### ITMS-90683 "Missing purpose string in Info.plist" — NSHealthShareUsageDescription / NSHealthUpdateUsageDescription

**This rejected Awakened 2.2.3 build 91 (May 20, 2026).** App Store Connect responded with:

> "ITMS-90683: Missing purpose string in Info.plist. Apps that collect or transmit user data must clearly disclose the use of such data. Add the NSHealthShareUsageDescription / NSHealthUpdateUsageDescription keys to your app's Info.plist file."

**Root cause.** The desktop GitHub repo does NOT track the generated `ios/` folder. Each MacBook build runs `npx cap copy ios` (or `cap sync ios` on a fresh checkout) which regenerates `ios/App/App/Info.plist` from the Capacitor template. The template does NOT include HealthKit purpose strings — they must be re-applied before every archive.

**Fix.** Run the tracked patch script from the repo root before opening Xcode:

```bash
bash scripts/patch-ios-health-plist.sh
```

It idempotently writes both keys with the Apple-accepted text below (the same strings that landed 2.2.3 build 92 successfully). The full `scripts/prep-local-build.sh` runs the same patch as step 7 of its prep flow, so either path works — but the standalone `patch-ios-health-plist.sh` is the lighter call for the day-to-day archive loop.

**Apple-accepted purpose strings (do not modify casually):**

- `NSHealthShareUsageDescription` — "Awakened reads selected Apple Health data, such as steps, sleep, and workouts, to verify habit completion and personalize your progress."
- `NSHealthUpdateUsageDescription` — "Awakened may request Health access through its HealthKit integration. Health data is used only to support habit verification and progress tracking."

If you ever need to change this copy, sync BOTH `scripts/patch-ios-health-plist.sh` AND `scripts/prep-local-build.sh` (step 7) so the two scripts cannot drift, and update the doc above.

### "This bundle is invalid... train version 'X.Y.Z' is closed"

The marketing version you uploaded is equal to or less than the previously approved version. Bump `APP_VERSION` in `app.js`, Marketing Version in Xcode, push to GitHub, pull on MacBook, archive again.

### "Provisioning profile doesn't include the com.apple.developer.applesignin entitlement"

Apple's automatic provisioning sometimes drops this. Fix by switching to manual signing with the known-good profile `Awakened App Store 2026-05-19`:

1. Xcode → App target → Signing & Capabilities → **uncheck** "Automatically manage signing" for Release.
2. **Release** row → Provisioning Profile → select `Awakened App Store 2026-05-19`.
3. If the profile isn't listed: developer.apple.com → Profiles → download → drag onto Xcode Dock icon.

### "No Apple Distribution certificate installed"

Xcode → Settings → Accounts → Apple ID → "Manage Certificates…" → `+` → "Apple Distribution". Xcode generates a CSR, posts to Apple, downloads the cert with private key into login Keychain.

### "Build number already used"

Increment the build number in Xcode → App target → General → Identity → Build. App Store Connect rejects duplicates within the same marketing version.

### Disk space ran out mid-archive

Xcode's DerivedData should be on the SSD (per the setup above), so this shouldn't happen on internal. If it does, run:

```bash
rm -rf /Volumes/AwakenedDev/Xcode/DerivedData/*
```

Safe — Xcode regenerates on next build.

### "Debug signing failed but Release succeeded"

Ignore. Debug signing only matters for Run-on-physical-iPhone. Archive uses Release exclusively.

### `npx cap copy ios` vs `npx cap sync ios`

- **`cap copy ios`** — fast, just copies `www/` into `ios/App/App/public/`. Use for code-only changes.
- **`cap sync ios`** — also runs `pod install` to resolve native deps. Slow (~2-5 min). Only needed when:
  - A Capacitor plugin was added/updated in `package.json`.
  - First-ever build on this machine.
  - Native iOS config changed (rare).

## Eject the SSD properly

Before unplugging:
1. Quit Xcode + any process touching the SSD.
2. Finder sidebar → click the eject icon next to `AwakenedDev`.
3. Wait for the volume to disappear.
4. Unplug.

If you unplug without ejecting, the next mount may need Disk Utility's "First Aid" to repair.

## What the prep script does (`scripts/prep-local-build.sh`)

Mirrors `codemagic.yaml`'s nine prep steps in one command. Use it if you want curated www/ assembly + entitlements wiring done deterministically:

1. Copies the curated www/ asset allowlist (excludes 16 MB of `*-source.png` masters, includes only optimized 192×192 PNGs).
2. Wipes `ios/App/App/public/*` before sync.
3. `npx cap sync ios` (full sync — use `cap copy` instead for web-only updates).
4. Bumps Podfile + project.pbxproj IPHONEOS_DEPLOYMENT_TARGET to 14.0.
5. `pod install`.
6. Sets `ITSAppUsesNonExemptEncryption=false` in Info.plist.
7. Sets HealthKit usage descriptions + entitlement.
8. Sets Sign in with Apple entitlement.
9. Wires `CODE_SIGN_ENTITLEMENTS = App/App.entitlements` via the xcodeproj Ruby gem.

Optional positional arg: build number to set via agvtool. Example:

```bash
bash scripts/prep-local-build.sh 92
```

The script does NOT handle signing — Xcode's GUI does that more reliably than scripting.

## Codemagic fallback (do not use without approval)

`codemagic.yaml` remains in the repo as a safety net. If local archives ever stop working (Xcode bug, cert revocation, etc.) and you need to ship urgently, Codemagic can produce a build at ~$0.40 per run.

**Do not trigger Codemagic without explicit approval from Richie.** Cost was the reason for migrating off it.
