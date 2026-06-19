// ─────────────────────────────────────────────────────────────────────────
// combat-core.js — server-side lift of the shipped Arena combat engine (app.js).
//
// PvP is SERVER-AUTHORITATIVE: the Durable Object runs THIS engine to resolve
// every turn; the client only renders the broadcast. To avoid forking the
// combat math, this file is a FAITHFUL TRANSCRIPTION of the pure, deterministic
// core of app.js's Arena engine (the same functions that power the Ascent Tower
// and are covered by Arena.selfTest()'s 36 tests). Parity is enforced by a
// client↔server cross-check (see combat-core.parity.mjs): identical combatants +
// seed + move sequence must produce identical {won, turns, pHP, bHP}.
//
// WHAT WAS LIFTED (pure, no DOM): the RNG, the move/weapon/arch tables, the
// stat/profile math, the status system, _arExecMove / _arApplyFx / _arEndTurn,
// the turn resolution, and the v2 (tier-2) AI picker.
// WHAT WAS LEFT IN app.js (impure browser setup): _arenaPlayerStatline /
//   getHunterBuild / CARDS / localStorage reads, arenaStartBattle's gear
//   reading, the tiered AI (floors 51+), and arenaFinalizeBattle. PvP receives
//   PRE-COMPUTED combatants from the client, so none of that is needed here.
//
// THE ONE GENERALIZATION FOR PvP: _arExecMove originally hardcoded the foe's
// weapon-attune to 1 (the Ascent foe is a bot with no weapon). PvP's P2 is a
// real weapon-wielder, so the foe side reads `sess.bAttuned ?? 1` — which is
// backward-compatible (Ascent never sets bAttuned, so it stays 1).
//
// Keep this file in lockstep with app.js's Arena engine. Any combat change in
// app.js MUST be mirrored here and re-verified by the parity cross-check.
// ─────────────────────────────────────────────────────────────────────────

// ── Tunable constants (verbatim from app.js ~6770) ──
const _HP_BASE = 40, _HP_PER_DEF = 2.2, _DEF_SCALE = 60, _DMG_VAR = 0.15, _BATTLE_TURN_CAP = 40;
const _CRIT_MULT = 1.5, _CRIT_PIERCE = 0.5, _ATTUNED_MULT = 1.15;
const _MAX_HIT_FRAC = 0.55, _MAX_HIT_FRAC_CRIT = 0.75;
const _ATK_CLAMP = [0.25, 2.0], _TAKEN_CLAMP = [0.40, 2.0], _DODGE_CAP = 0.50, _ARMOR_SHRED_MIN = 0.40;
const _EDGE_TIE_BAND = 0.03, _STRUGGLE_POWER = 0.5;
const _ACC_EDGE_COEF = 0.20, _ACC_EDGE_MAXBONUS = 0.08;
const _DOT_INTAKE_CAP = 0.15;
const _ARENA_EFF_MULT = 1.20, _ARENA_EFF_PEN = 0.83;

// per-edge type-eff map (verbatim ~6788)
const _ARENA_EFF_EDGES = {
  'aggressor>trickster': { win: _ARENA_EFF_MULT, lose: _ARENA_EFF_PEN },
  'trickster>sentinel':  { win: 1.18, lose: 1 / 1.18 },
  'sentinel>aggressor':  { win: 1.08, lose: 1 / 1.08 },
};
// weapon id → archetypes it is attuned to (×1.15) — verbatim ~6794
const _WEAPON_ATTUNE = {
  titan_oathblade: ['aggressor', 'juggernaut'], hammerfall_warmaul: ['sentinel'],
  kilnforged_warblade: ['aggressor'], ten_thousand_step_blade: ['trickster', 'glasscannon'],
  vessel_of_refusal: ['sentinel'],
  nightfall_blade: ['aggressor', 'glasscannon', 'juggernaut', 'sentinel', 'trickster', 'balanced'],
  duskforge_greatblade: ['aggressor', 'juggernaut'],
  aetherspire_staff: ['sentinel', 'juggernaut'],
  wraithwind_bow: ['trickster'],
};

// ── Move templates (verbatim ~6816) ──
const ARENA_MOVE_LIB = {
  jab:        { name: 'Jab',          gl: 'sword',  power: 0.85, acc: 0.97, cd: 0, desc: 'Quick, reliable.' },
  hook:       { name: 'Hook',         gl: 'sword',  power: 1.3,  acc: 0.85, cd: 2, desc: 'Heavy fist.' },
  slash:      { name: 'Slash',        gl: 'sword',  power: 1.0,  acc: 0.95, cd: 0, desc: 'A clean cut.' },
  lunge:      { name: 'Lunge',        gl: 'sword',  power: 1.25, acc: 0.88, cd: 2, desc: 'A committed thrust.' },
  cleave:     { name: 'Cleave',       gl: 'sword',  power: 1.55, acc: 0.82, cd: 2, desc: 'Wide, heavy swing.' },
  crush:      { name: 'Crush',        gl: 'sword',  power: 1.55, acc: 0.78, cd: 2, desc: 'Bone-breaking blow.' },
  oathstrike: { name: 'Oathstrike',   gl: 'sword',  power: 1.95, acc: 0.88, cd: 3, desc: 'A vow made steel.' },
  eclipse:    { name: 'Eclipse',      gl: 'sword',  power: 1.1,  acc: 0.9,  hits: 2, cd: 2, desc: 'Strikes twice — once in light, once in shadow.' },
  flurry:     { name: 'Flurry',       gl: 'dagger', power: 0.5,  acc: 0.95, hits: 3, cd: 1, desc: 'Three fast cuts.' },
  quickstep:  { name: 'Quickstep',    gl: 'dagger', power: 0.7,  acc: 0.99, prio: 1, cd: 1, desc: 'Always strikes first.' },
  thousand:   { name: 'Thousand Cuts',gl: 'dagger', power: 0.45, acc: 0.95, hits: 4, cd: 3, desc: 'A storm of blades.' },
  ember:      { name: 'Ember',        gl: 'burst',  power: 0.7,  acc: 0.95, cd: 2, fx: { t: 'bleed', mag: 0.12, dur: 3 }, desc: 'Opens a bleeding wound.' },
  searing:    { name: 'Searing Cut',  gl: 'burst',  power: 1.1,  acc: 0.9,  cd: 1, fx: { t: 'burn', mag: 0.16, dur: 3 }, desc: 'A cut that smolders.' },
  immolate:   { name: 'Immolate',     gl: 'burst',  power: 1.6,  acc: 0.85, cd: 3, fx: { t: 'burn', mag: 0.16, dur: 2 }, desc: 'Engulf in flame.' },
  sunder:     { name: 'Sunder',       gl: 'shield', power: 0.8,  acc: 0.92, cd: 2, fx: { t: 'defDown', kind: 'sunder', mag: 0.25, dur: 3 }, desc: 'Shreds armor -25% (3t).' },
  stagger:    { name: 'Stagger',      gl: 'shield', power: 0.9,  acc: 0.85, cd: 4, fx: { t: 'stun', dur: 1 }, desc: 'Stuns — foe skips a turn.' },
  quake:      { name: 'Quake',        gl: 'shield', power: 1.2,  acc: 0.85, cd: 2, fx: { t: 'defDown', kind: 'quake', mag: 0.2, dur: 2 }, desc: 'Shreds armor -20% (2t).' },
  willbreak:  { name: 'Willbreak',    gl: 'shield', power: 0.85, acc: 0.9,  cd: 2, fx: { t: 'atkDown', kind: 'willbreak', mag: 0.25, dur: 2 }, desc: 'Foe hits 25% softer.' },
  wardstrike: { name: 'Ward Strike',  gl: 'shield', power: 0.7,  acc: 0.95, cd: 1, fx: { t: 'heal', mag: 0.12 }, desc: 'Strike and mend.' },
  guard:      { name: 'Guard',        gl: 'shield', power: 0,    acc: 1,    cd: 1, fx: { t: 'defUp', kind: 'guard', mag: -0.40, dur: 3 }, desc: 'Brace — take 40% less for 3 turns.' },
  brace:      { name: 'Brace',        gl: 'shield', power: 0,    acc: 1,    cd: 2, fx: { t: 'defUp', kind: 'brace', mag: -0.35, dur: 2 }, desc: 'Take 35% less for 2 turns.' },
  focus:      { name: 'Focus',        gl: 'burst',  power: 0,    acc: 1,    cd: 2, fx: { t: 'atkUp', kind: 'focus', mag: 0.4, dur: 3 }, desc: 'Your hits land 40% harder.' },
  temper:     { name: 'Temper',       gl: 'burst',  power: 0,    acc: 1,    cd: 3, fx: { t: 'atkUp', kind: 'temper', mag: 0.4, dur: 3 }, desc: 'Stoke your fury (+40%).' },
  evade:      { name: 'Evade',        gl: 'dagger', power: 0,    acc: 1,    cd: 2, fx: { t: 'dodge', kind: 'evade', mag: 0.4, dur: 2 }, desc: '40% dodge for 2 turns.' },
  refuse:     { name: 'Refuse',       gl: 'shield', power: 0,    acc: 1,    cd: 2, fx: { t: 'guardCleanse' }, desc: 'Guard and shed afflictions.' },
  lastvow:    { name: 'Last Vow',     gl: 'shield', power: 0,    acc: 1,    cd: 4, fx: { t: 'heal', mag: 0.4 }, desc: 'Restore 40% of your health.' },
  arcanebolt: { name: 'Arcane Bolt',  gl: 'magic',  power: 1.0,  acc: 0.95, cd: 0, desc: 'A bolt of raw mana.' },
  forcewave:  { name: 'Force Wave',   gl: 'magic',  power: 1.55, acc: 0.78, cd: 2, desc: 'A crushing wave of force.' },
  manaward:   { name: 'Mana Ward',    gl: 'magic',  power: 0,    acc: 1,    cd: 2, fx: { t: 'defUp', kind: 'brace', mag: -0.35, dur: 2 }, desc: 'Glyphs blunt the blows — take 35% less (2t).' },
  dispel:     { name: 'Dispel',       gl: 'magic',  power: 0,    acc: 1,    cd: 2, fx: { t: 'guardCleanse' }, desc: 'Unravel afflictions and ward.' },
  siphon:     { name: 'Siphon',       gl: 'magic',  power: 0.7,  acc: 0.95, cd: 1, fx: { t: 'heal', mag: 0.12 }, desc: 'Drain vitality — strike and mend.' },
  shatterhex: { name: 'Shatter Hex',  gl: 'magic',  power: 1.2,  acc: 0.85, cd: 2, fx: { t: 'defDown', kind: 'quake', mag: 0.2, dur: 2 }, desc: 'A hex that cracks armor -20% (2t).' },
  arrowvolley:{ name: 'Arrow Volley', gl: 'ranged', power: 0.5,  acc: 0.95, hits: 3, cd: 1, desc: 'Three arrows in a breath.' },
  snapshot:   { name: 'Snap Shot',    gl: 'ranged', power: 0.7,  acc: 0.99, prio: 1, cd: 1, desc: 'Looses first — always strikes first.' },
  tumble:     { name: 'Tumble',       gl: 'ranged', power: 0,    acc: 1,    cd: 2, fx: { t: 'dodge', kind: 'evade', mag: 0.4, dur: 2 }, desc: 'Roll aside — 40% dodge (2t).' },
  flamearrow: { name: 'Flame Arrow',  gl: 'ranged', power: 1.1,  acc: 0.9,  cd: 1, fx: { t: 'burn', mag: 0.16, dur: 3 }, desc: 'A shaft wrapped in fire.' },
  quickshot:  { name: 'Quick Shot',   gl: 'ranged', power: 1.0,  acc: 0.95, cd: 0, desc: 'A clean shot.' },
  cataclysm:  { name: 'Cataclysm',    gl: 'magic',  power: 1.95, acc: 0.88, cd: 3, desc: 'The heavens answer.' },
  heartseeker:{ name: 'Heartseeker',  gl: 'ranged', power: 1.95, acc: 0.88, cd: 3, desc: 'One arrow. One heart.' },
};

// weapon id → 4 move ids (verbatim ~6864)
const WEAPON_MOVES = {
  unarmed:               ['jab', 'hook', 'guard', 'focus'],
  rusted_training_blade: ['slash', 'lunge', 'guard', 'focus'],
  titan_oathblade:       ['cleave', 'sunder', 'brace', 'oathstrike'],
  hammerfall_warmaul:    ['crush', 'stagger', 'brace', 'quake'],
  kilnforged_warblade:   ['searing', 'ember', 'temper', 'immolate'],
  ten_thousand_step_blade:['flurry', 'quickstep', 'evade', 'thousand'],
  vessel_of_refusal:     ['wardstrike', 'refuse', 'willbreak', 'lastvow'],
  nightfall_blade:       ['eclipse', 'oathstrike', 'immolate', 'temper'],
  duskforge_greatblade:  ['cleave', 'oathstrike', 'immolate', 'temper'],
  aetherspire_staff:     ['arcanebolt', 'cataclysm', 'immolate', 'siphon'],
  wraithwind_bow:        ['heartseeker', 'arrowvolley', 'flamearrow', 'quickshot'],
  twin_fang_cleaver:     ['slash', 'cleave', 'crush', 'lunge'],
  twofold_gaze:          ['arcanebolt', 'immolate', 'cataclysm', 'siphon'],
  bothsight_longbow:     ['arrowvolley', 'snapshot', 'flamearrow', 'tumble'],
  houndsfang_recurve:    ['arrowvolley', 'snapshot', 'flamearrow', 'tumble'],
  coursing_houndcall:    ['arcanebolt', 'immolate', 'cataclysm', 'siphon'],
  the_long_pursuit:      ['arrowvolley', 'snapshot', 'flamearrow', 'tumble'],
  the_monarchs_writ:     ['arcanebolt', 'immolate', 'cataclysm', 'siphon'],
  crownpiercer:          ['arrowvolley', 'snapshot', 'flamearrow', 'tumble'],
  the_hollow_crown:      ['arcanebolt', 'immolate', 'cataclysm', 'siphon'],
};

// minimal pure HTML-escape (event text is display-only; client re-derives per
// perspective for PvP, but we keep the engine's text baking faithful).
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── RNG + pure helpers (verbatim ~6804–6958) ──
function _arMulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function _arenaMaxHP(c) { return Math.max(20, Math.round(_HP_BASE + (c.defense || 0) * _HP_PER_DEF)); }
function _arBlankStatus() { return { mods: [], stun: 0, guard: 0 }; }
function _arClamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function _arPushMod(S, k, kind, mag, dur) {
  const ex = S.mods.find((x) => x.k === k && x.kind === kind);
  if (ex) { ex.dur = Math.max(ex.dur, dur); if (Math.abs(mag) > Math.abs(ex.mag)) ex.mag = mag; }
  else S.mods.push({ k, kind, mag, dur });
}
function _arStatAtkMult(s) { let m = 1; s.mods.forEach((x) => { if (x.k === 'atk') m *= (1 + x.mag); }); return _arClamp(m, _ATK_CLAMP[0], _ATK_CLAMP[1]); }
function _arStatTakenMult(s) { let m = 1; s.mods.forEach((x) => { if (x.k === 'def') m *= (1 + x.mag); }); return _arClamp(m, _TAKEN_CLAMP[0], _TAKEN_CLAMP[1]); }
function _arStatDodge(s) { let d = 0; s.mods.forEach((x) => { if (x.k === 'dodge') d += x.mag; }); return Math.min(_DODGE_CAP, d); }
function _arStatArmorShred(s) { let m = 1; s.mods.forEach((x) => { if (x.k === 'shred') m *= (1 - x.mag); }); return Math.max(_ARMOR_SHRED_MIN, m); }
function _arStruggleMove() { return { id: 'struggle', name: 'Struggle', gl: 'sword', power: _STRUGGLE_POWER, acc: 0.95, cd: 0, desc: 'A desperate blow.' }; }
function _arAccBonusOf(c) {
  const tot = (c.attack || 0) + (c.defense || 0) + (c.edge || 0) || 1e-6;
  return Math.min(_ACC_EDGE_MAXBONUS, ((c.edge || 0) / tot) * _ACC_EDGE_COEF);
}

// ── Profile / archetype / effectiveness (verbatim ~6627–6728) ──
function _arenaCombatProfile(s) {
  const attack  = s.STR * 2.3;
  const defense = (s.INT + s.VIT) * 1.15;
  const edge    = (s.FOCUS + s.WILL) * 1.15;
  return { attack, defense, edge, power: attack + defense + edge, stats: s };
}
function _arenaArchOf(c) {
  const tot = Math.max(1e-6, (c.attack || 0) + (c.defense || 0) + (c.edge || 0));
  const a = (c.attack || 0) / tot, d = (c.defense || 0) / tot, e = (c.edge || 0) / tot;
  const mx = Math.max(a, d, e);
  if (mx < 0.40) return 'balanced';
  if (a === mx) return a >= 0.52 ? 'glasscannon' : 'aggressor';
  if (d === mx) return d >= 0.52 ? 'juggernaut'  : 'sentinel';
  return 'trickster';
}
function _arenaBaseArch(k) { return k === 'glasscannon' ? 'aggressor' : k === 'juggernaut' ? 'sentinel' : k; }
function _arenaEffectiveness(pa, fa) {
  const p = _arenaBaseArch(pa), f = _arenaBaseArch(fa);
  if (p === 'balanced' || f === 'balanced' || p === f) return { key: 'neutral', label: 'EVEN MATCH', mult: 1.0 };
  const sup = _ARENA_EFF_EDGES[p + '>' + f];
  if (sup) return { key: 'super', label: 'SUPER EFFECTIVE', mult: sup.win };
  const weak = _ARENA_EFF_EDGES[f + '>' + p];
  if (weak) return { key: 'weak',  label: 'NOT VERY EFFECTIVE', mult: weak.lose };
  return { key: 'neutral', label: 'EVEN MATCH', mult: 1.0 };
}
function _arenaSideOdds(c) {
  const tot = Math.max(1e-6, (c.attack || 0) + (c.defense || 0) + (c.edge || 0));
  const edgeShare = (c.edge || 0) / tot;
  const crit = Math.max(0.08, Math.min(0.28, 0.08 + edgeShare * 0.40));
  let miss = 0.09;
  if (c.stats && typeof c.stats.FOCUS === 'number') {
    const six = ['STR', 'VIT', 'INT', 'FOCUS', 'WILL', 'WLT'].reduce((a, k) => a + (c.stats[k] || 0), 0) || 1;
    const focusShare = (c.stats.FOCUS || 0) / six;
    miss = Math.max(0.04, 0.09 - Math.max(0, focusShare - 0.166) * 0.40);
  }
  return { crit, miss };
}

// Build a kit (4 move objects) from a weapon id — pure (no getHunterBuild/CARDS).
function kitForWeapon(weaponId) {
  const ids = (weaponId && WEAPON_MOVES[weaponId]) ? WEAPON_MOVES[weaponId] : WEAPON_MOVES.unarmed;
  return ids.map((id) => Object.assign({ id }, ARENA_MOVE_LIB[id]));
}
function attuneForWeapon(weaponId, arch) {
  const list = weaponId && _WEAPON_ATTUNE[weaponId];
  return (list && list.indexOf(arch) !== -1) ? _ATTUNED_MULT : 1;
}

// ── v2 (tier-2) AI picker — verbatim ~6993. PvP never calls this (foe move is
//    the human's submitted move); kept for the Ascent-parity cross-check + as a
//    safe default foe-picker for auto-turn timeouts. ──
function _arenaPickMove(ctx) {
  const off = ctx.moves.filter((mv) => !(ctx.cd[mv.id] > 0));
  if (!off.length) return _arStruggleMove();
  const dotFrac = Math.min(_DOT_INTAKE_CAP, ctx.selfS.mods.filter((x) => x.k === 'dot').reduce((a, x) => a + x.mag, 0));
  if (dotFrac >= 0.08) {
    const cleanse = off.find((mv) => mv.fx && mv.fx.t === 'guardCleanse');
    if (cleanse && ctx.rng() < 0.90) return cleanse;
  }
  if (ctx.selfHP / ctx.selfMax < 0.35) {
    const heal = off.find((mv) => mv.fx && mv.fx.t === 'heal');
    if (heal && ctx.rng() < 0.70) return heal;
    const guard = off.find((mv) => mv.fx && mv.fx.t === 'guard') || off.find((mv) => mv.fx && mv.fx.t === 'defUp');
    if (guard && ctx.rng() < 0.70) return guard;
  }
  const atkUpActive = ctx.selfS.mods.some((x) => x.k === 'atk' && x.mag > 0);
  if (!atkUpActive && ctx.selfHP / ctx.selfMax >= 0.60 && ctx.foeHP / ctx.foeMax >= 0.70) {
    const setup = off.find((mv) => mv.fx && mv.fx.t === 'atkUp');
    if (setup && ctx.rng() < 0.60) return setup;
  }
  const hpFrac = ctx.selfHP / ctx.selfMax;
  if (hpFrac >= 0.35 && hpFrac < 0.70 && !ctx.selfS.mods.some((x) => x.k === 'dodge')) {
    const evade = off.find((mv) => mv.fx && mv.fx.t === 'dodge');
    if (evade && ctx.rng() < 0.60) return evade;
  }
  const attacks = off.filter((mv) => (mv.power || 0) > 0);
  if (!attacks.length) return off[Math.floor(ctx.rng() * off.length)];
  const foeLacks = (fx) => {
    if (!fx) return false;
    if (fx.t === 'burn' || fx.t === 'bleed') return !ctx.foeS.mods.some((x) => x.k === 'dot' && x.kind === fx.t);
    if (fx.t === 'defDown') return !ctx.foeS.mods.some((x) => x.k === 'shred' && x.kind === (fx.kind || fx.t));
    if (fx.t === 'atkDown') return !ctx.foeS.mods.some((x) => x.k === 'atk' && x.kind === (fx.kind || fx.t));
    if (fx.t === 'stun') return !(ctx.foeS.stun > 0);
    return false;
  };
  const weights = attacks.map((mv) => {
    let w = (mv.power || 0) * (mv.acc != null ? mv.acc : 1) * (mv.hits || 1) * ctx.typeEff;
    if (mv.fx && foeLacks(mv.fx)) w *= 1.5;
    return w;
  });
  let r = ctx.rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < attacks.length; i++) { r -= weights[i]; if (r <= 0) return attacks[i]; }
  return attacks[attacks.length - 1];
}
// default foe-move picker for the 'b' side (tier-2 only, server-safe)
function _arenaFoePick(sess) {
  return _arenaPickMove({
    moves: sess.bMoves, cd: sess.bcd,
    selfHP: sess.bHP, selfMax: sess.bMax, selfS: sess.bS,
    foeHP: sess.pHP, foeMax: sess.pMax, foeS: sess.pS,
    typeEff: sess.bEff, rng: sess.rng,
  });
}
function _arEdge(sess, side) { return side === 'p' ? (sess.m.player.edge || 0) : (sess.m.bot.edge || 0); }

// ── Move execution (verbatim ~7318, with the bAttuned generalization) ──
function _arExecMove(sess, side, move, events) {
  const atkS = side === 'p' ? sess.pS : sess.bS, defS = side === 'p' ? sess.bS : sess.pS;
  const atkName = side === 'p' ? 'You' : esc(sess.m.bot.name);
  const defName = side === 'p' ? esc(sess.m.bot.name) : 'You';
  if (atkS.stun > 0) { atkS.stun -= 1; events.push({ side, t: 'stun', text: atkName + ' — stunned, can\'t move.' }); return; }
  const power = move.power || 0;
  if (power > 0) {
    const atkBase  = (side === 'p' ? sess.m.player.attack : sess.m.bot.attack) || 0;
    // PvP generalization: the foe ('b') is a real player with a weapon, so it
    // gets its own attune. Ascent never sets sess.bAttuned, so this stays 1.
    const attuned  = side === 'p' ? sess.pAttuned : (sess.bAttuned != null ? sess.bAttuned : 1);
    const typeEff  = side === 'p' ? sess.pEff : sess.bEff;
    const baseAtk  = atkBase * _arStatAtkMult(atkS) * attuned;
    const critCh   = side === 'p' ? sess.pCrit : sess.bCrit;
    const defBase  = (side === 'p' ? sess.m.bot.defense : sess.m.player.defense) || 0;
    const shred    = _arStatArmorShred(defS);
    const takenM   = _arStatTakenMult(defS);
    const dodge    = _arStatDodge(defS);
    const accBonus = side === 'p' ? sess.pAccB : sess.bAccB;
    const maxHPd   = side === 'p' ? sess.bMax : sess.pMax;
    const remBefore = side === 'p' ? sess.bHP : sess.pHP;
    const hits = move.hits || 1;
    let total = 0, anyLanded = false, anyCrit = false, missed = 0, dodged = 0, guardUsed = false;
    for (let h = 0; h < hits; h++) {
      const acc = Math.min(0.99, (move.acc != null ? move.acc : 1) + accBonus);
      if (sess.rng() > acc) { missed++; continue; }
      if (dodge > 0 && sess.rng() < dodge) { dodged++; continue; }
      const crit = sess.rng() < critCh;
      const defEff = defBase * shred * (crit ? (1 - _CRIT_PIERCE) : 1);
      let hit = baseAtk * power * typeEff / (1 + defEff / _DEF_SCALE);
      if (crit) { hit *= _CRIT_MULT; anyCrit = true; }
      else { hit *= takenM; }
      hit *= 1 + (sess.rng() * 2 - 1) * _DMG_VAR;
      if (defS.guard > 0 && !guardUsed && hit > 0) { hit *= 0.5; guardUsed = true; }
      total += Math.max(0, hit); anyLanded = true;
    }
    if (guardUsed) defS.guard = 0;
    if (anyLanded) total = Math.min(total, (anyCrit ? _MAX_HIT_FRAC_CRIT : _MAX_HIT_FRAC) * maxHPd);
    if (anyLanded) {
      const shown = Math.max(1, Math.round(total));
      const effective = Math.min(total, remBefore);
      if (side === 'p') sess.bHP = Math.max(0, sess.bHP - total);
      else { sess.pHP = Math.max(0, sess.pHP - total); sess.untouched = false; }
      sess.dmgDealt[side] += effective;
      events.push({ side, t: 'hit', gl: move.gl, crit: anyCrit, dmg: shown, move: move.name, text: atkName + ' — ' + move.name + (hits > 1 ? ' ×' + hits : '') + ' for ' + shown + (anyCrit ? ' (CRIT!)' : '') + '.' });
    } else if (dodged && !missed) {
      events.push({ side, t: 'dodge', move: move.name, text: defName + ' dodges ' + move.name + '!' });
    } else {
      events.push({ side, t: 'miss', move: move.name, text: atkName + ' — ' + move.name + ' misses!' });
    }
  }
  if (move.fx) _arApplyFx(sess, side, move.fx, events, atkName, defName);
  if (sess.bHP <= 0) { sess.done = true; sess.won = true; }
  else if (sess.pHP <= 0) { sess.done = true; sess.won = false; }
}
function _arApplyFx(sess, side, fx, events, atkName, defName) {
  const selfS = side === 'p' ? sess.pS : sess.bS, foeS = side === 'p' ? sess.bS : sess.pS;
  const isAre = defName === 'You' ? 'are' : 'is';
  switch (fx.t) {
    case 'burn': case 'bleed': {
      if (foeS.mods.some((x) => x.k === 'dotImmune')) {
        events.push({ side, t: 'fx', text: defName + ' — cauterized; the ' + fx.t + ' does not take.' }); break;
      }
      const aC = side === 'p' ? sess.m.player : sess.m.bot;
      const tC = side === 'p' ? sess.m.bot : sess.m.player;
      const aPow = (aC.attack || 0) + (aC.defense || 0) + (aC.edge || 0);
      const tPow = ((tC.attack || 0) + (tC.defense || 0) + (tC.edge || 0)) || 1e-6;
      const magEff = fx.mag * _arClamp(aPow / tPow, 0.5, 1.0);
      const ex = foeS.mods.find((x) => x.k === 'dot' && x.kind === fx.t);
      if (ex) { ex.dur = Math.max(ex.dur, fx.dur); ex.mag = Math.max(ex.mag, magEff); ex.src = side; }
      else foeS.mods.push({ k: 'dot', kind: fx.t, mag: magEff, dur: fx.dur, src: side });
      events.push({ side, t: 'fx', text: defName + ' ' + isAre + ' ' + (fx.t === 'burn' ? 'burning' : 'bleeding') + '.' }); break;
    }
    case 'stun':
      if (foeS.stun > 0) { events.push({ side, t: 'fx', text: defName + ' ' + isAre + ' already reeling.' }); }
      else { foeS.stun = 1; events.push({ side, t: 'fx', text: defName + ' ' + isAre + ' stunned.' }); }
      break;
    case 'atkUp': _arPushMod(selfS, 'atk', fx.kind || fx.t, fx.mag, fx.dur); events.push({ side, t: 'fx', text: atkName + ' — attack up.' }); break;
    case 'atkDown': _arPushMod(foeS, 'atk', fx.kind || fx.t, -fx.mag, fx.dur); events.push({ side, t: 'fx', text: defName + ' — attack down.' }); break;
    case 'defUp': _arPushMod(selfS, 'def', fx.kind || fx.t, fx.mag, fx.dur); events.push({ side, t: 'fx', text: atkName + ' braces.' }); break;
    case 'defDown': _arPushMod(foeS, 'shred', fx.kind || fx.t, fx.mag, fx.dur); events.push({ side, t: 'fx', text: defName + ' — armor shredded.' }); break;
    case 'dodge': _arPushMod(selfS, 'dodge', fx.kind || fx.t, fx.mag, fx.dur); events.push({ side, t: 'fx', text: atkName + ' — evasive.' }); break;
    case 'guard': selfS.guard = 1; events.push({ side, t: 'fx', text: atkName + ' guards.' }); break;
    case 'guardCleanse':
      selfS.guard = 1; selfS.mods = selfS.mods.filter((x) => !(x.k === 'dot' || x.k === 'shred' || x.mag < 0)); selfS.stun = 0;
      _arPushMod(selfS, 'dotImmune', 'cauterize', 1, 2);
      events.push({ side, t: 'fx', text: atkName + ' refuses — afflictions shed, wounds cauterized.' }); break;
    case 'heal': {
      const max = side === 'p' ? sess.pMax : sess.bMax;
      const amt = Math.round(max * fx.mag);
      if (side === 'p') sess.pHP = Math.min(sess.pMax, sess.pHP + amt); else sess.bHP = Math.min(sess.bMax, sess.bHP + amt);
      events.push({ side, t: 'heal', text: atkName + ' — restores ' + amt + ' HP.' }); break;
    }
  }
}
function _arEndTurn(sess, events) {
  ['p', 'b'].forEach((side) => {
    const S = side === 'p' ? sess.pS : sess.bS;
    const max = side === 'p' ? sess.pMax : sess.bMax;
    const dots = S.mods.filter((x) => x.k === 'dot');
    if (dots.length) {
      const raw = dots.map((d) => Math.max(1, Math.round(max * d.mag)));
      const rawSum = raw.reduce((a, b) => a + b, 0);
      const capAmt = Math.round(max * _DOT_INTAKE_CAP);
      const scale = rawSum > capAmt ? capAmt / rawSum : 1;
      dots.forEach((d, i) => {
        const dmg = Math.max(1, Math.round(raw[i] * scale));
        const before = side === 'p' ? sess.pHP : sess.bHP;
        if (side === 'p') { sess.pHP = Math.max(0, sess.pHP - dmg); sess.untouched = false; } else sess.bHP = Math.max(0, sess.bHP - dmg);
        if (d.src) sess.dmgDealt[d.src] += Math.min(dmg, before);
        events.push({ side: side === 'p' ? 'b' : 'p', t: 'dot', dmg, kind: d.kind, text: (side === 'p' ? 'You take' : esc(sess.m.bot.name) + ' takes') + ' ' + dmg + ' from ' + d.kind + '.' });
      });
    }
    S.mods.forEach((x) => { x.dur -= 1; });
    S.mods = S.mods.filter((x) => x.dur > 0);
  });
  Object.keys(sess.cd).forEach((k) => { if (sess.cd[k] > 0) sess.cd[k] -= 1; });
  Object.keys(sess.bcd).forEach((k) => { if (sess.bcd[k] > 0) sess.bcd[k] -= 1; });
  if (sess.bHP <= 0) { sess.done = true; sess.won = true; }
  else if (sess.pHP <= 0) { sess.done = true; sess.won = false; }
}

// ── Shared turn resolution body (factored from arenaTakeTurn ~7469). Both the
//    Ascent (AI foe) and PvP (human foe) run THIS — one resolution path. ──
function _arResolveTurn(sess, pMove, bMove) {
  const events = [];
  const pPrio = pMove.prio || 0, bPrio = bMove.prio || 0;
  let pFirst;
  if (pPrio !== bPrio) pFirst = pPrio > bPrio;
  else {
    const eP = _arEdge(sess, 'p'), eB = _arEdge(sess, 'b'), mx = Math.max(eP, eB, 1);
    pFirst = (Math.abs(eP - eB) / mx <= _EDGE_TIE_BAND) ? (sess.rng() < 0.5) : (eP > eB);
  }
  const order = pFirst ? ['p', 'b'] : ['b', 'p'];
  for (const s of order) { if (sess.done) break; _arExecMove(sess, s, s === 'p' ? pMove : bMove, events); }
  if (pMove.cd) sess.cd[pMove.id] = pMove.cd + 1;
  if (bMove.cd) sess.bcd[bMove.id] = bMove.cd + 1;
  if (!sess.done) _arEndTurn(sess, events);
  sess.turn += 1;
  if (!sess.done && sess.turn > _BATTLE_TURN_CAP) {
    const dp = sess.dmgDealt.p, db = sess.dmgDealt.b;
    sess.won = (dp !== db) ? (dp > db) : ((sess.pHP / sess.pMax !== sess.bHP / sess.bMax) ? (sess.pHP / sess.pMax > sess.bHP / sess.bMax) : (sess.rng() < 0.5));
    sess.done = true;
    sess.timedOut = true;
  }
  sess.log = events;
  return events;
}

// Ascent-parity entry: player move id + AI foe (verbatim semantics of app.js
// arenaTakeTurn, minus the tiered-AI/seen tracking which PvP and tier-2 ignore).
function arenaTakeTurn(sess, moveId) {
  if (!sess || sess.done) return null;
  let pMove = sess.pMoves.find((x) => x.id === moveId);
  if (!pMove && moveId === 'struggle') pMove = _arStruggleMove();
  if (!pMove || sess.cd[pMove.id] > 0) return null;
  const bMove = _arenaFoePick(sess);
  return _arResolveTurn(sess, pMove, bMove);
}

// ── PvP entry points ──

// Build a server-side combatant from client-submitted data. stats = {STR,VIT,
// INT,FOCUS,WILL,WLT}; weaponId selects the kit + attune. The client computes
// these from its build; the server validates + bounds them (caller's job) and
// owns resolution.
function buildCombatant(input) {
  const stats = {
    STR: +(input.stats && input.stats.STR) || 0, VIT: +(input.stats && input.stats.VIT) || 0,
    INT: +(input.stats && input.stats.INT) || 0, FOCUS: +(input.stats && input.stats.FOCUS) || 0,
    WILL: +(input.stats && input.stats.WILL) || 0, WLT: +(input.stats && input.stats.WLT) || 0,
  };
  const profile = _arenaCombatProfile(stats);
  const arch = _arenaArchOf(profile);
  const weaponId = input.weaponId || 'unarmed';
  return {
    name: String(input.name || 'Hunter'),
    attack: profile.attack, defense: profile.defense, edge: profile.edge, power: profile.power,
    stats, arch, weaponId,
    weaponName: String(input.weaponName || ''),
    kit: kitForWeapon(weaponId),
    attuned: attuneForWeapon(weaponId, arch),
    isBot: false,
  };
}

// Start a PvP battle session from two pre-computed combatants + an explicit seed.
// Mirrors arenaStartBattle's 19-field session shape, minus the impure setup.
function pvpStartBattle(pa, pb, seed) {
  const playerArch = pa.arch || _arenaArchOf(pa);
  const foeArch    = pb.arch || _arenaArchOf(pb);
  const eff        = _arenaEffectiveness(playerArch, foeArch);
  const pMax = _arenaMaxHP(pa), bMax = _arenaMaxHP(pb);
  const s = (seed != null) ? (seed >>> 0) : 1;
  return {
    m: { player: pa, bot: pb },
    eff, playerArch, foeArch, weaponName: pa.weaponName || '',
    pEff: eff.mult, bEff: _arenaEffectiveness(foeArch, playerArch).mult,
    pCrit: _arenaSideOdds(pa).crit, bCrit: _arenaSideOdds(pb).crit,
    pAccB: _arAccBonusOf(pa), bAccB: _arAccBonusOf(pb),
    pAttuned: pa.attuned != null ? pa.attuned : 1,
    bAttuned: pb.attuned != null ? pb.attuned : 1,   // PvP: foe is a weapon-wielder
    pHP: pMax, pMax, bHP: bMax, bMax,
    pS: _arBlankStatus(), bS: _arBlankStatus(),
    pMoves: pa.kit, bMoves: pb.kit,
    cd: {}, bcd: {}, turn: 1, log: [], done: false, won: false, untouched: true,
    rng: _arMulberry32(s), dmgDealt: { p: 0, b: 0 }, aiTier: 2,
  };
}

// Validate that a move id is legal for a side (in kit + off cooldown).
// Returns the move object or null.
function _validMove(moves, cdMap, moveId) {
  const mv = moves.find((x) => x.id === moveId);
  if (!mv) return (moveId === 'struggle') ? _arStruggleMove() : null;
  if (cdMap[mv.id] > 0) return null;
  return mv;
}

// Resolve ONE PvP turn given both players' submitted move ids. P1 = 'p' side,
// P2 = 'b' side. Returns { ok, events } or { ok:false, code } if a move is
// illegal. The DO calls this once it has both moves for the turn.
function pvpResolveTurn(sess, moveIdP, moveIdB) {
  if (!sess || sess.done) return { ok: false, code: 'DONE' };
  const pMove = _validMove(sess.pMoves, sess.cd, moveIdP);
  if (!pMove) return { ok: false, code: 'BAD_MOVE_P' };
  const bMove = _validMove(sess.bMoves, sess.bcd, moveIdB);
  if (!bMove) return { ok: false, code: 'BAD_MOVE_B' };
  const events = _arResolveTurn(sess, pMove, bMove);
  return { ok: true, events };
}

// Pick a safe default move for a side that timed out (no submission). Prefer a
// defensive move, else the first off-cooldown move, else struggle.
function defaultMoveForTimeout(moves, cdMap) {
  const off = moves.filter((mv) => !(cdMap[mv.id] > 0));
  if (!off.length) return 'struggle';
  const guard = off.find((mv) => mv.fx && (mv.fx.t === 'guard' || mv.fx.t === 'defUp'));
  if (guard) return guard.id;
  return off[0].id;
}

// Final result of a finished session (mirrors the win/loss decision).
function pvpResult(sess) {
  return {
    done: !!sess.done,
    winnerSide: sess.done ? (sess.won ? 'p' : 'b') : null,
    pHP: sess.pHP, bHP: sess.bHP, pMax: sess.pMax, bMax: sess.bMax,
    turns: sess.turn,
    timedOut: !!sess.timedOut,
    dpDealt: Math.round(sess.dmgDealt.p), dbDealt: Math.round(sess.dmgDealt.b),
  };
}

export {
  // constants + tables (for validation + the client cross-check)
  ARENA_MOVE_LIB, WEAPON_MOVES, _WEAPON_ATTUNE, _BATTLE_TURN_CAP, _ATTUNED_MULT,
  // pure engine (cross-check + Ascent parity)
  _arMulberry32, _arenaCombatProfile, _arenaArchOf, _arenaEffectiveness, _arenaSideOdds,
  _arExecMove, _arApplyFx, _arEndTurn, _arResolveTurn, _arenaPickMove, arenaTakeTurn,
  kitForWeapon, attuneForWeapon,
  // PvP API
  buildCombatant, pvpStartBattle, pvpResolveTurn, defaultMoveForTimeout, pvpResult,
};
