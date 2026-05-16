# 03-bedtime-duel.ps1 — Bedtime duel: COUNT DISTINCT metric_date over
# 'bedtime_before_midnight' events. Alpha 3 nights vs bravo 2 → alpha wins.

. (Join-Path $PSScriptRoot '_lib.ps1')

function dStr([int] $daysAgo) { (Get-Date).ToUniversalTime().AddDays($daysAgo).ToString('yyyy-MM-dd') }
function iso([int] $daysAgo)  { (Get-Date).ToUniversalTime().AddDays($daysAgo).ToString('yyyy-MM-ddTHH:mm:ss.fffZ') }

$result = Invoke-DuelSim -Label '03-bedtime' -DuelType 'bedtime' -ExpectedWinner 'alpha' `
    -AlphaEvents {
        param($duelId)
        @(-1, -2, -3) | ForEach-Object {
            @{
                client_event_id = "sim-alpha-bedtime-$duelId-$_"
                event_type      = 'bedtime_before_midnight'
                metric          = 'bedtime'
                value           = 1
                source          = 'apple_health'
                occurred_at     = iso $_
                duel_id         = $duelId
                metric_date     = dStr $_
            }
        }
    } `
    -BravoEvents {
        param($duelId)
        @(-1, -2) | ForEach-Object {
            @{
                client_event_id = "sim-bravo-bedtime-$duelId-$_"
                event_type      = 'bedtime_before_midnight'
                metric          = 'bedtime'
                value           = 1
                source          = 'apple_health'
                occurred_at     = iso $_
                duel_id         = $duelId
                metric_date     = dStr $_
            }
        }
    }

if ($result.Pass) { Write-Host "PASS  03-bedtime-duel  → $($result.RunDir)" -ForegroundColor Green }
else              { Write-Host "FAIL  03-bedtime-duel  → $($result.RunDir)" -ForegroundColor Red }
exit ([int](-not $result.Pass))
