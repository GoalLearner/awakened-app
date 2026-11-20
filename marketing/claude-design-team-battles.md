# Claude Design brief — TEAM BATTLES (the Worldgate + the Raid, one screen, two tabs)

Paste everything below the line into Claude Design, in the same project as the Worldgate MVPs work if it
still exists. Attach three screenshots: the Worldgate screen (The Drowned Abbot, DOWN), the Co-op tab with
the six gates and the RAID card, and the Raid Gate sheet (The Inner Court · The Grinning God). Deliverable:
one handoff HTML file, which I then port into the app.

---

Redesign the **Worldgate screen** of **Awakened: Habit RPG** into one **team battles** screen with **two
tabs**: **Worldgate** and **Raids**. Awakened is a dark fantasy habit tracker where real, verified steps and
flights from Apple Health power an RPG. These are its two big team fights, and players want to watch both
in one place. The first attached screenshot is the screen as it is today; it becomes the Worldgate tab.

## The two battles

**The Worldgate: one monster, all of us.** One world boss a week; a new one rises every Sunday. Every
verified step any hunter walks is one strike on its HP (1 step = 1 HP). The bar has phases (PH 2, PH 3,
PH 4). When the combined steps cross its HP the gate falls, everyone who struck it is on the Kill Wall and
shares the kill, and the three hunters with the most steps are the MVPs.

**The Raid: The Grinning God (S-rank).** Teams of six, drawn at random from the active hunters (opened the
app 5+ times in the last 7 days). Each team has **80 hours** to cover **200,000 steps and 200 flights**
between them. A win pays every member 800 souls plus a drop, and is announced to every hunter with the
team's MVP (most steps). Several teams run at once, each racing its own goal, not each other. New rule: a
member who doesn't open the app for 24 hours is swapped out for a **stand-in**, and the steps they already
walked stay with the team.

## Deliver

### 1 · The frame and the tabs

- One header for both tabs (today's reads "THE WORLDGATE · ONE MONSTER, ALL OF US" with a close button).
  Propose a name for the combined screen; keep the severe, wide-tracked label style.
- A two-tab switch right under it: **Worldgate · Raids**. Each tab carries a small live status (for example
  "DOWN" or "62%" on Worldgate, "5 LIVE" on Raids). The screen opens on Worldgate from the world boss bar on
  the home screen and on Raids from the Raid gate on the Co-op tab, and remembers the last tab.

### 2 · Worldgate tab

Keep everything the screen does today, tightened. It is long; make it scan.
- Boss emblem, name, "WORLD BOSS · DOWN" (or alive), the one-line rules, the next-boss countdown ("A NEW
  WORLDGATE BOSS RISES EVERY SUNDAY · Next: Sun 22 Nov · in 2 days").
- The big number (**1,062,334** / 1,061,723 strikes landed · **33 hunters**), the phased HP bar with the
  legend (all hunters · your guild · you), "100.0% down · 0 HP left".
- "Your part of the kill" (the gold ring with **22,950** your strikes, "You are on the Kill Wall").
- The Walk › Verify › Strike explainer can shrink to one line or move behind an info tap; your call.
- The three lists at the bottom stay: Recent strikes · Top hunters · The kill.
- Show two states: **alive** (mid-week, 62% down, 3 days left) and **down** (like the screenshot).

### 3 · Raids tab

- **Top:** The Grinning God (portrait in the third screenshot, S-RANK chip), the rule in one line ("6
  hunters · 200,000 steps + 200 flights · 80h"), and a live count: **5 raids under way · 30 hunters**.
- **Your team first, big.** Two progress bars, steps and flights, each with a **pace mark** showing where
  the team should be by now (time used vs. goal), so "on pace" or "behind" reads at a glance. Time left
  ("39h left · ends Sat 12:24 AM"). The six members, each with steps and flights. Mark the leading walker
  (the MVP so far), a member who has been **away** ("away 18h", at risk of being swapped) and a **stand-in**
  who just joined ("stand-in · joined 3h ago"). If anyone was swapped out, one quiet line for what they
  left behind: "From hunters who left: 4,210 steps".
- **Every other team below, ranked by progress.** Compact cards: a team name (the leading walker's name
  + "'s team", or propose something better), the two bars, the time left and the six members as small
  marks. Tap a card to open it into the full member list.
- **Recently finished:** a short strip of the last few raids, won or lost, for example "Won · 61h · MVP
  Kestrel" and "Time ran out · 74%".
- **States to show:** the viewer is in a raid; the viewer is not in one ("Open the app 5 days this week to
  be drawn for the next raid"); no raids under way ("The next raid forms when six active hunters are free").

## Sample data (invented names; use these so the numbers are realistic)

Teams started at the same time, 41 of 80 hours in (51%):
- Kestrel's team: 66,761 steps / 48 flights. Kestrel 46,395 · Oriel 11,177 · Thane 9,189 · Vey 0 · Lumen
  0 · Sable 0
- Your team: 23,595 / 28. You 10,281 · Marrow 8,171 · Pike 5,143 · Ashby 0 · Corin 0 · Wren 0
- Brannoc's team: 30,444 / 11. Brannoc 16,468 · Ilse 7,651 · Dorran 6,325 · three at 0
- Fen's team: 5,593 / 5. Fen 3,924 · Halloran 1,669 · four at 0
- A team that started this morning: 350 / 1, ends in 76h

Names can be up to 20 characters. A developer's name may carry a small gold "M" crown beside it; leave
room for that. Numbers use thousands separators.

## Visual language (this is a live app; match it)

- Card `linear-gradient(180deg,#15142f,#100e24)`, background near-black `#0a0a18`.
- Gold `#f5b842` (glory, you), violet `#8b5cf6` / `#a78bfa`, red `#ef4444` (the monster's HP), **steps
  green `#4ade80`, flights amber `#f59e0b`** (the app's metric colors). The Grinning God's S-rank chip is
  the pink-violet in the screenshot.
- Ink `#f4f4fb`, secondary `#9596b2`, faint `#585a76`.
- Fonts: **Cinzel** 700 for names and monsters, **JetBrains Mono** 800 uppercase wide-tracked for labels
  and numbers, system sans for body.
- Line-art gold SVG emblems; no photos except the existing boss portraits, no emoji, no 3D.
- Canvas 390 × 844, and check 375 × 667. **No phone frame, no status bar, no home indicator.**
- Keep each tab calm: one clear thing per block, no instructions for what's self-explanatory.

## Motion

Describe it in comments (ms from mount): the tab switch, bars filling on entry, numbers counting up, a card
opening into its member list. Haptics cues welcome (light / medium / heavy / selection). Reduced motion:
fades only.

## Tone

Plain, severe, proud. The app speaks as a system addressing hunters: "One monster. All of us." No
exclamation marks, no emoji, nothing cute.

## Output

One HTML file with every screen and state above, labelled, CSS variables for the tokens, inline SVG, static
markup plus small JS for the tabs and motion only. Name any new component and describe it so the port is
mechanical.
