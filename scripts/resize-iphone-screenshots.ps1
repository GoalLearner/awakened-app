# Resize iPhone screenshots to Apple's "6.5-inch Display" requirements:
# 1284 x 2778 portrait (or 2778 x 1284 landscape).
#
# Newer iPhones (15/16 Pro Max) take native screenshots at 1290 x 2796
# which Apple's 6.5" slot rejects. Scaling down by ~0.4% to 1284 x 2778
# is visually identical and uploads cleanly.
#
# Usage:
#   1. Drop your raw iPhone PNGs into  screenshots\iphone\
#   2. Run:
#        powershell -ExecutionPolicy Bypass -File .\scripts\resize-iphone-screenshots.ps1
#   3. Resized files appear in  screenshots\iphone-65\
#      Upload those to App Store Connect → iPhone 6.5" Display.

Add-Type -AssemblyName System.Drawing

$root  = Resolve-Path (Join-Path $PSScriptRoot '..')
$inDir = Join-Path $root 'screenshots\iphone'
$outDir= Join-Path $root 'screenshots\iphone-65'

# Apple 6.5" Display target — the largest dimensions the slot accepts.
$tgtPortraitW   = 1284
$tgtPortraitH   = 2778
$tgtLandscapeW  = 2778
$tgtLandscapeH  = 1284

if (-not (Test-Path $inDir)) {
    Write-Host "Input folder not found. Create it and add your iPhone PNGs:"
    Write-Host "  $inDir"
    exit 1
}
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

$files = Get-ChildItem -Path $inDir -Filter *.png
if ($files.Count -eq 0) {
    Write-Host "No PNG files in $inDir."
    exit 1
}

Write-Host "── Resizing iPhone screenshots → 1284x2778 (or 2778x1284) ──"

foreach ($f in $files) {
    $src = $f.FullName
    $dst = Join-Path $outDir $f.Name
    $img = [System.Drawing.Image]::FromFile($src)

    # Pick portrait or landscape target based on input orientation
    if ($img.Width -ge $img.Height) { $tw = $tgtLandscapeW; $th = $tgtLandscapeH }
    else                            { $tw = $tgtPortraitW;  $th = $tgtPortraitH  }

    # 24-bit RGB — Apple rejects screenshots that contain an alpha channel,
    # even when every pixel is fully opaque. This format strips alpha.
    $bmp = New-Object System.Drawing.Bitmap $tw, $th, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.Clear([System.Drawing.Color]::Black)  # paint a solid background so any source-alpha pixels flatten
    $g.DrawImage($img, 0, 0, $tw, $th)
    $g.Dispose()
    $bmp.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    $img.Dispose()

    $kb = [math]::Round((Get-Item $dst).Length / 1KB, 1)
    Write-Host ("ok   {0,-40}  {1}x{2}  ->  {3} KB" -f $f.Name, $tw, $th, $kb)
}

Write-Host ""
Write-Host "Done. Upload from: $outDir"
