# Claude Design prompt — App Store screenshot set (2.2.7)

Paste the block below into Claude Design. It assumes Claude Design already has the
Awakened app screens. Companion to `screenshot-brief-2.2.7.md` (the full brief +
per-screen safe-data fixes). Tweak the two flagged choices first (hero alias; the
canonical hero stats).

---

```
You've already designed Awakened's app screens. Now build me an APP STORE
SCREENSHOT SET — 5 marketing shots that wrap real app screens in marketing chrome,
each at the App Store 6.9" size 1320 × 2868.

SHARED TREATMENT (identical on all 5):
- Background: vertical navy→black (#0b0b20 → #04040d → #020207); a soft aura bloom
  behind the headline (recolored per shot, see below); a faint gold floor glow under
  the device; heavy vignette. No scenery, no AI art.
- Caption: centered. Kicker in JetBrains Mono 800, ~31px, +7 letter-spacing, gold
  (#f5b842), flanked by hairlines. Headline under it in Cinzel 700, ~104px,
  line-height 1.08, ivory (#f5f3fb), max 2 lines / ≤6 words. One word may be gold for
  emphasis (marked ** below).
- Device: the screen sits in a thin titanium iPhone frame with the Dynamic Island,
  status bar locked to 9:41 / full battery / full signal, bleeding ~6% off the bottom
  edge. Same frame on every shot.

THE 5 SHOTS, IN ORDER:
1. Hunter Profile / Home — kicker "A HABIT RPG" — "Turn your habits into an **RPG**" — aura violet
2. Ascent battle (the floor-climb fight: both HP bars + the move cards) — kicker "THE ASCENT" — "Battle up **100** floors" — aura red
3. Hunter Report share card — kicker "WITNESSED" — "A rank is **witnessed**" — aura gold
4. Boss Defeated share card — kicker "REAL DISCIPLINE" — "Bosses fall to **discipline**" — aura red→gold
5. Global Steps leaderboard (the redesigned board) — kicker "THE PROVING GROUND" — "Climb the weekly board" — aura violet→gold

HARD RULES:
- All demo data. Use ONE consistent hero on shots 1, 3, 4 and the "YOU" row of shot 5
  (RICHIE is fine — it's the owner's account). But every OTHER name on the leaderboard
  must be an obvious demo alias (VESPER, ORISON, RHEA, LIRA, OSRIC) — NEVER rendiesel,
  anthony, unisono, or galilea (those are real users) and not the Boss card's
  "RenDIESEL" either.
- Keep the hero's stats IDENTICAL across every shot: Floor 60 · Rank B · Paladin ·
  62 bosses · ~505k souls · 3,000 XP. (The source captures disagree — unify them.)
- Shots 3 & 4 are share cards: render them as they appear in the in-app share-preview
  screen, inside the same device frame as the others — not as bare posters.
- No precise Apple Health numbers anywhere. No PvP / competition framing — the
  leaderboard is "witnessed, not measured."

Build all five as one cohesive series. Start with shot 1 so we can lock the chrome,
then apply it identically to 2–5. Export each at 1320 × 2868, PNG, sRGB.
```

---

## Before you paste — two choices to set

- **Hero alias:** the prompt keeps **RICHIE** (your own account — fine to show). Swap
  to a clean demo hero (e.g. KAIROS) if you'd rather. The hard rule is the OTHER
  leaderboard names must be demo aliases — never the real users rendiesel / anthony /
  unisono / galilea.
- **Canonical hero stats:** the source captures disagree (XP 3,000 vs 3,403, bosses
  62 vs 66, souls 505,557 vs 503,975). The prompt locks one set — change those numbers
  to whatever you want, but keep them identical across all five shots.
