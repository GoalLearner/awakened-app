# Claude Design brief — THE READY HUNT (Awakened: Habit RPG)

Paste everything below the line into Claude Design, and attach: the current boss
sheet (any E-rank boss), the Habits tab with the hunt row, and the solo hunt result
screen. Deliverable: one handoff HTML file, which I then port into the app.

What already exists in the app (so the design builds on it, not beside it):

- **Solo bosses beaten by one real day of Apple Health data.** Steps: The Steel Wolf
  (E, 6,000), The Glass Strider (D, 7,500), The Marathon Wraith (C, 10,000). Flights
  of stairs: The Carouser (E, 5), The Ascendant Colossus (C, 10), The Unbroken Anvil
  (A, 15). Sleep: The Insomniac (E, 7 h), The Dream Tyrant (D, 7 h 30 m).
- **A hunt must be started** ("engaged") before it can be won, and starting costs
  souls by rank (E 25, D 50, C 100, A 400). A hunter's first hunt ever is free.
- **Today's activity counts even if it happened before the hunt was started.** So a
  hunter who has already walked 9,600 steps and starts the Steel Wolf wins at once.
- Today the only way to start a hunt is: Co-op / Dungeon tab → find the gate → open
  the boss → ENGAGE. Hunters who never go looking never find it. One real hunter has
  walked ~9,000 steps a day for four months and has never started a hunt.
- The **hunt result screen** (BEATEN, the kill condition, souls, the relic) exists and
  is good. Do not redesign it; the flow below ends by handing off to it.
- Notifications today: a morning briefing, a 1 PM check-in, a 7 PM check-in, and a
  9:45 PM "finish strong" for nearly-perfect days. All plain text.

---

Design **the Ready Hunt** for **Awakened: Habit RPG**, a dark fantasy habit tracker
where real steps, stairs and sleep bring down bosses. The owner's ask:

> A notification that says "your steps today would bring down a boss", for steps,
> flights climbed and sleep. They tap it and it leads them **straight to the boss to
> complete it**, without having to go to the dungeons or anything like that.

Two things to design: **the notification** and **the screen its tap opens**. The owner's
standing rule is minimal information per screen: one idea, one button.

## 1. The notification

One line of title, one line of body, the app icon. No images, no action buttons.
Three metrics, and two honest situations for each:

- **Ready now** — the app knows today's number already clears the bar.
  "9,632 steps today. The Steel Wolf is yours. Tap to strike."
- **A day like yours** — the app has not seen today yet, so it cites a real past day.
  "You walked 9,632 steps on Tuesday. A day like that brings down the Steel Wolf."

Write the copy set: for **steps**, **flights** and **sleep**, three variants of each
situation (18 lines). Sleep reads in the morning ("7 h 40 m last night. The Insomniac
did not sleep at all."); steps and flights read in the evening. Name the boss, state
the hunter's own number, never a guess. Titles ≤ 40 characters, bodies ≤ 110.

## 2. The screen the tap opens

A single bottom sheet over whatever the hunter was looking at (so closing it returns
them there). It is **not** the full boss sheet and **not** the dungeon. It has:

- the boss: art (square, framed), name, rank chip;
- **one line of proof**: the hunter's number against the bar, as a filled bar —
  "9,632 / 6,000 steps today";
- **one button**;
- one quiet line under the button for the price.

Design every state of that sheet:

| State | The proof line | The button | The quiet line |
|---|---|---|---|
| **Ready** (bar already met) | bar full, gold | **STRIKE** | "Your first hunt is free" / "Costs 25 souls · you have 80" |
| **Close** (not met yet) | bar part full, "2,400 to go" | **START THE HUNT** | same price line; "You have until midnight" |
| **Sleep, ready** | "7 h 40 m / 7 h last night" | **STRIKE** | price line |
| **Flights, ready** | "6 / 5 flights today" | **STRIKE** | price line |
| **Cannot afford it** | as above | disabled, "NOT ENOUGH SOULS" | "Costs 50 · you have 20. Seal vows to earn souls." |
| **Already beaten today** | "Beaten today" | **SEE A HARDER ONE** → the next boss up that metric reaches, or a close button if none | — |
| **Apple Health not connected** | no bar; "Awakened cannot see your steps yet" | **CONNECT APPLE HEALTH** | "Only Apple Health data counts. Nothing is entered by hand." |

**STRIKE** on a ready hunt: the sheet does a short strike (the boss art takes a hit,
gold cracks, ~500 ms), then hands straight to the existing hunt result screen. Design
that half-second and the hand-off frame only.

**START THE HUNT** on a close hunt: the button becomes the live bar ("7,200 / 10,000 ·
hunt running · ends 9:14 PM"), and the sheet can be closed. Design that running state.

If two or three bosses are ready on the same metric (9,632 steps clears the Wolf and
the Strider), the sheet offers the **highest-rank one the hunter can start**, with a
small "also ready: The Steel Wolf" line that swaps the sheet to it. Never a list.

## 3. One small thing inside the app

When the app is already open and a hunt is ready, the same fact appears once as a
single line on the existing **hunt row** at the top of the Habits tab: "9,632 steps
today · **The Steel Wolf is ready** ›". Tapping it opens the same sheet. Design that
row state only; do not redesign the row.

## What stays exactly as it is

The hunt result screen, the full boss sheet, the dungeon / co-op tab, the header, the
tab bar, co-op hunts (this is solo only), every price and every kill condition.

## Visual language (this is a live app; match it)

- Background near-black navy `#0a0a18`; cards and sheets `#13132a`, 18–22px radius;
  violet `#8b5cf6` / `#a78bfa` for structure; gold `#f5b842` for the ready state, the
  STRIKE button and the reward; steps green `#4ade80`; flights amber `#f59e0b`; sleep
  blue `#60a5fa`; red `#ef4444` only for "not enough souls"; ink `#f4f4fb` /
  `#9596b2` / `#585a76`.
- Rank chips use the app's rank colours (E grey-violet, D green, C blue, A orange).
- Fonts: **Cinzel** 700 for the boss name, **JetBrains Mono** 800 uppercase
  wide-tracked for labels, numbers and the button, system sans for sentences.
- Boss art is a framed full-bleed square painting; use a dark placeholder with the
  boss's initial. No photos, no emoji, no 3D.
- Canvas 390 × 844. **No phone frame, no status bar, no home indicator.** The sheet
  is bottom-anchored with a grab handle and must fit a 667-tall screen without
  scrolling.

## Motion + sound

Sheet rises in ≤ 250 ms. The bar fills from the hunter's last-seen number to the
current one in ~600 ms. The strike: one hit, gold cracks, a low thud, a heavy haptic.
Reduced motion: fades only, no cracks.

## Tone

The app is a system addressing a hunter: plain, a little severe, proud. No
exclamation marks, no emoji, nothing cute. Never use the words "fell" or "felled".
Never promise a number the app has not measured.

## Deliver

One HTML file with: the 18 notification lines as a plain list; the sheet in all seven
states above (steps for most, plus the sleep and flights ready states); the strike
half-second and its hand-off frame; the running state after START THE HUNT; and the
hunt row line. CSS variables for the tokens, inline SVG, small JS to switch states and
play the strike.
