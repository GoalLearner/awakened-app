# 05-verified-objectives-duel.ps1 — Verified Objectives duel:
# COUNT DISTINCT (event_type, metric_date) pairs across the four
# verified_objective_* event types. Alpha covers 4 pairs (walk+sleep on
# day -1, bedtime+strength on day -2), bravo covers 2 → alpha wins.

. (Join-Path $PSScriptRoot '_lib.ps1')

function dStr([int] $daysAgo) { (Get-Date).ToUniversalTime().AddDays($daysAgo).ToString('yyyy-MM-dd') }
function iso([int] $daysAgo)  { (Get-Date).ToUniversalTime().AddDays($daysAgo).ToString('yyyy-MM-ddTHH:mm:ss.fffZ') }

function mkObj($who, $duelId, $dayAgo, $type) {
    @{
        client_event_id = "sim-$who-vo-$duelId-$type-$dayAgo"
        event_type      = $type
        metric          = $type.Replace('verified_objective_', '')
        value           = 1
        source          = 'system_verified'
        occurred_at     = iso $dayAgo
        duel_id         = $duelId
        metric_date     = dStr $dayAgo
    }
}

$result = Invoke-DuelSim -Label '05-verified-objectives' -DuelType 'verified_objectives' -ExpectedWinner 'alpha' `
    -AlphaEvents {
        param($duelId)
        @(
            (mkObj 'alpha' $duelId -1 'verified_objective_daily_walk'),
            (mkObj 'alpha' $duelId -1 'verified_objective_sleep'),
            (mkObj 'alpha' $duelId -2 'verified_objective_bedtime'),
            (mkObj 'alpha' $duelId -2 'verified_objective_strength')
        )
    } `
    -BravoEvents {
        param($duelId)
        @(
            (mkObj 'bravo' $duelId -1 'verified_objective_daily_walk'),
            (mkObj 'bravo' $duelId -2 'verified_objective_sleep')
        )
    }

if ($result.Pass) { Write-Host "PASS  05-verified-objectives-duel  → $($result.RunDir)" -ForegroundColor Green }
else              { Write-Host "FAIL  05-verified-objectives-duel  → $($result.RunDir)" -ForegroundColor Red }
exit ([int](-not $result.Pass))
