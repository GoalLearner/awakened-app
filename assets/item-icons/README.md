# Armory Item Icons

This folder holds **transparent PNG equipment icons** used exclusively by the Armory's equipped slots.

**Why it exists:** the full square card art at `assets/items/*.png` works perfectly for the Pokédex, reveal modal, and card detail screens — but when those flattened RGB images are placed inside the carved stone slots of the Armory, the square backgrounds + card frames show as visible thumbnail boxes around each item. CSS masking can dim the damage but can't remove the background from a flattened image. The proper fix is a separate transparent-icon asset.

## How the pipeline works

Each card in the `CARDS` constant supports two image paths:

```js
{
  art_path:  'assets/items/<id>.png',          // full square card art (REQUIRED)
  icon_path: 'assets/item-icons/<id>.png'      // transparent armory icon (OPTIONAL)
}
```

- **`art_path`** is the source of truth for the Pokédex, reveal animation, and card detail modal.
- **`icon_path`** is used only by the Armory's equipped slots.

If `icon_path` is missing OR the file fails to load, the renderer falls back to `art_path` and applies the `.armory-slot--fallback-art` CSS class (heavier vignette + opacity reduction + `mix-blend-mode: lighten`) to suppress the square background as much as possible.

The renderer reads via the `getArmoryIconPath(card)` helper, so the fallback chain is centralized.

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

Each icon should be:

- **Transparent PNG** (RGBA, alpha channel preserved)
- **Isolated object only** — no card frame, no background scene, no border
- **Centered** in the canvas with ~10% padding on each side
- **Readable at small size** — most slots render the icon at 50–86% of a ~120px slot, so the icon needs to be visually clear at ~60–100px
- **No text, no UI, no logos, no captions, no readable letters**
- **Dark fantasy RPG style** matching the existing Awakened art language (Solo Leveling manhwa illustration, gold rim highlights, deep purple shadows, near-black recesses)
- **Compatible with the purple/gold Armory board** — items should have warm gold accents and deep shadows so they read against the panel's dark stone palette

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

The Armory currently falls back to `art_path` for all 9 cards, with the heavier fallback CSS treatment applied. This intentionally reduces ugliness but does NOT fully solve the square-background problem. The premium solution is transparent icons — this file is the canonical specification for the icon generation work.
