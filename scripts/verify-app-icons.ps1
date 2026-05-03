# Sanity-check every generated app icon: exact dimensions and no alpha.
# Apple's App Store Connect rejects builds with transparent app icons, so
# we verify PixelFormat is Format24bppRgb (or equivalent without alpha).

Add-Type -AssemblyName System.Drawing

$root   = Resolve-Path (Join-Path $PSScriptRoot '..')
$iosDir = Join-Path $root 'resources\ios\AppIcon.appiconset'

$expected = @(
    @{ path = (Join-Path $iosDir 'AppIcon-20.png');         size =   20 }
    @{ path = (Join-Path $iosDir 'AppIcon-20@2x.png');      size =   40 }
    @{ path = (Join-Path $iosDir 'AppIcon-20@2x~ipad.png'); size =   40 }
    @{ path = (Join-Path $iosDir 'AppIcon-20@3x.png');      size =   60 }
    @{ path = (Join-Path $iosDir 'AppIcon-29.png');         size =   29 }
    @{ path = (Join-Path $iosDir 'AppIcon-29@2x.png');      size =   58 }
    @{ path = (Join-Path $iosDir 'AppIcon-29@2x~ipad.png'); size =   58 }
    @{ path = (Join-Path $iosDir 'AppIcon-29@3x.png');      size =   87 }
    @{ path = (Join-Path $iosDir 'AppIcon-40.png');         size =   40 }
    @{ path = (Join-Path $iosDir 'AppIcon-40@2x.png');      size =   80 }
    @{ path = (Join-Path $iosDir 'AppIcon-40@2x~ipad.png'); size =   80 }
    @{ path = (Join-Path $iosDir 'AppIcon-40@3x.png');      size =  120 }
    @{ path = (Join-Path $iosDir 'AppIcon-60@2x.png');      size =  120 }
    @{ path = (Join-Path $iosDir 'AppIcon-60@3x.png');      size =  180 }
    @{ path = (Join-Path $iosDir 'AppIcon-76.png');         size =   76 }
    @{ path = (Join-Path $iosDir 'AppIcon-76@2x.png');      size =  152 }
    @{ path = (Join-Path $iosDir 'AppIcon-83.5@2x.png');    size =  167 }
    @{ path = (Join-Path $iosDir 'AppIcon-1024.png');       size = 1024 }
    @{ path = (Join-Path $root   'icon-192.png');           size =  192 }
    @{ path = (Join-Path $root   'icon-512.png');           size =  512 }
)

$problems = 0
foreach ($e in $expected) {
    if (-not (Test-Path $e.path)) {
        Write-Host ("MISSING  {0}" -f $e.path) -ForegroundColor Red
        $problems++; continue
    }
    $img = [System.Drawing.Image]::FromFile($e.path)
    $hasAlpha = ($img.PixelFormat -band [System.Drawing.Imaging.PixelFormat]::Alpha) -ne 0
    $okSize   = ($img.Width -eq $e.size -and $img.Height -eq $e.size)
    $okAlpha  = -not $hasAlpha
    $img.Dispose()
    $status = if ($okSize -and $okAlpha) { 'ok  ' } else { 'FAIL' }
    if (-not ($okSize -and $okAlpha)) { $problems++ }
    $name = Split-Path $e.path -Leaf
    Write-Host ("{0} {1,-30} expected {2}x{2} got {3}x{4}{5}" -f
        $status, $name, $e.size, $img.Width, $img.Height,
        $(if ($hasAlpha) { ' [HAS ALPHA]' } else { '' }))
}

Write-Host ""
if ($problems -eq 0) {
    Write-Host "All $($expected.Count) icons verified clean."
} else {
    Write-Host "$problems problem(s) detected."
    exit 1
}
