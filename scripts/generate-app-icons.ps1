# Regenerate every iOS app-icon size + PWA icons from app-icon-source.png.
# Outputs are 24-bit RGB PNGs (no alpha) — Apple rejects transparent
# app icons. Source size doesn't have to be 1024×1024; this script
# downsamples to each target dimension with HighQualityBicubic.
#
# Usage: powershell -ExecutionPolicy Bypass -File .\scripts\generate-app-icons.ps1

Add-Type -AssemblyName System.Drawing

$root        = Resolve-Path (Join-Path $PSScriptRoot '..')
$src         = Join-Path $root 'app-icon-source.png'
$iosOut      = Join-Path $root 'resources\ios\AppIcon.appiconset'
if (-not (Test-Path $src))    { throw "Source not found: $src" }
if (-not (Test-Path $iosOut)) { New-Item -ItemType Directory -Path $iosOut | Out-Null }

# iOS targets — filename → output size in px (matches existing Contents.json).
$iosTargets = @(
    @{ name = 'AppIcon-20.png';            size =   20 }   # iPad notif @1x
    @{ name = 'AppIcon-20@2x.png';         size =   40 }   # iPhone notif @2x
    @{ name = 'AppIcon-20@2x~ipad.png';    size =   40 }   # iPad notif @2x
    @{ name = 'AppIcon-20@3x.png';         size =   60 }   # iPhone notif @3x
    @{ name = 'AppIcon-29.png';            size =   29 }   # iPad settings @1x
    @{ name = 'AppIcon-29@2x.png';         size =   58 }   # iPhone settings @2x
    @{ name = 'AppIcon-29@2x~ipad.png';    size =   58 }   # iPad settings @2x
    @{ name = 'AppIcon-29@3x.png';         size =   87 }   # iPhone settings @3x
    @{ name = 'AppIcon-40.png';            size =   40 }   # iPad spotlight @1x
    @{ name = 'AppIcon-40@2x.png';         size =   80 }   # iPhone spotlight @2x
    @{ name = 'AppIcon-40@2x~ipad.png';    size =   80 }   # iPad spotlight @2x
    @{ name = 'AppIcon-40@3x.png';         size =  120 }   # iPhone spotlight @3x
    @{ name = 'AppIcon-60@2x.png';         size =  120 }   # iPhone @2x
    @{ name = 'AppIcon-60@3x.png';         size =  180 }   # iPhone @3x
    @{ name = 'AppIcon-76.png';            size =   76 }   # iPad @1x
    @{ name = 'AppIcon-76@2x.png';         size =  152 }   # iPad @2x
    @{ name = 'AppIcon-83.5@2x.png';       size =  167 }   # iPad Pro @2x
    @{ name = 'AppIcon-1024.png';          size = 1024 }   # App Store
)

# PWA targets — referenced by manifest.json.
$pwaTargets = @(
    @{ name = 'icon-192.png'; size = 192 }
    @{ name = 'icon-512.png'; size = 512 }
)

function ResizeRgb {
    param([string]$srcPath, [string]$dstPath, [int]$size)
    $bmpSrc = [System.Drawing.Image]::FromFile($srcPath)
    # 24bpp RGB — no alpha channel. Apple requires opaque app icons.
    $bmpDst = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $g      = [System.Drawing.Graphics]::FromImage($bmpDst)
    $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.DrawImage($bmpSrc, 0, 0, $size, $size)
    $g.Dispose()
    $bmpDst.Save($dstPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmpDst.Dispose()
    $bmpSrc.Dispose()
}

# ── iOS ────────────────────────────────────────────────────
Write-Host "── iOS app icon set ──"
foreach ($t in $iosTargets) {
    $dst = Join-Path $iosOut $t.name
    ResizeRgb -srcPath $src -dstPath $dst -size $t.size
    $kb = [math]::Round((Get-Item $dst).Length / 1KB, 1)
    Write-Host ("ok   {0,-30} {1,4}x{1} -> {2} KB" -f $t.name, $t.size, $kb)
}

# ── PWA ────────────────────────────────────────────────────
Write-Host "`n── PWA icons (project root) ──"
foreach ($t in $pwaTargets) {
    $dst = Join-Path $root $t.name
    ResizeRgb -srcPath $src -dstPath $dst -size $t.size
    $kb = [math]::Round((Get-Item $dst).Length / 1KB, 1)
    Write-Host ("ok   {0,-30} {1,4}x{1} -> {2} KB" -f $t.name, $t.size, $kb)
}

Write-Host "`nDone. Verify with: powershell -File .\scripts\verify-app-icons.ps1"
