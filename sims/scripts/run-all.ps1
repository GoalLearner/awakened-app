# run-all.ps1 -- Run every sim sequentially.
#
# Pacing: each sim performs ~4-6 RL_DUELS_WRITE-bucket calls per user
# (create + accept + resolve x2 + sometimes more). The CF rate-limit
# binding RL_DUELS_WRITE is 6/min on a sliding window per user, so
# back-to-back sim runs saturate the window and the next script gets
# 429s on its first write. 75s between scripts gives the window time
# to drain. (Theoretical minimum is 60s; 75s adds buffer.)
#
# Within a script, the two /resolve calls (the idempotency check) are
# separated by a 3s sleep inside Invoke-DuelSim for the same reason.

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
    Write-Host "-- Running $s ---------------------------------" -ForegroundColor Cyan
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
    # Pause between sims so the RL_DUELS_WRITE 60-s sliding window
    # has time to drain. See script header for the math.
    if ($s -ne $scripts[-1]) {
        Write-Host "  sleeping 75s before next sim..." -ForegroundColor DarkGray
        Start-Sleep -Seconds 75
    }
}

$finishedAll = Get-Date
$totalDt = $finishedAll - $startedAll
$pass = ($results | Where-Object { -not $_.Pass }).Count -eq 0
$pcount = ($results | Where-Object { $_.Pass }).Count
$fcount = ($results | Where-Object { -not $_.Pass }).Count

Write-Host ""
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "  SUMMARY" -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Cyan
foreach ($r in $results) {
    $tag = if ($r.Pass) { 'PASS' } else { 'FAIL' }
    $color = if ($r.Pass) { 'Green' } else { 'Red' }
    Write-Host ("  {0}  {1,-36}  {2,5:N1}s" -f $tag, $r.Script, $r.Duration) -ForegroundColor $color
}
Write-Host ""
# PS 5.1 cannot use an inline `if/else` as a parameter-argument
# expression; hoist the color into a variable first.
$summaryColor = if ($pass) { 'Green' } else { 'Red' }
Write-Host ("  $pcount/$($scripts.Count) PASS - $fcount FAIL - total $('{0:N1}' -f $totalDt.TotalSeconds)s") -ForegroundColor $summaryColor
Write-Host ""

exit ([int](-not $pass))
