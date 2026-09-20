# ClaudeDesign brief — the two rank celebrations

## What you're designing

**Two** celebration moments in **Awakened**, a dark-fantasy habit RPG, and the relationship between
them:

1. **A DIVISION UP** — a brand-new screen. Fires ~**12 times** across a hunter's whole climb.
2. **A LETTER RANK UP** — an *addition* to a screen that already exists and that we like. Fires at
   most **6 times, ever**.

The hard part is not either screen on its own. It is that they must feel like **one family with two
weights** — the small one has to stay welcome on its twelfth appearance, and the big one has to feel
like the thing the small ones were building toward.

Design the **whole sensory moment — visuals, motion, sound and haptics**, not just the graphics.

## Why this matters (real user signal)

A real App Store review, August 2026:

> *"You fight and grow levels, get weapons and armor, and achievements. It ties to your apple health.
> **You climb E/D/C/B/A/S ranks. It's like I'm in an anime!** Seriously wondering why this isn't a top
> used personal growth app."*

The rank ladder is what he named. It is the spine of the product's identity — and today it pays off
**six times in a lifetime**. Between B and A a hunter goes about **four and a half months** with no
acknowledgement at all. The divisions already exist in the data; they have simply never been
celebrated. This brief is about giving that climb eighteen moments instead of six, without cheapening
the six.

## The app in one breath

Dark-fantasy "level up your real life" habit RPG — Solo-Leveling energy for self-discipline. Deep
near-black backgrounds, **Cinzel** serif for heroic headings, **JetBrains Mono** for labels and
numbers, **gold (#f5b842 / #fbbf24) reserved for the biggest achievements**, per-rank accent colours,
hex / sigil / rune motifs, premium glow and particle work. It must feel **earned and powerful — never
cute, never childish.**

## The ladder — the numbers that shape the problem

Seven tiers. Every tier splits into three divisions, labelled **III → II → I** (you climb *toward*
I), then the letter turns. A hunter's title reads **"B II"**.

| Tier | Accent | XP to cross the whole tier | One division |
|---|---|---|---|
| E | violet `#8b5cf6` | 100 | ~33 |
| D | cyan `#22d3ee` | 500 | ~167 |
| C | emerald `#34d399` | 2,400 | 800 |
| B | amber `#fbbf24` | 4,000 | ~1,333 |
| A | red `#ef4444` | 5,000 | ~1,667 |
| S | fuchsia `#e879f9` | 24,000 | 8,000 |
| S+ | gold `#facc15` | — | — |

**Pacing, and this is the whole design constraint:** at E and D a hunter may cross a division in a
day or two. At B and above it is roughly **45 days between divisions**. So the same screen has to
survive being seen twice in a week *and* carry the weight of a month and a half of work. A division
screen inherits **its tier's accent colour**, not gold.

## What happens TODAY

**A division up:** a small toast, and that is the whole problem. A gold-accented two-line strip
slides in for **2.8 seconds** — kicker **"DIVISION ADVANCED"**, value **"D II"** — with a short
three-note blip. It is non-blocking by design: it does not pause anything, and it frees the
celebration queue immediately so other things can fire over the top of it.

It reads as a **notification**, not an achievement. It uses the same DOM and animation pipeline as
"Set your goal value to check off this habit." Forty-five days of work and it arrives looking like a
system message. That is what you're replacing — build up from it, don't repeat it.

Related, and the thread this is tying off: we shipped a **3px hairline along the bottom edge of the
rank card in the header** yesterday. It fills toward the *division*, not the tier, and it pulses
every time the hunter seals a habit. So a hunter now watches a bar fill three times per rank, and
when it completes they get a toast.

**A letter rank up:** a full-screen takeover we're happy with. Do not redraw it — add to it.

1. A ~1s black cut with one typed-out line: *"YOU HAVE BEEN ACKNOWLEDGED."*
2. Then the screen: eyebrow **RANK UP**, a large rank badge, the rank name, a "CLASS UNLOCKED" line
   (only when the class actually changes), a small trophy card (Total XP · Days Active · a souls
   gift), one line of dialogue from **The First Awakened** (the game's mentor figure), a CONTINUE
   button, and a small ⚔ wordmark.
3. Effects: a radial particle burst, an expanding shockwave ring, per-rank extras (S shakes, S+ gets
   gold rain), and a haptic.
4. Sound: `rank_fanfare` — a four-note arpeggio **C5 → E5 → G5 → C6**, sine with a triangle layer on
   the top note, ~800ms. Bright and premium.

## The two must not be the same ceremony

A division pays **no currency** — the owner's call. The tier-up keeps its souls gift and stays the
bigger event. **So a division screen has to feel earned on craft alone**, which is the real design
challenge here.

A division also shows **no class line, no share button, no upsell** — those stay tier-only.

A starting idea, offered so you have something to push against rather than as a spec: **a letter is
three marks, and you light them one at a time.** Each division-up shows the same three marks with one
more lit, so twelve small moments accumulate into a visible ladder instead of twelve unrelated pops.
The letter screen then completes all three and **the letter itself turns** — D becoming C — before
the existing fanfare runs. If you have a better structure, take it; what matters is that the small
moments *build toward* the big one rather than competing with it.

## Design the moment across four senses

**1. Visual**
- The division screen's hero should make **where you stand** legible in one glance — which mark you
  just lit, and how far to the letter.
- Consider whether a division is a full-screen takeover at all. Twelve full interrupts may be too
  many; a centred card over a dimmed app is also on the table. Your call — argue for it.
- You may borrow the existing celebration vocabulary: radial bursts, shockwave rings, light streaks,
  gold rain. Spend it carefully — the division is the *small* one.
- For the letter screen, design **the completion beat only**: the three marks resolving and the
  letter turning. Everything after it already exists.

**2. Motion / timing**
- Division: short. It plays 12 times. Anticipation → impact → settle, then out. Tap to skip.
- Letter: the completion beat lands *before* the existing fanfare, so budget roughly **a second**,
  and make it feel like an arrival rather than a preamble.

**3. Sound**
- We generate **all sound procedurally with the Web Audio API — no audio files.** Prototype it in
  the mock and give us notes, envelope and timing so we can port it into our synth.
- The division has a cue today — `subrank_blip` — but it is a notification sound, matched to the
  toast. It needs replacing with something in the same family as `rank_fanfare` (C5→E5→G5→C6) but
  **clearly smaller** — a fragment of it, a lower voicing, two notes instead of four. Ideally the
  twelve division cues and the letter fanfare should sound like the same instrument.
- Consider whether the division cue should **rise across III → II → I**, so the third one sits right
  under the letter fanfare.
- Must degrade cleanly to silence with sound off.

**4. Haptics**
- Spec **named impacts** (light / medium / heavy / success) against the timeline — not a raw vibrate
  array. On iOS we deliver these through native Capacitor Haptics; `navigator.vibrate` is a no-op
  there, so an array would be felt by nobody.
- The division should be a lighter pattern than the letter's, in the same shape.

## Constraints

- **Mobile portrait, ~390px frame.** 60fps; keep particle work light.
- **Honour `prefers-reduced-motion`** with a calm, still-beautiful variant. Important: it must be a
  *removed* animation, not a *paused* one — a frozen half-frame is a bug we have shipped before.
- Renders as an overlay over the app. **We'll strip your device chrome (notch / status bar / phone
  frame) on port** — please keep it separable.
- Dark-fantasy premium. Earned and powerful.

## Deliverables

- The **division-up** screen as an animated HTML/CSS/JS mock, shown at **three different divisions**
  (III, II, I) and in at least **two tier colours** (say D cyan and B amber) so we can see it hold up.
- The **completion beat** for the letter rank-up as a mock — the marks resolving and the letter
  turning — ending where the existing fanfare would take over.
- The **Web Audio prototype** for both cues, and a written **haptic spec** (named impacts + where
  each lands).
- The **reduced-motion** variant of both, and the sound-off behaviour.
