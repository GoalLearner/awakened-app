#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# scripts/ship-ci.sh — W1151: archive, sign and upload Awakened to TestFlight
# from a cloud Mac (the GitHub Actions workflow .github/workflows/ship.yml).
#
# It does on a GitHub macOS runner what the owner does by hand on the MacBook
# after `prep-local-build.sh`: sign, Product → Archive, Distribute → App Store
# Connect → Upload. Nothing here changes what ships: prep-local-build.sh (the
# same script the MacBook runs) assembles the project; this only signs and
# sends it.
#
# Inputs (environment):
#   BUILD                  the build number (one above the last TestFlight build)
#   IOS_DIST_P12_B64       Apple Distribution certificate + private key, .p12, base64
#   IOS_DIST_P12_PASSWORD  the .p12's password
#   IOS_PROFILE_B64        the App Store provisioning profile (.mobileprovision), base64
#   ASC_API_KEY_ID         App Store Connect API key id
#   ASC_API_ISSUER_ID      App Store Connect API issuer id
#   ASC_API_KEY_B64        the API key's .p8, base64
#   XCODE_APP              optional: /Applications/Xcode_26.6.app (blank = the runner's default)
#
# The provisioning profile decides the team and the bundle id (both are read
# from it). The App target is set to MANUAL signing with that profile, the way
# Codemagic's `xcode-project use-profiles` did until W814; signing settings are
# never passed on the xcodebuild command line, because that would apply them
# to the Pods targets too and break their resource bundles.
#
# Exit nonzero on any failure. Verbose on purpose.
# ─────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

: "${BUILD:?BUILD (the build number) is required}"
: "${IOS_DIST_P12_B64:?IOS_DIST_P12_B64 is required}"
: "${IOS_DIST_P12_PASSWORD:?IOS_DIST_P12_PASSWORD is required}"
: "${IOS_PROFILE_B64:?IOS_PROFILE_B64 is required}"
: "${ASC_API_KEY_ID:?ASC_API_KEY_ID is required}"
: "${ASC_API_ISSUER_ID:?ASC_API_ISSUER_ID is required}"
: "${ASC_API_KEY_B64:?ASC_API_KEY_B64 is required}"

WORK="${RUNNER_TEMP:-/tmp}/awakened-ship"
rm -rf "$WORK"; mkdir -p "$WORK"
KEYCHAIN="$WORK/ship.keychain-db"
KEYCHAIN_PW="$(uuidgen)"

cleanup() {
  # the certificate never outlives the job
  security delete-keychain "$KEYCHAIN" 2>/dev/null || true
  rm -f "$WORK/dist.p12" "$HOME/private_keys/AuthKey_${ASC_API_KEY_ID}.p8" 2>/dev/null || true
}
trap cleanup EXIT

echo "════════════════════════════════════════════════════════════"
echo "SHIP — Awakened iOS, build $BUILD, from $(hostname)"
echo "════════════════════════════════════════════════════════════"

# ── 0. Xcode ─────────────────────────────────────────────────────────
if [ -n "${XCODE_APP:-}" ]; then
  echo "── [0] Selecting $XCODE_APP ──"
  sudo xcode-select -s "$XCODE_APP"
fi
xcodebuild -version
echo ""

# ── 1. The certificate, in a keychain of its own ─────────────────────
echo "── [1] Certificate → temporary keychain ──"
echo "$IOS_DIST_P12_B64" | base64 --decode > "$WORK/dist.p12"
security create-keychain -p "$KEYCHAIN_PW" "$KEYCHAIN"
security set-keychain-settings -lut 21600 "$KEYCHAIN"
security unlock-keychain -p "$KEYCHAIN_PW" "$KEYCHAIN"
security import "$WORK/dist.p12" -k "$KEYCHAIN" -P "$IOS_DIST_P12_PASSWORD" -A -t cert -f pkcs12
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PW" "$KEYCHAIN" > /dev/null
# the new keychain joins the search list in front of the existing ones
EXISTING="$(security list-keychains -d user | tr -d '" ' | tr '\n' ' ')"
# shellcheck disable=SC2086
security list-keychains -d user -s "$KEYCHAIN" $EXISTING
echo "Signing identities in the keychain:"
security find-identity -v -p codesigning "$KEYCHAIN"
IDENTITY_COUNT="$(security find-identity -v -p codesigning "$KEYCHAIN" | grep -c 'Apple Distribution' || true)"
if [ "$IDENTITY_COUNT" = "0" ]; then
  echo "✖ No 'Apple Distribution' identity in the .p12. Export the certificate WITH its private key (Keychain Access → My Certificates → right-click → Export)."
  exit 1
fi
echo ""

# ── 2. The provisioning profile ──────────────────────────────────────
echo "── [2] Provisioning profile ──"
echo "$IOS_PROFILE_B64" | base64 --decode > "$WORK/profile.mobileprovision"
security cms -D -i "$WORK/profile.mobileprovision" > "$WORK/profile.plist"
PROFILE_UUID="$(/usr/libexec/PlistBuddy -c 'Print :UUID' "$WORK/profile.plist")"
PROFILE_NAME="$(/usr/libexec/PlistBuddy -c 'Print :Name' "$WORK/profile.plist")"
TEAM_ID="$(/usr/libexec/PlistBuddy -c 'Print :TeamIdentifier:0' "$WORK/profile.plist")"
APP_IDENTIFIER="$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:application-identifier' "$WORK/profile.plist")"
BUNDLE_ID="${APP_IDENTIFIER#"$TEAM_ID".}"
PROFILE_EXPIRES="$(/usr/libexec/PlistBuddy -c 'Print :ExpirationDate' "$WORK/profile.plist")"
echo "  Name:    $PROFILE_NAME"
echo "  UUID:    $PROFILE_UUID"
echo "  Team:    $TEAM_ID"
echo "  Bundle:  $BUNDLE_ID"
echo "  Expires: $PROFILE_EXPIRES"
echo "  Entitlements the profile carries:"
/usr/libexec/PlistBuddy -c 'Print :Entitlements' "$WORK/profile.plist" | sed 's/^/    /' | head -40
EXPECTED_BUNDLE="$(node -e "process.stdout.write(require('./capacitor.config.json').appId)")"
if [ "$BUNDLE_ID" != "$EXPECTED_BUNDLE" ]; then
  echo "✖ The profile is for $BUNDLE_ID, the app is $EXPECTED_BUNDLE. Wrong profile."
  exit 1
fi
if ! grep -q 'ProvisionsAllDevices\|<key>ProvisionedDevices</key>' "$WORK/profile.plist"; then
  echo "  (App Store distribution profile: no device list, as expected)"
fi
mkdir -p "$HOME/Library/MobileDevice/Provisioning Profiles" "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
cp "$WORK/profile.mobileprovision" "$HOME/Library/MobileDevice/Provisioning Profiles/$PROFILE_UUID.mobileprovision"
cp "$WORK/profile.mobileprovision" "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles/$PROFILE_UUID.mobileprovision"
echo ""

# ── 3. The App Store Connect API key (for the upload) ────────────────
echo "── [3] App Store Connect API key ──"
mkdir -p "$HOME/private_keys"
API_KEY_PATH="$HOME/private_keys/AuthKey_${ASC_API_KEY_ID}.p8"
echo "$ASC_API_KEY_B64" | base64 --decode > "$API_KEY_PATH"
chmod 600 "$API_KEY_PATH"
echo "  Key $ASC_API_KEY_ID, issuer ${ASC_API_ISSUER_ID:0:8}…"
echo ""

# ── 4. The iOS project ───────────────────────────────────────────────
echo "── [4] The iOS project ──"
if [ -d ios/App/App.xcodeproj ]; then
  echo "  ios/App is in the repo (the MacBook's project): building that."
else
  echo "  ⚠ ios/ is NOT in the repo. Making a fresh project with 'npx cap add ios' — the hand-made"
  echo "    parts of the MacBook's project (capabilities added in Xcode, for one) will be MISSING."
  echo "    Commit the MacBook's ios/App folder (git add ios) to build exactly what ships today."
  npx cap add ios
  if [ -d resources/ios/AppIcon.appiconset ]; then
    rm -rf ios/App/App/Assets.xcassets/AppIcon.appiconset
    cp -R resources/ios/AppIcon.appiconset ios/App/App/Assets.xcassets/
    echo "  Icon set installed from resources/ios."
  fi
fi
echo ""

# ── 5. Everything the MacBook does before Xcode opens ────────────────
echo "── [5] prep-local-build.sh $BUILD ──"
bash scripts/prep-local-build.sh "$BUILD"
echo ""

# ── 6. Manual signing on the App target, with THIS profile ───────────
# (what Codemagic's `xcode-project use-profiles` did; the Pods targets are untouched)
echo "── [6] App target → manual signing with '$PROFILE_NAME' ──"
PROFILE_NAME="$PROFILE_NAME" TEAM_ID="$TEAM_ID" BUNDLE_ID="$BUNDLE_ID" ruby -e '
  require "xcodeproj"
  proj = Xcodeproj::Project.open("ios/App/App.xcodeproj")
  target = proj.targets.find { |t| t.name == "App" } or abort("no App target")
  target.build_configurations.each do |config|
    config.build_settings["CODE_SIGN_STYLE"] = "Manual"
    config.build_settings["DEVELOPMENT_TEAM"] = ENV["TEAM_ID"]
    config.build_settings["PROVISIONING_PROFILE_SPECIFIER"] = ENV["PROFILE_NAME"]
    config.build_settings["CODE_SIGN_IDENTITY"] = "Apple Distribution"
    config.build_settings["CODE_SIGN_IDENTITY[sdk=iphoneos*]"] = "Apple Distribution"
    config.build_settings["PRODUCT_BUNDLE_IDENTIFIER"] = ENV["BUNDLE_ID"]
    puts "  #{config.name}: Manual / #{ENV["TEAM_ID"]} / #{ENV["PROFILE_NAME"]}"
  end
  # the project-level attribute Xcode writes for a manually signed target
  attrs = proj.root_object.attributes["TargetAttributes"] ||= {}
  (attrs[target.uuid] ||= {})["ProvisioningStyle"] = "Manual"
  (attrs[target.uuid] ||= {})["DevelopmentTeam"] = ENV["TEAM_ID"]
  proj.save
'
echo ""

# ── 7. Archive ───────────────────────────────────────────────────────
echo "── [7] xcodebuild archive ──"
ARCHIVE="$WORK/App.xcarchive"
LOG_DIR="$WORK/logs"; mkdir -p "$LOG_DIR"
set -o pipefail
xcodebuild \
  -workspace ios/App/App.xcworkspace \
  -scheme App \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" \
  archive 2>&1 | tee "$LOG_DIR/archive.log" | grep -E '^(\*\*|error:|warning: .*(entitlement|provisioning|signing)|Archive |=== |Build succeeded|Signing Identity|Provisioning Profile)' || true
if [ ! -d "$ARCHIVE" ]; then
  echo "✖ No archive was produced. The last 80 lines of the log:"
  tail -80 "$LOG_DIR/archive.log"
  exit 1
fi
echo "  Archive: $ARCHIVE"
echo "  Version: $(/usr/libexec/PlistBuddy -c 'Print :ApplicationProperties:CFBundleShortVersionString' "$ARCHIVE/Info.plist") ($(/usr/libexec/PlistBuddy -c 'Print :ApplicationProperties:CFBundleVersion' "$ARCHIVE/Info.plist"))"
echo ""

# ── 8. Export + upload to App Store Connect (TestFlight) ─────────────
echo "── [8] Export and upload ──"
EXPORT_OPTS="$WORK/ExportOptions.plist"
cat > "$EXPORT_OPTS" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>signingStyle</key><string>manual</string>
  <key>teamID</key><string>$TEAM_ID</string>
  <key>provisioningProfiles</key>
  <dict>
    <key>$BUNDLE_ID</key><string>$PROFILE_NAME</string>
  </dict>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict>
</plist>
PLIST
xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportOptionsPlist "$EXPORT_OPTS" \
  -exportPath "$WORK/export" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$API_KEY_PATH" \
  -authenticationKeyID "$ASC_API_KEY_ID" \
  -authenticationKeyIssuerID "$ASC_API_ISSUER_ID" \
  2>&1 | tee "$LOG_DIR/export.log" | grep -E '^(\*\*|error:|Upload|Exported|Packaging|Signing)' || true
if grep -qi 'EXPORT SUCCEEDED\|Upload succeeded\|UPLOAD SUCCEEDED' "$LOG_DIR/export.log"; then
  echo ""
  echo "════════════════════════════════════════════════════════════"
  echo "UPLOADED — build $BUILD is on its way to TestFlight (processing takes a few minutes)."
  echo "════════════════════════════════════════════════════════════"
else
  echo "✖ The export/upload did not report success. The last 80 lines of the log:"
  tail -80 "$LOG_DIR/export.log"
  exit 1
fi
