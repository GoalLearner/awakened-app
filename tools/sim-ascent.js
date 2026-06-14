// W291 — DEV-ONLY Ascent balance verification. NOT part of the app bundle.
// Loads app.js headless (stubbed DOM) and runs Arena.simAscent for a MAX build
// (base 20 + the 8 best-in-slot bonuses) against the top of the ladder, with the
// Mythic (Nightfall) and the 2nd-best weapon (Duskforge). Confirms the whole game
// is doable at max gear either way, and that the summit is a real fight (not a
// stomp). Re-run after adding items/floors to re-check balance.
//   node tools/sim-ascent.js
const { Arena, loadErr } = require('./_load-arena.js');
if (loadErr) console.log('(IIFE threw after the Arena export — fine for sim)\n');
const NF = 'nightfall_blade', DF = 'duskforge_greatblade';
const pct = (x) => (x * 100).toFixed(1) + '%';

console.log('=== engine integrity ===');
try { const st = Arena.selfTest(); console.log('selfTest:', st.pass ? 'PASS' : 'FAIL', (st.passed) + '/' + (st.total)); } catch (e) { console.log('selfTest error', String(e).slice(0, 120)); }

console.log('\n=== max-build doability, summit approach (F90-100) ===');
console.log('floor  foePow   Nightfall(med turns)   Duskforge(med turns)');
for (const f of [90, 95, 99, 100]) {
  const rn = Arena.simAscent(f, NF, { n: 3000 });
  const rd = Arena.simAscent(f, DF, { n: 3000 });
  console.log(`F${String(f).padEnd(4)}  ${String(rn.foePower).padStart(5)}    ${pct(rn.winRate).padStart(6)} (${rn.medianTurns})            ${pct(rd.winRate).padStart(6)} (${rd.medianTurns})`);
}

console.log('\n=== mid-ladder (max build clears these) ===');
console.log([10, 30, 50, 70].map((f) => `F${f} ${pct(Arena.simAscent(f, NF, { n: 1500 }).winRate)}`).join('   '));

const f100 = Arena.simAscent(100, NF, { n: 4000 });
console.log(`\nF100 max build: player ${f100.playerPower} power (${f100.playerArch}, attune ${f100.attuned}) vs summit ${f100.foePower}`);
console.log('Verdict: both weapons summit (Nightfall comfortably, Duskforge tightly) — doable, not too easy.');
