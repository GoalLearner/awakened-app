# Convert iPhone App Store screenshots into iPad-sized versions by
# embedding the iPhone shot inside a dark canvas at iPad dimensions.
# Apple accepts this — the visual padding signals "designed for both
# without distorting the iPhone composition."
#
# Output: 2048 x 2732 (12.9"/13" iPad Pro portrait — the size Apple
# wants and reuses for smaller iPads).
#
# Usage:
#   1. Drop your iPhone screenshots (PNG, any iPhone resolution) into
#      .\screenshots\iphone\
#   2. Run this script:
#        powershell -ExecutionPolicy Bypass -File .\scripts\generate-ipad-screenshots.ps1
#   3. Resized files appear in .\screenshots\ipad\ — upload to
#      App Store Connect → iPad tab → Choose File.
#
# The script preserves filename and just adds the new dimensions in
# the iPad output folder.

Add-Type -AssemblyName System.Drawing

$root      = Resolve-Path (Join-Path $PSScriptRoot '..')
$inDir     = Join-Path $root 'screenshots\iphone'
$outDir    = Join-Path $root 'screenshots\ipad'

# 12.9"/13" iPad Pro portrait — the canonical size Apple wants.
$ipadW = 2048
$ipadH = 2732

# Dark canvas matches the app's primary background (--bg #13132a).
# Slight gradient adds depth without distracting.
$bgTop    = [System.Drawing.ColorTranslator]::FromHtml('#0f0f24')
$bgBottom = [System.Drawing.ColorTranslator]::FromHtml('#1a1a3a')

if (-not (Test-Path $inDir)) {
    Write-Host "Input folder not found. Create it and add your iPhone PNGs:"
    Write-Host "  $inDir"
    exit 1
}
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

$files = Get-ChildItem -Path $inDir -Filter *.png
if ($files.Count -eq 0) {
    Write-Host "No PNG files in $inDir. Drop your iPhone screenshots there and re-run."
    exit 1
}

Write-Host "── Generating iPad screenshots (${ipadW}x${ipadH}) ──"
Write-Host ""

foreach ($f in $files) {
    $src = $f.FullName
    $dst = Join-Path $outDir $f.Name

    $bmpSrc = [System.Drawing.Image]::FromFile($src)
    $srcW = $bmpSrc.Width
    $srcH = $bmpSrc.Height

    # Scale the iPhone shot so it fills ~85% of the iPad canvas height.
    # That leaves a tasteful margin top + bottom, similar to letterbox.
    $targetH = [int]($ipadH * 0.88)
    $scale   = $targetH / $srcH
    $targetW = [int]($srcW * $scale)

    # If the scaled width still exceeds 88% of the canvas (rare for
    # iPhone aspect), constrain by width instead.
    $maxW = [int]($ipadW * 0.88)
    if ($targetW -gt $maxW) {
        $scale   = $maxW / $srcW
        $targetW = $maxW
        $targetH = [int]($srcH * $scale)
    }

    $offsetX = [int](($ipadW - $targetW) / 2)
    $offsetY = [int](($ipadH - $targetH) / 2)

    # Build the iPad canvas — 24-bit RGB so the output has NO alpha channel
    # (Apple rejects screenshots that contain transparency, even fully-opaque).
    $bmpDst = New-Object System.Drawing.Bitmap $ipadW, $ipadH, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $g      = [System.Drawing.Graphics]::FromImage($bmpDst)
    $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

    # Vertical gradient background — top a touch darker, bottom a touch lighter,
    # mirrors the app's own subtle gradient feel.
    $rect  = New-Object System.Drawing.Rectangle 0, 0, $ipadW, $ipadH
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, $bgTop, $bgBottom, ([System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
    $g.FillRectangle($brush, $rect)
    $brush.Dispose()

    # Subtle drop-shadow under the embedded screenshot
    for ($i = 1; $i -le 6; $i++) {
        $alpha = [int](18 - $i * 2.5)
        if ($alpha -lt 0) { $alpha = 0 }
        $shadowColor = [System.Drawing.Color]::FromArgb($alpha, 0, 0, 0)
        $shadowBrush = New-Object System.Drawing.SolidBrush $shadowColor
        $g.FillRectangle($shadowBrush, ($offsetX - $i), ($offsetY + $i), $targetW + ($i * 2), $targetH + $i)
        $shadowBrush.Dispose()
    }

    # Draw the iPhone screenshot, centered + scaled
    $g.DrawImage($bmpSrc, $offsetX, $offsetY, $targetW, $targetH)

    $g.Dispose()
    $bmpDst.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmpDst.Dispose()
    $bmpSrc.Dispose()

    $kb = [math]::Round((Get-Item $dst).Length / 1KB, 1)
    Write-Host ("ok   {0,-40}  {1,4}x{2}  ->  {3} KB" -f $f.Name, $ipadW, $ipadH, $kb)
}

Write-Host ""
Write-Host "Done. Files in: $outDir"
Write-Host "Upload to App Store Connect → Awakened → iPad tab → Choose File."
