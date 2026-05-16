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
    <#
    Run a SQL statement against the production awakened-db via
    `wrangler d1 execute --remote --json`. Parses the JSON envelope
    so callers see structured success/error rather than a raw stdout
    blob.

    Returns a pscustomobject with:
      ok            : $true iff the command exited 0 AND the response
                      JSON parsed to an array of result blocks AND none
                      of them carry an `error` field.
      changes       : sum of `meta.changes` across result blocks (the
                      number of rows the statement actually wrote /
                      modified). Use this to detect "UPDATE matched 0
                      rows" silent failures.
      rowsRead      : sum of `meta.rows_read` across result blocks.
      results       : flattened array of every row returned (for SELECT).
      error         : { text, code, name } object when ok=$false.
                      Includes Cloudflare API errors (e.g.
                      "Authentication error [code: 10000]") which
                      previously slipped past the harness silently.
      raw           : the verbatim stdout+stderr capture, also written
                      to disk for forensics.
      exitCode      : $LASTEXITCODE from wrangler.

    The helper does NOT throw on failure -- callers decide whether a
    given SQL is allowed to no-op (e.g. teardown queries that target
    rows that may not exist) or must hard-fail (e.g. force-end-duel).
    #>
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
        $exit = $LASTEXITCODE
    } finally {
        Pop-Location
    }
    $rawStr = ($raw | Out-String).TrimEnd()
    Set-Content -LiteralPath (Join-Path $RunDir "responses/$seq-$Label.json") -Value $rawStr -Encoding utf8

    $ok = $true
    $changes = 0
    $rowsRead = 0
    $resultsFlat = @()
    $errObj = $null
    $parsed = $null

    # ── Sanitize wrangler output before JSON parsing ──────────────
    #
    # When wrangler is invoked via the npm-shim wrangler.ps1 with
    # `2>&1`, PowerShell 5.1 wraps every stderr line into a
    # NativeCommandError, prepends "node.exe :", and includes the
    # caller's stack as plain text. The output also retains real ANSI
    # CSI sequences AND -- after the NativeCommandError text round-trip
    # -- "literal" ANSI residue like `[33m`, `[43;33m`, `[0m` where
    # the leading ESC byte got lost.
    #
    # The previous parser found the FIRST `[` in the buffer (from a
    # leftover `[33m` ANSI code), tried to parse from there, and
    # crashed with "Invalid JSON primitive: 33m". This sanitization
    # pass strips both the real ANSI bytes and the literal residue,
    # then drops PS NativeCommandError wrapper lines, BEFORE the JSON
    # extraction step.

    $ansiDetected = $false

    # 1. Real ANSI CSI sequences: ESC '[' params final.
    $esc = [char]27
    $ansiRegex = [string]($esc) + '\[[0-9;?]*[ -/]*[@-~]'
    if ($rawStr -match $ansiRegex) { $ansiDetected = $true }
    $clean = $rawStr -replace $ansiRegex, ''

    # 2. Literal ANSI residue where the ESC byte was lost in
    #    stdout/stderr conversion: `[33m`, `[1m`, `[43;33m`, `[0m`, etc.
    #    Matches `[` + 1-3 digit numbers (optionally semicolon-paired)
    #    + final `m`.
    if ($clean -match '\[[0-9]{1,3}(;[0-9]{1,3})*m') { $ansiDetected = $true }
    $clean = $clean -replace '\[[0-9]{1,3}(;[0-9]{1,3})*m', ''

    # 3. PS NativeCommandError wrapper noise.
    #    - "node.exe :" line prefixes
    #    - "At C:\...\wrangler.ps1:24 char:5" stack frames
    #    - "+ ..." continuation lines (carat indicator + diagnostic text)
    #    - bare leftover unicode box-drawing residue like "Γû▓"
    $clean = $clean -replace '(?m)^node\.exe\s*:\s*', ''
    $clean = $clean -replace '(?m)^At\s+\S+:\d+\s+char:\d+.*$', ''
    $clean = $clean -replace '(?m)^\s*\+\s+.*$', ''
    $clean = $clean -replace 'Γû▓', ''

    # 4. wrangler banner tokens: after ANSI strip, the warning banner
    #    leaves literal "[WARNING]", "[INFO]", "[wrangler:info]", etc.
    #    These start with `[` and would be picked up as JSON-envelope
    #    candidates. Strip them.
    $clean = $clean -replace '\[(?:WARNING|INFO|DEBUG|ERROR|NOTE)\]', ''
    $clean = $clean -replace '\[wrangler:[^\]]+\]', ''

    # 5. Find the JSON envelope inside the cleaned text. wrangler emits
    #    the JSON LAST, after all banner / warning lines, so scanning
    #    from the right is more reliable than left-to-right. Try
    #    candidates in DESCENDING position order: last '[', last '{',
    #    first '[', first '{'. For each candidate, require the next
    #    non-whitespace character to look like a JSON token (`{`, `[`,
    #    `"`, digit, `-`, `t`/`f`/`n` for true/false/null). Anything
    #    else (e.g. `[Word]` style text we missed) is rejected before
    #    even trying ConvertFrom-Json.
    $candidates = @()
    $lastBr = $clean.LastIndexOf('[')
    if ($lastBr -ge 0) { $candidates += $lastBr }
    $lastBc = $clean.LastIndexOf('{')
    if ($lastBc -ge 0) { $candidates += $lastBc }
    $firstBr = $clean.IndexOf('[')
    if ($firstBr -ge 0 -and $candidates -notcontains $firstBr) { $candidates += $firstBr }
    $firstBc = $clean.IndexOf('{')
    if ($firstBc -ge 0 -and $candidates -notcontains $firstBc) { $candidates += $firstBc }
    $candidates = @($candidates | Sort-Object -Descending -Unique)

    foreach ($pos in $candidates) {
        if ($pos + 1 -ge $clean.Length) { continue }
        $jsonText = $clean.Substring($pos)
        # Pre-check: the char immediately after the opener must look
        # JSON-ish once whitespace is skipped. Rejects "[WARNING ..."
        # and similar banner text without going through ConvertFrom-Json.
        $rest = $jsonText.Substring(1).TrimStart()
        if ($rest.Length -gt 0) {
            $c = $rest[0]
            $isJsonish = ($c -eq '{' -or $c -eq '[' -or $c -eq '"' -or
                          $c -eq '}' -or $c -eq ']' -or $c -eq '-' -or
                          $c -eq 't' -or $c -eq 'f' -or $c -eq 'n' -or
                          [char]::IsDigit($c))
            if (-not $isJsonish) { continue }
        }
        try {
            $parsed = $jsonText | ConvertFrom-Json -ErrorAction Stop
            break
        } catch {
            $parsed = $null
        }
    }

    if ($null -eq $parsed) {
        $ok = $false
        $preview = if ($clean.Length -gt 300) { $clean.Substring(0, 300) + '...[truncated]' } else { $clean }
        $errObj = [pscustomobject]@{
            text = "could not parse wrangler JSON envelope. ansi_detected=$ansiDetected exit_code=$exit cleaned_first_300=" + $preview
            code = -1
            name = 'JsonParseError'
        }
    }

    if ($exit -ne 0) { $ok = $false }

    # Two response shapes:
    #   success: array of { results: [...], meta: { changes, rows_read, ... }, success: true }
    #   error:   { error: { text, code, name } }   OR an array whose first elt has `.error`
    if ($null -ne $parsed) {
        $blocks = if ($parsed -is [System.Array]) { $parsed } else { ,$parsed }
        foreach ($blk in $blocks) {
            if ($blk.PSObject.Properties.Name -contains 'error' -and $null -ne $blk.error) {
                $ok = $false
                $e = $blk.error
                $errObj = [pscustomobject]@{
                    text = ($e.text)
                    code = ($e.code)
                    name = ($e.name)
                }
            }
            if ($blk.PSObject.Properties.Name -contains 'meta' -and $null -ne $blk.meta) {
                if ($null -ne $blk.meta.changes)   { $changes  += [int]$blk.meta.changes }
                if ($null -ne $blk.meta.rows_read) { $rowsRead += [int]$blk.meta.rows_read }
            }
            if ($blk.PSObject.Properties.Name -contains 'results' -and $null -ne $blk.results) {
                $resultsFlat += @($blk.results)
            }
        }
    }

    return [pscustomobject]@{
        ok       = $ok
        changes  = $changes
        rowsRead = $rowsRead
        results  = $resultsFlat
        error    = $errObj
        raw      = $rawStr
        exitCode = $exit
    }
}

function Invoke-SimForceEndDuel {
    <#
    Force the named duel's ends_at into the past so /resolve will
    accept it. Verifies the UPDATE actually modified the row and that
    the new ends_at is meaningfully in the past. Returns a structured
    result with before/after timestamps + a Pass flag callers should
    assert on BEFORE calling /resolve.

    Verification steps:
      1. SELECT ends_at + status of the duel BEFORE.
         FAIL if the row is missing, already completed, or any wrangler
         auth error fires.
      2. UPDATE ... WHERE id = '<duelId>' AND status = 'active'.
         FAIL if changes != 1 (wrong id, wrong status, or wrangler
         error swallowed the operation).
      3. SELECT ends_at + status AFTER.
         FAIL if the row vanished, ends_at didn't move into the past,
         or status drifted away from 'active'.

    Returns:
      Pass        : $true iff all three steps verified clean
      Reason      : human-readable failure description (empty when Pass)
      Changes     : rows-written count from the UPDATE
      BeforeEnds  : ends_at string BEFORE update
      AfterEnds   : ends_at string AFTER update
      BeforeStat  : status BEFORE
      AfterStat   : status AFTER
    #>
    param(
        [Parameter(Mandatory)][string] $RunDir,
        [Parameter(Mandatory)][string] $DuelId
    )

    $out = [pscustomobject]@{
        Pass = $false
        Reason = ''
        Changes = 0
        BeforeEnds = ''
        AfterEnds = ''
        BeforeStat = ''
        AfterStat = ''
    }

    # SQL injection on $DuelId: it's a UUID from a backend response. We
    # still single-quote it but a UUID can't escape the literal.
    $selBefore = "SELECT status, ends_at FROM duels WHERE id = '$DuelId';"
    $r1 = Invoke-SimD1 -RunDir $RunDir -Sql $selBefore -Label 'force-end-select-before'
    if (-not $r1.ok) {
        $out.Reason = "SELECT before failed: $($r1.error.text) [code=$($r1.error.code) exit=$($r1.exitCode)]"
        return $out
    }
    if ($r1.results.Count -lt 1) {
        $out.Reason = "duel id $DuelId not found in duels table (SELECT returned 0 rows)"
        return $out
    }
    $out.BeforeStat = [string]$r1.results[0].status
    $out.BeforeEnds = [string]$r1.results[0].ends_at
    if ($out.BeforeStat -ne 'active') {
        $out.Reason = "duel already in status '$($out.BeforeStat)' before force-end (expected 'active')"
        return $out
    }

    $update = "UPDATE duels SET ends_at = datetime('now', '-10 seconds') WHERE id = '$DuelId' AND status = 'active';"
    $r2 = Invoke-SimD1 -RunDir $RunDir -Sql $update -Label 'force-end-update'
    if (-not $r2.ok) {
        $out.Reason = "UPDATE failed: $($r2.error.text) [code=$($r2.error.code) exit=$($r2.exitCode)]"
        return $out
    }
    $out.Changes = $r2.changes
    if ($r2.changes -lt 1) {
        $out.Reason = "UPDATE matched 0 rows (id mismatch or status drifted away from 'active' between SELECT and UPDATE)"
        return $out
    }

    $selAfter = "SELECT status, ends_at, (julianday('now') - julianday(ends_at)) * 86400.0 AS seconds_since_end FROM duels WHERE id = '$DuelId';"
    $r3 = Invoke-SimD1 -RunDir $RunDir -Sql $selAfter -Label 'force-end-select-after'
    if (-not $r3.ok) {
        $out.Reason = "SELECT after failed: $($r3.error.text) [code=$($r3.error.code) exit=$($r3.exitCode)]"
        return $out
    }
    if ($r3.results.Count -lt 1) {
        $out.Reason = "duel id $DuelId disappeared after UPDATE (no row returned post-update)"
        return $out
    }
    $out.AfterStat = [string]$r3.results[0].status
    $out.AfterEnds = [string]$r3.results[0].ends_at
    $secSinceEnd = [double]($r3.results[0].seconds_since_end)
    if ($secSinceEnd -lt 1.0) {
        $out.Reason = "ends_at did not move into the past after UPDATE (seconds_since_end=$secSinceEnd, after_ends=$($out.AfterEnds))"
        return $out
    }
    if ($out.AfterStat -ne 'active') {
        $out.Reason = "status drifted to '$($out.AfterStat)' after UPDATE (expected 'active')"
        return $out
    }

    $out.Pass = $true
    return $out
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

        # 6. Force ends_at into the past. Verified end-to-end:
        # SELECT before, UPDATE with row-count check, SELECT after with
        # past-timestamp check. If ANY of these fail, abort the sim
        # before calling /resolve -- a successful-looking /resolve on a
        # still-future duel would be a misleading green.
        $forceEnd = Invoke-SimForceEndDuel -RunDir $runDir -DuelId $duelId
        Add-Step 'force-end SQL: rows_written > 0' ($forceEnd.Changes -gt 0) "changes=$($forceEnd.Changes)"
        Add-Step 'force-end SQL: ends_at moved into past' ($forceEnd.Pass) "before_ends=$($forceEnd.BeforeEnds) after_ends=$($forceEnd.AfterEnds) before_status=$($forceEnd.BeforeStat) after_status=$($forceEnd.AfterStat)"
        if (-not $forceEnd.Pass) {
            throw "Force-end aborted: $($forceEnd.Reason). Refusing to call /resolve on a duel that was not actually ended."
        }

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

        # 9. Ledger verification -- structured Invoke-SimD1 result.
        $ledgerSql = "SELECT user_id, delta, reason FROM user_souls_ledger WHERE ref_type = 'duel' AND ref_id = '$duelId';"
        $ledger = Invoke-SimD1 -RunDir $runDir -Sql $ledgerSql -Label 'verify-ledger'
        Add-Step 'ledger SQL ran cleanly' ($ledger.ok) "rows_read=$($ledger.rowsRead) error=$($ledger.error.text)"
        $rows = @($ledger.results)
        if ($ExpectedWinner -eq 'draw') {
            Add-Step 'ledger has 0 rows (draw, no reward)' ($rows.Count -eq 0) "rows=$($rows.Count)"
        } else {
            $hasOne = ($rows.Count -eq 1)
            $hasUser = $false
            $winnerDelta = $null
            if ($hasOne) {
                $hasUser = ([string]$rows[0].user_id -eq [string]$expectedWinId)
                $winnerDelta = $rows[0].delta
            }
            Add-Step 'ledger has 1 row'         $hasOne  "rows=$($rows.Count)"
            Add-Step 'ledger row is the winner' $hasUser "ledger_user=$($rows[0].user_id) expected=$expectedWinId"
            Add-Step 'ledger delta = +40'       ($winnerDelta -eq 40) "delta=$winnerDelta"
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
