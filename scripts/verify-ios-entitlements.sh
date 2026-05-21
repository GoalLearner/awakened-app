#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# scripts/verify-ios-entitlements.sh
#
# Fails loudly if the generated iOS project's entitlements aren't
# wired for HealthKit and Sign in with Apple. This is the gate that
# would have caught the build-93/94/95 "HealthKit queries return 0
# rows despite permission prompts working" failure mode.
#
# WHY THIS EXISTS
# Apple HealthKit requires TWO independent things to actually return
# data on-device:
#   1. Info.plist purpose strings (NSHealthShareUsageDescription /
#      NSHealthUpdateUsageDescription) — needed to PROMPT the user.
#      Without these, App Store Connect rejects the build with
#      ITMS-90683. Handled by patch-ios-health-plist.sh.
#   2. The com.apple.developer.healthkit entitlement, wired into the
#      Xcode project via CODE_SIGN_ENTITLEMENTS. Without this, the
#      permission sheet shows, the user grants, the JS call resolves
#      'granted'... and every HealthKit query then silently returns
#      zero rows. The app reports 'permission granted' to JS but
#      cannot actually read data.
#
# Codemagic and scripts/prep-local-build.sh both wire (2) automatically.
# The lite MacBook flow (cap copy + patch-ios-health-plist.sh +
# patch-ios-app-icon.sh) handles (1) but skips (2). Result:
# permission prompts appear to work, queries return empty, sleep
# diagnostics show sleep-query-empty even though data exists in
# Apple Health.
#
# This gate checks both halves:
#   - ios/App/App/App.entitlements has com.apple.developer.healthkit
#   - ios/App/App.xcodeproj/project.pbxproj has CODE_SIGN_ENTITLEMENTS
#     pointing at App/App.entitlements
#
# Read-only. Idempotent. Safe to re-run.
#
# USAGE (MacBook, after cap copy + patch-ios-health-plist.sh, BEFORE
# opening Xcode):
#
#   bash scripts/verify-ios-entitlements.sh
#
# Exit 0 = safe to archive. Exit 1 = STOP. Run prep-local-build.sh
# (which wires the entitlement) or manually fix the Xcode project.
# ─────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

ENTITLEMENTS="ios/App/App/App.entitlements"
PBXPROJ="ios/App/App.xcodeproj/project.pbxproj"

fail=0
echo "════════════════════════════════════════════════════════════"
echo "VERIFY iOS Entitlements — HealthKit + Sign in with Apple"
echo "════════════════════════════════════════════════════════════"

# ── 1. App.entitlements file exists ─────────────────────────────────
if [ ! -f "$ENTITLEMENTS" ]; then
  echo "❌ FAIL — $ENTITLEMENTS missing."
  echo ""
  echo "  The lite MacBook flow does NOT create App.entitlements."
  echo "  Run the full prep: bash scripts/prep-local-build.sh"
  echo "  (its step 7-9 sets entitlements + wires CODE_SIGN_ENTITLEMENTS)."
  echo ""
  echo "  DO NOT ARCHIVE."
  exit 1
fi
echo "  ✓ $ENTITLEMENTS exists"

# ── 2. HealthKit entitlement key present ────────────────────────────
hk_entitlement=""
if command -v /usr/libexec/PlistBuddy >/dev/null 2>&1; then
  hk_entitlement="$(/usr/libexec/PlistBuddy -c 'Print :com.apple.developer.healthkit' "$ENTITLEMENTS" 2>/dev/null || true)"
else
  # Non-mac environment (e.g. Windows during commit-prep verification).
  # PlistBuddy isn't available; fall back to grepping the XML.
  if grep -q "com.apple.developer.healthkit" "$ENTITLEMENTS" 2>/dev/null; then
    hk_entitlement="true"
  fi
fi
if [ "$hk_entitlement" != "true" ]; then
  echo "❌ FAIL — com.apple.developer.healthkit entitlement is not set in $ENTITLEMENTS"
  echo "    (got: '$hk_entitlement')"
  echo ""
  echo "  Without this entitlement, HealthKit permission prompts will"
  echo "  appear to succeed but every HKSampleQuery will silently return"
  echo "  zero rows. The build-93/94/95 'sleep-query-empty despite"
  echo "  permission granted' failure mode."
  echo ""
  echo "  Fix:"
  echo "    bash scripts/prep-local-build.sh        # idempotent, fixes this + more"
  echo "  or manually:"
  echo "    /usr/libexec/PlistBuddy -c 'Add :com.apple.developer.healthkit bool true' $ENTITLEMENTS"
  echo ""
  echo "  DO NOT ARCHIVE."
  fail=1
else
  echo "  ✓ com.apple.developer.healthkit = true"
fi

# ── 3. Sign in with Apple entitlement present ───────────────────────
applesignin=""
if command -v /usr/libexec/PlistBuddy >/dev/null 2>&1; then
  applesignin="$(/usr/libexec/PlistBuddy -c 'Print :com.apple.developer.applesignin' "$ENTITLEMENTS" 2>/dev/null | tr -d '\n' | head -c 100 || true)"
elif grep -q "com.apple.developer.applesignin" "$ENTITLEMENTS" 2>/dev/null; then
  applesignin="present"
fi
if [ -z "$applesignin" ]; then
  echo "❌ FAIL — com.apple.developer.applesignin entitlement missing in $ENTITLEMENTS"
  echo "  Without this, Sign in with Apple will fail on-device."
  echo "  Fix: bash scripts/prep-local-build.sh"
  echo ""
  echo "  DO NOT ARCHIVE."
  fail=1
else
  echo "  ✓ com.apple.developer.applesignin entitlement present"
fi

# ── 4. CODE_SIGN_ENTITLEMENTS wired in project.pbxproj ──────────────
if [ ! -f "$PBXPROJ" ]; then
  echo "❌ FAIL — $PBXPROJ missing."
  echo "  Run npx cap copy ios (or cap sync ios) first."
  echo ""
  echo "  DO NOT ARCHIVE."
  exit 1
fi
echo "  ✓ $PBXPROJ exists"

if grep -q "CODE_SIGN_ENTITLEMENTS = App/App.entitlements" "$PBXPROJ" 2>/dev/null; then
  cnt="$(grep -c "CODE_SIGN_ENTITLEMENTS = App/App.entitlements" "$PBXPROJ")"
  echo "  ✓ CODE_SIGN_ENTITLEMENTS = App/App.entitlements ($cnt occurrence(s))"
else
  echo "❌ FAIL — CODE_SIGN_ENTITLEMENTS = App/App.entitlements is NOT wired in $PBXPROJ"
  echo ""
  echo "  The App.entitlements file exists but Xcode isn't reading it."
  echo "  This is the exact silent-failure mode: HealthKit permission"
  echo "  prompts work, but the framework entitlement is never applied"
  echo "  at sign time, so on-device queries return zero rows."
  echo ""
  echo "  Fix (requires ruby + xcodeproj gem):"
  echo "    sudo gem install xcodeproj"
  echo "    bash scripts/prep-local-build.sh"
  echo ""
  echo "  DO NOT ARCHIVE."
  fail=1
fi

echo ""
if [ "$fail" -ne 0 ]; then
  echo "❌ FAIL — iOS entitlements are not correctly wired."
  echo "  Run 'bash scripts/prep-local-build.sh' (it handles steps 7-9 atomically)."
  echo "  DO NOT ARCHIVE."
  exit 1
fi

echo "✅ PASS — HealthKit + Sign in with Apple entitlements are wired."
