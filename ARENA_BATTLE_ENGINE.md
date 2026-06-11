# Awakened — Arena Battle Engine (v2.3, as shipped W234)

> **Status:** CANONICAL for the Ascent tower. This documents the engine **as actually
> implemented** in `app.js` (build W234), validated by simulation (§12).
> **v2.3 changelog (W234 — foe-kit rearmament, per-edge type-eff, calibration bands):**
> structural fix first — **foe kits were rearmed** (walls carry Refuse so DoT has an answer;
> trickster got a real kit) before any weapon was nerfed; a new **Calibration Targets** section
> (§0) now governs all balance work; type-eff is **per-edge** (Sent▸Aggr softened to 1.08/0.926
> — at ±20% a countered rated attempt was a near-auto-loss); DOT_INTAKE_CAP 0.20→0.15 and
> Stagger CD 3→4 per the prescribed escalation ladders; the early-floor power curve was
> audited (frontier crosses fresh-account power at floor ~2–3, first weapon is days away) —
> **curve change proposed, not shipped** (§13). selfTest is now 15 checks.
> **This is not PvP.** The Arena is a cosmetic, single-player, **bot-only** climb. Duels/PvP
> are permanently retired; `PVP.md` is stale and is **not** a source of truth for this engine.
> **Stack:** one vanilla-JS IIFE (`app.js`), no modules/bundler, Capacitor → iOS. The engine
> is pure (DOM-free), localStorage-only (`hb_arena_v2`). No backend, no network, no
> XP/currency/character-power side effects — ever.

---

## 0. Calibration targets (govern every balance decision)

| Target | Band |
|---|---|
| **T1** | Matched-weapon player vs equal-power floor foe: **row mean ∈ [55%, 75%]** |
| **T2** | Any single cell ∈ [25%, 90%]; outside → flag; full row outside T1 after the prescribed levers are exhausted → STOP and report |
| **T3** | Each type-eff edge's measured contribution at equal power ∈ **[+15, +25] win pts** (archetype kits, no weapons, TYPE_EFF on vs forced 1.0) |
| **T4** | Mean fight length ∈ **[4, 10] turns** at 0.5× / 1× / 3× REF_POWER |

The baseline for a matched-weapon player is **not 50%**: player rows carry a weapon kit +
Attuned vs floor foes' archetype kits — the player's gear edge is by design. Do not balance
player weapons down to bot poverty; upgrade the bots first (that is what W234 did).

---

## 1. Design goals & invariants

1. **Build + tactics, not luck.** A clearly stronger build wins; the moveset is the tactical
   layer on top.
2. **"Floor reached = build strength."** *(Sim: a 2× build wins 100%.)*
3. **Cosmetic only.** The single commit writes only Arena rating / W-L / streak / floor /
   titles to `hb_arena_v2`. No XP, souls, stats, or power.
4. **Your weapon defines your 4 moves.** Armor relics feed stats/HP, never moves.
5. **Deterministic & testable.** All randomness through a seeded PRNG (mulberry32).

---

## 2. The combatants

| Role | Formula | Combat job |
|---|---|---|
| **ATTACK** | `STR×1.6 + FOCUS` | damage output (numerator) |
| **DEFENSE** | `VIT×1.4 + WILL` | **HP pool AND per-hit mitigation** |
| **EDGE** | `INT×1.6` | crit chance, turn order, accuracy |

**Max HP:** `maxHP = max(20, round(40 + DEFENSE × 2.2))`. Player roles = live stats + armor;
foe roles = the floor curve split by archetype weights (sum 3 — split never changes total power).

**Archetype** (derived from the role split): `balanced` (no role ≥ 40%) · dominant role →
`aggressor` / `sentinel` / `trickster` · ≥ 52% → `glasscannon` / `juggernaut`.

---

## 3. Type effectiveness (symmetric, PER-EDGE — no longer uniform ±20%)

Triangle: **Aggressor ▸ Trickster ▸ Sentinel ▸ Aggressor** (extremes collapse; Balanced &
mirrors neutral). Computed per direction, per hit; multipliers are reciprocal pairs
(favored = 1+s, countered = 1/(1+s)).

| Edge | Multipliers | Measured contribution (T3 band +15..+25) |
|---|---|---|
| Aggressor ▸ Trickster | 1.20 / 0.83 | **+25.2 pts** (untouched per review; ~0.2 over band — flagged) |
| Trickster ▸ Sentinel | 1.20 / 0.83 | **+19.4 pts** (landed in band via the W234 kit rearmament alone) |
| Sentinel ▸ Aggressor | **1.08 / 0.926** | **+22.9 pts** (tuned W234, s=0.08, 2 iterations) |

**Why per-edge:** there is no switching mechanic — you bring one build into a rated attempt.
At a uniform ±20%, the Sent▸Aggr edge measured **+49 win pts**, turning countered attempts
into near-auto-losses with zero counterplay. Each edge is tuned so a counter stings but is
playable; the map (`_ARENA_EFF_EDGES`) is the tuning point.

---

## 4. Weapons, moves & foe kits

### 4.1 Player weapons (weapon defines your 4 moves; Attuned ×1.15 if it matches your archetype)
| Weapon | Moveset | Attuned archetypes |
|---|---|---|
| (Unarmed) | Jab · Hook · Guard · Focus | none |
| Rusted Training Blade | Slash · Lunge · Guard · Focus | none |
| Titan's Oathblade | Cleave · Sunder · Brace · Oathstrike | Aggressor / Juggernaut |
| Hammerfall Warmaul | Crush · Stagger · Brace · Quake | Sentinel |
| Kilnforged Warblade | Searing Cut · Ember · Temper · Immolate | Aggressor |
| Ten-Thousand Step Blade | Flurry · Quickstep · Evade · Thousand Cuts | Trickster / Glass-Cannon |
| Vessel of Refusal | Ward Strike · Refuse · Willbreak · Last Vow | Sentinel |

### 4.2 Foe kits (ALL documented — the W233 doc only showed one, which is how the trickster gap hid)
| Foe archetype | Kit | W234 change |
|---|---|---|
| Aggressor | Cleave · Sunder · Slash · Focus | unchanged |
| Glass-Cannon | Oathstrike · Cleave · Slash · Temper | unchanged |
| Sentinel | Slash · Brace · **Refuse** · Ward Strike | Guard → **Refuse** (walls must answer DoT) |
| Juggernaut | Crush · Brace · **Refuse** · Quake | Guard → **Refuse** |
| Trickster | **Flurry · Quickstep · Evade · Searing Cut** | rearmed (was Quickstep/Willbreak/Evade/Flurry — its column was free wins ladder-wide) |
| Balanced | Slash · Guard · Focus · Lunge | unchanged |

### 4.3 Move table (power = ×ATTACK; W234 changes bold)
| Move | Power | Acc | Hits | Prio | CD | Effect |
|---|---|---|---|---|---|---|
| Jab | 0.85 | 97% | 1 | — | 0 | — |
| Slash | 1.0 | 95% | 1 | — | 0 | — |
| Lunge | 1.25 | 88% | 1 | — | 2 | — |
| Hook | 1.3 | 85% | 1 | — | 2 | — |
| Cleave | 1.55 | 82% | 1 | — | 2 | — |
| Crush | 1.7 | 78% | 1 | — | 2 | — |
| Oathstrike | 1.95 | 88% | 1 | — | 3 | — |
| Flurry | 0.5 | 95% | 3 | — | 1 | — |
| Quickstep | 0.7 | 99% | 1 | +1 | 1 | goes first |
| Thousand Cuts | 0.38 | 95% | 4 | — | 3 | — |
| Ember | 0.7 | 95% | 1 | — | 1 | bleed 12%/t ×3 |
| Searing Cut | 1.1 | 90% | 1 | — | 1 | burn 16%/t ×3 |
| Immolate | 1.6 | 85% | 1 | — | 3 | burn 16%/t ×2 |
| Sunder | 0.8 | 92% | 1 | — | 2 | armor-shred −25% ×3 |
| Quake | 1.2 | 85% | 1 | — | 2 | armor-shred −20% ×2 |
| Stagger | 0.9 | 85% | 1 | — | **4** | stun (skip 1 action) *(CD 3→4 in W234 — Warmaul row-mean lever)* |
| Willbreak | 0.85 | 90% | 1 | — | 2 | foe ATK ×0.75 ×3 |
| Ward Strike | 0.7 | 95% | 1 | — | 1 | heal self 12% |
| Brace | 0 | — | — | — | 2 | self takes ×0.65 ×2 |
| Focus / Temper | 0 | — | — | — | 2/3 | self ATK ×1.30 / ×1.40 ×3 |
| Evade | 0 | — | — | — | 2 | +40% dodge ×2 (cap 50%) |
| Guard | 0 | — | — | — | 1 | halve next landed hit (crit-immune block) |
| Refuse | 0 | — | — | — | 2 | cleanse own debuffs/DoT + guard |
| Last Vow | 0 | — | — | — | 4 | heal self 40% |
| *Struggle* | 0.5 | 95% | 1 | — | 0 | fallback when ALL moves on CD (both sides) |

### 4.4 Floor archetype rotation
Regular floors: `['aggressor','sentinel','trickster'][(floor + wins + losses) % 3]` — advances
each committed **rated** attempt; bosses keep fixed archetypes. "Matchup shopping" (losing on
purpose to rotate) costs lives + ELO; bosses can't be shopped.

---

## 5. The damage pipeline (single source of truth)

```
// once per move:
baseAtk = ATTACK × atkStatusMult × attunedMult            // attuned = 1.15, player-only, weapon↔archetype match
typeEff = effectiveness(attackerArch → defenderArch)       // per-edge map (§3), symmetric, per direction
accuracy = min(0.99, move.acc + min(0.08, edgeShare × 0.20))   // normalized edgeShare — scale-invariant

// per sub-hit (loop `move.hits`):
  if rng() > accuracy            → miss (0; leaves Guard intact)
  else if rng() < dodge          → dodged (0; leaves Guard intact)   // dodge = min(0.50, Σ Evade)
  else:
    crit   = rng() < critChance                                      // clamp(0.08 + edgeShare×0.40, 0.08, 0.28)
    defEff = DEFENSE_base × armorShred × (crit ? 0.5 : 1)             // crit pierces HALF the base armor
    hit    = baseAtk × move.power × typeEff / (1 + defEff / 60)       // DEFENSE mitigates (DEF_SCALE = 60)
    if crit: hit ×= 1.5                                               // crit SKIPS takenMult (ignores Brace/DEF-up)
    else:    hit ×= clamp(takenMult, 0.40, 2.0)
    hit ×= 1 + rng(−0.15…+0.15)                                       // variance PER sub-hit
    if Guard not-yet-consumed AND hit > 0: hit ×= 0.5; consume Guard  // first LANDED sub-hit; applies on crits too
    accumulate hit

total      = min(Σ hits, (anyCrit ? 0.75 : 0.55) × defender.maxHP)   // anti-one-shot cap binds on the MOVE TOTAL
effective  = min(total, defender.HP_before)    // overkill is NOT credited to the damage tally
defender.HP = max(0, HP − total)
dmgDealt[attacker] += effective                // the 40-turn-timeout decider (§8)
display = max(1, round(total))                 // UI floor only — NOT in the tally
```

**Crit vs Guard vs Brace (intentional):** **Guard** is an active block (Protect analogue) —
crit-immune, consumed by the first landed sub-hit. **Brace** is a stance buff (stat-stage
analogue) — crits pierce it. Active play beats passive stance.

---

## 6. Status effects — stacking, immunity & clamp rules

| Status | Effect |
|---|---|
| **DoT** (burn / bleed) | `round(maxHP × mag)` at end of turn; credited to its applier. |
| **DoT intake cap** | One fighter's total DoT ticks per turn ≤ **15% maxHP** (W234: was 20%); over → every tick scaled proportionally; appliers credited their scaled share. |
| **Stun** | skip your next **action** (flinch model — §7). |
| **ATK up/down** | multiply outgoing damage. |
| **Brace / DEF-up** | damage-taken multiplier; crit-pierced. |
| **Armor-shred** (Sunder/Quake) | multiplies the base-armor divisor term; the anti-tank debuff. |
| **Dodge** (Evade) | avoid chance; cap 50%. |
| **Guard** | halve next landed hit; crit-immune; consumed. |
| **Heal** | restore `maxHP × mag`; no overheal. |
| **Cleanse** (Refuse) | strip own debuffs + DoT + shred, then guard. |

**Unified stacking:** same kind → REFRESH (dur = max, strongest mag; never stacks) · different
kinds in a category → MULTIPLY · clamps always bind: ATK ∈ [0.25, 2.0], taken ∈ [0.40, 2.0],
armor-shred floor 0.40, dodge cap 0.50. One stun at a time (a stun on a stunned target is
wasted; its damage still lands; CD still spent). Same-kind DoT refreshes; burn+bleed coexist
under the intake cap.

---

## 7. Turn order & flow

1. Player picks an off-CD move (or **Struggle** if all four are on CD).
2. Foe AI picks (§7.1).
3. Higher `priority` first; else higher EDGE; within a 3% EDGE band → seeded coin flip.
4. Each side acts in order; a KO before acting skips the victim (priority KO denies the action).
5. End of turn: DoT ticks (capped, credited) → durations decrement → cooldowns tick.

**Stun (flinch model):** if the stunned fighter hasn't acted this turn they lose *this* turn's
action, else *next* turn's; the stun decrements **when the skip occurs**. Acting first makes
your stuns better — an intended EDGE reward.

### 7.1 Foe AI (deterministic tree, seeded rolls)
1. HP < 35% and a heal off-CD: `r < 0.70` → heal.
2. Else HP < 35% and Guard/Brace off-CD: `r < 0.50` → use it (Guard preferred).
3. Else weighted attack (weight ∝ power × acc × hits × typeEff; ×1.5 for a debuff/DoT the
   player lacks). Struggle only when nothing else is available. No cheating; same PRNG.

---

## 8. Win / loss & the timeout rule

**KO:** HP ≤ 0 loses immediately (KO trumps timeout). **Timeout (40 turns):** most total
*effective* damage wins (DoT counts, overkill doesn't); tie → higher HP% → seeded coin.
*(0% timeouts across all sim suites — it's a safety net.)*

---

## 9. Stakes & commit (cosmetic; once)

**Rated fights only** (genuine attempt at your current floor): ELO, W-L, streak, a daily life
on a loss (2/day; forfeiting a rated attempt = a loss), floor advance + titles on a win.
**Unrated rematches commit NOTHING** (no rating/life/W-L/streak/rotation). Rating floors at
the global `ASCENT_RATING_FLOOR = 100`. Never XP / currency / power.

---

## 10. Constants (the tuning knobs)

```
HP_BASE = 40     HP_PER_DEF = 2.2     DEF_SCALE = 60       VARIANCE = ±15% / sub-hit
CRIT_MULT = 1.5  CRIT_PIERCE = 0.5    CRIT_RANGE = 8–28% (edgeShare)
ACC_EDGE_COEF = 0.20   ACC_EDGE_MAXBONUS = 0.08
ATTUNED = 1.15
TYPE_EFF: per-edge map — aggr>trick 1.20/0.83 · trick>sent 1.20/0.83 · sent>aggr 1.08/0.926
MAX_HIT_FRAC = 0.55   MAX_HIT_FRAC_CRIT = 0.75             // move-level anti-one-shot cap
DOT_INTAKE_CAP = 0.15                                       // W234 (was 0.20)
DODGE_CAP = 0.50  ATK_CLAMP = [0.25, 2.0]  TAKEN_CLAMP = [0.40, 2.0]  ARMOR_SHRED_MIN = 0.40
EDGE_TIE_BAND = 3%   STRUGGLE_POWER = 0.5   TURN_CAP = 40   REF_POWER = 100
Stagger CD = 4 (W234, was 3)
```

---

## 11. Early-floor power curve (audited W234 — change PROPOSED, not shipped)

Fresh account (all stats level 1, no gear): ATTACK 2.6 + DEFENSE 2.4 + EDGE 1.6 = **6.6 raw**.
Curve `3.0 × floor^1.05` (boss ×1.18): F1 **3.0 (0.45×)** · F2 **6.2 (0.94×)** · F3 **9.5
(1.44×)** · F4 12.8 (1.95×) · F5 16.3 (2.46×) · F10 boss 39.7 (6.0×). The frontier crosses
player power at **floor ~2–3**, while the first weapon (Rusted Training Blade) is a **D-tier
drop from The Iron Warden** — reachable only at D-rank, realistically days in. An unarmed
fresh account at *equal* power already sits at a 20.8% row mean (§12), so the practical wall
is floor 2–3. **Proposals awaiting product approval (§13.4); no curve change shipped.**

---

## 12. Validation (W234 — final state, ≥10k fights/cell grid · 20k/cell edges, seeded)

### Per-weapon grid (player = matching-arch build + weapon, vs floor foe kits, equal power)
| Weapon (build) | vs Aggr | vs Sent | vs Trick | vs Glass | vs Jugg | Row mean (T1: 55–75%) |
|---|---|---|---|---|---|---|
| Unarmed (bal) | 26.6% | 7.6% | 18.2% | 27.5% | 24.0% | 20.8% ⚠ (progression story — §11/§13) |
| Rusted (bal) | 36.4% | 16.5% | 28.5% | 38.9% | 35.3% | 31.1% ⚠ (no Attuned, starter kit) |
| Titan's (aggr) | 59.6% | 75.7% | 78.8% | 48.1% | 74.2% | **67.3% ✓ in band** |
| Warmaul (sent) | 88.0% | 82.8% | 35.4% | 78.6% | 91.0% | 75.2% ⚠ 0.2 over after its one nerf (flagged) |
| Kilnforged (aggr) | 80.1% | 98.1% | 98.5% | 67.0% | 95.5% | 87.8% 🛑 STOP-reported (§13.1) |
| Step Blade (trick) | 9.1% | 84.8% | 47.6% | 18.1% | 79.4% | 47.8% ⚠ below band (flag-only — §13.3) |
| Vessel (sent) | 93.5% | 71.9% | 18.8% | 71.8% | 100% | **71.2% ✓ in band** (cell flags: 18.8 / 100) |

*vs W233: the trickster column now has teeth (Vessel 99→19, Warmaul 83→35, Unarmed 48→18) and
walls can cleanse — the two structural holes are closed.*

### Type-eff edge contributions — see §3 (Aggr▸Trick +25.2 · Trick▸Sent +19.4 · Sent▸Aggr +22.9)

### Multi-power (T4) & scenarios
0.5× / 1× / 3× REF_POWER: **6.9 / 5.9 / 7.0 turns — all in band, 0% timeouts.** Build
dominance: 2× power wins **100%**. Countered overlevel (Aggr/Titan vs Sentinel): 75.7% @1× →
95.5% @1.15× (the softened edge restores counterplay; was 51% @1× at ±20%).

### Assertions
**In-app `Arena.selfTest()`: 15 checks** — determinism · sanity · move-total cap · accuracy
scale-invariance · shred refresh/multiply/floor · willbreak refresh + focus×temper clamp ·
DoT intake cap + credit · stun flinch · wasted stun · unrated-commits-nothing · **rearmed foe
kits · Refuse cleanses DoT · per-edge mults match the map · reciprocal-pair invariant**.
Offline sim mirror: 10/10 core assertions + the three suites above.

---

## 13. Open items (human calls — none shipped)

1. **🛑 Kilnforged (Patch-2 STOP, both prescribed levers exhausted):** row still >60% in every
   column (80–98%) after foe-kit rearmament AND DOT_INTAKE_CAP 0.15. Note the W234 edge
   softening *helped* Kilnforged vs its sentinel counter (92.6→98.1). Candidate levers for a
   human call: Searing burn 16%→12% · remove Temper from the kit · sentinel/juggernaut AI
   prioritizing Refuse when burning (currently a generic 50% guard roll).
2. **Warmaul 75.2% row mean** after its one prescribed nerf (Stagger CD 4) — 0.2 pts over T1,
   within sampling noise; flagged, no second nerf stacked.
3. **Step Blade 47.8% mean / 9.1% vs Aggressor** — flagged-only per spec (fast kit losing to
   attack-stacked foes is acceptable RPS); watch whether the aggressor cell behaves as a wall
   in live rotation.
4. **Early-floor curve (Patch-5 proposal — APPROVAL REQUIRED, nothing shipped):**
   - **Option A (piecewise ramp):** for floors 1–5, `power = 2.0 + 1.1×(floor−1)` →
     0.30× / 0.47× / 0.64× / 0.80× / 0.97× of fresh power; curve unchanged from F6 (the F5→F6
     step becomes the explicit "earn your first weapon" gate).
   - **Option B (re-anchor):** `_ASCENT_BASE 3.0→1.0`, `_ASCENT_EXP 1.05→1.29` → F1 0.15× /
     F3 0.62× / F5 1.21× / F100 380 ≈ unchanged summit; smooth, softens the mid-tower ~15%.
   - Progression pacing is a product call — pick one (or neither) before any code ships.
5. **Aggr▸Trick edge +25.2** — 0.2 over T3, do-not-touch per review; re-measure after any
   future kit change.
