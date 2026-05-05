# Resize habit-icon source PNGs (transparent backgrounds) down to 192x192
# PNGs. Uses .NET System.Drawing — ships with Windows, no install required.
# Outputs go next to the sources in assets/habit-icons/, named without
# the -source suffix.
#
# Usage: powershell -ExecutionPolicy Bypass -File .\scripts\optimize-habit-icons.ps1

Add-Type -AssemblyName System.Drawing

$icons = @(
    # First batch (Morning Routine + Locked-In core)
    'icon-water','icon-sleep','icon-wake','icon-walk',
    'icon-cardio','icon-strength','icon-sunlight','icon-gratitude',
    'icon-vitamins','icon-meditate','icon-nutrition','icon-nophone',
    # Second batch (broader curated coverage)
    'icon-business','icon-cold','icon-connection','icon-finance',
    'icon-grounding','icon-journal','icon-learning','icon-mobility',
    'icon-noalcohol','icon-nocaffeine','icon-nodoomscroll','icon-noscreen-bed',
    'icon-nosugar','icon-protein','icon-read','icon-target','icon-tidy',
    # Third batch (final 8 — full curated coverage)
    'icon-sprint','icon-nosocial','icon-priority','icon-plan-tomorrow',
    'icon-screen-cap','icon-podcast','icon-pray','icon-visualize',
    # Fourth batch — pack/path entry icons (Add Habits library headers)
    'icon-pack-morning','icon-pack-lockedin','icon-pack-custom',
    # Streak/flame icon — replaces 🔥 emoji in live UI
    'icon-streak',
    # XP/lightning icon — replaces ⚡ emoji in live UI
    'icon-xp',
    # Class emblem icons — render in Status hero, class popup, awakening
    # celebration, class-choice screen
    'icon-class-civilian','icon-class-warrior','icon-class-ranger','icon-class-mage',
    'icon-class-assassin','icon-class-paladin','icon-class-merchant','icon-class-sage'
)
$dir  = Join-Path $PSScriptRoot '..\assets\habit-icons'
$dir  = (Resolve-Path $dir).Path
$size = 192

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
