# Awakened — App Store Screenshot Brief (2.2.7)

**Paste this into Claude Design.** The lineup is now the **owner's 5 chosen
real-device screens** (captured 2026-06-17). Claude Design's job: recreate each as
an App Store marketing shot — same screen, marketing chrome (background bloom +
Cinzel headline + framing) at **1320 × 2868** — while applying the **safe-data fixes**
below. Type / background / frame / dimension rules carry over from `aso-spec`.

> **Version story (2.2.7):** the Ascent (battle to floor 100), co-op hunts, the
> redesigned board, and shareable Hunter Report + Boss-kill cards.

---

## The lineup — 5 chosen screens

Order for the App Store (1–3 must stand alone: **promise → game → differentiator**).
Headlines ≤ 6 words, one idea each, ≤ 1 gold accent word.

| # | Source capture | Kicker | Headline | Aura | What it shows |
|---|---|---|---|---|---|
| 01 | Hunter Profile / Home | A HABIT RPG | Turn your habits into an **RPG**. | violet | The whole hunter: rank, World Rank, the Ascent tracker (60/100), the six-stat hexagon, XP. The promise in one screen. |
| 02 | Ascent battle | THE ASCENT | Battle up **100** floors. | red | Live combat — both HP bars, the move cards (Slash/Lunge/Guard/Focus), the floor + boss name. The core game. |
| 03 | Hunter Report card | WITNESSED | A rank is **witnessed**. | gold | The shareable report + the First Awakened line. The differentiator beat (and proof the app makes a shareable artifact). |
| 04 | Boss Defeated card | REAL DISCIPLINE | Bosses fall to **discipline**. | red→gold | The shareable kill card — a boss defeated by a real-world goal (10,000 steps, back-to-back days). |
| 05 | Global leaderboard | THE PROVING GROUND | Climb the weekly board. | violet→gold | The redesigned Steps board — leader card + your pinned rank + prestige stamps. Competition & belonging. |

**Headline alternates** (pick at the 25% thumbnail test):
- 02: "Battle up **100** floors." · "Climb the Ascent." · "Win your way to floor 100."
- 03: "A rank is **witnessed**." · "Rank up your hunter." · "Your discipline, witnessed."
- 04: "Bosses fall to **discipline**." · "Defeat bosses for real." · "Real goals. Real kills."
- 05: "Climb the weekly board." · "Race the weekly board."

**Trim rule:** if you ship fewer, keep 1–2–3 (promise → game → differentiator).

> **Note — what's NOT in this set:** there's no Apple Health "Auto-verified" beat
> (the trust/automation hook that explains *why* the RPG is earned, not gamed) and
> no co-op summons. Both are strong. Optional adds if you expand past 5 — but your
> 5 stand on their own.

---

## SCREEN-BY-SCREEN SAFE-DATA FIXES (do these in the recreation)

**One consistent demo hero across all 5.** The captures show **RICHIE** (your real
alias) and the Boss card is credited to **RenDIESEL** (a real user). Pick ONE demo
hero name and use it on shots 01, 03, 04, and the "YOU" row of 05 so the set reads
as one account. `aso-spec` uses **KAIROS**; use that or your own brand alias — just
keep it identical everywhere.

| Shot | Fix |
|---|---|
| 01 Profile | `RICHIE` → demo hero. This is the **canonical state** — set XP / floor / bosses / souls here and match them on every other shot. |
| 02 Battle | No aliases (safe). **Status bar** 14:27 + **SOS** + red **recording dot** → clean **9:41**, full signal/battery, no SOS, no recording. Capture the hunter at **healthy HP / winning**, not 25/172 (near-death reads as losing). |
| 03 Hunter Report | `RICHIE` → same demo hero. Numbers must match shot 01. FA quote is fine (canned string — no AI claim). |
| 04 Boss Defeated | **`RenDIESEL` → same demo hero** (real user — must change). Boss name, "10,000 steps", "KILL #2" all fine. |
| 05 Leaderboard | **Swap every real alias → demo:** `RENDIESEL`, `anthony`, `unisono`, `galilea` are real users. The `YOU` row → the demo hero. (`shadowmonarch_k` / `ascendantnova` / `ghostlift` are sim bots — safe, but consider unifying the whole board to obvious demo names.) Keep the 100K stamp only if the demo leader is genuinely a club member in the seed. |

**Number consistency (important):** the captures disagree — XP 3,000 vs 3,403,
bosses 62 vs 66, souls 505,557 vs 503,975 (floor 60 is consistent). Pick **one**
canonical hero state (from shot 01) and make XP / bosses / souls / floor identical on
every shot. A set that contradicts itself looks unfinished.

**Status bars everywhere:** lock all five to **9:41**, full battery, full signal, no
timer / SOS / recording indicators.

---

## Framing — share cards vs app screens

Shots 01, 02, 05 are app UI → the framed titanium iPhone treatment. Shots 03 & 04
are **share cards** (already vertical, marketing-ready). To keep the set consistent
and App-Review-clean (2.3.3 "real in-app UI"), **render them as they appear in the
app's share-preview screen** (inside the same device frame) rather than as bare
posters. Same background, same frame, on all five.

---

## Carry-over from `aso-spec` (unchanged)

- **Subtitle:** `A habit RPG for real growth.` (28/30) — control.
- **Caption type:** Cinzel 700 · 104px · line-height 1.08 · ivory `#f5f3fb`, ≤ 2
  lines. Kicker JetBrains Mono 800 · 31px · +7 tracking · gold, hairline-flanked.
  One optional gold accent word `#f5b842`. Center-aligned.
- **Background:** vertical navy→black `#0b0b20 → #04040d → #020207`; top aura bloom
  recolored per shot (Aura column); soft gold floor glow; heavy vignette. No literal
  scenery, no AI art.
- **Device frame:** thin titanium bezel + Dynamic Island, framed not full-bleed,
  status bar 9:41, ~6% bottom bleed, frame identical on every shot.
- **App Review:** 2.3.1 (every screen currently shipped — all 5 are), 2.3.3 (real
  in-app UI), 5.1 (privacy — the alias fixes above). No "Solo Leveling" / protected-IP
  language anywhere.

---

## Dimensions (current required size)

> Note: `aso-spec` says 1290×2796 — that's the older **6.7"**. Apple's current required
> baseline is **6.9" = 1320×2868** (matches `README.md` + `app-store-metadata.md`).

| Device | Status | Dimensions |
|---|---|---|
| iPhone 6.9" | **Required baseline** | **1320 × 2868** |
| iPhone 6.7" | derived | 1290 × 2796 |
| iPhone 6.5" | optional | 1284 × 2778 |
| iPad 13" | optional | 2064 × 2752 |

Design/export at 6.9"; Apple derives the smaller iPhones. PNG, sRGB, no alpha.

---

## After Claude Design hands back

Drop the export here and I'll wire it into `marketing/screenshot-template.html` at
exact 1320×2868, refresh `app-store-metadata.md` (lineup + 2.2.7 what's-new), and
verify each artboard renders. Then capture the 5 demo screens (consistent state,
demo aliases) → frame → upload to App Store Connect (1→5, keep 1–3 if trimming).
