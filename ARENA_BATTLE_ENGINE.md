# Awakened — Arena Battle Engine (v2.4, as shipped W235)

> **Status:** CANONICAL for the Ascent tower. This documents the engine **as actually
> implemented** in `app.js` (build W235), validated by simulation (§12).
> **v2.4 changelog (W235 — AI v2 utility branches, re-baseline, Option A floor ramp):**
> the W233 AI never cast 0-power moves outside the panic branch — Refuse/Temper/Focus/Evade had
> **zero selection weight**, so the W234 grid measured AI poverty, not balance. AI v2 adds
> CLEANSE / SETUP / EVADE branches (§7.1); everything was re-baselined. **T5** (utility-usage
> band) added to the calibration targets. The Patch-3 Searing lever was applied, measured,
> and **reverted** — it worsened its own target (Searing is shared with the trickster foe kit;
> §13.1). The **Option A early-floor ramp shipped** (anchor 1.0 / slope 0.7 — best-of-tested;
> the approved 2.0/1.1 left fixable power-walls) with the F6 "earn a weapon" cliff + a gate-
> legibility loss line; the remaining ramp misses are **structural** (%maxHP DoT/heals at
> micro-power) and are STOP-reported in §13.4. selfTest is now 18 checks.
> **This is not PvP.** The Arena is a cosmetic, single-player, **bot-only** climb. Duels/PvP
> are permanently retired; `PVP.md` is stale and is **not** a source of truth for this engine.
> **Stack:** one vanilla-JS IIFE (`app.js`); engine pure/DOM-free; localStorage-only
> (`hb_arena_v2`); no backend, no network, no XP/currency/power side effects — ever.

---

## 0. Calibration targets (govern every balance decision)

| Target | Band |
|---|---|
| **T1** | Matched-weapon player vs equal-power floor foe: **row mean ∈ [55%, 75%]** |
| **T2** | Any single cell ∈ [25%, 90%]; outside → flag; full row outside T1 after prescribed levers are exhausted → STOP and report |
| **T3** | Each type-eff edge's measured contribution at equal power ∈ **[+15, +25] win pts** |
| **T4** | Mean fight length ∈ **[4, 10] turns** at 0.5× / 1× / 3× REF_POWER |
| **T5** | Any kit containing utility moves: utility actions = **15–40%** of that side's actions across the mirror sims *(added W235)* |

The matched-weapon baseline is **not 50%** — player rows carry a weapon kit + Attuned vs floor
archetype kits; the gear edge is by design. Upgrade the bots before nerfing player weapons.

---

## 1. Design goals & invariants
1. **Build + tactics, not luck.** 2. **"Floor reached = build strength"** *(2× build wins
100%)*. 3. **Cosmetic only** (`hb_arena_v2`: rating/W-L/streak/floor/titles — never XP/souls/
power). 4. **Your weapon defines your 4 moves**; armor feeds stats/HP. 5. **Deterministic &
testable** — every roll through a seeded mulberry32 (`sess.rng`); no `Math.random`.

---

## 2. The combatants

| Role | Formula | Combat job |
|---|---|---|
| **ATTACK** | `STR×1.6 + FOCUS` | damage output |
| **DEFENSE** | `VIT×1.4 + WILL` | HP pool AND per-hit mitigation |
| **EDGE** | `INT×1.6` | crit, turn order, accuracy |

`maxHP = max(20, round(40 + DEFENSE × 2.2))`. Player roles = live stats + armor; foe roles =
floor power split by archetype weights (sum 3). Archetype: `balanced` (no role ≥40%) · dominant
role → `aggressor`/`sentinel`/`trickster` · ≥52% → `glasscannon`/`juggernaut`.

---

## 3. Type effectiveness (symmetric, per-edge)

Triangle **Aggressor ▸ Trickster ▸ Sentinel ▸ Aggressor**; reciprocal pairs (1+s, 1/(1+s));
computed per direction. Per-edge map `_ARENA_EFF_EDGES`:

| Edge | Multipliers | Measured (W235 baseline; T3 +15..+25) |
|---|---|---|
| Aggressor ▸ Trickster | 1.20 / 0.83 | **+26.4** ⚠ (do-not-touch per review; flagged) |
| Trickster ▸ Sentinel | 1.20 / 0.83 | **+24.8** ✓ |
| Sentinel ▸ Aggressor | 1.08 / 0.926 | **+22.8** ✓ |

---

## 4. Weapons, moves & foe kits

### 4.1 Player weapons (Attuned ×1.15 when weapon matches your archetype)
| Weapon | Moveset | Attuned |
|---|---|---|
| (Unarmed) | Jab · Hook · Guard · Focus | none |
| Rusted Training Blade | Slash · Lunge · Guard · Focus | none |
| Titan's Oathblade | Cleave · Sunder · Brace · Oathstrike | Aggr / Jugg |
| Hammerfall Warmaul | Crush · Stagger · Brace · Quake | Sentinel |
| Kilnforged Warblade | Searing Cut · Ember · Temper · Immolate | Aggressor |
| Ten-Thousand Step Blade | Flurry · Quickstep · Evade · Thousand Cuts | Trick / Glass |
| Vessel of Refusal | Ward Strike · Refuse · Willbreak · Last Vow | Sentinel |

### 4.2 Foe kits (all six; unchanged from W234)
Aggressor: Cleave·Sunder·Slash·Focus · Glass-Cannon: Oathstrike·Cleave·Slash·Temper ·
Sentinel: Slash·Brace·**Refuse**·Ward Strike · Juggernaut: Crush·Brace·**Refuse**·Quake ·
Trickster: Flurry·Quickstep·Evade·Searing Cut · Balanced: Slash·Guard·Focus·Lunge

### 4.3 Move table — unchanged from v2.3 (W234): Stagger CD 4 · Ember CD 1 · Immolate 16%×2 ·
**Searing Cut 16%×3 (the W235 12% lever was applied, measured, REVERTED — §13.1)** · Struggle
0.5 fallback (both sides).

### 4.4 Floor archetype rotation
Regular floors: `['aggressor','sentinel','trickster'][(floor + wins + losses) % 3]` — advances
per committed rated attempt; bosses fixed. Matchup-shopping costs lives + ELO.

---

## 5. The damage pipeline — unchanged from v2.3
```
baseAtk = ATTACK × atkStatusMult × attunedMult ; typeEff per edge (§3)
accuracy = min(0.99, move.acc + min(0.08, edgeShare × 0.20))
per sub-hit: miss/dodge guards intact → crit = rng < clamp(0.08+edgeShare×0.40, .08, .28)
  defEff = DEF_base × armorShred × (crit ? 0.5 : 1)
  hit = baseAtk × power × typeEff / (1 + defEff/60)
  crit: ×1.5, skips takenMult · else ×clamp(takenMult, .40, 2.0)
  ×(1 ± 0.15) · Guard halves first landed sub-hit (crit-immune active block)
total = min(Σ, (anyCrit ? .75 : .55) × maxHP)   // move-level anti-one-shot cap
effective (≤ remaining HP) → dmgDealt tally; display floor max(1,…) is UI-only
```
Guard = active block (crit-immune, consumed); Brace = stance (crit-pierced). Intentional.

---

## 6. Status effects — unchanged from v2.3
DoT end-of-turn (refresh-by-kind; burn+bleed coexist; **intake cap 15% maxHP/turn**, scaled
proportionally, appliers credited); stun = flinch (skip next action; decrements on the skip;
wasted on a stunned target); unified stacking (same kind refresh / different kinds multiply /
clamps bind: ATK [0.25,2.0], taken [0.40,2.0], shred ≥0.40, dodge ≤0.50); heals never overheal.

---

## 7. Turn order & flow
Priority first; else higher EDGE; ≤3% EDGE gap → seeded coin. KO before acting skips. End of
turn: DoT ticks → durations → cooldowns.

### 7.1 AI v2 (W235 — one tree for live foes AND both sim sides; strict priority, seeded p's)
> The W233 tree weighted only damaging moves, so 0-power moves outside the panic branch were
> **never cast** — walls had a cleanse they never pressed. AI v2:
1. **CLEANSE** — own incoming DoT ≥ 8% maxHP/turn AND a cleanse off CD → p **0.90**.
2. **EMERGENCY** — HP < 35%: heal → p **0.70**; else Guard/Brace (Guard first) → p **0.70**
   *(0.50→0.70 after the two T5 iterations)*.
3. **SETUP** — no ATK-up active AND one off CD AND self ≥60% AND foe ≥70% → p **0.60**.
4. **EVADE** — Evade off CD AND dodge not active AND self HP ∈ [35%, 70%) → p **0.40→0.60**
   *(T5 iterations)*.
5. **WEIGHTED ATTACK** — weight ∝ power × acc × hits × typeEff, ×1.5 for a debuff/DoT the
   opponent lacks. Struggle only when nothing is legal.

**T5 outcome (fix-at-closest, residuals reported):** in-band — Unarmed 29.9 · Rusted 29.5 ·
Kiln 20.0 · Vessel 27.5 · Aggr-foe 20.2 · Glass-foe 23.4 · Jugg-foe 30.6. **Below band
(condition-bound — Brace/Evade live in HP windows that winning kits rarely occupy):** Titan
9.8 · Warmaul 14.1 · Step 14.6 · Sentinel-foe 8.9 · Trickster-foe 13.3. No new branches
invented per the rule.

---

## 8. Win / loss & timeout — unchanged
KO immediate; 40-turn timeout → most effective damage (DoT counts, overkill doesn't) → HP% →
coin. 0% timeouts in all suites.

## 9. Stakes & commit — unchanged
Rated only: ELO, W-L, streak, a daily life on loss (forfeit = loss), floor/titles. Unrated
rematches commit nothing. Rating floor 100. Cosmetic forever.

---

## 10. Constants
```
HP_BASE 40 · HP_PER_DEF 2.2 · DEF_SCALE 60 · VARIANCE ±15% · CRIT 1.5 / pierce 0.5 / 8–28%
ACC_EDGE_COEF 0.20 · ACC_EDGE_MAXBONUS 0.08 · ATTUNED 1.15
EDGES: aggr>trick 1.20/0.83 · trick>sent 1.20/0.83 · sent>aggr 1.08/0.926
HIT CAPS (move-level) 0.55 / 0.75 · DOT_INTAKE_CAP 0.15 · DODGE_CAP 0.50
CLAMPS atk [0.25,2.0] · taken [0.40,2.0] · shred ≥0.40 · Stagger CD 4 · Struggle 0.5
AI v2: cleanse p .90 · heal p .70 · guard p .70 · setup p .60 · evade p .60
TURN_CAP 40 · EDGE_TIE 3% · REF_POWER 100
FLOOR RAMP (W235): F1–F5 = 1.0 + 0.7×(f−1)  → 1.0 / 1.7 / 2.4 / 3.1 / 3.8 raw
                   F6+ = 3.0 × f^1.05 (boss ×1.18)  → F6 ≈ 19.7 (the weapon-gate cliff)
```

---

## 11. The early-floor gate (W235, Option A shipped)

Fresh account = 6.6 raw. Ramp ratios: F1 0.15× … F5 0.58×; **F6 = 2.98×** — a deliberate
cliff: the **"earn your first weapon" gate**. The Rusted Training Blade drops from **The Iron
Warden** (D-rank dungeon boss) — obtainable independent of the tower (no circular dependency →
gate ALIGNED), realistically days 1–3. **Gate legibility:** a rated F6 loss with no weapon
equipped shows *“The tower answers strength. The Iron Warden guards a blade.”*
**Honest reality (§13.4):** at default stats even WITH the blade, F6 ≈ 2–4% — the gate in
practice = blade + stat growth, and trickster-rotation floors burn fresh accounts down at any
ramp value. Structural; reported, not papered over.

---

## 12. Validation (W235 final state — grid 10k/cell · edges 20k/cell · seeded)

### Per-weapon grid (AI v2, final constants)
| Weapon | Aggr | Sent | Trick | Glass | Jugg | Row mean (T1 55–75) | Util (T5 15–40) |
|---|---|---|---|---|---|---|---|
| Unarmed | 29.9 | 5.1 | 14.9 | 34.9 | 14.6 | 19.9 ⚠ (progression — §11) | 29.9 ✓ |
| Rusted | 38.0 | 10.4 | 20.5 | 45.7 | 22.3 | 27.3 ⚠ (starter) | 29.5 ✓ |
| Titan's | 72.0 | 74.8 | 74.5 | 64.8 | 69.8 | **71.2 ✓** | 9.8 ⚠ |
| Warmaul | 91.2 | 81.2 | 38.0 | 83.8 | 88.2 | 76.5 ⚠ (1.5 over; nerf spent) | 14.1 ⚠ |
| Kilnforged | 75.2 | 99.2 | 87.5 | 57.8 | 88.4 | 81.6 🛑 (§13.1) | 20.0 ✓ |
| Step Blade | 22.0 | 75.9 | 40.1 | 42.0 | 70.7 | 50.2 ⚠ (below) | 14.6 ⚠ |
| Vessel | 94.7 | 74.4 | 30.1 | 74.3 | 100 | **74.7 ✓** | 27.5 ✓ |

vs W234: the AI fix alone moved Titan 67→71, Kiln 88→82, Step's worst cell 9→22, and walls
now cleanse. **T4:** 7.4 / 6.5 / 7.6 turns at 0.5×/1×/3× — in band, 0% timeouts. 2× power:
100%. Countered Aggr/Titan vs Sentinel: 74.8% @1×.

### Fresh-account ramp (shipped 1.0/0.7; natural rotation at attempts=0)
| Floor | Power | vs Aggr | vs Sent | vs Trick | Natural arch |
|---|---|---|---|---|---|
| F1 | 1.0 | 100 | 100 | 0.1 | sentinel → **100 ✓** |
| F2 | 1.7 | 100 | 100 | 0.1 | trickster → **0.1 ✗** |
| F3 | 2.4 | 100 | 100 | 0.1 | aggressor → 100 ✓ |
| F4 | 3.1 | 100 | 100 | 0.0 | sentinel → 100 ✓ |
| F5 | 3.8 | 98.8 | 100 | 0.0 | trickster → **0.0 ✗** |
| F6 | 19.7 | 0.0 | 0.0 | 0.0 | weaponless ≤40 ✓ · **with blade 1.7–4.4 ✗ (target ≥55)** |

### Assertions
**In-app `Arena.selfTest()`: 18 checks** (15 prior + W235: wall-AI cleanses DoT · kiln-AI
Tempers · step-AI Evades at mid-HP). Sim mirror: suites above + utility counters.

---

## 13. Open items (human calls — nothing improvised)

1. **🛑 Kilnforged (Patch-3 STOP + a coupling finding):** row mean 81.6 at the AI-v2 baseline.
   The prescribed Searing 16→12 lever was applied and **made it WORSE (82.0)** — Searing is
   shared with the **trickster foe kit**, so nerfing it weakens the strongest anti-Kiln column
   (and pushed Warmaul 76.5→78.0, Vessel 74.7→76.5). Lever **reverted**. Candidates needing a
   ruling: a Kiln-only Searing variant (decouple player/foe move tables) · remove Temper from
   the Kiln kit · wall-AI cleanse-priority when burning is already p 0.90 (maxed).
2. **T5 residuals (condition-bound):** Titan 9.8 · Warmaul 14.1 · Step 14.6 · Sentinel-foe 8.9
   · Trickster-foe 13.3 after both p-iterations (guard 0.70, evade 0.60 fixed-at-closest).
   Brace/Evade are gated to HP windows that winning kits rarely occupy. A proactive-Brace or
   opener-Evade branch would fix it — **new branches are out of scope per the rule.**
3. **Warmaul 76.5** (nerf spent, 1.5 over T1) · **Step row 50.2** (below T1; its worst cell
   healed 9.1→22.0) · **Aggr▸Trick edge +26.4** (do-not-touch) — all flagged, no action.
4. **🛑 Ramp (Patch-5c STOP — structural, with the full iteration record):** tested 2.0/1.1,
   1.4/0.9, 1.0/0.7 (shipped best-of-tested). Power-bound cells fixed (F4 sent 3.6→100, F5
   aggr 1.0→98.8). **Unfixable by ramp constants:** (a) trickster floors ≈ 0% at EVERY power —
   Searing burns 16% of the PLAYER's maxHP/turn, power-independent, while a fresh account
   needs 15+ turns to kill anything; (b) F6-with-blade 1.7–4.4% vs ≥55 — the blade alone is
   12.4 raw vs 19.7. **Candidates for the next ruling:** exclude trickster from the F1–5
   rotation pool · scale DoT/heal magnitudes by foe power below a power floor · re-spec the F6
   target as blade + D-rank-typical stats (≈19+ raw, which sims ≥55).
