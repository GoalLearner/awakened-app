# Awakened — App Store metadata

Source of truth for App Store Connect copy. Closes the gap identified in
W189-Prep §3 (subtitle / description / what's-new copy not previously
tracked in repo — only in App Store Connect, lost when sessions reset).

Update this file every time App Store Connect metadata changes.

---

## ⚠ 3.0.6 — READY TO PASTE (W967, drafted 2026-09-20)

Three parts: the release notes, and **three corrections to the live description**. The
corrections matter more than the notes — two of them describe features the shipping build
does not have, which is what Guideline 2.3.1 is about.

### Release notes (What's New)

```
The ladder you climb, where you can see it.

• Your rank moves when you do. The bar under your rank card fills toward
  your next division and flashes every time you seal a vow. It was always
  being counted — the header was hiding it.

• A division is a moment now. A letter is three marks. Crossing D III to
  D II lights one of them, and the screen tells you how many are left
  before the next letter.

• The gate falls like it matters. When the world boss goes down, the
  screen names the monster, how many hunters brought it down, and how many
  of your own steps landed on it.

• The Worldgate stops escalating. It no longer grows after a win — next
  week's gate is the same size as this week's.

Also fixed: Manage Vows was opening below the fold and read as a dead
button.
```

### Correction 1 — Ranked PvP (REQUIRED)

The live description carries this as a headline bullet:

> Ranked PvP — The Arena — Live turn-based duels, a seasonal rating ladder, and spar a
> friend's Echo anytime.

**None of it is reachable.** `PVP_RANKED_LOCKED = true` (app.js:16902) seals the ranked queue
**and** the friend Echo — both route to `_pvpLockedNudge()`, a card reading *"The Arena Is
Sealed — ranked duels open once enough rivals have awakened."* A reviewer following the
description gets that card. Replace the bullet with something true and already shipped:

```
One world boss, all of us — Every hunter's verified steps strike the same weekly Worldgate.
Bring it down together, and the hunters who landed enough steps share the bounty.
```

Put the PvP bullet back when `PVP_RANKED_LOCKED` flips to false.

### Correction 2 — Streak Shields (REQUIRED)

> Streaks with stakes — Keep your daily vows, build streaks, and earn Streak Shields and soul
> rewards.

Streak Shields were **deleted in W918** (owner, 2026-09-06). Replace with:

```
Streaks with stakes — Keep your daily vows and hold your streak. The system remembers every
one, and pays souls for the discipline.
```

### Correction 3 — the five-hunter raid (worth a word)

> Hunt bosses solo or co-op — Take down dungeon bosses on your own, or summon up to four
> allies for a five-hunter raid.

The five-hunter raid (the Grinning God) is `membersOnly: true` and gated on `isMember`
(app.js:57694). Softer than the other two — it exists, it is just paid — but the sentence
reads as included. One word fixes it:

```
… or summon up to four allies for a five-hunter raid (Premium).
```

### Also outstanding, not metadata
- ASC **review notes** reportedly still say membership has "no gameplay effect". Verify.
- Download size is **344 MB**, nearly all relic/boss art at print weight.
- The privacy-policy URL on the listing is a default Netlify subdomain.

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

---

## 2.2.7 — SUBMITTED COPY (drafted 2026-06-17, paste-ready)

⚠️ The previously-live description opened with "Solo Leveling inspired" — protected
IP, an App Review 2.3.1 risk. This copy REMOVES it. Replace the live description.

### Promotional text (170 max)
> Turn your habits into an RPG. Real vows, verified by Apple Health, earn XP — rank up your hunter and fell bosses with pure discipline. The grind, witnessed.

### Description (4,000 max)
```
AWAKENED — TURN YOUR HABITS INTO AN RPG

You already know what to do. Awakened makes you want to do it.

Every habit you keep in real life levels up a hunter inside the game. Walk your steps, sleep enough, finish a workout — Apple Health verifies it, and you earn XP, grow your stats, and climb from E-rank to Sovereign. No fake check-ins. No logging you can game. Only real discipline counts.

HOW IT WORKS
• Set your vows — your real habits. Keep them daily.
• Apple Health verifies steps, sleep, workouts and more, automatically.
• Earn XP, level up your stats, and rank up your hunter.
• Build streaks. The system remembers every one.

FIGHT BOSSES WITH REAL DISCIPLINE
Each boss falls only when you hit a real-world goal — 10,000 verified steps, a logged workout, a flight of stairs. Slay it, claim relics and souls, grow stronger.

CLIMB THE ASCENT
One hundred floors, each harder than the last. The summit — the First Awakened — is the endgame. Only a fully built hunter reaches it.

HUNT TOGETHER
Summon a friend and bring down a co-op boss together. Walk your steps side by side, and when the beast falls, you're both credited.

COMPETE & SHARE
• A weekly Steps leaderboard that resets every Sunday — climb against real hunters and your friends.
• Hunters in your rank — a board you can actually win.
• Share your boss kills and your Hunter Report card straight to your story.

FREE AND FAIR
The core — habits, bosses, the Ascent, the leaderboard, co-op — is free and stays fair. Nothing is pay-to-win. Cosmetics only.

The system is watching. Keep what you swore.
```

### What's new in 2.2.7 (4,000 max)
```
Hunter — the system opens to allies.

CO-OP HUNTS
Summon a friend and bring down The Twin Maw together — combine your steps, share the kill, both of you credited. When an ally calls you in, the summons arrives as a full cinematic.

A SHARPER ARENA
• The global Steps leaderboard, redesigned — cleaner, with your rank pinned in view.
• New prestige marks beside your name: the 100K Step Club seal and the 100-boss-kills stamp.
• Leave an active co-op hunt any time, with no penalty.

Plus polish and fixes throughout.

Keep what you swore.
```
