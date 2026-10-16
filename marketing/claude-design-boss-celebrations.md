# Claude Design brief — BOSS CELEBRATIONS (Awakened: Habit RPG, the Ascent)

Paste everything below the line into Claude Design (the Awakened project, so it can open the
files named below), and attach the three screenshots of the floor 100 fight: the battle, "The First
Awakened, Unbound is down", and the plain VICTORY result. Deliverable: one handoff HTML file, which
I then port into the app.

---

Design **the boss celebrations** for **the Ascent** in **Awakened: Habit RPG**, a dark fantasy
habit tracker: kept vows raise stats, stats and relics make power, power climbs a 100-floor tower.
The owner's ask:

> I want to make a better congratulations screen and celebration screen for all the bosses but
> especially this floor 100 boss. The end of this game was pretty weak in my opinion and there is a
> lack of celebration after every boss. I think we can take advantage by making every boss kill a
> special one for the users. Every floor has a unique celebration but the 100th floor boss should
> have the best celebration.

## What happens today

- Every tenth floor is a **milestone boss**. A win ends on the same result card as any floor: the
  hunter's avatar, VICTORY, one line ("You defeated The Dread Harbinger. Earned, not given."), a
  small "BOSS SLAIN · FLOOR 90" strip, the fight's numbers (HP left, damage dealt and taken, how it
  ended), BACK TO THE TOWER, Share this win. A boss feels like any other floor.
- **Floor 100, The First Awakened**, is a two-phase boss. When phase one drops, he rises again as
  **The First Awakened, Unbound** on a full health bar, and the hunter keeps whatever HP phase one
  left them (the Kalphite Queen rule, decided today). The first clear then plays the existing finale
  in this project, **`The Ascension - Floor 100 Finale.html`**, and opens the Hall of the Awakened
  (everyone who has finished, in order). Read that file: keep what works, and make the ending
  clearly the best moment in the game.
- Visual references in this project: **`The Ascent - Tower.html`** and **`The Matchup -
  Boosts.html`** (the screens before the fight, shipped this week).

## The bosses (real data)

| Floor | Boss | Style | Band it closes (rank colour) | Its line before the fight |
|---|---|---|---|---|
| 10 | The Hollow Footman | Melee | The Threshold (E `#8b5cf6`) | "You climbed ten floors. The tower has ten thousand." |
| 20 | The Pale Sentinel | Magic | The Undercroft (E) | "None pass while I still stand." |
| 30 | The Iron Revenant | Intense Magic | The Ashen Climb (D `#22d3ee`) | "I broke long ago. Let me show you how." |
| 40 | The Wraith Outcast | Ranged | The Hollow Reach (D) | "You will not see the blow that ends you." |
| 50 | The Ashen Reaver | Intense Melee | The Gilded Tier (C `#34d399`) | "Halfway. This is where the weak turn back." |
| 60 | The Vow-Eater | Melee | The Riven Span (C) | "Every promise you broke — I have eaten them all." |
| 70 | The Gilded Tyrant | Neutral | The Stormcrown (B `#fbbf24`) | "Kneel, and I may let you keep your title." |
| 80 | The Silent Warden | Magic | The Pale Expanse (B) | "…" |
| 90 | The Dread Harbinger | Ranged | The Sovereign Steps (A `#ef4444`) | "The summit knows your name. It is not impressed." |
| 100 | The First Awakened → Unbound | Neutral → Melee | The Summit (S `#e879f9`) | "I was the first to climb. No one has reached me since." / "You met only the mask. Now climb against what the system made of me." |

Each has its own painting (square, full-body, framed). The First Awakened has four poses: idle,
speaking, pointing, and Unbound.

## What to design

### 1. One celebration, nine bosses

A **boss-kill celebration** that plays after the killing blow of a milestone boss, **on the first
clear only** (re-fighting a beaten boss keeps today's result card). One shared structure, so it
feels like one game, with each boss **its own**:

- **its fall**: how that boss goes down, drawn from what it is (the Footman crumbles, the Silent
  Warden goes out without a sound, the Gilded Tyrant's gold cracks, the Vow-Eater gives back what
  it ate). One signature effect per boss, CSS or inline SVG over its painting;
- **its last line**: one line it says (or does not say) as it goes;
- **the band it closes**: the band's name stamped CONQUERED in its rank colour, and the next band
  opening above (the tower rail from the Tower screen can light its ten floors);
- **the numbers that made it**: the hunter's power vs its power, HP left, a FLAWLESS mark when the
  hunter took no damage.

Then one tap to continue to the result. The standing rule for celebrations in this app: **TAP TO
CONTINUE**, nothing auto-dismisses before the hunter has seen it, and one blocking moment at a time.
Write the nine last lines and describe the nine falls; show three bosses fully (10, 50, 90) and the
other six as a strip of their key frame.

### 2. Floor 100: the best moment in the game

Three beats, the last one the biggest:

1. **The Unbound rises.** Phase one drops, the bar refills, the hunter's HP stays where it is. A
   short, dramatic transition inside the fight (the mask breaks, the portrait turns Unbound, his
   line). This is the Kalphite Queen moment: the hunter should feel the floor fall out from under
   them.
2. **The killing blow.** The Unbound goes down. Hold the moment longer than any other boss.
3. **The ending.** Improve on `The Ascension - Floor 100 Finale.html`: the First Awakened passes the
   mantle; the whole tower lights, floor by floor, from 1 to 100; the title **The Second Awakened**
   (or the hunter's place in the Hall: "The 7th to awaken"); the time it took (TIME TO SUMMIT, a
   real number the app keeps); the hunter's avatar crowned; Share the summit; ENTER THE HALL.
   It should feel like the credits of a game the hunter played for months, because they did.

### 3. States to show

| State | Detail |
|---|---|
| Floor 10, first clear | The Hollow Footman, an early win |
| Floor 50, first clear, FLAWLESS | The Ashen Reaver, halfway |
| Floor 90, first clear | The Dread Harbinger, the summit next |
| The six others | One key frame each |
| A rematch of a beaten boss | Today's result card, untouched (to show the contrast) |
| Floor 100, the Unbound rising | The transition inside the fight |
| Floor 100, the ending | Every beat, in order, ending on ENTER THE HALL |
| Reduced motion | The same screens, no motion: fades only |

## Rules (this is a live app)

- **No new paintings needed for it to look finished**: boss art is the existing square paintings
  (use dark placeholders with the boss's initial); effects are CSS / inline SVG / canvas.
- **Visual language**: background near-black navy `#0a0a18`; cards `#15132f`; gold `#f5b842` for
  victory, titles and FLAWLESS; violet `#8b5cf6` / `#b79cff` for the system; rank colours as in the
  table; ink `#f5f3fb` / `#9090a8` / `#6b6b86`. Fonts: **Cinzel** 700 for names and titles,
  **Cormorant Garamond** italic for spoken lines, **JetBrains Mono** 800 uppercase for labels and
  numbers.
- **Canvas 390 × 844, no phone frame, no status bar, no home indicator.** Everything that matters
  fits a 375 × 667 screen.
- **Sound and haptics** (describe, do not build): one sting per boss kill, the bespoke First
  Awakened win music for the ending (it exists), a heavy haptic on each killing blow.
- **Tone**: a system addressing a hunter. Plain, a little severe, proud. No exclamation marks, no
  emoji, nothing cute. Never use the words "fell" or "felled".
- **Honest numbers only**: power, HP, damage, time to summit and the Hall place are real values the
  app has. Do not invent rewards; a boss kill pays nothing extra today, the climb is the reward.

## Deliver

One HTML file: the boss-kill celebration with the three full bosses and the six key frames, the
nine falls and last lines written out, the rematch contrast, the Unbound rising, and the floor 100
ending beat by beat, with a replay control for each. CSS variables for the tokens, inline SVG,
small JS to play each sequence.
