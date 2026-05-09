# CARDS.md — Awakened Boss Card Visual Spec v1

**Status:** Design spec. Not yet implemented.
**Last updated:** May 8, 2026
**Spec lead:** Richie (with Claude as design partner)

---

## Purpose

Bosses in Awakened are presented as **collectible cards** inside
rank-tier dungeon gates. This document defines the visual language
of those cards — frame, layout, states, art requirements.

Companion docs:
- `BOSSES.md` — boss system mechanics, drop tables, framework
- `CLAUDE.md` — operational reference for the codebase

---

## Visual identity

**Aesthetic anchor:** Solo Leveling "system windows" — floating UI
panels with clean dark backgrounds, glowing borders, art bleeding
to edges, info stacked below. **Not** ornate fantasy trading cards.

**Why this direction:** the card needs to live inside an app whose
brand is already minimalist-with-fantasy-accents (gold serif
wordmark, clean shield icon, simple rank pills). Going ornate would
clash. Going pure-utility would lose the collectible energy. The
Solo Leveling system-window approach hits both: premium clarity +
"this is a discovered thing" feel.

---

## Card structure — top to bottom

```
┌──────────────────────────────────┐
│ [E]   THE INSOMNIAC          🌙  │  Header strip (~10%)
├──────────────────────────────────┤
│                                  │
│                                  │
│       BOSS ART (bleed-to-edge)   │  Art region (~45%)
│                                  │
│                                  │
├──────────────────────────────────┤
│  STAT  VIT   ·   CADENCE  Daily  │  Stat strip (~7%)
├──────────────────────────────────┤
│                                  │
│  "A creature born from           │  Flavor (~13%)
│   restless nights."              │
│                                  │
├──────────────────────────────────┤
│ Sleep 7+ hrs · 3 nights in a row │  Kill condition (~8%)
├──────────────────────────────────┤
│  ●  ●  ●     0 / 3 nights        │
│                                  │  Progress (~17%)
│        Defeated: 0 times         │
└──────────────────────────────────┘
```

**Aspect ratio:** 5:7 portrait. Trading-card culturally encoded
proportions. Two cards fit side-by-side at standard mobile width
(roughly 170×238px on iPhone, scaling up to 200×280px on Pro Max).

---

## Region specifications

### Header strip (~10% of card height)

Three elements horizontally:

1. **Rank pill** (left) — square purple pill with rank letter
   (`E`, `D`, `C`, etc.). Reuse existing rank pill component
   for consistency with the rest of the app.

2. **Boss name** (center) — bold gold serif. Same font family as
   "AWAKENED" wordmark. Sized to fit the strip without wrapping.
   Truncate with ellipsis if name exceeds available width.

3. **Boss glyph** (right) — single emoji or unicode symbol
   representing the boss thematically. Decorative, secondary
   read after the rank pill.

| Boss | Glyph |
|---|---|
| The Insomniac | 🌙 |
| The Carouser | 👑 |
| (future bosses) | TBD per boss |

### Art region (~45% of card height)

**Bleed-to-edge.** Boss illustration fills the entire region with no
inner border. Atmospheric background of the art blends visually with
the card's dark interior — the boss should feel embedded in the
card, not pasted on top.

**Aspect ratio of the art window:** roughly 5:5 (square) because the
card width is the constraint. Art generated for cards must be square
or near-square (1:1 aspect ratio).

**Subject framing:** boss centered, torso/upper-body emphasis.
Atmospheric edges fade into dark navy/black to blend with card
background. Avoid full-body wide compositions — they read too small
inside the card window.

### Stat strip (~7% of card height)

Two metadata fields separated by a center dot:

- **STAT** — boss's primary stat domain (VIT, STR, INT, FOCUS, WILL, WLT)
- **CADENCE** — Daily, Weekly, or Monthly

Smaller text. Condensed or monospaced font for consistency. Gold
accent on the values, gray-purple on the labels.

Future expansion: this strip can hold additional metadata as the
system grows (drops collected count, time-to-next-window, etc.).

### Flavor region (~13% of card height)

**Italic gray-purple text.** The short flavor line (one sentence,
not the long version). Centered. No quotation marks needed — the
italic styling signals voice.

Currently:
- Insomniac: *"A creature born from restless nights."*
- Carouser: *"He keeps a long table, and his guests rarely leave."*

### Kill condition (~8% of card height)

Plain-language summary of how to defeat the boss. Subtle gold
underline or accent treatment — this is action info, draw the eye
without screaming.

Examples:
- Insomniac: "Sleep 7+ hrs · 3 nights in a row"
- Carouser: "Sleep 7+ hrs + bed before midnight · all 3 weekend nights"

### Progress region (~17% of card height)

Two layers stacked:

1. **Streak dots** — `streakTarget` count of dots, filled per night
   completed in current streak. Empty dots are dim circles, filled
   dots are gold-glowing. Centered horizontally.

2. **Streak label** — small text after dots: "0 / 3 nights" format.

3. **Kill count** — separate line below: "Defeated: N times". Smaller
   text. Gold trophy icon prefix when count > 0.

---

## Card frame styling

### Borders and background

- **Outer border:** 2px gradient line, deep purple (`#5b21b6`) to
  gold (`#f59e0b`), running clockwise from top-left corner. Subtle
  but defined.

- **Inner background:** dark navy (`#13132a`). Same as app
  background — card "floats" against the parent screen rather than
  being framed by a contrasting backdrop.

- **Section dividers:** thin horizontal lines between regions, at
  ~10% opacity gold. Faint, structural, not decorative.

### Glow and accent effects

- **Active streak glow:** when `streak > 0`, the outer border emits
  a soft purple-gold pulse (CSS box-shadow with animation). Cards
  with streak === 0 are static, no glow. This subtly signals "this
  boss is in progress" at glance scan.

- **Defeated accent:** when `kill_count > 0`, a small gold trophy
  icon overlays the top-right corner of the card AND the outer
  border gets a permanent gold tint (replacing the gradient default).
  Defeated cards should look subtly *earned* without being loud.

### Corner treatment

**Slightly rounded corners** (~6px radius). Not too round (looks
like buttons), not square (looks harsh). Matches existing app
component radii.

---

## Card states

The same card markup renders different states based on boss data.
Each state is a CSS class layered on the base card:

| State | Class | Trigger | Visual |
|---|---|---|---|
| Untouched | (default) | streak === 0, kill_count === 0 | Static, no glow |
| Active | `.card-active` | streak > 0 | Border pulses purple-gold |
| Defeated | `.card-defeated` | kill_count > 0 | Permanent gold border + trophy overlay |
| Locked | `.card-locked` | Boss not yet unlocked by rank | Dimmed, blurred art, lock overlay, "Unlock at [rank]" label |
| Burned | `.card-burned` | The Carouser-specific: `weekend_burned === true` | Desaturated with "Weekend forfeit — opens Friday" overlay |

States can compose: `.card-defeated.card-active` means defeated
before AND currently in another streak. Both visual treatments
apply.

---

## Tap behavior

**Cards are observational. Tapping does nothing.**

The card itself contains all information needed. No detail modal,
no expanded view, no navigation drill-in. The user reads the card
in place and moves on.

This decision is intentional — it keeps the dungeon experience
flat (gate → cards → done) and makes every card a complete unit.

Future iteration could add:
- Subtle pulse animation on tap (visual feedback only)
- Flip animation revealing back-of-card lore/history
- Long-press to share

But not in v1.

---

## Boss art generation requirements

For each new boss, one square illustration is needed:

**Aspect ratio:** 1:1 (square)
**Resolution:** minimum 1024×1024 (DALL-E native)
**Style:** Solo Leveling manhwa illustration
**Subject framing:** boss centered, torso/upper-body emphasis,
  atmospheric edges fading to dark
**Color palette:** Awakened brand purple (`#5b21b6`) + cool gold
  (`#f59e0b`) + near-black backgrounds
**Composition:** no text, no UI, no logos visible in the art
**Background:** atmospheric darkness blending into card's dark
  navy interior at the edges

Each boss gets a unique illustration. Consistent style guide above
ensures the roster reads as one coherent universe.

---

## Implementation notes

### Card frame architecture

**Code-built, not image-based.** The card frame is HTML/CSS/SVG —
not a static frame PNG with art composited inside. Reasons:

1. **Dynamic data.** Streak, kill count, state class all change at
   runtime. Code can render these reactively; PNG can't.
2. **State variants.** Five distinct visual states (untouched,
   active, defeated, locked, burned) need different rendering.
   Each as a CSS class is trivial; as a separate frame PNG would
   require five PNGs per boss.
3. **Future expansion.** Adding new metadata fields (drop counts,
   timers, focus indicators) only requires HTML/CSS changes — no
   re-rendering frame art.

### Per-card data needs

Each card pulls from existing `BOSSES` constant + `hb_bosses`
state. No new schema needed. Required fields per boss:

| Field | Source | Used in |
|---|---|---|
| name | BOSSES[id].name | Header |
| rank | BOSSES[id].rank | Rank pill |
| glyph | BOSSES[id].glyph (NEW field) | Header right |
| statDomain | BOSSES[id].statDomain | Stat strip |
| cadence | BOSSES[id].cadence | Stat strip |
| flavor (short) | BOSSES[id].flavor | Flavor region |
| killCondition | BOSSES[id].killCond | Kill condition region |
| streakTarget | BOSSES[id].threshold | Progress dots count |
| streak | hb_bosses[id].streak | Progress dots filled |
| kill_count | hb_bosses[id].kill_count | Kill count |
| weekend_burned | hb_bosses[id].weekend_burned (Carouser only) | Burned state |
| illustration_path | derived: `assets/bosses/{boss_id}.png` | Art region |

The `glyph` field is new and needs adding to the BOSSES constant.

### Card sizing

Cards render in a 2-column grid inside each gate's interior view.
- iPhone (~390px width): each card ~170px wide, ~238px tall
- iPhone Pro Max (~430px width): each card ~190px wide, ~266px tall

Maintain 5:7 aspect ratio at all sizes.

---

## Open design questions (deferred)

1. **The boss-glyph field.** I've assigned 🌙 (Insomniac) and 👑
   (Carouser). The full roster needs glyphs decided as bosses ship.
2. **Locked card art.** When a boss is locked, what does the art
   region show? Possibilities: (a) silhouette of the boss, (b) a
   generic "?" or sealed mark, (c) sealed gate art. Decide when
   first locked card ships.
3. **Card share/export.** Long-press to share a card image to
   social media (Instagram, X). Future feature.
4. **Animation budget.** Active streak glow, defeated overlay,
   burned state transition — how much animation is appropriate?
   Decide during build.
5. **Drops cards (loot).** When the drops/cards system from
   BOSSES.md ships, dropped item cards will share this visual
   language but have a different layout (no kill condition, no
   progress — different fields). The card frame should be flexible
   enough to accommodate both boss cards and drop cards. Defer
   to drops system design.

---

## Decision log — for future-you

If you find yourself questioning a decision later, here's why
each was made:

- **Self-contained, no tap detail:** the card has all info readable
  at a glance. Drilling deeper adds navigation friction without
  adding info. Cards are observational by design — they reward
  scanning, not interaction.

- **Bleed-to-edge art:** modern digital-native feel. Trading-card
  inset windows feel dated; immersive bleeding art feels premium.
  Hearthstone learned this lesson; we inherit it.

- **Minimal frame:** Awakened's brand is minimalist-with-fantasy-
  accents. Going ornate would clash with the wordmark, the icon,
  the rank pills. The frame stays clean, the art carries the
  fantasy weight.

- **Code-built frame, not image:** dynamic data needs dynamic
  rendering. Five state variants × N bosses = explosion of frame
  PNGs. CSS classes are infinitely cheaper.

- **5:7 aspect ratio:** trading-card cultural encoding. Square
  reads as "tile/icon"; 5:7 reads as "card." Pattern-matching
  matters for engagement.

- **Square art (1:1) inside the card:** the card width is the
  constraint, the art region is roughly square as a result. Art
  needs to be generated to fit this — vertical 4:5 illustrations
  would be wrong shape.

---

*End of v1 spec. Ready to build.*
