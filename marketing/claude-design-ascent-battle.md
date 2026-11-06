# Claude Design brief: the Ascent battle, redesigned

Owner ask 2026-11-06: "I want to redesign these battles in the ascent ... make it more fun or interactive."
Paste everything below the line into a new Claude Design project. Attach the phone screenshot of a
Floor 97 battle (the one he shared) plus one mid-fight screenshot if he has it.
Port notes for later: the battle engine and its numbers stay (the Floor 100 difficulty curve is a
standing owner decision, and Ranked PvP runs the same engine on the server). Foe intent and the Surge
meter are NEW mechanics: they ship Ascent-only and get tuned with tools/sim-ascent.js before release.

---

Redesign the battle screen of the Ascent in Awakened: Habit RPG, an iPhone app where real steps, sleep and
workouts from Apple Health power a dark-fantasy RPG. The Ascent is a 100-floor tower; every floor is a
one-on-one, turn-based fight against a named foe with its own painted art (the attached screenshot is
Floor 97, The Grim Acolyte). It is the heart of the game, and right now it feels flat: the hunter taps the
move with the biggest number every turn and watches.

THE GOAL
Make every fight feel like a moment and every turn feel like a decision, in under a minute a floor.
Keep the dark painted look: navy night, gold ink, a serif for names, a mono face for numbers, italic serif
for flavour lines, the hunter's class colours on the move cards.

WHAT THE ENGINE ALREADY DOES (design for all of it)
- Each turn the hunter picks one of four class moves; a fifth, the finisher (Reckoning), only lands hard
  when the foe is below 30% HP. Moves have power numbers, some have cooldowns, one is a support move
  (Bulwark: brace, empower and cleanse for 3 turns).
- Type matchups (SUPER EFFECTIVE / NOT VERY EFFECTIVE), critical hits, multi-hit moves, dodges.
- Status effects with turns left: attack up/down, defence up/down, dodge up, stun, guard.
- The foe's brain gets sharper higher up (four AI tiers by floor).
- Today's beats: "You used CLEAVE!" line, the attacker lunges with a weapon-family animation, a hit-stop
  freeze, the HP bar drains with a lagging ghost bar, CRITICAL / SUPER EFFECTIVE toasts, a KO cinematic,
  and a fast-forward for replays.

WHAT IS WRONG WITH THE CURRENT SCREEN (see the screenshot)
- The hunter is small and cut off in the bottom-left corner while the foe stands tall; it does not read as a
  face-off.
- The two HP plates sit on top of the art and fight it.
- Half the stage is empty sky; the move list is a wall of five equal cards.
- Nothing tells the hunter what the foe is about to do, so there is no reason to pick anything but the
  biggest number.

WHAT TO DESIGN
1. A real face-off. Hunter and foe at the same scale, facing each other, the foe's art as the stage. HP,
   name and status chips in a clean band (fighting-game style) that never covers a face.
2. Foe intent (new). Above the foe, an icon + one word for what it will do next turn: STRIKE, HEAVY (big
   hit coming), GUARD, CURSE (debuff), CHARGE (winding up something huge in 2 turns). This is what turns
   Bulwark, the debuffs and the finisher into real choices.
3. The Surge meter (new). A meter that fills as the hunter deals and takes damage. Full = the class
   ultimate unlocks: one big cinematic move with a full-screen cut-in (hunter portrait, move name, slash
   of colour). Show the meter filling, full, and the cut-in.
4. Move cards that think. The best play glows a little: SUPER EFFECTIVE on a card when the matchup favours
   it, the finisher igniting when the foe drops under 30%, cooldowns as a ring with turns left, Bulwark
   pulsing when a HEAVY is coming. Fewer, bigger cards beat five equal ones.
5. The moments: a boss intro (name card, title, one taunt line) for every tenth floor; a phase change when a
   boss drops to half (new pose or tint, a line of dialogue); the victory screen (floor cleared, souls,
   any relic, NEXT FLOOR); the defeat screen (what beat you, TRY AGAIN).

STATES TO SHOW
Opening turn - choosing a move - your attack landing (crit and super-effective variants) - the foe
telegraphing then striking - a stun or guard on either side - finisher ready - Surge full - ultimate
cut-in - boss phase change - victory - defeat.

RULES
- iPhone portrait, 390 x 844, one hand; thumbs live in the bottom half.
- iOS 15 WebKit: no CSS color-mix(), no :has(). Respect reduced motion (every animation has a calm fallback).
- The same screen also runs Ranked PvP duels against real hunters (with a turn timer and "waiting for
  opponent"); foe intent and Surge are Ascent-only, so the layout must work without them.
- No instructions or tutorials on screen for anything self-explanatory. One short line of flavour at most.
- Never use the words "fell" or "felled".
- Deliver an interactive HTML prototype with the states above reachable by tapping, plus a short list of
  every animation and its timing.
