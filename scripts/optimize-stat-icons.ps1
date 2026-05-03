# Resize stat-icon source PNGs (transparent, varying input sizes) down to
# 192x192 PNGs. Uses .NET System.Drawing — ships with Windows, no install
# required. Outputs go next to the sources in assets/stat-icons/, named
# without the -source suffix.
#
# Usage: powershell -ExecutionPolicy Bypass -File .\scripts\optimize-stat-icons.ps1

Add-Type -AssemblyName System.Drawing

$icons = @('stat-str','stat-vit','stat-int','stat-focus','stat-will','stat-wlt')
$dir   = Join-Path $PSScriptRoot '..\assets\stat-icons'
$dir   = (Resolve-Path $dir).Path
$size  = 192

foreach ($name in $icons) {
    $src = Join-Path $dir ("$name-source.png")
    $dst = Join-Path $dir ("$name.png")
    if (-not (Test-Path $src)) { Write-Host "skip $name (no source)"; continue }

    $bmpSrc = [System.Drawing.Image]::FromFile($src)
    $bmpDst = New-Object System.Drawing.Bitmap $size, $size
    $g      = [System.Drawing.Graphics]::FromImage($bmpDst)
    $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.DrawImage($bmpSrc, 0, 0, $size, $size)
    $g.Dispose()
    $bmpDst.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmpDst.Dispose()
    $bmpSrc.Dispose()

    $kb = [math]::Round((Get-Item $dst).Length / 1KB, 1)
    Write-Host "ok   $name -> $kb KB"
}
