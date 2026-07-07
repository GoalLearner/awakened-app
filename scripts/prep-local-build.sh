#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# scripts/prep-local-build.sh
#
# Local mirror of codemagic.yaml's prep steps so a MacBook can produce
# a TestFlight-ready Xcode archive without Codemagic. Idempotent.
#
# Replicates (in order):
#   1. Copy PWA files into www/                       (codemagic.yaml line 79)
#   2. Wipe ios/App/App/public/ before cap sync       (codemagic.yaml line 418)
#   3. cap sync ios                                   (codemagic.yaml line 433)
#   4. Bump iOS deployment target to 14.0             (codemagic.yaml line 165)
#   5. pod install                                    (inside cap sync, but
#                                                      we run again after bump)
#   6. ITSAppUsesNonExemptEncryption=false in Info.plist (line 614)
#   7. HealthKit usage descriptions + entitlement     (line 625)
#   8. Sign in with Apple entitlement                 (line 667)
#   9. Wire CODE_SIGN_ENTITLEMENTS into Xcode project (line 686)
#
# Does NOT do (you handle these in Xcode):
#   • Signing (Xcode auto-signing or manual profile)
#   • agvtool build-number bump (pass build number via $1 if you want it set;
#     otherwise just bump in Xcode → General → Identity → Build before archiving)
#   • Archive itself (Product → Archive in Xcode)
#   • Upload (Organizer → Distribute App → App Store Connect)
#
# Usage:
#   bash scripts/prep-local-build.sh                       # prep only
#   bash scripts/prep-local-build.sh 81                    # prep + set build number to 81
#
# Exit nonzero on any failure. Verbose by default so a stuck step is obvious.
# ─────────────────────────────────────────────────────────────────────

set -euo pipefail

# Project root assumed = parent of this script's directory.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

BUILD_NUMBER_ARG="${1:-}"

echo "════════════════════════════════════════════════════════════"
echo "LOCAL BUILD PREP — Awakened iOS"
echo "════════════════════════════════════════════════════════════"
echo "Project root: $PROJECT_ROOT"
echo "Build number arg: ${BUILD_NUMBER_ARG:-(not set — bump manually in Xcode)}"
echo "Git HEAD: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo "Disk free: $(df -h . | tail -1 | awk '{print $4}')"
echo ""

# ── Pre-flight: unit-test gate (W487) — fail the local build on red BEFORE assembling www/ ──
echo "── Pre-flight: unit-test gate (economy math) ──"
npm run test:unit || { echo "FAIL: unit tests are red — aborting build."; exit 1; }
echo ""

# ── 1. Copy PWA files into www/ ─────────────────────────────────────
echo "── [1/9] Copy PWA files into www/ ──"
rm -rf www
mkdir -p www
# Path-less shell files — copy explicitly.
cp index.html styles.css sw.js manifest.json www/
# W487 — JS bundle DERIVED from index.html's <script src> graph (not a hand-kept list), so any
# local script (incl. path-bearing like lib/economy.js) is auto-copied with its sub-path. This
# generalizes the W480 lib/economy.js one-off — the next new JS file can never be silently omitted.
SCRIPTS=$(grep -oE '<script[^>]+src="[^"]+"' index.html | sed -E 's/.*src="([^"]+)".*/\1/' | sed -E 's/\?v=[0-9]+$//' | grep -vE '^https?:')
for js in $SCRIPTS; do
  if [ ! -f "$js" ]; then echo "FAIL: index.html references <script src=\"$js\"> but $js is missing"; exit 1; fi
  mkdir -p "www/$(dirname "$js")"
  cp "$js" "www/$js"
done
cp avatar-*.png www/
cp icon-192.png icon-512.png www/
# W565 — splash-screen logo. index.html's .splash-logo-img references
# assets/awknd-logo.png, but the selective copy list below omitted it, so the
# splash showed a broken-image placeholder on device (TestFlight build 374).
mkdir -p www/assets
if [ -f assets/awknd-logo.png ]; then cp assets/awknd-logo.png www/assets/; fi
mkdir -p www/assets/tab-icons
for icon in tab-status tab-habits tab-stats tab-history tab-dungeon tab-items tab-social; do
  cp "assets/tab-icons/$icon.png" "www/assets/tab-icons/$icon.png"
done
mkdir -p www/assets/stat-icons
for icon in stat-str stat-vit stat-int stat-focus stat-will stat-wlt; do
  cp "assets/stat-icons/$icon.png" "www/assets/stat-icons/$icon.png"
done
mkdir -p www/assets/habit-icons
# Mirrors codemagic.yaml line 104 — full curated coverage.
for icon in \
  icon-water icon-sleep icon-wake icon-walk icon-cardio icon-strength \
  icon-sunlight icon-gratitude icon-vitamins icon-meditate icon-nutrition \
  icon-nophone icon-business icon-cold icon-connection icon-finance \
  icon-grounding icon-journal icon-learning icon-mobility icon-noalcohol \
  icon-nocaffeine icon-nodoomscroll icon-noscreen-bed icon-nosugar \
  icon-protein icon-read icon-target icon-tidy icon-sprint icon-nosocial \
  icon-priority icon-plan-tomorrow icon-screen-cap icon-podcast icon-pray \
  icon-visualize icon-pack-morning icon-pack-lockedin icon-pack-custom \
  icon-streak icon-xp icon-class-civilian icon-class-warrior \
  icon-class-ranger icon-class-mage icon-class-assassin icon-class-paladin \
  icon-class-merchant icon-class-sage \
  icon-maxjump icon-depthjump icon-broadjump icon-bandjump icon-weightedjump; do
  src="assets/habit-icons/$icon.png"
  if [ -f "$src" ]; then
    cp "$src" "www/assets/habit-icons/$icon.png"
  else
    echo "  WARN: $src missing (skipping)"
  fi
done
mkdir -p www/assets/gates
for gate in gate-e-rank gate-d-rank gate-c-rank gate-b-rank gate-a-rank gate-s-rank; do
  src="assets/gates/$gate.png"
  if [ -f "$src" ]; then cp "$src" "www/assets/gates/$gate.png"; fi
done
mkdir -p www/assets/bosses
if compgen -G "assets/bosses/*.png" > /dev/null; then
  cp assets/bosses/*.png www/assets/bosses/
fi
mkdir -p www/assets/icons
for icon in souls-icon; do
  src="assets/icons/$icon.png"
  if [ -f "$src" ]; then cp "$src" "www/assets/icons/$icon.png"; fi
done
mkdir -p www/assets/items
if compgen -G "assets/items/*.png" > /dev/null; then
  cp assets/items/*.png www/assets/items/
fi
# v3 Phase 1z.282 — The First Awakened coach character pose set.
# Five PNGs (~50-60 KB each, ~300 KB total) loaded by the coachmark
# engine and Field Manual cover/index views.
mkdir -p www/assets/coach
if compgen -G "assets/coach/*.png" > /dev/null; then
  cp assets/coach/*.png www/assets/coach/
fi
# W245 — battle music loops (W244). The AudioDirector fetches
# assets/audio/*.m4a at battle entry; if these are missing from the
# bundle the music layer silently ships absent (exactly the W244
# on-device symptom: "music never came on"). LICENSES.md stays
# repo-side only — the bundle needs just the audio files.
mkdir -p www/assets/audio
if compgen -G "assets/audio/*.m4a" > /dev/null; then
  cp assets/audio/*.m4a www/assets/audio/
fi
if compgen -G "assets/audio/*.mp3" > /dev/null; then
  cp assets/audio/*.mp3 www/assets/audio/   # W246 — iOS decode-fallback twins
fi
# W249 — battle tier backgrounds (webp, processed from Midjourney plates by
# the resolver ladder in app.js; missing tier falls back gracefully but the
# bundle should always carry all six).
# W251 — generated NPC battle sprites (foe_<archKey> covers the 90 procedural
# floors; boss_<floor> portraits drop in as they land). Missing files fall
# back to silhouettes in-app, but anything PRESENT here must ship.
mkdir -p www/assets/arena
if compgen -G "assets/arena/*.webp" > /dev/null; then
  cp assets/arena/*.webp www/assets/arena/
fi
mkdir -p www/assets/backgrounds
if compgen -G "assets/backgrounds/*.webp" > /dev/null; then
  cp assets/backgrounds/*.webp www/assets/backgrounds/
fi
echo "  www/ assembled."
echo ""

# W565 — missing-asset gate. The selective copy list above is easy to forget
# when a new image lands (exactly how the splash logo shipped broken in build
# 374). Fail the build if any assets/* path referenced by the bundled HTML/CSS/
# JS is absent from www/ — so it's caught here, not on a device.
echo "── Asset-reference check ──"
ASSET_FAIL=0
for ref in $(grep -ohrE "assets/[A-Za-z0-9_./-]+\.(png|jpe?g|webp|svg|m4a|mp3|gif)" www/index.html www/styles.css www/app.js 2>/dev/null | sort -u); do
  if [ ! -f "www/$ref" ]; then echo "  ERROR: referenced asset missing from www/: $ref"; ASSET_FAIL=1; fi
done
if [ "$ASSET_FAIL" = "1" ]; then echo "  Add the missing file(s) to the copy list in this script, then rebuild."; exit 1; fi
echo "  OK — every referenced asset is bundled."
echo ""

# Verify version knobs are in www/ (sanity check)
echo "── Version knob sanity ──"
WWW_BUILD_TAG=$(grep -oE "APP_BUILD_TAG\s*=\s*'[^']+'" www/app.js | head -1 || true)
WWW_APPJS_V=$(grep -oE "app\.js\?v=[0-9]+" www/index.html | head -1 || true)
WWW_SW_CV=$(grep -oE "CACHE_VERSION\s*=\s*'[^']+'" www/sw.js | head -1 || true)
echo "  www/app.js  $WWW_BUILD_TAG"
echo "  www/index.html  $WWW_APPJS_V"
echo "  www/sw.js  $WWW_SW_CV"
if [ -z "$WWW_BUILD_TAG" ]; then
  echo "  FAIL: APP_BUILD_TAG missing from www/app.js"
  exit 1
fi
# W480 — hard gate: index.html references lib/economy.js, and app.js delegates ALL
# stat-level / XP math to AwakenedEconomy (defined ONLY in that file). If it's missing
# from www/, the device build bricks combat (POWER 0 + dead FIGHT). Fail the build LOUD
# rather than ship it again.
if [ ! -f www/lib/economy.js ]; then
  echo "  FAIL: www/lib/economy.js is MISSING — index.html references it; build would brick the Ascent. Aborting."
  exit 1
fi
if ! grep -q "AwakenedEconomy" www/lib/economy.js; then
  echo "  FAIL: www/lib/economy.js present but missing the AwakenedEconomy export. Aborting."
  exit 1
fi
echo "  www/lib/economy.js  OK"
echo ""

# ── 2. Wipe ios/App/App/public/ before sync ─────────────────────────
echo "── [2/9] Force-clean ios/App/App/public/ ──"
if [ -d ios/App/App/public ]; then
  rm -rf ios/App/App/public/*
  echo "  ios/App/App/public/* wiped."
else
  echo "  ios/App/App/public/ does not exist yet — cap sync will create it"
fi
echo ""

# ── 3. cap sync ios ──────────────────────────────────────────────────
echo "── [3/9] npx cap sync ios ──"
if [ ! -d node_modules ]; then
  echo "  node_modules missing — running npm install first (may take 2–4 min)"
  npm install
fi
npx cap sync ios
echo ""

# ── 4. Bump iOS deployment target to 14.0 ───────────────────────────
echo "── [4/9] Bump iOS deployment target to 14.0 ──"
if [ -f ios/App/Podfile ]; then
  sed -i.bak "s/platform :ios, '[0-9.]*'/platform :ios, '14.0'/" ios/App/Podfile
  rm -f ios/App/Podfile.bak
  echo "  Podfile: $(grep "platform :ios" ios/App/Podfile)"
fi
if [ -f ios/App/App.xcodeproj/project.pbxproj ]; then
  # sed in-place differs between BSD (macOS) and GNU. BSD requires ''
  # after -i. We're macOS-only, so:
  sed -i '' "s/IPHONEOS_DEPLOYMENT_TARGET = 13.0/IPHONEOS_DEPLOYMENT_TARGET = 14.0/g" ios/App/App.xcodeproj/project.pbxproj
  echo "  project.pbxproj: $(grep -c "IPHONEOS_DEPLOYMENT_TARGET = 14.0" ios/App/App.xcodeproj/project.pbxproj) occurrences at 14.0"
fi
echo ""

# ── 5. pod install ──────────────────────────────────────────────────
echo "── [5/9] pod install ──"
if ! command -v pod >/dev/null 2>&1; then
  echo "  FAIL: CocoaPods (pod) not installed. Run: brew install cocoapods"
  exit 1
fi
(cd ios/App && pod install)
echo ""

# ── 6. ITSAppUsesNonExemptEncryption = false ────────────────────────
echo "── [6/9] Export compliance flag ──"
PLIST="ios/App/App/Info.plist"
if [ ! -f "$PLIST" ]; then
  echo "  FAIL: $PLIST missing"
  exit 1
fi
/usr/libexec/PlistBuddy -c "Add :ITSAppUsesNonExemptEncryption bool false" "$PLIST" 2>/dev/null || \
/usr/libexec/PlistBuddy -c "Set :ITSAppUsesNonExemptEncryption false" "$PLIST"
echo "  ITSAppUsesNonExemptEncryption: $(/usr/libexec/PlistBuddy -c "Print :ITSAppUsesNonExemptEncryption" "$PLIST")"
echo ""

# ── 7. HealthKit usage descriptions + entitlement ───────────────────
# Apple-accepted purpose strings (Awakened 2.2.3 build 92, May 20, 2026
# upload). Apple rejected build 91 with ITMS-90683 for missing these
# keys; build 92 uploaded successfully after adding them with the exact
# wording below. KEEP IN SYNC with scripts/patch-ios-health-plist.sh.
echo "── [7/9] HealthKit Info.plist + entitlement ──"
ENTITLEMENTS="ios/App/App/App.entitlements"
SHARE_DESC="Awakened reads selected Apple Health data, such as steps, sleep, and workouts, to verify habit completion and personalize your progress."
UPDATE_DESC="Awakened may request Health access through its HealthKit integration. Health data is used only to support habit verification and progress tracking."

/usr/libexec/PlistBuddy -c "Add :NSHealthShareUsageDescription string '$SHARE_DESC'" "$PLIST" 2>/dev/null || \
/usr/libexec/PlistBuddy -c "Set :NSHealthShareUsageDescription '$SHARE_DESC'" "$PLIST"

/usr/libexec/PlistBuddy -c "Add :NSHealthUpdateUsageDescription string '$UPDATE_DESC'" "$PLIST" 2>/dev/null || \
/usr/libexec/PlistBuddy -c "Set :NSHealthUpdateUsageDescription '$UPDATE_DESC'" "$PLIST"

if [ ! -f "$ENTITLEMENTS" ]; then
  echo '<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
</dict>
</plist>' > "$ENTITLEMENTS"
fi

/usr/libexec/PlistBuddy -c "Add :com.apple.developer.healthkit bool true" "$ENTITLEMENTS" 2>/dev/null || \
/usr/libexec/PlistBuddy -c "Set :com.apple.developer.healthkit true" "$ENTITLEMENTS"
echo "  HealthKit entitlement set."
echo ""

# ── 8. Sign in with Apple entitlement ───────────────────────────────
echo "── [8/9] Sign in with Apple entitlement ──"
/usr/libexec/PlistBuddy -c "Add :com.apple.developer.applesignin array" "$ENTITLEMENTS" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :com.apple.developer.applesignin:0 string 'Default'" "$ENTITLEMENTS" 2>/dev/null || \
/usr/libexec/PlistBuddy -c "Set :com.apple.developer.applesignin:0 'Default'" "$ENTITLEMENTS"
echo "  applesignin entitlement: $(/usr/libexec/PlistBuddy -c "Print :com.apple.developer.applesignin" "$ENTITLEMENTS" | tr -d '\n')"
# ── Push Notifications (APNs) entitlement ───────────────────────────
# W604 added this; W607 reverted it to ship 387 (adding the capability had
# forced an Apple-side profile regen that broke signing). W610 RESTORES it:
# the "Awakened App Store Manual" profile is now push-enabled (tied to the
# Jun-10-2027 / LK8FVGBQPL distribution cert) and installed on the Mac, so a
# MANUAL-signed Archive resolves cleanly. 'production' is the correct
# aps-environment for App Store + TestFlight. See memory: awakened-push-notifications.
/usr/libexec/PlistBuddy -c "Add :aps-environment string production" "$ENTITLEMENTS" 2>/dev/null || \
/usr/libexec/PlistBuddy -c "Set :aps-environment production" "$ENTITLEMENTS"
echo "  aps-environment entitlement: $(/usr/libexec/PlistBuddy -c "Print :aps-environment" "$ENTITLEMENTS" | tr -d '\n')"
echo ""

# ── 8b. iOS AppIcon patch (Phase 1z.109) ────────────────────────────
# Build 93 shipped to a tester's iPhone with the blue default
# Capacitor icon because cap copy/sync seeds AppIcon.appiconset
# with Capacitor's defaults. The tracked Awakened AppIcon set
# lives at resources/ios/AppIcon.appiconset/ and is byte-identical
# to Codemagic's icon step.
echo "── [8b] iOS AppIcon patch ──"
bash "$SCRIPT_DIR/patch-ios-app-icon.sh"
echo ""

# ── 8c. Push Notifications AppDelegate forwarding (W613) ─────────────
# THE build-388 push bug: @capacitor/push-notifications does NOT auto-wire the
# APNs device-token callback. register() gets a token from APNs, but iOS hands
# it to AppDelegate.didRegisterForRemoteNotificationsWithDeviceToken — and the
# stock Capacitor AppDelegate.swift doesn't forward it to the plugin, so the JS
# 'registration' event never fires and no token is ever uploaded (device_tokens
# stayed empty). `cap sync` never adds these, so inject them idempotently as an
# AppDelegate extension. See memory: awakened-push-notifications.
echo "── [8c] Push AppDelegate forwarding ──"
APPDELEGATE="ios/App/App/AppDelegate.swift"
if [ -f "$APPDELEGATE" ]; then
  if grep -q "didRegisterForRemoteNotificationsWithDeviceToken" "$APPDELEGATE"; then
    echo "  AppDelegate push-forwarding: already present ✓"
  else
    cat >> "$APPDELEGATE" <<'SWIFT'

// W613 — forward the APNs device token to @capacitor/push-notifications.
// Required manual step (cap sync does not add it); without it register()
// never delivers the token to the JS 'registration' listener → no push.
extension AppDelegate {
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }
}
SWIFT
    echo "  AppDelegate push-forwarding: injected ✓"
  fi
else
  echo "  ⚠ AppDelegate.swift not found at $APPDELEGATE — push forwarding NOT applied"
fi
echo ""

# ── 9. Wire CODE_SIGN_ENTITLEMENTS into Xcode project ───────────────
echo "── [9/9] Wire CODE_SIGN_ENTITLEMENTS into project.pbxproj ──"
(cd ios/App && ruby -e "
  require 'xcodeproj'
  project_path = 'App.xcodeproj'
  project = Xcodeproj::Project.open(project_path)
  target = project.targets.find { |t| t.name == 'App' }
  raise 'App target not found' unless target
  target.build_configurations.each do |config|
    config.build_settings['CODE_SIGN_ENTITLEMENTS'] = 'App/App.entitlements'
    puts \"  Set CODE_SIGN_ENTITLEMENTS for #{config.name}\"
  end
  project.save
  puts '  project.pbxproj saved'
")
echo ""

# ── Optional: build-number bump ─────────────────────────────────────
# v3 Phase 1z.108 — marketing version is no longer hardcoded here.
# The previous "agvtool new-marketing-version '2.2.2'" call would
# silently back-date any post-2.2.2 train when this script was passed
# a build-number arg. We now derive it from the root app.js's
# APP_VERSION, which is the single source of truth (see comment at
# the constant). If parsing fails for any reason, we skip the
# marketing-version set and require it to be configured in Xcode.
if [ -n "$BUILD_NUMBER_ARG" ]; then
  echo "── [optional] Set build number to $BUILD_NUMBER_ARG ──"
  ROOT_MARKETING_VERSION="$(grep -m1 -oE "APP_VERSION[[:space:]]*=[[:space:]]*'[^']+'" app.js | sed -E "s/.*=[[:space:]]*'([^']+)'/\1/")"
  if [ -n "$ROOT_MARKETING_VERSION" ]; then
    echo "  Marketing Version (from root app.js APP_VERSION): $ROOT_MARKETING_VERSION"
    (cd ios/App && agvtool new-marketing-version "$ROOT_MARKETING_VERSION")
  else
    echo "  WARN: could not parse APP_VERSION from app.js — set Marketing Version in Xcode."
  fi
  (cd ios/App && agvtool new-version -all "$BUILD_NUMBER_ARG")
  # W562 — agvtool new-marketing-version can leave the MARKETING_VERSION build
  # setting (what Xcode's General tab + the archive actually read) stuck at an
  # old value (e.g. 2.3.1) while only updating Info.plist. Force MARKETING_VERSION
  # + CURRENT_PROJECT_VERSION straight into project.pbxproj via xcodeproj (same
  # gem used for entitlements above) so the shown + built version always equal
  # root APP_VERSION + the passed build number.
  if [ -n "$ROOT_MARKETING_VERSION" ]; then
    (cd ios/App && ruby -e "
      require 'xcodeproj'
      project = Xcodeproj::Project.open('App.xcodeproj')
      target = project.targets.find { |t| t.name == 'App' }
      raise 'App target not found' unless target
      target.build_configurations.each do |config|
        config.build_settings['MARKETING_VERSION'] = '$ROOT_MARKETING_VERSION'
        config.build_settings['CURRENT_PROJECT_VERSION'] = '$BUILD_NUMBER_ARG'
      end
      project.save
      puts '  forced MARKETING_VERSION=$ROOT_MARKETING_VERSION CURRENT_PROJECT_VERSION=$BUILD_NUMBER_ARG in project.pbxproj'
    ")
  fi
  echo ""
else
  echo "── [optional] Build number NOT set — bump it in Xcode before archiving"
  echo "    Xcode → App target → General → Identity → Build"
  echo "    Set to one higher than the latest TestFlight build for this version."
  echo ""
fi

# ── 10. Verify iOS public/ matches root sources ─────────────────────
# v3 Phase 1z.108 — guard against the build-92 stale-asset bug:
# the IPA shipped with a 2.2.3 native shell and 2.2.2-w15 web
# assets inside because www/ wasn't rebuilt before cap copy. This
# gate compares all four release knobs (APP_VERSION,
# APP_BUILD_TAG, app.js?v=, sw.js CACHE_VERSION) between the root
# sources and ios/App/App/public/. Mismatch → exit 1 → archive
# blocked.
echo "── [10/11] Verify iOS public/ matches root sources ──"
bash "$SCRIPT_DIR/verify-ios-public-assets.sh"
echo ""

# ── 11. Verify iOS AppIcon is the canonical Awakened set (1z.109) ───
# Guards against the build-93 default-Capacitor-icon failure mode.
# Hash-compares the ship-side 1024 marketing icon to the canonical
# resources/ios/AppIcon.appiconset/AppIcon-1024.png. Mismatch =
# default Capacitor icon (or other wrong art) in place → exit 1.
echo "── [11/12] Verify iOS AppIcon is the canonical Awakened icon ──"
bash "$SCRIPT_DIR/verify-ios-app-icon.sh"
echo ""

# ── 12. Verify HealthKit + Sign in with Apple entitlements (1z.113) ─
# Guards against the build-93/94/95 'HealthKit queries return zero
# rows despite permission prompts working' failure mode. Without
# the com.apple.developer.healthkit entitlement wired into
# CODE_SIGN_ENTITLEMENTS, iOS shows the perm sheet, the user grants,
# the JS call resolves 'granted', and every HKSampleQuery silently
# returns 0. Steps 7-9 above set + wire these — this gate confirms.
echo "── [12/12] Verify iOS entitlements are wired ──"
bash "$SCRIPT_DIR/verify-ios-entitlements.sh"
echo ""

echo "════════════════════════════════════════════════════════════"
echo "PREP COMPLETE — open Xcode to archive"
echo "════════════════════════════════════════════════════════════"
echo "Next: npx cap open ios"
echo "Then in Xcode:"
echo "  1. Top device dropdown → 'Any iOS Device (arm64)'"
echo "  2. App target → Signing & Capabilities — verify Team + Bundle ID"
echo "  3. App target → General → Identity → Build = next available number"
echo "  4. Product → Archive  (takes 5–15 min)"
echo "  5. Organizer opens → Distribute App → App Store Connect → Upload"
echo ""
