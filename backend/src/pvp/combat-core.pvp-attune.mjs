// combat-core.pvp-attune.mjs — verifies the ONE PvP generalization the Ascent parity
// test could NOT cover: the b-side (P2) weapon-attune multiplier. In Ascent the foe is
// a bot with no weapon (attune hardcoded 1); in PvP P2 is a real weapon-wielder and the
// engine reads `sess.bAttuned`. This proves that path is wired AND actually applied.
//   node backend/src/pvp/combat-core.pvp-attune.mjs
import { buildCombatant, pvpStartBattle, pvpResolveTurn, _ATTUNED_MULT } from './combat-core.js';

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  OK   ' + n); } else { fail++; console.error('  FAIL ' + n, x !== undefined ? JSON.stringify(x) : ''); } };

// B is edge-heavy (FOCUS+WILL) -> trickster archetype; wraithwind_bow is attuned to
// trickster -> B.attuned should be _ATTUNED_MULT (1.15).
const mkB = () => buildCombatant({ name: 'B', weaponId: 'wraithwind_bow', weaponName: 'Wraithwind', stats: { STR: 6, VIT: 8, INT: 6, FOCUS: 13, WILL: 11, WLT: 3 } });
// A is a tanky bruiser (high VIT/INT) so it survives the sample turns in both runs.
const mkA = () => buildCombatant({ name: 'A', weaponId: 'nightfall_blade', weaponName: 'Nightfall', stats: { STR: 8, VIT: 30, INT: 20, FOCUS: 8, WILL: 8, WLT: 4 } });

const B = mkB();
ok('P2 attuned weapon -> combatant.attuned = 1.15', Math.abs(B.attuned - _ATTUNED_MULT) < 1e-9, { attuned: B.attuned, arch: B.arch });

const s0 = pvpStartBattle(mkA(), mkB(), 777);
ok('pvpStartBattle wires sess.bAttuned from P2 (NOT hardcoded 1)', Math.abs(s0.bAttuned - _ATTUNED_MULT) < 1e-9, { bAttuned: s0.bAttuned });
ok('sess.pAttuned wired from P1 too', typeof s0.pAttuned === 'number' && s0.pAttuned >= 1, { pAttuned: s0.pAttuned });

// Same seed + identical deterministic move script; toggle bAttuned 1.15 vs 1.0. The
// multiplier does NOT consume RNG, so the hit/miss/crit pattern is byte-identical and
// the ONLY difference is B's outgoing damage -> B must deal strictly more with attune.
const firstOff = (moves, cd) => (moves.find((m) => !(cd[m.id] > 0)) || { id: 'struggle' }).id;
function bDealtOver(bAttuned, turns) {
  const s = pvpStartBattle(mkA(), mkB(), 777);
  s.bAttuned = bAttuned;
  for (let i = 0; i < turns && !s.done; i++) {
    const r = pvpResolveTurn(s, firstOff(s.pMoves, s.cd), firstOff(s.bMoves, s.bcd));
    if (!r.ok) break;
  }
  return { dmgB: s.dmgDealt.b, turns: s.turn, done: s.done, pHP: s.pHP };
}
const att = bDealtOver(_ATTUNED_MULT, 4), plain = bDealtOver(1.0, 4);
// attune is a post-roll multiplier — it consumes no RNG and changes no move selection,
// so both runs MUST advance identically (same turn count, same flow). The only delta is
// B's damage output.
ok('attune does not perturb flow (identical turn count both runs)', att.turns === plain.turns, { att: att.turns, plain: plain.turns });
ok('attuned P2 deals MORE damage than non-attuned (same seed + moves)', att.dmgB > plain.dmgB, { attuned: att.dmgB, plain: plain.dmgB });
// the ratio should be ~1.15 on the attuned attacks (some moves are 0-power supports, so
// the aggregate ratio is <=1.15 but clearly >1).
ok('damage ratio is in the attune band (1.0 < r <= 1.15)', plain.dmgB > 0 && att.dmgB / plain.dmgB > 1.0 && att.dmgB / plain.dmgB <= _ATTUNED_MULT + 1e-6, { ratio: att.dmgB / plain.dmgB });

console.log('\npvp-attune: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
