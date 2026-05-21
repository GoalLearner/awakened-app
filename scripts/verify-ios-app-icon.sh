#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# scripts/verify-ios-app-icon.sh
#
# Fails loudly if the iOS AppIcon set inside the generated project is
# missing, incomplete, or still the default Capacitor icon.
#
# Awakened 2.2.3 build 93 shipped to a tester's iPhone with the blue
# default Capacitor app icon on the home screen because the patch
# step had been skipped. This gate prevents a repeat.
#
# Checks:
#   1. ios/App/App/Assets.xcassets/AppIcon.appiconset/ exists.
#   2. Contents.json + every expected PNG variant is present.
#   3. The 1024 marketing icon is exactly 1024x1024.
#   4. The 1024 marketing icon's SHA256 matches the canonical
#      resources/ios/AppIcon.appiconset/AppIcon-1024.png (which is
#      itself byte-identical to root app-icon-source.png). A mismatch
#      = the default Capacitor icon (or any other wrong art) is in
#      place.
#
# USAGE (MacBook, after `npx cap copy ios` + patch-ios-app-icon.sh,
# BEFORE opening Xcode):
#
#   bash scripts/verify-ios-app-icon.sh
#
# Exit 0 = safe to archive. Exit 1 = STOP. Re-run patch.
# ─────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

DST="ios/App/App/Assets.xcassets/AppIcon.appiconset"
SRC="resources/ios/AppIcon.appiconset"

EXPECTED_FILES=(
  "Contents.json"
  "AppIcon-1024.png"
  "AppIcon-20.png"
  "AppIcon-20@2x.png"
  "AppIcon-20@2x~ipad.png"
  "AppIcon-20@3x.png"
  "AppIcon-29.png"
  "AppIcon-29@2x.png"
  "AppIcon-29@2x~ipad.png"
  "AppIcon-29@3x.png"
  "AppIcon-40.png"
  "AppIcon-40@2x.png"
  "AppIcon-40@2x~ipad.png"
  "AppIcon-40@3x.png"
  "AppIcon-60@2x.png"
  "AppIcon-60@3x.png"
  "AppIcon-76.png"
  "AppIcon-76@2x.png"
  "AppIcon-83.5@2x.png"
)

fail=0
echo "════════════════════════════════════════════════════════════"
echo "VERIFY iOS AppIcon — $DST"
echo "════════════════════════════════════════════════════════════"

if [ ! -d "$DST" ]; then
  echo "❌ FAIL — AppIcon set directory missing: $DST"
  echo ""
  echo "  Run this from the repo root AFTER the iOS project exists" >&2
  echo "  and the icon-patch step has run:" >&2
  echo "    npx cap copy ios" >&2
  echo "    bash scripts/patch-ios-app-icon.sh" >&2
  echo "    bash scripts/verify-ios-app-icon.sh    # this script" >&2
  echo ""
  echo "  DO NOT ARCHIVE."
  exit 1
fi

# ── 1. Required files present ───────────────────────────────────────
missing_files=()
for f in "${EXPECTED_FILES[@]}"; do
  if [ ! -f "$DST/$f" ]; then
    missing_files+=("$f")
    fail=1
  fi
done
if [ "${#missing_files[@]}" -gt 0 ]; then
  echo "❌ Missing files in $DST:"
  for f in "${missing_files[@]}"; do echo "    - $f"; done
else
  echo "  Required files: all ${#EXPECTED_FILES[@]} present"
fi

# ── 2. Marketing icon dimensions ────────────────────────────────────
if [ -f "$DST/AppIcon-1024.png" ]; then
  dims_ok=0
  if command -v sips >/dev/null 2>&1; then
    # macOS — sips is canonical on the MacBook build machine.
    dim_line="$(sips -g pixelWidth -g pixelHeight "$DST/AppIcon-1024.png" 2>/dev/null || true)"
    w="$(echo "$dim_line" | awk '/pixelWidth/  {print $2}')"
    h="$(echo "$dim_line" | awk '/pixelHeight/ {print $2}')"
    if [ "$w" = "1024" ] && [ "$h" = "1024" ]; then
      dims_ok=1
    else
      echo "❌ Marketing icon dims wrong: ${w:-?}x${h:-?} (expected 1024x1024)"
      fail=1
    fi
  elif command -v file >/dev/null 2>&1; then
    # Fallback for non-mac environments (CI on Windows during this
    # commit's verification, for example).
    info="$(file "$DST/AppIcon-1024.png" 2>/dev/null || true)"
    case "$info" in
      *"1024 x 1024"*) dims_ok=1 ;;
      *) echo "❌ Marketing icon dims wrong: $info (expected 1024 x 1024)"
         fail=1 ;;
    esac
  else
    echo "  WARN: no sips/file tool available — skipping dim check"
    dims_ok=1
  fi
  [ "$dims_ok" = "1" ] && echo "  Marketing icon dims: 1024x1024"
fi

# ── 3. Hash-compare ship icon to canonical source ───────────────────
# This is the load-bearing check: if the ship icon's bytes match the
# canonical resources/ios/AppIcon.appiconset/AppIcon-1024.png, we
# know the patch step succeeded and the default Capacitor icon is
# NOT what's about to ship.
hash_ok=0
SHA_CMD=""
if command -v shasum >/dev/null 2>&1; then SHA_CMD="shasum -a 256"
elif command -v sha256sum >/dev/null 2>&1; then SHA_CMD="sha256sum"
fi

if [ -n "$SHA_CMD" ] && [ -f "$DST/AppIcon-1024.png" ] && [ -f "$SRC/AppIcon-1024.png" ]; then
  src_hash="$($SHA_CMD "$SRC/AppIcon-1024.png" | awk '{print $1}')"
  dst_hash="$($SHA_CMD "$DST/AppIcon-1024.png" | awk '{print $1}')"
  if [ "$src_hash" = "$dst_hash" ]; then
    echo "  Marketing icon SHA256: matches canonical ✓"
    echo "    $src_hash"
    hash_ok=1
  else
    echo "❌ Marketing icon SHA256 MISMATCH:"
    echo "    canonical (resources/): $src_hash"
    echo "    shipping  (ios/...):    $dst_hash"
    echo "  The default Capacitor icon (or other wrong art) is in place."
    fail=1
  fi
else
  echo "  WARN: cannot hash-compare (missing shasum/sha256sum or files)"
fi

echo ""
if [ "$fail" -ne 0 ]; then
  echo "❌ FAIL — iOS AppIcon set is not the canonical Awakened icon."
  echo ""
  echo "  Fix:"
  echo "    bash scripts/patch-ios-app-icon.sh"
  echo "    bash scripts/verify-ios-app-icon.sh    # re-run me"
  echo ""
  echo "  DO NOT ARCHIVE until this passes."
  exit 1
fi

echo "✅ PASS — iOS AppIcon set is the canonical Awakened icon. Safe to archive."
