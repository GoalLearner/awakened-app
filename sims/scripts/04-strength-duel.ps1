# 04-strength-duel.ps1 — Strength duel: COUNT(*) over 'strength_workout'
# events. Alpha submits 3 workouts vs bravo's 1 → alpha wins.

. (Join-Path $PSScriptRoot '_lib.ps1')

function iso([int] $daysAgo)  { (Get-Date).ToUniversalTime().AddDays($daysAgo).ToString('yyyy-MM-ddTHH:mm:ss.fffZ') }
function dStr([int] $daysAgo) { (Get-Date).ToUniversalTime().AddDays($daysAgo).ToString('yyyy-MM-dd') }

$result = Invoke-DuelSim -Label '04-strength' -DuelType 'strength' -ExpectedWinner 'alpha' `
    -AlphaEvents {
        param($duelId)
        @(-1, -2, -3) | ForEach-Object {
            @{
                client_event_id = "sim-alpha-strength-$duelId-$_"
                event_type      = 'strength_workout'
                metric          = 'strength'
                value           = 1
                source          = 'apple_health'
                occurred_at     = iso $_
                duel_id         = $duelId
                metric_date     = dStr $_
                metadata_json   = '{"activity":"Traditional Strength Training","duration_min":35}'
            }
        }
    } `
    -BravoEvents {
        param($duelId)
        @(-1) | ForEach-Object {
            @{
                client_event_id = "sim-bravo-strength-$duelId-$_"
                event_type      = 'strength_workout'
                metric          = 'strength'
                value           = 1
                source          = 'apple_health'
                occurred_at     = iso $_
                duel_id         = $duelId
                metric_date     = dStr $_
                metadata_json   = '{"activity":"Functional Strength Training","duration_min":22}'
            }
        }
    }

if ($result.Pass) { Write-Host "PASS  04-strength-duel  → $($result.RunDir)" -ForegroundColor Green }
else              { Write-Host "FAIL  04-strength-duel  → $($result.RunDir)" -ForegroundColor Red }
exit ([int](-not $result.Pass))
