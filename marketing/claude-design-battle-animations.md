# Claude Design brief: the Ascent's move animations (every move its own motion)

Owner ask 2026-11-06: "add more animations for different unique attacks / defenses / etc so it just doesn't
look like a lunge.... interactive animations would be amazing."
Paste everything below the line into the SAME Claude Design project as "The Ascent - Battle Redesign"
(handoff 5), so it reuses that stage, art and tokens. Attach two or three battle screenshots from build 618
or later (one mid-attack, one on a guard turn).
Port notes for later: everything here is presentation. The engine (W1135-W1139) decides the move,
hit/miss/dodge, crit, damage, KO, statuses, counters and the foe's intent before a frame plays; every
"interactive" idea must be cosmetic and skippable, and the sim/balance stays untouched. Port targets: the
attacker's `.spr` keyframes (today per family via `_PKB_ATK_FAM`/`_PKB_ATK_MS`; the design asks for per move
id), the `.pkb-vfx` strike layer (`_pkbStrikeFx`, today per glyph), the `.pkb-rfx` reaction overlay
(`_pkbReactFx`/`_pkbFocusFx`), the W1140 counter beats in `_pkbBeat`, the `.pkb2-cutin` ultimate. `_PKB_T`
and `_pkbAfter` scale every duration under the 2x pill; reduced motion collapses animations, not holds.
Port by the design's SHAPE vocabulary (one keyframe set per shape, a map from move id to shape + layers),
never 45 bespoke animations.

---

Give every move in the Ascent of Awakened: Habit RPG its own animation. The battle screen you designed
("The Ascent - Battle Redesign") is live on iPhone: hunter bottom-left, foe upper-right, the foe's painted
art as the stage, the HP band, the foe-intent badge, the Surge meter, the move cards. What is still flat is
the action itself.

WHAT IT LOOKS LIKE TODAY
Every attack is the same 20-pixel lunge: the fighter slides toward the enemy and tilts, a slash arc or a
small arrow or orb appears at the target, sparks, the number pops, the bar drains. Six "weapon family"
wind-ups exist underneath (sword chop, dagger dash, shield shoulder-charge, bow draw, staff rise, execute
dash), but all six are a slide-and-tilt of the same flat picture, so players read every one of them as "a
lunge". Defensive and support moves all look alike too: the fighter squats and a ring appears. The goal:
a player should know which move was used with the sound off.

WHAT THE FIGHTERS ARE (design around this)
- Both fighters are single flat PNG paintings. No skeleton, no sprite sheet, no frames, and the hunter's
  look is assembled from skins, so there is no per-weapon art. Every animation is built from three things:
  whole-figure motion (slide, tilt, squash and stretch, skew, afterimages, flashes); effect layers drawn
  over the stage in SVG/CSS (weapon trails, projectiles, sigils, ground cracks, auras, debris, screen-wide
  washes); and camera (shake, zoom, tilt, hit-stop freeze, white pop, vignette, colour grade). Think
  fighting-game hit sparks and anime impact frames, not rigged characters.
- The hunter faces up-right; the foe faces down-left and uses the same move library, so every animation
  also plays mirrored for the foe.
- Portrait 390 x 844; the stage is the top ~55% of the screen; the cards live in the bottom half.

WHAT IS DECIDED BEFORE ANY ANIMATION PLAYS
The engine already knows the move, hit / miss / dodge, crit, damage, whether it kills, the statuses
applied, any counter (parry, sidestep, ward, reflect, interrupt) and the foe's next intent. Animation never
changes an outcome. For "interactive" that means the player's finger can shape how a move looks, never
what happens.

THE MOVE LIBRARY: one motion each
Moves that share a line today look identical; make every line below unmistakable. power = hit size (1.0 is
a basic strike, 1.5+ reads as HEAVY on the badge); "x3" = three sub-hits; "first" = always acts before the foe.

Melee (sword)
- Slash 1.0: a clean diagonal cut.
- Lunge 1.25: a committed thrust. A straight line, point first; the fighter travels furthest.
- Cleave 1.55 HEAVY: a wide horizontal swing with a long wind-up; dust, and a scar across the ground.
- Crush 1.55 HEAVY: a bone-breaking overhead blow; the whole stage drops a few pixels on impact.
- Hook 1.3 / Jab 0.85: the unarmed pair, a heavy fist and a quick one.
- Oathstrike 1.95 HEAVY: "a vow made steel". Gold light runs up the blade, then a downward verdict.
- Eclipse 1.1 x2: two cuts, one in light (gold) and one in shadow (black with a thin white edge).
- Rend 0.9: a ragged tear that leaves the foe bleeding (drips).
- Reckoning 1.05 EXECUTE: brutal below 30% foe HP. A crimson cross-slash with the stage dimmed; it must
  not be mistaken for Oathstrike.

Dagger
- Flurry 0.5 x3: three fast cuts.
- Quickstep 0.7, first: a blink-step; the strike lands before the foe has moved.
- Thousand Cuts 0.45 x4: a storm of blades; the fighter is a blur.
- Evade (stance): 40% dodge for 2 turns. A ghost split: an afterimage steps aside.

Fire
- Ember 0.7: a cut that opens a bleeding wound.
- Searing Cut 1.1: a cut that smoulders (burn).
- Immolate 1.6 HEAVY: the foe is engulfed (burn). Fire climbs the figure, embers rise.

Shield / blunt
- Sunder 0.8: a shield bash that shreds armor -25%. Plates crack, shards fly off the foe.
- Stagger 0.9: stuns; the foe skips a turn. A blunt hit, then stars.
- Quake 1.2: the ground cracks under the foe; armor -20%.
- Willbreak 0.85: the foe's attack -25%. Something leaves them: sagging arrows, a drained tint.
- Ward Strike 0.7: strike and mend; a green return to the caster.

Magic (staff)
- Arcane Bolt 1.0: a bolt of raw mana (a violet projectile).
- Force Wave 1.55 HEAVY: a crushing wave that sweeps the whole stage.
- Shatter Hex 1.2: a hex sigil forms on the foe and shatters; armor -20%.
- Siphon 0.7: a drain. A tether from the foe to the caster, red turning green; a small heal.
- Cataclysm 1.95 HEAVY: "the heavens answer". Something falls from above the stage.
- Ruin 1.05 EXECUTE: "what is broken, breaks".
- Dispel (stance): unravel afflictions and ward; threads come off the body.
- Mana Ward (stance): glyphs blunt the blows, take 35% less for 2 turns. A dome of runes.

Ranged (bow)
- Quick Shot 1.0: a clean shot.
- Arrow Volley 0.5 x3: three arrows in a breath.
- Snap Shot 0.7, first: looses before the foe moves.
- Flame Arrow 1.1: a shaft wrapped in fire (burn).
- Heartseeker 1.95 HEAVY: one arrow, one heart. A long draw, a single line, a frozen frame.
- Piercing Shot 1.05 EXECUTE: through the crack in the armor.
- Pinning Shot 0.8: pins the foe; they skip a turn.
- Tumble (stance): roll aside, 40% dodge for 2 turns. The figure rolls low through a full turn.

Support (every one of these is "squat plus ring" today)
- Guard: brace, take 40% less for 3 turns. A kite-shield of light plants in front.
- Brace: take 35% less for 2 turns. Heels dig in, the body compresses, the ground cracks under the feet.
- Refuse: guard AND shed afflictions. The afflictions burn off as embers, then a white ward ring.
- Bulwark: brace, empower and cleanse for 3 turns. The big support move: three beats in one.
- Focus: hits land 40% harder for 3 turns. An inhale: motes pull in, the body swells, a glint.
- Temper: "stoke your fury", +40%. Heat shimmer, red embers rising. It must not look like Focus.
- Last Vow: restore 40% HP. Gold light rains upward.
- Struggle: the foe's fallback when everything is on cooldown. A weak, graceless swipe.

Which moves appear together (a hunter's weapon carries four; keep the four distinct from each other):
Titan Oathblade: Cleave, Sunder, Bulwark, Oathstrike. Nightfall Blade: Eclipse, Oathstrike, Immolate,
Temper (+ Reckoning). Duskforge Greatblade: Cleave, Oathstrike, Immolate, Bulwark (+ Reckoning).
Hammerfall Warmaul: Crush, Stagger, Brace, Quake. Kilnforged Warblade: Searing Cut, Ember, Bulwark,
Immolate. Ten Thousand Step Blade: Flurry, Quickstep, Evade, Thousand Cuts. Vessel of Refusal: Ward Strike,
Refuse, Willbreak, Last Vow. Aetherspire / Reverie Staff: Arcane Bolt, Cataclysm, Immolate, Siphon (+ Ruin).
Wraithwind Bow: Heartseeker, Arrow Volley, Flame Arrow, Quick Shot (+ Piercing Shot). Vigil Bow:
Heartseeker, Arrow Volley, Flame Arrow, Tumble. Starter blade: Slash, Lunge, Guard, Focus.
Foes use the same moves by archetype: aggressor (Cleave, Sunder, Slash, Focus), glass cannon (Oathstrike,
Cleave, Slash, Temper), sentinel (Arcane Bolt, Mana Ward, Dispel, Siphon), juggernaut (Force Wave, Mana
Ward, Dispel, Shatter Hex), trickster (Arrow Volley, Snap Shot, Tumble, Flame Arrow), balanced (Slash,
Guard, Focus, Lunge).

THE READS (in the game since this week; the visuals are thin)
When the hunter answers the intent badge correctly, the engine plays a counter. Each needs a signature:
- PARRY (a guard move, or the Surge bar, against a HEAVY): the foe's heavy is caught. A clash at the meeting
  point, a fan of white sparks, both fighters jolt, the foe recoils, then the hunter's riposte lands. The
  Surge-bar parry should look different from a Guard parry: lightning catches the blade.
- SIDESTEP (a dodge move against a HEAVY or a CURSE): the foe's strike passes through an afterimage where
  the hunter stood.
- WARD (a guard move against a CURSE): the curse splashes off a dome and dies.
- REFLECT (a cleanse against a CURSE): the curse's sigil is caught, turned and flung back; it lands on the foe.
- INTERRUPT (any hit against a CHARGE): the foe's swelling power-up aura shatters mid-swell.
Every read ends with "PERFECT READ +15%" on the Surge bar (that exists).

THE BIG MOMENTS
- The ultimates (after the existing full-screen cut-in), one per fighting style, each a 2 to 2.5 second
  sequence: Sundering Verdict (melee, "everything the climb taught you, in one blow"), Starfall (magic, "the
  sky comes down on one foe"), Heartpiercer Rain (ranged, "a hundred arrows, one heartbeat").
- The execute line in its kill window (Reckoning, Ruin, Piercing Shot): the stage dims, crimson and gold,
  a longer freeze.
- The boss break at half HP on floors 10-90: the boss changes visibly and says one line; no stat change.
  It should feel like the fight turned.
- The KO: the finishing hit (a longer freeze, speed lines, a heavy haptic) and the fall.

AMBIENT STATUS LOOPS (between turns; cheap; looping)
Burning smoulders, bleeding drips, stunned has stars, shredded armor shows cracks, attack-up hums, braced
has a faint shield edge, evasive flickers. Design them as one set so they read together on the body and on
the status chips.

INTERACTIVE ANIMATIONS (the owner's wish; all cosmetic, all skippable, never a timing test that changes a
result)
1. Press-and-hold heavies. Holding a HEAVY card (Cleave, Crush, Oathstrike, Immolate, Force Wave,
   Cataclysm, Heartseeker) winds the fighter up for as long as the thumb stays down: the stage darkens, the
   aura grows, a tension line hums; releasing swings. A plain tap plays the same move at normal speed. The
   damage is identical either way.
2. Tap along with the ultimate. During Heartpiercer Rain, Starfall or Sundering Verdict, every tap on the
   stage adds a burst (an extra arrow, an extra star, an extra echo of the blow). The number does not change.
3. Catch the parry. When a parry is coming (the hunter chose a guard move and the badge said HEAVY), the
   foe's wind-up has a visible beat; tapping the stage on that beat gives a brighter clash and a PERFECT
   stamp; not tapping gives the normal clash. Nothing about the damage changes, and the screen must not
   suggest it did.
Say which of the three you would cut, and why. Keep tap-anywhere-to-skip and the 1x/2x pill.

RULES
- iPhone portrait, 390 x 844. iOS 15 WebKit: no CSS color-mix(), no :has(). Animate transform, opacity and
  filter only; no layout animation; no canvas or WebGL. CSS keyframes, inline SVG and a handful of DOM nodes,
  so each effect drops into the live screen's layers. Every effect cleans itself up within about 1.2 s
  (ultimates about 2.5 s); about 40 nodes per effect at most.
- Timing budget per hit: wind-up 150-400 ms, travel or strike up to 350 ms, impact up to 300 ms plus a
  hit-stop freeze of 80 ms (140 on a crit, 240 on a kill), then the HP drain (450 ms). Fights are 4-8 turns
  and a floor stays under a minute. The 2x pill halves everything.
- Reduced motion: every animation has a calm version (a flash and the number).
- The same screen runs Ranked PvP duels against real hunters, so the move animations must not depend on the
  Surge meter or the intent badge.
- Keep the dark painted look and the tokens from the Battle Redesign: gold #f5b842; class red #ef4444, blue
  #3b82f6, green #22c55e; reads teal #5eead4; curses violet #a78bfa; fire #f0904a; arcane #c084fc; frost
  #7dd3fc; Cinzel, JetBrains Mono, Cormorant Garamond italic.
- Never write "fell" or "felled". No instructions on screen.

DELIVER
1. An interactive HTML prototype on the Battle Redesign stage with a move picker: every move above playable
   on demand; toggles for hunter or foe as the attacker, hit / crit / miss / dodge, kill, 2x, reduced
   motion; plus the five reads, the three ultimates, the boss break and the KO.
2. A motion vocabulary: 10-14 named strike SHAPES (for example arc-slash, thrust, overhead, sweep, cross,
   bolt, volley, rain, wave, drain-tether, sigil-shatter, ground-crack) and the LAYERS they use (trail,
   projectile, impact burst, debris, aura, sigil, ground, camera); then a MAP with one row per move: body
   motion, shape, layers, tint, wind-up / travel / impact / recover in ms, haptic (light, medium, heavy), and
   a sound slot name. This map is what gets built. Two moves on the same row will look the same, so make the
   rows differ.
3. The three interactive ideas, working, each with: what the player does, what they see, what does not
   change.
