# ClaudeDesign brief — make "Perfect Day" unforgettable

## What you're designing
The redesigned **Perfect Day** celebration in **Awakened** — the moment that fires the instant a user checks off the **last scheduled habit of the day** and hits 100% complete. Make it a real dopamine hit: the emotional high point of the user's day, the reward that makes them want to earn it again tomorrow. Design the **whole sensory moment — visuals, motion, sound, and haptics**, not just the graphics.

## Why this matters (real user signal)
A real tester, **Galilea**, told us: *"I get really happy when I see 'Perfect Day' when I complete my habits."* That happiness is the product working. We want to amplify it — turn a small confetti pop into a moment she looks forward to. This celebration is the payoff that makes the daily habit loop stick.

## The app in one breath
Awakened is a dark-fantasy "level up your real life" habit RPG (Solo-Leveling energy for self-discipline). Aesthetic: deep near-black backgrounds, **Cinzel** serif for heroic headings, **JetBrains Mono** for labels/numbers, **gold (#f5b842 / #fbbf24)** reserved for the biggest achievements, rank-tier accent colors, hex / sigil / rune motifs, premium glow + particle work. It must feel **earned and powerful — never cute or childish**.

## What Perfect Day does TODAY (your starting point — build up, don't repeat)
When the final habit is checked, a full-screen overlay fires for ~2.2s:
- A canvas **confetti burst** (60 multicolor dots falling under gravity, fading out).
- **One line of text**: "+N XP earned today ⚡".
- A short **vibration** pattern — *but note: this is `navigator.vibrate`, which does nothing on iOS, so our iOS testers currently feel no haptic at all.*
- **No sound whatsoever.**
- Auto-dismisses after 2.2s; tap to dismiss.

It's pleasant but thin: there's **no hero "PERFECT DAY" wordmark**, **no sound**, no crescendo, and it feels identical on day 1 and day 100.

> There is a separate, bigger **milestone** screen for 7 / 30 / 100-day perfect *streaks*. **This brief is about the EVERYDAY Perfect Day** — but please propose how the everyday moment should escalate as the streak grows so the two feel like one family.

## The feeling to design for
- A wave of **"I did it."** Satisfying, earned, a little triumphant.
- **The "PERFECT DAY" wordmark is the hero.** Galilea loves *seeing* it — make reading those two words feel incredible: a reveal, a forged stamp, a seal of mastery with weight and light.
- **Short enough to crave daily, never a chore.** It plays every single day; delight must survive the 100th repeat.

## Design the moment across four senses

**1. Visual / hero**
- A show-stopping **"PERFECT DAY" wordmark reveal** (Cinzel). Think gold-foil seal, an engraved sigil that ignites, light rays, a forged stamp — your call, but it should read as a *seal of mastery*, not just party confetti.
- Surround it with premium particle/light work. You can borrow from our existing celebration vocabulary (already used on our rank-up screen): **radial particle bursts, an expanding shockwave ring, gold rain, light streaks.**
- Surface the reward + the chain: today's **XP earned** and the **perfect-streak count** ("Day 12 · Perfect" with a flame) so the user feels the streak growing — the unbroken chain is part of the pride.

**2. Motion / timing**
- A clear arc: **anticipation → impact → bloom → settle**, with the wordmark landing on a beat.
- Core hit ~1.5–2.5s, **tap to skip**. Because it's daily, it must reward without ever blocking or nagging.

**3. Sound — our single biggest missing piece**
- Design a short, gorgeous **"success" sound**: a rising swell / choir-hit / sword-shing-into-bell / chime cascade — whatever fits dark-fantasy heroism. ~1–1.5s, deeply satisfying, and **not grating on the 100th listen.**
- **Prototype it with the Web Audio API** in your mock — we generate ALL sound procedurally (no audio files), so give us the notes / envelope / timing so we can port it into our `playSfx` synth.
- Must fully respect a **sound-OFF** setting (clean silent fallback).

**4. Haptics**
- Design a **"success crescendo"** that mirrors the visual beat — e.g. a soft anticipation tap → a confident impact → a warm settle — richer than today's flat buzz.
- Spec it as **named impacts** (light → heavy → success), not a raw vibrate array: on iOS we'll deliver it through the native **Capacitor Haptics** plugin (raw `navigator.vibrate` is a no-op there). Note where each impact lands in the timeline.

## Escalation (so day 100 ≠ day 1)
Propose how the everyday celebration **intensifies with the perfect-streak count** — more gold, a richer wordmark treatment, an extra ring, a fuller chord on the sound — so a long streak's perfect day visibly and audibly outranks a fresh one. Keep it tasteful; don't spend the whole budget on day 1.

## Constraints
- **Mobile portrait, ~390px frame.** 60fps; keep canvas/particles light.
- Honor **prefers-reduced-motion** (a calm, still-beautiful variant) and **sound-off**.
- Renders as a **full-screen overlay** over the app — we'll strip your device chrome (notch/status bar) on port.
- **Dark-fantasy premium** — earned and powerful, never cartoonish.

## Deliverables
- The redesigned **everyday Perfect Day** overlay as an animated HTML/CSS/JS mock, including the **Web Audio sound prototype** and a written **haptic spec** (named impacts + timeline).
- The **reduced-motion** and **sound-off** variants (or how it degrades).
- A short note on the **streak-escalation tiers**.
- Optional: a sketch of how the everyday moment relates to the bigger milestone-streak screen so they feel like one family.
