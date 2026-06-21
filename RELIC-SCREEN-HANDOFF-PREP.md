# Prep — incoming ClaudeDesign relic-screen handoff (class + power)

The owner has ClaudeDesign improving the **relic / archive screen** (the card grid:
`renderPokedex`) to (1) make a relic's **class — melee / magic / ranged** obvious, and
(2) surface a **power level** so it's easy to know what to equip. This note pre-stages
everything so the handoff drops straight in.

**Headline: no data/schema change needed.** Both class and power are *derivable* from a
card's existing `bonuses`, using the same combat triangle the Ascent + PvP already use.

## Where it renders
- `renderPokedex()` — **app.js:15036**. The grid is `.pokedex-grid` of `.pokedex-cell`.
- Discovered card markup — **app.js:15148–15159**:
  - `.pokedex-card` button (rarity + equipped/new classes)
  - `.pokedex-card-art` → slot icon + art `<img>` + `slotBadge` + NEW/EQUIPPED `chip`
  - `.pokedex-card-name` → item name
  - `sourceLine` → source boss (e.g. "THE INSOMNIAC")
  - then `_marketAffordanceHtml(c, entry)` → the SELL/BUY price row
- Undiscovered "?" cards — 15168–15177 (no class/power — keep hidden until discovered).
- **Insertion points for the new badges:** a class chip/icon in `.pokedex-card-art`
  (corner, beside the slot badge), and a power strip after `sourceLine` (or a small
  power pill in the art corner). The detail/equip modal (`openMarketSheet`) is the other
  surface that should show class + power.

## The authoritative mapping (already in code)
`_arenaCombatProfile(s)` — **app.js:~6792** — IS the combat triangle (WLT excluded):
```
attack  (Melee)  = STR * 2.3
defense (Magic)  = (INT + VIT) * 1.15
edge    (Ranged) = (FOCUS + WILL) * 1.15
power            = attack + defense + edge
```
Labels already exist in `ASCENT_ARCHETYPES` (app.js:6571): aggressor='Melee',
sentinel='Magic', trickster='Ranged'.

So a relic's **class = its dominant role** (max of attack/defense/edge from its bonuses),
and its **power = that profile's `power`** — a real, comparable combat number that rises
with tier (verified: C-rare ranger ≈ 17, B-ultra mage ≈ 32). This is the right "what to
equip" number. (Note: `getItemBuildPower` at app.js:12217 is a *different* thing — the
rarity slot-cost weight ultra=7/rare=3/common=1 — surface that only if the design asks
for "build cost," not power.)

## The one helper to add (ready to paste)
Drop this near `getItemBuildPower` (app.js:~12217), then call it from the card render:
```js
// Per-relic combat ROLE (melee/magic/ranged) + POWER, derived from its stat bonuses via
// the SAME triangle the Ascent/PvP use (Melee=STR, Magic=INT+VIT, Ranged=FOCUS+WILL).
// Computed, never stored — works for every existing card with zero schema change.
const _RELIC_ROLE = {
  attack:  { key: 'melee',  label: 'Melee',  icon: '⚔️' },   // ⚔️
  defense: { key: 'magic',  label: 'Magic',  icon: '✨' },          // ✨ (swap for the design's glyph)
  edge:    { key: 'ranged', label: 'Ranged', icon: '\u{1F3F9}' },       // 🏹
};
function _relicProfile(card) {
  const b = (card && card.bonuses) || {};
  const p = _arenaCombatProfile({ STR: b.str|0, VIT: b.vit|0, INT: b.int|0, FOCUS: b.focus|0, WILL: b.will|0, WLT: 0 });
  let field = 'attack', val = p.attack;            // dominant role = the class
  if (p.defense > val) { field = 'defense'; val = p.defense; }
  if (p.edge   > val) { field = 'edge';    val = p.edge; }
  const r = _RELIC_ROLE[field];
  return { power: Math.round(p.power), roleKey: r.key, roleLabel: r.label, roleIcon: r.icon };
}
```
Sanity vs the W447 armor: ranger pieces (FOCUS-dominant) → `ranged`; mage pieces
(INT-dominant) → `magic`; Titan's Oathblade etc. (STR) → `melee`. ✓

## Decisions to confirm when the mock arrives
1. **Power display** — raw combat number (e.g. "PWR 32"), a 1–5 pip/bar, or both? (I'll
   match the mock; the number is `_relicProfile(card).power`.)
2. **Class display** — icon only, label only, or both; and where (art corner vs a chip
   under the name). Map to `roleKey`/`roleLabel`/`roleIcon`. If the design ships its own
   melee/magic/ranged glyphs, replace the placeholder emoji in `_RELIC_ROLE`.
3. **Undiscovered "?" cards** — class/power stay hidden (no spoilers) — assumed.
4. **Sort/filter by class or power?** If the mock adds it, the data's all there via
   `_relicProfile`.
5. **Per-tab color** — melee/magic/ranged could reuse the app accents (STR/red,
   INT/violet, FOCUS/teal) or the design's own — confirm.

## When the handoff lands
Read the design (likely `project/<name>.html` + the README-flagged primary), then:
add `_relicProfile` (above), render the class chip + power into the card at app.js:15151
& after 15157, mirror in the detail/equip modal, add the CSS, bump the version knobs,
verify with a headless render, commit. Estimated: a focused single-pass implementation.
