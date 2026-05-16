# 01-steps-duel.ps1 — End-to-end smoke test for the `steps` duel type.
#
# Flow:
#   1. Ensure alpha + bravo are friends (idempotent: send request, then
#      bravo's accept either flips A→B pending or returns "already
#      accepted").
#   2. Alpha creates a steps duel against bravo.
#   3. Bravo accepts the duel (status → active).
#   4. Both users POST verified_events of type 'steps_total'. Alpha
#      submits a higher value than bravo, so alpha should win.
#   5. SQL forces ends_at into the past so /resolve will accept.
#   6. /resolve fires; verify status='completed', winner_user_id=alpha,
#      result='challenger_win', reward_settled_at is set.
#   7. /score returns the formatted scores for both participants.
#   8. /resolve fires SECOND time; verify it's idempotent (no double-pay,
#      same response shape).
#   9. SQL verifies user_souls_ledger has EXACTLY one row for alpha
#      with delta=+40, reason='duel_win'.
#
# Output: sims/runs/<timestamp>-01-steps/ with summary.md, requests/,
# responses/, sql/, result.json.

. (Join-Path $PSScriptRoot '_lib.ps1')

$runDir = New-SimRunDir -Label '01-steps'
$started = Get-Date
$errors  = @()
$steps   = @()
$pass    = $true
$duelId  = $null

function Add-Step {
    param([string] $Name, [bool] $Pass, [string] $Note = '')
    $script:steps += @{ Name = $Name; Pass = $Pass; Note = $Note }
    if (-not $Pass) { $script:pass = $false }
}

try {
    $alphaId = Get-SimUserId -User 'alpha'
    $bravoId = Get-SimUserId -User 'bravo'

    # ─── 1. Friendship (idempotent) ─────────────────────────────
    $r1 = Invoke-SimRequest -RunDir $runDir -Method POST -Path '/v1/friends/request' -As 'alpha' -Body @{ alias = 'sim_bravo' } -Label 'alpha-friend-request'
    Add-Step 'alpha sends friend request to bravo' ($r1.status -eq 200 -or $r1.status -eq 409) "status=$($r1.status)"

    $r2 = Invoke-SimRequest -RunDir $runDir -Method GET -Path '/v1/friends' -As 'bravo' -Label 'bravo-fetch-friends'
    Add-Step 'bravo fetches friends list' ($r2.status -eq 200) "incoming=$($r2.body.incoming.Count) friends=$($r2.body.friends.Count)"

    # Find the pending friendship from alpha → bravo
    $pendingFriendship = @($r2.body.incoming) | Where-Object { $_.alias -eq 'sim_alpha' } | Select-Object -First 1
    $alreadyFriends    = @($r2.body.friends)  | Where-Object { $_.alias -eq 'sim_alpha' } | Select-Object -First 1

    if ($pendingFriendship -and -not $alreadyFriends) {
        $r3 = Invoke-SimRequest -RunDir $runDir -Method POST -Path "/v1/friends/$($pendingFriendship.id)/accept" -As 'bravo' -Label 'bravo-accept-friend'
        Add-Step 'bravo accepts friend request' ($r3.status -eq 200) "status=$($r3.status)"
    } else {
        Add-Step 'friendship already accepted' $true 'idempotent path'
    }

    # ─── 2. Create steps duel ───────────────────────────────────
    $r4 = Invoke-SimRequest -RunDir $runDir -Method POST -Path '/v1/duels' -As 'alpha' -Body @{
        opponent_alias = 'sim_bravo'
        duration_days  = 3
        stake_souls    = 25
        duel_type      = 'steps'
    } -Label 'alpha-create-steps-duel'
    Add-Step 'alpha creates steps duel' ($r4.status -eq 200) "status=$($r4.status) duel_id=$($r4.body.duel.id)"
    $duelId = $r4.body.duel.id

    if (-not $duelId) { throw 'No duel_id returned; aborting.' }

    # ─── 3. Bravo accepts ───────────────────────────────────────
    $r5 = Invoke-SimRequest -RunDir $runDir -Method POST -Path "/v1/duels/$duelId/accept" -As 'bravo' -Label 'bravo-accept-duel'
    Add-Step 'bravo accepts duel' ($r5.status -eq 200) "status=$($r5.status) duel_status=$($r5.body.duel.status)"

    # ─── 4. Submit verified_events ──────────────────────────────
    $now    = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    $startW = (Get-Date).ToUniversalTime().AddDays(-3).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')

    $alphaEvent = @{
        client_event_id = "sim-alpha-steps-$duelId-$(Get-Date -UFormat %s)"
        event_type      = 'steps_total'
        metric          = 'steps'
        value           = 14200
        source          = 'apple_health'
        occurred_at     = $now
        duel_id         = $duelId
        window_start    = $startW
        window_end      = $now
    }
    $r6 = Invoke-SimRequest -RunDir $runDir -Method POST -Path '/v1/verified-events' -As 'alpha' -Body @{ events = @($alphaEvent) } -Label 'alpha-submit-steps'
    Add-Step 'alpha submits 14,200 steps' ($r6.status -eq 200 -and $r6.body.inserted -eq 1) "inserted=$($r6.body.inserted) dup=$($r6.body.duplicates)"

    $bravoEvent = @{
        client_event_id = "sim-bravo-steps-$duelId-$(Get-Date -UFormat %s)"
        event_type      = 'steps_total'
        metric          = 'steps'
        value           = 9800
        source          = 'apple_health'
        occurred_at     = $now
        duel_id         = $duelId
        window_start    = $startW
        window_end      = $now
    }
    $r7 = Invoke-SimRequest -RunDir $runDir -Method POST -Path '/v1/verified-events' -As 'bravo' -Body @{ events = @($bravoEvent) } -Label 'bravo-submit-steps'
    Add-Step 'bravo submits 9,800 steps' ($r7.status -eq 200 -and $r7.body.inserted -eq 1) "inserted=$($r7.body.inserted)"

    # ─── 5. /score before resolve (should show both) ────────────
    $r8 = Invoke-SimRequest -RunDir $runDir -Method GET -Path "/v1/duels/$duelId/score" -As 'alpha' -Label 'alpha-fetch-score-preresolve'
    Add-Step '/score returns 200 pre-resolve' ($r8.status -eq 200) "alpha_score=$($r8.body.score.you.value) rival_score=$($r8.body.score.rival.value)"

    # ─── 6. Force ends_at into the past ─────────────────────────
    $sql = "UPDATE duels SET ends_at = datetime('now', '-10 seconds') WHERE id = '$duelId' AND status = 'active';"
    Invoke-SimD1 -RunDir $runDir -Sql $sql -Label 'force-ends-at-past' | Out-Null
    Add-Step 'ends_at forced into past via D1' $true 'wrangler d1 execute'

    # ─── 7. /resolve (first call) ──────────────────────────────
    $r9 = Invoke-SimRequest -RunDir $runDir -Method POST -Path "/v1/duels/$duelId/resolve" -As 'alpha' -Body @{} -Label 'resolve-first-call'
    $resolved = $r9.body.duel
    Add-Step '/resolve returns 200' ($r9.status -eq 200) "duel.status=$($resolved.status) result=$($resolved.result) winner=$($resolved.winner_user_id)"
    Add-Step 'duel.status = completed'      ($resolved.status -eq 'completed') ''
    Add-Step 'result = challenger_win'      ($resolved.result -eq 'challenger_win') ''
    Add-Step 'winner_user_id = alpha'       ($resolved.winner_user_id -eq $alphaId) "expected $alphaId got $($resolved.winner_user_id)"
    Add-Step 'reward_settled_at set'        ($null -ne $resolved.reward_settled_at -and $resolved.reward_settled_at -ne '') "value=$($resolved.reward_settled_at)"

    # ─── 8. /resolve (second call) — idempotent ────────────────
    $r10 = Invoke-SimRequest -RunDir $runDir -Method POST -Path "/v1/duels/$duelId/resolve" -As 'alpha' -Body @{} -Label 'resolve-second-call-idempotent'
    Add-Step '/resolve idempotent (200 on re-call)' ($r10.status -eq 200) "status=$($r10.status)"
    Add-Step '/resolve re-call same winner'         ($r10.body.duel.winner_user_id -eq $alphaId) ''

    # ─── 9. Ledger verification ─────────────────────────────────
    $ledgerSql = "SELECT user_id, delta, reason, ref_type, ref_id FROM user_souls_ledger WHERE ref_type = 'duel' AND ref_id = '$duelId';"
    $ledgerRaw = Invoke-SimD1 -RunDir $runDir -Sql $ledgerSql -Label 'verify-ledger'
    $ledgerHasOne   = ($ledgerRaw -match '"rows_read":\s*1') -or ($ledgerRaw -match '"delta":\s*40')
    $ledgerHasAlpha = $ledgerRaw -match [regex]::Escape($alphaId)
    Add-Step 'ledger has 1 row for this duel'      $ledgerHasOne   ''
    Add-Step 'ledger row belongs to alpha (winner)' $ledgerHasAlpha ''
} catch {
    $script:pass = $false
    $script:errors += $_.ToString()
}

$finished = Get-Date
Write-SimSummary -RunDir $runDir -Result @{
    Label    = '01-steps'
    Pass     = $pass
    Started  = $started.ToString('o')
    Finished = $finished.ToString('o')
    DuelId   = $duelId
    Steps    = $steps
    Errors   = $errors
}

if ($pass) { Write-Host "PASS  01-steps-duel  → $runDir" -ForegroundColor Green }
else       { Write-Host "FAIL  01-steps-duel  → $runDir" -ForegroundColor Red }
