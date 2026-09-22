# Claude Design brief — RATING MOMENTS (Awakened: Habit RPG)

Paste everything below the line into Claude Design. Deliverable: one handoff HTML
file with all five screens, which I then port into the app.

---

Design five full-screen "rating moment" cards for **Awakened: Habit RPG**, a dark
fantasy habit tracker where real habits ("vows") power an RPG climb. Each card
appears once, right after a milestone celebration has finished playing, and asks
the hunter to rate the app on the App Store.

## Hard rules (Apple's, not preferences — a design that breaks one can't ship)

1. Exactly two controls: a primary button **"Rate Awakened"** and a quiet text
   button **"Not now"**. No third option, no dismiss X, no "remind me later".
2. No star row, no thumbs, no 1–5 picker, no "are you enjoying Awakened?" question.
   The card must never ask how the hunter feels before offering to rate.
3. No reward, gift, souls, item, XP or currency may appear anywhere on these
   cards, and no copy may imply one. The milestone's own reward is paid and shown
   on the celebration screen that plays BEFORE this card. These cards ask for
   nothing in return.
4. A small footnote under the buttons: "Opens Apple's rating prompt".
5. Nothing may suggest a good rating specifically. "Rate Awakened", never "Rate us 5 stars".

## The visual language (match it; this is a live app, not a concept)

- Background: near-black navy `#0a0a18`; card `#13132a`-ish, rounded 22px, a thin
  warm border and a soft outer glow. The card floats over a dimmed screen.
- Gold is the hero: `#f5b842`, glow `rgba(245,184,66,0.30)`. Violet accent `#a78bfa`.
- Ink: `#f4f4fb` primary, `#9596b2` secondary, `#585a76` faint.
- Fonts: **Cinzel** (serif) for the big line, **JetBrains Mono** (800 weight,
  wide letter-spacing, uppercase) for eyebrows and stat lines, **Cormorant
  Garamond italic** for the one emotional line, system sans for body copy.
- Emblems are line-art SVG in gold, ~54px, stroke ~2.3, round caps. No photos,
  no emoji, no 3D.
- Canvas 390 × 844. **No phone frame, no status bar, no home indicator** — the real
  device supplies those.

## Current anatomy (what exists today — improve on it, keep it recognisable)

eyebrow (mono, wide) → gold emblem → big Cinzel headline (2 lines) → mono stat
line → gold hairline divider → italic emotional line → one grey sentence of why
→ gold CTA button → "Not now" → footnote.

The current card is plain: static emblem, no texture, no sense of the moment it
came from. Give each of the five its own character while keeping one family —
someone seeing their second one a month later should recognise it instantly.

## The five moments

Each needs: eyebrow, emblem concept, headline (data in **bold** is filled by the
app), stat line, emotional line, why line.

1. **FIRST WEEK KEPT** — 7 straight days with vows sealed. The most common moment;
   most hunters will only ever see this one. Should feel like the first real proof.
   Data: 7 days, number of vows kept, current streak.
2. **THREE PERFECT DAYS** — a third day with every single vow sealed. Data:
   3 perfect days, the date of the third.
3. **FIRST BOSS DEFEATED** — a boss fell to real steps/workouts. Data: boss name
   (e.g. "The Steel Wolf"), its rank letter.
4. **RANK ASCENDED** — climbed to a new rank or division (E → D → C …, three
   divisions each). Data: new rank label (e.g. "C II"), points.
5. **FIRST CO-OP WIN** — cleared a dungeon with a friend. Data: dungeon name
   (e.g. "The Twin Maw"), party size.

## Tone

Second person, plain, unhurried, a little severe. The app's voice is a system
speaking to a hunter: "You did what others won't." Never cute, never salesy,
never exclamation marks. British-plain over hype. Short lines.

## Deliver

One HTML file, all five cards stacked with a label above each, using the tokens
above as CSS variables, inline SVG emblems, and any entry animation described in
a comment. Static markup only — no framework, no build step.
