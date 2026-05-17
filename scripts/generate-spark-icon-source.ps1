# generate-spark-icon-source.ps1 -- Rasterize The Spark brand mark
# into a 1024x1024 RGB PNG that becomes the new app-icon-source.png.
#
# v3 Phase 1z.26 -- Spark brand migration. Replaces the prior
# app-icon-source.png (legacy triangle+circle+small-flame mark)
# with the production Spark mark per ClaudeDesign brand pack:
#
#   - Gold (#f5b842) outlined triangle, apex up
#   - 3 rune-cut notches at the triangle vertices
#   - Solid gold flame teardrop centered in the triangle
#   - Mark occupies ~62% of icon edge (safe margin per spec)
#   - Background: navy linear gradient (#14143a top -> #08081a bottom)
#   - 24bpp RGB, fully opaque (Apple rejects transparent app icons)
#
# Renders the mark directly via System.Drawing.GraphicsPath -- no
# Inkscape / ImageMagick / Node dependencies. Geometry is faithful
# to assets/brand/spark.svg (the canonical SVG source).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\scripts\generate-spark-icon-source.ps1
#
# Then run:
#   powershell -ExecutionPolicy Bypass -File .\scripts\generate-app-icons.ps1
# to produce every iOS + PWA size from the new source.

Add-Type -AssemblyName System.Drawing

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$out  = Join-Path $root 'app-icon-source.png'

$size = 1024
$markEdge = [int]($size * 0.62)              # 635px
$markOriginX = [int](($size - $markEdge) / 2) # 194.5 -> 194
$markOriginY = $markOriginX
$scale = $markEdge / 100.0                    # SVG viewBox 100x100 -> markEdge px

# Gold and navy tokens
$gold     = [System.Drawing.Color]::FromArgb(255, 245, 184, 66)
$navyTop  = [System.Drawing.Color]::FromArgb(255, 20,  20,  58)   # #14143a
$navyBot  = [System.Drawing.Color]::FromArgb(255,  8,   8,  26)   # #08081a

# 24bpp RGB (no alpha) per Apple's app-icon requirement.
$bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$g   = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

# 1. Navy gradient background (linear top->bottom)
$bgRect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
$bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $bgRect, $navyTop, $navyBot, ([System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
$g.FillRectangle($bgBrush, $bgRect)
$bgBrush.Dispose()

# Helper: SVG-coord point -> bitmap-coord point (within mark group)
function P([double] $x, [double] $y) {
    return New-Object System.Drawing.PointF (($markOriginX + $x * $script:scale), ($markOriginY + $y * $script:scale))
}

# 2. Gold outline triangle (M50 12 L84 82 L16 82 Z), 3.5 SVG units stroke
$tri = New-Object System.Drawing.Drawing2D.GraphicsPath
$tri.AddPolygon(@( (P 50 12), (P 84 82), (P 16 82) ))
$tri.CloseFigure()
$triPen = New-Object System.Drawing.Pen $gold, ([single](3.5 * $scale))
$triPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$g.DrawPath($triPen, $tri)
$triPen.Dispose()
$tri.Dispose()

# 3. Three rune notches (short stroke segments at vertices), 2 SVG units stroke
$notchPen = New-Object System.Drawing.Pen $gold, ([single](2 * $scale))
$notchPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$notchPen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawLine($notchPen, (P 48 14), (P 52 14))   # top apex horizontal
$g.DrawLine($notchPen, (P 18 84), (P 22 80))   # bottom-left diagonal
$g.DrawLine($notchPen, (P 82 84), (P 78 80))   # bottom-right diagonal
$notchPen.Dispose()

# 4. Solid gold flame (M50 34 C 42 48 42 60 50 66 C 58 60 58 48 50 34 Z)
$flame = New-Object System.Drawing.Drawing2D.GraphicsPath
$flame.AddBezier((P 50 34), (P 42 48), (P 42 60), (P 50 66))
$flame.AddBezier((P 50 66), (P 58 60), (P 58 48), (P 50 34))
$flame.CloseFigure()
$flameBrush = New-Object System.Drawing.SolidBrush $gold
$g.FillPath($flameBrush, $flame)
$flameBrush.Dispose()
$flame.Dispose()

# 5. Save
$g.Dispose()
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

$kb = [math]::Round((Get-Item $out).Length / 1KB, 1)
Write-Host ("Generated {0} ({1} KB, 1024x1024 RGB, 0 alpha)" -f $out, $kb)
Write-Host ""
Write-Host "Next: powershell -ExecutionPolicy Bypass -File .\scripts\generate-app-icons.ps1"
Write-Host "      (produces iOS + PWA sizes from the new source)"
