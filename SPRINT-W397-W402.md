# Sprint W397–W399 — combat buff + two duo bosses (final handoff)

All committed + pushed to `main`. Three commits:
- **W397** — Focus/Guard buff
- **W398** — The Coursing Dread (C) + The Hollow Sovereign (B) + flights engine
- **W399** — renamed Hollow Sovereign → **The Hollow Monarch**; both pools reworked to **mage/ranger**

This file supersedes SPRINT-W397-W398.md.

---

## 1. The two bosses (final state)

| Boss | Rank | Goal | Reward | Drops (all mage/ranger) |
|---|---|---|---|---|
| **The Coursing Dread** | C | 18,000 combined **steps** / 24h | 100 souls | Houndsfang Recurve (ranger), Coursing Houndcall (mage), **The Long Pursuit** (ranger ultra) |
| **The Hollow Monarch** | B | 20 combined **flights** / 24h | 200 souls | The Monarch's Writ (mage), Crownpiercer (ranger), **The Hollow Crown** (mage ultra) |

Both run through the existing Pacts dashboard / banner / summons. The Monarch is the first co-op boss scored on **flights of stairs** instead of steps.

---

## 2. Deploy — backend FIRST, then ship the app

Backend is **code-only, NO migration** (flights reuse existing `event_type`/`metric` columns).
Deploy the backend **before** the new app reaches users, or creating these hunts returns `UNKNOWN_BOSS`.

**Backend (Terminal on the Mac):**
```
( set -e
  cd /Volumes/AwakenedDev/repos/awakened-app
  git pull
  npm --prefix backend run deploy )
```

**Then the iOS app:**
```
( set -e
  cd /Volumes/AwakenedDev/repos/awakened-app
  git pull
  bash scripts/prep-local-build.sh )
```
…then Xcode → bump Build → Product → Archive → Distribute. (Web users auto-update: sw v5.732, app.js?v=841, build 2.2.8-w399.)

---

## 3. ⚠️ One thing to decide: weapon balance

A balance pass flagged the new C/B weapons as **stronger than the E-tier Twin Maw pool**. That's intentional (Rendell's "more power to close the floor-60 gap"), so I left them — but if you want a smoother tier curve, the trims are:

| Weapon | Now (primary) | Smoother |
|---|---|---|
| Houndsfang Recurve (C rare) | focus 8 | focus 6–7 |
| Coursing Houndcall (C rare) | int 8 | int 6–7 |
| The Long Pursuit (C ultra) | focus 12 | focus 10–11 |
| The Monarch's Writ (B rare) | int 11 | int 9–10 |
| Crownpiercer (B rare) | focus 11 | focus 9–10 |
| The Hollow Crown (B ultra) | int 15 | int 13–14 (optional) |

Within each pool the ultra already beats its rares, and total power goes E < C < B — so this is polish, not a bug. Your call; say the word and I'll apply any row.

selfTest stays 37/37 regardless (these are stat items, not the Ascent weapons).

---

## 4. Midjourney art prompts (final — critiqued for baked-text + style)

House rules baked in: ~1254×1254 square, full-bleed, **no background removal**, **no readable text** (MJ bakes garbled letters), each ends with `--ar 1:1 --style raw --v 6`. Drop each PNG at the exact path shown. Until then, cards/heroes fall back gracefully (boss cards → gradient+emoji; summons hero → the Twin Maw cinematic).

### Boss portraits

**`assets/bosses/the-coursing-dread.png`**
```
Dark fantasy creature portrait, ~1254px square, full-bleed, single centered subject: a relentless pursuit-predator, a long low sinewy hound-like horror with an unnaturally elongated spine and too many gaunt legs, frost-burned hide cracked with hoarfrost and pale rime, ribs and tendons taut beneath ashen skin, a narrow eyeless snout split wide with frost-blackened fangs, cold glowing lantern eyes burning pale ember-orange in deep sockets, captured mid-stride in a low loping gait across a moonlit ruined road of shattered flagstones, crumbling broken pillars and dead skeletal trees flanking the path, an apex hunter that never sprints and never tires running its quarry down, cinematic dramatic volumetric moonlight cutting through cold drifting mist, deep midnight blues and frost-cyan shadows pierced by ember orange highlights, breath steaming in the frozen air, faint embers and frost particles swirling in the gloom, painterly ultra detailed high contrast ominous menacing atmosphere, dark atmospheric background, no text no letters no words --ar 1:1 --style raw --v 6
```

**`assets/bosses/the-hollow-monarch.png`**
```
Dark fantasy boss portrait, ~1254px square, full-bleed, single centered subject: a hollow crowned king enthroned at the summit of an endless spiral stair high above the clouds. Gaunt regal plate armor with nothing inside it — empty visor and vacant joints breathing faint violet vapor, the suit held upright by sheer relentless will. A cold pale-gold crown floats atop the void where a head should be, dimly luminous and worn. He sits upon a colossal throne of black stone perched at the apex of an impossibly tall spiral staircase that vanishes into mist below, the endless climb culling all who lack the will to ascend. Hundreds of guttering candles ring the throne, their warm flames swallowed by cold pale-gold and deep violet light. Tattered royal mantle drifting like smoke, skeletal gauntleted hands resting on the armrests, a plain hollow scepter angled across his lap. Volumetric god-rays pierce drifting mist, faint embers rising, profound silence and dread. Cinematic dark-fantasy painterly illustration, ultra detailed, high contrast, dramatic chiaroscuro, awe and menace, atmospheric dark cloud-wreathed background, violet and pale gold palette, no text no letters no words --ar 1:1 --style raw --v 6
```

### Summons heroes (cinematic splash — app overlays eyes + vignette)

**`assets/bosses/the-coursing-dread-summons.png`**
```
Cinematic dark-fantasy key-art summons splash, ~1254px square, full-bleed, single centered subject: a monstrous coursing predator-beast exploding OUT of pitch darkness and charging straight toward the viewer, low ground-level camera angle looking up at the oncoming charge. A sinewy quadruped horror — gaunt muscular hound-wolf body of cracked obsidian hide and protruding bone ridges, jaws stretched mid-snarl baring jagged fangs, two blazing molten-orange predator eyes burning like coals, smoking nostrils, claws tearing the earth. Violent motion: kicked-up dust clouds, gravel and grit flung forward, hot ember sparks and streaking speed-blur trails radiating from the body to sell the headlong rush. Heroic and terrifying epic mood. Deep midnight-blue night atmosphere drenched in cold shadow, slashed by warm orange rim-light and a furnace glow flaring behind the beast, dramatic volumetric god-rays cutting through drifting mist and smoke. Painterly concept-art rendering, ultra detailed, high contrast, cinematic depth, dark vignetted edges keeping focus dead-center on the snarling face, embers and haze swirling in the air, no text no letters no words --ar 1:1 --style raw --v 6
```

**`assets/bosses/the-hollow-monarch-summons.png`**
```
Cinematic dark-fantasy key-art summons splash, ~1254px square, full-bleed, single centered towering subject: a monumental hollow crowned king rising from a colossal obsidian throne perched at the summit of an endless ascending stair that vanishes into black void below, looming over the viewer, hollow armored sovereign with an empty void-dark hood and a faintly glowing skeletal visage, a cold jagged crown of frozen flame blazing pale gold and icy violet light from his brow, tattered cloak woven of drifting mist and shadow billowing outward, gauntleted hands gripping the carved armrests as he rises, regal and merciless and impossibly tall, surrounding atmosphere of swirling cold fog and floating candle embers, drifting motes of pale gold light spiraling up the stairway, deep violet and pale gold color palette, cold spectral rim light on the crown and shoulders, dramatic volumetric god rays piercing the gloom, painterly ultra detailed concept art, high contrast, ominous grandeur, dark atmospheric background full of mist and depth, symmetrical heroic composition with clear space around the figure, no text no letters no words --ar 1:1 --style raw --v 6
```

### Weapons — Coursing Dread (C)

**`assets/items/houndsfang_recurve.png`** — ranger bow, rare
```
A single swift recurve hunting bow carved from a slain beast, centered as a dark-fantasy game item icon, ~1254px square, full-bleed, on a dark atmospheric vignette background. The bow's limbs are sculpted from pale curved horn and weathered bone, fang-like recurve tips hooking sharply at each end, lashed with raw sinew and gut-cord wound tight around the grip. A taut sinew bowstring runs lean and aggressive between the tips. Faint silver-blue frost rimes the bone edges and razor curves, tiny ice crystals catching the light. The surface shows hairline grain, hunting scars, and a predatory feral elegance, like a hound caught mid-lunge. Cinematic dramatic volumetric lighting, cold rim light sculpting the frosted edges against deep shadow, painterly ultra-detailed rendering, high contrast, drifting mist and faint cold embers in the gloom, moody desaturated palette of bone-ivory, ash-grey horn, frost-cyan, and dim ember-orange accents. Centered hero object, sharp focus, immaculate craftsmanship, AAA dark fantasy RPG inventory art, no text no letters no words --ar 1:1 --style raw --v 6
```

**`assets/items/coursing_houndcall.png`** — mage focus, rare
```
A single arcane hunting focus centered as a dark-fantasy game item icon, ~1254px square, full-bleed, on a dark vignette background. A horn-and-orb arcane talisman: a curved weathered bone hunting horn bound in tarnished bronze fittings and braided sinew cord, cradling a floating spectral orb of swirling blue spirit-light at its mouth. From the orb erupts a ghostly pack-cry made visible — translucent wisps of pale-blue hound spirits coursing outward in a streaming spectral howl, ethereal jaws and lean phantom forms dissolving into mist. Aged ivory bone, oxidized bronze, hairline cracks glowing with inner azure energy, dangling fang charms and small bone beads. Cinematic dramatic volumetric lighting, painterly, ultra detailed, high contrast, cold blue glow against warm bronze, drifting embers and pale mist, hanging spirit-light particles, atmospheric haze, ominous dark fantasy mood, hero-object icon framing, glowing focal point, no text no letters no words --ar 1:1 --style raw --v 6
```

**`assets/items/the_long_pursuit.png`** — ranger longbow, ULTRA
```
A legendary ranger's longbow strung for an endless hunt, presented as a single centered hero weapon object floating against a dark atmospheric vignette background, dark-fantasy game item icon, ~1254px square, full-bleed. Tall recurved limbs carved from black polished horn, the dark surface threaded with faint glowing ember-orange inlay that pulses like banked coals tracing the wood grain. A taut twisted sinew bowstring catches the light, and trailing motes of warm light drift off the limbs like sparks pulled along in a relentless chase, faint streaks of motion blur suggesting ceaseless pursuit. Subtle predatory detailing near the grip — wrapped leather, bone fittings, a wisp of cold mist curling at the lower nock. Cinematic dramatic volumetric lighting, radiant rim light raking down the horn edges, embers and drifting ash, deep shadowed background with a soft directional glow, painterly dark-fantasy game art, ultra detailed, high contrast, moody and atmospheric, no text no letters no words --ar 1:1 --style raw --v 6
```

### Weapons — The Hollow Monarch (B)

**`assets/items/the_monarchs_writ.png`** — mage scepter, rare
```
A single ornate arcane royal scepter-rod floating upright and perfectly centered, a sovereign decree weapon for a mage, dark-fantasy game item icon, ~1254px square, full-bleed, on a dark atmospheric vignette background of deep charcoal and faint throne-room shadow. Carved from pale champagne-gold and polished black obsidian stone, slender severe regal shaft inlaid with thin gold filigree and cold dark gemstones, crowned head opening into a hollow circlet of bladed gold petals. Above the crown hovers and slowly rotates a purely abstract glowing arcane sigil of authority — radiant intersecting light-arcs and prismatic geometric shapes only, with NO letters, NO numerals, NO words and NO readable runes — casting pale gold and icy violet glow. Cinematic dramatic volumetric god-rays, painterly ultra detailed high contrast, drifting embers and faint mist, soft golden rim light tracing the metal, regal cold and imperious mood, no text no letters no words --ar 1:1 --style raw --v 6
```

**`assets/items/crownpiercer.png`** — ranger crossbow, rare
```
Dark-fantasy game item icon, ~1254px square, full-bleed, a single ornate regicide crossbow floating centered on a deep shadowed vignette background. A long severe king-slaying crossbow forged of cold black iron, swept skeletal limbs curving like the arms of a broken throne, taut blackened bowstring drawn tight. Worked into the heavy stock is a shattered crown motif — fractured spires of tarnished gold and bent iron points splaying outward, jagged broken regalia fused into the weapon's spine. A single cruel barbed bolt loaded and primed, its head a slender armor-piercing spike of polished steel catching a thin sliver of light. Faint ghostly violet glow leaking from the crown's broken hollows, ember flecks and curling cold mist drifting around the limbs. Cinematic dramatic volumetric lighting, cold steel-blue key light raking across the metal with high contrast, painterly ultra detailed surfaces of pitted iron and aged gilding, atmospheric haze, weapon centered and isolated on darkness, no text no letters no words --ar 1:1 --style raw --v 6
```

**`assets/items/the_hollow_crown.png`** — mage crown, ULTRA (best in slot)
```
Epic dark-fantasy game item icon, ~1254px square, full-bleed, a single legendary arcane crown floating weightlessly and centered on a deep shadowed vignette background. A cold empty circlet of blackened gold, its peaks tapering into thin hollow spires that frame nothing but darkness, the metal etched with faint cooled-magma seams. It radiates pale violet-blue arcane mind-light from within its hollow core, an eerie cerebral glow spilling outward in soft volumetric beams. Faint floating crystalline shards orbit the crown, suspended in slow gravity, catching the cold luminescence. Wisps of pale mist and drifting motes coil beneath it; a few dying embers flicker against the cold light for contrast. An ominous regal relic, weightless and abandoned, exuding quiet menace. Cinematic dramatic volumetric lighting, painterly rendering, ultra detailed metalwork, high contrast, rich blacks, glowing rim light, museum-quality fantasy concept art, ornate and otherworldly, no text no letters no words --ar 1:1 --style raw --v 6
```

---

## 5. Verification (all green)
- `sim-ascent` → **selfTest 37/37**; F100 doable on both Ascent weapons.
- `node --check app.js` clean; backend `tsc --noEmit` clean (only pre-existing stale `*.test.ts` mocks).
- 5-agent adversarial pass: leftover-refs / id-wiring / drop-schema / text-coherence all clean; drop-schema confirms every co-op weapon's primary stat is int (mage) or focus (ranger).
- Preview: The Hollow Monarch (B / 20 / "combined flights") and The Coursing Dread (C / 18,000 / "combined steps") render correctly; old `the_hollow_sovereign` id is dead; no console errors.

---

## 6. Boss-art "breathing" pulse (W400)

The new boss portraits get a slow cinematic **breathing zoom + amber glow** (matching the
summons hero), on the dungeon card and the detail hero. Scoped to co-op bosses only —
solo bosses stay static. It's **art-gated**: nothing animates until a real PNG decodes, so
the effect simply switches on the moment you drop `the-coursing-dread.png` /
`the-hollow-monarch.png` into `assets/bosses/`. Honors reduced-motion. Nothing for you to
do — it's automatic once the art lands.

---

## 7. Weapon kits — the floor-60 fix (W401–W402)

You asked whether the new items actually help the floor-60 boss. They do — but I found
and fixed a gap first:

- The Ascent **does** read your equipped item stats (INT→defense, FOCUS→edge, STR→attack).
- **But** the weapon slot also sets your move-kit, and these drops weren't registered, so
  equipping one dropped you to the bare-fists *unarmed* kit — a stat-stick trap. **W401**
  registered all the co-op weapons (incl. Twin Maw) with real kits.
- **W402** sim-tested them and fixed the mage kit (first attempt was a dud — 0.5% at F100).

Final placement (max-build win% by floor, via `Arena.simAscent`):

| Weapon | F60 | F90 | F100 |
|---|---|---|---|
| The Hollow Crown (mage ultra) | 100% | 88% | 41% |
| Crownpiercer / Long Pursuit (ranger) | 100% | ~80% | 41% / 37% |
| aetherspire (canonical mage, ref) | — | — | 57% |
| Nightfall (apex, ref) | — | — | 87% |

So the co-op weapons clear floor 60 outright, hold through ~F90, and sit a clear notch
below the canonical/apex weapons — exactly the mid-tier upgrade you intended. selfTest
stays 37/37.

