// Reusable per-boss art processor (W287+). Boss/item art are framed full-bleed
// paintings on dark backgrounds (NOT cutouts) — so NO background removal. Boss
// portraits keep their aspect (resized to fit the 1254 house box); item icons
// are resized + padded to a square via edge-copy (seamless on the dark bg).
// Heavy originals archived to gitignored art-originals/.
// Edit the JOBS list per boss, then: node scripts/process-boss-art.js
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// W447 — drop these 12 Midjourney PNGs in the repo ROOT (src names below), then run
// `node scripts/process-boss-art.js`. Each is resized to the 1254 house box (bosses keep
// aspect; items square-padded by edge-copy), PNG-compressed, written to dst, and the heavy
// original archived to art-originals/. MISSING files are skipped, so partial drops are fine.
// Prompts: SPRINT-W447-COOP-ART.md.
const JOBS = [
  { src: 'the-gaunt-wardens.png',          dst: 'assets/bosses/the-gaunt-wardens.png',          kind: 'boss' },
  { src: 'the-gaunt-wardens-summons.png',  dst: 'assets/bosses/the-gaunt-wardens-summons.png',  kind: 'boss' },
  { src: 'the-sundered-choir.png',         dst: 'assets/bosses/the-sundered-choir.png',         kind: 'boss' },
  { src: 'the-sundered-choir-summons.png', dst: 'assets/bosses/the-sundered-choir-summons.png', kind: 'boss' },
  { src: 'the_wardens_vigil.png',          dst: 'assets/items/the_wardens_vigil.png',           kind: 'item' },
  { src: 'the_stairwalkers_treads.png',    dst: 'assets/items/the_stairwalkers_treads.png',     kind: 'item' },
  { src: 'the_famished_circlet.png',       dst: 'assets/items/the_famished_circlet.png',        kind: 'item' },
  { src: 'the_gaunt_mantle.png',           dst: 'assets/items/the_gaunt_mantle.png',            kind: 'item' },
  { src: 'the_choirmasters_vestment.png',  dst: 'assets/items/the_choirmasters_vestment.png',   kind: 'item' },
  { src: 'the_discordant_crown.png',       dst: 'assets/items/the_discordant_crown.png',        kind: 'item' },
  { src: 'the_sundered_grips.png',         dst: 'assets/items/the_sundered_grips.png',          kind: 'item' },
  { src: 'the_antiphon_striders.png',      dst: 'assets/items/the_antiphon_striders.png',       kind: 'item' },
  // W678 — The Threefold Court (C trio) + its 3-piece pool. Prompts in the W678 notes.
  { src: 'the-threefold-court.png',         dst: 'assets/bosses/the-threefold-court.png',         kind: 'boss' },
  { src: 'the-threefold-court-summons.png', dst: 'assets/bosses/the-threefold-court-summons.png', kind: 'boss' },
  { src: 'vestments_of_the_final_verdict.png', dst: 'assets/items/vestments_of_the_final_verdict.png', kind: 'item' },
  { src: 'courthunters_grips.png',          dst: 'assets/items/courthunters_grips.png',          kind: 'item' },
  { src: 'seal_of_the_threefold_court.png', dst: 'assets/items/seal_of_the_threefold_court.png', kind: 'item' },
  // W682 — The Unresting March (D 48h duo) + its 3-piece ranger pool.
  { src: 'the-unresting-march.png',         dst: 'assets/bosses/the-unresting-march.png',         kind: 'boss' },
  { src: 'the-unresting-march-summons.png', dst: 'assets/bosses/the-unresting-march-summons.png', kind: 'boss' },
  { src: 'roadwardens_harness.png',         dst: 'assets/items/roadwardens_harness.png',          kind: 'item' },
  { src: 'milestone_cowl.png',              dst: 'assets/items/milestone_cowl.png',               kind: 'item' },
  { src: 'longroad_grips.png',              dst: 'assets/items/longroad_grips.png',               kind: 'item' },
  // W686 — The Sleepless Crown (S-rank 72h steps+sleep raid) + its 8-piece pool.
  // (renamed W687 — the raid is now The Myrmidon King; artId the_myrmidon_king)
  { src: 'the-myrmidon-king.png',            dst: 'assets/bosses/the-myrmidon-king.png',            kind: 'boss' },
  { src: 'the-myrmidon-king-summons.png',    dst: 'assets/bosses/the-myrmidon-king-summons.png',    kind: 'boss' },
  { src: 'reverie_staff.png',                dst: 'assets/items/reverie_staff.png',                 kind: 'item' },
  { src: 'vigil_bow.png',                    dst: 'assets/items/vigil_bow.png',                     kind: 'item' },
  { src: 'watchkeepers_carapace.png',        dst: 'assets/items/watchkeepers_carapace.png',         kind: 'item' },
  { src: 'grips_of_the_third_night.png',     dst: 'assets/items/grips_of_the_third_night.png',      kind: 'item' },
  { src: 'striders_of_the_waking_march.png', dst: 'assets/items/striders_of_the_waking_march.png',  kind: 'item' },
  { src: 'circlet_of_lucid_sleep.png',       dst: 'assets/items/circlet_of_lucid_sleep.png',        kind: 'item' },
  { src: 'shroud_of_the_dreaming_court.png', dst: 'assets/items/shroud_of_the_dreaming_court.png',  kind: 'item' },
  { src: 'pendant_of_the_seventh_hour.png',  dst: 'assets/items/pendant_of_the_seventh_hour.png',   kind: 'item' },
];

fs.mkdirSync('art-originals', { recursive: true });

(async () => {
  for (const j of JOBS) {
    if (!fs.existsSync(j.src)) { console.log('MISSING', j.src); continue; }
    const before = Math.round(fs.statSync(j.src).size / 1024);
    let pipe = sharp(fs.readFileSync(j.src))
      .resize({ width: 1254, height: 1254, fit: 'inside', withoutEnlargement: true });
    if (j.kind === 'item') {
      const m = await sharp(fs.readFileSync(j.src))
        .resize({ width: 1254, height: 1254, fit: 'inside', withoutEnlargement: true })
        .toBuffer().then(b => sharp(b).metadata());
      const side = Math.max(m.width, m.height);
      const padL = Math.floor((side - m.width) / 2), padT = Math.floor((side - m.height) / 2);
      pipe = pipe.extend({ top: padT, bottom: side - m.height - padT, left: padL, right: side - m.width - padL, extendWith: 'copy' });
    }
    await pipe.png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(j.dst);
    const out = await sharp(j.dst).metadata();
    const after = Math.round(fs.statSync(j.dst).size / 1024);
    console.log('OK', j.dst, out.width + 'x' + out.height, before + 'KB -> ' + after + 'KB');
    fs.renameSync(j.src, path.join('art-originals', path.basename(j.src)));
  }
  console.log('done');
})();
