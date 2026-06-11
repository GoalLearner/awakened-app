#!/usr/bin/env node
// W244 — dev-time audio processing (ffmpeg-static; NOT a runtime dependency).
// Turns full-length Suno generations into gapless battle loops:
//   1. scan momentary loudness (ebur128) to find a steady-energy window
//      (skips intro buildup / outro decay),
//   2. cut body [S, S+L] + tail [S+L, S+L+X],
//   3. crossfade the tail INTO the body head (so a plain buffer loop is
//      seamless: end → start plays the music's true continuation),
//   4. encode AAC/m4a 128k to assets/audio/.
// Usage: node scripts/process-battle-audio.js <input.mp3> <outname> [bodySeconds]
'use strict';
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const FF = require('ffmpeg-static');

const input = process.argv[2];
const outName = process.argv[3];
const L = parseFloat(process.argv[4] || '48');   // loop body seconds
const X = 1.0;                                    // crossfade seconds
if (!input || !outName) { console.error('usage: node process-battle-audio.js <in> <outname> [len]'); process.exit(1); }

function run(args) { return execFileSync(FF, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
function runErr(args) { const r = spawnSync(FF, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); return (r.stderr || '') + (r.stdout || ''); }

// ── 1. momentary loudness every ~100ms via ebur128 ──
const scan = runErr(['-hide_banner', '-nostats', '-i', input, '-af', 'ebur128=peak=none', '-f', 'null', '-']);
const pts = [];
scan.split('\n').forEach((ln) => {
  const m = ln.match(/t:\s*([\d.]+)\s+.*M:\s*(-?[\d.]+)/);
  if (m) pts.push({ t: parseFloat(m[1]), M: parseFloat(m[2]) });
});
if (!pts.length) { console.error('ebur128 scan produced no points'); process.exit(1); }
const dur = pts[pts.length - 1].t;
console.log(`${path.basename(input)}: duration ~${dur.toFixed(1)}s, ${pts.length} loudness points`);

// ── pick the steadiest L-second window: minimize loudness variance, exclude
//    the first 12s (intro) and last 10s (outro), prefer louder (energy) ──
let best = null;
for (let S = 12; S + L + X <= dur - 10; S += 1) {
  const w = pts.filter(p => p.t >= S && p.t < S + L && isFinite(p.M) && p.M > -70);
  if (w.length < L * 5) continue;
  const mean = w.reduce((a, p) => a + p.M, 0) / w.length;
  const varc = w.reduce((a, p) => a + (p.M - mean) * (p.M - mean), 0) / w.length;
  const score = varc - mean * 0.15;                // steady first, loud second
  if (!best || score < best.score) best = { S, score, mean: mean.toFixed(1), sd: Math.sqrt(varc).toFixed(2) };
}
if (!best) { console.error('no viable window'); process.exit(1); }
console.log(`  chosen window: ${best.S}s → ${best.S + L}s  (mean ${best.mean} LUFS, sd ${best.sd})`);

// ── 2+3. cut + head-crossfade + concat + encode ──
const outDir = path.join(__dirname, '..', 'assets', 'audio');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, outName + '.m4a');
const S = best.S;
const fc =
  `[0:a]atrim=${S + L}:${S + L + X},asetpts=PTS-STARTPTS,afade=t=out:st=0:d=${X}[tail];` +
  `[0:a]atrim=${S}:${S + X},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${X}[head];` +
  `[tail][head]amix=inputs=2:normalize=0[xf];` +
  `[0:a]atrim=${S + X}:${S + L},asetpts=PTS-STARTPTS[rest];` +
  `[xf][rest]concat=n=2:v=0:a=1,alimiter=limit=0.95[out]`;
run(['-hide_banner', '-y', '-i', input, '-filter_complex', fc, '-map', '[out]', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out]);
const sz = fs.statSync(out).size;
console.log(`  wrote ${out}  (${(sz / 1024 / 1024).toFixed(2)} MB, ${L}s loop, ${X}s seam crossfade)`);
if (sz > 1.5 * 1024 * 1024) console.warn('  WARN: exceeds 1.5MB target');
