# Claude Design brief — WORLDGATE MVPs (Awakened: Habit RPG)

Paste everything below the line into Claude Design. Deliverable: one handoff HTML
file with the announcement card (two variants) and the MVP badge, which I then
port into the app.

---

Design the recognition for the **Worldgate's MVPs** in **Awakened: Habit RPG**, a
dark fantasy habit tracker where real steps from Apple Health power an RPG.

**What the Worldgate is:** one giant monster the whole server fights each week.
Every verified step any hunter walks is one point of damage (1 step = 1 HP). When
the combined steps cross its HP before Sunday, the gate falls. The **three hunters
with the most steps at the moment it falls are the MVPs.**

## Deliver three things

### 1 · The MVP announcement — the version everyone sees

A full-screen card every hunter sees **once**, the next time they open the app
after the gate falls. It congratulates the whole server and honours the top three.

Content, top to bottom (data in **bold** comes from the app):
- Eyebrow: "THE WORLDGATE HAS FALLEN"
- The monster's name, big: **"The Drowned Abbot"**
- A line on the collective win: **"41 hunters · 1,284,000 steps"** and that it fell
  on **"Thu 24 Sep"**
- **The podium: the three MVPs.** For each: place (1 / 2 / 3), name (e.g.
  **Anthony**, **Ryan**, **Zynfandel**), their rank letter (**C**, **E**, **D**) and
  their steps at the moment of the kill (**28,018**). 1st is clearly the biggest
  honour. Names can be up to 20 characters. A developer's name may already carry
  a small gold "M" crown beside it; leave room for that.
- If the viewer struck the gate at all, one quiet line on their share: **"Your
  strikes: 4,472 · #7"**. Hide the line if they didn't.
- Dismissal: **tap anywhere to continue** (a "TAP TO CONTINUE" hint at the bottom,
  fading in late). No buttons, no X. This is a standing rule in this app for
  celebrations.

### 2 · The same card, when the viewer IS an MVP

Same layout, but their own podium spot is lit up as theirs ("YOU"), with one extra
line for the MVP bonus: **"+150 souls"** (1st), **"+100"** (2nd), **"+50"** (3rd).
It should feel personal, but it's still the same family as version 1.

### 3 · The MVP badge

A small mark that sits **beside a hunter's name** in the Worldgate's "Top Hunters"
list (the rows you see in the attached screenshot: avatar · name · rank letter ·
steps · progress bar). The last gate's MVPs wear it until the next gate falls.
- Must read at ~12–14px tall, sitting on the text baseline like a letter.
- Must sit cleanly next to the existing gold pixel "M" crown (one name can have both).
- Show whether they placed 1, 2 or 3, or propose one mark for all three; your call.
- Show it in context: the Top Hunters rows with three names wearing it.

## Visual language (this is a live app; match it)

The Worldgate already has its own look: see the attached screenshot, and match it.
- Card: `linear-gradient(180deg,#15142f,#100e24)`; background near-black `#0a0a18`.
- Gold `#f5b842` (the hero, glory), violet `#8b5cf6` / `#a78bfa`, red `#ef4444`
  (the monster's HP), steps green `#4ade80`.
- Ink `#f4f4fb`, secondary `#9596b2`, faint `#585a76`.
- Fonts: **Cinzel** 700 for names and the monster, **JetBrains Mono** 800 uppercase
  wide-tracked for labels and numbers, system sans for body.
- Line-art gold SVG emblems, no photos, no emoji, no 3D.
- Canvas 390 × 844. **No phone frame, no status bar, no home indicator.**
- The kill itself already has a full-screen ceremony (emblem cracks, gold
  shockwave, bounty counting up). This card comes AFTER it for hunters who saw
  that, so it should feel like the honours roll after the battle, not a second
  explosion.

## Motion

Describe entry timing in a comment (ms from mount), like: scrim, card rises,
podium places land 3 → 2 → 1 with 1st last and biggest, numbers count up, tap hint
fades in last. Add haptics cues if you want them (light / medium / heavy /
selection). Reduced motion: fades only.

## Tone

Plain, severe, proud. The app's voice is a system addressing hunters: "One
monster. All of us." No exclamation marks, no emoji, nothing cute.

## Deliver

One HTML file with all three (the everyone card, the MVP card, the badge in the
list), labelled, with CSS variables for the tokens above and inline SVG. Static
markup plus small JS for the animation only.
