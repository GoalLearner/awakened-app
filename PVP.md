# PVP.md — Awakened v3 PvP Combat Design Spec

**Status:** v1.1 — REALTIME HUMAN PvP IMPLEMENTATION IN PROGRESS (June 19, 2026). §1–20 are the v1.0 design baseline. **§21 is the implementation truth** for realtime human PvP; where they conflict, §21 wins. §21 supersedes §1.7 (async/bots-first) and the §4–9 / §6 bespoke combat model — the shipped **Arena engine** (OSRS-style Melee/Magic/Ranged) is the combat (see §21.1).
**Last updated:** June 19, 2026 (§21 added)
**Authored:** May 12, 2026 (v1.0); §21 June 19, 2026
**Designer:** Richie (with Claude as design partner)

Companion docs:
- `CLAUDE.md` — operational reference for shipped code
- `EQUIPMENT.md` v1.3 — slot/affinity foundations (locked, non-negotiable)
- `DROPS.md` v1.4 — drop-rate engine + card collection
- `CARDS.md` — boss-card visual spec
- `BOSSES.md` — boss-system mechanics (drop-rate sections marked stale)
- `BACKEND.md` v1.1 — v2.1 backend foundation (PvP extends this in Phase F+)

> **v2.x economy note (May 12, 2026):** drop rates rebalanced to daily 50% common / 15% rare / 5% ultra and weekly 70% / 40% / 25% (`DROPS.md` v1.6). Stat-bonus magnitudes per card unchanged. PvP power-curve math in §4–6 remains accurate; players reach a "full loadout" faster than under pre-v1.6 rates, so v3.0 balance work should assume average users have most slots filled by the time they Awaken.

---

## 0. Status

- **Authored:** May 12, 2026
- **Status:** DESIGN COMPLETE, IMPLEMENTATION DEFERRED to v3
- **Last reviewed:** May 12, 2026
- **Implementation target:** v3.0 — no firm date. Realistic 4–6 months of focused work after kickoff. v2.1 ships first; PvP work begins after v2.1 stabilizes.
- **Prior context:** v2.1 ships with the Cloudflare Workers backend (auth + leaderboard + account delete), nine fully-integrated equipment cards across three bosses, six stats, and eight classes. v3 PvP builds on all of that without modification to existing schemas. The schema fields that became reserved in v2.0.2 (`set_id`, `required_level`, `special_effect`, `on_equip`, `cooldown_seconds`) get their first real consumers here.

---

## 1. Design Principles

These govern every downstream decision. Future iterations should not reopen them without strong reason.

### 1.1 Habits drive your fighter

The combat capability of every hunter derives from real-life action. Stats come from verified habits; equipment comes from boss kills which come from streaks; moves are unlocked at stat-level milestones. There is no shortcut to a stronger fighter that doesn't pass through real behavior.

> **Rationale:** This is the entire reason Awakened exists. A wellness app whose competitive layer can be skipped via a paywall or grind-only loop betrays the premise. PvP rewards the same thing the app already rewards — sustained discipline.

### 1.2 Strategy over grind

Loadout, move selection, and type matchups create depth that doesn't scale with hours played. A thoughtful Lv8 build can beat a careless Lv15 build. Grinding ELO with one move is harder than learning the type pentagon.

> **Rationale:** Habits cap at Lv20 per stat — there is a real ceiling. If PvP rewarded grind, max-stat players would dominate forever and new fighters would have no path. Depth in loadout/move choice keeps the meta alive without requiring ever-higher numbers.

### 1.3 Verifiable foundation

Every combat-relevant stat traces back to HealthKit-verified or class-locked discipline. There is no path to high PvP rating through self-reported habits.

> **Rationale:** Inherits the verifiability rule from `BOSSES.md` §1. A ranked competitive system built on self-reported data becomes a leaderboard for dishonesty. Combat must inherit the same trust contract.

### 1.4 Civilian respect

Pre-Awakening users (no stat at Lv5+) are blocked from ranked PvP but get a tutorial path. They are not excluded from the app — they are guided toward the threshold that unlocks PvP, then welcomed in.

> **Rationale:** Civilians are new users. Gating them from the marquee v3 feature is correct (no Class = no class identity in combat), but the gate must be a doorway not a wall. The Class Awakening moment becomes the entry ceremony.

### 1.5 ELO as honest mirror

No daily caps. No engagement multipliers. No "play 5 matches today for bonus ELO." Rating reflects only your skill + discipline + decisions. If a top-rated player stops playing, they don't decay artificially — they fall when someone else passes them.

> **Rationale:** Engagement-tuning ELO is a known anti-pattern in competitive games. It makes the rating dishonest. Awakened's brand is built on honesty (verifiable stats, no failure state); the rating system must inherit that.

### 1.6 Future-proof schema

Item dimensions added in v3 (`move_type`, plus consumers for the five reserved combat fields) accommodate v4+ expansions — status effects, set bonuses, equipment-granted passive abilities — without requiring data migration on existing user inventories.

> **Rationale:** Inherits the schema-future-proofing pattern from EQUIPMENT.md v1.0 ("equipment is PvP-ready"). One migration is forgivable; two erodes user trust. Add fields with intent the first time.

### 1.7 Async-first

v3.0 launches with AI-bot opponents only — every ranked match is async-in-spirit (the bot resolves instantly, but the player faces no time pressure). v3.5+ introduces real human opponents with turn windows measured in hours, not seconds. The combat math does not change between the two.

> **Rationale:** Real-time PvP requires twitch reactions, real-time matchmaking, network reliability, and live opponents at all hours. Awakened's user base is small and globally distributed at v3 launch. Bots first; humans when there are enough humans to fill a queue.

---

## 2. Combat Model Overview

Awakened v3 introduces **turn-based 1v1 combat between hunters**. Each fight is short (typically 6–15 turns), tactical (4-move loadouts, type matchups, priority brackets), and tied to real discipline (stats from habits, equipment from boss kills, moves from stat-tree milestones + signature gear). At v3 launch every ranked opponent is an AI bot tuned to your ELO ±100; v3.5+ swaps bots for live human opponents on the same combat engine. Classes shape your role — Warriors hit hard, Mages out-range, Assassins crit, Paladins endure, Rangers sustain, Merchants farm souls, Sages flex, Civilians cannot fight ranked until they Awaken. The damage formula respects stat scaling, class affinity, the type pentagon, accuracy, crit, dodge, and gear defense — every number on the screen traces back to a real input.

---

## 3. Equipment System

### 3.1 Nine slots (locked from EQUIPMENT.md v1.3)

| Slot | Body location |
|---|---|
| helm | Head |
| cape | Back |
| amulet | Neck |
| weapon | Main hand |
| body | Chest / torso |
| legs | Lower body |
| gloves | Hands |
| boots | Feet |
| ring | Finger |

Ammo and Shield were cut in EQUIPMENT.md v1.0 and remain cut in v3. Paladin's "shield damage reduction" bonus (§5) is an abstract mitigation effect, not a gear slot.

### 3.2 Item dimensions

Every card in the `CARDS` constant carries the following dimensions. The first six are shipped today; `move_type` is the v3 schema addition.

| Field | Type | Status | Notes |
|---|---|---|---|
| `slot` | enum (9 values) | shipped | One of the slots above |
| `rarity` | `common`/`rare`/`ultra_rare` | shipped | Drives drop rates + stack caps |
| `tier` | `E`/`D`/`C`/`B`/`A`/`S` | shipped | Inherited from source boss rank |
| `class_affinity` | derived from highest stat in `bonuses` | shipped | E.g., a card with +8 VIT +4 WILL has VIT (Ranger) affinity |
| `bonuses` | 6-key stat object | shipped | str / vit / int / focus / will / wlt |
| `move_type` | `physical`/`magic`/`holy`/`shadow`/`nature` | **NEW in v3** | Required for type pentagon + STAB |
| `set_id` | string \| null | reserved | Set bonuses (v3.5+) |
| `required_level` | number \| null | reserved | Equip-gating (v3.5+) |
| `special_effect` | string \| null | reserved | Passive description (v3) |
| `on_equip` | object \| null | reserved | On-equip hook (v3 for moves) |
| `cooldown_seconds` | number \| null | reserved | Re-purposed as `cooldown_turns` in v3 |

### 3.3 The NEW move_type dimension

v3 adds one new required field to every card: `move_type`. Five canonical values, one per Type Pentagon node (§7). Every card must have exactly one.

**Why on every card, not just weapons:**

- Defender's type defense aggregates across all 9 equipped slots (most common type wins; ties broken by tier then alphabetical for determinism). This means defensive type emerges from full-loadout composition, not just weapon choice.
- Equipment-granted moves (§8.2) inherit their parent card's `move_type`. A Holy-typed amulet that grants a "Lucid Awakening" move is itself a Holy move.

**Draft type assignments for the 9 currently-shipped cards (lock separately):**

| Card | Slot | Source boss | Proposed `move_type` | Rationale |
|---|---|---|---|---|
| Dream-Woven Hood | helm | Insomniac | `nature` | Woven from undisturbed sleep — restorative, organic |
| Sleepwalker's Cloak | cape | Insomniac | `shadow` | Walks the line between dreams and dawn — liminal, hidden |
| Pendant of the Wakeful | amulet | Insomniac | `holy` | Restful nights as sacred discipline |
| Vow Ring | ring | Carouser | `holy` | A binding oath — covenant magic |
| Vessel of Refusal | weapon | Carouser | `holy` | Refusal as devotional act |
| Sober King's Gloves | gloves | Carouser | `holy` | Discipline made manifest |
| Pack Leader's Greaves | legs | Steel Wolf | `physical` | The wolf does not stop — kinetic, animal |
| Alpha's Mantle | body | Steel Wolf | `physical` | Hunt-leader's mantle — kinetic |
| Trail-Worn Boots | boots | Steel Wolf | `physical` | Every step counts — kinetic |

Insomniac roster spans nature/shadow/holy (three distinct types) — good for build diversity. Carouser is mono-Holy — thematic but creates a same-type stack risk if all three Carouser items are equipped together. Steel Wolf is mono-Physical — same risk. Future bosses should diversify mono-type rosters.

### 3.4 Class affinity multipliers (LOCKED from EQUIPMENT.md)

- **1.5×** on a stat bonus when the wearer's class matches the card's affinity (Warrior wearing a STR-affinity card amplifies the STR bonus by 1.5×)
- **1.15×** for Sage on every stat bonus on every equipped card (the "complete human" amplification)
- **0×** for Civilian — cannot meaningfully equip; class affinity does not amplify

These multipliers apply at the stat-aggregation step, BEFORE the damage formula consumes the final stat values. They are NOT additional with the class PvP bonus in §5; they amplify the stat input, while the class PvP bonus amplifies the damage output. See §6 for the interaction.

---

## 4. Stats in Combat

The six existing stats (STR / VIT / INT / FOCUS / WILL / WLT) get combat semantics in v3. Their habit-driven sources do not change.

### 4.1 Stat → combat role

| Stat | PvP role |
|---|---|
| **STR** | Physical damage scaling. Higher STR → harder Physical attacks. |
| **VIT** | Max HP base + per-turn passive regen. Higher VIT → more HP, slow tick recovery. |
| **INT** | Magic damage scaling. Higher INT → harder Magic attacks. |
| **FOCUS** | Accuracy + crit chance + turn-order tiebreaker. The skill stat. |
| **WILL** | Dodge chance + flat damage reduction. The defense stat. |
| **WLT** | Souls payout multiplier + (v3.5+) wager amplification. Economic, not combat-mechanical. |

### 4.2 HP formula

```
baseHP = 100 + (VIT × 10)
totalHP = baseHP + sum(gear.bonuses.vit × 5 across equipped slots)
HP_CAP = 300
finalHP = min(totalHP, HP_CAP)
```

Example: VIT 12, three equipped UR cards summing +28 VIT in gear bonuses.
- baseHP = 100 + (12 × 10) = 220
- gear contribution = 28 × 5 = 140
- totalHP = 360
- finalHP = min(360, 300) = **300** (capped)

The cap exists to prevent a max-VIT max-gear hunter from becoming functionally unkillable. A high-VIT Ranger reaches the cap quickly, which is intentional — Rangers trade offensive ceiling for defensive certainty.

### 4.3 Per-turn regen

```
regen_per_turn = floor(VIT / 10) HP per turn, capped at 5 HP/turn
```

Rangers get an additional +50% to this regen value via their class bonus (§5).

### 4.4 Crit rate

```
crit_chance = FOCUS / 2  (capped at 50%)
crit_damage_multiplier = 1.5×
```

Example: FOCUS 8 → 4% crit chance. FOCUS 20 (capped stat) → 10% crit chance. FOCUS 100 (impossible — there is no stat over 20, but the formula caps anyway) → 50% crit chance.

Assassins receive a flat +20 percentage points to crit chance via their class bonus, AFTER the cap. So Assassin FOCUS 8 = 4% + 20% = 24% crit chance. This is the explicit Assassin power-spike.

### 4.5 Dodge rate

```
dodge_chance = WILL / 4  (capped at 25%)
```

Example: WILL 8 → 2% dodge. WILL 20 → 5% dodge.

Paladins receive +20 percentage points to dodge via their class bonus, after the cap. WILL 20 Paladin = 5% + 20% = 25% effective dodge — also the cap of 25% is bypassed by the class bonus (it's an additive bonus, not a stat-derived value).

### 4.6 Flat damage reduction

```
flat_reduction = sum(gear.bonuses.will across equipped slots) / 200
```

This produces a 0.00–1.00 multiplier applied as `(1 − flat_reduction)` in the final damage step. Example: equipped gear summing +40 WILL → 0.20 reduction → final damage × 0.80.

---

## 5. Classes in Combat

The eight classes (one of which is the pre-Awakening Civilian state) each get a PvP identity. Class is determined by stat composition per `evaluateClass()` in app.js — no change to existing logic.

### 5.1 Class bonus table (LOCKED)

| Class | Primary stat | PvP bonus |
|---|---|---|
| **Warrior** | STR | +20% damage on attacks using STR-scaling moves |
| **Ranger** | VIT | +50% bonus to per-turn HP regen (stacks on the §4.3 base) |
| **Mage** | INT | +20% damage on attacks using INT-scaling moves |
| **Assassin** | FOCUS | +20 percentage points to crit chance (bypasses §4.4 cap) |
| **Paladin** | WILL | +20 percentage points to dodge (bypasses §4.5 cap); flat 20% damage reduction on incoming Physical damage ("shield" mitigation) |
| **Merchant** | WLT | +20% souls payout on victory; +10% wager multiplier (v3.5+) |
| **Sage** | balanced | +10% to ALL stat values (STR, VIT, INT, FOCUS, WILL) before formula evaluation. No STAB. |
| **Civilian** | none | CANNOT ENTER RANKED. Tutorial only. |

### 5.2 Class bonus mechanics

- Warrior / Mage damage bonuses apply only to moves with the matching `scaling_stat` (`STR` or `INT`). A Warrior using a VIT-scaling move gets no class bonus on that move.
- Ranger sustain bonus: see §4.3.
- Assassin crit bonus: percentage points (additive), not multiplier (multiplicative). Bypasses the §4.4 cap of 50%.
- Paladin dodge bonus: same — percentage points, additive, bypasses §4.5 cap. The Physical damage reduction is multiplicative on top of §4.6 gear reduction.
- Merchant: no in-fight bonus. Pure economic. Merchants are not expected to ladder competitively at v3.0; they ladder for the souls payouts and unlock the wager system in v3.5+.
- Sage: +10% applied to STR, VIT, INT, FOCUS, WILL during stat aggregation, BEFORE the damage formula consumes them. WLT is not amplified. Sage gets no STAB (§7) because they have no class-aligned type.

### 5.3 Class affinity (locked from EQUIPMENT.md) vs class PvP bonus (new)

These two mechanisms BOTH amplify Warrior-with-STR-weapon-style synergy, but at different points in the math chain:

1. **Class affinity** (1.5×) amplifies the STAT VALUE on the gear before stat aggregation. A Warrior wearing a STR-affinity card sees that card's STR bonus apply at 1.5×.
2. **Class PvP bonus** (+20%) amplifies the DAMAGE OUTPUT after stat scaling. A Warrior using a STR-scaling move sees the move's final damage × 1.20.

These STACK by design. A Warrior in a STR-affinity weapon using a STR-scaling move benefits from both — the stat input gets 1.5× and the damage output gets 1.20×, giving an effective combined multiplier on attack scaling near 1.80×. This is intentional: it makes class identity matter in PvP, rewarding players who built coherent class-aligned loadouts over those who built mismatched ones.

### 5.4 Civilian path to PvP

Civilians cannot queue for ranked matches. The Combat tab UI for Civilians:

- Greys out the "Find Match" button with a tooltip: "Reach Lv5 in any stat to Awaken and unlock ranked PvP."
- Highlights the Civilian Tutorial (§13) and unranked practice mode.
- Shows the closest-stat-to-awaken progress (already a helper in app.js — `getClosestStatToAwaken()`).

The Class Awakening moment (Lv5 reached) triggers an in-app modal: "You have Awakened. Ranked PvP is now unlocked." Same celebration weight as today's class-unlock screen.

---

## 6. Damage Formula

The full v3 damage calculation. All multipliers are applied in a defined order. The variance step at the end is the only non-deterministic element beyond the crit/hit/dodge rolls.

### 6.1 Formula

```
baseDmg = (Attacker.<scalingStat> × Move.power × ClassMult × STAB) / 100

critRoll = roll(0–100) < (Attacker.FOCUS / 2 + AssassinCritBonus)
            → 1.5× damage if true

hitRoll = roll(0–100) > (Defender.WILL / 4 + PaladinDodgeBonus)
           → miss if false

typeMult = lookupTypeMatch(Move.type, Defender.gear_dominant_type)
            → 1.5× / 1.0× / 0.66× per §7

finalDmg = (hit ? baseDmg × (crit ? 1.5 : 1) : 0)
            × typeMult
            × (1 − Defender.gear_will_sum / 200)
            × PaladinPhysicalMitigation
            × (1 + variance(−0.10, +0.10))
```

Where:
- **`scalingStat`** comes from `Move.scaling_stat` — typically STR, INT, or VIT. The attacker's stat value is read AFTER class-affinity amplification (1.5× / 1.15× / 0×) and AFTER Sage's +10%-to-all amplification.
- **`Move.power`** is the move's base power (typically 40–100; see §8).
- **`ClassMult`** = 1.0 base + 0.20 when the class PvP bonus condition is met (Warrior with STR move, Mage with INT move). Otherwise 1.0.
- **`STAB`** = 1.20× when `Move.type` matches the attacker's class type affinity (see §7). Otherwise 1.00×.
- **`AssassinCritBonus`** = +20 percentage points if Assassin, else 0.
- **`PaladinDodgeBonus`** = +20 percentage points if defender is Paladin, else 0.
- **`gear_dominant_type`** = most common `move_type` across defender's 9 equipped slots; ties broken by tier (highest first), then alphabetical.
- **`PaladinPhysicalMitigation`** = 0.80× when defender is Paladin AND move type is Physical, else 1.00×.

### 6.2 Worked example

**Setup:**
- **Attacker**: Richie — STR 8, VIT 12, INT 0, FOCUS 6, WILL 6 — Sage class.
  - Equipped: Trail-Worn Boots (+16 VIT, +8 STR, Physical), Pendant of the Wakeful (+8 VIT, +4 WILL, Holy), Sober King's Gloves (+4 VIT, +8 WILL, Holy).
  - Sage +10% to all combat stats: STR 8 → 8.8, VIT 12 → 13.2, FOCUS 6 → 6.6, WILL 6 → 6.6.
  - Gear stat sums (with Sage's 1.15× class-affinity amplification, since Sage gets 1.15× on every card's bonuses):
    - STR from gear: 8 × 1.15 = 9.2
    - VIT from gear: (16 + 8 + 4) × 1.15 = 33.12
    - WILL from gear: (4 + 8) × 1.15 = 13.8
  - **Effective combat stats:**
    - STR = 8.8 (base, Sage-amplified) + 9.2 (gear, affinity-amplified) = **18.0**
    - VIT = 13.2 + 33.12 = **46.32**
    - FOCUS = **6.6**
    - WILL = 6.6 + 13.8 = **20.4** (capped at 20 for dodge math purposes; actual gear contribution still counts toward §4.6 reduction)
  - HP: baseHP = 100 + (46.32 × 10) = 563.2, capped to **300**.
  - Crit chance: FOCUS 6.6 / 2 = **3.3%**
  - Dodge chance: WILL 20.4 / 4 = 5.1%, capped at 25% (well below cap)

- **Move used**: "Heavy Strike" — Physical type, power 60, scaling_stat STR, priority 0.

- **Defender**: AI bot "Warrior_002" — STR 15, VIT 10, FOCUS 5, WILL 4, Warrior class.
  - Simulated loadout: tier-D Physical body + Physical weapon + assorted Physical gear.
  - Gear dominant type: **Physical** (4+ of 9 slots).
  - Gear WILL sum: 12 (across pieces).
  - Effective WILL: 4 (base) + 12 × 1.0 (Warrior gets no affinity amp on WILL gear since WILL is Paladin-affinity) = 16.
  - HP: 100 + (10 × 10) + (gear VIT × 5) = ~200.

**Calculation step by step:**

1. **scalingStat input**: Attacker STR = 18.0 (effective).
2. **Move.power** = 60.
3. **ClassMult**: Sage gets no class PvP damage bonus → **1.0**.
4. **STAB**: Sage has no class-aligned type → **1.0**.
5. **baseDmg** = (18.0 × 60 × 1.0 × 1.0) / 100 = **10.8**.
6. **critRoll**: roll(0–100). Threshold = 3.3 + 0 = 3.3%. Assume **miss crit** for this example. critMult = 1.0.
7. **hitRoll**: roll(0–100). Dodge threshold = 16/4 + 0 = 4%. Assume hit (96% chance). hit = true.
8. **typeMult**: Move type = Physical, Defender gear dominant type = Physical. Physical → Physical is **neutral** per §7. typeMult = **1.0**.
9. **dmg pre-defense** = baseDmg × critMult × typeMult = 10.8 × 1.0 × 1.0 = **10.8**.
10. **gear_will reduction**: (1 − 12 / 200) = 1 − 0.06 = **0.94**.
11. **PaladinPhysicalMitigation**: defender is Warrior, not Paladin → **1.0**.
12. **Pre-variance dmg**: 10.8 × 0.94 × 1.0 = **10.15**.
13. **variance**: ±10% → assume roll +3% → 10.15 × 1.03 = **10.46**.
14. **Final dmg**: round to **10**.

**Result:** Richie's Heavy Strike deals 10 damage to Warrior_002.

**Observations:**
- Sage's +10%-to-all and Trail-Worn-Boots' STR contribution were the main contributors, but neither matched the defender's type or weakness, so the damage stayed neutral.
- A Warrior-class Richie using the same move would have added +20% ClassMult AND +1.20× STAB → 10.8 × 1.20 × 1.20 = 15.55 baseDmg pre-defense → final ~14–15 dmg. That ~40% upside is the class-identity reward.
- If the defender had Nature-typed gear instead of Physical, typeMult would be 1.5×, taking final damage to ~15.

This is roughly 5% of the defender's 200 HP per Heavy Strike. Average Sage fights expect 15–25 turns to KO without crit luck; class-aligned fights expect 8–12 turns. The math feels right for "tactical" pacing.

---

## 7. Type Pentagon

Five elemental types form a closed pentagon: every type is strong against exactly one other type and weak against exactly one other type. The remaining two matchups are neutral. The pentagon has perfect rotational symmetry — no type is structurally privileged.

### 7.1 Matchup table

| Attack Type | Strong vs (1.5×) | Weak vs (0.66×) |
|---|---|---|
| **Physical** | Nature | Magic |
| **Magic** | Physical | Holy |
| **Holy** | Magic | Shadow |
| **Shadow** | Holy | Nature |
| **Nature** | Shadow | Physical |

### 7.2 Pentagon diagram

```
              Physical
             ╱        ╲
            ╱          ╲
        Magic          Nature
          ╲            ╱
           ╲          ╱
            Holy ── Shadow
```

Direction of each arrow conceptually:
- Physical hammers Nature (force breaks growth)
- Magic dissolves Physical (mind beats brawn)
- Holy banishes Magic (truth dispels illusion)
- Shadow corrupts Holy (doubt undoes faith)
- Nature reclaims Shadow (life overgrows the dark)

Neutral (1.0×) matchups are anything not in the table: Physical vs Physical, Physical vs Shadow, Physical vs Holy, etc.

### 7.3 Class-type affinity (drives STAB)

Each combat class has one canonical type. Moves of that type benefit from STAB (Same-Type Attack Bonus): **1.20× damage** when the move's type matches the attacker's class affinity.

| Class | Type affinity | STAB applies to |
|---|---|---|
| Warrior | Physical | Physical moves |
| Ranger | Nature | Nature moves |
| Mage | Magic | Magic moves |
| Assassin | Shadow | Shadow moves |
| Paladin | Holy | Holy moves |
| Merchant | (none) | No STAB |
| Sage | (none — balanced) | No STAB |
| Civilian | (none) | Cannot enter ranked |

Merchant and Sage explicitly do not get STAB. Merchant's identity is economic, not combat-archetypal. Sage's identity is "no specialization," which by definition precludes a type affinity.

### 7.4 Defender's gear dominant type

The defender's effective type for matchup purposes is the most common `move_type` across their 9 equipped slots. Ties broken by tier (highest first), then alphabetical (deterministic so two fights with the same loadout never resolve differently).

A defender with 5 Physical + 2 Holy + 2 Nature pieces has dominant type **Physical**. An attacker using a Magic move against that defender hits at 1.5× (Magic strong vs Physical). An attacker using a Nature move hits at 0.66× (Nature weak vs Physical).

This means defensive loadout choice is meaningful — stacking a single type creates a strong defense against its counter-type but a major weakness against its predator. A mixed-type loadout is safer but never optimal against any single matchup. Balance gameplay.

---

## 8. Moveset System

Each hunter equips **4 moves per battle** from their accessible pool. Moves are swappable between fights (set in the Combat-tab loadout screen) but **locked during a fight** — you cannot change your moveset mid-match.

### 8.1 Hybrid acquisition

Moves come from two sources, additive:

**A. Stat trees** — 6 stat trees × 5 milestone levels each = **30 free moves total** unlocked permanently as the user reaches Lv1/5/10/15/20 in each stat. These are the base toolkit available to every hunter who has put work into the corresponding stat. Stat-tree moves do not require gear equipped to use.

**B. Equipment grants** — rare and ultra-rare cards each grant a move when equipped:
- **Rare** cards grant 1 **specialty move** while equipped.
- **Ultra-rare** cards grant 1 **signature move** while equipped.
- **Common** cards do NOT grant moves (their value is pure stat-bonus contribution).

Equipment-granted moves vanish from the available pool the moment the granting card is unequipped. Players cannot "learn" them permanently.

This produces a stat-driven baseline (the 30-move pool) with gear-driven flex on top (up to 6 additional moves available at any time if a full rare+UR loadout is equipped, but only 4 can be slotted into the active battle moveset).

### 8.2 Move data shape

```js
{
  id:            'heavy_strike',                  // unique string
  name:          'Heavy Strike',                  // display name
  type:          'physical',                      // §7 type
  power:         60,                              // 40–100 range
  accuracy_mod:  0,                               // +N or −N percentage points (default 0)
  priority:      0,                               // −1 | 0 | +1
  scaling_stat:  'STR',                           // 'STR' | 'INT' | 'VIT'
  flavor:        'A heavy two-handed swing.',     // 1–2 sentences
  source:        { type: 'stat_tree',
                   stat: 'STR',
                   level: 5 }
                 // OR
                 // { type: 'item',
                 //    card_id: 'pendant_of_the_wakeful' }
}
```

Optional fields (used by specific moves):
- `heal_pct` — percentage of max HP healed on use (defensive moves)
- `self_buff` — temporary self-stat modifier (`{ stat: 'WILL', delta: +5, turns: 2 }`)
- `enemy_debuff` — same shape, applied to opponent
- `cost_souls` — souls deducted from balance on use (Merchant moves)

### 8.3 Stat-tree move sketches — PHASE 1 AUTHORING

The 30 base moves. Numbers are draft proposals; final balance pass (§19) will tune.

#### STR tree (Physical, STR-scaling)
| Lv | Move | Power | Priority | Effect |
|---|---|---|---|---|
| 1  | Slash             | 40  |  0 | basic Physical attack |
| 5  | Heavy Strike      | 60  |  0 | basic Physical attack |
| 10 | Crushing Blow     | 80  | −1 | slow but heavy |
| 15 | Berserker Rage    | 70  | +1 | +1.5× damage when attacker HP < 30% |
| 20 | Devastating Cleave| 100 | −1 | endgame STR move |

#### VIT tree (defensive/regen, scaling VIT for healing values)
| Lv | Move | Power | Priority | Effect |
|---|---|---|---|---|
| 1  | Brace          | —  |  0 | +30% damage reduction next turn |
| 5  | Steady Breath  | —  |  0 | heal 15% max HP |
| 10 | Renewal        | —  | +1 | heal 25% max HP |
| 15 | Iron Skin      | —  |  0 | +50% damage reduction for 2 turns |
| 20 | Second Wind    | —  | +1 | heal 40% max HP + remove debuffs (v3.5+) |

VIT moves have no `power` (no damage); their `scaling_stat` value modulates their `heal_pct` instead.

#### INT tree (Magic, INT-scaling)
| Lv | Move | Power | Priority | Effect |
|---|---|---|---|---|
| 1  | Arcane Bolt    | 40 |  0 | basic Magic attack |
| 5  | Frost Lance    | 60 |  0 | Magic attack, −10% target dodge next turn |
| 10 | Mind Spike     | 80 |  0 | Magic attack, ignores 50% target WILL reduction |
| 15 | Soul Drain     | 60 |  0 | Magic attack, heal 30% of damage dealt |
| 20 | Cataclysm      | 100| −1 | Magic attack, recoils 15% of damage to attacker |

#### FOCUS tree (accuracy/crit, no native damage type — moves take type from gear)
| Lv | Move | Power | Priority | Effect |
|---|---|---|---|---|
| 1  | Aim            | —  |  0 | +25% accuracy and +10% crit next turn |
| 5  | True Strike    | 50 |  0 | guaranteed hit (no dodge roll), uses weapon's type |
| 10 | Critical Read  | —  |  0 | +30% crit chance for 2 turns |
| 15 | Pinpoint       | 70 |  0 | guaranteed crit if it hits; uses weapon's type |
| 20 | Killing Move   | 100| +1 | guaranteed crit + guaranteed hit; uses weapon's type |

FOCUS attacks inherit `move_type` from the attacker's equipped weapon (or default to Physical if weaponless).

#### WILL tree (defensive/anti-status — even though status is v3.5, WILL moves boost defense/dodge today)
| Lv | Move | Power | Priority | Effect |
|---|---|---|---|---|
| 1  | Steel Stance   | —  |  0 | +25% dodge next turn |
| 5  | Unbreakable    | —  |  0 | +40% damage reduction next turn |
| 10 | Resolute       | —  | +1 | become immune to crit for 2 turns |
| 15 | Bulwark        | —  |  0 | +50% damage reduction for 2 turns |
| 20 | Last Stand     | —  | +1 | +100% damage reduction if HP < 20% |

#### WLT tree (utility/economy)
| Lv | Move | Power | Priority | Effect |
|---|---|---|---|---|
| 1  | Calculated Risk| 50 |  0 | Physical attack; +1 soul earned at end of fight if it hits |
| 5  | Soul Tap       | 40 |  0 | Magic attack; gain 5 souls on hit; ignored if enemy HP ≥ 90% |
| 10 | Bounty         | —  |  0 | +30% souls earned at end of fight (cumulative) |
| 15 | Mercenary      | 80 |  0 | Physical attack; costs 10 souls to use; +30% damage |
| 20 | Plunder        | 100| −1 | Magic attack; steals 20 souls from opponent on KO blow |

WLT moves are deliberately weaker as pure-combat options. Their value is in the economic loop — a Merchant who lands Soul Tap + Bounty walks away with more souls per win than any other class.

### 8.4 Equipment-granted moves — PHASE 2 AUTHORING

One signature move per **ultra-rare** card; one specialty move per **rare** card. Common cards grant nothing.

**Ultra-rare signature moves (3 currently shipped):**

| Card | Move | Type | Power | Priority | Effect |
|---|---|---|---|---|---|
| Pendant of the Wakeful | Lucid Awakening    | Holy     | — | +1 | heal 30% max HP; (v3.5+) removes sleep status |
| Sober King's Gloves    | Iron Resolve       | Holy     | 70| 0  | Holy attack; +20% accuracy permanently this fight |
| Trail-Worn Boots       | Wolf's Stride      | Physical | 60| +1 | Physical priority attack; +20% dodge next turn |

**Rare specialty moves (3 currently shipped):**

| Card | Move | Type | Power | Priority | Effect |
|---|---|---|---|---|---|
| Sleepwalker's Cloak | Veil of Dreams | Shadow   | — | 0 | gain +50% dodge next turn |
| Vessel of Refusal   | Refusal Strike | Holy     | 70| 0 | Holy attack; cleanses one self-debuff (v3.5+) |
| Alpha's Mantle      | Pack Howl      | Physical | — | 0 | +20% damage on attacker's next move |

Common cards (Dream-Woven Hood, Vow Ring, Pack Leader's Greaves) grant no move. Their stat-bonus contribution is their full PvP value.

---

## 9. Turn Order

Both players select their move at the start of each turn (independently — neither sees the other's selection). The engine then resolves both moves in a defined order.

### 9.1 Resolution sequence

1. **Priority bracket** — moves with higher `priority` always resolve first.
   - `+1` priority > `0` priority > `−1` priority.
2. **Within bracket** — attacker FOCUS (with Sage +10% applied) is the tiebreaker. Higher FOCUS goes first.
3. **Within bracket with tied FOCUS** — random roll, seeded by match ID + turn number for deterministic replay.

### 9.2 KO doesn't cancel within bracket

If Player A and Player B are both at `priority 0` and Player A's move kills Player B, Player B's move STILL resolves (assuming Player B selected before the round started). This creates intentional "trade" scenarios — both players KO each other, the result is a draw (see §18 open question on draw handling).

A `priority +1` move that lands a KO DOES cancel any `priority 0` or `priority −1` retaliation. Priority brackets are the only mechanism that prevents trades.

### 9.3 Turn limit

If a fight reaches **turn 20** without a KO, the engine ends the fight:
- Higher current HP wins.
- Exactly equal HP at turn 20 = draw.

The turn limit prevents perpetual stalemates between two defensive builds. 20 turns is intentionally high — most fights end well before that. Hitting the limit signals a meta imbalance (two builds with no offensive answer to each other).

---

## 10. Fight Lifecycle

End-to-end user flow:

1. **Player taps "Fight" button** on the new Combat tab.
2. **Loadout review screen** — player confirms their currently-equipped gear and selects 4 moves from their accessible pool. Defaults to the last-used moveset.
3. **Matchmaking** — engine assigns either (a) a random AI bot at ELO ±100 of player's current rating, or (b) the snapshot loadout of a friend they challenged.
4. **Battle screen** — turn 1 begins.
5. **Per turn**:
   - Player taps a move from their 4-slot loadout.
   - Bot or opponent's move resolves simultaneously.
   - HP bars animate. Damage numbers appear. Critical hits flash. Misses say "Miss!".
   - Type effectiveness label appears: "Super effective!" / "Not very effective..." / nothing for neutral.
6. **Fight ends** on KO or turn 20.
7. **Outcome screen**:
   - Winner / loser banner.
   - ELO delta (e.g., "+24 ELO" or "−18 ELO").
   - Souls awarded (winner gets base 25 + WLT% bonus + Merchant class bonus).
   - "Play Again" / "Return to Main" buttons.
8. **Return to main app** — Combat tab returns to its idle state showing the new ELO + recent match.

### 10.1 Souls reward formula

```
souls_awarded = winner ? 25 : 5
WLT_bonus = (winner ? 25 : 5) × (Attacker.WLT / 100)
Merchant_bonus = winner && Merchant ? × 1.20 : × 1.0
final_souls = (base + WLT_bonus) × Merchant_bonus
```

Loser gets a 5-soul participation reward. Winners get 25 base. A WLT-20 Merchant winner earns roughly 36 souls per win (25 × 1.2 × 1.20). A Civilian cannot reach this state.

---

## 11. Matchmaking

### 11.1 Ranked random ladder (v3.0 launch)

Every ranked match pulls a random AI bot from the bot roster (§14) at ELO ±100. The 100-point window ensures the opponent is plausibly close in skill without making the queue feel deterministic — every match feels like a new draw.

If no bot exists in the ±100 window (rare at extreme ELO bands), the window expands by 50 per attempt up to ±500. If still no match, the engine generates a synthetic bot at the user's ELO with randomized class + loadout.

### 11.2 Friend challenge

Players can challenge a specific friend (friend-list scope TBD — likely via the existing leaderboard/Social tab). The challenged friend's last-played loadout snapshot becomes the opponent. The AI plays the snapshot as if it were the friend.

Friend-challenge ELO swings are reduced to **±50% of normal** to discourage smurf-farming via friend lists (§18 open question on anti-griefing).

### 11.3 ELO formula

Standard ELO with class-bracket K-factor:

| Rating bracket | K-factor |
|---|---|
| < 1700 | 32 (new players, fast climbing) |
| 1700–2199 | 24 (established) |
| 2200–2599 | 16 (high tier) |
| 2600+ | 12 (top tier, stable rating) |

Expected score formula remains standard:
```
expected = 1 / (1 + 10 ^ ((opponent_ELO − player_ELO) / 400))
delta = K × (actual_score − expected)
```

Where `actual_score` is 1.0 for win, 0.5 for draw, 0.0 for loss.

---

## 12. ELO and Ranks

### 12.1 Base rating

All new players start at **ELO 1500**. There is no placement-match calibration period — every match counts from rank 1.

### 12.2 ELO tier badges

Visible on user profile + leaderboard. Awakening-themed:

| ELO bracket | Tier |
|---|---|
| 0–1499 | Bronze |
| 1500–1699 | Silver |
| 1700–1999 | Gold |
| 2000–2299 | Platinum |
| 2300–2599 | Diamond |
| 2600–2999 | Master |
| 3000+ | Awakened |

A new player starts in **Silver** (1500). The Bronze tier exists for users who lose more than they win — there's no anti-fall protection at v3.0.

### 12.3 No seasonal reset

v3.0 ladder is perpetual. Top players don't get knocked back to 1500 every quarter. This deliberately rewards long-term consistency over peak performance.

Seasonal resets become a v3.5+ design conversation if ladder-stagnation telemetry shows the top tiers becoming inaccessible to new players. v3.0 ships without them.

### 12.4 ELO surfaces

- **User profile** — current ELO + tier badge displayed prominently.
- **Combat tab home** — your ELO + recent W/L record + tier progress.
- **Leaderboard tab (existing Social tab)** — global ELO top-50 ranking added as a fourth metric alongside the existing 3 (steps, sleep streak, bedtime streak). Same UI pattern.

---

## 13. Civilian Tutorial Mode

Civilians (no stat at Lv5+) cannot enter ranked. The Combat tab for Civilians redirects to a tutorial path:

### 13.1 Tutorial structure

Three scripted fights, each teaching one core mechanic:

| # | Lesson | Opponent | Pre-set deck |
|---|---|---|---|
| 1 | Basic attack + HP | "Sparring Dummy" | always picks Slash; no class bonus |
| 2 | Type effectiveness | "Type Trainer" | uses Physical moves only; player gets a Magic move pre-equipped |
| 3 | Class identity | "Mentor" | hint: opponent uses Sage class to demonstrate flexibility |

Each fight has a single explicit takeaway shown post-match: "You dealt 1.5× damage with Magic vs Physical — that's type advantage."

### 13.2 Practice mode (post-tutorial)

After tutorial completion, Civilian can play **unranked practice matches** against easy AI bots. These matches:
- Do NOT affect ELO.
- DO give 5 souls per match (regardless of outcome) — a small reward, not a farming vector.
- DO let the user equip gear and test loadouts.

This is a sandbox. The user gains familiarity without competitive pressure.

### 13.3 Awakening moment

When the user reaches Lv5 in any stat, the Class Awakening modal triggers (existing flow). After class selection, a NEW modal fires:

> **"Ranked PvP unlocked. Welcome, [class]."**

The first ranked match invitation is automatic. The user can decline and continue practicing. There is no daily ranked requirement.

---

## 14. AI Bot Roster (v3 launch)

At v3.0, ranked queue matches AI bots only. The bot population must feel diverse enough to teach the meta without becoming predictable.

### 14.1 Bot personalities (one per playable class)

| Personality | Class | Loadout flavor | Move bias |
|---|---|---|---|
| Warrior_<n> | Warrior | STR-heavy, Physical-typed gear | Heavy Strike, Crushing Blow, Devastating Cleave |
| Mage_<n>    | Mage    | INT-heavy, Magic-typed gear    | Arcane Bolt, Mind Spike, Cataclysm |
| Assassin_<n>| Assassin| FOCUS-heavy, Shadow-typed gear | True Strike, Pinpoint, Killing Move |
| Paladin_<n> | Paladin | WILL-heavy, Holy-typed gear    | Unbreakable, Bulwark, Lucid Awakening (if UR amulet equipped) |
| Ranger_<n>  | Ranger  | VIT-heavy, Nature-typed gear   | Brace, Steady Breath, Second Wind |
| Merchant_<n>| Merchant| balanced, mixed types          | Calculated Risk, Soul Tap, Bounty |
| Sage_<n>    | Sage    | balanced across all 6 stats    | Heavy Strike + Arcane Bolt + Steady Breath + utility |

**7 personalities × 3 ELO brackets (low / mid / high)** = 21 distinct bot variants at minimum. Phase 4 implementation can expand to 4 brackets (~28 bots) if balance feedback warrants.

### 14.2 Bot AI behavior (v3.0)

Simple but not trivial:

- **60% of turns** — select the move with the highest expected damage considering type advantage against the player's gear dominant type.
- **25% of turns** — select the move with the best STAB (class-aligned type) regardless of player matchup.
- **15% of turns** — random move from the bot's 4-slot loadout (prevents perfect predictability + creates emergent variance).

Bots NEVER use practice-mode-only logic. Every bot in ranked plays to win.

### 14.3 Bot gear by ELO bracket

| Bracket | Gear quality |
|---|---|
| Low (< 1700) | 100% common gear |
| Mid (1700–2199) | mix of common + rare |
| High (≥ 2200) | rare + ultra-rare |

This creates a real power curve as the player climbs. A Silver-tier bot loses to Gold-tier loadouts; high-Diamond bots run full UR builds.

---

## 15. Data Persistence (Storage Schema)

### 15.1 New localStorage keys (client-side, v3.0)

| Key | Type | Notes |
|---|---|---|
| `hb_pvp_elo` | number | defaults to 1500 on first PvP entry |
| `hb_pvp_peak_elo` | number | all-time-high ELO; never decreases |
| `hb_pvp_equipped` | object | `{ helm, cape, amulet, weapon, body, legs, gloves, boots, ring }` — each value is card_id or null |
| `hb_pvp_moveset` | array | 4 move IDs in active loadout |
| `hb_pvp_learned_moves` | array | every move ID the user has unlocked from stat-tree milestones |
| `hb_pvp_battle_history` | array | last 100 matches: `{ opponent_id, outcome, elo_delta, timestamp }` |
| `hb_pvp_civilian_tutorial_complete` | boolean | one-shot flag |
| `hb_pvp_practice_count` | number | counter for unranked practice matches |
| `hb_pvp_total_wins` | number | lifetime ranked wins |
| `hb_pvp_total_losses` | number | lifetime ranked losses |

### 15.2 Backend additions (Phase F+ scope)

PvP data needs server-side persistence for two reasons: (a) the ELO leaderboard requires global ranking, (b) friend challenges require opponent loadout snapshots that survive the friend going offline.

**New D1 tables:**

```sql
CREATE TABLE pvp_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  p1_user_id TEXT NOT NULL,
  p2_user_id TEXT,                    -- null if vs bot
  p2_bot_id TEXT,                     -- null if vs human
  p1_loadout_snapshot TEXT NOT NULL,  -- JSON
  p2_loadout_snapshot TEXT NOT NULL,
  outcome TEXT NOT NULL,              -- 'p1_win' | 'p2_win' | 'draw'
  turns INTEGER NOT NULL,
  elo_delta_p1 INTEGER NOT NULL,
  elo_delta_p2 INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE pvp_ratings (
  user_id TEXT PRIMARY KEY,
  current_elo INTEGER NOT NULL DEFAULT 1500,
  peak_elo INTEGER NOT NULL DEFAULT 1500,
  total_wins INTEGER NOT NULL DEFAULT 0,
  total_losses INTEGER NOT NULL DEFAULT 0,
  total_draws INTEGER NOT NULL DEFAULT 0,
  last_match_at INTEGER
);
```

**New endpoints (Phase F):**

- `POST /v1/pvp/start_match` — request a matchmaking pairing; returns opponent snapshot + match_id
- `POST /v1/pvp/submit_turn` — submit a player move; engine resolves both moves server-side and returns turn result
- `POST /v1/pvp/end_match` — finalize match outcome + write to `pvp_matches` + update `pvp_ratings`
- `GET /v1/pvp/elo_leaderboard?limit=50` — top-N by current_elo

Server-side turn resolution is a deliberate choice — it prevents client-side damage manipulation and lets the engine be the single source of truth for outcomes.

---

## 16. Damage Math — Full Fight Worked Example

A complete 5-turn fight between Richie (Sage) and AI bot Warrior_002.

### 16.1 Setup

**Player A — Richie:**
- Class: Sage
- Stats (base, pre-Sage-amp): STR 8, VIT 12, INT 0, FOCUS 6, WILL 6, WLT 4
- Sage +10% applied: STR 8.8, VIT 13.2, FOCUS 6.6, WILL 6.6
- Equipped:
  - Helm: — (empty)
  - Cape: — (empty)
  - Amulet: Pendant of the Wakeful (UR, Holy, +8 VIT +4 WILL)
  - Weapon: — (empty)
  - Body: — (empty)
  - Legs: — (empty)
  - Gloves: Sober King's Gloves (UR, Holy, +4 VIT +8 WILL)
  - Boots: Trail-Worn Boots (UR, Physical, +16 VIT +8 STR)
  - Ring: — (empty)
- Gear stat sums × Sage's 1.15× affinity:
  - STR: 8 × 1.15 = 9.2
  - VIT: 28 × 1.15 = 32.2
  - WILL: 12 × 1.15 = 13.8
- Effective combat stats: STR 18.0, VIT 45.4, FOCUS 6.6, WILL 20.4
- HP: 100 + (45.4 × 10) = 554, capped to **300**
- Regen: floor(45.4 / 10) = 4 HP/turn
- Crit chance: 6.6 / 2 = 3.3%
- Dodge chance: 20.4 / 4 = 5.1%
- Gear dominant type: Holy (2 Holy slots vs 1 Physical) → **Holy**
- Moveset: [Slash, Lucid Awakening, Wolf's Stride, Iron Resolve]

**Player B — AI bot Warrior_002:**
- Class: Warrior
- Stats: STR 15, VIT 10, INT 0, FOCUS 5, WILL 4
- Warrior class affinity: STR-gear gets 1.5×
- Simulated loadout (D-tier ranked bot, mid-bracket):
  - Body: Alpha's Mantle (R, Physical, +12 VIT)
  - Weapon: simulated tier-D Physical sword (+12 STR scaled, Physical type)
  - Boots: Trail-Worn Boots (UR, Physical, +16 VIT +8 STR)
  - Helm/cape/amulet/legs/gloves/ring: simulated commons (assume +4 STR or +4 VIT each, mixed types — call gear-WILL-sum 12 for total)
- Gear stat sums × Warrior's 1.5× on STR-affinity gear:
  - STR: ~(8 + 12 + 4 + 4) × 1.5 ≈ 42
  - VIT: ~(12 + 16 + 4 + 4) ≈ 36
- Effective combat stats: STR 57, VIT 46, FOCUS 5, WILL 16
- HP: 100 + (46 × 10) = 560, capped to **300**
- Regen: 4 HP/turn
- Crit chance: 5 / 2 = 2.5%
- Dodge chance: 16 / 4 = 4%
- Gear dominant type: **Physical** (5+ slots)
- Moveset: [Heavy Strike, Crushing Blow, Slash, Pack Howl]

### 16.2 Turn 1

- **Richie** picks Slash (Physical, power 40, scaling STR, priority 0).
- **Warrior_002** picks Heavy Strike (Physical, power 60, scaling STR, priority 0).
- Priority bracket tied at 0. FOCUS tiebreaker: Richie 6.6 vs bot 5 → **Richie first**.

**Richie's Slash → Warrior_002:**
- baseDmg = (18.0 × 40 × 1.0 × 1.0) / 100 = 7.2
- Sage no class PvP bonus → ClassMult 1.0
- Sage no STAB → STAB 1.0
- crit roll 3.3% → miss
- hit roll vs 4% dodge → hit
- type: Physical vs Warrior_002 Physical gear → neutral 1.0×
- gear_will reduction: 12 / 200 = 0.06 → ×0.94
- variance roll: +5% → ×1.05
- final: 7.2 × 1.0 × 1.0 × 0.94 × 1.05 ≈ **7 damage**

Bot HP: 300 → **293**

**Warrior_002's Heavy Strike → Richie:**
- baseDmg = (57 × 60 × 1.20 × 1.20) / 100 = 49.25
  - ClassMult: Warrior + STR move = 1.20
  - STAB: Warrior + Physical move = 1.20
- crit roll 2.5% → miss
- hit roll vs Richie's 5.1% dodge → hit
- type: Physical vs Richie's Holy gear → neutral 1.0× (Physical not in Holy's strong/weak)
- gear_will reduction: 13.8 / 200 = 0.069 → ×0.931
- variance roll: −7% → ×0.93
- final: 49.25 × 1.0 × 1.0 × 0.931 × 0.93 ≈ **42 damage**

Richie HP: 300 → **258**

End of turn 1: Richie 258 / 300. Bot 293 / 300.
Regen tick: Richie 258 + 4 = **262**. Bot 293 + 4 = **297**.

### 16.3 Turn 2

- **Richie** picks Lucid Awakening (Holy, heal 30% max HP, priority +1).
- **Warrior_002** picks Crushing Blow (Physical, power 80, priority −1).
- Priority: Richie +1 first.

**Richie's Lucid Awakening → self:**
- heal = 0.30 × 300 = 90 HP
- Richie HP: 262 → min(262 + 90, 300) = **300**

**Warrior_002's Crushing Blow → Richie:**
- baseDmg = (57 × 80 × 1.20 × 1.20) / 100 = 65.66
- crit roll 2.5% → miss
- hit roll → hit
- type: Physical vs Holy → neutral 1.0×
- gear_will reduction: ×0.931
- variance: +2% → ×1.02
- final: 65.66 × 1.0 × 0.931 × 1.02 ≈ **62 damage**

Richie HP: 300 → **238**

End of turn 2: Richie 238 / 300. Bot 297 / 300.
Regen tick: Richie 238 + 4 = **242**. Bot 297 + 3 (capped at full HP) = **300**.

### 16.4 Turn 3

- **Richie** picks Wolf's Stride (Physical, power 60, priority +1).
- **Warrior_002** picks Heavy Strike again.
- Priority: Richie +1 first.

**Richie's Wolf's Stride → Warrior_002:**
- baseDmg = (18.0 × 60 × 1.0 × 1.0) / 100 = 10.8
- crit roll: +20% Assassin? No, Richie is Sage. → 3.3% → roll = **CRIT lands** (lucky roll!)
- hit → hit
- type: Physical vs Physical → neutral 1.0×
- gear_will reduction: ×0.94
- variance: −3% → ×0.97
- final: 10.8 × 1.5 × 1.0 × 0.94 × 0.97 ≈ **15 damage**
- Wolf's Stride side-effect: Richie gains +20% dodge next turn (→ Richie effective dodge 25%)

Bot HP: 300 → **285**

**Warrior_002's Heavy Strike → Richie:**
- baseDmg = (57 × 60 × 1.20 × 1.20) / 100 = 49.25
- crit roll → miss
- hit roll vs 25% boosted dodge → **DODGE lands**
- final: **0 damage**

End of turn 3: Richie 242 / 300. Bot 285 / 300.
Regen tick: Richie 246. Bot 289.

### 16.5 Turn 4

- **Richie** picks Iron Resolve (Holy, power 70, priority 0). Side-effect: +20% accuracy this fight.
- **Warrior_002** picks Crushing Blow (priority −1).
- Priority: Richie 0 > Bot −1.

**Richie's Iron Resolve → Warrior_002:**
- baseDmg = (18.0 × 70 × 1.0 × 1.0) / 100 = 12.6
- crit roll 3.3% → miss
- hit → hit
- type: Holy vs Physical → neutral 1.0× (Holy strong vs Magic, weak vs Shadow; Physical is neither)
- gear_will reduction: ×0.94
- variance: +6% → ×1.06
- final: 12.6 × 1.0 × 0.94 × 1.06 ≈ **13 damage**

Bot HP: 289 → **276**

**Warrior_002's Crushing Blow → Richie:**
- baseDmg = (57 × 80 × 1.44) / 100 = 65.66
- crit → miss
- hit → hit
- type neutral
- gear_will reduction ×0.931
- variance −5% → ×0.95
- final: 65.66 × 0.931 × 0.95 ≈ **58 damage**

Richie HP: 246 → **188**

End of turn 4: Richie 188 / 300. Bot 276 / 300.
Regen: Richie 192. Bot 280.

### 16.6 Turn 5

- **Richie** picks Slash (running out of unique moves).
- **Warrior_002** picks Heavy Strike.
- Priority tied 0. FOCUS Richie 6.6 > bot 5 → Richie first.

**Richie's Slash → Warrior_002:**
- baseDmg = 7.2, ClassMult 1.0, STAB 1.0
- crit miss; hit lands
- type neutral, reduction ×0.94, variance +3% → ×1.03
- final: ≈ **7 damage**

Bot HP: 280 → **273**

**Warrior_002's Heavy Strike → Richie:**
- baseDmg = 49.25
- crit miss; hit lands
- final: ≈ **42 damage**

Richie HP: 192 → **150**

End of turn 5: Richie 150 / 300. Bot 273 / 300.
Regen: Richie 154. Bot 277.

### 16.7 Result

After 5 turns: Richie at 150 HP, bot at 277 HP. The fight is going badly for Richie — the Warrior's STR×STAB+ClassMult combo is producing ~42 damage per swing, while Richie's Sage damage averages ~10–15 per swing.

**Realistic extrapolation:** without major luck, Richie's average net per turn is approximately −30 HP. At 150 HP remaining, Richie has ~5 more turns. Bot at 277 HP needs ~20 more Slash-equivalent hits. The bot wins this fight cleanly, probably by turn 10–11.

**Observations:**
- Sage's balanced amplification is real but small (+10%) compared to Warrior's class-aligned combo (1.5× STR affinity × 1.20 ClassMult × 1.20 STAB ≈ 2.16× total damage scaling vs Sage's 1.10 stat amp + 1.0 ClassMult + 1.0 STAB ≈ 1.10×).
- Richie's defensive build (high VIT, gear-stacked) keeps him in the fight longer than a glass-cannon Sage would last, but he can't out-damage the Warrior.
- Type pentagon never fired — both fighters used neutral matchups all 5 turns. A Holy move against Magic-typed gear (1.5×) or a Magic move against this Physical bot (1.5×) would have changed the math significantly.
- **Strategic correction for Richie:** swap one Holy move for an Arcane Bolt (Magic, 1.5× vs Physical bot gear). That single swap shifts the matchup dramatically. The depth lives in loadout decisions like this.

---

## 17. v3.0 Launch Scope vs Deferred

### 17.1 LAUNCH (v3.0)

What ships in the v3.0 release:

- 9 existing cards + locked `move_type` assignments
- 6 stat-tree movesets (30 base moves)
- 9 equipment-granted moves (one per existing card; commons grant nothing — that's 6 moves from the rare/UR set)
- 7 AI bot personalities × 3 ELO bracket variants minimum (21 bots)
- ELO ladder + 7 visible rank tier badges
- Civilian tutorial mode (3 scripted fights + practice)
- Friend challenge mode (vs snapshot AI)
- New **Combat tab** in the main app navigation
- New Settings → Combat section (loadout management, equipped gear, move selection)
- ELO leaderboard surface on the existing Social tab (4th metric)

### 17.2 DEFERRED to v3.5+

Explicit non-launch scope:

- **Status effects** — poison, stun, burn, freeze, regen-as-status. Schema reserved (`special_effect`, `on_equip`) but no engine.
- **Wager system** — WLT-amplified souls betting. Merchant's full identity unlock.
- **Live human PvP** — replaces AI bots on the same combat engine. Requires real-time match-coordination infrastructure.
- **Seasonal ladder + rewards** — quarterly resets, leaderboard rewards (titles, cosmetics, etc.).
- **Tournament events** — bracketed competitions.
- **Custom AI personalities + reputation system** — bots that learn from your play patterns.
- **Cosmetic skins / battle animations** — weapon skins, KO animations, particle effects.
- **Set bonuses** — equipping multiple pieces from the same boss grants a synergy bonus.
- **Move pool expansion beyond 30 stat-tree moves** — class-specific moves, weapon-type-specific moves.

---

## 18. Open Design Questions

Items the design conversation surfaced but didn't fully resolve. These get answered during v3 implementation, not before.

1. **Tutorial bot difficulty scripting** — exact stats and movesets for the 3 tutorial fights. Each must be winnable by a fresh Civilian who has read no prior docs.

2. **ELO K-factor exact values** — the §11.3 table is a starting proposal. Calibration will adjust based on early ladder telemetry.

3. **AI bot loadout generation algorithm** — bots in mid/high ELO need realistic loadouts. Hand-curated for v3.0; procedural generation could come in v3.5+.

4. **Friend snapshot AI behavior** — does it play differently from random ranked AI? Possibilities: (a) play exactly like ranked AI but with the friend's loadout, (b) play more aggressively to mimic a "real player," (c) attempt to mirror the friend's historical move distribution.

5. **Anti-griefing for friend challenges** — does the system prevent ELO farming via smurfing into easier friends? §11.2's 50% ELO swing reduction is one safeguard; daily friend-challenge caps might be another.

6. **Mutual KO resolution** — same-priority-bracket trade where both players hit zero on the same turn. Options: (a) draw (both lose 0 ELO), (b) double-loss, (c) higher-FOCUS player wins (continuity with §9 turn order). Recommendation: **draw**.

7. **Spectator mode for friend battles** — can third parties watch a fight in progress? Cool feature, scope-uncertain for v3.0.

8. **Replay system** — server-stored match data could power "Replay last match" in the outcome screen. Storage cost low (~1 KB per match × 100 cap per user). Worth doing in Phase F backend work.

9. **Stat-tree move ID stability** — when balance passes change a move's power, do existing users keep the old move (grandfathered) or get the new one auto-applied? Recommendation: hot-swap (no grandfathering); changes happen between versions, not mid-match.

10. **Bot ELO floor / ceiling** — at very low (<1000) and very high (>3000) ratings, the bot pool thins. Synthetic bot generation handles the edge cases but the variance might feel artificial. Telemetry will tell.

---

## 19. Open Calibration Tasks (Pre-v3 Implementation)

Mechanical work that must happen before v3 ships. None require backend or app code yet — these are design + data-authoring deliverables.

1. **Lock the `move_type` draft assignment for the 9 existing cards** (§3.3 proposed values).
2. **Author the 30 stat-tree moves** with finalized power, accuracy_mod, priority, and effect text (§8.3 sketches).
3. **Author the 9 equipment-granted moves** (3 signature + 6 specialty for the rare/UR cards; commons grant none — only 6 cards grant moves, recheck the count — 3 UR + 3 R = 6 moves, not 9).
   - **Correction noted:** §17.1 over-counted. The actual deliverable is 6 equipment-granted moves (3 signature UR + 3 specialty R), not 9. Common cards grant nothing per §8.1.
4. **Balance pass:** simulate 1,000 random fights across representative loadouts. Flag dominant strategies (anything with >65% win rate vs counter-meta). Tune `power` and `priority` values until no single build dominates.
5. **Design 21+ AI bot variants** (7 personalities × 3 ELO brackets minimum). Each bot needs a name, stat-block, equipped loadout, and 4-move active set.
6. **Build the combat animation library:** move impact effects, HP bar tweens, damage number floaters, crit flash, miss text, type effectiveness badges. Even if status effects are deferred to v3.5+, the animation framework needs to be ready for them.
7. **Implement the equipment-equip UI flow.** New Combat tab + Settings → Combat section with slot-by-slot equip flow.
8. **v3 marketing copy update for Settings → WHAT'S COMING.** Add a "PvP Combat" entry. Move shipped features (Card System, Dungeons, Avatar — partially shipped) out of the placeholder list.

---

## 20. Implementation Phases (Future)

Phasing model mirrors BACKEND.md v2.1's phase-train approach. Each phase becomes a separate commit train and a separate Codemagic build.

### Phase 1 — Equipment System (~2 weeks)
- UI to equip / unequip gear from inventory into the 9 slots
- `hb_pvp_equipped` localStorage persistence
- Stat-aggregation function applying class affinity (1.5× / 1.15× / 0×)
- Character/avatar surface showing equipped pieces visually (uses existing 8 avatar PNGs)
- Settings → Combat section scaffold

### Phase 2 — Combat Math + Move Data (~3 weeks)
- 30 stat-tree moves authored + numerical balance pass
- 6 equipment-granted moves authored
- Damage formula implementation (full §6 chain)
- Turn-order resolution (§9)
- HP / regen tick handling
- Unit tests covering crit/dodge/hit math, type multipliers, STAB, class bonuses, gear affinity stacking

### Phase 3 — Single-Player vs AI Bot Battle UI (~4 weeks)
- New Combat tab in main navigation
- Loadout review screen (gear + 4 moves)
- Battle screen with HP bars + damage numbers + animations
- Outcome screen
- Initial AI bot logic (60/25/15 model from §14.2)
- 7 bot personalities × 3 ELO brackets = 21 bots
- "Play vs computer" mode only — no matchmaking yet
- ELO not yet tracked (this phase is "test the engine works")

### Phase 4 — Matchmaking + ELO + Ranked Ladder (~3 weeks)
- ELO formula + K-factor brackets (§11.3)
- Ranked queue (vs random bot at ELO ±100)
- ELO display on profile + Combat tab home
- ELO tier badges (§12.2)
- `hb_pvp_elo`, `hb_pvp_battle_history` persistence
- Backend additions (D1 tables, 4 endpoints) — Phase F in the broader v2.x/v3.x roadmap

### Phase 5 — Civilian Tutorial Mode + Class Awakening UX (~2 weeks)
- 3-scripted-fight tutorial (§13.1)
- Practice mode (unranked vs easy AI)
- Class Awakening "Welcome to Ranked" modal trigger
- Civilian-only Combat tab UI state

### Phase 6 — Equipment-Granted Moves Live in Combat (~2 weeks)
- Active equipped rare/UR cards add their move to the user's accessible pool
- Unequipping removes the move (with safety check: if the move is in the active 4-slot loadout, force-replace with a fallback stat-tree move)
- UI surface in the loadout screen: "Equipment moves" section showing the 6 possible additions

### Phase 7+ (Deferred to v3.5+)
- Live human PvP (replaces AI bots on existing engine)
- Status effects (poison, burn, freeze, stun, regen)
- Wager system (WLT-amplified souls betting)
- Seasonal ladder + rewards
- Tournament events
- Spectator mode
- Replay system
- Custom AI personality / reputation system

**Estimated total v3.0 timeline:** Phases 1–6 at ~2–6 weeks each ≈ **16–20 weeks of focused work** (~4–5 months). Realistic shipping window with normal iteration overhead: **5–6 months from kickoff to TestFlight build 1 of v3.0**.

---

---

## 21. Realtime Human PvP — Phase 7 Implementation (v1.1, June 19 2026)

> This section is the **implementation truth** for live human-vs-human PvP. It is being built now (ahead of the v1.0 roadmap, which deferred this to §20 Phase 7). Where it conflicts with §1–20, §21 wins.

### 21.1 Reconciliation with v1.0

- **Combat model:** v1.0 §4–9 designed a bespoke combat system (the §6 damage formula + the 5-type "Type Pentagon" + 30 stat-tree moves). **That model was never implemented.** What shipped is the **Arena engine** — OSRS-style Melee/Magic/Ranged with a Pokémon-style turn-based battle UI, powering the Ascent Tower. **Realtime PvP reuses the shipped Arena engine verbatim.** §4–9 / §6 are superseded for this implementation. The combat math is solved and proven (`Arena.selfTest()` = 36 tests; determinism test T1).
- **Async/bots-first:** v1.0 §1.7 + §17.2 + §20 Phase 7 deferred live human PvP to v3.5+ as "requires real-time match-coordination infrastructure." §21 **is** that infrastructure.
- **Retained from v1.0:** ELO (§11.3), souls reward (§10.1), tier badges (§12.2), the `pvp_matches`/`pvp_ratings` tables (§15.2, adapted to the Arena model), mutual-KO → draw (§18.6), the ELO leaderboard surface (§12.4).

### 21.2 Authority model

Server-authoritative, always. One **Durable Object** (`MatchRoom`, SQLite-backed) owns each match: the authoritative battle session, the turn state machine, the per-turn move buffer, and the turn deadline. The client sends **intents** and renders **broadcast state**; it never computes an outcome. The DO runs the **same** combat core the client uses (no fork) and re-validates every move.

### 21.3 Transport

- **Primary: WebSocket** (Hibernation API — compat_date `2026-05-12` + `nodejs_compat` supports it).
- **Fallback: HTTP** request/poll to the same DO (turn-based tolerates polling; the DO answers both WS upgrades and plain HTTP).
- DO addressed by `idFromName(matchCode)` — no routing table needed.
- **WS auth:** browser WebSockets can't set headers, so the session JWT rides a `?token=` query param; the Worker validates it at the edge and forwards the upgrade to the DO with the resolved `userId` in an internal header. (Hardening to a short-lived ticket: deferred.)
- The match **engine** (state machine + resolution) is a pure module independent of transport, so a pure Workers+D1 polling fallback (if DOs are ever unavailable) reuses it unchanged.

### 21.4 The combat core — shared, no fork

Extract `shared/combat-core.js` — the pure deterministic engine lifted from app.js: `_arMulberry32` (seeded RNG), `ARENA_MOVE_LIB`, `WEAPON_MOVES`, `ARCH_MOVES`, the stat/profile math (`_arenaCombatProfile`, `_arenaMaxHP`, `_arenaEffectiveness`, `_arenaSideOdds`, `_arAccBonusOf`), the status system (`_arPushMod` + the `_arStat*` aggregators), move execution (`_arExecMove`, `_arApplyFx`, `_arEndTurn`), `arenaTakeTurn`, and the v2/tiered AI (unused by PvP). New PvP entry points:

- `pvpStartBattle(combatantA, combatantB, seed)` → BattleSession. Replaces the impure browser setup (`getHunterBuild`/`CARDS`/`localStorage`) by accepting two **pre-computed combatants** (`{stats, pMoves, weaponName, arch, attuned, name}`).
- `pvpResolveTurn(sess, moveIdA, moveIdB)` → events. Reuses `arenaTakeTurn` with the foe-move picker **injected** to return `moveIdB` (P1 = `'p'` side, P2 = `'b'` side). Identical resolution to the Ascent.

The Worker imports `combat-core.js` (ESM). The client loads the same file (browser global) and app.js's Ascent is refactored to consume it — **one copy, no fork**, gated on `Arena.selfTest()` staying 36/36 + `node tools/sim-ascent.js`. (If the client refactor proves too risky on the shipped path, the fallback is: `combat-core.js` is the server module + a Node parity harness runs the 36 self-tests against it — verified-no-drift.)

### 21.5 State machine

`LOBBY` (P1 created, awaiting P2) → `ACTIVE` → loop[ `COLLECTING` (await both moves; deadline armed) → `RESOLVING` (both in → `pvpResolveTurn` → broadcast) ] → `ENDED` (KO | turn-cap | forfeit | mutual-KO = draw).

### 21.6 Turn model

Simultaneous **blind** selection (matches the engine + v1.0 §9): each turn both players submit one move; the DO waits for both, then resolves both in the engine's priority/FOCUS order.

- **Timeout:** DO `alarm` at the turn deadline (45 s default). On fire, an un-submitted player is auto-assigned a default move (first off-cooldown move, else a defensive one); resolve. Prevents stalling.
- **Double-submit:** first move for turn `T` wins; later submits for `T` are ignored (idempotent).
- **Stale turn:** a submit for `turn < current` is rejected.

### 21.7 Reconnect / disconnect / forfeit

- **Reconnect:** hibernation persists the DO; a reconnecting client opens a new WS, authenticates, sends `resync`, gets full current state, resumes. The match survives transient drops.
- **Disconnect:** the DO tracks each player's socket + last-seen. On WS close → mark disconnected; the turn-timeout keeps the match advancing. Sustained disconnect (no reconnect within ~90 s while the match is stalled on that player) → opponent wins by forfeit.
- **Forfeit:** explicit `forfeit` intent OR sustained disconnect → opponent wins; `ENDED`; result persisted.

### 21.8 Matchmaking

- **Invite-by-code (v1, build first):** `POST /v1/pvp/create` → server generates a 6-char code → `DO.idFromName(code)` initialized (creator = P1). `POST /v1/pvp/join {code}` → DO adds P2 → `ACTIVE`. Both connect WS to `/v1/pvp/ws?code=&token=`.
- **Open queue (stretch):** a `pvp_queue` D1 table; a matcher pairs two queued players (ELO-banded) into a code and notifies both.

### 21.9 Anti-cheat

- **All resolution is server-side** — the client never decides the outcome.
- Every move is validated: it is the submitter's current turn, the `moveId` is in their kit, and it is off-cooldown. Illegal intents are rejected.
- Combatants are submitted at join (stats are **client-authoritative**, consistent with the whole game's trust model — there is no server build authority, per the backend map). The server validates move IDs against the shared move lib and sanity-bounds the stats. Full server-derived stats are deferred (would require a server build authority that does not exist today).

### 21.10 Persistence — D1 migration `0021_pvp.sql`

- `pvp_matches` (id, code, p1_user_id, p2_user_id, p1_combatant_json, p2_combatant_json, winner_user_id, result `'p1_win'|'p2_win'|'draw'|'forfeit'`, turns, ranked, started_at, ended_at). The DO writes this on `ENDED` (DOs can access `env.DB`).
- `pvp_ratings` (user_id PK, elo DEFAULT 1500, peak_elo, wins, losses, draws, last_match_at). Ranked queue matches update ELO (§11.3). Invite-code duels are recorded but **unranked** in v1.
- Souls reward is granted client-side on the win beat (§10.1), consistent with co-op.
- Migrations applied via `wrangler d1 execute --remote --file=migrations/0021_pvp.sql` (NOT `migrations apply`).

### 21.11 Client integration

- New `pvp.js` (`window.PvP`): WS connect + HTTP fallback (reusing `Auth.getJwt()` + `BACKEND_URL` + the `{ok,code,detail}` shape), send intents, and drive the **existing battle UI** via a `BattleStateManager` seam at app.js:9839 — replace the local `arenaTakeTurn(_arSess,moveId)` call with intent-submit, and render server-broadcast events through `_pkbPlay`. Reconnect on app-foreground. UI states: waiting-for-opponent / your-turn / opponent's-turn / opponent-disconnected / turn-timer. The win share-card is reused.
- New PvP entry point (a "Duel" surface). The Civilian gate (§5.4) is deferred for v1 (any account with a usable battle kit can duel).

### 21.12 Message protocol

- **Client → Server:** `submit_move {turn, moveId}` · `resync` · `forfeit` · `ping`.
- **Server → Client:** `match_start {seed, youAre:'p'|'b', combatants}` · `state {phase, turn, deadline, youSubmitted, oppConnected, pHP, bHP}` · `turn_result {turn, events[], pHP, bHP, done, winnerSide}` · `match_end {result, winnerUserId, rewards}` · `opp_status {connected}` · `error {code, detail}`.

### 21.13 Build phases (this session)

P0 spec+architecture (this section) → P1 backend DO match engine (invite-code) → P2 matchmaking+lobby+D1 → P3 client integration → P4 two-client integration test → P5 ship-ready (version bump, two-gate build check, `PVP_BUILD_REPORT.md`). The DO is **SQLite-backed (`new_sqlite_classes`) → it runs on the Workers FREE plan** (since April 2025; no plan upgrade needed). Logic is validated locally via `wrangler dev` (miniflare simulates DO + D1 + WebSockets); the owner runs the remote `wrangler deploy` + D1 migration + the final two-phone test.

---

*End of spec. v1.0 (§1–20) authored May 12 2026; v1.1 §21 (realtime implementation) added June 19 2026. This doc is the single source of truth for PvP; §21 governs the realtime build. Deviations require a version bump + redline.*
