# Claude Design prompt — Co-op Hunt DEFEAT screen (duo hunts)

Paste the block below into Claude Design (it already has the Awakened screens,
including the co-op summons / active-hunt / **victory** screens). This designs the
missing twin: the **DEFEAT** state for a two-hunter co-op duo hunt whose 24h window
closed with the combined goal unmet. It's built as the somber mirror of the existing
co-op victory screen so the two read as a matched pair.

Context for why this exists: co-op hunts had a victory screen but **no defeat
screen** — a lost hunt just fell back to the recruit view. W448 added the loss
*notification*; this gives the loss a proper *designed* moment.

## Two choices to set before pasting
- **Boss to feature:** the prompt uses **The Sundered Choir (B — dual: steps AND
  flights)** because it best shows the duo + dual-goal story. Swap to **The Gaunt
  Wardens (C)** or the single-metric **Coursing Dread / Hollow Monarch** if you'd
  rather (drop the second bar for a single-metric boss).
- **Aliases:** hero = **RICHIE** (your account, fine to show); ally = a clearly-demo
  alias **KAEL**. Never a real user (rendiesel / anthony / unisono / galilea).

---

```
You've already designed Awakened's app screens, including the co-op duo-hunt flow —
the summons, the active shared-progress sheet, and the VICTORY screen. Now design its
missing twin: the CO-OP HUNT DEFEAT screen — what TWO hunters see when their 24-hour
shared hunt closes with the combined goal UNMET.

Make it the exact mirror of the existing co-op VICTORY screen — same dark bottom-sheet
shell, same two-hunter framing, same type scale — but in the defeat register: crimson
where victory is gold, "fell short together" where victory is "felled it together." It
is a SHARED loss between allies: supportive, NEVER blaming one hunter. No one failed —
the boss simply outlasted them both.

CANVAS: a single iPhone frame, 393 × 852, thin dark titanium bezel, Dynamic Island,
status bar 9:41 / full battery / full signal. The screen is a dark bottom-sheet (radial
#15132f at top → #07070f), rounded top, a 46×5 grabber, and a mono eyebrow "CO-OP HUNT"
at the top. Behind the sheet, the dimmed dungeon. Standalone frame — no extra app chrome.

BRAND: Cinzel (serif display), JetBrains Mono (labels + numbers), Cormorant Garamond
italic (flavor). Palette: ink #f5f3fb, mute #9090a8, panel #0e0e24, hairline
rgba(255,255,255,0.08); DEFEAT accent crimson #e0564f (deep #7a201c). The two hunters
keep their accents: teal #5eead4 = YOU, violet #a78bfa = ALLY. Gold #f5b842 ONLY on the
small "call again" affordance, sparingly.

CONTENT, top to bottom:
1. The boss, but UNBEATEN: its crest/portrait dimmed and desaturated, with a faint
   intact crimson ward/seal still glowing over it — the boss HELD. A small rank pill
   "B" and the name "THE SUNDERED CHOIR" in muted serif beneath.
2. Kicker "THE CHOIR HOLDS" (mono, +letterspacing, crimson), then the headline
   "THE HUNT FELL SHORT" in Cinzel 700, crimson, big and somber, centered.
3. A flavor line (Cormorant italic, mute): "The window closed. Two voices still sang —
   and you could not silence them both in time."
4. THE SHARED PROGRESS THAT CAME UP SHORT — the duo-defining block. Because this is a
   DUAL-condition hunt, show BOTH goals as two slim bars that stopped just short of
   full, filled in CRIMSON (not gold), each labelled with how close they got:
      COMBINED STEPS    10,400 / 12,000   (~87%)
      COMBINED FLIGHTS       7 / 10        (70%)
   Under each bar, the two-hunter split with teal/violet dots:
      "You 6,100 · KAEL 4,300"     and     "You 4 · KAEL 3"
   The block should read: "we were close — together."
5. A two-hunter footer: two small avatar monograms side by side, YOU (teal ring) +
   KAEL (violet ring), a thin seam between them — partners who fell short shoulder to
   shoulder, still standing together. A mono line beneath: "No relic claimed · the hunt
   resets."
6. CTAs: primary crimson-outline button "CALL AGAIN" (re-invite the same ally);
   secondary ghost "BACK TO THE DUNGEON". No "you lost" shaming — the beat is "rally,
   and go again."

TONE: heavy but hopeful — fellowship over failure, the end of a hard night's hunt, not
a punishment. The somber counterpart to the victory screen.

DEMO DATA ONLY: boss = The Sundered Choir (B-rank duo). Hero = RICHIE (teal / YOU). Ally
= demo alias KAEL (violet). Numbers exactly as above (fell just short on BOTH goals).

Export 393 × 852, PNG, sRGB. Show it beside the victory screen so we can confirm the two
read as a matched win/loss pair.
```

---

## When the mock lands
It implements as `_coopDefeatHtml(inst)` — the sibling of the existing `_coopVictoryHtml`,
swapped in when `inst.status === 'expired' && inst.result === 'defeat'` (today that case
falls through to the recruit "fell short" note). The data is already on the instance:
`combined_steps / goal_steps`, `combined_flights / goal_flights` (dual bosses), and the
per-hunter `challenger/partner` split — so it wires straight in. Strip the standalone
phone-frame chrome on port (per the handoff convention).
