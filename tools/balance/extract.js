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
// Optional args: [sourceAppJsPath] [outJsonPath]. Defaults to ./app.js -> items.json.
// (Lets us extract a git-stashed "before" copy for before/after comparison.)
const srcPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'app.js');
const outPath = process.argv[3] ? path.resolve(process.argv[3]) : path.join(__dirname, 'items.json');
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
const RATES  = eval('(' + extractLiteral('DROP_RATES_BY_CADENCE') + ')');

function effRate(boss, rarity) {
  if (boss && boss.dropTable && typeof boss.dropTable[rarity] === 'number') return boss.dropTable[rarity];
  const r = boss && RATES[boss.cadence];
  return r && typeof r[rarity] === 'number' ? r[rarity] : null;
}

const items = Object.values(CARDS).map(c => {
  const boss = BOSSES[c.source_boss] || {};
  const b = c.bonuses || {};
  const combat = (b.str||0)+(b.vit||0)+(b.int||0)+(b.focus||0)+(b.will||0); // WLT excluded — economy-only, no combat role (W470)
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
    drop_rate: effRate(boss, c.rarity),
    special_effect: c.special_effect || null,
    set_id: c.set_id || null,
  };
});

const bosses = Object.values(BOSSES).map(b => ({
  id: b.id, name: b.name, rank: b.rank, cadence: b.cadence || null,
  archetype: b.archetype || null, statDomain: b.statDomain || null,
  coopOnly: !!b.coopOnly, dropTable: b.dropTable || null,
}));

const out = { items, bosses, rates: RATES };
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log('extracted ' + items.length + ' items across ' + bosses.length + ' bosses');
const byRar = {};
items.forEach(i => { byRar[i.rarity] = (byRar[i.rarity]||0)+1; });
console.log('by rarity:', JSON.stringify(byRar));
