# Awakened — App Store marketing assets

W189-Prep deliverable. This folder holds the App Store screenshot
composition tool, captures, and metadata tracking. **Nothing here ships
to iOS.**

## What's excluded from the production bundle

This folder is invisible to:

- `sw.js` PRECACHE_ASSETS — only explicit paths are precached
- `scripts/prep-local-build.sh` — only `index.html / styles.css / app.js / auth.js / simulated-leaderboard.js / sw.js / manifest.json` and named `assets/*` subdirs are copied to `www/`
- Capacitor sync — operates from `www/` only

You can verify with: `grep -n "marketing/" sw.js scripts/prep-local-build.sh` — both return empty.

## Files

| File | Purpose |
|---|---|
| `screenshot-template.html` | The 6-artboard composition tool. Renders ClaudeDesign's marketing chrome (background bloom + Cinzel headline + iPhone device frame) at exact App Store dimensions, with a slot for a real simulator capture per artboard. |
| `captures/` | Drop iOS Simulator screenshots here. Filenames: `01-status.png` through `06-guild.png`. **`.gitignore`d** — don't commit captures into the repo (they may contain demo state worth iterating). |
| `app-store-metadata.md` | Source of truth for App Store Connect subtitle / description / keywords / what's new copy per version. Closes the "metadata not tracked in repo" gap. |

## App Store screenshot workflow

### Stage 1 — Demo seed on Mac

1. Open iOS Simulator: **iPhone 16 Pro Max, iOS 18+**, install Awakened W188 TestFlight build (or run from Xcode).
2. Sign in with demo alias **KAIROS**.
3. Hand-seed localStorage via Safari → Develop → Simulator → Storage Inspector:

   | Key | Value | Notes |
   |---|---|---|
   | `hb_points` | `6840` | Rank C territory |
   | `hb_souls` | `{"balance": 310, "lifetime_earned": 850}` | Matches `persistSouls` shape |
   | `hb_bosses` | Per-boss `{ kill_count: N }`, summing to 18 | E + D-rank only |
   | `hb_class` | `WILL` | Paladin (matches ClaudeDesign hero example) |
   | Habit completions + streaks | Mixed, 3-4 sealed today, longest streak ~31 days | Via the documented `compoundStreaks` paths |

4. Open the app, walk every tab, confirm everything looks real.

### Stage 2 — Capture

Use Simulator → File → Save Screen (`Cmd+S`). Save each as:

```
marketing/captures/01-status.png    ← Status tab with rank tile, hunter portrait, souls, World Rank
marketing/captures/02-habits.png    ← Habits tab with mixed sealed/unsealed vows + Apple Health verify chip visible
marketing/captures/03-rankup.png    ← Hunter Report W187 preview OR First Awakened rank-up modal
marketing/captures/04-boss.png      ← Boss / Quests tab with engageable boss + condition text
marketing/captures/05-stats.png     ← Stats tab with stat levels + relic in armory
marketing/captures/06-guild.png     ← Social / Guild + Steps leaderboard (W181 sim rows fine)
```

Capture dimensions from the iPhone 16 Pro Max Simulator will be `1320 × 2868`. That's the right size for the App Store 6.9" set.

### Stage 3 — Wrap in marketing chrome

1. Open `screenshot-template.html` in **Chrome** (Safari works too, but Chrome's DevTools node-capture is the most reliable).
2. Each `.aso-shot` artboard now shows your real capture inside the iPhone device frame, framed by the Cinzel headline + gold rules + background bloom.
3. Open DevTools (`F12`) → Elements panel.
4. For each artboard:
   - Right-click the `.aso-shot` element in the DOM tree
   - Select **"Capture node screenshot"**
   - Chrome saves a perfect `1320 × 2868` PNG to Downloads
5. Rename outputs: `final-01-status.png` ... `final-06-guild.png`.

### Stage 4 — Upload

1. App Store Connect → My Apps → Awakened: Habit RPG → **2.2.5** version
2. **Screenshots** → iPhone 6.9" Display
3. Drag all 6 in order
4. Apple auto-derives the 6.7" and 6.5" sets from the 6.9" baseline
5. iPad 13" set: same workflow at iPad simulator, separate captures

### Stage 5 — Subtitle + metadata

Subtitle recommendation (ClaudeDesign + W189-Prep consensus):

- **Control: `A habit RPG for real growth.`** (28 chars, keyword-rich for ASO)
- **A/B variant later: `Real habits. RPG rewards.`** (25 chars, punchier)

Don't change the current subtitle in this submission round. Document it in `app-store-metadata.md` (next), then change after a 30-day baseline read.

## Constraints honored

- ✗ No private vow names visible in any screenshot
- ✗ No precise HealthKit values shown (only verification chips)
- ✗ No real user / friend aliases (only demo or W181 sim rows)
- ✗ No Duels / PvP — retired in W160
- ✗ No widget / Apple Watch — not shipped
- ✗ No "Solo Leveling" or protected IP language in captions
- ✗ No AI / LLM claims — The First Awakened uses canned strings
- ✓ The First Awakened appears in slot 3 ONLY (he's a beat, not a brand mark)
- ✓ Apple Health chip appears in slot 2 ONLY (verify chip, never raw data)

## What's NOT in this PR

Production code is unchanged. No `APP_BUILD_TAG` bump, no `app.js?v=` bump, no `sw.js CACHE_VERSION` bump, no footer change. App Store metadata + screenshots are independent of the binary — Apple accepts metadata updates without resubmitting the .ipa.

Production tag `v2.2.5-appstore` continues to point at `bcac999` (W185 / App-Store-approved binary).
