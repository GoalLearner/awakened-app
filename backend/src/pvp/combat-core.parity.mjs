// Client<->server PARITY cross-check (the no-fork proof).
//   node backend/src/pvp/combat-core.parity.mjs
//
// CAPS below were captured from the SHIPPED client Arena engine (app.js) in the
// browser: identical combatants + seed + player-move sequence, run via
// Arena._battle.start + Arena._battle.turn (tier-2 AI foe). We replay the exact
// same inputs through the server combat-core and assert byte-identical outcomes.
// Both engines use the same seeded mulberry32 RNG + the same tier-2 AI, so the
// AI picks the same foe moves and the whole battle must match.
import * as CC from './combat-core.js';

const CAPS = [
  { floor: 5, seed: 777,
    player: { attack: 2.3, defense: 2.3, edge: 2.3, stats: { STR: 1, VIT: 1, INT: 1, FOCUS: 1, WILL: 1, WLT: 1 }, arch: 'balanced', attuned: 1 },
    bot: { attack: 0.988, defense: 0.9753333333333333, edge: 1.8366666666666664, arch: 'trickster' },
    pMoves: ['jab', 'hook', 'guard', 'focus'], bMoves: ['arrowvolley', 'snapshot', 'tumble', 'quickshot'],
    moveSeq: Array(22).fill('jab'),
    result: { won: true, turns: 23, pHP: 24.108143, bHP: 0, dp: 42, db: 21 } },
  { floor: 12, seed: 4242,
    player: { attack: 2.3, defense: 2.3, edge: 2.3, stats: { STR: 1, VIT: 1, INT: 1, FOCUS: 1, WILL: 1, WLT: 1 }, arch: 'balanced', attuned: 1 },
    bot: { attack: 19.70190908092534, defense: 10.870018803269154, edge: 10.19064262806483, arch: 'aggressor' },
    pMoves: ['jab', 'hook', 'guard', 'focus'], bMoves: ['cleave', 'sunder', 'slash', 'focus'],
    moveSeq: ['jab', 'jab', 'jab'],
    result: { won: false, turns: 4, pHP: 0, bHP: 60.571324, dp: 3, db: 45 } },
  { floor: 33, seed: 31337,
    player: { attack: 2.3, defense: 2.3, edge: 2.3, stats: { STR: 1, VIT: 1, INT: 1, FOCUS: 1, WILL: 1, WLT: 1 }, arch: 'balanced', attuned: 1 },
    bot: { attack: 56.991178686514196, defense: 31.44340893049059, edge: 29.47819587233493, arch: 'aggressor' },
    pMoves: ['jab', 'hook', 'guard', 'focus'], bMoves: ['cleave', 'sunder', 'slash', 'focus'],
    moveSeq: ['jab', 'jab'],
    result: { won: false, turns: 3, pHP: 0, bHP: 106.496673, dp: 3, db: 45 } },
];

function near(a, b) { return Math.abs(a - b) < 1e-4; }

let pass = 0, fail = 0;
for (const cap of CAPS) {
  const pa = {
    name: 'P', weaponName: '', attack: cap.player.attack, defense: cap.player.defense, edge: cap.player.edge,
    stats: cap.player.stats, arch: cap.player.arch, attuned: cap.player.attuned,
    kit: cap.pMoves.map((id) => Object.assign({ id }, CC.ARENA_MOVE_LIB[id])),
  };
  const pb = {
    name: 'B', weaponName: '', attack: cap.bot.attack, defense: cap.bot.defense, edge: cap.bot.edge,
    arch: cap.bot.arch, attuned: 1,   // Ascent foe has no weapon -> attune 1
    kit: cap.bMoves.map((id) => Object.assign({ id }, CC.ARENA_MOVE_LIB[id])),
  };
  const sess = CC.pvpStartBattle(pa, pb, cap.seed);
  // Replay the player's exact move sequence; the foe move is AI-picked (same as
  // the client) via arenaTakeTurn -> _arenaFoePick (tier-2).
  for (const mid of cap.moveSeq) { if (sess.done) break; CC.arenaTakeTurn(sess, mid); }
  const got = { won: sess.won, turns: sess.turn, pHP: sess.pHP, bHP: sess.bHP, dp: Math.round(sess.dmgDealt.p), db: Math.round(sess.dmgDealt.b) };
  const exp = cap.result;
  const okMatch = got.won === exp.won && got.turns === exp.turns && near(got.pHP, exp.pHP) && near(got.bHP, exp.bHP) && got.dp === exp.dp && got.db === exp.db;
  if (okMatch) { pass++; console.log('  OK   floor ' + cap.floor + ' seed ' + cap.seed + ' -> ' + (got.won ? 'WIN' : 'loss') + ' ' + got.turns + 't pHP=' + got.pHP.toFixed(4) + ' bHP=' + got.bHP.toFixed(4)); }
  else { fail++; console.error('  FAIL floor ' + cap.floor + ' seed ' + cap.seed); console.error('    client:', JSON.stringify(exp)); console.error('    server:', JSON.stringify(got)); }
}
console.log('\nclient<->server PARITY: ' + pass + ' matched, ' + fail + ' diverged');
process.exit(fail ? 1 : 0);
