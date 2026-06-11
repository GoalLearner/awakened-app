# Awakened — Arena On-Device Playtest Protocol (post-W237)

> v2.6 (`ARENA_BATTLE_ENGINE.md`) is the **final sim-tuned baseline**. The next balance
> commit cites a **play session**, not a sim run. Total overhead: ~10 seconds per fight.

---

## The log line (after every fight)

```
floor | foe archetype | your weapon | W/L | turns | one feeling word
F8    | sentinel      | Kiln        | W   | 5     | free
```

Notes app or appended right here in this file. **~25 fights is a full first dataset.**

### Log

```
(append fights here)
```

---

## Six questions week-one play must answer

1. **The gate (F6):** losing weaponless — does it read *"go earn the blade"* or *"this game
   is unfair"*? The flavor line ("The Iron Warden guards a blade") should be doing that work.
   Watch your own gut on the first loss.
2. **Fight length:** 6–7 turns — tense, or slow on a phone screen? Log any fight that dragged
   and its turn count. (T4 says 4–10 is healthy; feel may disagree.)
3. **Cauterize legibility:** when a wall cleanses your burn, do you SEE it and instantly know
   why your DoT stopped sticking? If the designer has to squint, players are lost — that's a
   **UI fix, not a balance fix**.
4. **Free floors:** counter-pick floors (Kiln into sentinel) — earned ("I built the answer")
   or boring ("why am I pressing buttons")? Your honest answer decides the parked T2 cells.
5. **Utility buttons:** do YOU actually press Brace / Focus / Evade / Refuse under real
   conditions? If even the designer spams attacks, kits need **feedback/affordance work** —
   the numbers are fine.
6. **AI tells:** the moment you find cheese (bait the Refuse then stack burns; dance around
   the 35% panic-heal threshold), **write it down verbatim**. Exploits found by the designer
   in week one are exploits players find in week two.

---

## Parked-item watchlist → decision triggers

- **Kiln sent 94.6 · Vessel jugg 100 · Warmaul aggr 90.5:** if free floors feel BAD (Q4),
  the lever is **foe-side content** (milestone bosses with cleanse/pressure kits), NOT weapon
  nerfs — the nerf ladders are exhausted and were hitting identity. If free floors feel
  earned: accept, document, close.
- **AT edge ceiling-bound (+5.9):** nothing left at the multiplier. If aggressor floors
  flatten your trickster climbs in practice, the fix is a **trickster-kit tool (a future
  weapon)**, never the edge.
- **Human-skill inflation:** live win rates will sit ABOVE the grid — most for Vessel and
  Step Blade. That is **expected**. No nerf rulings until ~25 fights re-anchor the baseline.

---

## Standing rules for the play-data phase

- **`Arena.selfTest()` stays green on every commit** — it is the regression net for all 26
  invariants this series bought.
- **Before ANY future lever: check the move→users index** (`ARENA_BATTLE_ENGINE.md` §4.5) —
  all three reverted/misfired levers this series (Searing W235, Ward Strike W237, Crush
  side-effects W237) came from shared-move coupling.
- **One change per ruling, re-anchor after.** Same discipline, new instrument: you.

---

## When to bring data back

After **~25 logged fights** OR the **first "this is broken" moment** — whichever comes first.
Bring: the log, the three worst-feeling fights (floor / weapon / turns / why), and any Q6
cheese. Ruling format stays the same; the evidence is now play.
