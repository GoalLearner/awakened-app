# assets/audio — music + SFX licenses

Every file that ships in this folder MUST have an entry here (repo policy: no file
without a license line). Cues without a generated file fall back to procedural Web
Audio synthesis (nothing to license).

## Music

| Slot file | Status | License line |
|---|---|---|
| `battle_loop.m4a` (+`.mp3` twin) | SHIPPING (48s gapless loop, 0.75MB) | battle_loop — Suno (paid plan) generation, commercial license, 2026-06-11 |
| `boss_loop.m4a` (+`.mp3` twin) | SHIPPING (48s gapless loop, 0.76MB) | boss_loop — Suno (paid plan) generation, commercial license, 2026-06-11 |
| `arena_menu.m4a` (+`.mp3` twin) | SHIPPING (60s gapless lofi loop, 0.94MB) | arena_menu — Suno (paid plan) generation, commercial license, 2026-06-11 |
| `victory_sting.m4a` (+`.mp3` twin) | SHIPPING (6s sting, candidate A; B archived) | victory_sting — Suno (paid plan) generation, commercial license, 2026-06-11 |
| `defeat_sting.m4a` (+`.mp3` twin) | SHIPPING (4s sting, cut at the bell ~4.3–8.3s) | defeat_sting — Suno (paid plan) generation, commercial license, 2026-06-11 |

## Battle SFX (file-preferred; synth fallback when absent)

| Slot file | Status | License line |
|---|---|---|
| `sfx_lunge.m4a` (+`.mp3`) | SHIPPING | sfx_lunge — Suno (paid plan) generation, commercial license, 2026-06-11 |
| `sfx_hit_normal.m4a` (+`.mp3`) | SHIPPING | sfx_hit_normal — Suno (paid plan) generation, commercial license, 2026-06-11 |
| `sfx_hit_crit.m4a` (+`.mp3`) | SHIPPING | sfx_hit_crit — Suno (paid plan) generation, commercial license, 2026-06-11 |
| `sfx_miss_dodge.m4a` (+`.mp3`) | SHIPPING | sfx_miss_dodge — Suno (paid plan) generation, commercial license, 2026-06-11 |
| `sfx_hp_drain.m4a` (+`.mp3`) | SHIPPING | sfx_hp_drain — Suno (paid plan) generation, commercial license, 2026-06-11 |
| `sfx_ko.m4a` (+`.mp3`) | SHIPPING | sfx_ko — Suno (paid plan) generation, commercial license, 2026-06-11 |
| `sfx_boss_intro.m4a` (+`.mp3`) | SHIPPING | sfx_boss_intro — Suno (paid plan) generation, commercial license, 2026-06-11 |
| `sfx_rank_up.m4a` (+`.mp3`) | SHIPPING (main screen) | sfx_rank_up — Suno (paid plan) generation, commercial license, 2026-06-11 |
| `sfx_achievement.m4a` (+`.mp3`) | SHIPPING (main screen) | sfx_achievement — Suno (paid plan) generation, commercial license, 2026-06-11 |
| `sfx_stat_up.m4a` (+`.mp3`) | SHIPPING (main screen) | sfx_stat_up — Suno (paid plan) generation, commercial license, 2026-06-11 |
| `sfx_rare_drop.m4a` (+`.mp3`) | SHIPPING (main screen) | sfx_rare_drop — Suno (paid plan) generation, commercial license, 2026-06-11 |
| `sfx_perfect_day.m4a` (+`.mp3`) | SHIPPING (main screen; candidate B — "Glorious" take — chosen by loudness consistency, A archived) | sfx_perfect_day — Suno (paid plan) generation, commercial license, 2026-06-11 |
| `sfx_hall_greeting.m4a` (+`.mp3`) | SHIPPING (once-daily first-tap greeting) | sfx_hall_greeting — Suno (paid plan) generation, commercial license, 2026-06-11 |
| `sfx_habit_check` | ABSENT (drop-in slot wired in playCheckSound) | <!-- sfx_habit_check — Suno (paid plan) generation, commercial license, YYYY-MM-DD --> |

Cues still procedural (no file yet): ui_tap, ui_denied, text_blip, super_effective,
not_effective, heal, status_burn, status_stun, status_buff, cauterize, dot_tick.
Drop `sfx_<cue>.m4a`(+`.mp3`) here, add to `_AUD.slots` + `_AUD_FILE_CUES` in app.js,
the verify gate list, and sw.js PRECACHE_ASSETS — then add the license row.

Source + processing:
- Originals (full-length Suno generations) are archived locally in `audio-originals/`
  (gitignored — same convention as `avatar-originals-rgb/`). Do not delete.
  `victory_sting_b` (the runner-up candidate) is archived there too — swap by re-running
  the trim and copying over `victory_sting.m4a`/`.mp3`.
- Loops: `scripts/process-battle-audio.js` — steadiest-loudness window (ebur128 scan),
  1s tail→head crossfade for gapless buffer looping, AAC/m4a 128k.
  - battle_loop: 199.9s source → 72–120s. boss_loop: 144.1s → 66–114s.
  - arena_menu: 199.8s source → 72–132s (60s body — menu ambience breathes slower).
- One-shots: `scripts/process-sting-audio.js` — loudness-onset (or manual start) cut,
  leading-silence strip, tail fade, limiter, AAC/m4a 128k.
  - victory: candidate A chosen over B (louder peak −10.5 vs −12.2 LUFS; ends in true
    silence inside 6s). defeat: manual cut 4.3s (the bell) after auto-onset sliced mid-phrase.
- `.mp3` twins are decode-fallbacks for iOS WKWebView (W246 chain); transcoded from the m4a.
