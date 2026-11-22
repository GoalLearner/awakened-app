# Claude Design brief — AUTO HUNTS (steer your automatic co-op hunts)

Paste everything below the line into Claude Design, in the same project as the Team Battles work if it still
exists. Attach two pictures: the "Your Hunts" screenshot (the sheet with the hunt cards) and the Auto Hunts
mockup picture (the long one with the four numbered screens). Deliverable: one handoff HTML file, which I
then port into the app. Nothing is built yet.

---

Design **Auto Hunts** for **Awakened: Habit RPG**: a place where a player steers the co-op hunts the game
makes for them each day. Awakened is a dark fantasy habit tracker where real, verified steps and flights
from Apple Health power an RPG. The first attached screenshot is the "Your Hunts" sheet as it is today. The
second picture is a rough mockup of the idea: use it for **what** goes where, not for how it looks. Make it
look like it belongs in the first screenshot, and better.

## How automatic hunts work today

Every day at midnight (Pacific) the game makes co-op hunts by itself: one duo hunt per friend pair, up to
three trio hunts for players with several friends, a matched partner for players with no friends, and the
Grinning God raid for active players. Each hunt's boss and goal are sized to how much the group usually
walks. The game already prefers a boss someone in the group is still missing a drop from, then rotates.
Hand-made hunts (one player summons, a friend accepts) work alongside these and stay exactly as they are.
Players today cannot see or steer any of this.

## The feature

Free for every player. Two modes:
- **Auto**: today's behavior ("Surprise me").
- **Targets**: the player picks **up to 3** bosses, or specific drops, to chase. The game then makes their
  automatic hunts on those bosses first, with partners who can actually run them. How many hunts a player
  gets a day stays decided by the game; there is no "hunts per day" control.

When two partners chase different bosses: a boss both want comes first; otherwise the pair alternates days
between each partner's target; otherwise Auto. A player with several hunts a day has their targets spread
across their partners. Changes apply at the next midnight (Pacific).

## Deliver

### 1 · The way in, on the Your Hunts sheet (show BOTH so the owner can choose)

- **A · A slim status row** at the top of the sheet, above the cards. It shows the current setting and opens
  the manager. On Targets: "Chasing: The Hollow Monarch +1 · Change". On Auto: "Auto hunts: Surprise me ·
  Manage".
- **B · A small "Manage" button** next to the ✕ in the sheet header.
- Show the sheet with each, same cards, side by side.

### 2 · Reason tags on hunt cards

A hunt the game made because of a target carries one small tag under its progress line:
- **"Your target"** when the viewer's own target picked the boss (gold, it's theirs).
- **"Oriel needs this drop"** when the partner's target picked it (quieter color).
- No tag on Auto picks or hand-made hunts.

### 3 · The manager (one screen, top to bottom)

1. **Mode switch**: Auto · Targets.
2. **Targets**, the main section: up to 3 target cards (boss art, boss name, what is chased: one drop, or
   "Any drop you're missing · 2 left", and **"Eligible with: Oriel, Thane"**), each removable; an empty
   slot "Add a target". On Auto this section shows one calm line instead.
3. **Partners**: each friend with an on/off switch for daily automatic hunts together ("Off: no daily hunts
   together" under a friend who is off).
4. **Match me with new hunters**: on/off ("When a seat is free, pair me with an active hunter").
5. **Join the raid draw**: on/off ("The Grinning God · teams of six").
6. **Tomorrow's hunts**: a live preview that updates as settings change. Each row: partner, boss, and why
   ("Your target", "Your target · Oriel wants it too", "Thane's turn: their target", "Auto").
7. A footnote: "Changes start at midnight PST."

States: Auto (nothing chosen); Targets with 1 target; Targets with 3 (Add is gone); a target that **stopped
being runnable** (its only eligible friend stopped walking): the card says "No partner can run this right
now", its hunts fall back to Auto, and the status row on Your Hunts shows the same warning, so a target
never fails silently.

### 4 · Add a target (the picker)

- A list of the automatic co-op bosses (below). Each row: art, name, rank and what it asks (steps, flights,
  or both), drops owned ("1/3 OWNED"), and **eligibility**: "Eligible with: Oriel, Thane" or "Eligible
  with: all 4 partners".
- Tap a boss to open its drops: each drop with its rarity (Rare / Ultra Rare) and a check when owned. A
  missing drop has **Chase**; the chased one shows **Chasing**. Plus "Chase any drop I'm missing".
- A boss **no current partner can run** (rank too high, or nobody walks enough) is shown but cannot be
  picked: "No current partner can run this yet". Never allow a target that would never fire.
- A boss whose drops are all owned can still be picked (to hunt it again) but says "All drops owned".

### 5 · "Chase this" on a boss page and on a drop page

A primary button on the existing boss detail and drop detail screens: "Chase this boss" / "Chase this
drop". Already chasing: it reads "Chasing" with a way to stop. Three targets already: it says so and offers
to swap one out.

### 6 · One message

A hand-made invite that would duplicate a hunt the pair already has running is refused with: "You already
have this hunt with Oriel." Show where it appears (a toast or inline on the summon sheet).

## Sample data (invented names; use these)

Viewer's partners: Oriel (A-rank), Thane (C-rank), Vey (E-rank), Marrow (B-rank, switched off).
Automatic bosses (real game content):
- **The Hollow Monarch**, B-rank, flights. Drops: The Hollow Crown (Ultra Rare), The Monarch's Writ (Rare),
  Crownpiercer (Rare, owned).
- **The Sundered Choir**, B-rank, steps + flights. Drops: The Choirmaster's Vestment (Ultra Rare), The
  Discordant Crown, The Sundered Grips, The Antiphon Striders (Rare). Nobody can run it yet.
- **The Gaunt Wardens**, C-rank, steps + flights. Drops: The Warden's Vigil (Ultra Rare), The
  Stairwalker's Treads, Famished Circlet, Gaunt Mantle (Rare). 2 of 4 owned.
- **The Coursing Dread**, C-rank, steps. Drops: The Long Pursuit, Houndsfang Recurve, Coursing Houndcall.
  All owned.
- **The Twin Maw**, E-rank, steps. Drops: Bothsight, the Long Hunt (Ultra Rare), Twin-Fang Cleaver, The
  Twofold Gaze (Rare).
- Trio bosses (three hunters): The Trinity Colossus, The Triune Sentinel, The Threefold Court, The
  Crossroads Hound.
Hunt card numbers: "4 / 8 flights together", "4,976 / 8,000 steps together", "3,172 / 4,000 steps
together", "B-RANK · 8h ›".

Names can be up to 20 characters. A developer's name may carry a small gold "M" crown beside it; leave room
for that. Numbers use thousands separators.

## Visual language (this is a live app; match the first screenshot)

- Sheet near-black `#0f0e20`; cards `linear-gradient(180deg,#191838,#121128)` with a thin red-tinted border
  `rgba(239,68,68,.32)`; radius ~20px.
- Gold `#f5b842` (yours, glory), violet `#a78bfa`, red `#ef4444` (progress bars), amber `#f5a524` (progress
  text), steps green `#4ade80`, flights amber `#f59e0b`, teal `#5eead4` for the partner tag.
- Ink `#f4f4fb`, secondary `#9a9cc0`, faint `#5d5f7e`.
- Fonts: **Cinzel** 700 for names and bosses, **JetBrains Mono** 700-800 uppercase wide-tracked for labels
  and numbers, system sans for body.
- Line-art gold SVG icons (a target reticle for "chasing"); **no emoji** (the mockup's emoji are
  placeholders), no 3D, boss art only from the existing portraits.
- Canvas 390 × 844, and check 375 × 667. **No phone frame, no status bar, no home indicator.**
- Simple: one clear thing per block, no instructions for what is self-explanatory.

## Motion

Describe it in comments (ms from mount): the manager sliding in from Your Hunts, the mode switch, a target
card appearing and leaving, the drop list opening, the preview rows updating. Haptics cues welcome (light /
medium / selection). Reduced motion: fades only.

## Tone

Plain, severe, proud. The app speaks as a system addressing hunters. No exclamation marks, nothing cute.

## Output

One HTML file with every screen and state above, labelled, CSS variables for the tokens, inline SVG, static
markup plus small JS for the switches, the picker and motion only. Name any new component and describe it
so the port is mechanical.
