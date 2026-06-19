// combat-core.draw.mjs — unit test for the PvP-only draw interpretation in pvpResult
// (PVP.md §18.6 mutual KO; §9/§18 exact turn-cap tie). The shared engine never yields a
// draw; pvpResult derives it from the final HP state without touching the engine.
//   node backend/src/pvp/combat-core.draw.mjs
import { pvpResult } from './combat-core.js';

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  OK   ' + n); } else { fail++; console.error('  FAIL ' + n, x !== undefined ? JSON.stringify(x) : ''); } };

// pvpResult only reads these fields, so a plain object is a faithful stand-in.
const S = (o) => Object.assign({ done: true, pMax: 80, bMax: 80, turn: 6, timedOut: false, won: true, dmgDealt: { p: 40, b: 40 } }, o);

ok('mutual KO (both 0) -> draw', pvpResult(S({ pHP: 0, bHP: 0 })).winnerSide === 'draw');
ok('mutual KO sets result.draw true', pvpResult(S({ pHP: 0, bHP: 0 })).draw === true);
ok('p dead only -> b wins', pvpResult(S({ pHP: 0, bHP: 25, won: false })).winnerSide === 'b');
ok('b dead only -> p wins', pvpResult(S({ pHP: 25, bHP: 0, won: true })).winnerSide === 'p');
ok('exact cap tie (equal dmg + equal HP frac) -> draw', pvpResult(S({ pHP: 40, bHP: 40, timedOut: true, dmgDealt: { p: 40, b: 40 } })).winnerSide === 'draw');
ok('cap, unequal damage -> NOT draw', pvpResult(S({ pHP: 40, bHP: 40, timedOut: true, dmgDealt: { p: 50, b: 40 } })).winnerSide !== 'draw');
ok('cap, unequal HP frac -> NOT draw', pvpResult(S({ pHP: 50, bHP: 40, timedOut: true, dmgDealt: { p: 40, b: 40 } })).winnerSide !== 'draw');
ok('cap, different maxHP but equal HP FRACTION + equal dmg -> draw', pvpResult(S({ pHP: 30, pMax: 60, bHP: 40, bMax: 80, timedOut: true, dmgDealt: { p: 40, b: 40 } })).winnerSide === 'draw'); // 0.5 == 0.5
ok('not done -> winnerSide null + draw false', (() => { const r = pvpResult(S({ done: false, pHP: 40, bHP: 40 })); return r.winnerSide === null && r.draw === false; })());

console.log('\ndraw: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
