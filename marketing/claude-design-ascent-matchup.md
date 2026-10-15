# Claude Design brief — THE MATCHUP + BOOSTS (Awakened: Habit RPG, the Ascent)

Paste everything below the line into Claude Design, and attach the two screenshots of
the floor 99 matchup (top, and scrolled to the loadout). Deliverable: one handoff HTML
file, which I then port into the app. A second brief covers the tower screen.

---

Redesign **the Matchup**, the screen between the tower and the fight in **Awakened:
Habit RPG** (a dark fantasy habit tracker), and make the hunter's **boosts** visible on
it, the Shadow Army first. The owner's ask:

> I want to make sure the shadows get shown on this stats page for the boosts.
> Overall less is more and just interactive for the user is best.

## What the screen shows today, top to bottom

FLOOR 99 · the hunter's avatar vs the foe's portrait, names, style tags · the type
read (EVEN MATCH, or a super / weak tag) · YOUR POWER 5163 vs FLOOR POWER 5325 · a
band (EVEN) with "≈47% WIN" · **FIGHT** · **Tale of the Tape**: ATTACK (Melee) 1909 vs
2574, DEFENSE (Magic) 1575 vs 1420, EDGE (Ranged) 1679 vs 1331; each row taps open to
show how the hunter's number is made (each stat's level, earned from vows, plus its
relic bonus, summing exactly to the row) · a one-line verdict · **On the Line** (a new
floor: victory climbs a floor, defeat spends a life; a beaten floor: "Reclaim · +16
souls", or nothing at stake) · **Your Loadout** (eight relic slots, tap one for its
bonuses, a totals bar, ADJUST IN ARMORY →).

Milestone bosses (every tenth floor) use a heavier version of the same screen: a
ribbon, a large portrait, the boss's taunt, CHALLENGE BOSS.

## The boosts (real rules; the fight already uses them)

They multiply the hunter's attack, defense and edge, on **regular floors only**. On
milestone floors (10, 20 … 100) none of them apply; the army "kneels at the threshold".

- **Shadow Army.** Each solo boss a hunter brings down has a 1 in 20 chance to raise
  its shadow. A marching shadow adds power by its boss's rank: E +0.75%, D +1%,
  C +1.25%, B +1.5%, A +1.75%, S +2%. How many march depends on the hunter's rank
  (E 1, D 2, C 4, B 7, A 12, S all 19); the rest wait. Example: Shadow of The Steel
  Wolf (E), of The Unbroken Anvil (A), of The Worldspine (S) = +4.5%. Shadows are
  managed in the Shadow Army roster (march or rest each one).
- **Blood Still Hot.** +10% for 30 minutes after a verified workout.
- **A friend's banner.** +1% on a floor a friend beat this week ("RAVEN’S BANNER").

Worked example with all three, base power 5,163: Blood +516, then Shadows +256, then
Banner +59 = **5,994 in the fight**. Show each boost as whole points that sum exactly
to the fight number.

**The gap to close:** today YOUR POWER and the win odds leave out the shadows and the
banner, although the fight counts them. The Tale of the Tape rows include them, but
their breakdown does not list them. The boosts appear only as small pills under the
floor label. On the new screen, the number shown is the number the fight uses, and
the hunter can see what lifted it.

## What to design

1. **Above the fold, only what decides the fight:** you vs the foe, the two powers
   (yours is the fight power), the odds, FIGHT.
2. **The boosts at a glance:** one compact mark by your power. For the army, its
   marching shadows as small sigils or portraits with the total ("+4.5%"); Blood and
   Banner as their own small marks when active. Tap → a small panel: base power, each
   boost and what it adds, fight power. For the army, each marching shadow (name, rank,
   +%) and one link to the roster.
3. **Milestone floor:** the army shown kneeling (dimmed, no number), so the hunter sees
   why their number did not rise. A few words at most.
4. **No boosts:** nothing extra on screen. No empty slot, no upsell.
5. **Tale of the Tape:** an opened row's breakdown gains a "Shadows +N" line (and Blood
   / Banner when active), so its parts still sum to the row.
6. **Less below FIGHT.** Today three modules stack under the button. Keep the Tale of
   the Tape, the stakes and the loadout reachable but folded: for example the stakes as
   one line and the loadout one tap deep. The form is your call. Nothing that matters
   may be lost: on a new floor, the fact that a loss spends a life must be visible
   before FIGHT.

The "echo" line stays when it applies ("Raven knelt here this week. Win — and avenge
them.").

## States to show

| State | Detail |
|---|---|
| Regular floor, army marching | Floor 99, the three shadows above (+4.5%) |
| Regular floor, all three boosts | Army +4.5%, Blood Still Hot +10%, a friend's banner +1% (the worked example) |
| Boosts panel open | The breakdown and the shadow list |
| Milestone boss | Floor 90 boss intro; the army kneels; no boost applies |
| No boosts | No shadows, no recent workout, no banner |
| A Tale row open | ATTACK opened, its parts including the boosts summing to the row |

## What stays exactly as it is

The fight, its odds model and its numbers; the boost rules above; the roster screen;
the Armory; the tower screen (separate brief).

## Visual language (this is a live app; match it)

- Background near-black navy `#0a0a18`; cards `#15132f`, 16px radius; gold `#f5b842`
  for your power, FIGHT and the banner; violet `#8b5cf6` / `#b79cff` for the Shadow
  Army (◈ is its glyph); crimson `#e5484d` for Blood Still Hot; teal `#5eead4` for a
  super matchup; ink `#f5f3fb` / `#9090a8` / `#6b6b86`. Shadow ranks use the app's rank
  colours: E `#8b5cf6`, D `#22d3ee`, C `#34d399`, B `#fbbf24`, A `#ef4444`,
  S `#e879f9`.
- Fonts: **Cinzel** 700 for names, **JetBrains Mono** 800 uppercase, wide-tracked, for
  labels, numbers and buttons, system sans for sentences.
- Art: the avatar and foe portraits are square framed paintings; use dark placeholders.
  Shadow sigils must be CSS or inline SVG (no new paintings).
- **No phone frame, no status bar, no home indicator.** Canvas 390 × 844; at 375 × 667
  FIGHT must be visible without scrolling.

## Motion

When the screen opens, your power counts up from base to fight power as each boost
mark lights in turn (about 700 ms total). The boosts panel opens in about 200 ms.
Reduced motion: the final number, no count.

## Tone

A system addressing a hunter: plain, a little severe, proud. No exclamation marks, no
emoji, nothing cute. Never use the words "fell" or "felled".

## Deliver

One HTML file with the screen in all six states, the boosts panel and a Tale row
opening, and the count-up. CSS variables for the tokens, inline SVG, small JS for the
interactions.
