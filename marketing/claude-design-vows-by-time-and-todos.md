# Claude Design brief — VOWS BY TIME OF DAY + TO-DOS (Awakened: Habit RPG)

Paste everything below the line into Claude Design, and attach the current Habits
tab screenshot. Deliverable: one handoff HTML file, which I then port into the app.

What already exists in the app (so the design builds on it, not beside it): every
library vow already carries a time of day (morning / day / evening — 13 / 4 / 6 of
them); custom vows don't. Each vow already has an optional reminder time and a
weekday schedule (the "Schedule" sheet). There is no to-do list of any kind.

---

Redesign the **Habits tab** of **Awakened: Habit RPG**, a dark fantasy habit tracker
where real daily habits ("vows") power an RPG climb. Two additions, from the owner:

1. **Vows grouped by time of day**, so the list reads like a day, not a pile.
2. **To-dos**: one-off tasks with an optional due day and reminder, so hunters can
   run their whole day from the app, not just their daily habits.

The tab is the most-used screen in the app. Keep it simple; the owner's standing
rule is minimal information per screen.

## 1. Vows by time of day

Today the list is one flat stack under "SEAL YOUR VOWS" with a TODAY / LEDGER
toggle. Make it three sections in order of the day:

- **MORNING** · **DAY** · **EVENING** — each a header with the count ("MORNING · 3 of 5")
  and a thin progress hairline; tapping the header collapses it. The section whose
  hour it is (morning until 11, day until 17, evening after) is open and gently lit;
  the others start open too but can fold. Completed vows sink to the bottom of their
  section, not off the screen.
- The vow row itself stays as it is (icon, name, stat chip, the seal circle on the
  right); do not redesign the row.
- A custom vow gets a time-of-day choice when it's created or edited: a three-pill
  control, default **Day**. Show that control on the create/edit sheet (attached
  screen has it today with Easy/Medium/Hard; place it beside).
- "Complete your routine for +3 XP" (the pack bonus line) stays above the sections.

## 2. To-dos

A to-do is a **one-off**: "Book dentist", "Return the library book", "Call Dad".
It is not a vow: no streak, no stat, no Perfect Day, and it disappears when done.

- Where: a third pill in the existing toggle — **TODAY · TO-DO · LEDGER**. Or a
  **TO-DO** section under EVENING with its own header; propose the one that keeps
  the vow list uncluttered (the owner tends to prefer fewer screens over more).
- The composer: one line at the top of the to-do view, "Add a to-do", and a return
  key adds it. Optional, one tap each: a **due day** (Today / Tomorrow / pick a
  date) and a **reminder time**. No categories, no priority, no notes in v1.
- The row: a square check on the left (vows use a circle, so the two never get
  confused), the text, and a small due chip on the right ("Today", "Tomorrow",
  "Fri", or red "Overdue"). Overdue to-dos rise to the top.
- Done: the row strikes through with a short satisfying tick, then slides into a
  collapsed **DONE · 4** group at the bottom that clears after seven days. Undo by
  tapping again inside that group.
- Reward: a to-do pays **+1 XP** on completion, at most **five a day**, and shows
  "+1 XP" the same way a vow does. Nothing else: no souls, no stats, no streaks.
  (This keeps to-dos from becoming an XP farm and keeps vows the real climb.)
- Empty state: one line, "Nothing waiting. Add a to-do above." No illustration.
- The Today's Briefing (the morning screen) may carry one line "**3 to-dos due
  today**" under the Worldgate line; design that line only.

## What stays exactly as it is

The header (rank, world rank, bosses), the tab bar, the hunt row, the vow row
design, the LEDGER view, the "SEAL A NEW VOW" button at the bottom.

## Visual language (this is a live app; match it)

- Background near-black navy `#0a0a18`; cards `#13132a`, 18–22px radius, thin warm
  gold border on the active card; violet `#8b5cf6` / `#a78bfa` for structure; gold
  `#f5b842` only for the reward moment and the active section; steps green `#4ade80`
  for done; red `#ef4444` only for Overdue; ink `#f4f4fb` / `#9596b2` / `#585a76`.
- Fonts: **Cinzel** 700 for section titles, **JetBrains Mono** 800 uppercase
  wide-tracked for labels and counts, system sans for row text.
- Line-art gold SVG glyphs for MORNING (a low sun), DAY (a full sun), EVENING (a
  moon); no photos, no emoji, no 3D.
- Canvas 390 × 844. **No phone frame, no status bar, no home indicator.**

## Motion + sound

Section fold/unfold ≤ 200 ms. The to-do tick: strike-through drawn left to right in
~180 ms, light haptic, the app's short sine tick. Reduced motion: fades only.

## Tone

The app is a system addressing a hunter: plain, a little severe, proud. No
exclamation marks, no emoji, nothing cute. Never use the words "fell" or "felled".

## Deliver

One HTML file with: the Habits tab with the three vow sections (a veteran with ~12
vows; and a new hunter with 4), the TO-DO view with three open and two done, the
composer with the due/reminder pickers open, and the empty state. CSS variables for
the tokens, inline SVG, small JS for fold and tick.
