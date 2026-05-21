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
REQUIRED=(
  "app.js"
  "index.html"
  "sw.js"
  "ios/App/App/public/app.js"
  "ios/App/App/public/index.html"
  "ios/App/App/public/sw.js"
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

extract_cache_version() {
  grep -m1 -oE "CACHE_VERSION[[:space:]]*=[[:space:]]*'[^']+'" "$1" \
    | sed -E "s/.*=[[:space:]]*'([^']+)'/\1/" \
    | head -n1
}

# ── Read root values ────────────────────────────────────────────────
ROOT_VERSION="$(extract_app_version app.js)"
ROOT_BUILD_TAG="$(extract_build_tag app.js)"
ROOT_APPJS_V="$(extract_appjs_v index.html)"
ROOT_CACHE_VERSION="$(extract_cache_version sw.js)"

# ── Read iOS public/ values ─────────────────────────────────────────
IOS_VERSION="$(extract_app_version ios/App/App/public/app.js)"
IOS_BUILD_TAG="$(extract_build_tag ios/App/App/public/app.js)"
IOS_APPJS_V="$(extract_appjs_v ios/App/App/public/index.html)"
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
report "sw.js CACHE_VER" "$ROOT_CACHE_VERSION"  "$IOS_CACHE_VERSION"

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
  echo "    cp icon-192.png icon-512.png app-icon-source.png www/ 2>/dev/null || true"
  echo "    cp -R assets www/assets 2>/dev/null || true"
  echo "    npx cap copy ios"
  echo "    bash scripts/patch-ios-health-plist.sh"
  echo "    bash scripts/verify-ios-public-assets.sh    # re-run me"
  echo ""
  echo "  Or run the full prep: bash scripts/prep-local-build.sh"
  echo ""
  echo "  DO NOT ARCHIVE until this passes."
  exit 1
fi

echo "✅ PASS — iOS public/ assets match root sources. Safe to archive."
