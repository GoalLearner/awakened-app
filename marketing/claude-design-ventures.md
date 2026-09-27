# Claude Design brief — VENTURES (Awakened: Habit RPG)

Paste everything below the line into Claude Design, and attach the current Habits
tab screenshot (the sectioned one with the hunt row at the top) and the Status tab.
Deliverable: one handoff HTML file, which I then port into the app.

Why this exists (for the owner, not the design tool): every reward in Awakened
today resolves inside the session that earns it — seal a vow, the XP lands; strike a
boss, the kill lands. Once a hunter has sealed the day's vows there is no reason to
come back until tomorrow's briefing. Ventures are the payoff that lands **while the
hunter is away**, so the app earns a second and third open each day. Levla's
"adventure" loop is the reference, and its reviews name it as the reason people keep
opening the app.

---

Design **Ventures** for **Awakened: Habit RPG**, a dark fantasy habit tracker where
real daily habits ("vows") power an RPG climb. A venture is a timed trip: the hunter
spends the vows they have sealed today to send themselves out into the world, the
trip resolves on a clock while the phone is in their pocket, and they come back to
the app to collect what it brought home. Keep it simple; the owner's standing rule is
minimal information per screen, and the app's voice is a system addressing a hunter:
plain, a little severe, proud. No exclamation marks, no emoji, nothing cute.

## The rules (design to these; don't invent others)

- **Fuel is sealed vows.** Every vow sealed today is one **mark**. A venture costs
  marks. Marks reset at midnight and do not accumulate across days, so a hunter can
  never bank them — the venture is today's reward for today's discipline.
- **Three lengths, one running at a time.**

  | Venture | Cost | Returns after | Brings home |
  |---|---|---|---|
  | **Short** | 3 marks | 2 hours | souls |
  | **Long** | 6 marks | 6 hours | more souls, a chance at a relic |
  | **Overnight** | 10 marks | when the hunter next opens the app after 8 hours | the most souls, a better relic chance |

  The reward bands are shown as ranges (e.g. "40–60 souls"), never exact, so the
  return is worth opening. Actual amounts come from the app's economy; design the
  shape, not the numbers.
- **The return is collected, not delivered.** Nothing lands until the hunter opens
  the app and taps. A push notification announces it ("Your venture is back."). The
  overnight venture is built to be the first thing collected in the morning, right
  after the briefing.
- **A hunter can't be sent twice.** While a venture runs, the card shows the clock;
  the send buttons are gone, not disabled.
- **Ventures never touch rank XP, streaks or Perfect Day.** Souls and relics only.
  The climb stays earned by vows.
- **Day one is quiet.** A new hunter sees no venture card until their second day
  (the app's rule: first day = the notification ask and the First Mark only).

## Where it lives

1. **The Habits tab, in the hunt row's slot.** Today that row reads "No hunt running.
   Bosses fall to real steps, sleep and workouts — start one." Ventures take that top
   position (design it as a card, the hunt row can move under it). It's the most-used
   screen in the app, and marks are earned right below it, so the loop is visible:
   seal vows → the card fills → send.
2. **A venture sheet** (bottom sheet) for choosing and for reading the return.
3. **One line on Today's Briefing** the morning after an overnight venture: "Your
   venture came back in the night." (The briefing already has one-line slots for
   the Worldgate, Community news and to-dos; match them.)

## The states of the card (design all five)

1. **Empty, no marks yet** — "Seal 3 vows to send a venture." A small mark counter
   (0 of 3) that fills as vows are sealed. This is the state most hunters see at 7 AM.
2. **Ready** — marks available, the three lengths as choices with cost and return
   time in plain words ("Back at 9:40 PM"). One tap sends. A hunter with 4 marks sees
   Short available and Long, Overnight showing what's missing ("2 more").
3. **Away** — the hunter is out. A silhouette or emblem, the venture's name, a thin
   clock bar, "Back at 9:40 PM" or "Back tomorrow morning". Nothing to tap but the
   card itself, which opens the sheet.
4. **Back** — the card glows gold: "Your venture is back." One tap opens the return.
5. **Collected** — for the rest of the day the card shows what it brought home and
   the next send (marks permitting). It never nags.

## The return (the satisfying part)

A short reveal in the sheet, tap to continue (the app's standing rule for
ceremonies: no buttons, no X, TAP TO CONTINUE): the souls count up, a relic card
flips if one came home, and **one line from the First Awakened** — the app's mentor
voice — about where the hunter went. Three or four lines per venture length is
enough; they rotate. Examples of the voice: "The road was long and paid little. It
always pays." / "You came back with more than you carried out." / "Overnight the
gate stood quiet. You did not." Never "fell" or "felled".

## Visual language (this is a live app; match it)

- Background near-black navy `#0a0a18`; cards `#13132a`, 18–22px radius; violet
  `#8b5cf6` / `#a78bfa` for structure; gold `#f5b842` for the reward moment and the
  "back" state; steps green `#4ade80` sparingly; ink `#f4f4fb` / `#9596b2` / `#585a76`.
- Fonts: **Cinzel** 700 for titles, **JetBrains Mono** 800 uppercase wide-tracked for
  labels and counts, system sans for body.
- Line-art gold SVG glyphs for the three lengths (a lantern, a road, a moon). No
  photos, no 3D, no illustrated hero — the hunter is an emblem, not a character.
- Canvas 390 × 844. **No phone frame, no status bar, no home indicator.**

## Motion + sound

Card state changes ≤ 200 ms. The send: a short lift and the card settles into the
clock. The return: souls count up over ~600 ms with the app's short sine tick, a
light haptic on the relic flip. Reduced motion: fades only.

## What stays exactly as it is

The header, the tab bar, the vow sections, the TODAY · TO-DO · LEDGER control, the
briefing's other lines, the footer.

## Deliver

One HTML file with: the Habits tab showing the card in each of the five states, the
venture sheet in its choose state and its return state (with and without a relic),
the briefing line, and the push notification text as a note. CSS variables for the
tokens, inline SVG, small JS for the state switch and the count-up.
