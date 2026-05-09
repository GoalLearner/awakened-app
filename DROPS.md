# DROPS.md — Awakened Drops / Card Collection System

**Status:** v1 design. Not yet implemented.
**Last updated:** May 9, 2026
**Designer:** Richie (with Claude as design partner)

Companion docs:
- `BOSSES.md` — boss system mechanics, framework principles
- `CARDS.md` — boss card visual spec
- `CLAUDE.md` — operational reference for shipped code

---

## Purpose

A Pokédex-style cosmetic card collection system on top of the boss
kill loop. Bosses drop unique cards on kill (with rarity-tiered
RNG); other systems (daily login, achievements, events) drop
additional cards. Long-term collection target: **150 cards total**.

Drops have **no mechanical effect** in v1 — they are pure
collectible cosmetics. The reward is the rarity itself + the
"complete the dex" satisfaction.

---

## Framework — locked design principles

### 1. Pure cosmetic collection (v1)

Cards have no stat boosts, no titles, no lore unlocks, no
mechanical impact on gameplay. They exist as collectibles. The
reward IS the card itself + its rarity + completion progress
toward the 150-card Pokédex.

> **Rationale:** Three independent systems, each with one job.
> Souls handle the economy. Habits/ranks handle progression.
> Drops handle collection/flex. No overlap, no balance issues.
> Stat-bearing cards may be added in v2+ as a separate layer.

### 2. Pokédex-150 long-term target

Total card collection target: **150 cards** at full system
maturity. Cards come from boss drops AND non-boss sources
(daily logins, achievements, special events, rank milestones).

v1 launch ships a subset (<150). Cards added incrementally over
time. The 150 number gives the system a known endpoint and
"complete the dex" framing.

> **Rationale:** Pokédex completion is one of the strongest
> long-term engagement mechanics in gaming. Knowing there are
> 150 slots — even if 120 are undiscovered — creates
> persistent aspiration. Empty slots are the engagement loop.

### 3. Boss-specific drops + non-boss alt sources

Boss kills drop boss-specific cards (e.g., The Insomniac drops
"Sleepwalker's Cloak"; only droppable from Insomniac). This is
the primary drop source — OSRS-authentic.

Non-boss sources fill out the dex with cards not tied to specific
bosses:
- Daily login milestone rewards (e.g., 7-day login streak → card)
- Rank-up achievements (e.g., reach D rank → card)
- Special events (e.g., 100 lifetime kills → card)
- Holiday/seasonal cards (future)

> **Rationale:** Pure boss-specific drops can't reach 150 cards
> without 9-boss roster × 16-17 cards each. Adding alt sources
> diversifies engagement and lets us reach 150 without bloating
> any single boss's table.

### 4. Roll on kill only

Each boss kill (streak completion fires the kill event) = 1
roll against that boss's drop table. No rolls on non-kill
nights. Matches the streak-completion-with-drops model already
shipped.

### 5. Pure RNG with first-uncommon protection

Drop rates are pure random per kill. **Exception:** until the
player earns their first uncommon-tier card from any boss, the
uncommon roll rate is boosted to 2/3. The moment they pull
their first uncommon, this protection ends and rates revert to
standard for all future rolls (across all bosses).

> **Rationale:** New players need to discover the system exists
> via a real card pull early. 2/3 boost means most players hit
> their first uncommon within 1-2 days. But it's not guaranteed
> — variance preserved.

### 6. No common-tier card slot

Most boss kills produce souls only — no card. This keeps card
drops *special*. Only ~20% of kills (uncommon rate) actually
drop a card. The remaining ~80% are still rewarded with souls.

> **Rationale:** Common cards on every kill would dilute the
> "I got a card!" moment. Better to have ~80% of kills produce
> souls only and ~20% produce a card.

### 7. Stack-with-badge for duplicates

Pulling the same card twice increments a stack counter. Card
displays with "×N" badge. No combine-to-upgrade in v1.

> **Rationale:** Simple to implement, OSRS-authentic. Combine
> mechanics deferred to v2.5+.

### 8. No equip slots in v1

Cards live in inventory only. No "equipped on profile"
display. Cards are visible to the user (own inventory) but
not displayed publicly anywhere yet.

> **Rationale:** Equip slots require profile/leaderboard
> display surfaces. Defer to v2 when leaderboard is live and
> public profile mechanics make sense.

---

## Drop rates — daily-cadence bosses

| Tier | Rate | Drop content |
|---|---|---|
| (No card) | ~80% of kills | Souls only, no card pulled |
| Uncommon | 1/5 (~20%) | Cosmetic card, uncommon-tier border |
| Rare | 1/15 (~7%) | Cosmetic card, rare-tier border + glow |
| Ultra-rare | 1/40 (~2.5%) | Trophy card, ultra-rare animated border |

**First-uncommon protection (new player):** uncommon rate
is 2/3 instead of 1/5 until first uncommon drop, then snaps
to standard rate.

**Expected pull rate at realistic 5/7-days-per-week sleep
success, streak-completion-of-2 model:**
- ~65 successful kills/year per daily-cadence boss
- ~13 uncommons/year per boss
- ~4 rares/year per boss
- ~1.5 ultra-rares/year per boss

**Weekly-cadence bosses (Carouser):** roughly half kill
frequency of daily bosses, but same drop rates per kill.
~32 kills/year, ~6 uncommons/year, ~2 rares/year, ~0.8
ultra-rares/year.

---

## Card anatomy

### Visual identity

**Aspect ratio:** 1:1 (square). Distinct from boss cards (5:7
portrait).

**Aesthetic:** Same family as boss cards — Solo Leveling
system-window style, Awakened purple/gold/dark palette.
Different shape signals different category at a glance.

### Card layout

```
┌────────────────────────────┐
│                            │
│                            │
│     [BOSS / ITEM ART]      │
│      bleeds to edges       │
│                            │
│                            │
│  ────────────────────────  │
│  CARD NAME           ●●●  │  ← name + rarity dots
│  From: The Insomniac       │
│  "Worn by those who walk   │
│   the line between..."     │
└────────────────────────────┘
```

### Region breakdown

**Art region (~75% of card height):**
- Square art bleeds to all edges
- Atmospheric edges fade to dark for blend
- Manhwa cel-shading style

**Footer region (~25% of card height):**
- Card name (top of footer, bold gold serif)
- Rarity indicator (top right of footer — small dots or pip
  marks; uncommon=2 silver, rare=3 gold, ultra-rare=4 animated)
- Source line (small gray text: "From: [Boss Name]" or
  "Reward: [event name]")
- One-line flavor text (italic, gray-purple)

### Rarity differentiation

**Uncommon:**
- Standard purple border (matches base card frame)
- No background glow
- Silver rarity pips

**Rare:**
- Gold border (replaces purple)
- Subtle inner glow (gold, low alpha)
- Gold rarity pips

**Ultra-rare:**
- Animated gold border (slow shimmer/pulse)
- Radial particle effect background (gold sparks drifting)
- 4 pips with subtle animation
- Distinct visual moment — clear at a glance this is special

### Stack count display

Cards with stack > 1 show small "×N" badge in top-right corner
of card art region. Doesn't obscure art significantly.

---

## Inventory UI — Pokédex-as-Primary

### Tab placement

Inventory lives in the existing **Items tab** (already in the
app's icon row). Confirm with code which icon represents this
tab and what its current content is.

### Layout structure

**Top section — Pokédex completion summary:**

```
ITEMS — DISCOVERED 23 / 150
[progress bar visual]
```

**Sections grouped by rarity (within Pokédex frame):**

- **Ultra-Rare section** — 8 slots total target, ? discovered
- **Rare section** — 30 slots total target, ? discovered
- **Uncommon section** — 112 slots total target, ? discovered

(Specific counts per tier TBD — these are rough placeholder
numbers totaling 150)

Each section header shows discovered/total: "ULTRA-RARE — 1/8"

### Card slot rendering

**Discovered cards:** full card art + name visible. Tappable
to expand to detail view.

**Undiscovered cards:** placeholder slot with rarity tier
indicator and "???" overlay. Slot exists in the grid as visual
silhouette/teaser. NO art generation needed for undiscovered —
just a styled empty slot with rarity color hint.

Example undiscovered slot:
```
┌──────────┐
│          │
│    ?     │
│          │
│          │
│  ●●●     │  ← rarity pips so user knows what tier
│  ???     │
└──────────┘
```

**Rationale on placeholders:** the "fill the dex" energy
requires *visible* slots. Empty unrendered slots = users don't
know what they're missing. Rarity-tier placeholders ("Uncommon
???") give anticipation without requiring DALL-E generations
for undiscovered cards. Real card art only generated for
discovered cards.

### Card detail view

Tapping a discovered card opens a full-screen detail modal:

- Large card render (zoomed)
- Source: "Dropped from The Insomniac" (or "Earned at 7-day
  login streak", etc.)
- Drop date / first acquired date
- Stack count if > 1
- Long flavor text
- Back button to inventory

Tapping an undiscovered card slot:
- Toast: "Not yet discovered"
- OR detail modal showing rarity, possibly source hint
  ("Drops from a sleep-themed boss"), no other details

---

## Drop notification UX

### Uncommon drops

**Single combined toast** appended to kill toast:

> "The Insomniac defeated. +50 souls. Pulled: Dreamer's Fragment (Uncommon)."

Subtle. No interruption to flow. Card appears in inventory
immediately. User can investigate when they want.

### Rare and ultra-rare drops

**Modal reveal sequence:**

1. Kill toast fires normally ("The Insomniac defeated. +50 souls.")
2. After ~500ms delay, full-screen modal opens
3. Solo Leveling-style system-window materializes
4. Reveal animation:
   - Rarity flash (gold burst)
   - Card border draws in
   - Card art reveals progressively (fade-in or wipe)
   - Card name appears
   - Source + flavor text fade in
5. User taps anywhere or "Continue" button to dismiss
6. Card now visible in inventory

This is the cinematic moment. Ultra-rare reveals get extra
flair — longer animation, more particles, distinctive sound
cue if/when sound is added.

### Notification queueing

If multiple drops happen between user's app sessions (e.g.,
auto-verify fires during background), queue rare/ultra-rare
modals. Show one at a time on next app open. Don't drop any.

---

## Drop sources beyond bosses (for the 150 dex)

### Boss-specific drops

Per-boss drop tables. Initial estimate: ~10-12 cards per boss
across rarities. With 9-boss roster, ~90-108 boss-source cards.

Breakdown per boss (rough):
- 6-7 uncommon cards
- 3-4 rare cards
- 1-2 ultra-rare cards
- Total: ~10-13 cards

### Non-boss drop sources (~50 cards to fill out the dex)

These cards are NOT tied to specific bosses. They drop from
other systems:

**Daily login streak rewards:**
- 7-day login: card unlock
- 30-day login: card unlock
- 100-day login: ultra-rare card

**Lifetime kill milestones:**
- 10 lifetime kills (any boss): card
- 50 lifetime kills: card
- 100 lifetime kills: rare card
- 500 lifetime kills: ultra-rare card

**Rank-up rewards:**
- Reach D rank: card
- Reach C rank: card
- Reach B rank: rare card
- Reach A rank: rare card
- Reach S rank: ultra-rare card

**Achievement-based:**
- First boss defeated: card
- All 3 starting bosses engaged simultaneously: card
- 30 souls in balance: card
- 1000 souls earned lifetime: card
- ... etc

**Special events (future):**
- Holiday cards (e.g., New Year, anniversary)
- Limited-time event cards
- Community challenge rewards

**Specific source mix to be designed across 50 cards. Not
locked in v1 design — will be specified during implementation
based on app maturity and user behavior.**

---

## Implementation phases — minimum viable v1

If forced to ship the smallest possible version:

### Phase 1 — Core engine (week 1)
- Drop roll logic on kill (uncommon/rare/ultra-rare per existing rates)
- First-uncommon protection state
- Storage schema (`hb_inventory` keyed by card_id, value = `{discovered, count, first_acquired_date}`)
- Card data structure (`CARDS` constant in code with id, name, rarity, source_boss, flavor)
- 1-3 cards per boss only (3 bosses × 3 cards = 9 cards launch)
- Drop fires correctly, card adds to inventory, basic toast notification

### Phase 2 — Inventory UI (week 2)
- Items tab populated with Pokédex frame
- Sections grouped by rarity
- Discovered/undiscovered slot rendering
- Card detail modal
- "X / Y discovered" header

### Phase 3 — Reveal moment (week 2)
- Modal reveal animation for rare/ultra-rare
- Solo Leveling system-window materialize style
- Tap-to-dismiss

### Phase 4 — Card art generation
- DALL-E art for the launch 9 cards
- Square 1:1 manhwa style
- Match the established Awakened art language

### Phase 5+ — Roster expansion
- Add cards 10-30 (more per existing boss)
- Add non-boss source cards (login milestones, etc.)
- Approach 150-target gradually over weeks/months

---

## Open design questions (deferred)

1. **Specific 150-card distribution across rarities.**
   Locked: ~150 total. Unlocked: how many uncommons, rares,
   ultra-rares.

2. **Card naming convention.** Boss-specific names like
   "Sleepwalker's Cloak" make sense. Non-boss source names
   need direction (e.g., "Wanderer's Token" for login
   rewards? "Dawn Pin" for early-rank achievements?).

3. **Card art consistency.** With 150 cards eventually,
   maintaining visual coherence across all generations is a
   real challenge. Style guide for prompts needed.

4. **Per-boss table balance.** Specific cards per rarity per
   boss. Currently spec'd "~10-13 cards per boss" — exact
   distribution per boss TBD.

5. **Equip slot system (v2).** When leaderboard goes live and
   public profiles exist, equip slot mechanics need spec.

6. **Combine-to-upgrade (v2.5+).** Stack mechanics deferred
   but eventually 3 commons → 1 uncommon could be added.

7. **Card trading/social.** Future feature. Players sharing
   cards with friends. Way out of scope for v1.

---

## Decision log — for future-you

- **Pure cosmetic over stat-bearing:** three independent
  systems (souls, ranks, drops) each doing one thing well.
  Stat cards add balance complexity without clear product
  benefit at this stage.

- **Pokédex-150 vs unlimited collection:** known endpoint
  creates persistent aspiration. Unlimited collection feels
  endless and dilutes meaning of completion.

- **Boss-specific + alt sources:** pure boss-only drops can't
  reach 150 without bloating per-boss tables. Alt sources
  diversify the engagement and let casual users earn cards
  through non-boss play.

- **No common card slot:** ~80% of kills producing souls only,
  20% producing cards keeps drops feeling special. Common
  drops on every kill would train users to ignore drops.

- **Modal reveal for rare/ultra-rare only:** uncommon happens
  often enough that modal-on-every-uncommon is annoying.
  Ultra-rare deserves a moment.

- **Rarity-tier placeholders for undiscovered:** "Uncommon ???"
  vs full silhouette art. Same anticipation effect, half the
  art generation work.

- **Square 1:1 cards vs 5:7 portrait:** distinct shape from
  boss cards signals different category at a glance. Square
  also focuses attention on art (drops are about the art).

- **Inventory tab already exists:** wire into existing surface
  rather than build new tab.

- **Stack with badge, no combine-to-upgrade:** simpler MVP,
  combining mechanics deferred to v2.5+.

- **No equip slots in v1:** preserves "self-flex" via
  inventory ownership without requiring profile/leaderboard
  display surfaces.

---

*End of v1 design. Build incrementally over weeks. Phase 1 is
the engine — once that ships and works reliably, everything
else is content + UI polish on top.*
