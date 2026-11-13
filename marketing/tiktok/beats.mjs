// beats.mjs — map a track's energy, onsets, tempo and drop so a video can cut to it.
//   node marketing/tiktok/beats.mjs "<track.wav>"  -> prints a summary and writes <track>.beats.json beside this script
// Decodes to mono 22.05 kHz PCM with ffmpeg, then: RMS per 10 ms frame, an onset envelope (positive energy flux),
// tempo by autocorrelation of that envelope (90-180 bpm), the beat grid phase that best fits the onsets, and the
// drop = the biggest rise of 1-second loudness in the first 20 s.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const file = process.argv[2];
if (!file) { console.error('usage: node beats.mjs <audio>'); process.exit(1); }
const SR = 22050;
const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 's16le', '-'], { maxBuffer: 1 << 30 });
if (r.status !== 0) { console.error(String(r.stderr)); process.exit(1); }
const pcm = new Int16Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length / 2);
const HOP = Math.round(SR * 0.01);                 // 10 ms frames
const n = Math.floor(pcm.length / HOP);
const rms = new Float64Array(n);
for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < HOP; k++) { const v = pcm[i * HOP + k] / 32768; s += v * v; } rms[i] = Math.sqrt(s / HOP); }
// onset envelope: half-wave rectified log-energy difference, lightly smoothed
const loge = Array.from(rms, (v) => Math.log(1e-6 + v));
const on = new Float64Array(n);
for (let i = 1; i < n; i++) on[i] = Math.max(0, loge[i] - loge[i - 1]);
const sm = new Float64Array(n);
for (let i = 0; i < n; i++) { let s = 0, c = 0; for (let k = -2; k <= 2; k++) if (i + k >= 0 && i + k < n) { s += on[i + k]; c++; } sm[i] = s / c; }
// tempo: autocorrelation over lags for 90-180 bpm
let best = { bpm: 0, score: -1, lag: 0 };
for (let lag = Math.round(6000 / 180); lag <= Math.round(6000 / 90); lag++) {
  let s = 0; for (let i = 0; i + lag < n; i++) s += sm[i] * sm[i + lag];
  if (s > best.score) best = { bpm: 6000 / lag, score: s, lag };
}
// refine to 0.1 bpm with fractional lags
let fine = best;
for (let bpm = best.bpm - 4; bpm <= best.bpm + 4; bpm += 0.1) {
  const lag = 6000 / bpm; let s = 0;
  for (let i = 0; i + lag + 1 < n; i++) { const j = i + lag, j0 = Math.floor(j), f = j - j0; s += sm[i] * (sm[j0] * (1 - f) + sm[j0 + 1] * f); }
  if (s > fine.score) fine = { bpm, score: s, lag };
}
const period = 6000 / fine.bpm;                  // frames per beat
// phase: the offset whose grid collects the most onset energy
let phase = { off: 0, s: -1 };
for (let off = 0; off < period; off += 0.5) {
  let s = 0; for (let t = off; t < n; t += period) { const i = Math.round(t); if (i < n) s += sm[i]; }
  if (s > phase.s) phase = { off, s };
}
const beats = []; for (let t = phase.off; t < n; t += period) beats.push(+(t / 100).toFixed(3));
// loudness per second and the drop
const sec = []; for (let s = 0; s * 100 < n; s++) { let a = 0, c = 0; for (let i = s * 100; i < Math.min(n, s * 100 + 100); i++) { a += rms[i]; c++; } sec.push(+(a / c).toFixed(4)); }
let drop = { t: 0, rise: -1 };
for (let i = 50; i < Math.min(n, 2000); i += 5) {
  let a = 0, b = 0; for (let k = 0; k < 100; k++) { a += rms[Math.max(0, i - 100 + k)]; b += rms[Math.min(n - 1, i + k)]; }
  const rise = b / 100 - a / 100; if (rise > drop.rise) drop = { t: i / 100, rise };
}
// snap the drop to the nearest beat
const dropBeat = beats.reduce((p, b) => (Math.abs(b - drop.t) < Math.abs(p - drop.t) ? b : p), beats[0]);
const out = { file: basename(file), duration: +(pcm.length / SR).toFixed(3), bpm: +fine.bpm.toFixed(2), beat: +(period / 100).toFixed(4), firstBeat: beats[0], drop: drop.t, dropBeat, loudness: sec, beats };
const OUT = join(HERE, basename(file).replace(/\.[^.]+$/, '') + '.beats.json');
writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ duration: out.duration, bpm: out.bpm, beat: out.beat, firstBeat: out.firstBeat, drop: out.drop, dropBeat, loudness0to30: sec.slice(0, 30) }));
console.log('wrote', OUT);
