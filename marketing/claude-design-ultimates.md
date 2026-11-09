# Claude Design brief: eight new ultimates (earned and chosen)

Owner ask 2026-11-09: "Everyone loves the surge ultimate... I want to create different types of ultimates not just
the surge so that there's different ultimate animations." Owner picks: earned and chosen (unlock, then pick in the
Wardrobe); each with its own damage, animation, name and use; a Claude Design brief first.
Paste everything below the line into the SAME Claude Design project as "The Ascent - Battle Redesign" (handoffs 5
and 6), so it reuses that stage, art, tokens and the Motion Library. Attach two battle screenshots (one with the
Surge full, one mid-ultimate).
Port notes for later: everything here is presentation. The engine (W1168) decides hit / miss / dodge, crit, damage,
the kill, the heal, the stun and the statuses before a frame plays. Port targets: `_PKB_ULT_SEQ[ultId]` (today
`_pkbUltSeq` per style), the W1141 constructors (`_MV.*`, `_mPO` poses, `_mFL` flashes, `_mGL` glows, `cam`,
`wash`, `light`, `bars`, `freeze`), `seq.extra` for the tap-along echo, the cut-in `--ult-c` tint, the Wardrobe
tile emblems, and three new ambient loops (Quicksilver's shimmer, Hellfire's lasting fire, the Dawn ward).

---

Design eight new ultimates for the Ascent in Awakened: Habit RPG. The battle screen ("The Ascent - Battle
Redesign") and the Motion Library you designed are live on iPhone, and players love the ultimate moment: the
Surge meter fills, they tap UNLEASH, the full-screen cut-in names the move, then a 2.5-second sequence lands the
blow. Today there are three, one per fighting style: Sundering Verdict (melee), Starfall (magic), Heartpiercer
Rain (ranged). They stay exactly as they are.

WHAT IS NEW
Hunters now earn more ultimates (from boss kills, shadows and the summit) and choose one in the Wardrobe. Each one
plays differently: different damage, a different effect, and a different moment to use it. So each needs its own
sequence that SELLS what it does. A player should know which ultimate fired, and what it did, with the sound off.

WHAT IS DECIDED BEFORE ANY ANIMATION PLAYS
The engine already knows whether the ultimate hits, misses or is dodged, whether it crits, the damage, whether it
kills, and every effect it applies (heal, stun, burn, ward). Animation never changes an outcome. The existing flow
stays: UNLEASH, then the full-screen cut-in ("ULTIMATE · <KIND>" above the name), then the sequence. The number
lands at one moment, T (the blow). Tap anywhere skips; the 2x pill halves everything; reduced motion gets a calm
version (a flash and the number). Tap-along stays: every tap on the stage during the sequence adds one small echo
(capped), and the number never changes.

WHAT THE FIGHTERS ARE (design around this)
- Both fighters are single flat PNG paintings: no skeleton, no frames. The hunter's look is assembled from skins.
- These ultimates must read with ANY weapon (sword, greatblade, maul, dagger, staff, bow, bare fists). The figure
  only gestures; the power comes from effect layers and the camera. Never draw a specific weapon in the hunter's
  hands.
- Hunter bottom-left facing up-right, foe upper-right. Only the hunter ever uses an ultimate, so nothing plays
  mirrored.
- Portrait 390 x 844; the stage is the top ~55% of the screen.

BUILD FROM THE MOTION LIBRARY YOU ALREADY MADE (this is what gets ported)
- Figure poses: p-aim p-back p-bash p-behind p-buff p-castf p-charge p-compress p-crouch p-crush p-dash p-draw
  p-drawlong p-drop p-hook p-hop p-jab p-jitter p-lean p-leap p-lunge p-plant p-pushed p-raise p-recoil p-recoil2
  p-release p-rise p-roll p-sag p-side p-sink p-sky p-stomp p-sweep p-swell p-swipe p-tiltb p-tiltf p-vanish p-wind
- Layer constructors: slash line star ring crack scar bolt rune fly fan orbit sag threads dome kite pin glyphs
  burst proj (arrow / star / meteor / orb) beam pillar dots charge speed puff blade wipe shim glint dust tens
- Camera: c-small c-shake c-shake2 c-punch c-drop c-rumble, plus the hit-stop freeze. Stage: light (dim / dark),
  a colour wash, a red vignette, letterbox bars. Flashes and glows: white gold red violet teal frost.
- New constructors, poses or loops are welcome, but define each one in full (markup + CSS keyframes) so it drops
  into the same layers.

THE EIGHT (names are working titles; the KIND word goes on the cut-in)
1. Crimson Feast (DRAIN). A strike, and if it lands, the hunter heals 35% of their health. Sell the drain: a blood
   moon or a crimson tether; life visibly pours from the foe into the hunter after the blow. On a miss or dodge the
   tether snaps and nothing comes back.
2. Quicksilver (SWIFT). Always strikes first, before the foe moves this turn, then the hunter is evasive for two
   turns. Sell speed: the moment freezes, silver afterimages, the strike lands while the foe is still winding up.
   End on a silver shimmer that stays on the hunter for two turns (a new ambient loop, distinct from the existing
   evasive flicker). The shimmer happens even on a miss.
3. Hellfire (FIRE). A modest strike, then a fire of its own that burns 12% a turn for four turns, on top of any
   normal burn. Sell the fire that stays: the ground splits under the foe, a column of red-black hellfire, and a
   lasting flame loop on the foe for four turns that must not look like the normal burn's smoulder. On a miss the
   crack opens and closes on nothing.
4. Storm of Blades (BLADES). One big hit that ignores the foe's guard, brace, ward and dodge. Sell the "through
   everything": eight spectral blades circle the foe and cut through a raised shield or ward dome, which visibly
   breaks or is passed through. Eight cuts in a rhythm; the number lands on the last one (T).
5. Worldbreaker (QUAKE). A strike; the foe loses its next move and its armor breaks 30% for three turns. Sell the
   ground: the hunter leaps and slams down, the stage cracks and heaves, the foe staggers with stars and armor
   plates shatter off it. On a miss the quake rolls past the foe.
6. Reaper's Due (EXECUTE). A light strike normally; nearly three times as hard when the foe is under 35% of its
   health. Design TWO endings that share one opening: the normal one (a quick, modest scythe cut) and the kill
   window (the screen drains to monochrome, a giant scythe silhouette, a long freeze, the cut). The engine says
   which one plays. Must not be mistaken for the execute moves (Reckoning, Ruin, Piercing Shot).
7. Arise (SHADOWS). Hits harder for every shadow soldier in the hunter's army (0 to 8+). Sell the army: shadow
   soldiers rise from the ground behind the hunter and charge the foe together. The number of soldiers follows the
   army size: design it with a parameter n and show n = 1, 4 and 8. Use the game's shadow look: violet and black
   silhouettes, the ARISE colour.
8. Dawnbreaker (WARD). A strike, and the hunter is warded for three turns: 40% less damage taken, hits land 40%
   harder, afflictions cleansed. Sell the dawn: light rises behind the hunter, afflictions burn off as gold, the
   blow, then a gold dawn halo loop that stays on the hunter for three turns (distinct from Guard, Brace and
   Bulwark). The ward happens even on a miss.

ALSO
- A miss or dodge ending for each (the foe slips it; the effect fizzles, except Quicksilver's shimmer and
  Dawnbreaker's ward, which still land on the hunter).
- A cut-in tint per ultimate (the kicker and slab colour), from the tokens or close to them.
- 11 emblems for the Wardrobe's Ultimates tab: the eight plus Sundering Verdict, Starfall and Heartpiercer Rain.
  Inline SVG, about 64 px, two states each: earned (full colour) and locked (dim, sealed). They should read as one
  set next to the Wardrobe's frames, inks, auras and pins.

RULES
- iOS 15 WebKit: no CSS color-mix(), no :has(). Animate transform, opacity and filter only; no layout animation;
  no canvas or WebGL. CSS keyframes, inline SVG and a handful of DOM nodes.
- Each ultimate runs 2.5 to 3.2 seconds and cleans itself up; about 60 nodes at most at any moment. Mark T (the
  blow) in ms for each.
- Keep the dark painted look and the Battle Redesign tokens: gold #f5b842; class red #ef4444, blue #3b82f6, green
  #22c55e; reads teal #5eead4; curses violet #a78bfa; fire #f0904a; arcane #c084fc; frost #7dd3fc; Cinzel,
  JetBrains Mono, Cormorant Garamond italic.
- Never write "fell" or "felled". No instructions on screen.

DELIVER
1. An interactive HTML prototype on the Battle Redesign stage with an ultimate picker: all eight plus the three
   existing ones for comparison, each playable on demand, with toggles for hit / miss / dodge, crit, kill, Reaper's
   two endings, Arise's army size (0 / 1 / 4 / 8), 2x and reduced motion.
2. For each ultimate, its step list in the same form as the Motion Library (motion-engine.jsx / motion-data.jsx):
   time in ms → pose, layer constructor calls with their arguments, camera, wash, freeze; T marked; its miss
   ending; its tap-along echo. New constructors, poses and the three ambient loops defined in full.
3. The 11 emblems (earned + locked) as inline SVG, and the eight cut-in tints.
