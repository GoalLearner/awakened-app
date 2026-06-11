# assets/audio — music licenses

Every track that ships in this folder MUST have an entry here (repo policy: no track
without a license line). SFX are 100% procedural Web Audio — zero files, nothing to license.

The AudioDirector loads these four slots; any absent file ships silent and logs once:

| Slot file | Status | Title / Artist | Source | License |
|---|---|---|---|---|
| `battle_loop.m4a` | ABSENT (drop-in) | — | — | — |
| `boss_loop.m4a` | ABSENT (drop-in) | — | — | — |
| `victory_sting.m4a` | ABSENT (drop-in) | — | — | — |
| `defeat_sting.m4a` | ABSENT (drop-in) | — | — | — |

Drop-in notes:
- Format: AAC `.m4a` (best iOS decode path), loops must be cut gapless (the player uses
  buffer loop points, not <audio>).
- Budget: all four files together ≤ ~5 MB.
- After adding a file: fill its row above, and add the path to `sw.js` PRECACHE_ASSETS
  so it's available offline.
