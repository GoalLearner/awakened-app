# Awakened — Arena Battle Engine (v2.1, as shipped W232)

> **Status:** CANONICAL for the Ascent tower. This documents the engine **as actually
> implemented** in `app.js` (build W232), with every contradiction from the v2 draft
> resolved and every constant validated by simulation (§11).
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
5. **Deterministic & testable.** All randomness flows through a seeded PRNG.

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
- **Build shape matters:** a glass cannon (high ATTACK / low DEFENSE) kills fast but is fragile;
  a tank (high DEFENSE) mitigates + has more HP but kills slowly. Total power still decides the
  ladder; shape decides *how* a fight plays.

### 2.1 Archetype (derived from the role split)
`balanced` (no role ≥ 40% of the total) · else the dominant role → `aggressor` (ATTACK) /
`sentinel` (DEFENSE) / `trickster` (EDGE); a role ≥ 52% of the total → the extreme
`glasscannon` / `juggernaut`. The player's archetype is derived from their build; a floor's is
assigned (rotating — §4.3 / boss-fixed).

---

## 3. Type effectiveness (symmetric RPS, ±20%)

Triangle: **Aggressor ▸ Trickster ▸ Sentinel ▸ Aggressor** (extremes collapse to their base;
Balanced & mirrors are neutral).

- Attacker counters defender → that attacker's damage **×1.20**.
- Computed **per direction, per hit** — when the foe counters you, *its* outgoing damage is
  ×1.20 against you (symmetric; v1 only scaled the player and was correctly flagged as arbitrary).
- Equivalent framing: the countered side's outgoing damage is ×0.83 vs neutral.

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
get ×1.15**. Rewards coherent builds. Foes never get it (their kit matches by construction).

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
| Ember | 0.7 | 95% | 1 | — | 0 | **bleed** 12%/t ×3 |
| Searing Cut | 1.1 | 90% | 1 | — | 1 | **burn** 16%/t ×3 |
| Immolate | 1.6 | 85% | 1 | — | 3 | **burn** 20%/t ×2 |
| Sunder | 0.8 | 92% | 1 | — | 2 | **armor-shred** −25% ×3 |
| Quake | 1.2 | 85% | 1 | — | 2 | **armor-shred** −20% ×2 |
| Stagger | 0.9 | 85% | 1 | — | 3 | **stun** (skip 1) |
| Willbreak | 0.85 | 90% | 1 | — | 2 | foe ATK ×0.75 ×3 |
| Ward Strike | 0.7 | 95% | 1 | — | 1 | heal self 12% |
| Brace | 0 | — | — | — | 2 | self takes ×0.65 ×2 |
| Focus / Temper | 0 | — | — | — | 2/3 | self ATK ×1.30 / ×1.40 ×3 |
| Evade | 0 | — | — | — | 2 | +40% dodge ×2 (cap 50%) |
| Guard | 0 | — | — | — | 1 | halve next landed hit |
| Refuse | 0 | — | — | — | 2 | cleanse own debuffs/DoT + guard |
| Last Vow | 0 | — | — | — | 4 | heal self 40% |
| *Struggle* | 0.5 | 95% | 1 | — | 0 | fallback when all moves on CD |

### 4.3 Floor archetype rotation (no permanent walls)
Regular floors take their archetype from `['aggressor','sentinel','trickster'][(floor + wins +
losses) % 3]` — it advances each committed rated attempt, so a countered build hits a beatable
matchup within ≤3 tries (sim: a counter is only a ~1.15× speed-bump, never a wall). The floor's
**name and total power are unchanged**; only the role split / matchup rotates. **Milestone bosses
keep their hand-crafted, fixed archetype** (they are real type checks you must out-build).

---

## 5. The damage pipeline (single source of truth)

```
// once per move:
baseAtk = ATTACK × atkStatusMult × attunedMult            // attuned = 1.15 only if player's weapon↔archetype match
typeEff = effectiveness(attackerArch → defenderArch)       // 1.20 / 0.83 / 1.0 (symmetric, per direction)

// per sub-hit (loop `move.hits`):
  if rng() > accuracy            → miss (0; leaves Guard intact)      // accuracy = min(0.99, move.acc + EDGE×0.002)
  else if rng() < dodge          → dodged (0; leaves Guard intact)    // dodge = min(0.50, Σ Evade)
  else:
    crit   = rng() < critChance                                       // critChance = clamp(0.08 + edgeShare×0.40, 0.08, 0.28)
    defEff = DEFENSE_base × armorShred × (crit ? (1 − 0.5) : 1)        // crit pierces HALF the base armor
    hit    = baseAtk × move.power × typeEff / (1 + defEff / 60)        // DEFENSE mitigates (DEF_SCALE = 60)
    if crit: hit ×= 1.5                                                // crit SKIPS the takenMult below (ignores Brace/DEF-up)
    else:    hit ×= clamp(takenMult, 0.40, 2.0)                        // Brace 0.65 / DEF-up
    hit ×= 1 + rng(−0.15…+0.15)                                        // ±15% variance, PER sub-hit
    if Guard not-yet-consumed AND hit > 0: hit ×= 0.5; consume Guard   // first LANDED sub-hit only; applies on crit too
    hit = min(hit, (crit ? 0.75 : 0.55) × defender.maxHP)             // anti-one-shot cap
    accumulate hit
total      = Σ hits
effective  = min(total, defender.HP_before)    // overkill past 0 is NOT credited to the damage tally
defender.HP = max(0, HP − total)
dmgDealt[attacker] += effective                // the 40-turn-timeout decider (§8)
display = max(1, round(total))                 // a UI floor only — NOT in the damage tally
```

**Why crit is the tank counter:** a crit ignores the defender's temporary DEF buffs (Brace /
DEF-up) **and** sees only half their *base* armor in the divisor. Combined with **Sunder/Quake**
(which shred the base-armor term itself, down to a 40% floor), a high-EDGE build has a real,
scaling answer to a wall. *(Sim: glass-cannon-with-weapon vs juggernaut ≈ 46% — a coin-flip.)*

---

## 6. Status effects (with stacking / immunity / clamp rules)

| Status | Effect |
|---|---|
| **DoT** (burn / bleed) | `round(afflicted.maxHP × mag)` at end of each turn; credited to its applier. |
| **Stun** | skip your next action. |
| **ATK up/down** | multiply your outgoing damage for N turns. |
| **Brace / DEF-up** | damage-taken multiplier (Brace ×0.65); a separate layer from base armor; **crit-piercable**. |
| **Armor-shred** (Sunder/Quake) | multiplies the *base-armor* term in the divisor (×(1−mag)); the real anti-tank debuff. |
| **Dodge** (Evade) | % chance to avoid a hit. |
| **Guard** | halve the next landed hit (consumed). |
| **Heal** | restore `maxHP × mag` (no overheal). |
| **Cleanse** (Refuse) | strip own debuffs + DoT, then guard. |

**Rules (close the W231 holes):**
- **One stun at a time** — a stunned target can't be re-stunned (no chain-lock); a wasted stun
  still spends the move's cooldown.
- **DoT refreshes by kind, never stacks magnitude** — a second burn sets `dur = max`, `mag = max`
  (no triple-burn one-shot). *Different* kinds (burn + bleed) coexist.
- **Clamps:** cumulative ATK mult ∈ [0.25, 2.0]; taken mult ∈ [0.40, 2.0]; armor-shred floor 0.40;
  dodge cap **0.50**. (The *ceilings* are the load-bearing fix vs W231's floor-only clamps.)

---

## 7. Turn order & flow

Each **turn** = both fighters act once:
1. Player picks an off-cooldown move (or **Struggle**, 0.5 power, if all are on CD).
2. Foe AI picks (§7.1).
3. **Order:** higher `priority` first; else higher **EDGE**; **but within a 3% EDGE band, a
   seeded coin flip** (no deterministic mirror wins, no 1-point-EDGE landslides).
4. Each side acts in order; a fighter KO'd or stunned before acting is skipped (a priority KO
   denies the opponent's action — intended).
5. End-of-turn: DoT ticks (credited to source) → durations decrement → expired drop → stun
   counts down → cooldowns tick.

### 7.1 Foe AI
Prefers off-cooldown moves; below **35% HP** it may heal (70%) or guard (50%); otherwise a
weighted attack. Same rules as the player (no cheating); uses the same seeded PRNG.

---

## 8. Win / loss & the timeout rule

- **KO:** a fighter at HP ≤ 0 loses immediately (KO always trumps timeout).
- **Timeout (40 turns):** the fighter who dealt **more total *effective* damage** wins (DoT
  counts; overkill doesn't). Tie → higher current HP% → seeded coin. *This is the anti-stall
  fix:* surviving with a big bar no longer beats out-damaging. *(In normal play, fights end by
  KO at ~6 turns; the timeout is a safety net.)*

---

## 9. Stakes & commit (cosmetic; once)

Committed exactly once at fight end (`arenaFinalizeBattle`):
- **ELO rating** only on a genuine floor attempt; **rematches of cleared floors are unrated**.
  Rating is floored at the global `ASCENT_RATING_FLOOR = 100` (not "the entry value" — that line
  in the v2 draft was wrong).
- **2 lives/day;** a loss spends one. Quitting mid-fight = **forfeit = loss** (you can't dodge the
  life cost).
- **On a win:** floor advance + cosmetic title unlocks. **Never** XP / currency / power.

---

## 10. Constants (the tuning knobs)

```
HP_BASE = 40     HP_PER_DEF = 2.2     DEF_SCALE = 60       VARIANCE = ±15% / sub-hit
CRIT_MULT = 1.5  CRIT_PIERCE = 0.5    CRIT_RANGE = 8–28% (from edgeShare)
ATTUNED = 1.15   TYPE_EFF = ±20% (1.20 / 0.83), symmetric
MAX_HIT_FRAC = 0.55   MAX_HIT_FRAC_CRIT = 0.75            // anti-one-shot
DODGE_CAP = 0.50  ATK_CLAMP = [0.25, 2.0]  TAKEN_CLAMP = [0.40, 2.0]  ARMOR_SHRED_MIN = 0.40
EDGE_TIE_BAND = 3%   STRUGGLE_POWER = 0.5   TURN_CAP = 40 (→ most effective damage wins)
```
> **Durability is multiplicative:** effective tankiness ≈ `maxHP × mitigation = (40 + 2.2·D)(1 +
> D/60)`. Tanks *are* tankier than a pure-HP model — that is intended (decision: "tough but
> countered"); the crit/Sunder pierce is the counter. If tanks feel oppressive, **raise
> `DEF_SCALE` before cutting `HP_PER_DEF`.**

---

## 11. Validation (offline simulation of the exact pipeline)

~150,000 AI-vs-AI fights of the formulas above:

| Scenario | Result |
|---|---|
| Balanced, equal power | **49.5% win · 6.0 turns · 0% timeouts · max single hit 49.8% maxHP** |
| 2× power (build dominance) | **100%** (3.7 turns) — "floor = build strength" |
| 1.5× power | 100% (4.5 turns); 1× vs 1.5× → 0% |
| Glass-cannon-w/weapon vs Juggernaut (equal P) | **46.4%** — tank crackable (target 40–60%) |
| Trickster-w/weapon vs Juggernaut | 74.9% |
| Countered build (Aggressor vs Sentinel) | 49.5% @1× → 86% @1.15× → 96% @1.3× |

**Assertions (9/9 pass):** seeded determinism; maxHP/role formulas; defense genuinely lowers
per-hit damage; hit cap (no >0.75 maxHP); timeout = out-damager wins even with less HP;
ATK/armor-shred clamps; DoT refresh-by-kind (no triple-burn).

**Known asymmetry to weigh:** in a *no-weapon* archetype round-robin, tanky archetypes
(Sentinel/Juggernaut) out-perform squishy ones. In the real game every player has a weapon
(restoring the tank counter), floor archetypes rotate, and total power dominates floor-clearing,
so the ladder still tracks build strength — but whether to flatten that archetype curve further
is open (§13).

---

## 12. Implementation notes

- **In place** in `app.js` (functions `arenaStartBattle` → `arenaTakeTurn` → `arenaFinalizeBattle`,
  plus `_arExecMove` / `_arApplyFx` / `_arEndTurn`). No ESM modules, no Node test runner, no
  Netlify/D1 (the v2 draft's Part B prescribed those against the wrong app and is **not** followed).
- **Seedable RNG:** an inline `mulberry32`; every engine roll uses `sess.rng()` (no `Math.random`
  in the engine). Live play seeds from time + a counter; tests pass a fixed seed.
- **Damage math is DOM-free**; the UI/controller is separate. The session also carries a
  `dmgDealt` accumulator (for the timeout rule) surfaced as a "DMG DEALT" row on the result.
- **Dev self-test:** `Arena.selfTest(seed)` in the console runs a deterministic auto-play +
  sanity invariants and logs PASS/FAIL. `Arena._battle` exposes `{ start, turn, finalize }`.

---

## 13. Open tuning questions (for review — none are blockers)

1. **DEF_SCALE = 60** and **HP_PER_DEF = 2.2** together set how much of "defense" is bar vs
   mitigation. First-pass; verify fight length (~5–9 turns) on real stat exports.
2. **Archetype curve:** should the no-weapon tank advantage be flattened (e.g. taper HP_PER_DEF at
   high DEFENSE, or give every floor-foe a token attuned bonus), or is "weapons + rotation + total
   power dominance" enough?
3. **Attuned 1.15** — drop to 1.10 if a single weapon/archetype dominates the ladder.
4. **Crit-pierce 0.5 + crit range 8–28%** — if crit feels swingy, lower the top of the range
   before the multiplier.
5. **Type-eff ±20%** — with rotation it's a speed-bump; if it feels too weak/strong on bosses
   (fixed archetype), tune per-context.
