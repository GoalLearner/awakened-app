# Ship to TestFlight from GitHub (W1151)

The MacBook is needed for one thing only: Xcode. A GitHub-hosted macOS runner has Xcode too, and
the repo is public, so those runners cost nothing. `.github/workflows/ship.yml` runs the SAME prep
script the MacBook runs (`scripts/prep-local-build.sh <build>`), then `scripts/ship-ci.sh` signs,
archives and uploads to App Store Connect. Nothing about what ships changes.

## Run it

- GitHub → Actions → **Ship to TestFlight** → Run workflow → type the build number → Run.
- Or from any terminal with `gh`: `gh workflow run ship.yml -f build=627`, then `gh run watch`.
- About 15–25 minutes. On success the commit is tagged `build-<N>` and TestFlight shows the build
  after Apple's processing (a few more minutes). The xcodebuild logs are kept as an artifact for 14 days.
- The MacBook flow still works exactly as before; this is an addition, not a replacement.

## One-time setup (owner, on the MacBook)

1. **Commit the iOS project.** It used to be ignored (`/ios/`); W1151 ignores only the generated parts.
   ```bash
   cd /Volumes/AwakenedDev/repos/awakened-app && git pull origin main && git add ios && git status --short | head -30 && git commit -m "ios: the Xcode project, for the GitHub build" && git push origin main
   ```
   Pods, `App/public`, build output and user data stay out. If `git status` shows thousands of files, stop and ask.

2. **The distribution certificate (.p12).** Keychain Access → login → My Certificates → the
   *Apple Distribution: … (LK8FVGBQPL)* certificate that expires **Jun 10 2027** (the only one whose
   private key is on the MacBook) → right-click → Export → format .p12 → choose a password → save as
   `~/Desktop/awakened-dist.p12`. Then:
   ```bash
   base64 -i ~/Desktop/awakened-dist.p12 | pbcopy
   ```
   → GitHub secret `IOS_DIST_P12_B64`. The password → secret `IOS_DIST_P12_PASSWORD`. Then delete the .p12 from the Desktop.

3. **The provisioning profile.** The one Xcode uses: **"Awakened App Store Manual"** (App Store type,
   team LK8FVGBQPL, HealthKit + In-App Purchase + Push + Sign in with Apple). Find the installed copy:
   ```bash
   for f in ~/Library/MobileDevice/Provisioning\ Profiles/*.mobileprovision ~/Library/Developer/Xcode/UserData/Provisioning\ Profiles/*.mobileprovision; do [ -f "$f" ] || continue; x="$(security cms -D -i "$f" 2>/dev/null)"; echo "$x" | grep -q com.goallearner.awakened && printf '%s\n  %s  expires %s\n' "$f" "$(echo "$x" | /usr/libexec/PlistBuddy -c 'Print :Name' /dev/stdin)" "$(echo "$x" | /usr/libexec/PlistBuddy -c 'Print :ExpirationDate' /dev/stdin)"; done
   ```
   Pick the "Awakened App Store Manual" line with the latest expiry (or download it fresh from
   developer.apple.com → Profiles), then:
   ```bash
   base64 -i "<that file>" | pbcopy
   ```
   → secret `IOS_PROFILE_B64`. When a capability is added to the App ID later, the profile must be
   regenerated and this secret replaced (see CLAUDE.md "Adding ANY iOS capability").

4. **An App Store Connect API key** (for the upload). appstoreconnect.apple.com → Users and Access →
   **Integrations** → App Store Connect API → Team Keys → **+** → name `GitHub ship`, access
   **App Manager** → Generate. Copy the **Issuer ID** (top of the page) → secret `ASC_API_ISSUER_ID`;
   the key's **Key ID** → secret `ASC_API_KEY_ID`; **Download API Key** (offered once) → then:
   ```bash
   base64 -i ~/Downloads/AuthKey_*.p8 | pbcopy
   ```
   → secret `ASC_API_KEY_B64`.

5. **Add the six secrets.** github.com/GoalLearner/awakened-app → Settings → Secrets and variables →
   Actions → New repository secret: `IOS_DIST_P12_B64`, `IOS_DIST_P12_PASSWORD`, `IOS_PROFILE_B64`,
   `ASC_API_KEY_ID`, `ASC_API_ISSUER_ID`, `ASC_API_KEY_B64`. Secrets are never printed in logs and are
   not available to pull requests from forks.

6. **Run it once while not in a hurry.** The first run is the first time this project is compiled on a
   cloud Mac; expect a round or two of fixes. The workflow's `runner` input switches between the
   macOS 26 image (Xcode 26.6, Apple's current minimum) and the Xcode 27 preview image.

## How the signing works

- The profile decides the team and the bundle id (both are read out of it and checked against
  `capacitor.config.json`). The App target is set to **manual** signing with that profile and the
  "Apple Distribution" identity, the way Codemagic's `xcode-project use-profiles` did; the Pods targets
  are left alone, and no signing setting is passed on the `xcodebuild` command line.
- The certificate lives in a temporary keychain that is deleted when the job ends.
- `xcodebuild -exportArchive` with `destination: upload` sends the build to App Store Connect using
  the API key; `manageAppVersionAndBuildNumber` is off so the build number you typed stands.
- If `ios/` is ever missing from the repo the script falls back to `npx cap add ios` and says so
  loudly: the hand-made parts of the MacBook's project would be missing from such a build.
