# _lib.ps1 -- Shared helpers for duel sims.
#
# Loaded via `. .\_lib.ps1` at the top of each per-type script.
# Reads JWTs from sims\.secrets\, performs authenticated requests,
# captures every request/response pair to the per-run output dir,
# scrubs Authorization headers from the capture so JWTs never land
# on disk in run output.

$script:BackendBase = 'https://awakened-backend.richmondcampano93.workers.dev'

# Repo-root resolution -- assumes _lib.ps1 lives in sims\scripts\.
$script:RepoRoot   = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$script:SimsDir    = Join-Path $RepoRoot 'sims'
$script:SecretsDir = Join-Path $SimsDir '.secrets'
$script:RunsRoot   = Join-Path $SimsDir 'runs'

function Get-SimJwt {
    param([Parameter(Mandatory)][ValidateSet('alpha', 'bravo')] $User)
    $path = Join-Path $script:SecretsDir "$User.jwt"
    if (-not (Test-Path $path)) {
        throw "JWT file not found: $path. Run the seed worker first (backend/scripts/seed-sim-users.ts via wrangler dev --remote)."
    }
    return (Get-Content -LiteralPath $path -Raw).Trim()
}

function Get-SimUserId {
    param([Parameter(Mandatory)][ValidateSet('alpha', 'bravo')] $User)
    $path = Join-Path $script:SecretsDir "$User.userid"
    if (-not (Test-Path $path)) {
        throw "User-id file not found: $path. Run the seed worker first."
    }
    return (Get-Content -LiteralPath $path -Raw).Trim()
}

function New-SimRunDir {
    param([Parameter(Mandatory)][string] $Label)
    $ts = (Get-Date).ToString('yyyyMMdd-HHmmss')
    $dir = Join-Path $script:RunsRoot "$ts-$Label"
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $dir 'requests') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $dir 'responses') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $dir 'sql') -Force | Out-Null
    return $dir
}

# Counter for sequential request numbering inside a run.
$script:_ReqSeq = 0

function Invoke-SimRequest {
    param(
        [Parameter(Mandatory)][string] $RunDir,
        [Parameter(Mandatory)][string] $Method,
        [Parameter(Mandatory)][string] $Path,         # e.g. /v1/friends
        [Parameter(Mandatory)][ValidateSet('alpha', 'bravo')] $As,
        [object] $Body = $null,
        [string] $Label = ''
    )
    $script:_ReqSeq++
    $seq = '{0:D3}' -f $script:_ReqSeq
    $url = $script:BackendBase + $Path
    $jwt = Get-SimJwt -User $As

    $reqJson = [ordered]@{
        seq    = $seq
        label  = $Label
        method = $Method
        url    = $url
        as     = $As           # NOT the JWT -- just which user
        body   = $Body
    } | ConvertTo-Json -Depth 8

    Set-Content -LiteralPath (Join-Path $RunDir "requests/$seq-$Label.json") -Value $reqJson -Encoding utf8

    $headers = @{ 'Authorization' = "Bearer $jwt"; 'content-type' = 'application/json' }
    try {
        if ($null -ne $Body) {
            $bodyJson = ($Body | ConvertTo-Json -Depth 8 -Compress)
            $resp = Invoke-WebRequest -Uri $url -Method $Method -Headers $headers -Body $bodyJson -ErrorAction Stop
        } else {
            $resp = Invoke-WebRequest -Uri $url -Method $Method -Headers $headers -ErrorAction Stop
        }
        $status = [int] $resp.StatusCode
        $content = $resp.Content
    } catch [System.Net.WebException] {
        $err = $_.Exception
        if ($null -ne $err.Response) {
            $stream = $err.Response.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            $content = $reader.ReadToEnd()
            $status = [int] $err.Response.StatusCode
        } else {
            $content = "no response: $($err.Message)"
            $status = -1
        }
    } catch {
        $content = "exception: $_"
        $status  = -1
    }

    $respObj = [ordered]@{ seq = $seq; status = $status; body = $null; raw = $content }
    try { $respObj.body = ($content | ConvertFrom-Json -ErrorAction Stop) } catch { }
    $respJson = $respObj | ConvertTo-Json -Depth 8
    Set-Content -LiteralPath (Join-Path $RunDir "responses/$seq-$Label.json") -Value $respJson -Encoding utf8

    return [pscustomobject]@{ seq = $seq; status = $status; body = $respObj.body; raw = $content }
}

function Invoke-SimD1 {
    param(
        [Parameter(Mandatory)][string] $RunDir,
        [Parameter(Mandatory)][string] $Sql,
        [string] $Label = 'd1'
    )
    $script:_ReqSeq++
    $seq = '{0:D3}' -f $script:_ReqSeq
    Set-Content -LiteralPath (Join-Path $RunDir "sql/$seq-$Label.sql") -Value $Sql -Encoding utf8
    Push-Location (Join-Path $script:RepoRoot 'backend')
    try {
        $raw = wrangler d1 execute awakened-db --remote --json --command $Sql 2>&1
    } finally {
        Pop-Location
    }
    $rawStr = $raw -join "`n"
    Set-Content -LiteralPath (Join-Path $RunDir "responses/$seq-$Label.json") -Value $rawStr -Encoding utf8
    return $rawStr
}

function Invoke-DuelSim {
    <#
    Shared 10-checkpoint duel sim driver. Used by 02-05; 01-steps and
    06-boss-race have their own per-script flow for didactic clarity
    and to handle the deferred-error path respectively.

    Parameters:
      Label           -- sim label (e.g. '02-sleep')
      DuelType        -- one of: steps, sleep, bedtime, strength, verified_objectives
      ExpectedWinner  -- 'alpha' (challenger_win) or 'bravo' (opponent_win) or 'draw'
      AlphaEvents     -- scriptblock that takes $duelId, returns event array for alpha
      BravoEvents     -- scriptblock that takes $duelId, returns event array for bravo

    Returns: hashtable with Pass, Steps, Errors, DuelId -- caller writes summary.
    #>
    param(
        [Parameter(Mandatory)][string] $Label,
        [Parameter(Mandatory)][string] $DuelType,
        [Parameter(Mandatory)][ValidateSet('alpha', 'bravo', 'draw')] $ExpectedWinner,
        [Parameter(Mandatory)][scriptblock] $AlphaEvents,
        [Parameter(Mandatory)][scriptblock] $BravoEvents
    )

    $runDir  = New-SimRunDir -Label $Label
    $started = Get-Date
    $errors  = @()
    $steps   = @()
    $pass    = $true
    $duelId  = $null

    function Add-Step {
        param([string] $Name, [bool] $Pass, [string] $Note = '')
        $script:_simSteps += @{ Name = $Name; Pass = $Pass; Note = $Note }
        if (-not $Pass) { $script:_simPass = $false }
    }
    # Use script-scoped vars so Add-Step can mutate them.
    $script:_simSteps = $steps
    $script:_simPass  = $pass

    try {
        $alphaId = Get-SimUserId -User 'alpha'
        $bravoId = Get-SimUserId -User 'bravo'

        # 1. Friendship (idempotent)
        $r1 = Invoke-SimRequest -RunDir $runDir -Method POST -Path '/v1/friends/request' -As 'alpha' -Body @{ alias = 'sim_bravo' } -Label 'friend-request'
        Add-Step 'alpha sends friend request' ($r1.status -in 200,409) "status=$($r1.status)"

        $r2 = Invoke-SimRequest -RunDir $runDir -Method GET -Path '/v1/friends' -As 'bravo' -Label 'bravo-fetch-friends'
        Add-Step 'bravo fetches friends' ($r2.status -eq 200) ''
        $pending = @($r2.body.incoming) | Where-Object { $_.alias -eq 'sim_alpha' } | Select-Object -First 1
        $already = @($r2.body.friends)  | Where-Object { $_.alias -eq 'sim_alpha' } | Select-Object -First 1
        if ($pending -and -not $already) {
            $r3 = Invoke-SimRequest -RunDir $runDir -Method POST -Path "/v1/friends/$($pending.id)/accept" -As 'bravo' -Label 'accept-friend'
            Add-Step 'bravo accepts friend' ($r3.status -eq 200) ''
        } else {
            Add-Step 'friendship already accepted' $true 'idempotent'
        }

        # 2. Create duel
        $r4 = Invoke-SimRequest -RunDir $runDir -Method POST -Path '/v1/duels' -As 'alpha' -Body @{
            opponent_alias = 'sim_bravo'
            duration_days  = 3
            stake_souls    = 25
            duel_type      = $DuelType
        } -Label 'create-duel'
        Add-Step "alpha creates $DuelType duel" ($r4.status -eq 200) "duel_id=$($r4.body.duel.id)"
        $duelId = $r4.body.duel.id
        if (-not $duelId) { throw "No duel_id returned for $DuelType" }

        # 3. Bravo accepts
        $r5 = Invoke-SimRequest -RunDir $runDir -Method POST -Path "/v1/duels/$duelId/accept" -As 'bravo' -Label 'accept-duel'
        Add-Step 'bravo accepts duel' ($r5.status -eq 200 -and $r5.body.duel.status -eq 'active') "status=$($r5.body.duel.status)"

        # 4. Submit verified events for both
        $alphaEvts = & $AlphaEvents $duelId
        $r6 = Invoke-SimRequest -RunDir $runDir -Method POST -Path '/v1/verified-events' -As 'alpha' -Body @{ events = $alphaEvts } -Label 'alpha-events'
        Add-Step "alpha submits $($alphaEvts.Count) event(s)" ($r6.status -eq 200) "inserted=$($r6.body.inserted) dup=$($r6.body.duplicates)"

        $bravoEvts = & $BravoEvents $duelId
        $r7 = Invoke-SimRequest -RunDir $runDir -Method POST -Path '/v1/verified-events' -As 'bravo' -Body @{ events = $bravoEvts } -Label 'bravo-events'
        Add-Step "bravo submits $($bravoEvts.Count) event(s)" ($r7.status -eq 200) "inserted=$($r7.body.inserted)"

        # 5. /score pre-resolve
        $r8 = Invoke-SimRequest -RunDir $runDir -Method GET -Path "/v1/duels/$duelId/score" -As 'alpha' -Label 'score-preresolve'
        Add-Step '/score 200 pre-resolve' ($r8.status -eq 200) "you=$($r8.body.score.you.value) rival=$($r8.body.score.rival.value)"

        # 6. Force ends_at into the past
        $sql = "UPDATE duels SET ends_at = datetime('now', '-10 seconds') WHERE id = '$duelId' AND status = 'active';"
        Invoke-SimD1 -RunDir $runDir -Sql $sql -Label 'force-ends-at' | Out-Null
        Add-Step 'ends_at forced into past' $true ''

        # 7. /resolve first call
        $r9 = Invoke-SimRequest -RunDir $runDir -Method POST -Path "/v1/duels/$duelId/resolve" -As 'alpha' -Body @{} -Label 'resolve-1'
        $resolved = $r9.body.duel
        Add-Step '/resolve 200' ($r9.status -eq 200) "result=$($resolved.result) winner=$($resolved.winner_user_id)"
        Add-Step 'duel.status = completed' ($resolved.status -eq 'completed') ''

        $expectedResult  = switch ($ExpectedWinner) { 'alpha' { 'challenger_win' } 'bravo' { 'opponent_win' } default { 'draw' } }
        $expectedWinId   = switch ($ExpectedWinner) { 'alpha' { $alphaId } 'bravo' { $bravoId } default { $null } }
        Add-Step "result = $expectedResult" ($resolved.result -eq $expectedResult) "got=$($resolved.result)"
        Add-Step 'winner_user_id matches'    ($resolved.winner_user_id -eq $expectedWinId) "expected=$expectedWinId got=$($resolved.winner_user_id)"
        if ($ExpectedWinner -ne 'draw') {
            Add-Step 'reward_settled_at set' ($null -ne $resolved.reward_settled_at -and $resolved.reward_settled_at -ne '') ''
        }

        # 8. /resolve second call -- idempotent. Sleep 3s first so the
        # second call doesn't race the first into the RL_DUELS_WRITE
        # 6/min window. Idempotency contract is enforced by the SQL
        # UNIQUE on user_souls_ledger, not by call timing, so the
        # delay does not weaken the test.
        Start-Sleep -Seconds 3
        $r10 = Invoke-SimRequest -RunDir $runDir -Method POST -Path "/v1/duels/$duelId/resolve" -As 'alpha' -Body @{} -Label 'resolve-2-idempotent'
        Add-Step '/resolve idempotent (200)' ($r10.status -eq 200) ''
        Add-Step 'idempotent re-call same winner' ($r10.body.duel.winner_user_id -eq $resolved.winner_user_id) ''

        # 9. Ledger verification
        $ledgerSql = "SELECT user_id, delta, reason FROM user_souls_ledger WHERE ref_type = 'duel' AND ref_id = '$duelId';"
        $ledgerRaw = Invoke-SimD1 -RunDir $runDir -Sql $ledgerSql -Label 'verify-ledger'
        if ($ExpectedWinner -eq 'draw') {
            Add-Step 'ledger has 0 rows (draw, no reward)' (($ledgerRaw -match '"rows_read":\s*0') -or ($ledgerRaw -notmatch '"delta"')) ''
        } else {
            $hasOne   = ($ledgerRaw -match '"rows_read":\s*1') -or ($ledgerRaw -match '"delta":\s*40')
            $hasUser  = $ledgerRaw -match [regex]::Escape($expectedWinId)
            Add-Step 'ledger has 1 row'              $hasOne  ''
            Add-Step 'ledger row is the winner'      $hasUser ''
        }

        # 10. GET /duels/:id matches /resolve
        $r11 = Invoke-SimRequest -RunDir $runDir -Method GET -Path "/v1/duels/$duelId" -As 'alpha' -Label 'get-duel-postresolve'
        $cached = $r11.body.duel
        Add-Step 'GET /duels/:id 200 post-resolve'      ($r11.status -eq 200) ''
        Add-Step 'cached status = resolved status'      ($cached.status -eq $resolved.status) ''
        Add-Step 'cached result = resolved result'      ($cached.result -eq $resolved.result) ''
        Add-Step 'cached winner = resolved winner'      ($cached.winner_user_id -eq $resolved.winner_user_id) ''
        Add-Step 'cached reward_settled_at = resolved'  ($cached.reward_settled_at -eq $resolved.reward_settled_at) ''
    } catch {
        $script:_simPass = $false
        $errors += $_.ToString()
    }

    $finished = Get-Date
    $result = @{
        Label    = $Label
        Pass     = $script:_simPass
        Started  = $started.ToString('o')
        Finished = $finished.ToString('o')
        DuelId   = $duelId
        Steps    = $script:_simSteps
        Errors   = $errors
        RunDir   = $runDir
    }
    Write-SimSummary -RunDir $runDir -Result $result
    return $result
}

function Write-SimSummary {
    param(
        [Parameter(Mandatory)][string] $RunDir,
        [Parameter(Mandatory)][hashtable] $Result
    )
    $md = @()
    $md += "# Sim run -- $($Result.Label)"
    $md += ""
    $md += "**Result:** $(if ($Result.Pass) { 'PASS' } else { 'FAIL' })"
    $md += "**Started:** $($Result.Started)"
    $md += "**Finished:** $($Result.Finished)"
    $md += "**Duel ID:** $($Result.DuelId)"
    $md += ""
    $md += "## Steps"
    foreach ($s in $Result.Steps) {
        $md += "- $(if ($s.Pass) { '[PASS]' } else { '[FAIL]' }) **$($s.Name)** -- $($s.Note)"
    }
    if ($Result.Errors -and $Result.Errors.Count -gt 0) {
        $md += ""
        $md += "## Errors"
        foreach ($e in $Result.Errors) { $md += "- $e" }
    }
    Set-Content -LiteralPath (Join-Path $RunDir 'summary.md') -Value ($md -join "`n") -Encoding utf8

    $resultJson = $Result | ConvertTo-Json -Depth 8
    Set-Content -LiteralPath (Join-Path $RunDir 'result.json') -Value $resultJson -Encoding utf8
}
