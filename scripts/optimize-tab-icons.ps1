# Resize tab-icon source PNGs from 1254x1254 down to 256x256 while
# preserving transparency. Uses .NET System.Drawing — ships with Windows,
# no install required. Outputs go next to the sources in
# assets/tab-icons/, named without the -source suffix.
#
# Usage: powershell -ExecutionPolicy Bypass -File .\scripts\optimize-tab-icons.ps1

Add-Type -AssemblyName System.Drawing

$icons = @('tab-status','tab-habits','tab-stats','tab-history','tab-dungeon','tab-items','tab-social')
$dir   = Join-Path $PSScriptRoot '..\assets\tab-icons'
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
