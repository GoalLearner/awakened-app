#!/usr/bin/env node
// W248 — dev-time one-shot audio processing (ffmpeg-static; NOT a runtime dep).
// Turns generated clips into tight battle stings / SFX:
//   1. scan momentary loudness (ebur128) to find the onset of the strongest
//      moment, 2. cut [onset − pad, onset + maxLen], 3. trim leading silence,
//      fade the tail, limit, 4. encode AAC/m4a to assets/audio/.
// Usage: node scripts/process-sting-audio.js <input.mp3> <outname> <maxSeconds> [fadeSeconds]
// Prints onset/peak/residual metrics (used to A/B sting candidates).
'use strict';
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const FF = require('ffmpeg-static');

const input = process.argv[2];
const outName = process.argv[3];
const MAXL = parseFloat(process.argv[4] || '5');
const FADE = parseFloat(process.argv[5] || (MAXL > 2 ? '0.45' : '0.08'));
const STARTAT = process.argv[6] != null ? parseFloat(process.argv[6]) : null;   // manual cut start (overrides onset detection)
if (!input || !outName) { console.error('usage: process-sting-audio.js <in> <outname> <maxSec> [fadeSec]'); process.exit(1); }

function run(args) { return execFileSync(FF, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
function runErr(args) { const r = spawnSync(FF, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); return (r.stderr || '') + (r.stdout || ''); }

// ── 1. loudness scan ──
const scan = runErr(['-hide_banner', '-nostats', '-i', input, '-af', 'ebur128=peak=none', '-f', 'null', '-']);
const pts = [];
scan.split('\n').forEach((ln) => {
  const m = ln.match(/t:\s*([\d.]+)\s+.*M:\s*(-?[\d.]+)/);
  if (m) pts.push({ t: parseFloat(m[1]), M: parseFloat(m[2]) });
});
if (!pts.length) { console.error('no loudness points'); process.exit(1); }
const dur = pts[pts.length - 1].t;
const valid = pts.filter(p => isFinite(p.M) && p.M > -70);
const peak = valid.reduce((a, p) => (p.M > a.M ? p : a), valid[0]);
// onset = first point within 12 LU of peak (the strong moment begins)
const onset = valid.find(p => p.M >= peak.M - 12) || valid[0];
const S = (STARTAT != null) ? STARTAT : Math.max(0, onset.t - 0.42);   // ebur128 M-window lag ≈ 400ms + small pad
const cutEnd = Math.min(dur, S + MAXL);
// residual loudness at the cut point (lower = cleaner natural ending)
const atCut = valid.filter(p => p.t >= cutEnd - 0.3 && p.t <= cutEnd + 0.3);
const residual = atCut.length ? atCut.reduce((a, p) => a + p.M, 0) / atCut.length : -70;
console.log(`${path.basename(input)}: dur ${dur.toFixed(1)}s · peak ${peak.M.toFixed(1)} LUFS @ ${peak.t.toFixed(2)}s · onset @ ${onset.t.toFixed(2)}s`);
console.log(`  cut [${S.toFixed(2)}s → ${cutEnd.toFixed(2)}s] · residual at cut ${residual.toFixed(1)} LUFS (lower = cleaner ending)`);

// ── 2–4. cut, de-silence the head, fade tail, limit, encode ──
const outDir = path.join(__dirname, '..', 'assets', 'audio');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, outName + '.m4a');
const fadeStart = Math.max(0, (cutEnd - S) - FADE);
const af =
  `atrim=${S}:${cutEnd},asetpts=PTS-STARTPTS,` +
  `silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.05,` +
  `afade=t=out:st=${fadeStart}:d=${FADE},alimiter=limit=0.95`;
run(['-hide_banner', '-y', '-i', input, '-vn', '-af', af, '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out]);   // -vn: Suno mp3s embed cover art as a video stream — audio only
const sz = fs.statSync(out).size;
console.log(`  wrote ${out} (${(sz / 1024).toFixed(0)} KB)`);
console.log(JSON.stringify({ file: outName, peakLUFS: +peak.M.toFixed(1), onset: +onset.t.toFixed(2), residual: +residual.toFixed(1), kb: Math.round(sz / 1024) }));
