#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# scripts/verify-ios-public-assets.sh
#
# Fails loudly if the web assets bundled inside the generated iOS
# project (ios/App/App/public/) don't match the root release knobs.
#
# WHY THIS EXISTS
# Awakened 2.2.3 build 92 uploaded successfully to App Store Connect
# but ran 2.2.2-w15 web code on-device. Root cause: the MacBook
# archive flow ran `npx cap copy ios` against a stale `www/` snapshot,
# so the IPA shipped with the OLD JavaScript bundle wrapped in a NEW
# native shell. Xcode's Info.plist (CFBundleShortVersionString) was
# bumped to 2.2.3 / 92, but the bundled app.js was still 2.2.2-w15 —
# undetectable in TestFlight, only visible via in-app Copy Debug Info.
#
# This gate compares the four canonical release knobs between the
# root sources and the iOS public/ copy. Any mismatch → exit 1, abort
# the archive.
#
# Knobs checked:
#   - APP_VERSION         (app.js)
#   - APP_BUILD_TAG       (app.js)
#   - app.js?v=...        (index.html)
#   - styles.css?v=...    (index.html)  [added 1z.245]
#   - CACHE_VERSION       (sw.js)
#
# USAGE (MacBook, after `npx cap copy ios` / `cap sync ios`, BEFORE
# opening Xcode):
#
#   bash scripts/verify-ios-public-assets.sh
#
# Exit 0 → safe to archive. Exit 1 → STOP. Rebuild www/ and re-copy.
# Idempotent / read-only — never writes to either source tree.
# ─────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# ── Required files ──────────────────────────────────────────────────
# v3 Phase 1z.119 — simulated-leaderboard.js is now release-critical.
# The workout_streak leaderboard (1z.118) is client-only — if the iOS
# bundle ships a stale simulated-leaderboard.js, the modal renders
# either the empty error state or the wrong bot values. We compare its
# SHA256 to the root copy via the same per-file hash check that protects
# app.js / index.html / sw.js.
REQUIRED=(
  "app.js"
  "index.html"
  "sw.js"
  "simulated-leaderboard.js"
  "ios/App/App/public/app.js"
  "ios/App/App/public/index.html"
  "ios/App/App/public/sw.js"
  "ios/App/App/public/simulated-leaderboard.js"
)
missing=0
for f in "${REQUIRED[@]}"; do
  if [ ! -f "$f" ]; then
    echo "ERROR: required file missing: $f" >&2
    missing=1
  fi
done
if [ "$missing" -ne 0 ]; then
  echo "" >&2
  echo "  This script must run AFTER 'npx cap copy ios' (or 'cap sync ios')," >&2
  echo "  with the iOS project already generated under ios/." >&2
  echo "  Typical MacBook order:" >&2
  echo "    rm -rf www && mkdir -p www && cp <root sources> www/" >&2
  echo "    npx cap copy ios" >&2
  echo "    bash scripts/patch-ios-health-plist.sh" >&2
  echo "    bash scripts/verify-ios-public-assets.sh   # this script" >&2
  echo "    npx cap open ios" >&2
  exit 1
fi

# ── Extractors ──────────────────────────────────────────────────────
# All grep -m1 patterns are written to tolerate quoting variants.
extract_app_version() {
  grep -m1 -oE "APP_VERSION[[:space:]]*=[[:space:]]*'[^']+'" "$1" \
    | sed -E "s/.*=[[:space:]]*'([^']+)'/\1/" \
    | head -n1
}

extract_build_tag() {
  grep -m1 -oE "APP_BUILD_TAG[[:space:]]*=[[:space:]]*'[^']+'" "$1" \
    | sed -E "s/.*=[[:space:]]*'([^']+)'/\1/" \
    | head -n1
}

extract_appjs_v() {
  grep -m1 -oE 'app\.js\?v=[0-9]+' "$1" \
    | sed -E "s/.*=//" \
    | head -n1
}

extract_stylescss_v() {
  grep -m1 -oE 'styles\.css\?v=[0-9]+' "$1" \
    | sed -E "s/.*=//" \
    | head -n1
}

extract_cache_version() {
  grep -m1 -oE "CACHE_VERSION[[:space:]]*=[[:space:]]*'[^']+'" "$1" \
    | sed -E "s/.*=[[:space:]]*'([^']+)'/\1/" \
    | head -n1
}

# ── Read root values ────────────────────────────────────────────────
ROOT_VERSION="$(extract_app_version app.js)"
ROOT_BUILD_TAG="$(extract_build_tag app.js)"
ROOT_APPJS_V="$(extract_appjs_v index.html)"
ROOT_STYLES_V="$(extract_stylescss_v index.html)"
ROOT_CACHE_VERSION="$(extract_cache_version sw.js)"

# ── Read iOS public/ values ─────────────────────────────────────────
IOS_VERSION="$(extract_app_version ios/App/App/public/app.js)"
IOS_BUILD_TAG="$(extract_build_tag ios/App/App/public/app.js)"
IOS_APPJS_V="$(extract_appjs_v ios/App/App/public/index.html)"
IOS_STYLES_V="$(extract_stylescss_v ios/App/App/public/index.html)"
IOS_CACHE_VERSION="$(extract_cache_version ios/App/App/public/sw.js)"

# ── Print summary ───────────────────────────────────────────────────
echo "════════════════════════════════════════════════════════════"
echo "VERIFY iOS PUBLIC ASSETS — root vs ios/App/App/public/"
echo "════════════════════════════════════════════════════════════"
printf "%-18s  %-20s  %-20s  %s\n" "knob"            "root"                  "ios public"            "status"
printf "%-18s  %-20s  %-20s  %s\n" "------------------" "--------------------" "--------------------" "------"

fail=0
report() {
  local label="$1" rootval="$2" iosval="$3"
  local status
  if [ -z "$rootval" ] || [ -z "$iosval" ]; then
    status="MISSING"
    fail=1
  elif [ "$rootval" = "$iosval" ]; then
    status="OK"
  else
    status="MISMATCH"
    fail=1
  fi
  printf "%-18s  %-20s  %-20s  %s\n" "$label" "${rootval:-<missing>}" "${iosval:-<missing>}" "$status"
}

report "APP_VERSION"     "$ROOT_VERSION"        "$IOS_VERSION"
report "APP_BUILD_TAG"   "$ROOT_BUILD_TAG"      "$IOS_BUILD_TAG"
report "app.js?v="       "$ROOT_APPJS_V"        "$IOS_APPJS_V"
report "styles.css?v="   "$ROOT_STYLES_V"       "$IOS_STYLES_V"
report "sw.js CACHE_VER" "$ROOT_CACHE_VERSION"  "$IOS_CACHE_VERSION"

# v3 Phase 1z.119 — hash-compare simulated-leaderboard.js root vs iOS
# copy. There's no release knob inside this file to extract, so we
# fall back to SHA256. Any drift (e.g. stale lite-flow cap copy left
# the iOS bundle's sim module behind a newer root) → exit 1, blocking
# the workout_streak leaderboard regression we just fixed.
SHA_CMD=""
if command -v shasum >/dev/null 2>&1; then SHA_CMD="shasum -a 256"
elif command -v sha256sum >/dev/null 2>&1; then SHA_CMD="sha256sum"
fi
if [ -n "$SHA_CMD" ]; then
  SIM_ROOT_HASH="$($SHA_CMD simulated-leaderboard.js 2>/dev/null | awk '{print $1}')"
  SIM_IOS_HASH="$($SHA_CMD ios/App/App/public/simulated-leaderboard.js 2>/dev/null | awk '{print $1}')"
  if [ -z "$SIM_ROOT_HASH" ] || [ -z "$SIM_IOS_HASH" ]; then
    printf "%-18s  %-20s  %-20s  %s\n" "sim-leaderboard"   "<missing>" "<missing>" "MISSING"
    fail=1
  elif [ "$SIM_ROOT_HASH" = "$SIM_IOS_HASH" ]; then
    printf "%-18s  %-20s  %-20s  %s\n" "sim-leaderboard"   "${SIM_ROOT_HASH:0:12}…" "${SIM_IOS_HASH:0:12}…" "OK"
  else
    printf "%-18s  %-20s  %-20s  %s\n" "sim-leaderboard"   "${SIM_ROOT_HASH:0:12}…" "${SIM_IOS_HASH:0:12}…" "MISMATCH"
    fail=1
  fi
else
  echo "  WARN: no shasum/sha256sum — skipping simulated-leaderboard.js hash compare"
fi

echo ""

# ── Required root-bundled image assets ──────────────────────────────
# v3 Phase 1z.111 — guard against the build-93 avatar-missing class
# of bug. These assets live at the repo root (NOT under assets/),
# are referenced from app.js as bare filenames (e.g.
# `'avatar-paladin.png'`), and must land in `ios/App/App/public/`
# at the same bare-filename location after `cap copy`. The lite
# MacBook flow used to omit `cp avatar-*.png www/` and ship a
# blank Status/Profile avatar on the user's iPhone. Verify every
# required bare-filename image is present.
echo "── Required root-bundled image assets in iOS public/ ──"
REQUIRED_IMAGES=(
  "avatar-base.png"
  "avatar-warrior.png"
  "avatar-ranger.png"
  "avatar-mage.png"
  "avatar-assassin.png"
  "avatar-paladin.png"
  "avatar-merchant.png"
  "avatar-sage.png"
  "icon-192.png"
  "icon-512.png"
)
images_missing=()
for img in "${REQUIRED_IMAGES[@]}"; do
  if [ ! -f "ios/App/App/public/$img" ]; then
    images_missing+=("$img")
    fail=1
  fi
done
if [ "${#images_missing[@]}" -gt 0 ]; then
  echo "  ❌ Missing required images in ios/App/App/public/:"
  for img in "${images_missing[@]}"; do echo "      - $img"; done
else
  echo "  ✓ All ${#REQUIRED_IMAGES[@]} required root-bundled images present"
fi

echo ""
if [ "$fail" -ne 0 ]; then
  echo "❌ FAIL — iOS public/ assets do NOT match root sources."
  echo ""
  echo "  Most likely cause: www/ was not rebuilt from root sources"
  echo "  before 'npx cap copy ios'. cap copy just copies www/ into"
  echo "  ios/App/App/public/ — it does NOT pull from the repo root."
  echo ""
  echo "  Fix:"
  echo "    rm -rf www && mkdir -p www"
  echo "    cp index.html app.js styles.css sw.js auth.js \\"
  echo "       simulated-leaderboard.js manifest.json www/"
  echo "    cp avatar-*.png www/                          # 8 class silhouettes"
  echo "    cp icon-192.png icon-512.png app-icon-source.png www/ 2>/dev/null || true"
  echo "    cp -R assets www/assets 2>/dev/null || true"
  echo "    npx cap copy ios"
  echo "    bash scripts/patch-ios-health-plist.sh"
  echo "    bash scripts/patch-ios-app-icon.sh"
  echo "    bash scripts/verify-ios-public-assets.sh    # re-run me"
  echo "    bash scripts/verify-ios-app-icon.sh"
  echo ""
  echo "  Or run the full prep: bash scripts/prep-local-build.sh"
  echo ""
  echo "  DO NOT ARCHIVE until this passes."
  exit 1
fi

echo "✅ PASS — iOS public/ assets match root sources. Safe to archive."
