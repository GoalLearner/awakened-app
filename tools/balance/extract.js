// tools/balance/extract.js — pull the REAL item catalog + boss/drop config out of
// app.js (no hand-transcription) and emit tools/balance/items.json for analysis.
//   node tools/balance/extract.js
// Reads app.js, slices out the CARDS / BOSSES / DROP_RATES_BY_CADENCE object
// literals with a string+comment-aware brace matcher, evals them, joins each item
// to its source boss (rank, cadence, drop rate), and writes JSON.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
// Optional args: [sourceAppJsPath] [outJsonPath] [--assert]. Defaults to ./app.js -> items.json.
// (Lets us extract a git-stashed "before" copy for before/after comparison.)
// W993 — `--assert` exits 1 when the relic ladder inverts; and a dropped item's tier
// must equal its source boss's rank. Wired into CI + `npm run balance:check`.
// W1112 (owner 2026-10-29: "a rare drop from an A tier should outpower E and D tier
// drops") — the ladder is RANK FIRST, then rarity: every rare / ultra / mythic beats
// every one from a lower rank, and within a rank mythic > ultra > rare. Commons sit
// under every rare (fill-in drops), lowest rank lowest. Upgrades may lift a relic past
// the next rank but never past its own rarity two ranks up.
const ASSERT = process.argv.includes('--assert');
const posArgs = process.argv.slice(2).filter(a => a !== '--assert');
const srcPath = posArgs[0] ? path.resolve(posArgs[0]) : path.join(ROOT, 'app.js');
const outPath = posArgs[1] ? path.resolve(posArgs[1]) : path.join(__dirname, 'items.json');
const src = fs.readFileSync(srcPath, 'utf8');

// Walk from `const NAME = {` to its matching `}`, skipping strings + comments so
// braces inside flavor text or `// comments` don't throw off the depth count.
function extractLiteral(name) {
  const decl = new RegExp('const\\s+' + name + '\\s*=\\s*');
  const m = decl.exec(src);
  if (!m) throw new Error('not found: ' + name);
  let i = src.indexOf('{', m.index);
  const start = i;
  let depth = 0, str = null, esc = false, line = false, block = false;
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (line) { if (c === '\n') line = false; continue; }
    if (block) { if (c === '*' && n === '/') { block = false; i++; } continue; }
    if (str) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === str) str = null;
      continue;
    }
    if (c === '/' && n === '/') { line = true; i++; continue; }
    if (c === '/' && n === '*') { block = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { str = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced literal: ' + name);
}

const CARDS  = eval('(' + extractLiteral('CARDS') + ')');
const BOSSES = eval('(' + extractLiteral('BOSSES') + ')');
const DROPS  = require(path.join(ROOT, 'lib', 'drops.js'));   // W992 — the tables moved out of app.js
const RATES  = DROPS.DROP_RATES_BY_CADENCE;

function effRate(boss, rarity) {
  if (boss && boss.dropTable && typeof boss.dropTable[rarity] === 'number') return boss.dropTable[rarity];
  const r = boss && DROPS.ratesFor({ rank: boss.rank, cadence: boss.cadence });
  return r && typeof r[rarity] === 'number' ? r[rarity] : null;
}

// W993 — the number the app shows (_relicProfile in app.js): STR counts double.
function displayedPower(b) {
  return Math.round((b.str||0) * 2.3 + ((b.focus||0) + (b.will||0)) * 1.15 + ((b.int||0) + (b.vit||0)) * 1.15);
}
function archOf(b) {
  const m = (b.str||0) * 2.3, r = ((b.focus||0) + (b.will||0)) * 1.15, g = ((b.int||0) + (b.vit||0)) * 1.15;
  return (m >= r && m >= g) ? 'melee' : (r >= g ? 'ranger' : 'mage');
}
// W993 — every boss that can drop the card: its source_boss plus any boss whose
// cfg.pool lists it (the Gray Pilgrim, the Sentinel, the Worldspine, the Cloven
// Titan, the Grinning God).
function dropSources(cardId, sourceBoss) {
  const out = [];
  Object.values(BOSSES).forEach(bo => {
    if (!bo || !bo.id) return;
    if (bo.id === sourceBoss) out.push(bo.id);
    else if (bo.pool && Object.values(bo.pool).some(list => Array.isArray(list) && list.includes(cardId))) out.push(bo.id);
  });
  return out;
}

const items = Object.values(CARDS).map(c => {
  const boss = BOSSES[c.source_boss] || {};
  const b = c.bonuses || {};
  const combat = (b.str||0)+(b.vit||0)+(b.int||0)+(b.focus||0)+(b.will||0); // WLT excluded — economy-only, no combat role (W470)
  const sources = dropSources(c.id, c.source_boss);
  const rates = sources.map(id => effRate(BOSSES[id], c.rarity)).filter(x => typeof x === 'number');
  return {
    id: c.id, name: c.name, slot: c.slot, rarity: c.rarity, tier: c.tier,
    source_boss: c.source_boss,
    // W306 items have source_boss:null BY DESIGN — they're shop-buyable in the
    // Marketplace (not drops), so they're obtainable, not orphans.
    acquisition: c.source_boss ? 'drop' : 'shop',
    boss_name: boss.name || (c.source_boss || 'Marketplace (shop)'),
    boss_rank: boss.rank || c.tier,
    cadence: boss.cadence || null,
    coopOnly: !!boss.coopOnly,
    bonuses: { str:b.str||0, vit:b.vit||0, int:b.int||0, focus:b.focus||0, will:b.will||0, wlt:b.wlt||0 },
    combat_power: combat,
    total_power: combat + (b.wlt||0),
    displayed_power: displayedPower(b),   // W993 — what the card shows
    arch: archOf(b),
    drop_sources: sources,                // W993 — source_boss + every cfg.pool that lists it
    drop_rate: rates.length ? Math.max(...rates) : effRate(boss, c.rarity),
    special_effect: c.special_effect || null,
    set_id: c.set_id || null,
  };
});

const bosses = Object.values(BOSSES).map(b => ({
  id: b.id, name: b.name, rank: b.rank, cadence: b.cadence || null,
  archetype: b.archetype || null, statDomain: b.statDomain || null,
  coopOnly: !!b.coopOnly, dropTable: b.dropTable || null,
}));

const out = { items, bosses, rates: RATES, rates_by_rank: DROPS.DROP_RATES_BY_RANK, pity_by_rank: DROPS.DROP_PITY_BY_RANK };
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log('extracted ' + items.length + ' items across ' + bosses.length + ' bosses');
const byRar = {};
items.forEach(i => { byRar[i.rarity] = (byRar[i.rarity]||0)+1; });
console.log('by rarity:', JSON.stringify(byRar));

// ── W993 / W1112 — the ladder check ──
const TIER_ORD = { E: 0, D: 1, C: 2, B: 3, A: 4, S: 5 };
const RAR_ORD = { rare: 0, ultra_rare: 1, mythic: 2 };
const failures = [], warns = [];
const ranked = items.filter(i => TIER_ORD[i.tier] != null);
const label = i => i.tier + ' ' + i.rarity + ' "' + i.name + '" PWR ' + i.displayed_power;
// Every rare / ultra / mythic beats every one below it on (rank, rarity).
const step = i => TIER_ORD[i.tier] * 3 + RAR_ORD[i.rarity];
const drops = ranked.filter(i => RAR_ORD[i.rarity] != null);
drops.forEach(a => drops.forEach(b => {
  if (step(a) < step(b) && a.displayed_power >= b.displayed_power) failures.push('ladder: ' + label(a) + ' >= ' + label(b));
}));
// Commons: under every rare, and in rank order among themselves.
const commons = ranked.filter(i => i.rarity === 'common');
const floorRare = Math.min(...drops.map(i => i.displayed_power));
commons.forEach(a => {
  if (a.displayed_power >= floorRare) failures.push('common: ' + label(a) + ' reaches the weakest rare (' + floorRare + ')');
  commons.forEach(b => {
    if (TIER_ORD[a.tier] < TIER_ORD[b.tier] && a.displayed_power >= b.displayed_power) failures.push('common: ' + label(a) + ' >= ' + label(b));
  });
});
// Upgrades: a maxed relic stays under every fresh one of its rarity two ranks up. Mirrors
// relicUpgradeGain in app.js (weapon +1 a level on its main stat; armor +PCT of every stat
// a level, never less than +1 a level on its main stat).
const ARMOR_PCT = +(/const RELIC_ARMOR_UPGRADE_PCT\s*=\s*([\d.]+)/.exec(src) || [])[1];
const UP_MAX = +(/const RELIC_UPGRADE_MAX\s*=\s*(\d+)/.exec(src) || [])[1];
if (!(ARMOR_PCT > 0) || !(UP_MAX > 0)) failures.push('upgrade constants not found in app.js');
function maxedPower(i) {
  const b = i.bonuses, K = ['str', 'vit', 'int', 'focus', 'will'];
  const g = {}; K.forEach(k => { g[k] = i.slot === 'weapon' ? 0 : Math.round(b[k] * ARMOR_PCT * UP_MAX); });
  let dom = null, dv = 0; K.forEach(k => { if (b[k] > dv) { dv = b[k]; dom = k; } });
  if (dom && g[dom] < UP_MAX) g[dom] = UP_MAX;
  const e = {}; K.forEach(k => { e[k] = b[k] + g[k]; });
  return displayedPower(e);
}
drops.forEach(a => {
  const m = maxedPower(a);
  drops.forEach(b => {
    if (b.rarity === a.rarity && TIER_ORD[b.tier] - TIER_ORD[a.tier] >= 2 && m >= b.displayed_power) {
      failures.push('upgrade: ' + label(a) + ' maxed is ' + m + ' >= ' + label(b));
    }
  });
});
items.forEach(i => {
  const bo = BOSSES[i.source_boss];
  if (bo && bo.rank && i.tier !== bo.rank) failures.push('tier: "' + i.name + '" is ' + i.tier + ' but ' + bo.name + ' is ' + bo.rank + '-rank');
});
warns.forEach(w => console.log('warn: ' + w));
if (failures.length) {
  failures.forEach(f => console.error('FAIL: ' + f));
  console.error(failures.length + ' ladder failure(s).');
  if (ASSERT) process.exit(1);
} else {
  console.log('ladder ok: rank first then rarity, commons under every rare, upgrades never pass two ranks; every drop tier matches its boss.');
}
