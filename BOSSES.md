# BOSSES.md — Awakened Dungeon Boss System

**Status:** v1 design. Partially implemented in v2.0.1 (Insomniac, Carouser, Steel Wolf shipped).
**Last updated:** May 8, 2026
**Designer:** Richie (with Claude as design partner)

> **Drop-rate references in this document are STALE.**
> See `DROPS.md` (v1.4+) for the authoritative rate tables.
> Notably: the bottom rarity tier was renamed `uncommon` → `common`
> in v1.3, and rates were tuned per-cadence in v1.4 (weekly bosses
> use multiplier-bumped rates over daily). This doc retains the
> original framing for design-history continuity but should not be
> used for engine-side rate decisions. The shipped code reads from
> `DROP_RATES_BY_CADENCE` in `app.js`.

---

## Purpose

A loot-driven boss/card system layered on top of Awakened's habit
tracking. Inspired by OSRS boss-grinding mechanics: every successful
verifiable habit instance counts as one "kill" against an applicable
boss, rolling that boss's drop table for cards, stat boosts, titles,
and trophy items.

Bosses are **the long-term reward layer** of Awakened. They reward
sustained behavior, not perfectionism. There is no failure state.

---

## Framework — locked design principles

These are settled. Future iterations should not reopen them without
strong reason.

### 1. Verifiability rule

**Bosses exist only for verifiable habits.** A verifiable habit is one
where Awakened can independently confirm the kill condition was met
without trusting user self-report:

- HealthKit-backed (sleep, steps, workouts, mindful sessions)
- Future: third-party integrations (Strava, Whoop, language-learning
  APIs, reading apps)

**Self-reported habits do NOT have bosses.** They earn XP, contribute
to streaks, and may have their own gamification (achievements,
milestones) — but bosses are reserved for verifiable behavior.

> **Rationale:** Boss rewards are a system of *earned trust*. Self-reporting
> creates a dishonesty incentive that breaks the system's integrity. A
> ranking/loot system on self-reported data becomes a leaderboard for
> dishonesty, not effort. This decision aligns with the philosophy
> already established for ELO/competition: only verifiable data gets
> ranked.

### 2. Kill-count + drop tables (OSRS model)

Each successful kill rolls the boss's drop table once. Drops accumulate
in the player's collection over time. There is no "completing" a boss
— bosses remain farmable forever once unlocked.

> **Rationale:** Real habits are practices done forever, not quests to
> complete. OSRS-style perpetual grinding is the perfect mechanical
> match: each successful habit = one chance at loot, sustained over
> years. This rewards consistency rather than perfectionism.

### 3. Pure RNG (with new-player protection)

Drops are pure random rolls per kill. No streak bonuses, no
consecutive-kill multipliers, no pity timers (with one exception
below).

**Exception — first-uncommon protection:** Until the player has earned
their first uncommon-tier card from any boss, the uncommon drop rate
is boosted to 2/3 per roll. The moment they pull their first uncommon,
this protection ends and rates revert to standard for all future rolls.

> **Rationale:** New players need to discover the system exists. A
> 2/3 boost in early rolls means most players see their first card
> within 1-2 days, ~96% within 3 days. But it's not a guarantee —
> there's still meaningful variance. The "did I get it?" moment
> is preserved.

### 4. No failure state

Bad days don't punish. Good days roll loot. A missed kill = zero
rolls that day, nothing more. No XP loss, no streak penalty, no
boss-rage mechanic.

> **Rationale:** Wellness apps that punish bad days reward
> perfectionism over consistency, which is the wrong incentive
> for habit formation.

### 5. Rank-gated unlock, always-farmable once unlocked

Bosses unlock as the player progresses through ranks (E → D → C →
B → A → S → SS). Once unlocked, a boss stays available forever —
even at SS rank, the player can still farm The Insomniac for that
elusive ultra-rare drop.

> **Rationale:** OSRS lets max-level players fight low-tier bosses
> indefinitely. Same idea here. Otherwise lower-tier bosses become
> abandoned and their drops impossible to complete.

### 6. Multi-focus — pick up to 3 active bosses

Players can select up to 3 bosses as their active "focus." Focused
bosses get UI emphasis on the home screen, drop notifications, and
may receive minor cosmetic boost markers. All other unlocked bosses
still passively roll in the background — focus is about emphasis,
not exclusivity.

### 7. Cadence as first-class attribute

Each boss has a `cadence` attribute: `daily`, `weekly`, or `monthly`.
Cadence determines drop rate tables. A daily-cadence boss generates
~365 attempts/year; a weekly boss ~52; a monthly boss ~12. Drop
rates per attempt scale inversely with cadence so total expected
loot per year is roughly comparable.

### 8. No lore depth (yet)

Bosses get name + brief flavor text in v1. Deep lore, dialogue,
character arcs — deferred to later versions. Don't let lore-writing
block the system from shipping.

---

## Roster — v1 boss list

Nine bosses across all 7 rank tiers. All verifiable via HealthKit
in v1.

### E rank — entry tier

#### 🌙 The Insomniac
- **Stat:** VIT
- **Habit:** Sleep
- **Cadence:** Daily
- **Kill condition:** ≥7 hours of sleep in one night
- **Auto-verify:** HealthKit `sleepAnalysis`
- **Flavor:** *"A creature born from restless nights. It feeds on
  the hours you should have slept."*

### D rank — early progression

#### 🐺 The Steel Wolf
- **Stat:** VIT
- **Habit:** Daily walk
- **Cadence:** Daily
- **Kill condition:** ≥8,000 steps in one day
- **Auto-verify:** HealthKit `stepCount`
- **Flavor:** *"A wolf forged from miles. Run with it, or be left
  behind."*

#### 🌅 The Liminal
- **Stat:** VIT
- **Habit:** Sleep (composite)
- **Cadence:** Daily
- **Kill condition:** ≥8 hours of sleep AND bedtime before midnight
- **Auto-verify:** HealthKit `sleepAnalysis` (composite)
- **Flavor:** *"It walks the threshold between night and morning.
  Cross too late, and you walk it with them."*

### C rank — mid game

#### 🔥 The Iron Will
- **Stat:** STR
- **Habit:** Strength training
- **Cadence:** Daily (typically 3-5 fires/week based on training schedule)
- **Kill condition:** ≥30 minutes of strength training in one session
- **Auto-verify:** HealthKit `workoutType` (functionalStrengthTraining
  or traditionalStrengthTraining)
- **Flavor:** *"Iron does not bend without will. Forge yours, or be
  shattered."*

#### 📿 The Restless Mind
- **Stat:** FOCUS
- **Habit:** Meditation / mindfulness
- **Cadence:** Daily
- **Kill condition:** ≥10 minutes of mindfulness in one session
- **Auto-verify:** HealthKit `mindfulSession`
- **UX flag:** Requires user to log meditation through a HealthKit-
  compatible app (Calm, Headspace, Apple Mindful, Insight Timer).
  Boss screen should explain this with a CTA: "Connect a meditation
  app to start fighting."
- **Flavor:** *"Stillness is the rarest weapon. Few wield it. Fewer
  master it."*

### B rank — advanced

#### ☀️ The Forgotten Hour
- **Stat:** VIT
- **Habit:** Sleep + morning discipline (composite)
- **Cadence:** Daily
- **Kill condition:** ≥8 hours sleep AND bedtime before 11pm AND
  morning workout within 1 hour of waking
  - *Note:* Original design called for "morning sunlight within 30
    min of waking" but no auto-verify mechanism for that exists yet.
    Replaced with morning workout (HealthKit-verifiable). Revisit
    if/when sunlight verification becomes available.
- **Auto-verify:** HealthKit `sleepAnalysis` + `workoutType` (composite)
- **Flavor:** *"Most never see the hour the world wakes in. It is
  forgotten. So are most."*

### A rank — high tier

#### ⚔️ The Tactician
- **Stat:** STR
- **Habit:** Sustained strength training
- **Cadence:** Weekly
- **Kill condition:** ≥4 strength sessions completed within a
  rolling 7-day window
- **Auto-verify:** HealthKit `workoutType` (counted across week)
- **Flavor:** *"Power without consistency is noise. The Tactician
  speaks only to those who return."*

### S rank — endgame

#### 👑 The Sovereign
- **Stat:** All / composite
- **Habit:** Composite — kill ≥5 different daily-cadence bosses in
  a single day
- **Cadence:** Daily
- **Kill condition:** Player generated kills against at least 5
  distinct bosses on the same calendar day
- **Auto-verify:** Inherited from underlying bosses
- **Flavor:** *"The Sovereign judges only those who have already
  conquered. Bring proof."*

### SS rank — pinnacle

#### 🌌 The Architect
- **Stat:** All / composite
- **Habit:** Sustained mastery
- **Cadence:** Monthly
- **Kill condition:** Generate kills against The Sovereign on 30
  different calendar days (lifetime, not consecutive)
- **Auto-verify:** Inherited
- **Flavor:** *"The Architect builds nothing. They have already
  built everything. Now they only watch who else can."*

---

## Drop rate tables

Three tables, one per cadence. Each tier has a target frequency
and a list of drop types.

### Daily cadence

| Tier | Rate | Examples |
|---|---|---|
| Common | every kill | XP (5-15), currency (1-3 placeholder coins) |
| Uncommon | 1/5 | Cosmetic card, lore card, minor consumable |
| Rare | 1/15 | Named cosmetic card, +1 stat (one-time), title card |
| Ultra-rare | 1/40 | Trophy card (signature item, one-time) |

> **First-uncommon protection (new player only):** uncommon rate is
> 2/3 instead of 1/5 until first uncommon drop. Snaps to standard
> rate after.

**Expected pull rate at realistic 5/7-days-per-week success:**
- ~260 successful kills/year
- ~52 uncommons/year (~1/week)
- ~17 rares/year (~1.5/month)
- ~6.5 ultra-rares/year per daily-cadence boss roster section

### Weekly cadence

| Tier | Rate | Examples |
|---|---|---|
| Common | every kill | bigger XP burst, more currency |
| Uncommon | 1/3 | cosmetic card, lore card |
| Rare | 1/8 | named cosmetic card, +2 stat (one-time), title card |
| Ultra-rare | 1/15 | Trophy card (signature item, one-time) |

**Expected pull rate at realistic 3/4-weeks-per-year success:**
- ~40 successful kills/year
- ~13 uncommons/year
- ~5 rares/year
- ~2.5 ultra-rares/year

### Monthly cadence

| Tier | Rate | Examples |
|---|---|---|
| Common | every kill | big XP, currency, guaranteed cosmetic on 1st kill |
| Uncommon | 1/2 | cosmetic card, lore card |
| Rare | 1/4 | named cosmetic card, +3 stat (one-time), title card |
| Ultra-rare | 1/7 | Trophy card (signature item, one-time) |

**Expected pull rate at realistic 8-10/year success:**
- ~9 successful kills/year
- ~4.5 uncommons/year
- ~2 rares/year
- ~1.3 ultra-rares/year

---

## Cards — item representation

All non-XP, non-currency drops are **cards**. A card is a discrete
visual collectible.

### Card anatomy

```
{
  id: 'card_sleepwalker_cloak',
  name: 'The Sleepwalker's Cloak',
  art: '/assets/cards/sleepwalker_cloak.png',
  source_boss: 'the_insomniac',
  rarity: 'ultra_rare',  // common, uncommon, rare, ultra_rare
  type: 'cosmetic',      // cosmetic, stat, title, lore, consumable
  effect: { stat: 'VIT', amount: 0 },  // optional
  flavor: 'Worn by those who walk the line between dreaming and waking.',
  is_one_time_drop: true,  // some drops fire once total per player
  stack_count: 0           // for non-one-time drops, increments on dupe
}
```

### Duplicate handling

- **Stack with count badge.** Pulling the same card twice increments
  `stack_count`. Display shows the card with a small "x3" indicator.
- **One-time drops** (signature trophies, +stat boosts, lore entries)
  do NOT roll again once obtained. The drop slot rerolls into XP/
  currency on subsequent successful kills.
- **Future enhancement (deferred to v2.5+):** combine-to-upgrade —
  3 commons → 1 uncommon, etc. NOT in v1 scope.

### Card visual style

**Deferred.** Custom design language to be defined later. Working
hypothesis: Solo Leveling-style "system window" aesthetic adapted
to Awakened's purple/gold/dark palette. Card art generated via
DALL-E with consistent prompt structure to maintain visual coherence.

When the visual style is finalized, document it in a separate
`CARDS.md` style guide.

---

## Required surrounding systems

The boss/card system *cannot ship* until these surrounding surfaces
exist. They are sized briefly here as scope flags.

### Inventory / Collection

A new tab or screen showing all collected cards. Filterable by:
- Boss source
- Rarity tier
- Type (cosmetic/stat/title/lore)
- Recently acquired

Cards in inventory should be tappable to see full detail (large art,
flavor text, mechanical effect, stack count, source boss link).

### Profile / Equipped slots

A surface (likely an evolved version of the existing rank tile area)
where the player can choose 1-3 cards to equip. Equipped cards display
on profile and contribute their stat effects (if any).

### Drop notifications

When a kill rolls a non-common drop, the user must be notified:
- **In-app:** small toast or banner at the moment of verification
- **Push:** silent push notification if app is closed
- **Reveal animation:** when user opens the inventory after a drop,
  unseen cards animate in (Solo Leveling-style system-window reveal)

### Boss list view

A new tab showing all unlocked bosses with:
- Kill counter
- Drop log (which cards collected, which still missing)
- Focus toggle (set as one of the active 3)
- Flavor text and rank tier
- Visual indication of locked vs unlocked bosses

This is the "dungeon" tab — likely one of the icon tabs at the top
of the home screen.

---

## Open design questions

Flagged for future resolution. Don't let these block v2 scoping.

1. **Card visual style.** Must be defined before card art is generated.
   Hypothesis: Solo Leveling system-window aesthetic, Awakened purple.
2. **Currency system.** "Sleep Coins" is a placeholder. Real currency
   system needs a shop, balance display, sink/source economy. Tied to
   v3+ economy design.
3. **The Restless Mind UX.** Requires user to use a HealthKit-
   compatible meditation app. Need clear in-app explanation + CTA.
4. **Class balance gap.** INT (study/learning), WILL (discipline),
   WLT (trading/finance) currently have no bosses because their habits
   aren't HealthKit-verifiable. Solve in future by adding third-party
   integrations (language-learning apps, reading apps, trading P/L
   imports). Documented as roadmap, not v2 blocker.
5. **Combine-to-upgrade.** Deferred to v2.5+ as a secondary loop on
   top of base stacking.
6. **Hard mode unlocks.** Beating an ultra-rare drop unlocks "hard
   mode" version of the boss in OSRS-flavored design. Specifics
   deferred — what does hard mode change? Drop rates? Kill conditions?
   Defer to post-v2.
7. **Multiplayer / social bosses.** Boss raids with Julius or other
   friends. Way out of scope for v2 but flagged for v3+.
8. **More verifiable bosses for INT/WILL/WLT.** Roadmap item. As more
   integrations come online, add bosses for those classes.

---

## Implementation notes — minimum viable v2

If forced to ship the smallest possible viable boss system, this is
the cut:

1. **Just The Insomniac.** One boss only. Daily cadence. Drop rates
   as specified. First-uncommon protection enabled.
2. **Just XP and 2-3 cards.** No stat boosts, no titles, no currency.
   Just XP + a handful of cosmetic cards on the drop table.
3. **Stub inventory.** Cards collected go into a simple list view,
   no equip slots, no profile display yet.
4. **Stub drop notification.** In-app toast only, no push, no reveal
   animation.
5. **No focus selection.** The Insomniac is the only boss; focus is
   trivial.

This MVP proves the kill-count → roll → card pipeline works
end-to-end. From there, expand by:
- Adding more bosses (one per release cycle)
- Adding inventory features (equip slots, filtering, profile)
- Adding card visual polish
- Adding currency/economy when card volume justifies a sink

---

## Decision log — for future-you

If you find yourself questioning a decision later, here's why each
was made:

- **OSRS not Solo Leveling not Habitica:** OSRS's perpetual-grind
  drop-table model is the right mechanical match for habits as
  forever-practices. Solo Leveling and Habitica both treat progression
  as completable, which contradicts how habits actually work.
- **Verifiable only:** Self-reporting breaks loot integrity. Even one
  boss that rewards self-reported behavior corrupts the trust of the
  whole system.
- **Pure RNG over pity timers:** Pity timers feel modern but they
  remove the dopamine spike of an unlikely drop. The first-uncommon
  protection solves the new-player engagement problem without
  diluting the RNG hook.
- **Drop rates more generous than OSRS:** OSRS players can grind
  unlimited attempts per day. Habit-app players generate at most
  one attempt per day per boss. Drop rates must respect that
  constraint or trophies become unreachable.
- **No failure state:** Wellness apps that punish bad days reward
  perfectionism over consistency.
- **Multi-focus over single-focus:** OSRS players juggle multiple
  grinds simultaneously. Single-focus would feel restrictive.
- **Cards not item-rows:** Cards create a "pack opening" reveal
  moment that flat inventory lists can't match. Worth the additional
  build complexity.
- **First-uncommon protection at 2/3, not guaranteed:** Guarantees
  set wrong expectations ("I always get a special drop") that break
  on subsequent days. 2/3 preserves variance while solving the
  early-engagement problem.

---

*End of v1 design. Build when ready.*
