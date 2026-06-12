# Awakened — Arena Battle Engine (v2.7, as shipped W260) — ENDGAME AI TIERS ON THE v2.6 BASELINE

> **Status:** CANONICAL for the Ascent tower. This documents the engine **as actually
> implemented** in `app.js` (build W260), validated by simulation (§12, §12-W260).
> **v2.7 changelog (W260 — the FIRST sanctioned engine change since the v2.6 freeze;
> strictly ADDITIVE):** endgame AI tiers F51+ (§7.2: INSTINCT/TACTICIAN/STRATEGIST/APEX,
> fair-play charter, sanitized no-RNG decision state, v2-fallback safety) + down-to-the-wire
> presentation (§7.3: clutch mode, last-stand beats, DEAD-EVEN framing, tier telegraphs —
> presentation ONLY, outcomes pure). **F1–50 is BIT-IDENTICAL to v2.6** (4-fight seeded gate,
> byte-for-byte, run twice). AI v2 (§7.1) remains frozen — it IS tier 2. selfTest → **37**
> checks (T26–T36). Measurement: §12-W260 (margin study · tier deltas · on-curve guardrail).
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

### 4.5 Move → users index (CHECK BEFORE ANY LEVER — added per the playtest protocol)
Every lever this series that misfired (Searing W235, Ward Strike W237, Crush side-effects
W237) hit a SHARED move. Single-user moves are safe levers; shared moves cut both ways.

| Move | Used by | Lever safety |
|---|---|---|
| Jab, Hook | Unarmed | safe |
| Thousand Cuts | Step Blade | safe |
| Ember, Immolate | Kilnforged | safe |
| Stagger | Warmaul | safe |
| Willbreak, Last Vow | Vessel | safe |
| Searing Cut | Kilnforged · Trickster-foe (F6+ kit) | **shared** (W235 revert) |
| Ward Strike | Vessel · Sentinel-foe | **shared** (W237 revert) |
| Crush | Warmaul · Juggernaut-foe | **shared** (W237 side-effects) |
| Quake | Warmaul · Juggernaut-foe | **shared** |
| Cleave | Titan's · Aggressor-foe · Glass-foe | **shared** |
| Sunder | Titan's · Aggressor-foe | **shared** |
| Oathstrike | Titan's · Glass-foe | **shared** |
| Slash | Rusted · Aggr/Glass/Sentinel/Balanced-foe · Trickster-lesser (F4–5) | **shared (widest)** |
| Lunge | Rusted · Balanced-foe | **shared** |
| Flurry, Quickstep, Evade | Step Blade · Trickster-foe (both tiers) | **shared** |
| Guard | Unarmed · Rusted · Balanced-foe | **shared** |
| Brace | Titan's · Warmaul · Sentinel-foe · Juggernaut-foe | **shared** |
| Focus | Unarmed · Rusted · Aggressor-foe · Balanced-foe | **shared** |
| Temper | Kilnforged · Glass-foe | **shared** |
| Refuse | Vessel · Sentinel-foe · Juggernaut-foe | **shared** |
| Struggle | universal fallback (both sides) | engine constant |

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

### 7.2 Endgame AI tiers (W260, v2.7 — first sanctioned engine change since the freeze; ADDITIVE)

**The ladder** (`aiTierFor(floor)`; the session is tagged at `arenaStartBattle`):

| Floors | Tier | Name | Brain |
|---|---|---|---|
| 1–50 | 2 | INSTINCT | AI v2 (§7.1) — the frozen path, **bit-identical** |
| 51–70 | 3 | TACTICIAN | shared discipline prefix → best expected (damage + effect value) |
| 71–90 | 4 | STRATEGIST | + one-ply expectimax + cooldown counter-timing (hold-only) |
| 91–100 | 5 | APEX | + move-dependent second ply + habit adaptation (last ~6 player picks) |

**Fair-play charter (enforced in code; pinned by selfTest T32):** tiered brains see ONLY
`_aiSanitizedState(sess)` — plain data a human reads off the screen (HP, statuses with
durations, cooldowns, both kits, type-eff, crit/accuracy odds, recent player picks). **NO rng
access** on any tiered decision path — probabilistic discipline branches hash the VISIBLE
state (`_aiHash01`), so identical states always make identical choices. Any tiered-brain
exception falls back to the exact v2 path (a live fight can never crash from a brain bug).

**Shared discipline prefix (all tiers ≥3):** lethal check (highest-accuracy expected kill) →
cleanse at ≥8%/turn intake (never wasted on trivial DoTs) → emergency heal p.85 with
NO-OVERHEAL + Guard/Brace fallback p.5 (under 35% HP) → punish-gated setup (only when no
visible threat reaches 33% of own HP) → evade discipline. Higher tiers upgrade ONLY the
attack selection after this prefix — the ladder is monotonic by construction.

**Valuation layer (`_aiEffectValue`, sim-tuned W260):** no-stack gates (guard / defUp /
dodge / atkUp / atkDown / defDown are worth ~0 while the same state is already active) and a
×0.7 tempo discount on pure defense (a defending turn deals no damage in a
damage-decides-timeouts meta). These two gates made the ladder monotonic: without them the
greedy brains turtle (Brace/Refuse priced at full mitigation value every turn) and LOSE to
v2's attacking mix — measured, fixed, re-measured.

**Counter-timing (`_aiTimingBonus`, HOLD-ONLY):** when the foe's nuke returns next turn and a
defensive move would still be cooling, hold it (−0.12 × nuke damage, threat-gated ≥30% of
maxHP). The positive "defend now" branch was sim-proven harmful (it tipped Ward Strike →
Brace — pure tempo loss) and removed: smart timing is *not wasting* defense, not defending more.

**PROHIBITION (locked):** no HP-state-conditional engine rules, no prediction-conditional
rules, no RNG on tiered decision paths, no reading the player's queued move. The tiers know
nothing a human opponent couldn't. **When an AI behavior is ambiguous, choose the version
that loses to a SMARTER human, never the one that wins by knowing more.**

### 7.3 Down-to-the-wire presentation (W260 Patch 2 — presentation ONLY)

**No rubber-banding, no DDA. Outcomes are pure; drama is presentation.** The engine decides
the fight; this layer only changes pacing, light, and sound:

- **Clutch mode** — both meters ≤30%: beat holds +20%, heartbeat loop (synth lub-dub; file
  slot `sfx_heartbeat` overrides when generated), pulsing crimson vignette + HP-bar pulse.
  Engages once, persists to the KO (a wire fight stays a wire fight).
- **Last-stand beat** — a fighter crosses into 1–10% HP: one audio-ducked blocking line per
  fighter per fight ("…staggers — one clean hit ends this!" / "You steady yourself…").
- **DEAD EVEN framing** — VS and boss-intro screens show a pulsing "DEAD EVEN · this one
  goes to the wire" banner when the prediction sits in the 48–52% band (`_arWireBand`).
- **Telegraphs** — the foe splash names the brain (`· TACTICIAN ·` etc., floors 51+); the
  current-floor and boss cards carry a `⚠ <TIER>-CLASS FOE · KNOWN MOVES` scouting row
  showing the foe's TRUE kit (the one the engine actually plays — bosses included).

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

## 12-W260. Measurement (v2.7) — margin study · tier deltas · on-curve guardrail

**Bit-identity gate (F1–50):** four seeded fights (two real-profile F47, two synthetic
even-power) captured pre-patch, hash-compared post-patch — **byte-identical, run twice**
(after the engine block; again after the brain restructure + valuation finalization). Tier
mapping verified: 47:2 · 50:2 · 51:3 · 70:3 · 71:4 · 90:4 · 91:5 · 100:5.

**Margin study (10k/band, v2 proxy both sides)** — wire finishes are natural; clutch
amplifies, never fabricates:

| Prediction band | winner median HP | q25–q75 | median turns |
|---|---|---|---|
| 45–48% | 23.4% | — | 6 |
| **48–52% (the wire)** | **23.3%** | 11.3–42.5% | 6 |
| 52–55% | 24.0% | — | 6 |
| 60–70% | 40.6% | — | — |
| 80%+ | 77.0% | — | — |

STOP-check: even-band median winner HP **23.3% ≤ ~35% → PASS** (the wire is already real).

**Tier deltas (10k/cell, equal power; numbers are PLAYER win rate vs the tiered foe):**

| Foe tier | bal/bal | agg/sen | sen/agg | mean | vs INSTINCT |
|---|---|---|---|---|---|
| 2 INSTINCT | 49.9% | 37.4% | 61.9% | 49.7% | — |
| 3 TACTICIAN | 28.9% | 29.5% | 57.9% | 38.8% | **−10.9 pts** |
| 4 STRATEGIST | 28.9% | 29.5% | 57.9% | 38.8% | −10.9 pts |
| 5 APEX | 28.8% | 30.1% | 57.9% | 38.9% | −10.8 pts |

**Finding (reported honestly, not tuned away):** brain strength SATURATES against a
weighted-random proxy at the Tactician jump. Strategist/Apex faculties (counter-timing,
sequencing, habit adaptation) are ANTI-EXPLOITATION features — they express against
patterned human play, which a random proxy cannot model. The ladder is monotonic (no tier
measurably weaker than a lower one; Apex's +0.6 in one cell is its deliberate defensive
habit-read, ≈1.3σ). The one big honest difficulty jump lands exactly where the tower
announces it: floor 51.

**On-curve guardrail (6k/cell/build; player power == floor power; titan/warmaul/step builds
vs the floor's rotation foe; v2 column = same cells against the INSTINCT brain):**

| Floor (arch) | Tier | tiered mean | v2 mean | tier adds |
|---|---|---|---|---|
| F55 (sent) | 3 | 59.4% | 61.9% | −2.6 |
| F60 (aggr) | 3 | 55.4% | 66.7% | −11.3 |
| F70 (sent) | 3 | 33.7% | 43.2% | −9.5 |
| F75 (aggr) | 4 | 55.3% | 66.5% | −11.1 |
| F85 (sent) | 4 | 32.4% | 41.8% | −9.4 |
| F90 (aggr) | 4 | 61.5% | 64.5% | −3.0 |
| F95 (tric) | 5 | 31.5% | 55.9% | −24.4 |
| F100 (sent) | 5 | 12.8% | 24.6% | −11.8 ⚠ |

Guardrail: **no cell drops below 30% because of the tiers.** ⚠ **F100 was already below 30%
at v2 (24.6%)** — a pre-existing curve conversation, reported here, NOT silently retuned.
F95 carries the largest tier delta (an Apex trickster is brutal) but stays above the line.
Context for all cells: the proxy picks moves at weighted random — real humans pick
intelligently, so true on-curve player win rates sit ABOVE every number in this table.

selfTest: **37/37** — T26 tier ladder · T27 lethal · T28 no-overheal · T29 cleanse
discipline · T30 counter-timing hold · T31 apex habit tracking · T32 sanitized-no-RNG ·
T33 brain-legality sweep · T34 clutch predicate · T35 last-stand crossing · T36 wire band +
telegraph names.

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

**W260 addendum:** the endgame AI tiers (§7.2) were the first sanctioned change since this
freeze — strictly additive, F1–50 bit-identical, AI v2 untouched (it IS tier 2), measured in
§12-W260. The freeze on v2.6's BALANCE surfaces (moves, edges, pipeline, calibration) remains
in force; the F100 on-curve flag (§12-W260) is the standing curve conversation for the
on-device phase.