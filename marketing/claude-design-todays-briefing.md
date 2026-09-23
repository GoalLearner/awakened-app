# Claude Design brief — TODAY'S BRIEFING (Awakened: Habit RPG)

Paste everything below the line into Claude Design, and attach the two current
screenshots. Deliverable: one handoff HTML file, which I then port into the app.

---

Redesign **Today's Briefing** for **Awakened: Habit RPG**, a dark fantasy habit
tracker where real habits ("vows") power an RPG climb. It is the first thing a
hunter sees **every day**, once, the first time they open the app. The owner's
words: "simple, short and sweet, but interactive and fun."

## What's wrong with today's version (attached)

- It lists **every vow** (43 rows for the owner), so it reads like homework, not a
  morning. Nobody reads 43 rows at 7 AM.
- It's static: the only interaction is scrolling to the bottom to find LOCK IN.
- The "VERIFIED BY SYSTEM" tile is dead (Apple Health no longer checks off vows) and
  must go.

## What it should be

**One screen, no scrolling**, that takes about five seconds, answers "where do I
stand, and what's today?", and ends with **one satisfying ritual** that commits the
hunter to the day.

Content, top to bottom (data in **bold** comes from the app; design all of it,
drop anything that doesn't earn its place):
- **Date + day count**: "WED · SEP 23 · DAY 134", and the streak (**6-day streak**).
- **Yesterday, in one line**: "Yesterday: **38 of 43** vows kept" (or "a perfect
  day"; or, if they missed, something kind, never shaming).
- **Today, in one number**: **43 vows** waiting, with **+124 XP** on the table. A
  ring or gauge beats a list.
- **The climb**: rank **S** and **"212 XP to S II"**, a thin bar the hunter can watch.
- **The first three vows of the morning**, as chips (e.g. **No phone after waking**,
  **Meditate & Breathwork**, **Wake up at consistent time**). Not the whole list.
- One optional line from the world this week: **"The Worldgate is 46% down"** or
  **"You're #8 on the steps board"**.

## The interaction (the fun part)

Replace the LOCK IN button with a **ritual**: e.g. **press and hold a seal** that
fills around its edge (~1 second) and stamps, with the day's number, a sound and a
haptic, then the sheet leaves. Propose something better if you have it, as long as:
- it takes ~1 second, is obvious without instructions, and feels good every day
  (day 134 has to feel as good as day 1);
- letting go early just resets it; no failure state;
- the chips can also be tappable (tap one to make it "today's first vow"), but that's
  optional. Nothing here seals a vow or changes XP; vows are still ticked on the
  Habits tab.

Also design a **small-numbers version** for a brand-new hunter (day 3, 5 vows,
E rank, no streak yet) so it doesn't look empty.

## Visual language (this is a live app; match it)

- Background near-black navy `#0a0a18`; sheets/cards `#13132a`, 22px radius, thin warm
  gold border, soft glow.
- Gold `#f5b842` is the hero (glow `rgba(245,184,66,.30)`); violet `#8b5cf6` / `#a78bfa`;
  steps green `#4ade80`; ink `#f4f4fb` / `#9596b2` / `#585a76`.
- Fonts: **Cinzel** 700 for big words and numbers, **JetBrains Mono** 800 uppercase
  wide-tracked for labels, system sans for body, **Cormorant Garamond italic** for one
  emotional line at most.
- Line-art gold SVG emblems; no photos, no emoji, no 3D.
- Canvas 390 × 844. **No phone frame, no status bar, no home indicator.**
- It opens as a bottom sheet over the app today; a full screen is fine if it's better.

## Motion + sound

Describe the entry timing in a comment (ms from mount). Numbers may count up. Haptics:
light / medium / heavy / selection. Sound is the app's fanfare voice (sine, 12ms
attack, exponential decay). Reduced motion: fades only, and the ritual still works.

## Tone

The app is a system addressing a hunter: plain, a little severe, proud. "The day is
yours." No exclamation marks, no emoji, nothing cute.

## Deliver

One HTML file with: the veteran version (numbers above), the new-hunter version, and
the ritual shown at rest, mid-hold and completed. CSS variables for the tokens, inline
SVG, small JS for the animation.
