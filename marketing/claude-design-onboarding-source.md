# Claude Design brief: "How did you find us?" (last onboarding screen)

Owner ask 2026-11-04: one final onboarding screen asking how the hunter found the app
(App Store search / App Store recommendation / referral / other + text box).
Paste everything below the line into the Onboarding v4 Claude Design project. Attach phone
screenshots of the vow screen (Sworn stamp) and the screen before it.
Port plan: the answer goes out as funnel event `ob_source`, detail `search` | `recommended` |
`friend` | `other:<text>` (detail is clamped to 200 chars server-side, so no backend change).

---

Add one screen to the end of the Awakened onboarding ("Onboarding v4 - The Awakening").

Awakened: Habit RPG is an iPhone app where real steps, stairs, sleep and workouts from Apple Health bring down bosses. The onboarding is built and live in the app. Keep its look exactly: the "Carved" type (Grenze Gotisch for display, Chakra Petch for numbers and small labels, Alegreya Sans for body), the dark painterly ground, the gold ink and the stamps. The screenshots attached show the vow screen with its Sworn stamp and the screen before it, so the new screen sits naturally beside them.

WHERE IT GOES
Today the onboarding ends: choose a path -> SWEAR IT -> the Sworn stamp lands -> (Jump Program only: "When do you start?") -> the hunter's license goes through the Gate and the app opens.
The new screen comes right before the license goes through the Gate, on every path, including when the hunter tapped SKIP earlier. It is the last thing they see before the app opens.

WHAT IT ASKS
One question: how did you find Awakened? (A starting point for the title: "How did you find the Gate?" Your call, keep it one short line.)
Four answers, in this order:
1. I searched the App Store
2. The App Store recommended it
3. A friend told me
4. Somewhere else -> opens a small text box ("Where?", up to 120 characters)
No paragraph explaining why we ask. No instructions for anything self-explanatory.

HOW IT BEHAVES
- Tapping one of the first three answers IS the continue: the answer lights, a short confirmation (a small stamp or a flash of the gold ink, under a second), then straight on through the Gate. There is no separate Continue or Enter button. (The owner removed a second ENTER tap after swearing the vow; do not add one back.)
- "Somewhere else" opens the text box in place, with one small button to send it (for example "Done"). The box does not take focus on its own; the hunter taps into it. With the iPhone keyboard up, the box and its button stay visible above the keyboard.
- A quiet "Skip" (low emphasis, not hidden) goes straight through the Gate. Answering is never required.
- Answers are one column, full width, easy to hit with a thumb (at least 44 pt tall), sized so all four plus Skip fit without scrolling.
- Reduced motion: no movement, just the change of state.
- No new art is needed. You may reuse what the onboarding already shows (the Gate, the guide), but the screen should stay light: it is a 3-second stop, not a new beat.

STATES TO SHOW
1. The screen as it opens.
2. One of the first three answers just tapped (the moment before the Gate).
3. "Somewhere else" opened, keyboard up, a few words typed.

CONSTRAINTS
- iPhone portrait, 390 x 844, and it must also fit 375 x 667 (iPhone SE) without scrolling. Respect the safe areas top and bottom.
- Only the three onboarding fonts. No emoji.
- No color-mix() (the app supports iOS 15).
- Give buttons their font and colour from their own classes. In the first handoff a blanket button rule (font: inherit; color: inherit) overrode the button classes, so the buttons rendered in the wrong face.

DELIVERABLE
One handoff HTML file with this screen built in the same ob4- structure and naming as the onboarding, which I port into the app.
