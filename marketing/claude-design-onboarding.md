# Claude Design brief — ONBOARDING THAT PLAYS (Awakened: Habit RPG)

Paste everything below the line into Claude Design, and attach:

1. The nine screenshots of the current onboarding, in order: sign-in gate, the mark, the name,
   Apple Health, the weekly board, the Twin Maw, the Ascent, choose a path, the Steel Wolf.
2. The art it may use (all already in the app): the sign-in gate, the three hunter busts
   (`assets/busts/avatar-base-bust.webp`, `-ranger-`, `-warrior-`), The Twin Maw and The Steel
   Wolf (`assets/bosses/`), the tower (`assets/backgrounds/lb-bg-floor100.webp`), the road
   (`assets/backgrounds/lb-bg-100k.webp`), three relic cards, and the guide's three poses
   (`assets/coach/first-awakened-idle.png`, `-speaking.png`, `-pointing.png`).

Deliverable: one handoff HTML file, which I then port into the app.

---

Redesign the first-run onboarding for **Awakened: Habit RPG**, an iPhone app where real steps,
stairs, sleep and workouts from Apple Health bring down bosses. The screenshots attached are the
onboarding as it ships today. The owner's verdict on it, in his words:

> Make it more interactive and fun as a first impression. I don't like the generic AI-coded
> fonts. Spice it up. A new user should think: "ohh wow, this looks like a fun app."

## What is wrong with it today

- **It is a slideshow.** Nine screens, and seven of them are a headline, a paragraph and a
  CONTINUE button. The hunter reads; they do not play.
- **The fun arrives last.** The only real game moment (hold to strike the Steel Wolf) is the
  ninth screen. Many new users never reach it.
- **The type is anonymous.** Cinzel capitals for every headline, tiny JetBrains Mono labels with
  wide letter-spacing above them, a system sans for the body. It is the look of every
  AI-generated dark-fantasy app. Nothing about it says *this* game.
- **Nothing moves until tapped, and little moves after.** The art is good and it sits still.
- **Two styles fight.** The bosses and the gate are painterly; the guide (the old wizard, "the
  First Awakened") is low-poly 3D and stands in a corner saying nothing.

## The goal

Within the first ten seconds the hunter has **done something and been rewarded for it**. Every
screen after that asks for one touch that feels good and shows them something of their own:
their name, their steps, their place on the board, their first hit on a boss. By the end they
have played the game once, not been told about it.

It should feel like the opening of a game (think the first minute of a good mobile RPG, or the
"System" windows of Solo Leveling), not the setup wizard of a tracker.

## The beats, and what each must still do

Keep every job below. You may merge, reorder or split screens, and I want your recommended order
with a sentence on why. Today's order is listed; the ninth beat is the strongest and comes last.

| # | Beat today | The job it must still do |
|---|---|---|
| 0 | **The gate** — "The Gate is open." | Sign in with Apple. Apple's own button, unmodified (their rule). One line on what is shared stays. |
| 1 | **The mark** — a gold star, "Touch the mark" | The first touch. Today it is a tap on a flat star. |
| 2 | **The name** — "What do they call you?" | Type a hunter name (20 characters, must be unique, errors shown inline) and pick one of three looks. |
| 3 | **The witness** — "The System reads your steps." | Ask for Apple Health. The promise that data stays on the phone must stay, plainly worded. The iOS permission sheet opens from this screen's button. |
| 4 | **The reveal** — the last 7 days of steps | Show the hunter's own real step total the moment Health is granted. Skipped if they decline. |
| 5 | **The board** — the real weekly steps board | Show real hunters and where this hunter would stand. |
| 6 | **The hunt** — The Twin Maw | Show a co-op boss, its real goal and three real relics. Two choices: summon a friend, or hunt alone. |
| 7 | **The Ascent** — floor 1 of 100 | Show there is a long climb with a summit. |
| 8 | **The vow** — choose a path | Pick one of three: Morning Routine (6 vows), Make Your Own, Vertical Jump Program (22 vows). |
| 9 | **The first gate** — The Steel Wolf | Hold to strike. The hit drains exactly the share of 6,000 steps the hunter has walked today. If today already has 6,000, the Wolf is beaten for real and the relic is theirs. Ends on ENTER. |

Two short screens can appear between 8 and 9 and need the same treatment: "When do you start?"
(Jump Program only) and "The rhythm you train at" (pick training days).

## What I want designed

### 1. A type system with a face
Replace all three families. Propose **two pairings**, each shown on the name screen and the
Steel Wolf screen so they can be compared:

- a **display face with character** for boss names and headlines (carved, blade-cut, gothic,
  or brutal and modern: your call, but it must not be Cinzel, Trajan or anything that reads as
  "fantasy template");
- a **number face** that makes steps, floors and damage feel like a game HUD;
- a **body face** that is warm and easy to read at 15px.

Rules: free for commercial use (SIL Open Font License), on Google Fonts, three families at
most, legible on a phone at arm's length. No wide-tracked monospace micro-labels anywhere.
Give the full scale: sizes, weights, line heights, letter-spacing, for every role.

### 2. One touch per screen that feels good
For each beat, design an interaction that replaces "read, then press CONTINUE". These are
starting points, not orders; beat them if you can.

- **The mark.** Press and hold. The mark heats, cracks, and the dark splits open into the
  gate's light. This is the first five seconds: make it the best five.
- **The name.** As they type, the name is struck onto a hunter's license in the display face,
  with the look they picked and an E-rank stamp. Changing the look turns the card.
- **The witness.** The guide finally speaks (a line that types itself out). After the
  permission is granted, the payoff is immediate: their real steps pour in.
- **The reveal.** The count runs up, and the number is turned into the game's own terms:
  "34,112 steps. That is five Steel Wolves." (Always real numbers.)
- **The board.** Their row enters at the bottom and climbs past real hunters as the count
  runs. End on the gap to the next one: "2,186 steps to pass Kristy."
- **The hunt.** The boss arrives (the art moves: breath, lightning, a shake on entry). The
  three relics are face down; a tap turns each one.
- **The Ascent.** Drag upward to rise through the tower toward the beacon; let go and it
  settles back to floor 1.
- **The vow.** Three banners or doors with their own art, not three text rows. The chosen one
  lights; its vows fan out underneath.
- **The first gate.** Keep hold-to-strike and make it land: damage numbers made of their own
  steps, the bar draining, the Wolf reeling. If it is beaten: the relic bursts out.
- **The handoff.** ENTER should open the gate into the app, not cut to it.

### 3. Motion and feel
A short motion language: durations, easing curves, what shakes, what glows, what gets a
haptic (light, medium, heavy, success are available) and what gets a sound (short effects
only; everything must work with the phone muted). Show how the art breathes when idle.

### 4. The guide
Decide what the First Awakened is for. Either give him a real role (he speaks, he reacts,
he hands over the first relic) and say how a low-poly figure sits beside painted bosses, or
recommend replacing him. There are only three poses of him today; if you need a new one,
write the description for an image generator. Do not invent art.

### 5. Progress
The six gold dots at the top are generic. Propose something that belongs to this world and
still tells the hunter how far along they are.

## Rules that do not bend

- **Every number is real.** Steps, ranks, board rows, boss goals, relics: all read from the
  live game. Never design a moment that needs a made-up number.
- **One idea per screen, few words.** No instructions for what is obvious. A two- or
  three-word prompt for a gesture is fine ("Hold the mark").
- **Voice.** Dark, dry, confident. No exclamation marks, no emoji. Never the words "fell" or
  "felled".
- **Skip stays.** From the board onward the hunter can skip to the app at any time.
- **Fast.** A hunter who taps through briskly finishes in about a minute. No interaction
  may trap them; every hold has a tap fallback after a moment.
- **It is a web view.** HTML, CSS, SVG and canvas only. No video files, no animation
  libraries, no new illustrations. It must run smoothly on an iPhone 11.
- **Accessible.** A calm version of every animation for Reduce Motion, tap targets of 44pt,
  text that survives larger system sizes.
- **Colours.** Near-black night blue, gold, violet stay as the base. You may add one accent
  for damage and danger.

## Deliverable

One HTML file, no external scripts, fonts linked from Google Fonts:

1. Both type pairings on two screens, with your pick and why.
2. Every beat as a working, tappable prototype in your recommended order, at 390×844, and
   the three tightest screens also at 375×667.
3. For each beat: its states (idle, touched, done, declined or failed where that applies)
   and a two-line spec of the interaction.
4. The motion language as a table.
5. A storyboard of the first ten seconds, frame by frame.

The phone frame around your screens is only a mock; I strip it when porting. Prefix every
class with `ob-` so nothing collides with the app's stylesheet.
