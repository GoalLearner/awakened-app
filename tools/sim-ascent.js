// DEV-ONLY Ascent balance verification. NOT part of the app bundle.
// Loads app.js headless (stubbed DOM) and runs Arena.simAscent for a MAX build
// against the top of the ladder, with the Mythic (Nightfall) and the 2nd-best
// weapon (Duskforge). Confirms the whole game is doable at max gear either way,
// and that the summit is a real fight (not a stomp). Re-run after adding
// items/floors/relic-upgrades/sets to re-check balance.
//   node tools/sim-ascent.js
//
// W510 — the sim now models the real INVESTMENT SPREAD via Arena.simAscent's
// opts.invest, because the live combat path folds in W495/W506 SET BONUSES +
// W494 RELIC UPGRADES that this sim historically ignored (it built the statline
// from BiS card bonuses ONLY). That blindness let the FIXED F100 wall silently
// soften every time a relic/upgrade/set shipped. The three investment tiers:
//   gear = BiS cards only (the legacy number — what every prior "doable" check saw)
//   sets = + active set bonuses (W495/W506)
//   max  = + sets AND maxed relic upgrades (W494) = the true min-maxed ceiling
// The GAP between `gear` and `max` is the power-creep the old instrument was blind to.
const { Arena, loadErr } = require('./_load-arena.js');
if (loadErr) console.log('(IIFE threw after the Arena export — fine for sim)\n');
const NF = 'nightfall_blade', DF = 'duskforge_greatblade';
const pct = (x) => (x * 100).toFixed(1) + '%';

console.log('=== engine integrity ===');
try { const st = Arena.selfTest(); console.log('selfTest:', st.pass ? 'PASS' : 'FAIL', (st.passed) + '/' + (st.total)); } catch (e) { console.log('selfTest error', String(e).slice(0, 120)); }

// ── W510: investment-spread at the summit ───────────────────────────────────
// This is the headline. For F100 (and the approach), show how player power +
// win-rate move across the three investment tiers, for BOTH weapons. If the
// `gear` and `max` columns diverge a lot, the wall is straddling too wide a
// spread and the summit has softened for the whale while the floor build sweats.
const INVESTS = ['gear', 'sets', 'max'];
const INVEST_LABEL = { gear: 'BiS gear', sets: '+ sets', max: '+ sets + maxed upgrades' };
function spreadAt(floor, n) {
  console.log(`\n=== F${floor} investment spread (player power → win rate) ===`);
  console.log('weapon      ' + INVESTS.map((iv) => INVEST_LABEL[iv].padEnd(26)).join(''));
  for (const [wid, wn] of [[NF, 'Nightfall'], [DF, 'Duskforge']]) {
    const cells = INVESTS.map((iv) => {
      const r = Arena.simAscent(floor, wid, { n, invest: iv });
      return `${String(r.playerPower).padStart(3)}pw ${pct(r.winRate).padStart(6)}`.padEnd(26);
    });
    console.log(`${wn.padEnd(11)} ${cells.join('')}`);
  }
}
spreadAt(100, 4000);
spreadAt(95, 3000);

const foe = Arena.simAscent(100, NF, { n: 1 }).foePower;
const lo = Arena.simAscent(100, DF, { n: 3000, invest: 'gear' }).playerPower;
const hi = Arena.simAscent(100, NF, { n: 3000, invest: 'max' }).playerPower;
console.log(`\nF100 wall = ${foe} raw. Live build-power SPREAD = ${lo} (Duskforge, BiS only) … ${hi} (Nightfall, fully min-maxed).`);
console.log(`A single fixed wall cannot challenge ${hi} without bricking ${lo} — read the columns above before any bump.`);

// ── Legacy doability table (BiS-only "gear" tier — comparable to all prior runs) ──
console.log('\n=== legacy BiS-only doability, summit approach (F90-100) ===');
console.log('floor  foePow   Nightfall(med turns)   Duskforge(med turns)');
for (const f of [90, 95, 99, 100]) {
  const rn = Arena.simAscent(f, NF, { n: 3000 });        // default invest:'gear'
  const rd = Arena.simAscent(f, DF, { n: 3000 });
  console.log(`F${String(f).padEnd(4)}  ${String(rn.foePower).padStart(5)}    ${pct(rn.winRate).padStart(6)} (${rn.medianTurns})            ${pct(rd.winRate).padStart(6)} (${rd.medianTurns})`);
}

console.log('\n=== mid-ladder (BiS-only, max build clears these) ===');
console.log([10, 30, 50, 70].map((f) => `F${f} ${pct(Arena.simAscent(f, NF, { n: 1500 }).winRate)}`).join('   '));
