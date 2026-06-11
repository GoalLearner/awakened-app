# Awakened — Arena Battle Engine (v2.6, as shipped W237) — FINAL SIM-TUNED BASELINE

> **Status:** CANONICAL for the Ascent tower. This documents the engine **as actually
> implemented** in `app.js` (build W236), validated by simulation (§12).
> **v2.6 changelog (W237 — clean-edge retune, T2-primary calibration, Vessel tempo lever,
> tiered ramp kits):** T3 was a **contaminated instrument** — it measured multiplier-effect
> PLUS kit asymmetry; the new methodology is kit-neutral (both sides Rusted kit, stat shapes
> only). Clean numbers: AT +5.9 (was reading +26.4 — almost all kit asymmetry; band
> ceiling-bound/unreachable, flagged), TS retuned 1.20→**1.18** (+20.3 clean ✓), SA 1.08
> survives clean (+19.5 ✓). **Calibration hierarchy inverted:** T2 cell bounds [25, 90] are
> PRIMARY; T1 row mean secondary with a documented (75, 79] identity-weapon acceptance zone.
> Levers: Vessel Willbreak dur 3→2 (ships; Ward-heal lever reverted — worsened target, shares
> a table with sentinel foes), Warmaul Crush 1.7→1.55 (ships; 90.5 residual flagged). **Tiered
> foe kits:** F4–F5 tricksters carry a lesser kit (no Searing) — the ramp passes EVERY target.
> selfTest → 26 checks.
> **Design principles (locked):** shared move tables are ONE balance surface — never fork
> per-side variants of a shared MOVE; kit COMPOSITION may vary by floor tier (content design).
> **This is not PvP.** The Arena is a cosmetic, single-player, **bot-only** climb. Duels/PvP
> are permanently retired; `PVP.md` is stale and is **not** a source of truth for this engine.
> **Stack:** one vanilla-JS IIFE (`app.js`); engine pure/DOM-free; localStorage-only
> (`hb_arena_v2`); no backend, no network, no XP/currency/power side effects — ever.

---

## 0. Calibration targets (REVISED W237 — hierarchy inverted)

**T2 is PRIMARY; T1 is secondary.** Rationale (one-time, reasoned revision): row-mean
enforcement drove identity-degrading nerf chains while guaranteed-win cells (100%/95% matchups
— the real player-facing failure) went untracked. No near-guaranteed matchups is the harder,
more meaningful constraint.

| Target | Band | Rank |
|---|---|---|
| **T2** | every cell ∈ **[25%, 90%]** (automated scan in every grid run) | **PRIMARY** |
| **T1** | row mean ∈ [55%, 75%]; **(75, 79] = documented acceptance zone** for identity weapons that are T2-clean | secondary |
| **T3** | each edge's **kit-neutral** contribution ∈ [+15, +25] (W237 methodology: both sides Rusted kit, stat shapes only, live vs TYPE_EFF=1) | guard |
| **T4** | fight length ∈ [4, 10] turns at 0.5×/1×/3× REF | guard |
| **T5** | utility 15–40% per utility-carrying kit (telemetry; AI frozen) | report-only |

A weapon **passes** when T2-clean AND row mean ≤ 79. The matched-weapon baseline is not 50% —
the player's gear edge is by design; upgrade bots before nerfing weapons.

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

## 3. Type effectiveness (symmetric, per-edge; CLEAN-measured as of W237)

Triangle **Aggressor ▸ Trickster ▸ Sentinel ▸ Aggressor**; reciprocal pairs (1+s, 1/(1+s));
computed per direction. **The instrument finding (W237):** v2.3–v2.5 edge values were tuned
against a contaminated reading — old "Suite B" used archetype KITS, so it measured multiplier
× kit-asymmetry. Cauterize exposed it (TS read +40.4 with the dial untouched). The clean
methodology: both sides Rusted kit, archetype stat shapes, equal power.

| Edge | Multipliers | Contaminated read | **CLEAN read (T3 +15..+25)** |
|---|---|---|---|
| Aggressor ▸ Trickster | 1.20 / 0.83 | +26.4 | **+5.9 — ceiling-bound** (flat is already 93.5% on stat shape alone; max possible ≈ +6.5; 3 iterations gained ≤0.2 → fixed at 1.20, flagged UNREACHABLE) |
| Trickster ▸ Sentinel | **1.18 / 0.847** *(W237 retune)* | +40.4 | **+20.3 ✓** (1 iteration) |
| Sentinel ▸ Aggressor | 1.08 / 0.926 | +22.8 | **+19.5 ✓** (W234 value survives clean measurement) |

Deep finding: trickster-shape LOSES to sentinel-shape ~98:2 on stats alone — the TS triangle
direction exists almost entirely via the multiplier + the trickster KIT, not the stat shape. Weapons, moves & foe kits

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

### 4.3 Move table changes vs v2.3: Stagger CD 4 · Ember CD 2 · Thousand Cuts 0.45 ·
**Willbreak duration 2 (W237 Vessel tempo lever)** · **Crush power 1.55 (W237 Warmaul
lever)** · Immolate 16%×2 · Searing 16%×3 (W235 12% lever reverted — shared table). Struggle
0.5 (both sides).

### 4.3b Tiered foe kits (W237)
**F4–F5 tricksters carry the lesser kit Flurry / Quickstep / Evade / Slash** (no Searing);
the full kit (with Searing) debuts at F6+, after the blade gate. Early-route trainers don't
carry Toxic. Kit composition by floor tier is content design (bosses already do it) — move
definitions never fork.

### 4.4 Floor archetype rotation
Regular floors rotate per committed rated attempt; bosses fixed. **W236: floors 1–3 draw from
[aggressor, sentinel] only** (onboarding — a fresh weaponless account has no answer to DoT);
the full triangle resumes at F4+. Matchup-shopping costs lives + ELO.

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

## 6. Status effects

DoT end-of-turn (refresh-by-kind; burn+bleed coexist; **intake cap 15% maxHP/turn**, scaled
proportionally, appliers credited); stun = flinch (skip next action; decrements on the skip;
wasted on a stunned target); unified stacking (same kind refresh / different kinds multiply /
clamps bind: ATK [0.25,2.0], taken [0.40,2.0], shred ≥0.40, dodge ≤0.50); heals never overheal.

**Cauterize (W236):** when a cleanse resolves (Refuse — and any future cleanse), the caster
gains **dotImmune for 2 turns** (standard timed-flag taxonomy: same-kind refresh, end-of-turn
decrement, CAUTERIZED chip). While immune, NEW DoT applications are wasted (the applying
move's direct damage still lands, like stun-on-stunned). A pre-emptive Refuse with nothing to
cleanse still grants immunity — legitimate tactics. *Rationale:* cleanse lost the action
economy 1-for-2 — Refuse (CD 2) removed what one CD-1 action instantly reapplied, and the
reapplier also dealt direct damage; immunity fixes the tempo war instead of nerfing kits.

**DoT power-scaling (W236):** at application, stored magnitude =
`move.dotMag × clamp(applierPower / targetPower, 0.5, 1.0)` (power = ATTACK+DEFENSE+EDGE).
Ceiling 1.0: over-powered appliers gain nothing (DoT already scales with the target's pool).
Floor 0.5: DoT never vanishes — it remains the wall-counter at parity. The intake cap applies
AFTER scaling. Heals are untouched (% of the caster's own pool — already power-scaled).

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

**AI v2 is FROZEN as of W236** (no branch/condition/p changes; T5 residuals accepted as condition-bound). **T5 outcome (fix-at-closest, residuals reported):** in-band — Unarmed 29.9 · Rusted 29.5 ·
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

## 12. Validation (W237 / v2.6 FINAL SIM BASELINE — grid 10k/cell · edges 20k/cell · seeded)

### Per-weapon grid (clean edges + all fired levers) — T2 scan is permanent grid output
| Weapon | Aggr | Sent | Trick | Glass | Jugg | Row mean | T2 scan |
|---|---|---|---|---|---|---|---|
| Unarmed | 29.9 | 5.1 | 14.9 | 34.9 | 18.0 | 20.6 (progression) | sent/trick/jugg < 25 (gate story §11) |
| Rusted | 38.0 | 10.4 | 20.5 | 45.7 | 27.2 | 28.3 (starter) | sent/trick < 25 (gate story) |
| Titan's | 72.0 | 74.8 | 74.5 | 64.8 | 75.4 | **72.3 ✓ PASS** | **clean** |
| Warmaul | 90.5 | 75.4 | 36.0 | 83.8 | 89.6 | **75.1 (zone] ** | aggr 90.5 🛑 (0.5 over after Crush 1.55 — STOP-flagged) |
| Kilnforged | 75.2 | 94.6 | 87.5 | 57.8 | 82.3 | 79.5 | sent 94.6 🛑 (STOP — §13.1) |
| Step Blade | 28.3 | 81.1 | 48.1 | 51.2 | 78.2 | **57.4 ✓ PASS** | **clean** |
| Vessel | 89.1 | 63.4 | 60.5 | 65.4 | 100 | **75.7 (zone]** | jugg 100 🛑 (STOP — §13.2) |

**T4:** 7.4 / 6.5 / 7.6 turns ✓ (balanced kits unaffected by levers). **T5 (report-only,
AI frozen):** Titan 9.8 · Warmaul 14.5 · Step 14.8 below; others in band.

### Fresh-account ramp (tiered kits) — ALL TARGETS PASS
| Floor | Natural arch → win% | Trickster cell |
|---|---|---|
| F1–F3 | 100 ✓ (pool aggr/sent) | n/a (excluded) |
| F4 | 100 ✓ | **100 ✓ (lesser kit)** |
| F5 | trickster → **100 ✓ (lesser kit)** | 100 ✓ |
| F6 gate | weaponless 0 (≤40 ✓) · fresh+blade 1.7–4.4 (≤25 ✓) · D-rank+blade 92.9–100 (≥55 ✓) | full kit debuts |

F1 ≥80 ✓ · every F1–F5 ≥55 ✓ · monotonic ✓ · no fallback exclusion needed.

### Assertions
**In-app `Arena.selfTest()`: 26 checks** (24 prior + W237: tiered trickster kits ·
lever-constant verification incl. the TS reciprocal pair). Sim mirror: clean-edge T3 harness
(seeded) + the automated T2 scan in every grid run.

---

## 13. Open items after v2.6 (for the ON-DEVICE phase — sim tuning is closed)

1. **🛑 Kilnforged — STOP, human call with numbers:** clean-edge baseline row 79.5 (zone-edge;
   drifted +0.8 from the Crush lever weakening jugg foes), sent cell **94.6 > 90** (T2-primary
   violation). Lever ladder exhausted (4 fired levers + 1 reverted across W234–W236). The
   sent cell is the wall-breaker identity expressing against a cleanse the AI casts at p 0.90
   max. Options for the ruling: accept as the wall-breaker exception · a sentinel-AI
   cleanse-priority rework (currently frozen) · on-device data first (recommended by the
   final-baseline framing).
2. **🛑 Vessel vs Juggernaut 100% — STOP after lever 1:** Willbreak-2 shipped (row 82.8→75.7,
   aggr cell fixed); the Ward-heal lever REVERTED (worsened the row 75.7→78.1 — Ward Strike
   is shared with sentinel foes — and left jugg at 100). Structural: a sustain kit cannot lose
   to a slow bruiser that can't out-damage its heal loop. Candidates: juggernaut foe-kit
   armor-shred priority · accept (juggernaut floors are 1-in-3 rotation slots).
3. **🛑 Warmaul aggr cell 90.5** (0.5 over) after its Crush lever — within noise of the bound;
   flagged, not chased ("document and stop").
4. **Aggr▸Trick edge: T3 band UNREACHABLE** (ceiling-bound at ≈ +6.5 — the stat-shape
   asymmetry IS the matchup). Fixed at 1.20/0.83. Any future change is a stat-shape
   (archetype-weights) question, not a multiplier question.
5. **Accepted/documented:** Warmaul row 75.1 + Kiln row 79.5 in/near the (75,79] zone ·
   T5 residuals condition-bound (AI frozen) · unarmed/rusted rows = the §11 gate story.

---

## 14. Closing — v2.6 is the final sim-tuned baseline

Sim-side tuning is **closed** as of W237. The remaining 🛑 items are deliberately parked:
every further balance change requires **on-device play data** (real player builds, real move
choices, real session lengths — none of which the AI-vs-AI mirror can supply). The next
balance commit after W237 must cite on-device evidence, not simulation.