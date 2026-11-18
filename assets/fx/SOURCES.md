# assets/fx — battle effects (W1188, 2026-11-11)

Loaded by the battle FX module in app.js (`_bfx*`). Credits and full license texts ship in the app:
Settings > Help & About > Credits & licenses (`openCredits`).

## k-*.png — Kenney Particle Pack 1.1
- Source: https://kenney.nl/assets/particle-pack (PNG (Transparent) set, downscaled to 256 px)
- License: Creative Commons Zero (CC0), public domain. Credit appreciated, not required.
- White shapes; the app tints them with a CSS mask.

## lottie/*.json — LottieFiles free animations
- License: Lottie Simple License (FL 9.13.21), Design Barn Inc. Commercial use allowed; the same
  terms must accompany any distribution (the full text is in the app's Credits & licenses page).
- Flattened from the .lottie downloads to plain Lottie JSON; numbers rounded to 3 decimals, names stripped.

| file | animation | creator |
|---|---|---|
| fire-element.json | Fire Element Effect | Zoro |
| thunder-element.json | Thunder Lightening Element Effect | Zoro |
| red-explosion.json | red explosion | Vinzenz |
| explosion-red-particles.json | Explosion Red Particles | MRouquin |
| explosion-anisimov.json | explosion | Viktor Anisimov |
| poof.json | Poof | SMNV |
| smoke-dust.json | fall smoke dust | Milad Ghiravani |
| sparkles-burst.json | Sparkles burst | Souvik Sur |
| golden-glow.json | Golden Glow | Whitesushi |
| charge-aura.json | Charge Aura | Nareswara Widito |
| fog-smoke.json | Fog / Smoke | Ladon Sklyarov |

## ../../lib/lottie_light.min.js — lottie-web 5.12.2 (light build, SVG renderer)
- Source: https://cdnjs.cloudflare.com/ajax/libs/bodymovin/5.12.2/lottie_light.min.js (SRI-checked against cdnjs)
- License: MIT, Copyright (c) 2015 Bodymovin (notice in the Credits & licenses page).

The full downloaded library (35 animations, 80 particles, 4,239 game-icons) is on the owner's Desktop in
awakened-battle-assets, with LICENSES.txt.

## ss/*.webp — W1237 (2026-11-18): animated sprite sheets
Played frame by frame by `_bfxSheet` (4 frames across, 256 px frames, screen-blended on `.bfx-glow`); the
Kenney clouds by `_bfxSmoke` (CSS grow + fade). Made by the W1237 asset script from the owner's downloads.

- **sw1, sw2, heavy, crit, star, stab, claw, flurry, spin, fire, bolt, boltspin, firespin** — from
  "2D Sword Slash VFX – Spritesheets" by CartoonCoffee (https://cartooncoffee.itch.io), bought by the owner
  2026-11-18. License: use in personal or commercial projects; the files may not be redistributed, sold or
  shared on their own; the owner has the author's written OK by email to ship them in this app.
  Only these 13 effects, downscaled from 512 px to 256 px frames (fire, bolt, boltspin: every 2nd of the
  first 32 frames; firespin: every 3rd of the first 48). Sources: Blue Slash v1, v3, v14, v19, Impact_Cut_V2,
  Stab_V5, Claw Slash v2, Blue Slash v1 - Flurry_A, Blue Slash v1 - Spin_A, Fire Slash v1, Lightning Slash v1,
  Lightning Slash v1 - Spin, Fire Slash v1 - Spin_A.
- **k-boom, k-puff, k-dust** — Kenney Smoke Particles (https://kenney.nl/assets/smoke-particles), CC0:
  Explosion/explosion04, White puff/whitePuff05, Black smoke/blackSmoke08, fit into 256 px.
