# Claude Design brief — SOLO HUNT RESULTS: victory + defeat (Awakened: Habit RPG)

Paste everything below the line into Claude Design **in the same project as the co-op
hunt results**, and attach a screenshot of that co-op design so the two match.
Deliverable: one handoff HTML file, which I then port.

---

Design the **solo** twin of the Co-op Hunt Results you just made: the screens a
hunter sees when a **solo boss hunt** ends. Same family, same layout language, same
tokens as the co-op victory/defeat screens: someone should recognise it as the same
system, just a party of one.

**What a solo hunt is:** a hunter picks a boss from their dungeon (e.g. **The Steel
Wolf**, **The Insomniac**) and has a window to meet its **kill condition** with real,
Apple-Health-verified effort, e.g. **"Walk 6,000 steps in a day"**, **"Sleep 7+ hours"**,
**"A 30-minute workout"**. Meet it and the boss falls, dropping souls and maybe a relic.
Miss the window and the boss **escapes**.

## Screen 1 · VICTORY

Content (data in **bold** comes from the app):
- The boss portrait (square art exists in the app; use a placeholder), name **The
  Insomniac**, rank **D**, beaten. The emotional peak is the hunter's own effort
  breaking it, one mark instead of two coming together.
- What did it: the kill condition, **"Slept 7h 42m"** / **"8,214 steps in a day"**.
- Which kill: **"First kill"** (bigger moment) or **"3rd kill"** (quieter).
- The reward: **+120 souls**, and either a relic (**"Nightwarden's Veil · Rare"**) or
  "souls only this time". A rare-or-better relic has its own reveal ceremony that plays
  after this screen, so just name it here.
- **Tap anywhere to continue** ("TAP TO CONTINUE" fading in late). No buttons.

Variants: **first kill with a relic**, and **a repeat kill, souls only**.

## Screen 2 · DEFEAT (the boss escaped)

The same sting-then-resolve as the co-op defeat, but personal and never shaming.
- The boss **escaped**: dimmed, unbroken, crimson register.
- What it asked: **"Walk 6,000 steps in a day"**, and, when the app knows it, **how close
  the best day came: "Best day: 5,410 / 6,000 steps · 90%"**. Near miss (≥ 80%) gets the
  "so close it hurts" treatment; far off stays dignified.
- **One action: "Hunt again"** (restarts this boss's hunt), plus a quiet "Not now".
- No souls, no relic, no blame.

## Keep from the co-op design

Everything visual: tokens, type, the portrait frame, how the victory crack/strike and
the defeat crimson work, the stat rows, the souls/relic pair of cards, the button style,
the motion and sound language. Only the content changes. Where co-op shows the party,
solo shows the one hunter's effort against the condition.

## Words the app never uses

Never write **"fell" / "felled"** in the copy (a standing brand rule). "Beaten",
"broken", "brought down" and "escaped" are all fine.

## Deliver

One HTML file with: victory (first kill + relic), victory (repeat, souls only), defeat
near miss, defeat far off. Same comment block format as the co-op file (entry timing in ms,
haptics, sound, reduced motion).
