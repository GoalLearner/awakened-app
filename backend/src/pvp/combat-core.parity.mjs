// Client<->server PARITY cross-check (the no-fork proof).
//   node backend/src/pvp/combat-core.parity.mjs
//
// CAPS below were captured from the SHIPPED client Arena engine (app.js) in the
// browser: identical combatants + seed + player-move sequence, run via
// Arena._battle.start + Arena._battle.turn (tier-2 AI foe). We replay the exact
// same inputs through the server combat-core and assert byte-identical outcomes.
// Both engines use the same seeded mulberry32 RNG + the same tier-2 AI, so the
// AI picks the same foe moves and the whole battle must match.
//
// W1067 (2026-10-15) — the battle rebuild changed the damage model on both engines, so every
// result below was recaptured from app.js (Arena._battle.start/turn, the same kits and seeds) and
// then matched by this core.
// W1139 (2026-11-06) — the client engine now resolves Ascent-only READS (parry / sidestep / ward /
// reflect / interrupt, the Surge 'parry' move, boss rhythm cycles) on sessions that are not `_pvp`.
// This core has none of them, on purpose. If these results are ever recaptured from app.js, start
// the capture session with `sess._pvp = true` (or play only attacks) or a Guard into a HEAVY will
// parry on the client and never match here.
import * as CC from './combat-core.js';

const CAPS = [
  { floor: 5, seed: 777,
    player: { attack: 2.3, defense: 2.3, edge: 2.3, stats: { STR: 1, VIT: 1, INT: 1, FOCUS: 1, WILL: 1, WLT: 1 }, arch: 'balanced', attuned: 1 },
    bot: { attack: 0.988, defense: 0.9753333333333333, edge: 1.8366666666666664, arch: 'trickster' },
    pMoves: ['jab', 'hook', 'guard', 'focus'], bMoves: ['arrowvolley', 'snapshot', 'tumble', 'quickshot'],
    moveSeq: Array(22).fill('jab'),
    // W529 — recaptured: the trickster bot now gains passive evasion (_arRangerEvade),
    // so it slips more jabs → fight resolves a turn sooner. Re-verified byte-identical
    // on BOTH engines (app.js Arena._battle + this combat-core) at the new values.
    result: { won: true, turns: 6, pHP: 39.984653, bHP: 0, dp: 42, db: 5 } },
  { floor: 12, seed: 4242,
    player: { attack: 2.3, defense: 2.3, edge: 2.3, stats: { STR: 1, VIT: 1, INT: 1, FOCUS: 1, WILL: 1, WLT: 1 }, arch: 'balanced', attuned: 1 },
    bot: { attack: 19.70190908092534, defense: 10.870018803269154, edge: 10.19064262806483, arch: 'aggressor' },
    pMoves: ['jab', 'hook', 'guard', 'focus'], bMoves: ['cleave', 'sunder', 'slash', 'focus'],
    moveSeq: ['jab', 'jab', 'jab'],
    result: { won: false, turns: 3, pHP: 0, bHP: 63.52244, dp: 0, db: 45 } },
  { floor: 33, seed: 31337,
    player: { attack: 2.3, defense: 2.3, edge: 2.3, stats: { STR: 1, VIT: 1, INT: 1, FOCUS: 1, WILL: 1, WLT: 1 }, arch: 'balanced', attuned: 1 },
    bot: { attack: 56.991178686514196, defense: 31.44340893049059, edge: 29.47819587233493, arch: 'aggressor' },
    pMoves: ['jab', 'hook', 'guard', 'focus'], bMoves: ['cleave', 'sunder', 'slash', 'focus'],
    moveSeq: ['jab', 'jab'],
    result: { won: false, turns: 2, pHP: 0, bHP: 109, dp: 0, db: 45 } },
  // W530 — Bulwark (the melee combined Guard+Focus+cleanse stance) parity guard.
  // Player casts bulwark turn 1 then attacks; db=6 confirms the -40% taken applies
  // identically on both engines. Captured from app.js Arena._battle + this core.
  { floor: 20, seed: 8088,
    player: { attack: 26.0, defense: 9.0, edge: 5.0, stats: { STR: 1, VIT: 1, INT: 1, FOCUS: 1, WILL: 1, WLT: 1 }, arch: 'aggressor', attuned: 1 },
    bot: { attack: 7.0, defense: 4.0, edge: 4.0, arch: 'aggressor' },
    pMoves: ['cleave', 'sunder', 'bulwark', 'oathstrike'], bMoves: ['cleave', 'sunder', 'slash', 'focus'],
    moveSeq: ['bulwark', 'cleave', 'oathstrike', 'sunder', 'cleave', 'oathstrike', 'sunder', 'cleave', 'oathstrike', 'sunder', 'cleave', 'oathstrike'],
    result: { won: true, turns: 5, pHP: 55.531252, bHP: 0, dp: 49, db: 4 } },
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
// W1233 (2026-11-17) — the ULTIMATES in duels. Captured from the shipped client engine (app.js Arena._battle.start/turn,
// floor 5, tier-2 foe, attacks only so no read fires; sess._ultId / _ultShadows set, the player UNLEASHES at a full
// Surge) and replayed here through arenaTakeTurn with the same ultId / shadows: every result, and the Surge left over,
// must match. One row per ultimate (the three Signatures and the eight earned ones).
const ULT_CAPS = [
  {"ult":"verdict","seed":507,"player":{"attack":14,"defense":12,"edge":9,"stats":{"STR":30,"VIT":30,"INT":30,"FOCUS":30,"WILL":30,"WLT":5},"shadows":0},"bot":{"attack":12,"defense":13,"edge":8,"stats":{"STR":30,"VIT":30,"INT":30,"FOCUS":30,"WILL":30,"WLT":5}},"pMoves":["cleave","oathstrike","slash","jab"],"bMoves":["cleave","sunder","slash","jab"],"seq":["cleave","oathstrike","slash","ultimate"],"result":{"won":true,"turns":5,"pHP":43.319456807166375,"bHP":0,"dp":69,"db":23,"surge":0}},
  {"ult":"starfall","seed":514,"player":{"attack":14,"defense":12,"edge":9,"stats":{"STR":30,"VIT":30,"INT":30,"FOCUS":30,"WILL":30,"WLT":5},"shadows":0},"bot":{"attack":12,"defense":13,"edge":8,"stats":{"STR":30,"VIT":30,"INT":30,"FOCUS":30,"WILL":30,"WLT":5}},"pMoves":["arcanebolt","cataclysm","immolate","siphon"],"bMoves":["arrowvolley","snapshot","tumble","quickshot"],"seq":["arcanebolt","arcanebolt","arcanebolt","ultimate","arcanebolt"],"result":{"won":true,"turns":6,"pHP":31.22843496046567,"bHP":0,"dp":69,"db":35,"surge":0.06922978795986534}},
  {"ult":"rain","seed":521,"player":{"attack":14,"defense":12,"edge":9,"stats":{"STR":30,"VIT":30,"INT":30,"FOCUS":30,"WILL":30,"WLT":5},"shadows":0},"bot":{"attack":12,"defense":13,"edge":8,"stats":{"STR":30,"VIT":30,"INT":30,"FOCUS":30,"WILL":30,"WLT":5}},"pMoves":["heartseeker","arrowvolley","flamearrow","snapshot"],"bMoves":["cleave","sunder","slash","jab"],"seq":["heartseeker","arrowvolley","flamearrow","arrowvolley","ultimate"],"result":{"won":true,"turns":6,"pHP":41.56195728692792,"bHP":0,"dp":69,"db":24,"surge":0}},
  {"ult":"feast","seed":528,"player":{"attack":14,"defense":12,"edge":9,"stats":{"STR":30,"VIT":30,"INT":30,"FOCUS":30,"WILL":30,"WLT":5},"shadows":0},"bot":{"attack":12,"defense":13,"edge":8,"stats":{"STR":30,"VIT":30,"INT":30,"FOCUS":30,"WILL":30,"WLT":5}},"pMoves":["cleave","oathstrike","slash","jab"],"bMoves":["arrowvolley","snapshot","tumble","quickshot"],"seq":["cleave","oathstrike","ultimate","cleave","slash","oathstrike"],"result":{"won":false,"turns":7,"pHP":0,"bHP":2.054003896255267,"dp":67,"db":73,"surge":0.6819835079029506}},
  {"ult":"quicksilver","seed":535,"player":{"attack":14,"defense":12,"edge":9,"stats":{"STR":30,"VIT":30,"INT":30,"FOCUS":30,"WILL":30,"WLT":5},"shadows":0},"bot":{"attack":12,"defense":13,"edge":8,"stats":{"STR":30,"VIT":30,"INT":30,"FOCUS":30,"WILL":30,"WLT":5}},"pMoves":["arcanebolt","cataclysm","immolate","siphon"],"bMoves":["cleave","sunder","slash","jab"],"seq":["arcanebolt","arcanebolt","arcanebolt","ultimate","arcanebolt","arcanebolt"],"result":{"won":true,"turns":7,"pHP":26.30035560898217,"bHP":0,"dp":69,"db":40,"surge":0.28280384249703594}},
  {"ult":"hellfire","seed":542,"player":{"attack":14,"defense":12,"edge":9,"stats":{"STR":30,"VIT":30,"INT":30,"FOCUS":30,"WILL":30,"WLT":5},"shadows":0},"bot":{"attack":12,"defense":13,"edge":8,"stats":{"STR":30,"VIT":30,"INT":30,"FOCUS":30,"WILL":30,"WLT":5}},"pMoves":["heartseeker","arrowvolley","flamearrow","snapshot"],"bMoves":["arrowvolley","snapshot","tumble","quickshot"],"seq":["heartseeker","arrowvolley","flamearrow","arrowvolley","ultimate"],"result":{"won":true,"turns":6,"pHP":26.59398595354579,"bHP":0,"dp":69,"db":39,"surge":0}},
  {"ult":"storm","seed":549,"player":{"attack":14,"defense":12,"edge":9,"stats":{"STR":30,"VIT":30,"INT":30,"FOCUS":30,"WILL":30,"WLT":5},"shadows":0},"bot":{"attack":12,"defense":13,"edge":8,"stats":{"STR":30,"VIT":30,"INT":30,"FOCUS":30,"WILL":30,"WLT":5}},"pMoves":["cleave","oathstrike","slash","jab"],"bMoves":["cleave","sunder","slash","jab"],"seq":["cleave","oathstrike","ultimate"],"result":{"won":true,"turns":4,"pHP":11.133185160647706,"bHP":0,"dp":69,"db":55,"surge":0}},
  {"ult":"worldbreaker","seed":556,"player":{"attack":14,"defense":12,"edge":9,"stats":{"STR":30,"VIT":30,"INT":30,"FOCUS":30,"WILL":30,"WLT":5},"shadows":0},"bot":{"attack":12,"defense":13,"edge":8,"stats":{"STR":30,"VIT":30,"INT":30,"FOCUS":30,"WILL":30,"WLT":5}},"pMoves":["arcanebolt","cataclysm","immolate","siphon"],"bMoves":["arrowvolley","snapshot","tumble","quickshot"],"seq":["arcanebolt","arcanebolt","arcanebolt","ultimate","arcanebolt","arcanebolt"],"result":{"won":false,"turns":7,"pHP":0,"bHP":6.076591984471243,"dp":63,"db":66,"surge":0.5415228326546913}},
  {"ult":"reaper","seed":563,"player":{"attack":14,"defense":12,"edge":9,"stats":{"STR":30,"VIT":30,"INT":30,"FOCUS":30,"WILL":30,"WLT":5},"shadows":0},"bot":{"attack":12,"defense":13,"edge":8,"stats":{"STR":30,"VIT":30,"INT":30,"FOCUS":30,"WILL":30,"WLT":5}},"pMoves":["heartseeker","arrowvolley","flamearrow","snapshot"],"bMoves":["cleave","sunder","slash","jab"],"seq":["heartseeker","arrowvolley","flamearrow","ultimate"],"result":{"won":true,"turns":5,"pHP":41.348695202634175,"bHP":0,"dp":69,"db":25,"surge":0}},
  {"ult":"arise","seed":570,"player":{"attack":14,"defense":12,"edge":9,"stats":{"STR":30,"VIT":30,"INT":30,"FOCUS":30,"WILL":30,"WLT":5},"shadows":5},"bot":{"attack":12,"defense":13,"edge":8,"stats":{"STR":30,"VIT":30,"INT":30,"FOCUS":30,"WILL":30,"WLT":5}},"pMoves":["cleave","oathstrike","slash","jab"],"bMoves":["arrowvolley","snapshot","tumble","quickshot"],"seq":["cleave","oathstrike","slash","ultimate"],"result":{"won":true,"turns":5,"pHP":32.17944896552508,"bHP":0,"dp":69,"db":34,"surge":0}},
  {"ult":"dawnbreaker","seed":577,"player":{"attack":14,"defense":12,"edge":9,"stats":{"STR":30,"VIT":30,"INT":30,"FOCUS":30,"WILL":30,"WLT":5},"shadows":0},"bot":{"attack":12,"defense":13,"edge":8,"stats":{"STR":30,"VIT":30,"INT":30,"FOCUS":30,"WILL":30,"WLT":5}},"pMoves":["arcanebolt","cataclysm","immolate","siphon"],"bMoves":["cleave","sunder","slash","jab"],"seq":["arcanebolt","arcanebolt","arcanebolt","ultimate"],"result":{"won":false,"turns":5,"pHP":0,"bHP":8.29283716998917,"dp":61,"db":66,"surge":0}},
];
for (const c of ULT_CAPS) {
  const pa = { name: 'P', weaponName: '', attack: c.player.attack, defense: c.player.defense, edge: c.player.edge, stats: c.player.stats, attuned: 1,
    kit: c.pMoves.map((id) => Object.assign({ id }, CC.ARENA_MOVE_LIB[id])), ultId: c.ult, shadows: c.player.shadows };
  const pb = { name: 'B', weaponName: '', attack: c.bot.attack, defense: c.bot.defense, edge: c.bot.edge, stats: c.bot.stats, attuned: 1,
    kit: c.bMoves.map((id) => Object.assign({ id }, CC.ARENA_MOVE_LIB[id])) };
  const sess = CC.pvpStartBattle(pa, pb, c.seed);
  for (const mid of c.seq) { if (sess.done) break; CC.arenaTakeTurn(sess, mid); }
  const got = { won: sess.won, turns: sess.turn, pHP: sess.pHP, bHP: sess.bHP, dp: Math.round(sess.dmgDealt.p), db: Math.round(sess.dmgDealt.b), surge: sess.pSurge };
  const exp = c.result;
  const okMatch = got.won === exp.won && got.turns === exp.turns && near(got.pHP, exp.pHP) && near(got.bHP, exp.bHP) && got.dp === exp.dp && got.db === exp.db && near(got.surge, exp.surge) && c.seq.includes('ultimate');
  if (okMatch) { pass++; console.log('  OK   ultimate ' + c.ult + ' seed ' + c.seed + ' -> ' + (got.won ? 'WIN' : 'loss') + ' ' + got.turns + 't'); }
  else { fail++; console.error('  FAIL ultimate ' + c.ult); console.error('    client:', JSON.stringify(exp)); console.error('    server:', JSON.stringify(got)); }
}
console.log('\nclient<->server PARITY: ' + pass + ' matched, ' + fail + ' diverged');
process.exit(fail ? 1 : 0);
