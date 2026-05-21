#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# scripts/patch-ios-health-plist.sh
#
# Idempotently ensures the two HealthKit Info.plist purpose strings
# Apple requires for the Awakened iOS bundle are present and current.
#
# WHY THIS EXISTS
# Apple rejected Awakened 2.2.3 build 91 (May 20, 2026) with ITMS-90683:
#
#   "Missing purpose string in Info.plist. Apps that collect or transmit
#    user data must clearly disclose the use of such data. Add the
#    NSHealthShareUsageDescription / NSHealthUpdateUsageDescription
#    keys to your app's Info.plist file."
#
# Build 92 uploaded successfully after the keys below were added.
#
# The desktop GitHub repo does NOT track `ios/` (the generated Capacitor
# iOS project lives only on the MacBook archive machine). If `ios/` is
# ever regenerated with `npx cap add ios`, these keys must be re-added
# or the next App Store Connect upload will be rejected for the same
# reason. This script makes that step explicit and idempotent.
#
# USAGE (MacBook, after `npx cap copy ios` and before `npx cap open ios`):
#
#   bash scripts/patch-ios-health-plist.sh
#
# Safe to run any number of times — values are Set-or-Add, not Append.
# Heavy alternative: `bash scripts/prep-local-build.sh` runs this same
# patch plus the full codemagic.yaml-mirroring prep flow. The two scripts
# use the SAME purpose-string text so they cannot drift.
# ─────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

PLIST="ios/App/App/Info.plist"

if [ ! -f "$PLIST" ]; then
  echo "ERROR: $PLIST not found." >&2
  echo "  Run this from the repo root AFTER the iOS project exists." >&2
  echo "  Typical order on the MacBook:" >&2
  echo "    git pull origin main" >&2
  echo "    npx cap copy ios          # or 'npx cap sync ios' on first build" >&2
  echo "    bash scripts/patch-ios-health-plist.sh" >&2
  echo "    npx cap open ios" >&2
  exit 1
fi

# Apple-accepted purpose strings (2.2.3 build 92, May 20, 2026 upload).
# KEEP IN SYNC with scripts/prep-local-build.sh.
SHARE_TEXT="Awakened reads selected Apple Health data, such as steps, sleep, and workouts, to verify habit completion and personalize your progress."
UPDATE_TEXT="Awakened may request Health access through its HealthKit integration. Health data is used only to support habit verification and progress tracking."

echo "── Patching HealthKit Info.plist purpose strings ──"
echo "  PLIST: $PLIST"

# PlistBuddy returns nonzero on Set if the key does not exist yet,
# so we fall back to Add. Idempotent: subsequent runs hit Set.
/usr/libexec/PlistBuddy -c "Set :NSHealthShareUsageDescription $SHARE_TEXT" "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :NSHealthShareUsageDescription string $SHARE_TEXT" "$PLIST"

/usr/libexec/PlistBuddy -c "Set :NSHealthUpdateUsageDescription $UPDATE_TEXT" "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :NSHealthUpdateUsageDescription string $UPDATE_TEXT" "$PLIST"

echo ""
echo "── Resulting keys in $PLIST ──"
plutil -p "$PLIST" | grep -E "NSHealthShareUsageDescription|NSHealthUpdateUsageDescription"
echo ""
echo "✅ HealthKit purpose strings present. Safe to archive."
