# verify-armory-icons.ps1
#
# Validates the assets/item-icons/ folder against the 9 expected
# transparent armory icons. Reports each card_id as one of:
#   OK         — file present, PNG with alpha channel, corners
#                appear transparent (sample of 4 corner pixels)
#   MISSING    — file does not exist on disk
#   NO-ALPHA   — file exists but PNG has no alpha channel (will
#                render as a square box in the armory)
#   OPAQUE-EDGE — file exists with alpha but corner samples have
#                 visible pixels (likely full-card-art style)
#
# Until every row reports OK, the armory falls back to the rune
# placeholder for those slots. See assets/item-icons/README.md
# for the canonical generation spec.
#
# Usage:
#   pwsh ./scripts/verify-armory-icons.ps1
#
# Exit codes:
#   0 — all 9 icons OK
#   1 — one or more missing or invalid
#
# Note: This script does NOT parse app.js. The card_id list is
# duplicated here for portability. Keep in sync with the CARDS
# constant in app.js (9 launch entries).

$ErrorActionPreference = 'Stop'

# Canonical list of armory item card_ids (matches CARDS constant
# in app.js as of v2.1). When new cards land, add their id here.
$expectedIds = @(
  'dream_woven_hood',
  'sleepwalkers_cloak',
  'pendant_of_the_wakeful',
  'vow_ring',
  'vessel_of_refusal',
  'sober_kings_gloves',
  'pack_leaders_greaves',
  'alphas_mantle',
  'trail_worn_boots'
)

$root    = Split-Path -Parent $PSScriptRoot
$iconDir = Join-Path $root 'assets/item-icons'

Add-Type -AssemblyName System.Drawing

$results = @()
$allOk   = $true

foreach ($id in $expectedIds) {
  $path = Join-Path $iconDir ("{0}.png" -f $id)
  if (-not (Test-Path -Path $path)) {
    $results += [pscustomobject]@{ id = $id; status = 'MISSING'; detail = 'file not on disk' }
    $allOk = $false
    continue
  }

  try {
    $bitmap = [System.Drawing.Image]::FromFile($path)
  } catch {
    $results += [pscustomobject]@{ id = $id; status = 'UNREADABLE'; detail = $_.Exception.Message }
    $allOk = $false
    continue
  }

  $pixelFormat = $bitmap.PixelFormat.ToString()
  $hasAlpha    = $pixelFormat -match 'Argb' -or $pixelFormat -match 'PArgb'

  if (-not $hasAlpha) {
    $results += [pscustomobject]@{
      id = $id; status = 'NO-ALPHA';
      detail = ("PixelFormat={0} (need RGBA — re-export with alpha channel)" -f $pixelFormat)
    }
    $bitmap.Dispose()
    $allOk = $false
    continue
  }

  # Sample the four corners. If any corner is non-transparent the
  # image likely has a full background and will read as a square.
  $w = $bitmap.Width
  $h = $bitmap.Height
  $corners = @(
    $bitmap.GetPixel(2, 2),
    $bitmap.GetPixel($w - 3, 2),
    $bitmap.GetPixel(2, $h - 3),
    $bitmap.GetPixel($w - 3, $h - 3)
  )
  $opaqueCorner = $false
  foreach ($p in $corners) {
    if ($p.A -gt 8) { $opaqueCorner = $true; break }
  }
  $bitmap.Dispose()

  if ($opaqueCorner) {
    $results += [pscustomobject]@{
      id = $id; status = 'OPAQUE-EDGE';
      detail = ("{0}x{1}, alpha present but corner pixels are opaque (looks like full-card art)" -f $w, $h)
    }
    $allOk = $false
    continue
  }

  $results += [pscustomobject]@{
    id = $id; status = 'OK';
    detail = ("{0}x{1}, RGBA, corners transparent" -f $w, $h)
  }
}

# Format output
$results | Format-Table -AutoSize

if ($allOk) {
  Write-Host ""
  Write-Host "All 9 armory icons verified OK." -ForegroundColor Green
  exit 0
} else {
  $missingCount = ($results | Where-Object { $_.status -ne 'OK' }).Count
  Write-Host ""
  Write-Host ("{0} of 9 icons need attention. See assets/item-icons/README.md." -f $missingCount) -ForegroundColor Yellow
  exit 1
}
