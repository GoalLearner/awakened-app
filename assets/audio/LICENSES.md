# assets/audio — music licenses

Every track that ships in this folder MUST have an entry here (repo policy: no track
without a license line). SFX are 100% procedural Web Audio — zero files, nothing to license.

| Slot file | Status | License line |
|---|---|---|
| `battle_loop.m4a` | SHIPPING (48s gapless loop, 0.75MB) | battle_loop — Suno (paid plan) generation, commercial license, 2026-06-11 |
| `boss_loop.m4a` | SHIPPING (48s gapless loop, 0.76MB) | boss_loop — Suno (paid plan) generation, commercial license, 2026-06-11 |
| `victory_sting.m4a` | ABSENT (drop-in) | <!-- victory_sting — Suno (paid plan) generation, commercial license, YYYY-MM-DD --> |
| `defeat_sting.m4a` | ABSENT (drop-in) | <!-- defeat_sting — Suno (paid plan) generation, commercial license, YYYY-MM-DD --> |

Source + processing:
- Originals (full-length Suno generations) are archived locally in `audio-originals/`
  (gitignored — same convention as `avatar-originals-rgb/`). Do not delete.
- Processing: `scripts/process-battle-audio.js` (dev-time ffmpeg-static; NOT a runtime
  dependency) — picks the steadiest-loudness 48s window (ebur128 scan, skips intro/outro),
  crossfades the natural tail into the head over 1s so a plain Web Audio buffer loop is
  gapless, encodes AAC/m4a 128k.
- battle_loop: source 199.9s → window 72–120s (sd 0.52 LUFS).
- boss_loop: source 144.1s → window 66–114s (sd 0.82 LUFS).
- After adding a sting: trim (victory 3–6s, defeat 2–4s), encode the same way, fill the
  row above, add the path to `sw.js` PRECACHE_ASSETS.
