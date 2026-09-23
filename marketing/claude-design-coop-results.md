# Claude Design brief — CO-OP HUNT RESULTS: victory + defeat (Awakened: Habit RPG)

Paste everything below the line into Claude Design, and attach the screenshot of
today's defeat card. Deliverable: one handoff HTML file, which I then port.

---

Design the two screens a hunter sees when a **co-op dungeon hunt** ends in
**Awakened: Habit RPG**, a dark fantasy habit tracker where real steps from Apple
Health power an RPG.

**What a co-op hunt is:** two or three friends take on a boss together (e.g. **The
Twin Maw**). They have **24 hours** to reach a shared goal with real verified steps,
and some bosses need **both steps and flights climbed**. Win and the boss drops souls
and maybe a relic; miss and the boss survives. The result shows the next time each
hunter opens the app.

## What's wrong today (attached)

- **A loss** is a small generic notice card ("The Twin Maw bested you… Rally your ally
  and call again."), the same box as a routine system message. No drama, no numbers,
  no sense of how close they came.
- **A win** reuses the solo boss-kill screen. It never says *you and your ally did this
  together*, and the co-op extras (the hunt's MVP, the bonus, the pact) only appear as
  small toasts.

The owner's ask: **"more excitement or strong emotions."** A win should feel like a
shared triumph; a loss should sting, and make them want to call again right now.

## Screen 1 · VICTORY (the party won)

Content (data in **bold** comes from the app; design all of it and cut what doesn't earn its place):
- The boss: **The Twin Maw**, rank **E**, beaten. The emotional peak is the two (or
  three) hunters' marks **coming together** to break it.
- The party, each with their share: **Richie 14,210 steps · Anthony 11,840 steps**
  (dual bosses also show **flights**, e.g. **Richie 32 flights · Anthony 18**). The goal
  bar reaching 100%: **26,050 / 24,000 steps**.
- The time: **"Done in 14h 22m"** (of the 24h window).
- **The hunt's MVP**: whoever carried the most. **"Richie carried the hunt · +1% souls and
  relic luck"**. Gold, and a moment of its own.
- The reward: **+180 souls**, and either a relic (**"Bramble Wardplate · Rare"**) or
  "souls only this time". A rare-or-better relic already has its own reveal ceremony
  that plays after this screen, so just name it here.
- Optional flourishes, when the app has them: **"The hunger is fed · 2× souls"**, and the
  pact with this ally: **"Pact with Anthony · 6 days"**.
- Dismissal: **tap anywhere to continue** ("TAP TO CONTINUE" fading in late). This app's
  celebrations never use buttons.

## Screen 2 · DEFEAT (the window closed, goal unmet)

It should sting, then turn into resolve: **close, but not over.**
- The boss **survives**: **The Twin Maw**, dimmed and unbroken, maybe a crimson register.
- **How close they came**, the heart of the screen: **"87%"**, with the goal bar stopping
  short: **20,910 / 24,000 steps**, and each hunter's share (no blame, never "you
  didn't pull your weight").
- Two moods by closeness:
  - **Near miss (≥ 80%)**: "So close it hurts." Maximum sting and urgency.
  - **Far off (< 50%)**: dignified, forward-looking: "The Maw was strong this time."
- **One action button: "Call again"**, which starts the next hunt with the same party, plus a
  quiet "Not now". (This is the one screen with a real choice, so buttons are right here.)
- No souls, no relic, no shaming language.

Design both for a **duo** and a **trio**.

## Visual language (a live app; match it)

- Background near-black navy `#0a0a18`; cards `#13132a`, 22px radius, thin borders, soft glow.
- Victory: gold `#f5b842` hero (glow `rgba(245,184,66,.30)`), violet `#8b5cf6` / `#a78bfa`
  for allies, steps green `#4ade80`, flights blue if needed.
- Defeat: crimson `#ef4444` / deep reds, gold only for the call-again button.
- Ink `#f4f4fb` / `#9596b2` / `#585a76`.
- Fonts: **Cinzel** 700 (names, big numbers), **JetBrains Mono** 800 uppercase wide-tracked
  (labels), system sans (body), **Cormorant Garamond italic** for one emotional line at most.
- Line-art gold SVG; no photos, no emoji, no 3D. Boss art exists in the app as a square
  portrait; show where it would go as a placeholder.
- Canvas 390 × 844. **No phone frame, no status bar, no home indicator.**

## Words the app never uses

Never write **"fell" / "felled"** anywhere in the copy (a standing brand rule), and
nothing that blames an ally.

## Motion + sound

Describe entry timing in a comment (ms from mount). Numbers may count up. Victory can
be big (the marks join, a strike, a burst). Defeat should hit hard, then settle. Haptics:
light / medium / heavy / success / error. Sound is the app's fanfare voice (sine, 12ms
attack, exponential decay); a low, falling tone suits defeat. Reduced motion: fades only.

## Tone

The app is a system addressing hunters: plain, a little severe, proud. No exclamation
marks, no emoji, nothing cute.

## Deliver

One HTML file with: victory (duo), victory (trio, with MVP), defeat near-miss (duo),
defeat far-off (trio). CSS variables for the tokens, inline SVG, small JS for the
animation.
