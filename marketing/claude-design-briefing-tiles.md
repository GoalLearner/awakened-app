# Claude Design brief — TODAY'S BRIEFING: four tiles (Awakened: Habit RPG)

Owner 2026-11-09: pact flames, a 14-day steps ranking, Community board updates and a Write a review button on the briefing, in four quadrants; the to-do card goes.

- Open the Claude Design project where you made Today’s Briefing (a new project works too).
- Attach the two screenshots you sent me: today’s briefing (Monday) and Pact Flames in the Community tab.
- Paste the prompt. When the handoff comes back, drop it in Downloads as usual and I port it.

---

Redesign the middle of TODAY'S BRIEFING for Awakened: Habit RPG, a dark fantasy habit tracker where real habits ("vows") and real steps power an RPG climb. You designed this screen before and it is live on iPhone. It appears once a day, the first time a hunter opens the app. Today it shows the date, Day N and the streak; last week's recap card on Mondays (yesterday in one line on other days); today's to-dos; the rank climb; a Worldgate line; a "New on the Community board" line; and the HOLD TO BEGIN seal. Screenshot 1 is today's version (a Monday).

WHAT CHANGES
- The to-do card goes. Almost nobody uses to-dos. Don't bring it back in any form.
- In its place: FOUR TILES in a 2 x 2 grid (the owner's idea):
  1. PACT FLAMES: your daily streaks with your friends.
  2. YOUR STEPS, RANKED: your average steps a day over the last 14 days, against every hunter on the app.
  3. COMMUNITY BOARD: the latest developer update.
  4. WRITE A REVIEW: a button to the App Store review page.
- These stay: the header (date, Day N, streak pill), the Monday recap card / yesterday line, the rank climb, the Worldgate line and the seal. The "New on the Community board" line moves into tile 3. Restyle anything that makes the whole screen better.

TILE 1: PACT FLAMES (screenshot 2 is the Pact Flames page in the Community tab)
A pact is a daily streak with one friend. The app makes a hunt for every friend pair each day; every Pacific day you both walk, the flame grows by one. A missed day puts it out. Today counts only once BOTH hunters have walked today.
Per friend: name, initial avatar ringed in their rank colour, rank, streak in days, and today's state:
- SECURED: today already counts.
- WAITING: today doesn't count yet. Say who it waits on: "waiting on Justin", "waiting on you", "waiting on you both". It goes out at midnight PST if nothing happens.
- COLD: 0, the flame went out.
Sample: RenDIESEL (S+) 14 secured; Justin (B III) 12 waiting on Justin; Galilea (A II) 10 secured; 9 more friends cold.
Burning bonds first, highest streak first, three at most, then "+N more" when more burn. Flame tiers if you want them: Spark 0-2, Kindling 3-6, Flame 7-29, Blaze 30-99, Inferno 100-364, Eternal 365+.
Use the app's flame art (the drawn flame in screenshot 2), never the fire emoji.
Other states: no friends yet ("Add a friend. Every day you both walk, your flame grows."); friends but every flame cold; exactly one bond burning.

TILE 2: YOUR STEPS, RANKED
Your average steps a day over the last 14 days (days with no steps recorded don't count), against every hunter who recorded steps in those 14 days. About 40 hunters today; design for 10 to 1,000+. Apple Health steps only.
Data: your average (9,184 a day), your place (#3 of 41), your percentile (top 7%), the middle hunter (7,012 a day), the top average (12,796), and every hunter's average as an anonymous dot.
The statistic is the hero, and it should feel like a real statistic: a dot strip or a small distribution with YOU marked beats a lone number.
Framing (never shaming):
- Top half: "TOP 7%".
- Bottom half: "Ahead of 30% of hunters", plus the step to the middle: "+1,600 a day reaches the middle".
- First place: "The most steps on the app".
Other states: fewer than 3 days of steps ("Your rank appears after 3 days of steps", with the days so far); no Apple Health ("Connect Apple Health to be ranked").
Steps green is #4ade80.

TILE 3: COMMUNITY BOARD
The latest developer update post: its title ("Week of Nov 8 - v3.0.23"), the day it was posted, and NEW when the hunter hasn't opened it. When nothing is new, still show the latest title, quietly.

TILE 4: WRITE A REVIEW
Opens the App Store's write-a-review page. Apple's rules are strict (the app can be removed): no reward of any kind, no star row, no "Enjoying Awakened?" question, nothing offered in return. Just an honest ask, e.g. "Write a review" / "It helps other hunters find Awakened." After a tap, the tile says thank you for the rest of the day.

TAPS
- The seal stays the way into the day (press and hold about 1 second; letting go early resets).
- A tap on tile 1, 2 or 3 opens that place (Pact Flames, the steps board, the update). The tap counts as beginning the day: the seal stamps by itself, quickly, then the sheet leaves for that page.
- A tap on tile 4 opens the App Store; the briefing stays open.
- Show the pressed state.

LAYOUT
- Canvas 390 x 844. No phone frame, no status bar, no home indicator.
- The whole sheet fits WITHOUT scrolling on a normal day AND on a Monday with the recap card. Propose how (shorter tiles, a tighter recap, folding the climb or the Worldgate line): your call.
- 375 x 667 (iPhone SE) may scroll, but the seal must never clip.
- Tiles may differ in size if it reads better, but keep four distinct tiles. Each must read at a glance (about two seconds).

VISUAL LANGUAGE (live app; match the screenshots)
- Background near-black navy #0a0a18; cards #13132a, about 22px radius, thin gold border, soft glow.
- Gold #f5b842 is the hero (glow rgba(245,184,66,.30)); violet #8b5cf6 / #a78bfa; steps green #4ade80; ink #f4f4fb / #9596b2 / #585a76.
- Fonts: Cinzel 700 for big words and numbers; JetBrains Mono 800 uppercase, wide-tracked, for labels; system sans for body.
- Line-art SVG emblems. No photos, no emoji, no 3D.

MOTION
Write the entry timing as a comment (ms from mount); today's screen staggers in from 80 ms to about 1,200 ms. Numbers may count up, flames may flicker, the YOU dot may land last. Reduced motion: fades only, and the seal still works.

TONE
A system addressing a hunter: plain, a little severe, proud. No exclamation marks, no emoji, nothing cute.

DELIVER
One HTML file showing:
- the veteran (the samples above) on a normal day, and on a Monday (recap card: LAST WEEK, 289 of 289 vows, seven gold dots, "All 7 days went by with every vow kept.");
- a new hunter: day 3, no friends, 2 days of steps, E rank;
- every other tile state side by side: pact (waiting on you, waiting on you both, all cold, no friends), steps (bottom half, first place, not enough days, no Health), board (new, read), review (resting, thanked);
- a tile tap: the pressed state, then the quick stamp.
CSS variables for the tokens, inline SVG, a little JS for the motion. Prefix every class (for example .tb4-) so nothing collides with the app's CSS.
