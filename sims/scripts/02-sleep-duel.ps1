# 02-sleep-duel.ps1 -- Sleep duel: COUNT DISTINCT metric_date over
# 'sleep_7h_night' events. Alpha submits 3 nights, bravo 2 -> alpha wins.

. (Join-Path $PSScriptRoot '_lib.ps1')

function dStr([int] $daysAgo) { (Get-Date).ToUniversalTime().AddDays($daysAgo).ToString('yyyy-MM-dd') }
function iso([int] $daysAgo)  { (Get-Date).ToUniversalTime().AddDays($daysAgo).ToString('yyyy-MM-ddTHH:mm:ss.fffZ') }

$result = Invoke-DuelSim -Label '02-sleep' -DuelType 'sleep' -ExpectedWinner 'alpha' `
    -AlphaEvents {
        param($duelId)
        @(-1, -2, -3) | ForEach-Object {
            @{
                client_event_id = "sim-alpha-sleep-$duelId-$_"
                event_type      = 'sleep_7h_night'
                metric          = 'sleep'
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
                client_event_id = "sim-bravo-sleep-$duelId-$_"
                event_type      = 'sleep_7h_night'
                metric          = 'sleep'
                value           = 1
                source          = 'apple_health'
                occurred_at     = iso $_
                duel_id         = $duelId
                metric_date     = dStr $_
            }
        }
    }

if ($result.Pass) { Write-Host "PASS  02-sleep-duel  -> $($result.RunDir)" -ForegroundColor Green }
else              { Write-Host "FAIL  02-sleep-duel  -> $($result.RunDir)" -ForegroundColor Red }
exit ([int](-not $result.Pass))
