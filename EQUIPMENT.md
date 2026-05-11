# EQUIPMENT.md — Awakened Equipment System

**Status:** v1.3 foundational design. Schema patches shipped.
**Last updated:** May 11, 2026
**Version history:**
- v1.0 (May 11, AM) — initial draft, 5 stat domains, no class system
- v1.1 (May 11, AM) — added 6th stat domain (WLT), class system integration, Model 2 affinity bonuses
- v1.2 (May 11, AM) — drop table restructure: each boss now has a "signature" ultra-rare item that is best-in-slot for that slot (until higher-rank bosses release theirs)
- v1.3 (May 11, PM) — renamed bottom rarity tier `uncommon` → `common` across launch tables; drop rates tuned in DROPS.md v1.3 (ultra-rare 1/40 → 1/20, rare 1/15 → 1/12, common stays 1/5). Schema-only doc patch — slot/bonus assignments unchanged.

Companion docs:
- `DROPS.md` — drops/cards collection system
- `BOSSES.md` — boss system mechanics, framework principles
- `CARDS.md` — boss card visual spec
- `CLAUDE.md` — operational reference for shipped code

---

## Why v1.2 exists

v1.1 captured the 6-stat domain system and class-affinity model correctly, but the drop-table assignments distributed ultra-rares across slots somewhat arbitrarily. v1.2 restructures the launch drop tables so each boss has a **signature ultra-rare item** that is **best-in-slot for that specific equipment slot** (until higher-rank bosses introduce competing items for those slots).

This produces a cleaner "kill boss X to chase iconic item Y" RPG drop loop. Each ultra-rare carries the boss's identity. Players who want best-in-slot for the amulet slot specifically grind The Insomniac. For gloves: The Carouser. For boots: The Steel Wolf.

The common and rare items in each boss's drop table cover other slots, filling out the launch equipment ecosystem without diluting the signature ultra-rare.

---

## Purpose (unchanged from v1.1)

Awakened is a habit-driven RPG with mechanically-meaningful equipment that powers a future PvP system. Equipment is **PvP-ready** — stats will eventually matter in combat. Class system **integrates via affinity bonuses** — Model 2, 1.5× for specialized classes / 1.15× Sage / 0× Civilian.

v1 ships data foundation only. UI / aggregation / combat all deferred.

---

## Framework — locked design principles

### 1. PvP-ready equipment (unchanged)

Stats designed for future combat. v1 = scaffolding.

### 2. OSRS-inspired 9 slots (unchanged)

Helm, Cape, Amulet, Weapon, Body, Legs, Gloves, Boots, Ring. Ammo + Shield deferred.

### 3. Stat language matches existing 6 domains (unchanged)

STR / VIT / INT / FOCUS / WILL / WLT.

### 4. Class system integration via Model 2 affinity (unchanged)

1.5× for specialized class match. 1.15× for Sage on all stats. 0× for Civilian.

### 5. Slot exclusivity per boss + signature ultra-rare (REVISED in v1.2)

Each boss in v1 owns 3 slots: one for each rarity tier. The boss's **ultra-rare slot** is its **signature slot** — the item dropped there is best-in-slot for that slot at launch.

When higher-rank bosses eventually release items for the same slots, those items can surpass the launch BIS via tier-doubling. The launch ultra-rares are "BIS for now" — they hold the throne until challenged.

### 6. Tier-doubling stat magnitudes (unchanged)

E:12 → D:24 → C:48 → B:96 → A:192 → S:384 for ultra-rares.

### 7. Best-in-slot is class-dependent (unchanged from v1.1)

Class affinity amplifies aligned bonuses. A class-aligned A-rank ultra-rare can outpace a non-aligned S-rank ultra-rare on effective stats.

### 8. Drops are visually equipment (unchanged)

Card art depicts wearable items from launch.

---

## Equipment Slots (9 total — unchanged)

| Slot | Body location |
|---|---|
| Helm | Head |
| Cape | Back |
| Amulet | Neck |
| Weapon | Main hand |
| Body | Chest / torso |
| Legs | Lower body |
| Gloves | Hands |
| Boots | Feet |
| Ring | Finger |

---

## Stat Categories (6 total — unchanged from v1.1)

| Stat | Domain meaning | Class affinity |
|---|---|---|
| **STR** | Physical strength | **Warrior** ⚔️ |
| **VIT** | Vitality / endurance | **Ranger** 🏹 |
| **INT** | Intellect / learning | **Mage** 🧙 |
| **FOCUS** | Concentration / mindfulness | **Assassin** 🥷 |
| **WILL** | Willpower / discipline | **Paladin** 🛡️ |
| **WLT** | Wealth / financial discipline | **Merchant** 👑 |

---

## Class System (unchanged from v1.1)

### The 8 classes

| Key | Name | Emoji | Color | Vibe |
|---|---|---|---|---|
| `CIVILIAN` | Civilian | 🧍 | gray | "You haven't been awakened yet." |
| `STR` | Warrior | ⚔️ | red | "Discipline is your weapon." |
| `VIT` | Ranger | 🏹 | green | "Recovery and endurance are your edge." |
| `INT` | Mage | 🧙 | blue | "Knowledge compounds like interest." |
| `FOCUS` | Assassin | 🥷 | slate | "You operate in silence." |
| `WILL` | Paladin | 🛡️ | orange | "Unbreakable." |
| `WLT` | Merchant | 👑 | gold | "The long financial game." |
| `SAGE` | Sage | 🌟 | purple | "A complete human." |

### Assignment logic (per shipped code)

`CLASS_LV5_THRESHOLD = 5`, `CLASS_SHIFT_DOMINANCE = 1.20`, `CLASS_BALANCE_RATIO = 0.85`.

Civilian → first Lv5 awakens to a class. Multiple Lv5s while Civilian → user picks. All 6 stats Lv5 within 15% → Sage (sticky). Top stat / current class ratio ≥ 1.20 → class shift.

### Class-equipment affinity (Model 2)

- Items grant base bonuses to all 6 stats
- Class-favored stat amplified by **1.5×** when wearer's class matches
- Sage applies **1.15× to ALL 6 stats**
- Civilian: no amplification

**Example — Pendant of the Wakeful (E-rank ultra-rare, Amulet):**
Base: +8 VIT, +4 WILL

| Class | Effective stats |
|---|---|
| Civilian | +8 VIT, +4 WILL |
| Warrior | +8 VIT, +4 WILL (STR-favored, no amplification) |
| Ranger (VIT-favored) | **+12 VIT**, +4 WILL |
| Paladin (WILL-favored) | +8 VIT, **+6 WILL** |
| Sage | **+9.2 VIT**, **+4.6 WILL** |

Best-in-slot depends on class. A Ranger gets max value from this amulet; a Warrior gets base stats with no amplification.

---

## Item Schema (6-key bonuses)

```js
{
  id: 'pendant_of_the_wakeful',
  name: "Pendant of the Wakeful",
  slot: 'amulet',
  source_boss: 'the_insomniac',
  rarity: 'ultra_rare',
  tier: 'E',
  flavor: "Hangs heavy with the weight of restful nights. Best in slot — until something older breaks.",
  art_path: 'assets/items/pendant_of_the_wakeful.png',
  
  bonuses: {
    str: 0, vit: 8, int: 0, focus: 0, will: 4, wlt: 0
  },
  
  // Reserved fields
  set_id: null,
  required_level: null,
  special_effect: null,
  on_equip: null,
  cooldown_seconds: null
}
```

---

## Stat Magnitude Table (unchanged from v1.1)

| Rarity \ Tier | E | D | C | B | A | S |
|---|---|---|---|---|---|---|
| Common | **2** | 4 | 8 | 16 | 32 | 64 |
| Rare | **6** | 12 | 24 | 48 | 96 | 192 |
| Ultra-rare | **12** | 24 | 48 | 96 | 192 | 384 |

---

## Slot Ownership by Boss (v1 launch — REVISED in v1.2)

### The Insomniac (E-rank, VIT-themed, sleep boss)

**Signature slot: Amulet (Ultra-rare BIS at launch)**

| Slot | Rarity | Item ID | Name | Base bonuses | Flavor |
|---|---|---|---|---|---|
| Helm | Common | `dream_woven_hood` | Dream-Woven Hood | +2 VIT | "A hood spun from undisturbed sleep." |
| Cape | Rare | `sleepwalkers_cloak` | Sleepwalker's Cloak | +6 VIT | "Worn by those who walk the line between dreams and dawn." |
| **Amulet** | **Ultra-rare** | `pendant_of_the_wakeful` | Pendant of the Wakeful | **+8 VIT, +4 WILL** | "Hangs heavy with the weight of restful nights. Best in slot — until something older breaks." |

### The Carouser (E-rank, WILL-themed, bedtime restraint boss)

**Signature slot: Gloves (Ultra-rare BIS at launch)**

| Slot | Rarity | Item ID | Name | Base bonuses | Flavor |
|---|---|---|---|---|---|
| Ring | Common | `vow_ring` | Vow Ring | +2 WILL | "Worn by those who chose to leave before midnight." |
| Weapon | Rare | `vessel_of_refusal` | Vessel of Refusal | +6 WILL | "A chalice carried but never lifted." |
| **Gloves** | **Ultra-rare** | `sober_kings_gloves` | Sober King's Gloves | **+8 WILL, +4 VIT** | "Steady hands. Empty cup. Best in slot — discipline made manifest." |

### The Steel Wolf (D-rank, VIT-themed, walking boss)

**Signature slot: Boots (Ultra-rare BIS at launch)**

| Slot | Rarity | Item ID | Name | Base bonuses | Flavor |
|---|---|---|---|---|---|
| Legs | Common | `pack_leaders_greaves` | Pack Leader's Greaves | +4 VIT | "The wolf does not stop." |
| Body | Rare | `alphas_mantle` | Alpha's Mantle | +12 VIT | "Mantle of one who leads the hunt." |
| **Boots** | **Ultra-rare** | `trail_worn_boots` | Trail-Worn Boots | **+16 VIT, +8 STR** | "Every step counts. These have counted thousands. Best in slot — until the trail goes further." |

### Slot coverage at launch (still 9 slots)

| Slot | Source | Rarity at launch |
|---|---|---|
| Helm | Insomniac | Common (Dream-Woven Hood) |
| Cape | Insomniac | Rare (Sleepwalker's Cloak) |
| **Amulet** | **Insomniac** | **Ultra-rare BIS (Pendant of the Wakeful)** |
| Ring | Carouser | Common (Vow Ring) |
| Weapon | Carouser | Rare (Vessel of Refusal) |
| **Gloves** | **Carouser** | **Ultra-rare BIS (Sober King's Gloves)** |
| Legs | Steel Wolf | Common (Pack Leader's Greaves) |
| Body | Steel Wolf | Rare (Alpha's Mantle) |
| **Boots** | **Steel Wolf** | **Ultra-rare BIS (Trail-Worn Boots)** |

All 9 slots covered. Three slots have launch BIS (signature ultra-rares); six slots have non-BIS items waiting for higher-rank bosses to surpass them.

### Class affinity coverage (intentional VIT/WILL bias at launch)

| Class | Primary affinity items | Secondary affinity items |
|---|---|---|
| Warrior (STR) | (none) | Trail-Worn Boots (8 STR) |
| Ranger (VIT) | 6 items (Helm + Cape + Amulet + Legs + Body + Boots) | Sober King's Gloves (4 VIT) |
| Mage (INT) | (none) | (none) |
| Assassin (FOCUS) | (none) | (none) |
| Paladin (WILL) | 3 items (Vow Ring + Vessel + Gloves) | Pendant of the Wakeful (4 WILL) |
| Merchant (WLT) | (none) | (none) |

Future bosses fill INT, FOCUS, WLT alignment gaps as roster expands.

---

## Best-in-slot for E and D ranks at launch

| Slot | Launch BIS item | Source boss | Class amplification |
|---|---|---|---|
| Amulet | Pendant of the Wakeful | Insomniac (E) | Ranger primary, Paladin secondary |
| Gloves | Sober King's Gloves | Carouser (E) | Paladin primary, Ranger secondary |
| Boots | Trail-Worn Boots | Steel Wolf (D) | Ranger primary, Warrior secondary |

These items remain BIS for their slots until higher-rank bosses introduce competing items. When that happens, these items become "E-rank BIS" or "D-rank BIS" — historically iconic but mechanically surpassable.

---

## Drop Mechanics Integration

Drop engine in shipped code uses the rates from DROPS.md v1.3 (1/20 ultra-rare, 1/12 rare, 1/5 common with first-common protection at 2/3). The boss-to-rarity-to-item mapping is: each boss has exactly one item per rarity tier, with the ultra-rare being the signature/BIS item.

v1 UI displays items as Pokédex collection. Equipment UI (slotting items, stat aggregation, character avatar) ships in Phase 3.

---

## Future Sections (deferred — unchanged from v1.1)

1. Combat formulas
2. PvP arena rules
3. Equipment UI design (Phase 3, uses existing 8 class avatar PNGs)
4. Equipment progression for D/C/B/A/S rank bosses
5. Set bonuses (per boss / per class)
6. Equipment beyond bosses (login milestones, rank rewards)
7. Item modifications (imbuements, sockets — probably indefinite defer)
8. Equipment-XP integration (probably no)
9. Class-aligned special effects (v2 design)

---

## Decision log

- Path 2 — equipment is PvP-ready (locked v1.0)
- 9 slots, Ammo/Shield cut (locked v1.0)
- 6 stat categories including WLT (locked v1.1)
- Tier doubling matches souls economy (locked v1.0)
- Slot exclusivity per boss (locked v1.0)
- **Each boss has a signature ultra-rare = BIS for its slot at launch** (NEW v1.2)
- Items have equipment schema from launch (locked v1.0)
- Best-in-slot is class-dependent (locked v1.1)
- Class system integration via Model 2 affinity (locked v1.1)
- Affinity multiplier: 1.5× specialized, 1.15× Sage, 0× Civilian (locked v1.1)
- Combat formulas, PvP rules, equipment UI deferred (locked v1.0)
- Equipment doesn't affect XP, rank, compound bonus (locked v1.0)

---

## Implementation phases

### Phase 1 (shipped May 11, 2026 — drop-table restructure patch pending)
- Drop engine + 9 cards + Pokédex + reveal modal ✅
- WLT field added to CARDS schema ✅
- **Drop-table restructure pending** — current shipped CARDS still has v1.1 slot/rarity assignments

### Phase 1.2 (next — drop table restructure patch, ~30 min)
- Update CARDS constant in app.js: change slot assignments per v1.2 table
- Update item bonuses to match new rarity/tier math
- Update flavor lines to reflect "BIS for now" framing where applicable
- No data migration for users (hb_inventory stores IDs only)

### Phase 2 (future)
- Backend cross-device sync

### Phase 3 (future)
- Character avatar UI (uses existing 8 class PNGs)
- Equip slot interface, stat aggregation with affinity applied

### Phase 4 (future)
- Friend system, leaderboard, visible profiles

### Phase 5 (future)
- PvP MVP

### Phase 6+ (future)
- Tournaments, seasons, class-aligned sets, special effects

---

*v1.2 foundation complete. Drop-table restructure patch is the only blocking action for full v1 alignment with shipped code.*
