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
// W686 — the mythic caster weapons (The Sleepless Crown raid). Class-ceiling
// convergence is the tuning target: their Σ42/STR4 spread = Duskforge's engine
// power by construction; the sim proves it holds through sets+upgrades.
const RS = 'reverie_staff', VB = 'vigil_bow';
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
  for (const [wid, wn] of [[NF, 'Nightfall'], [DF, 'Duskforge'], [RS, 'Reverie'], [VB, 'Vigil']]) {
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

// ── W1069: the owner's floor-100 curve — the max relic set at 50% alone, easier with every shadow,
// all nineteen near certain. Shadows join strongest first (as they march at each rank's slots).
console.log('\n=== F100 by shadows marching (max relic set: sets + maxed upgrades) ===');
console.log('shadows  army      Nightfall   Duskforge   Vigil');
for (const k of [0, 1, 3, 5, 8, 12, 19, 99]) {   // 99 = every solo boss (29 since the W1071 weekly sleep four)
  const rn = Arena.simAscent(100, NF, { n: 3000, invest: 'max', shadows: k });
  const rd = Arena.simAscent(100, DF, { n: 3000, invest: 'max', shadows: k });
  const rv = Arena.simAscent(100, VB, { n: 3000, invest: 'max', shadows: k });
  console.log(`${String(k === 99 ? 'all' : k).padStart(7)}  +${String(rn.armyPct).padEnd(7)}  ${pct(rn.winRate).padStart(9)}   ${pct(rd.winRate).padStart(9)}   ${pct(rv.winRate).padStart(6)}`);
}

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

// ── W1168: the ULT TABLE (opt-in: `node tools/sim-ascent.js --ults [n]`). Every earned ultimate is a SIDEGRADE:
// per weapon, its win-rate gain over never firing ('none') should sit within ±35% of that weapon's Signature gain
// (or ±2 pts, whichever is wider). Rows are the ones where the Signature wins 40-85% (paired seeds); Arise is
// judged on the shadow rows. 'smart' = its use() + patience (only Feast and Reaper hold); 'full' = fires the
// moment the bar fills, reported so a hunter who never waits isn't badly punished.
if (process.argv.indexOf('--ults') !== -1) {
  const n = +(process.argv[process.argv.indexOf('--ults') + 1]) || 3000;
  const W = { NF, DF, VB, RS, TI: 'titan_oathblade', HW: 'hammerfall_warmaul' };
  const ROWS = [['F95 gear', 95, { invest: 'gear' }], ['F100 sets', 100, { invest: 'sets', shadows: 0 }],
    ['F100 max 0sh', 100, { invest: 'max', shadows: 0 }], ['F100 max 1sh', 100, { invest: 'max', shadows: 1 }],
    ['F100 max 3sh', 100, { invest: 'max', shadows: 3 }], ['F100 max 5sh', 100, { invest: 'max', shadows: 5 }],
    ['F100 max 8sh', 100, { invest: 'max', shadows: 8 }]];
  const ULTS = Arena._battle.ultOrder().filter((u) => u !== 'signature');
  const per = {}; ULTS.forEach((u) => { per[u] = {}; });
  console.log(`\n=== ULT TABLE (n=${n}, paired seeds): win% per row; [gain over none / Signature gain] ===`);
  console.log('row            wpn   none    sig | ' + ULTS.map((u) => u.slice(0, 8).padStart(8)).join(''));
  for (const [wk, w] of Object.entries(W)) for (const [rk, f, o] of ROWS) {
    const run = (ult, fire) => Arena.simAscent(f, w, Object.assign({ n, seed0: 1, ult, ultFire: fire || 'smart' }, o));
    const none = run('none'), sig = run('signature'), sg = sig.winRate - none.winRate;
    const inBand = sig.winRate >= 0.40 && sig.winRate <= 0.85 && sg > 0.01;
    let line = `${rk.padEnd(14)} ${wk.padEnd(3)} ${pct(none.winRate).padStart(6)} ${pct(sig.winRate).padStart(6)} | `;
    ULTS.forEach((u) => {
      const sm = run(u), fu = (Arena._battle.ults()[u].use ? run(u, 'full') : sm);
      line += pct(sm.winRate).padStart(8);
      const shadowRow = /sh$/.test(rk) && rk !== 'F100 max 0sh';
      if (!inBand || (u === 'arise' && !shadowRow)) return;
      (per[u][wk] = per[u][wk] || []).push({ g: sm.winRate - none.winRate, gf: fu.winRate - none.winRate, sg, dSig: (sm.winRate - sig.winRate) * 100, dFull: (fu.winRate - sig.winRate) * 100, dt: sm.medianTurns - sig.medianTurns });
    });
    console.log(line + (inBand ? '' : '   (out of band)'));
  }
  console.log('\nper weapon: mean gain / Signature gain (pass 0.65-1.35, or within ±2 pts) · fire-at-full Δ vs Signature (pass ≥ -4) · Δ median turns');
  let fails = 0;
  ULTS.forEach((u) => {
    const cells = Object.keys(per[u]).map((wk) => {
      const a = per[u][wk], mean = (k) => a.reduce((s, x) => s + x[k], 0) / a.length;
      const ratio = mean('g') / mean('sg'), dS = mean('dSig'), dF = mean('dFull'), dt = mean('dt');
      const ok = (ratio >= 0.65 && ratio <= 1.35) || Math.abs(dS) <= 2;
      const okF = dF >= -4, okT = dt <= 1;
      if (!ok || !okF || !okT) fails++;
      return `${wk} ${ratio.toFixed(2)}${ok ? '' : '!'} ${dF >= 0 ? '+' : ''}${dF.toFixed(1)}${okF ? '' : '!'} ${dt >= 0 ? '+' : ''}${dt.toFixed(1)}${okT ? '' : '!'}`;
    });
    console.log(u.padEnd(13) + cells.join('  |  '));
  });
  console.log(fails ? `ULT TABLE: ${fails} weapon cell(s) outside the bar (marked !)` : 'ULT TABLE: every ultimate within the bar');
}
