# Awakened — Arena Battle Engine (v2.2, as shipped W233)

> **Status:** CANONICAL for the Ascent tower. This documents the engine **as actually
> implemented** in `app.js` (build W233), with every constant validated by simulation (§11).
> **v2.2 changelog (W233, external review patch):** the anti-one-shot cap now binds on the
> **move total** (multi-hit moves could previously stack to capFrac × hits); accuracy now uses
> **normalized edgeShare** (scale-invariant — raw EDGE previously pinned every move at the 99%
> cap at high level); **unified modifier stacking** (same kind refreshes, different kinds
> multiply, clamps always bind); Ember CD 0→1 + Immolate 20%→16%×2 + a global **DoT intake
> cap** (20% maxHP/turn); **flinch-model stun timing**; lives locked to rated fights only; the
> foe AI is now a specified decision tree; per-edge type-eff map; expanded self-test + sim
> suites. One open tuning flag (Kilnforged/sustain rows — §13).
> **This is not PvP.** The Arena is a cosmetic, single-player, **bot-only** climb. Duels/PvP
> are permanently retired; `PVP.md` is stale and is **not** a source of truth for this engine.
> **Stack:** one vanilla-JS IIFE (`app.js`), no modules/bundler, Capacitor → iOS. The engine
> is pure (DOM-free), localStorage-only (`hb_arena_v2`). No backend, no network, no
> XP/currency/character-power side effects — ever.

---

## 1. Design goals & invariants

1. **Build + tactics, not luck.** A clearly stronger build wins; the moveset is the tactical
   layer on top.
2. **"Floor reached = build strength."** HP *and* damage both derive from the same stats, so
   total power dominates who clears which floor. *(Sim: a 2× build wins 100%.)*
3. **Cosmetic only.** The engine returns a result object; the single commit writes only Arena
   rating / W-L / streak / floor / titles to `hb_arena_v2`. No XP, souls, stats, or power.
4. **Your weapon defines your 4 moves.** Armor relics feed stats/HP, never moves.
5. **Deterministic & testable.** All randomness flows through a seeded PRNG (mulberry32);
   no `Math.random` in the engine.

---

## 2. The combatants

Six character stats map to three combat **roles** (raw values; the app UI shows them ×10):

| Role | Formula | Combat job |
|---|---|---|
| **ATTACK** | `STR×1.6 + FOCUS` | damage output (numerator) |
| **DEFENSE** | `VIT×1.4 + WILL` | **HP pool AND per-hit mitigation** |
| **EDGE** | `INT×1.6` | crit chance, turn order, accuracy |

*(Wealth/WLT was deliberately removed from combat in W225 — it is a non-combat stat.)*

**Max HP:** `maxHP = max(20, round(40 + DEFENSE × 2.2))`

- **Player** roles = live stats + equipped armor. **Foe** roles = the floor's power curve split
  by its archetype weights (which sum to 3, so the split never changes total power).
- **Build shape still matters:** a glass cannon kills fast but is fragile; a tank mitigates +
  has more HP but kills slowly. Total power still decides the ladder.

### 2.1 Archetype (derived from the role split)
`balanced` (no role ≥ 40% of the total) · else the dominant role → `aggressor` (ATTACK) /
`sentinel` (DEFENSE) / `trickster` (EDGE); a role ≥ 52% of the total → the extreme
`glasscannon` / `juggernaut`. The player's archetype is derived from their build; a floor's is
assigned (rotating — §4.3 / boss-fixed).

---

## 3. Type effectiveness (symmetric RPS, ±20%)

Triangle: **Aggressor ▸ Trickster ▸ Sentinel ▸ Aggressor** (extremes collapse to their base;
Balanced & mirrors are neutral).

- Attacker counters defender → that attacker's damage **×1.20**; the countered side's outgoing
  damage is ×0.83 vs neutral.
- Computed **per direction, per hit** — symmetric (when the foe counters you, *its* damage is
  ×1.20 against you).
- **Implementation (W233):** a per-edge map (`_ARENA_EFF_EDGES`) — all three edges are
  1.20/0.83 today; the map exists so individual edges can be tuned later (§11 measured each
  edge's actual contribution).

---

## 4. Weapons & moves

A move: `{ power (×ATTACK; 0 = non-damage), accuracy, hits, priority, cooldown, effect }`.

| Weapon | Moveset | Identity |
|---|---|---|
| (Unarmed) | Jab · Hook · Guard · Focus | fallback |
| Rusted Training Blade | Slash · Lunge · Guard · Focus | balanced starter |
| Titan's Oathblade | Cleave · Sunder · Brace · Oathstrike | heavy hitter |
| Hammerfall Warmaul | Crush · Stagger · Brace · Quake | stun / armor-break |
| Kilnforged Warblade | Searing Cut · Ember · Temper · Immolate | burn + bleed DoT |
| Ten-Thousand Step Blade | Flurry · Quickstep · Evade · Thousand Cuts | fast / priority |
| Vessel of Refusal | Ward Strike · Refuse · Willbreak · Last Vow | sustain / defense |

Foes carry an **archetype kit** (e.g. Sentinels run Slash / Brace / Guard / Ward Strike).

### 4.1 Attuned bonus (player-only "STAB" analogue)
If the equipped weapon matches the player's derived archetype, the player's **damaging moves
get ×1.15**. Foes never get it (their kit matches by construction).

| Weapon | Attuned archetypes |
|---|---|
| Titan's Oathblade | Aggressor / Juggernaut |
| Hammerfall Warmaul | Sentinel |
| Kilnforged Warblade | Aggressor |
| Ten-Thousand Step Blade | Trickster / Glass-Cannon |
| Vessel of Refusal | Sentinel |
| Rusted / Unarmed | none |

### 4.2 Move table (power = ×ATTACK)
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
| Ember | 0.7 | 95% | 1 | — | **1** | **bleed** 12%/t ×3 *(CD 0→1 in v2.2)* |
| Searing Cut | 1.1 | 90% | 1 | — | 1 | **burn** 16%/t ×3 |
| Immolate | 1.6 | 85% | 1 | — | 3 | **burn 16%/t ×2** *(20%→16% in v2.2)* |
| Sunder | 0.8 | 92% | 1 | — | 2 | **armor-shred** −25% ×3 |
| Quake | 1.2 | 85% | 1 | — | 2 | **armor-shred** −20% ×2 |
| Stagger | 0.9 | 85% | 1 | — | 3 | **stun** (skip 1 action) |
| Willbreak | 0.85 | 90% | 1 | — | 2 | foe ATK ×0.75 ×3 |
| Ward Strike | 0.7 | 95% | 1 | — | 1 | heal self 12% |
| Brace | 0 | — | — | — | 2 | self takes ×0.65 ×2 |
| Focus / Temper | 0 | — | — | — | 2/3 | self ATK ×1.30 / ×1.40 ×3 |
| Evade | 0 | — | — | — | 2 | +40% dodge ×2 (cap 50%) |
| Guard | 0 | — | — | — | 1 | halve next landed hit (crit-immune block) |
| Refuse | 0 | — | — | — | 2 | cleanse own debuffs/DoT + guard |
| Last Vow | 0 | — | — | — | 4 | heal self 40% |
| *Struggle* | 0.5 | 95% | 1 | — | 0 | fallback when ALL moves are on CD (both sides) |

### 4.3 Floor archetype rotation (no permanent walls)
Regular floors take their archetype from `['aggressor','sentinel','trickster'][(floor + wins +
losses) % 3]` — it advances each committed **rated** attempt, so a countered build hits a
beatable matchup within ≤3 tries. The floor's **name and total power are unchanged**; only the
matchup rotates. **Milestone bosses keep their fixed archetype** — they are the real type
checks. *Honest note:* because rotation advances on rated attempts, a player can deliberately
lose to rotate into a favorable matchup — "matchup shopping" — at the real cost of lives and
ELO; bosses cannot be shopped.

---

## 5. The damage pipeline (single source of truth)

```
// once per move:
baseAtk = ATTACK × atkStatusMult × attunedMult            // attuned = 1.15 only if player's weapon↔archetype match
typeEff = effectiveness(attackerArch → defenderArch)       // 1.20 / 0.83 / 1.0 (symmetric, per direction)
accuracy = min(0.99, move.acc + min(0.08, edgeShare × 0.20))   // W233: NORMALIZED edgeShare — scale-invariant

// per sub-hit (loop `move.hits`):
  if rng() > accuracy            → miss (0; leaves Guard intact)
  else if rng() < dodge          → dodged (0; leaves Guard intact)   // dodge = min(0.50, Σ Evade)
  else:
    crit   = rng() < critChance                                      // critChance = clamp(0.08 + edgeShare×0.40, 0.08, 0.28)
    defEff = DEFENSE_base × armorShred × (crit ? (1 − 0.5) : 1)       // crit pierces HALF the base armor
    hit    = baseAtk × move.power × typeEff / (1 + defEff / 60)       // DEFENSE mitigates (DEF_SCALE = 60)
    if crit: hit ×= 1.5                                               // crit SKIPS the takenMult below (ignores Brace/DEF-up)
    else:    hit ×= clamp(takenMult, 0.40, 2.0)                       // Brace 0.65 / DEF-up
    hit ×= 1 + rng(−0.15…+0.15)                                       // ±15% variance, PER sub-hit
    if Guard not-yet-consumed AND hit > 0: hit ×= 0.5; consume Guard  // first LANDED sub-hit only; applies on crit too
    accumulate hit

// W233 — the anti-one-shot cap binds on the MOVE TOTAL (was per sub-hit, which
// let multi-hit moves stack to capFrac × hits):
total      = min(Σ hits, (anyCrit ? 0.75 : 0.55) × defender.maxHP)
effective  = min(total, defender.HP_before)    // overkill past 0 is NOT credited to the damage tally
defender.HP = max(0, HP − total)
dmgDealt[attacker] += effective                // the 40-turn-timeout decider (§8)
display = max(1, round(total))                 // a UI floor only — NOT in the damage tally
```

**Why crit is the tank counter:** a crit ignores the defender's temporary DEF buffs (Brace /
DEF-up) **and** sees only half their *base* armor in the divisor. Combined with **Sunder/Quake**
(which shred the base-armor term itself, down to a 40% floor), a high-EDGE build has a real,
scaling answer to a wall. *(Sim: glass-cannon-with-weapon vs juggernaut ≈ 53% — a coin-flip.)*

**Crit vs Guard vs Brace (intentional asymmetry):** **Guard is an active block** (a Protect
analogue) — it halves even a critical hit and is consumed by the first landed sub-hit. **Brace
is a stance buff** (a stat-stage analogue) — crits pierce it. Active play beats passive stance.

---

## 6. Status effects — stacking, immunity & clamp rules

| Status | Effect |
|---|---|
| **DoT** (burn / bleed) | `round(afflicted.maxHP × mag)` at end of each turn; credited to its applier. |
| **DoT intake cap (W233)** | If one fighter's scheduled DoT ticks exceed **20% maxHP** in a turn, every tick is scaled proportionally to total exactly 20%; appliers are credited their scaled share. |
| **Stun** | skip your next **action** (flinch model — §7). |
| **ATK up/down** | multiply your outgoing damage for N turns. |
| **Brace / DEF-up** | damage-taken multiplier (Brace ×0.65); a separate layer from base armor; **crit-pierced**. |
| **Armor-shred** (Sunder/Quake) | multiplies the *base-armor* term in the divisor (×(1−mag)); the real anti-tank debuff. |
| **Dodge** (Evade) | % chance to avoid a hit. |
| **Guard** | halve the next landed hit — **crit-immune active block**, consumed on use. |
| **Heal** | restore `maxHP × mag` (no overheal). |
| **Cleanse** (Refuse) | strip own debuffs + DoT, then guard. |

**Unified stacking rule (W233 — applies to ALL timed effects):**
- **Same kind → REFRESH:** `dur = max(dur, new.dur)`, magnitude = the strongest. Never stacks
  (Sunder re-cast keeps the armor term at 0.75; Willbreak re-cast keeps ATK at ×0.75).
- **Different kinds in the same category → MULTIPLY**, then clamp (Sunder 0.75 × Quake 0.80 =
  0.60 armor term; Focus 1.30 × Temper 1.40 = 1.82 ATK).
- **Clamps always bind:** ATK mult ∈ [0.25, 2.0]; taken mult ∈ [0.40, 2.0]; armor-shred
  product floor 0.40; dodge cap 0.50.
- **One stun at a time** — a stun on an already-stunned target is wasted (its damage component
  still lands; the cooldown is still spent). No chain-lock.
- **DoTs:** same kind refreshes; different kinds (burn + bleed) coexist — subject to the
  intake cap.
- **Heal cannot overheal.**

---

## 7. Turn order & flow

Each **turn** = both fighters act once:
1. Player picks an off-cooldown move (or **Struggle**, 0.5 power, if all four are on CD).
2. Foe AI picks (§7.1).
3. **Order:** higher `priority` first; else higher **EDGE**; within a 3% EDGE band, a seeded
   coin flip.
4. Each side acts in order; a fighter KO'd before acting is skipped (a priority KO denies the
   opponent's action — intended).
5. End-of-turn: DoT ticks (capped, credited) → durations decrement → expired drop → cooldowns tick.

**Stun timing (W233 flinch model):** "skip your next action" means — if the stunned fighter has
**not yet acted this turn**, they lose *this* turn's action; if they had already acted, they
lose *next* turn's. The stun decrements **when the skipped action occurs** (not at end-of-turn).
Acting first therefore makes your stuns better — an intended EDGE reward.

### 7.1 Foe AI (deterministic decision tree, seeded rolls)
1. If HP < 35% **and** a heal move is off-cooldown: roll — `r < 0.70` → use the heal.
2. Else if HP < 35% **and** Guard or Brace is off-cooldown: roll — `r < 0.50` → use it
   (Guard preferred over Brace).
3. Else a **weighted attack** among off-cooldown damaging moves: weight ∝ `power × acc × hits
   × typeEff`, ×1.5 for a debuff/DoT move whose effect the player currently lacks. Struggle
   only when nothing else is available.
The AI obeys the same stun/dodge/cooldown rules as the player (no cheating) and draws from the
same seeded PRNG.

---

## 8. Win / loss & the timeout rule

- **KO:** a fighter at HP ≤ 0 loses immediately (KO always trumps timeout).
- **Timeout (40 turns):** the fighter who dealt **more total *effective* damage** wins (DoT
  counts; overkill doesn't). Tie → higher current HP% → seeded coin. *(In normal play fights
  end by KO in ~6 turns — 0% timeouts across all sim suites; this is a safety net.)*

---

## 9. Stakes & commit (cosmetic; once)

Committed exactly once at fight end (`arenaFinalizeBattle`):
- **Rated fights only** (a genuine attempt at your current floor): ELO change, W-L record,
  streak, **a daily life on a loss** (2 lives/day; forfeit/quit of a rated attempt = a loss),
  floor advance + titles on a win.
- **Unrated rematches of cleared floors commit NOTHING** — no rating, no life, no W-L, no
  streak, and (because rotation keys off wins+losses) no rotation advance.
- Rating is floored at the global `ASCENT_RATING_FLOOR = 100`. **Never** XP / currency / power.

---

## 10. Constants (the tuning knobs)

```
HP_BASE = 40     HP_PER_DEF = 2.2     DEF_SCALE = 60       VARIANCE = ±15% / sub-hit
CRIT_MULT = 1.5  CRIT_PIERCE = 0.5    CRIT_RANGE = 8–28% (from edgeShare)
ACC_EDGE_COEF = 0.20   ACC_EDGE_MAXBONUS = 0.08            // accuracy bonus = min(0.08, edgeShare×0.20)
ATTUNED = 1.15   TYPE_EFF = per-edge map (all edges 1.20 / 0.83 today), symmetric
MAX_HIT_FRAC = 0.55   MAX_HIT_FRAC_CRIT = 0.75             // MOVE-LEVEL anti-one-shot cap (W233)
DOT_INTAKE_CAP = 0.20                                       // max DoT one fighter takes per turn
DODGE_CAP = 0.50  ATK_CLAMP = [0.25, 2.0]  TAKEN_CLAMP = [0.40, 2.0]  ARMOR_SHRED_MIN = 0.40
EDGE_TIE_BAND = 3%   STRUGGLE_POWER = 0.5   TURN_CAP = 40 (→ most effective damage wins)
REF_POWER = 100                                             // the raw power all §11 grids ran at
// defScaleEff fight-relative scaling: NOT applied — §11 suite C passed at 0.5×/1×/3× without it
```
> **Durability is multiplicative:** effective tankiness ≈ `maxHP × mitigation = (40 + 2.2·D)(1 +
> D/60)`. Tanks *are* tankier than a pure-HP model — intended ("tough but countered"); the
> crit/Sunder pierce is the counter. If tanks feel oppressive, **raise `DEF_SCALE` before
> cutting `HP_PER_DEF`.**

---

## 11. Validation (W233 — offline simulation of the exact pipeline, ≥10k fights/cell, seeded)

### Suite A — per-weapon grid (player = matching-archetype build + weapon ± attuned, vs foe archetype kits, equal power)
| Weapon (build) | vs Aggr | vs Sent | vs Trick | vs Glass | vs Jugg | Flag |
|---|---|---|---|---|---|---|
| Unarmed (bal) | 26.6% | 5.9% | 47.8% | 27.5% | 24.0% | |
| Rusted (bal) | 36.4% | 14.1% | 62.5% | 38.9% | 35.2% | |
| Titan's (aggr) | 59.6% | 49.7% | 96.8% | 48.1% | 53.2% | |
| Warmaul (sent) | 95.5% | 82.1% | 83.0% | 87.6% | 91.6% | ⚠ row >60% |
| Kilnforged (aggr) | 83.0% | 95.9% | 100% | 67.1% | 96.4% | ⚠ row >60% (post-nerf — §13) |
| Step Blade (trick) | 9.1% | 84.9% | 73.6% | 18.1% | 79.7% | |
| Vessel (sent) | 98.7% | 63.0% | 99.0% | 89.6% | 100% | ⚠ row >60% |

*Reading note:* rows compare a **weapon kit + attuned player** against bare **foe archetype
kits**, so >50% is expected by design (weapons are the player's edge); the meaningful signal is
the **spread between rows** — sustain/control kits (Warmaul/Kilnforged/Vessel) far outperform
burst kits (Titan/Step) under AI play. Human tuning call open (§13).

### Suite B — type-eff contribution per triangle edge (live ±20% vs forced 1.0)
| Edge | live | flat (1.0) | type-eff adds |
|---|---|---|---|
| Aggressor > Trickster | 98.3% | 82.5% | +15.8 win-pts |
| Trickster > Sentinel | 52.2% | 2.5% | +49.7 win-pts |
| Sentinel > Aggressor | 83.1% | 33.6% | +49.6 win-pts |

*(Per-edge multipliers deliberately NOT retuned — the per-edge map exists so a human can; the
asymmetry mostly reflects the underlying archetype power spread, not the multiplier.)*

### Suite C — multi-power balanced mirror (assert mean turns ∈ [4, 10])
| Power | win | avg turns | timeouts | band |
|---|---|---|---|---|
| 0.5× REF | 50.3% | 6.9 | 0% | OK |
| 1× REF | 49.9% | 5.9 | 0% | OK |
| 3× REF | 49.9% | 7.0 | 0% | OK |

→ **PASS at all levels; the conditional `defScaleEff` fight-relative scaling was NOT applied.**

### Scenario re-runs (patched engine)
| Scenario | Result |
|---|---|
| Balanced mirror, equal power | 49.9% · 5.9 turns · max single move 49.8% maxHP |
| 2× power (build dominance) | **100%** — "floor = build strength" holds |
| Glass-cannon (Step) vs Juggernaut | 52.6% — tank crackable |
| Trickster (Step) vs Juggernaut | 79.7% |
| Countered build (Aggr/Titan vs Sentinel) | 49.7% @1× → 85.5% @1.15× → 96.0% @1.3× |

### Assertions (all pass)
**Offline sim: 10/10** — determinism · sanity · move-total cap (multi-hit) · accuracy
scale-invariance · shred refresh/multiply/floor · willbreak refresh + focus×temper clamp ·
DoT intake cap + applier credit · stun flinch timing · wasted stun · timeout rule.
**In-app `Arena.selfTest()`: 11 checks** (the same suite plus the unrated-commits-nothing
check, runnable on-device).

---

## 12. Implementation notes

- **In place** in `app.js` (`arenaStartBattle` → `arenaTakeTurn` → `arenaFinalizeBattle`, plus
  `_arExecMove` / `_arApplyFx` / `_arEndTurn` / `_arenaFoePick`). No ESM modules, no Node test
  runner, no Netlify/D1.
- **Seedable RNG:** inline `mulberry32`; every engine roll uses `sess.rng()`. Live play seeds
  from time + a counter; tests pass a fixed seed.
- The session carries a `dmgDealt` accumulator (effective damage, DoT credited via a `src`
  field) surfaced as a "DMG DEALT" row on the result screen, so a timeout loss is legible.
- **Dev self-test:** `Arena.selfTest(seed)` runs the 11 deterministic checks and logs
  PASS/FAIL with the per-check list. `Arena._battle` exposes `{ start, turn, finalize }`.

---

## 13. Open tuning questions (for review — none are blockers)

1. **⚠ Kilnforged (4c stop-condition, reported):** after BOTH prescribed nerfs (Ember CD 1,
   Immolate 16%×2) the row is still >60% vs every archetype (83–100%). Per the review's own
   rule, no third nerf was improvised. Candidate levers for the human call: Searing Cut burn
   16%→12%, DOT_INTAKE_CAP 0.20→0.15, or removing Temper from the kit.
2. **Sustain/control kits dominate under AI play** (Warmaul 82–96%, Vessel 63–100% rows).
   Partly an artifact of AI-vs-AI testing (the AI never punishes predictable heals), partly
   real — burst kits (Titan/Step) may need a touch more power, or heals a cooldown bump.
3. **Per-edge type-eff:** the map is in place; Suite B shows the *measured* contribution per
   edge if individual edges ever need different multipliers.
4. **Attuned 1.15** — drop to 1.10 if a single weapon/archetype dominates the live ladder.
5. **DEF_SCALE = 60 / HP_PER_DEF = 2.2** — validated at 0.5×–3× power in sim; verify fight
   length on real on-device builds before further tuning.
