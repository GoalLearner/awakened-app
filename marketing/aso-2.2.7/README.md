# App Store Screenshots 2.2.7 — capture canvas

Implements the ClaudeDesign **"App Store Screenshots 2.2.7"** handoff. Renders the
5-shot App Store set at the exact required **iPhone 6.9″ size, 1320 × 2868**, with
the marketing chrome (background bloom + Cinzel headline + titanium device frame)
faithfully reproduced from the design, and the design's **placeholder art swapped
for the real app PNGs**.

## Use it

1. Open `index.html` in **Chrome** (double-click works; or serve the repo and open
   `http://localhost:8080/marketing/aso-2.2.7/index.html`). Needs internet — React +
   Babel load from the unpkg CDN. Give it a second to compile + render.
2. Open DevTools (F12) → Elements.
3. For each of the 5 `.aso-shot` nodes: right-click → **Capture node screenshot** →
   Chrome saves a perfect **1320 × 2868** PNG.
4. Upload to App Store Connect → iPhone 6.9″, in order 1 → 5 (Apple derives the
   smaller iPhone sizes). If trimming, keep 1–3.

## The 5 shots

| # | Headline | Screen |
|---|---|---|
| 01 | Turn your habits into an **RPG**. | Hunter Profile / Home |
| 02 | Battle up **100** floors. | Ascent battle (Floor 59) |
| 03 | A rank is **witnessed**. | Hunter Report share card |
| 04 | Bosses fall to **discipline**. | Boss Defeated share card |
| 05 | Climb the weekly board. | Redesigned Steps leaderboard |

## Art swaps (the "geometric shapes" fix)

The design used documented placeholder art (`ClassSilhouette` / SVG silhouettes).
Replaced with real assets, copied into `assets/`:

- **Hero avatar** → `avatar-paladin.png` (profile shot + Hunter Report card). The
  design maps a hunter's class to `avatar-{class}.png`; RICHIE is a Paladin.
- **Boss** → `the-patient-flame.png` (Boss Defeated poster, shot 4).
- **Shot 2 battle** keeps the design's stylized enemy silhouette — "The Umbral
  Sentinel" is a design-invented Ascent floor enemy with no shipped art. (Swap in a
  real boss + rename the floor if you'd rather.)

## Privacy / App Review

Demo data is baked in — hero **RICHIE**, board aliases **VESPER / ORISON / RHEA /
THANE / LIRA / OSRIC / …**. No real users (rendiesel / anthony / unisono / galilea),
no precise Health values, no PvP. Verified: zero real-alias leak.

## Notes

- Self-contained single file (the design's JSX is inlined; each block is IIFE-wrapped
  to avoid top-level `const` collisions across the design's modules).
- `marketing/` is excluded from the iOS build (sw precache / prep-local-build /
  Capacitor sync), so none of this ships in the app binary.
