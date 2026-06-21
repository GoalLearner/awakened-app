# W447 — Co-op Duo Boss Art Prompts (The Gaunt Wardens · The Sundered Choir)

Midjourney prompts for the two W447 dual-condition co-op bosses + their 8 armor
drops. **Same house rules as W397–W402** (see `SPRINT-W397-W402.md §4`):

- ~1254×1254 **square, full-bleed, NO background removal** — the dark background IS
  the look (it blends into the dark UI).
- **No readable text** — MJ bakes garbled letters; every prompt ends with
  `no text no letters no words --ar 1:1 --style raw --v 6`.
- Items = **empty armor, no wearer, no floor, painterly (not photoreal 3D)** on a
  near-black vignette (the "greaves regen" lesson — MJ otherwise renders gear worn
  by a person on a lit floor).
- Distinct palettes so the new pair reads apart from the precedent:
  **Gaunt Wardens (C)** = bone-white / cold slate-grey / dim ember-amber (a frozen
  vigil). **Sundered Choir (B)** = midnight blue / tarnished silver / cold spectral
  teal-violet (a riven hymn).

## Pipeline (drop → I process → commit)
1. Generate each below in MJ (upscale the chosen variant).
2. Drop the PNGs in the **repo root**, named exactly as the "Drop-as filename"
   column below (e.g. `the-gaunt-wardens.png`, `the_wardens_vigil.png`).
3. Ping me — I run `node scripts/process-boss-art.js` (its `JOBS` list is already
   pre-staged for these 12). It resizes to the 1254 house box (bosses keep aspect;
   items square-padded by edge-copy), PNG-compresses (no bg-removal), writes each to
   `assets/…`, and archives the heavy original to gitignored `art-originals/`. Then
   I commit. Partial drops are fine — missing files are skipped.

Until art lands, boss cards fall back to a gradient + empty frame and the summons
hero reuses the Twin-Maw cinematic, so both bosses are already fully playable.

Output paths (boss = id with underscores→hyphens via `getBossArtPath`; items keep
underscores via `art_path`):

| Asset | Drop-as filename | Final committed path |
|---|---|---|
| Gaunt Wardens — portrait | `the-gaunt-wardens.png` | `assets/bosses/the-gaunt-wardens.png` |
| Gaunt Wardens — summons | `the-gaunt-wardens-summons.png` | `assets/bosses/the-gaunt-wardens-summons.png` |
| Sundered Choir — portrait | `the-sundered-choir.png` | `assets/bosses/the-sundered-choir.png` |
| Sundered Choir — summons | `the-sundered-choir-summons.png` | `assets/bosses/the-sundered-choir-summons.png` |
| Warden's Vigil (ultra, body, ranger) | `the_wardens_vigil.png` | `assets/items/the_wardens_vigil.png` |
| Stairwalker's Treads (rare, boots, ranger) | `the_stairwalkers_treads.png` | `assets/items/the_stairwalkers_treads.png` |
| Famished Circlet (rare, helm, mage) | `the_famished_circlet.png` | `assets/items/the_famished_circlet.png` |
| Gaunt Mantle (rare, cape, mage) | `the_gaunt_mantle.png` | `assets/items/the_gaunt_mantle.png` |
| Choirmaster's Vestment (ultra, body, mage) | `the_choirmasters_vestment.png` | `assets/items/the_choirmasters_vestment.png` |
| Discordant Crown (rare, helm, mage) | `the_discordant_crown.png` | `assets/items/the_discordant_crown.png` |
| Sundered Grips (rare, gloves, ranger) | `the_sundered_grips.png` | `assets/items/the_sundered_grips.png` |
| Antiphon Striders (rare, boots, ranger) | `the_antiphon_striders.png` | `assets/items/the_antiphon_striders.png` |

---

## BOSSES

### 1 · The Gaunt Wardens — portrait → `assets/bosses/the-gaunt-wardens.png`
```
Dark fantasy boss portrait, ~1254px square, full-bleed, single centered subject: a pair of towering gaunt sentinel-wardens standing eternal vigil where a long flat moonlit road meets the foot of an endless spiral stair. Two emaciated armored guardians, skeletal frames draped in tattered ash-grey vigil cloaks and dull tarnished plate worn thin by centuries of watching, hollow shadowed faces beneath drooping hoods, one warden's empty gaze cast low down the deserted road, the other's lifted toward the climbing stair vanishing into mist above. Each grips a tall iron pole-lantern guttering with cold amber flame, the only warmth in a frozen grey gloom. Starved, patient, merciless keepers who let the long road and the high stair cull all who would pass. Cinematic dark-fantasy painterly illustration, ultra detailed, high contrast, dramatic volumetric moonlight and faint amber lantern glow cutting through cold drifting mist, palette of bone-white, cold slate-grey and dim ember-amber, drifting ash motes and frost in the air, ominous solemn dread, atmospheric dark background of ruined road and rising stair, no text no letters no words --ar 1:1 --style raw --v 6
```

### 2 · The Gaunt Wardens — summons splash → `assets/bosses/the-gaunt-wardens-summons.png`
```
Cinematic dark-fantasy key-art summons splash, ~1254px square, full-bleed, two towering gaunt sentinel-wardens looming OUT of darkness toward the viewer, low upward camera angle. A pair of skeletal armored guardians in tattered ash-grey vigil cloaks and worn tarnished plate, hollow shadowed faces beneath drooping hoods, raising tall iron pole-lanterns that flare with cold amber fire as they bar the way — one rooted on a flat moonlit road, the other upon the first steps of an endless rising stair behind them. Kicked-up dust and frost in the air, swirling ash and ember sparks, cold mist rolling at their feet, a sense of two relentless wardens converging to block the path. Heroic and ominous epic mood, deep slate-grey and midnight gloom slashed by warm amber lantern rim-light, dramatic volumetric god-rays through drifting fog, painterly concept art, ultra detailed, high contrast, dark vignetted edges keeping focus dead-center on the two figures, no text no letters no words --ar 1:1 --style raw --v 6
```

### 3 · The Sundered Choir — portrait → `assets/bosses/the-sundered-choir.png`
```
Dark fantasy boss portrait, ~1254px square, full-bleed, single centered subject: the Sundered Choir, a towering robed cantor-spirit riven down the middle into two mirrored halves that drift slightly apart, joined only by ribbons of cold spectral song. Tall figures in heavy tattered choir-robes of deep midnight cloth threaded with tarnished silver, faces hidden behind smooth featureless porcelain-pale masks with mouths frozen open mid-hymn, from which pour twin streaming currents of luminous sound made visible — one current spilling low and level into a dark flat hall, the other spiraling upward along an endless stair behind them. Shattered fragments of a single mask and crown hover suspended in the gap between the two halves. Cold spectral teal and violet light, pale silver rim, an eerie cerebral choir of two voices that never meet. Cinematic dark-fantasy painterly illustration, ultra detailed, high contrast, dramatic volumetric light, drifting motes and pale mist, ribbons of glowing sound coiling through the gloom, ominous sorrowful grandeur, atmospheric dark background of flat hall and rising stair wreathed in fog, midnight-blue tarnished-silver and spectral teal-violet palette, no text no letters no words --ar 1:1 --style raw --v 6
```

### 4 · The Sundered Choir — summons splash → `assets/bosses/the-sundered-choir-summons.png`
```
Cinematic dark-fantasy key-art summons splash, ~1254px square, full-bleed, the Sundered Choir rising and splitting toward the viewer, a monumental robed cantor-spirit torn into two mirrored halves drifting apart, looming over a low upward camera. Two towering masked singers in tattered midnight choir-robes threaded with tarnished silver, smooth featureless pale masks, mouths flung open releasing violent twin torrents of luminous spectral sound that blast outward toward the viewer — one torrent sweeping low across a dark flat floor, the other erupting up an endless spiral stair behind them. Shattered crown-fragments and glowing rune-less motes flung through the air, cold mist and silver embers streaking forward with the surge of the hymn. Heroic terrifying epic mood, deep violet and teal gloom slashed by pale silver rim-light and a cold spectral glow flaring between the two halves, dramatic volumetric god-rays through fog, painterly concept art, ultra detailed, high contrast, dark vignetted edges centered on the riven figure, no text no letters no words --ar 1:1 --style raw --v 6
```

---

## ITEMS — The Gaunt Wardens (C) · ranger = FOCUS, mage = INT · ashen palette

### 5 · Warden's Vigil — ULTRA · body · ranger → `assets/items/the_wardens_vigil.png`
```
A single empty suit of a sentinel-warden's light cuirass, no body no person no floor, floating upright and perfectly centered as a dark-fantasy game item icon, ~1254px square, full-bleed, on a pure near-black atmospheric vignette background. A lean agile breastplate of weathered grey steel and lashed boiled leather, worn paper-thin across the chest from centuries of standing watch, fitted for a swift archer rather than a heavy knight, edged with pale frost-rimed bone studs and a high collar of tattered ash-grey cloak draped over the shoulders. Faint cold amber light glows deep in the seams like a guttering lantern banked within the steel. Hairline scratches, hunting nicks, vigil-worn patina. Cinematic dramatic volumetric lighting, cold rim light sculpting the frosted edges against deep shadow, painterly ultra-detailed rendering not photoreal 3D, high contrast, drifting mist and faint cold embers, moody palette of bone-white, cold slate-grey and dim ember-amber, hero-object icon framing, sharp focus, AAA dark fantasy RPG inventory art, empty armor no wearer, no text no letters no words --ar 1:1 --style raw --v 6
```

### 6 · Stairwalker's Treads — RARE · boots · ranger → `assets/items/the_stairwalkers_treads.png`
```
A single empty pair of ranger's climbing boots, no body no person no floor, floating and centered as a dark-fantasy game item icon, ~1254px square, full-bleed, on a pure near-black atmospheric vignette background. Tall supple boots of scuffed grey leather and lashed sinew, the soles ground utterly flat and smooth by a thousand flights of stairs, reinforced with worn bone toe-caps and frost-rimed buckles, a high tattered ash-grey cuff folding loosely at the calf. A faint cold breath of mist curls at the heels. Cinematic dramatic volumetric lighting, cold rim light raking the worn leather against deep shadow, painterly ultra-detailed not photoreal, high contrast, drifting mist and faint embers, moody palette of bone-white, slate-grey and dim ember-amber, hero-object icon framing, sharp focus, AAA dark fantasy RPG inventory art, empty boots no wearer, no text no letters no words --ar 1:1 --style raw --v 6
```

### 7 · Famished Circlet — RARE · helm · mage → `assets/items/the_famished_circlet.png`
```
A single empty arcane circlet-helm, no body no person no floor, floating centered as a dark-fantasy game item icon, ~1254px square, full-bleed, on a pure near-black vignette background. A gaunt skeletal circlet of tarnished pale metal, its thin hollow spires curving inward like starved ribs toward an empty centre that radiates a hungry cold violet-blue mind-light from within. Faint frost crusts the metal edges, a few dim amber sparks die against the cold arcane glow, wisps of pale mist coil beneath it. An eerie cerebral relic that seems to hunger for thought itself. Cinematic dramatic volumetric lighting, painterly ultra-detailed not photoreal, high contrast, rich blacks, glowing violet-blue rim light, drifting motes, moody palette of ashen grey, frost-white and cold arcane violet, hero-object icon framing, empty circlet no wearer, no text no letters no words --ar 1:1 --style raw --v 6
```

### 8 · Gaunt Mantle — RARE · cape · mage → `assets/items/the_gaunt_mantle.png`
```
A single empty tattered mage's mantle, no body no person no floor, floating and centered as a dark-fantasy game item icon, ~1254px square, full-bleed, on a pure near-black vignette background. A threadbare hooded cape of thin ash-grey cloth worn to gauze at the hem, drifting as if caught in a slow cold wind, its frayed lower edges dissolving into wisps of mist and faint starlight, a tarnished clasp at the throat set with one dim cold-blue gem glowing softly. Scattered pinpricks of pale starlight are caught in the weave like a captured night sky. Cinematic dramatic volumetric lighting, cold spectral rim light, painterly ultra-detailed not photoreal, high contrast, drifting mist and pale motes, moody palette of ashen grey, frost-white and cold arcane blue, hero-object icon framing, empty cloak no wearer, no text no letters no words --ar 1:1 --style raw --v 6
```

---

## ITEMS — The Sundered Choir (B) · richer silver/spectral palette

### 9 · Choirmaster's Vestment — ULTRA · body · mage (best-in-slot) → `assets/items/the_choirmasters_vestment.png`
```
A single empty choirmaster's arcane vestment, no body no person no floor, floating upright and perfectly centered as a dark-fantasy game item icon, ~1254px square, full-bleed, on a pure near-black atmospheric vignette background. A magnificent heavy robe-vestment of deep midnight cloth threaded with tarnished silver filigree and cold violet embroidery, a high stiff collar and layered mantle marking a cantor of immense power, the open front breathing faint luminous ribbons of spectral sound made visible — coiling silver-teal light pouring softly from the hollow where a chest would be. Shattered fragments of a silver mask hover at the shoulders. A best-in-slot legendary aura, ornate and otherworldly. Cinematic dramatic volumetric lighting, cold spectral rim light, painterly ultra-detailed not photoreal, high contrast, rich blacks, drifting motes and ribbons of glowing sound, moody palette of midnight blue, tarnished silver and cold spectral teal-violet, hero-object icon framing, empty robe no wearer, no text no letters no words --ar 1:1 --style raw --v 6
```

### 10 · Discordant Crown — RARE · helm · mage → `assets/items/the_discordant_crown.png`
```
A single empty discordant crown, no body no person no floor, floating centered as a dark-fantasy game item icon, ~1254px square, full-bleed, on a pure near-black vignette background. A crown forged of two clashing halves fused at a jagged central seam — one half cold bright silver, the other dark tarnished iron — their mismatched spires meeting in a harsh broken line, radiating a faint dissonant violet-and-teal glow from the fracture as though two notes sound at once and refuse to resolve. Hovering shards orbit the seam, cold mist coils beneath, a few dim sparks flicker against the spectral light. An eerie relic of fused dissonance. Cinematic dramatic volumetric lighting, painterly ultra-detailed not photoreal, high contrast, rich blacks, glowing violet-teal rim light, drifting motes, moody palette of silver, dark iron and cold spectral teal-violet, hero-object icon framing, empty crown no wearer, no text no letters no words --ar 1:1 --style raw --v 6
```

### 11 · Sundered Grips — RARE · gloves · ranger → `assets/items/the_sundered_grips.png`
```
A single empty pair of archer's gauntlets, no body no person no floor, floating centered as a dark-fantasy game item icon, ~1254px square, full-bleed, on a pure near-black vignette background. Lean fingerless shooting gloves of supple dark leather and tarnished silver scale, reinforced across the knuckles and the three draw-fingers, bound with braided sinew cord, faint cold teal light tracing the stitching as if quietly keeping time to a silent rhythm. Frost-rimed edges, hunting wear, precise disciplined craftsmanship. Cinematic dramatic volumetric lighting, cold spectral rim light raking the leather and silver against deep shadow, painterly ultra-detailed not photoreal, high contrast, drifting mist and faint motes, moody palette of dark leather, tarnished silver and cold spectral teal, hero-object icon framing, empty gloves no wearer, no text no letters no words --ar 1:1 --style raw --v 6
```

### 12 · Antiphon Striders — RARE · boots · ranger → `assets/items/the_antiphon_striders.png`
```
A single empty pair of ranger's striding boots, no body no person no floor, floating centered as a dark-fantasy game item icon, ~1254px square, full-bleed, on a pure near-black vignette background. Tall lean boots of dark supple leather and tarnished silver fittings, a deliberately mismatched matched pair — one boot's sole worn flat for level ground, the other's reinforced and lightly clawed for endless climbing — bound with braided sinew and frost-rimed buckles, faint twin currents of cold teal and violet light tracing each boot in call and response. A wisp of pale mist curls at the heels. Cinematic dramatic volumetric lighting, cold spectral rim light, painterly ultra-detailed not photoreal, high contrast, drifting mist and faint motes, moody palette of dark leather, tarnished silver and cold spectral teal-violet, hero-object icon framing, empty boots no wearer, no text no letters no words --ar 1:1 --style raw --v 6
```
