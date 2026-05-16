# 06-boss-race-deferred.ps1 -- boss_race is the deferred 6th duel type
# (Phase 1z left it unsupported). This sim verifies the deferred path:
#   - Creating a boss_race duel succeeds (metadata-only)
#   - Accepting succeeds
#   - /resolve after ends_at fires returns BOSS_RACE_SCORING_DEFERRED
#     (or whatever the matching error code is) rather than silently
#     completing with a draw.

. (Join-Path $PSScriptRoot '_lib.ps1')

$runDir  = New-SimRunDir -Label '06-boss-race-deferred'
$started = Get-Date
$errors  = @()
$steps   = @()
$pass    = $true
$duelId  = $null

function Add-Step6 {
    param([string] $Name, [bool] $Pass, [string] $Note = '')
    $script:steps += @{ Name = $Name; Pass = $Pass; Note = $Note }
    if (-not $Pass) { $script:pass = $false }
}

try {
    # Idempotent friendship -- same pattern as the other sims.
    $r1 = Invoke-SimRequest -RunDir $runDir -Method POST -Path '/v1/friends/request' -As 'alpha' -Body @{ alias = 'sim_bravo' } -Label 'friend-request'
    Add-Step6 'friend-request (idempotent)' ($r1.status -in 200,409) "status=$($r1.status)"

    $r2 = Invoke-SimRequest -RunDir $runDir -Method GET -Path '/v1/friends' -As 'bravo' -Label 'bravo-fetch-friends'
    $pending = @($r2.body.incoming) | Where-Object { $_.alias -eq 'sim_alpha' } | Select-Object -First 1
    $already = @($r2.body.friends)  | Where-Object { $_.alias -eq 'sim_alpha' } | Select-Object -First 1
    if ($pending -and -not $already) {
        $r3 = Invoke-SimRequest -RunDir $runDir -Method POST -Path "/v1/friends/$($pending.id)/accept" -As 'bravo' -Label 'accept-friend'
        Add-Step6 'bravo accepts friend' ($r3.status -eq 200) ''
    } else {
        Add-Step6 'friendship already accepted' $true 'idempotent'
    }

    # Create boss_race duel -- metadata-only.
    $r4 = Invoke-SimRequest -RunDir $runDir -Method POST -Path '/v1/duels' -As 'alpha' -Body @{
        opponent_alias = 'sim_bravo'
        duration_days  = 3
        stake_souls    = 25
        duel_type      = 'boss_race'
    } -Label 'create-boss-race'
    Add-Step6 'alpha creates boss_race duel' ($r4.status -eq 200) "duel_id=$($r4.body.duel.id) type=$($r4.body.duel.duel_type)"
    $duelId = $r4.body.duel.id
    if (-not $duelId) { throw 'No duel_id for boss_race' }

    # Bravo accepts (the duel itself is metadata-valid; scoring is what's deferred).
    $r5 = Invoke-SimRequest -RunDir $runDir -Method POST -Path "/v1/duels/$duelId/accept" -As 'bravo' -Label 'accept-boss-race'
    Add-Step6 'bravo accepts boss_race' ($r5.status -eq 200 -and $r5.body.duel.status -eq 'active') ''

    # /score on a boss_race duel -- backend may return a placeholder.
    $r6 = Invoke-SimRequest -RunDir $runDir -Method GET -Path "/v1/duels/$duelId/score" -As 'alpha' -Label 'score-boss-race'
    Add-Step6 '/score returns 200 even for boss_race' ($r6.status -eq 200) "body=$($r6.body | ConvertTo-Json -Depth 4 -Compress)"

    # Force ends_at into the past with verification (boss_race still
    # needs the duel ended so /resolve can reach the deferred-code
    # branch -- otherwise it would short-circuit on DUEL_NOT_ENDED and
    # we'd never see BOSS_RACE_SCORING_DEFERRED).
    $forceEnd = Invoke-SimForceEndDuel -RunDir $runDir -DuelId $duelId
    Add-Step6 'force-end: rows_written > 0' ($forceEnd.Changes -gt 0) "changes=$($forceEnd.Changes)"
    Add-Step6 'force-end: ends_at moved into past' ($forceEnd.Pass) "before_ends=$($forceEnd.BeforeEnds) after_ends=$($forceEnd.AfterEnds)"
    if (-not $forceEnd.Pass) {
        throw "Force-end aborted: $($forceEnd.Reason). Refusing to call /resolve."
    }

    # /resolve -- expected to FAIL with BOSS_RACE_SCORING_DEFERRED.
    $r7 = Invoke-SimRequest -RunDir $runDir -Method POST -Path "/v1/duels/$duelId/resolve" -As 'alpha' -Body @{} -Label 'resolve-expect-deferred'
    $isDeferred = ($r7.status -eq 400 -or $r7.status -eq 422) -and (
        ($r7.body.code -eq 'BOSS_RACE_SCORING_DEFERRED') -or
        ($r7.raw -match 'BOSS_RACE_SCORING_DEFERRED')
    )
    Add-Step6 '/resolve rejects boss_race with deferred code' $isDeferred "status=$($r7.status) code=$($r7.body.code) raw=$($r7.raw.Substring(0, [Math]::Min(200, $r7.raw.Length)))"

    # Confirm duel remains in active state (NOT auto-completed) after deferred resolve.
    $r8 = Invoke-SimRequest -RunDir $runDir -Method GET -Path "/v1/duels/$duelId" -As 'alpha' -Label 'verify-still-active'
    $stillActive = ($r8.status -eq 200) -and ($r8.body.duel.status -in 'active', 'expired')
    Add-Step6 'duel did NOT auto-complete on deferred resolve' $stillActive "status=$($r8.body.duel.status)"

    # Verify no ledger row was written for boss_race.
    $ledgerSql = "SELECT COUNT(*) AS n FROM user_souls_ledger WHERE ref_type = 'duel' AND ref_id = '$duelId';"
    $ledger = Invoke-SimD1 -RunDir $runDir -Sql $ledgerSql -Label 'verify-no-ledger'
    Add-Step6 'ledger SQL ran cleanly' ($ledger.ok) "error=$($ledger.error.text)"
    $ledgerN = if ($ledger.results.Count -ge 1) { [int]$ledger.results[0].n } else { -1 }
    Add-Step6 'no ledger row written for boss_race' ($ledgerN -eq 0) "n=$ledgerN"

    # Clean up the unresolved boss_race duel so it doesn't linger.
    # Cancel via D1 (challenger-side cancel only works on pending; the
    # duel is active here, so we direct-update the status).
    $cancelSql = "UPDATE duels SET status = 'cancelled', resolved_at = datetime('now') WHERE id = '$duelId' AND status = 'active';"
    $cancel = Invoke-SimD1 -RunDir $runDir -Sql $cancelSql -Label 'cleanup-boss-race-duel'
    Add-Step6 'boss_race duel cancelled for cleanup' ($cancel.ok -and $cancel.changes -eq 1) "ok=$($cancel.ok) changes=$($cancel.changes) error=$($cancel.error.text)"
} catch {
    $script:pass = $false
    $script:errors += $_.ToString()
}

$finished = Get-Date
Write-SimSummary -RunDir $runDir -Result @{
    Label    = '06-boss-race-deferred'
    Pass     = $pass
    Started  = $started.ToString('o')
    Finished = $finished.ToString('o')
    DuelId   = $duelId
    Steps    = $steps
    Errors   = $errors
    RunDir   = $runDir
}

if ($pass) { Write-Host "PASS  06-boss-race-deferred  -> $runDir" -ForegroundColor Green }
else       { Write-Host "FAIL  06-boss-race-deferred  -> $runDir" -ForegroundColor Red }
exit ([int](-not $pass))
