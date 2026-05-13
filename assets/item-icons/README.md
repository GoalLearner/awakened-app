# Armory Item Icons

This folder holds **transparent PNG equipment icons** used exclusively by the Armory's equipped slots.

**Why it exists:** the full square card art at `assets/items/*.png` works perfectly for the Pokédex, reveal modal, and card detail screens — but when those flattened RGB images are placed inside the carved stone slots of the Armory, the square backgrounds + card frames show as visible thumbnail boxes around each item. CSS masking can dim the damage but can't remove the background from a flattened image. The proper fix is a separate transparent-icon asset.

## Strict pipeline rule (v3 Phase 1d)

> **The Armory NEVER renders `art_path`.**

When a transparent `icon_path` is unavailable, the Armory renders a **premium missing-icon placeholder** (rune glyph + rarity-tinted aura) instead of falling back to the square card art. This is intentional. Until proper transparent icons exist, equipped slots show as "locked-in sockets with a rarity glow," not as square thumbnails.

## How the pipeline works

Each card in the `CARDS` constant supports two image paths:

```js
{
  art_path:  'assets/items/<id>.png',          // full square card art (REQUIRED)
  icon_path: 'assets/item-icons/<id>.png'      // transparent armory icon (OPTIONAL)
}
```

- **`art_path`** is the source of truth for the Pokédex, reveal animation, and card detail modal.
- **`icon_path`** is used **exclusively** by the Armory's equipped slots.

If `icon_path` is missing:
- `getArmoryIconPath(card)` returns the empty string.
- The renderer detects `hasArmoryIcon === false`, emits the `.armory-slot--missing-icon` class, and renders a 4-layer placeholder DOM (recess + rarity aura + rune glyph + glass + bevel). **No `<img>` element is created.** **`art_path` is never read.**
- A `console.warn` surfaces the missing asset so it's visible during development.

If `icon_path` is set but the file 404s at runtime:
- The `<img>`'s `onerror` handler hides the broken image, adds `.armory-slot--missing-icon`, and injects the rune-glyph placeholder. Same missing-icon visual.
- A `console.warn` reports the runtime load failure.

A `getArmoryDebugFallbackPath(card)` helper exists for console inspection (returns `card.art_path`) but **is not called from production rendering paths.**

## Icons needed (TODO)

Generate transparent PNGs for each of the 9 launch cards. All filenames must match the card `id` from the `CARDS` constant:

- [ ] `dream_woven_hood.png`
- [ ] `sleepwalkers_cloak.png`
- [ ] `pendant_of_the_wakeful.png`
- [ ] `vow_ring.png`
- [ ] `vessel_of_refusal.png`
- [ ] `sober_kings_gloves.png`
- [ ] `pack_leaders_greaves.png`
- [ ] `alphas_mantle.png`
- [ ] `trail_worn_boots.png`

Each icon **must** be:

- **Transparent PNG** (RGBA, alpha channel preserved) — verify the alpha actually exists; "PNG saved against a black background" is not transparent
- **Isolated object only** — no card frame, no background scene, no border, no decorative tile, no inset shadow
- **No square background** of any kind. The four corners of the canvas should be fully transparent (`alpha=0`).
- **Centered** in the canvas with ~10% padding on each side
- **Readable at small size** — most slots render the icon at 44–86% of a ~120px slot, so the icon needs to be visually clear at ~50–100px on screen
- **No text, no UI, no logos, no captions, no readable letters or numbers**
- **Designed for carved stone sockets** — items should have warm gold accents and deep shadows so they read against the panel's dark purple stone palette
- **Dark fantasy RPG style** matching the existing Awakened art language (Solo Leveling manhwa illustration, gold rim highlights, deep purple shadows, near-black recesses)
- **Dimensions:** 512×512 or 1024×1024 (square canvas). Higher resolution is fine but unnecessary — the icon never renders larger than ~120px on screen.
- **Filename:** exactly matches the card `id` from the `CARDS` constant (e.g., `sober_kings_gloves.png` not `sober-kings-gloves.png` or `gloves.png`).

Recommended DALL-E 3 prompt skeleton:

```
A single isolated <ITEM NAME> floating on a transparent background.
Solo Leveling manhwa illustration style with cel-shading. Dark
fantasy RPG equipment icon. <ITEM DESCRIPTION>. Gold trim and
detailing on dark steel. Centered composition. No background, no
text, no UI, no border, no frame. PNG with full alpha channel.
```

Then post-process to ensure full transparency (Photoshop "Background → Transparent" or remove.bg or similar) before saving as `assets/item-icons/<id>.png`.

## Wiring after generation

Once a transparent icon lands on disk:

1. Add `icon_path: 'assets/item-icons/<id>.png'` to the matching card entry in the `CARDS` constant at `app.js`
2. Add the path to `PRECACHE_ASSETS` in `sw.js` (NOT before — `cache.addAll` rejects the whole install if any URL 404s, per the lesson learned in CLAUDE.md "Common pitfalls")
3. Bump `CACHE_VERSION` in `sw.js` so PWA users get the new icon
4. The Armory will automatically pick up `icon_path` via `getArmoryIconPath()` and drop the `.armory-slot--fallback-art` class for that slot

No JS or CSS changes needed when adding a new icon — the pipeline is data-driven.

## Until the icons exist

The Armory currently shows **the rune-glyph missing-icon placeholder** for all 9 cards. Slots read as "locked-in sockets with rarity aura." There is no square thumbnail visible — `art_path` is never rendered in the Armory in production.

## Verifying icon validity

A PowerShell script at `scripts/verify-armory-icons.ps1` checks every expected card_id:

```
pwsh ./scripts/verify-armory-icons.ps1
```

Reports one of:
- **`OK`** — file present, RGBA, corners transparent (✓ usable)
- **`MISSING`** — file does not exist on disk (placeholder shown in Armory)
- **`NO-ALPHA`** — PNG saved without alpha channel (will render as opaque square — broken)
- **`OPAQUE-EDGE`** — alpha present but corners have visible pixels (looks like full-card art — broken)
- **`UNREADABLE`** — file failed to load (corrupt or wrong format)

Exit code 0 = all 9 OK; 1 = at least one needs attention. Run this before wiring `icon_path` into the `CARDS` constant — committing a `NO-ALPHA` or `OPAQUE-EDGE` icon defeats the whole pipeline.
