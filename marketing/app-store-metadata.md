# Awakened — App Store metadata

Source of truth for App Store Connect copy. Closes the gap identified in
W189-Prep §3 (subtitle / description / what's-new copy not previously
tracked in repo — only in App Store Connect, lost when sessions reset).

Update this file every time App Store Connect metadata changes.

---

## Current — live as of 2.2.5 (W185 / `bcac999`)

| Field | Value |
|---|---|
| **App name** | Awakened: Habit RPG |
| **Subtitle** | _[fill in from App Store Connect — current live value]_ |
| **Primary category** | Health & Fitness |
| **Secondary category** | Lifestyle |
| **App Store URL** | https://apps.apple.com/app/awakened-habit-rpg/id6764727990 |
| **App ID** | 6764727990 |
| **Bundle ID** | com.goallearner.awakened (verify on Mac) |
| **Submission ID (2.2.5)** | 6175efed-0d8c-4caa-891e-f609ed440c5a |
| **Approval date** | 2026-06-05 |

### Current subtitle

_[paste the exact 30-char subtitle from App Store Connect here]_

### Current description (live)

_[paste the live description from App Store Connect — copy from the
listing page, preserve formatting]_

### Current keywords (100-char limit)

_[paste current comma-separated keyword list]_

### Promotional text (170 chars)

_[paste current promotional text]_

### What's new in 2.2.5

> Hunter — the system grows sharper.
>
> • Meet The First Awakened — your guide through the early gates of the system
> • Eight new hunter class portraits, redrawn in full
> • Manage Vows — release vows you no longer keep without losing your streak history
> • A top 10 finish on the Steps leaderboard now posts to your Guild feed
> • Global Rankings refined — Steps is the singular proving ground
> • New app mark, sharper
>
> Keep what you swore.

---

## ✅ READY TO PASTE — ASO copy (W327, drafted 2026-06-15)

Paste into App Store Connect. Name + Subtitle + Keywords are the INDEXED
fields — do NOT repeat name/subtitle words in Keywords (wasted space).
No new build is required for metadata-only updates.

### Subtitle (30 max) — RECOMMENDED
`A habit RPG for real growth` (27 chars)

> Names the category for ASO relevance and adds a benefit ("growth").
> A/B alternative: `Real habits. RPG rewards.` (25) — punchier, test later.

### Keywords (100 max — comma-separated, NO spaces)

```
tracker,streak,routine,discipline,motivation,goals,fitness,workout,steps,sleep,quest,boss,level,rank
```

> Exactly 100/100. Excludes words Apple already indexes from the name
> ("awakened","habit","rpg") and subtitle ("growth"). Singular forms only
> (Apple matches plural automatically).

### Promotional text (170 max)

> Turn your habits into an RPG. Complete real vows — verified by Apple Health — to earn XP, rank up your hunter, and slay bosses with pure discipline. The grind, witnessed.

### Description (4,000 max)

```
AWAKENED — TURN YOUR HABITS INTO AN RPG

You already know what to do. Awakened makes you want to do it.

Every habit you keep in real life levels up a hunter inside the game. Walk your steps, sleep enough, finish a workout — Apple Health verifies it, and you earn XP, grow your stats, and climb from E-rank to Sovereign. No fake check-ins. No logging you can game. Only real discipline counts.

HOW IT WORKS
• Set your vows (your habits). Keep them daily.
• Apple Health verifies steps, sleep, workouts and more — automatically.
• Earn XP, level up, and rank up your hunter.
• Build streaks. The system remembers every one.

FIGHT BOSSES WITH REAL DISCIPLINE
Each boss falls only when you hit a real-world goal — 10,000 verified steps, a logged strength workout, a flight of stairs. Slay it, claim relics and souls, grow stronger.

CLIMB THE ASCENT
100 floors, each harder than the last. The summit — The First Awakened — is the endgame. Only a fully-built hunter reaches it.

COMPETE & SHARE
• Weekly Steps leaderboard, reset every Sunday — race real hunters and your friends.
• "Hunters in your rank" — a board you can actually win.
• Share your boss kills and your Hunter Report card straight to your story.

FREE AND FAIR
The core — habits, bosses, the Ascent, the leaderboard — is free and stays fair forever. Nothing is pay-to-win. Cosmetics only.

The system is watching. Keep what you swore.
```

### What’s new — next version (match to the shipped build before pasting)

> Hunter — the system reaches further.
>
> • Share your boss kills and Hunter Report as a card — straight to your story
> • New boards: Hunters in your rank, and a Friends leaderboard
> • The weekly Steps board now shows a live "resets Sunday" countdown
> • Become a Founder — back Awakened once, keep it forever
>
> Keep what you swore.

---

## W189 candidates (pending decision)

### Subtitle — ClaudeDesign + W189-Prep recommendation

**Control: `A habit RPG for real growth.`** (28 chars)

Rationale:
- Names the category ("habit RPG") — strong for ASO keyword relevance
- Adds a benefit ("real growth") — pairs with the headline rather than echoing it
- Plain enough for cold App Store browsers
- 28 chars leaves 2-char headroom

**A/B variant: `Real habits. RPG rewards.`** (25 chars)

- Punchiest of the four candidates
- Better for casual / impatient browsers
- Test against Control after baseline data

### Screenshot sequence (6.9" set, iPhone 16 Pro Max baseline)

| # | Kicker | Headline | Capture target |
|---|---|---|---|
| 01 | A HABIT RPG | Turn your habits into an **RPG**. | Status / Home — rank tile + hunter portrait + World Rank + souls |
| 02 | THE DAILY LOOP | Complete vows. Earn **XP**. | Habits tab — mixed sealed/unsealed vows + Apple Health verify chip on one |
| 03 | WITNESSED | Rank up your hunter. | Hunter Report W187 preview OR First Awakened rank-up modal |
| 04 | THE HUNT | Fight bosses with real **discipline**. | Boss / Quests — engageable boss with condition text |
| 05 | YOUR BUILD | Grow your stats. Earn **relics**. | Stats + Armory — stat levels + relic detail |
| 06 | TOGETHER | Climb the ranks with your **guild**. | Social / Guild + Steps leaderboard (W181 sim rows acceptable) |

Logic per ClaudeDesign: shots 1–3 must stand alone for browsers who only see the first three. That trio = **promise → action → differentiator**.

### Future what's new entries

When 2.2.6 ships, the entry should highlight:

- Day 3 / Day 7 / streak-loss First Awakened check-ins (W186)
- Hunter Report shareable card (W187 / W188)

Draft for 2.2.6:

> Hunter — every climb is now witnessed.
>
> • Day 3 / Day 7 check-ins from The First Awakened
> • Streak-loss recovery moment — the discipline does not break with the streak
> • Hunter Report — a shareable artifact of your rank-up moment
>
> Bear the mark.

(refine on actual ship)

---

## Notes on Apple's character limits

| Field | Limit |
|---|---|
| Subtitle | 30 chars |
| Promotional text | 170 chars |
| Description | 4,000 chars |
| Keywords | 100 chars (comma-separated, no spaces between) |
| What's new | 4,000 chars |
| Screenshot caption (in image) | unlimited but readable at 60×60 thumbnail matters |

## Apple-spec dimensions per device class (2024+)

| Device class | Required for new submissions | Dimensions |
|---|---|---|
| iPhone 6.9" | ✓ **Required baseline** | 1320 × 2868 |
| iPhone 6.7" | Derived from 6.9" | 1290 × 2796 |
| iPhone 6.5" | Optional after 6.9" | 1284 × 2778 |
| iPad 13" | Optional | 2064 × 2752 |
| iPad 12.9" | Derived | 2048 × 2732 |

Capture once at 6.9", let Apple derive the smaller iPhone sizes.
