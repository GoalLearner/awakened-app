# _lib.ps1 — Shared helpers for duel sims.
#
# Loaded via `. .\_lib.ps1` at the top of each per-type script.
# Reads JWTs from sims\.secrets\, performs authenticated requests,
# captures every request/response pair to the per-run output dir,
# scrubs Authorization headers from the capture so JWTs never land
# on disk in run output.

$script:BackendBase = 'https://awakened-backend.richmondcampano93.workers.dev'

# Repo-root resolution — assumes _lib.ps1 lives in sims\scripts\.
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
        as     = $As           # NOT the JWT — just which user
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

function Write-SimSummary {
    param(
        [Parameter(Mandatory)][string] $RunDir,
        [Parameter(Mandatory)][hashtable] $Result
    )
    $md = @()
    $md += "# Sim run — $($Result.Label)"
    $md += ""
    $md += "**Result:** $($Result.Pass ? 'PASS' : 'FAIL')"
    $md += "**Started:** $($Result.Started)"
    $md += "**Finished:** $($Result.Finished)"
    $md += "**Duel ID:** $($Result.DuelId)"
    $md += ""
    $md += "## Steps"
    foreach ($s in $Result.Steps) {
        $md += "- $(if ($s.Pass) { '✅' } else { '❌' }) **$($s.Name)** — $($s.Note)"
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
