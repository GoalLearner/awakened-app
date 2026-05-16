# run-all.ps1 — Run every sim sequentially. 60s sleep between each
# to stay well under the RL_DUELS_WRITE rate-limit cap (6/min).

$ErrorActionPreference = 'Continue'

$scripts = @(
    '01-steps-duel.ps1',
    '02-sleep-duel.ps1',
    '03-bedtime-duel.ps1',
    '04-strength-duel.ps1',
    '05-verified-objectives-duel.ps1',
    '06-boss-race-deferred.ps1'
)

$results = @()
$startedAll = Get-Date

foreach ($s in $scripts) {
    Write-Host ""
    Write-Host "── Running $s ─────────────────────────────────" -ForegroundColor Cyan
    $t0 = Get-Date
    & (Join-Path $PSScriptRoot $s)
    $code = $LASTEXITCODE
    $dt = (Get-Date) - $t0
    $results += [pscustomobject]@{
        Script   = $s
        ExitCode = $code
        Pass     = ($code -eq 0)
        Duration = $dt.TotalSeconds
    }
    # Pause between sims to keep under rate-limit (RL_DUELS_WRITE 6/min)
    if ($s -ne $scripts[-1]) {
        Write-Host "  sleeping 15s before next sim..." -ForegroundColor DarkGray
        Start-Sleep -Seconds 15
    }
}

$finishedAll = Get-Date
$totalDt = $finishedAll - $startedAll
$pass = ($results | Where-Object { -not $_.Pass }).Count -eq 0
$pcount = ($results | Where-Object { $_.Pass }).Count
$fcount = ($results | Where-Object { -not $_.Pass }).Count

Write-Host ""
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  SUMMARY" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
foreach ($r in $results) {
    $tag = if ($r.Pass) { 'PASS' } else { 'FAIL' }
    $color = if ($r.Pass) { 'Green' } else { 'Red' }
    Write-Host ("  {0}  {1,-36}  {2,5:N1}s" -f $tag, $r.Script, $r.Duration) -ForegroundColor $color
}
Write-Host ""
Write-Host ("  $pcount/$($scripts.Count) PASS · $fcount FAIL · total $('{0:N1}' -f $totalDt.TotalSeconds)s") -ForegroundColor (if ($pass) { 'Green' } else { 'Red' })
Write-Host ""

exit ([int](-not $pass))
