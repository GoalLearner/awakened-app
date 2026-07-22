#!/usr/bin/env bash
# backup-and-verify.sh — W746 (vibe-code audit item 5): export the PROD D1 database
# and PROVE the export restores, in one run. "Everyone says they have backups.
# Almost nobody has ever actually restored one."
#
# What it does:
#   1. `wrangler d1 export --remote` → ~/Documents/awakened-backups/awakened-db-<date>.sql
#      (OUTSIDE the repo on purpose — the export contains user emails/aliases and
#      must never be committed.)
#   2. Splits the export into statement-complete chunks (<95KB per statement,
#      ~700KB per chunk). WHY: d1 execute has a ~100KB per-statement cap, and a
#      couple of user_state_snapshots rows inline JSON blobs bigger than that
#      (they were INSERTed via bound params, which the cap doesn't apply to).
#      Oversized statements are quarantined to oversize.sql and SKIPPED — safe,
#      because snapshots are CLIENT-MIRRORED: the app re-uploads its state on
#      next launch, so those rows self-heal after any restore.
#   3. WIPES THE LOCAL dev D1 (.wrangler/state/v3/d1 — disposable) and restores
#      the chunks into it from nothing.
#   4. Compares key-table row counts (remote vs restored local). Mismatch = FAIL.
#
# Prod restore paths (in order of preference):
#   A. Time Travel (point-in-time, last 30 days, no file needed):
#        npx wrangler d1 time-travel info awakened-db
#        npx wrangler d1 time-travel restore awakened-db --bookmark=<bookmark>
#   B. This export, chunk-restored the same way against --remote (minus the
#      oversized snapshot rows, which self-heal — see above).
#
# Run from backend/:  bash scripts/backup-and-verify.sh
# Requires: wrangler login (owner OAuth).
set -e
cd "$(dirname "$0")/.."

BACKUP_DIR="$HOME/Documents/awakened-backups"
STAMP=$(date +%Y-%m-%d)
BACKUP="$BACKUP_DIR/awakened-db-$STAMP.sql"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$BACKUP_DIR"
echo "[1/4] Exporting prod D1 → $BACKUP"
npx wrangler d1 export awakened-db --remote --output "$BACKUP"

echo "[2/4] Splitting into restore-safe chunks"
mkdir -p "$WORK/chunks"
awk -v dir="$WORK/chunks" -v big="$WORK/oversize.sql" '
  { buf = buf $0 "\n" }
  /;[ \t\r]*$/ {
    if (length(buf) > 95000) { printf "%s", buf >> big; nbig++ }
    else {
      if (size + length(buf) > 700000 && size > 0) { close(f); ci++; size = 0 }
      f = sprintf("%s/chunk-%03d.sql", dir, ci)
      printf "%s", buf >> f
      size += length(buf)
    }
    buf = ""
  }
  END { printf "      %d oversized statement(s) quarantined (self-healing snapshots)\n", nbig+0 }
' "$BACKUP"

echo "[3/4] Wiping local dev D1 + restoring the chunks into it"
rm -rf .wrangler/state/v3/d1
for f in "$WORK/chunks"/chunk-*.sql; do
  out=$(npx wrangler d1 execute awakened-db --local --file "$f" 2>&1) || true
  if echo "$out" | grep -q "ERROR"; then
    echo "RESTORE FAILED on $(basename "$f"):"
    echo "$out" | grep -A2 ERROR | head -5
    exit 1
  fi
done

echo "[4/4] Verifying restored row counts against prod"
COUNT_SQL="SELECT (SELECT COUNT(*) FROM users) AS a, (SELECT COUNT(*) FROM premium_subscriptions) AS b, (SELECT COUNT(*) FROM skin_entitlements) AS c, (SELECT COUNT(*) FROM founder_marks) AS d, (SELECT COUNT(*) FROM public_profile_summary) AS e, (SELECT COUNT(*) FROM verified_events) AS f"
remote=$(npx wrangler d1 execute awakened-db --remote --command "$COUNT_SQL" 2>/dev/null | grep -oE '"[a-f]": [0-9]+' | tr -d ' ')
local_=$(npx wrangler d1 execute awakened-db --local  --command "$COUNT_SQL" 2>/dev/null | grep -oE '"[a-f]": [0-9]+' | tr -d ' ')
echo "  remote: $(echo $remote | tr '\n' ' ')"
echo "  local : $(echo $local_ | tr '\n' ' ')"
if [ -n "$remote" ] && [ "$remote" = "$local_" ]; then
  echo "BACKUP VERIFIED — export at $BACKUP restores cleanly (counts match)."
else
  echo "COUNT MISMATCH — NOTE: live users writing between export and verify cause"
  echo "small legitimate drift (verified_events especially). A small positive remote"
  echo "delta is fine; anything else, investigate before trusting this backup."
  exit 1
fi
