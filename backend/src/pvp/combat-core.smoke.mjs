// Node smoke + determinism test for the server combat-core.
//   node backend/src/pvp/combat-core.smoke.mjs
import * as CC from './combat-core.js';

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error('  FAIL:', name); } }

// Two distinct combatants.
const A = CC.buildCombatant({ name: 'Alice', weaponId: 'nightfall_blade',
  stats: { STR: 14, VIT: 10, INT: 6, FOCUS: 9, WILL: 7, WLT: 4 } });
const B = CC.buildCombatant({ name: 'Bob', weaponId: 'wraithwind_bow',
  stats: { STR: 6, VIT: 12, INT: 8, FOCUS: 11, WILL: 9, WLT: 3 } });

ok('A kit has 4 moves (W757: the execute is EARNED at max relic, not innate)', A.kit.length === 4);
ok('A is attuned to nightfall (×1.15)', A.attuned === CC._ATTUNED_MULT);
ok('A profile non-zero', A.attack > 0 && A.defense > 0 && A.edge > 0);

// Run a full scripted PvP battle deterministically; return the result.
function runScripted(seed) {
  const sess = CC.pvpStartBattle(A, B, seed);
  let guard = 0;
  const trace = [];
  while (!sess.done && guard++ < 80) {
    // pick first off-cooldown move for each side (deterministic script)
    const pm = sess.pMoves.find((m) => !(sess.cd[m.id] > 0)) || { id: 'struggle' };
    const bm = sess.bMoves.find((m) => !(sess.bcd[m.id] > 0)) || { id: 'struggle' };
    const r = CC.pvpResolveTurn(sess, pm.id, bm.id);
    if (!r.ok) { trace.push('ERR:' + r.code); break; }
    trace.push(pm.id + '/' + bm.id + '->' + sess.pHP + ',' + sess.bHP);
  }
  return { result: CC.pvpResult(sess), trace };
}

const r1 = runScripted(12345);
const r2 = runScripted(12345);
ok('PvP battle terminates', r1.result.done === true);
ok('PvP winner is a side', r1.result.winnerSide === 'p' || r1.result.winnerSide === 'b');
ok('PvP HP within bounds', r1.result.pHP >= 0 && r1.result.pHP <= r1.result.pMax && r1.result.bHP >= 0 && r1.result.bHP <= r1.result.bMax);
ok('DETERMINISM: same seed -> identical result', JSON.stringify(r1.result) === JSON.stringify(r2.result) && JSON.stringify(r1.trace) === JSON.stringify(r2.trace));

const r3 = runScripted(99999);
ok('different seed -> (usually) different trace', JSON.stringify(r3.trace) !== JSON.stringify(r1.trace));

// Move validation: illegal move id rejected; cooldown enforced.
{
  const sess = CC.pvpStartBattle(A, B, 7);
  ok('illegal move rejected', CC.pvpResolveTurn(sess, 'not_a_move', sess.bMoves[0].id).code === 'BAD_MOVE_P');
  // burn a cd move, then try to reuse it next turn
  const cdMove = A.kit.find((m) => m.cd > 0);
  if (cdMove) {
    const sess2 = CC.pvpStartBattle(A, B, 7);
    CC.pvpResolveTurn(sess2, cdMove.id, sess2.bMoves[0].id);  // turn 1: cast it (now on cd)
    const blocked = CC.pvpResolveTurn(sess2, cdMove.id, sess2.bMoves[0].id);  // turn 2: should be on cd
    ok('cooldown enforced (re-cast blocked)', blocked.ok === false && blocked.code === 'BAD_MOVE_P');
  }
}

// Ascent-parity path: arenaTakeTurn with AI foe runs + terminates (tier-2).
{
  const sess = CC.pvpStartBattle(A, B, 4242);
  let g = 0, ranOk = true;
  while (!sess.done && g++ < 80) {
    const pm = sess.pMoves.find((m) => !(sess.cd[m.id] > 0)) || { id: 'struggle' };
    const ev = CC.arenaTakeTurn(sess, pm.id);
    if (ev === null) { ranOk = false; break; }
  }
  ok('arenaTakeTurn (AI foe) terminates without crash', ranOk && sess.done);
}

// timeout default move is legal
{
  const sess = CC.pvpStartBattle(A, B, 1);
  const dm = CC.defaultMoveForTimeout(sess.pMoves, sess.cd);
  ok('timeout default move is in kit or struggle', sess.pMoves.some((m) => m.id === dm) || dm === 'struggle');
}

console.log('combat-core smoke: ' + pass + ' passed, ' + fail + ' failed');
console.log('sample battle result:', JSON.stringify(r1.result));
process.exit(fail ? 1 : 0);
