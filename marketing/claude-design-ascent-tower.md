# Claude Design brief — THE TOWER (Awakened: Habit RPG, the Ascent's entrance)

Paste everything below the line into Claude Design, and attach the screenshot of the
Ascent at floor 100 (the hero card and the floor list). Deliverable: one handoff HTML
file, which I then port into the app. A second brief covers the matchup screen.

---

Redesign **the Tower**: the screen a hunter sees on entering the Ascent in **Awakened:
Habit RPG**, a dark fantasy habit tracker. Kept vows raise stats, stats and relics make
power, and power climbs a 100-floor tower. The owner's ask:

> I do want to revamp this page to make it more inviting and aesthetic for users when
> they go into the tower. Overall less is more and just interactive for the user is best.

## What the tower is (facts the design must respect)

- 100 floors in ten bands of ten, each with a name and a rank tier: The Threshold
  (1–10, E), The Undercroft (11–20, E), The Ashen Climb (D), The Hollow Reach (D), The
  Gilded Tier (C), The Riven Span (C), The Stormcrown (B), The Pale Expanse (B), The
  Sovereign Steps (A), The Summit (91–100, S).
- Every floor is one foe. Regular foes come in six styles (Neutral, Melee, Magic,
  Ranged, Intense Melee, Intense Magic), one painted portrait per style. Every tenth
  floor is a milestone boss with its own painting. Floor 100 is The First Awakened,
  the final boss.
- A win climbs one floor. Free hunters may lose twice a day, then the climb closes
  until tomorrow (two hearts). Members never run out (∞ and a PREMIUM tag).
- Any beaten floor can be fought again at any time, free, never costing a life. The
  first win on a beaten floor each day pays a small souls bounty ("+16"), up to 150
  souls a day; floors that no longer pay today show nothing.
- Hunters climb for weeks: the strongest are in the 90s, most are between 10 and 60.

## What is wrong today

The screen is a ledger: one card for the next fight, then every beaten floor as an
identical grey row, newest first. A hunter at floor 100 scrolls past 99 of them.
Nothing says *tower*: no height, no sense of where you stand or of what is above. The
foe's painting is a thumbnail. Bands are a thin rule line.

## What to design

One screen, 390 × 844, that feels like standing inside the tower.

1. **The next fight is the moment.** The foe's painting large, its name, its style, the
   floor and the band. Under it, as today, one read line ("An even read — the Awakened
   favors **Flame Arrow**." with "≈43%" to its right) and one gold **FIGHT** button.
   Tapping the style line still unfolds the foe's known moves (floors 51 and up).
2. **Where you stand.** The whole climb at a glance: how high you are, how much is
   above. The app already draws a small tower silhouette that fills bottom-up on its
   Home card; this screen may echo it.
3. **The climb behind you, folded.** Each band is one line or one tile (name, tier,
   "10 of 10", its milestone boss), closed by default; tap to open its floors. Open,
   it shows the beaten floors, each tappable to fight again, with the "+16" bounty
   where it still pays. Only the current band is open on entry.
4. **The header stays small:** THE ASCENT; the equipped title chip ("Grandmaster", taps
   to the titles); POWER (taps to its breakdown); LIVES (two hearts, or ∞ with PREMIUM)
   with the "?" combat-styles button; EXIT.

Interactive means a tap or a scroll reveals more; nothing explains itself in a
sentence. The owner's standing rule: minimal information per screen, and no
instructions for anything self-explanatory.

## States to show

| State | What changes |
|---|---|
| Mid-climb, regular foe next | Floor 47, The Gilded Tier, 6 of 10; a Melee foe; free hunter with 1 of 2 lives |
| Milestone boss next | Floor 50; the boss painting; the moment is heavier |
| The summit | Floor 100, The First Awakened, 99 floors behind (the attached screenshot) |
| First visit | Floor 1, nothing behind; the whole tower is above |
| Out of lives | Free hunter, 0 of 2: FIGHT becomes a quiet locked state ("the climb resumes tomorrow"); beaten floors stay open |
| Tower climbed | All 100 beaten: no next fight; one button, ENTER THE HALL |

## Optional, only if it fits without clutter

Friends already leave marks in the tower: a **banner** on a floor a friend beat this week,
and an **echo** where a friend lost this week. If the climb view can carry a friend's
mark on a floor without a line of text, show it. If not, leave it out.

## What stays exactly as it is

The fight itself; the matchup screen that FIGHT opens (separate brief); every floor
rule above; lives, rematches and the bounty; the titles screen; the power breakdown.

## Visual language (this is a live app; match it)

- Background near-black navy `#0a0a18` to `#0e0e24`; cards `#15132f`, 16px radius;
  gold `#f5b842` for the next fight, FIGHT, milestones and bounties; violet `#a78bfa` /
  `#8b5cf6` for structure and styles; teal `#5eead4` for the foe's move; ink `#f5f3fb`
  / `#9090a8` / `#6b6b86`. Bands may tint by the app's rank colours: E `#8b5cf6`,
  D `#22d3ee`, C `#34d399`, B `#fbbf24`, A `#ef4444`, S `#e879f9`.
- Fonts: **Cinzel** 700 for names, **Cormorant Garamond** italic for the read line,
  **JetBrains Mono** 800 uppercase, wide-tracked, for labels, numbers and buttons.
- Art: square framed paintings. Use dark placeholders with the foe's initial; the app
  supplies the paintings (six style portraits, nine milestone bosses, The First
  Awakened). Any band backdrop must be CSS or inline SVG: the design must look
  finished with no new paintings.
- **No phone frame, no status bar, no home indicator.** Must also work at 375 × 667,
  with FIGHT visible without scrolling.

## Motion

On entry the view settles on the hunter's floor (a short rise, about 600 ms). Bands
open and close in about 200 ms. Reduced motion: no rise, instant open.

## Tone

A system addressing a hunter: plain, a little severe, proud. No exclamation marks, no
emoji, nothing cute. Never use the words "fell" or "felled".

## Deliver

One HTML file with the screen in all six states, the band open/close working, and the
known-moves unfold. CSS variables for the tokens, inline SVG, small JS for the
interactions.
