#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# scripts/patch-ios-app-icon.sh
#
# Replace the generated Capacitor default AppIcon set with the tracked
# Awakened AppIcon set. Mirrors codemagic.yaml's icon step exactly.
#
# WHY THIS EXISTS
# Awakened 2.2.3 build 93 (and a prior build) shipped with the default
# blue Capacitor app icon on the iPhone home screen instead of the
# Awakened gold-triangle-on-navy logo. Root cause: `npx cap add ios` /
# `cap sync ios` seeds `ios/App/App/Assets.xcassets/AppIcon.appiconset/`
# with Capacitor's default icon set. Unless the MacBook explicitly
# replaces that directory with our pre-rendered icons, the IPA carries
# the wrong home-screen icon.
#
# The canonical Awakened icons live in `resources/ios/AppIcon.appiconset/`
# (tracked, 19 PNG sizes + Contents.json). `AppIcon-1024.png` is
# byte-identical to the root `app-icon-source.png` master.
#
# USAGE (MacBook, after `npx cap copy ios` / `cap sync ios`, BEFORE
# opening Xcode):
#
#   bash scripts/patch-ios-app-icon.sh
#
# Safe to run any number of times — idempotent (rm + cp).
# ─────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

SRC="resources/ios/AppIcon.appiconset"
DST_PARENT="ios/App/App/Assets.xcassets"
DST="$DST_PARENT/AppIcon.appiconset"

# ── Source guard ────────────────────────────────────────────────────
if [ ! -d "$SRC" ]; then
  echo "ERROR: source icon set missing: $SRC" >&2
  echo "  Expected the tracked Awakened AppIcon assets to live here." >&2
  echo "  If you cloned this repo without LFS or full history, restore them" >&2
  echo "  with: git checkout -- $SRC" >&2
  exit 1
fi
if [ ! -f "$SRC/AppIcon-1024.png" ]; then
  echo "ERROR: $SRC/AppIcon-1024.png missing (marketing icon)." >&2
  exit 1
fi
if [ ! -f "$SRC/Contents.json" ]; then
  echo "ERROR: $SRC/Contents.json missing." >&2
  exit 1
fi

# ── Destination guard ───────────────────────────────────────────────
if [ ! -d "$DST_PARENT" ]; then
  echo "ERROR: $DST_PARENT not found." >&2
  echo "  Run this from the repo root AFTER the iOS project exists." >&2
  echo "  Typical MacBook order:" >&2
  echo "    rm -rf www && mkdir -p www && cp <root sources> www/" >&2
  echo "    npx cap copy ios" >&2
  echo "    bash scripts/patch-ios-health-plist.sh" >&2
  echo "    bash scripts/patch-ios-app-icon.sh        # this script" >&2
  echo "    bash scripts/verify-ios-public-assets.sh" >&2
  echo "    bash scripts/verify-ios-app-icon.sh" >&2
  echo "    npx cap open ios" >&2
  exit 1
fi

# ── Verify source is 1024x1024 (best-effort; non-fatal on platforms
#    without `file`/`sips`). The verify gate enforces this strictly.
SRC_1024_INFO=""
if command -v file >/dev/null 2>&1; then
  SRC_1024_INFO="$(file "$SRC/AppIcon-1024.png" 2>/dev/null || true)"
  case "$SRC_1024_INFO" in
    *"1024 x 1024"*) ;;
    *) echo "WARN: source $SRC/AppIcon-1024.png does not appear to be 1024x1024:" >&2
       echo "      $SRC_1024_INFO" >&2 ;;
  esac
fi

echo "── Patching iOS AppIcon set ──"
echo "  SRC: $SRC"
echo "  DST: $DST"

rm -rf "$DST"
mkdir -p "$DST_PARENT"
cp -R "$SRC" "$DST_PARENT/"

echo ""
echo "── Resulting icon set ──"
ls "$DST" | sort | head -40
echo ""
echo "✅ AppIcon set replaced with canonical Awakened assets."
