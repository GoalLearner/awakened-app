# Local TestFlight build (no Codemagic)

Run this on the MacBook to produce a TestFlight build without paying for Codemagic.
Mirrors `codemagic.yaml` as exactly as practical. Idempotent.

## One-time setup (do once, ever)

```bash
# Install Apple's command-line developer tools
xcode-select --install

# Install Homebrew (paste from https://brew.sh)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Node + CocoaPods
brew install node cocoapods

# Install Xcode (from Mac App Store; ~12 GB; SKIP iOS Simulator runtimes when prompted)

# Install xcodeproj Ruby gem (used by the prep script)
sudo gem install xcodeproj

# Sign in to Xcode with your Apple Developer Apple ID
# Xcode → Settings → Accounts → Add (+)
```

## Sign-in verification

In Xcode → Settings → Accounts → click your Apple ID → "Manage Certificates…"
You need at least:
- **Apple Distribution** certificate

If absent: click `+` in the manage-certificates sheet → "Apple Distribution". Xcode generates the CSR, posts to Apple, and downloads the cert + private key into your login Keychain — same effect as the manual cert dance.

## Per-build workflow

```bash
# 1. Pull latest
cd ~/Documents/repos/awakened-app    # or wherever your local repo lives
git fetch origin
git pull origin main
git log --oneline -3                  # confirm HEAD is what you expect

# 2. Check disk space (need ~8 GB free for archive + DerivedData)
df -h .

# 3. Look up the next TestFlight build number
#    iPhone → TestFlight app → Awakened → see "Build N"
#    Pass N+1 to the prep script below.

# 4. Run the prep script (replaces all the codemagic.yaml prep steps)
#    Pass the next build number as the first argument.
bash scripts/prep-local-build.sh 81

# 5. Open Xcode
npx cap open ios
```

In Xcode:

1. **Top device dropdown** → select "Any iOS Device (arm64)". NOT a Simulator.
2. **Project navigator** (left) → click "App" (the blue project icon) → select the "App" target → **Signing & Capabilities** tab.
   - **Team**: pick your Apple Developer team.
   - **Automatically manage signing**: try this first. If the build later errors with `applesignin` entitlement complaints, untick it and download the existing manual profile from developer.apple.com → drag into Xcode.
   - **Bundle Identifier**: must be `com.goallearner.awakened`.
3. **App target → General → Identity** → confirm:
   - Marketing Version: `2.2.2`
   - Build: matches what you passed to the script (e.g. `81`)
4. **Product → Archive** (top menu). Takes 5–15 min.
5. When done, **Organizer** window opens automatically.
6. Select the new archive → click **Distribute App** → **App Store Connect** → **Upload** → walk through prompts. Use automatic signing if asked.
7. Wait for App Store Connect to ingest (5–15 min). TestFlight build appears under TestFlight → iOS Builds.

## Troubleshooting

### "Provisioning profile doesn't include the com.apple.developer.applesignin entitlement"

Apple's automatic provisioning sometimes drops this. Two fixes:

**Fix A (preferred)**: Untick "Automatically manage signing" and use the existing manual profile:
1. Go to https://developer.apple.com → Account → Certificates, IDs & Profiles → Profiles.
2. Download `awakened-app-store-manual.mobileprovision`.
3. Drag the file onto Xcode's dock icon — installs it into `~/Library/MobileDevice/Provisioning Profiles/`.
4. In Xcode → App target → Signing & Capabilities → manual signing → pick `awakened-app-store-manual` for both Debug and Release.

**Fix B**: Delete and re-create the profile at developer.apple.com with Sign in with Apple explicitly checked, then re-download.

### "No Apple Distribution certificate installed"

In Xcode → Settings → Accounts → click your Apple ID → "Manage Certificates…" → `+` → "Apple Distribution". Xcode handles the rest.

### "Build number already used"

Increase the build number argument to `prep-local-build.sh` and re-run:

```bash
bash scripts/prep-local-build.sh 82
```

Or in Xcode: App target → General → Identity → Build → increment.

### "command not found: agvtool"

agvtool comes with Xcode. Ensure Xcode Command Line Tools are pointing at the real Xcode:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
agvtool what-version
```

### "FAIL: APP_BUILD_TAG missing from www/app.js"

The prep script's sanity gate caught this — your `git pull` didn't pick up the latest. Re-run `git pull origin main` and check `git log --oneline -3` matches the expected HEAD.

### Disk space ran out mid-archive

Xcode's DerivedData (default `~/Library/Developer/Xcode/DerivedData/`) bloats fast. After a successful archive, clean:

```bash
rm -rf ~/Library/Developer/Xcode/DerivedData/*
```

Or relocate DerivedData to an external SSD: Xcode → Settings → Locations → Derived Data → "Custom" → pick a folder on the SSD.

## What the prep script does (so you can read it instead of trusting blindly)

1. Mirrors codemagic.yaml's www/ asset copy (lines 79–149).
2. Wipes `ios/App/App/public/*` before sync (line 418).
3. `npx cap sync ios`.
4. Bumps Podfile + project.pbxproj IPHONEOS_DEPLOYMENT_TARGET to 14.0 (line 165).
5. `pod install`.
6. Sets `ITSAppUsesNonExemptEncryption=false` in Info.plist (line 614).
7. Sets HealthKit usage descriptions + entitlement (line 625).
8. Sets Sign in with Apple entitlement (line 667).
9. Wires `CODE_SIGN_ENTITLEMENTS = App/App.entitlements` via the xcodeproj Ruby gem (line 686).
10. Optionally sets marketing version + build number via agvtool (line 734).

The script does NOT handle signing — Xcode's GUI does that more reliably than scripting it.
