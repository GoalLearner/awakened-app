# run-all.ps1 -- Run every sim sequentially. STOPS ON FIRST FAILURE.
#
# Rationale (2026-05-16): a single failing sim can leave a duel in
# `active` state on the backend. Subsequent sims then attempt to open
# a second active duel between the same alpha/bravo pair, the backend
# correctly returns 409 DUEL_ALREADY_EXISTS, and the rest of the run
# cascades into false failures driven by the FIRST failure rather than
# by anything in the later scripts. Continuing the matrix in that
# state produces a noisy "5/6 FAIL" report when the underlying
# defect is a single root cause.
#
# Halting on first failure makes the operator inspect the actual
# cause before re-running. After a failure:
#   1. Open the failed run's summary.md (path printed below).
#   2. POST /teardown via the seed worker to clean leftover state.
#   3. POST /seed to mint fresh JWTs.
#   4. Re-run the failed sim solo first.
#   5. Only re-invoke run-all.ps1 once the failure is understood.
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
$firstFailureIndex = -1

for ($i = 0; $i -lt $scripts.Count; $i++) {
    $s = $scripts[$i]
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

    if ($code -ne 0) {
        # Locate the most recent run dir matching this sim's label
        # (e.g. "01-steps") so the operator can jump straight to its
        # summary.md. The label is the part after the leading "NN-".
        $label = $s -replace '\.ps1$', '' -replace '^[0-9]+-', ''
        $runsRoot = Join-Path (Split-Path $PSScriptRoot -Parent) 'runs'
        $latest = $null
        if (Test-Path $runsRoot) {
            $latest = Get-ChildItem -Path $runsRoot -Directory -Filter "*-$label" -ErrorAction SilentlyContinue |
                Sort-Object Name -Descending |
                Select-Object -First 1
        }

        Write-Host ""
        Write-Host "===================================================" -ForegroundColor Red
        Write-Host "  STOP ON FIRST FAILURE" -ForegroundColor Red
        Write-Host "===================================================" -ForegroundColor Red
        Write-Host "  $s FAILED (exit=$code)" -ForegroundColor Red
        if ($latest) {
            Write-Host "  Failed run folder:  $($latest.FullName)" -ForegroundColor Yellow
            Write-Host "  Inspect:            $((Join-Path $latest.FullName 'summary.md'))" -ForegroundColor Yellow
        } else {
            Write-Host "  Could not locate a run folder under $runsRoot matching '$label'." -ForegroundColor Yellow
        }
        Write-Host ""
        Write-Host "  Next steps:" -ForegroundColor Yellow
        Write-Host "    1. Open the run's summary.md to see which checkpoint failed." -ForegroundColor Gray
        Write-Host "    2. Inspect responses/ in the run folder for the backend reply." -ForegroundColor Gray
        Write-Host "    3. Decide whether the failure is harness vs backend." -ForegroundColor Gray
        Write-Host "    4. Before re-invoking run-all.ps1, POST /teardown then POST /seed" -ForegroundColor Gray
        Write-Host "       so leftover active duels do not produce 409 cascades on the" -ForegroundColor Gray
        Write-Host "       next attempt." -ForegroundColor Gray
        Write-Host ""
        Write-Host "  Remaining scripts NOT executed (would likely cascade):" -ForegroundColor DarkGray
        for ($j = $i + 1; $j -lt $scripts.Count; $j++) {
            Write-Host "    - $($scripts[$j])" -ForegroundColor DarkGray
        }
        Write-Host ""
        $firstFailureIndex = $i
        break
    }

    # Pause between sims so the RL_DUELS_WRITE 60-s sliding window
    # has time to drain. See script header for the math.
    if ($i -lt $scripts.Count - 1) {
        Write-Host "  sleeping 75s before next sim..." -ForegroundColor DarkGray
        Start-Sleep -Seconds 75
    }
}

$finishedAll = Get-Date
$totalDt = $finishedAll - $startedAll
$pass = ($results | Where-Object { -not $_.Pass }).Count -eq 0
$pcount = ($results | Where-Object { $_.Pass }).Count
$fcount = ($results | Where-Object { -not $_.Pass }).Count
$skipped = $scripts.Count - $results.Count

Write-Host ""
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "  SUMMARY" -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Cyan
foreach ($r in $results) {
    $tag = if ($r.Pass) { 'PASS' } else { 'FAIL' }
    $color = if ($r.Pass) { 'Green' } else { 'Red' }
    Write-Host ("  {0}  {1,-36}  {2,5:N1}s" -f $tag, $r.Script, $r.Duration) -ForegroundColor $color
}
if ($skipped -gt 0) {
    Write-Host ("  SKIP  {0,-36}  -- ({1} script(s) not run after first failure)" -f '', $skipped) -ForegroundColor DarkGray
}
Write-Host ""
# PS 5.1 cannot use an inline `if/else` as a parameter-argument
# expression; hoist the color into a variable first.
$summaryColor = if ($pass) { 'Green' } else { 'Red' }
Write-Host ("  $pcount/$($scripts.Count) PASS - $fcount FAIL - $skipped SKIPPED - total $('{0:N1}' -f $totalDt.TotalSeconds)s") -ForegroundColor $summaryColor
Write-Host ""

exit ([int](-not $pass))
