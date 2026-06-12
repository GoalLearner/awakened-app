# CLEANUP_REPORT — dead-code pass (branch `cleanup/dead-code-pass`)

**Decision: branch left UNMERGED. Recommended: merge after a ~10-minute on-device
visual smoke (list below).** Reasoning at the bottom — read "FLAGGED-BUT-KEPT" and
"The near-miss" first.

## Bytes

| file | before | after | Δ | % |
|---|---|---|---|---|
| app.js | 2,213,419 | 2,170,405 | **−43,014** | −1.94% |
| styles.css | 1,014,899 | 918,959 | **−95,940** | −9.45% |
| index.html | 202,370 | 202,370 | 0 | — |
| sw.js | 17,500 | 17,500 | 0 | — |
| **parse weight (js+css)** | **3,228,318** | **3,089,364** | **−138,954** | **−4.30%** |
| assets/ (repo only) | 198.1 MB | 192.7 MB | −5.4 MB archived | bundle Δ = 0 |

## Commit map (each individually revertible)
- `560a17c` Phase 0/1 — fingerprints + plan (CLEANUP_PLAN.md)
- `8eaaef5` **T2a** — 30 dead functions/consts (~24.6 KB)
- `f2ac8bd` **T2b** — 640 never-matching CSS rules + 9 orphan @keyframes (~131 KB raw,
  −95.9 KB net of line-ending normalization)
- `2262635` **T3a** — W229 round engine + W215/216 reveal system, cascaded to fixpoint
  (~19.5 KB, 28 items)
- `8fecae3` **T3b** — 10 orphan design-source assets → `assets-archive/` (5.4 MB repo,
  zero bundle impact — `prep-local-build.sh` copies by explicit whitelist; verified)

## Gate results (identical criteria every tier)
selfTest **37/37** · 3 seeded-fight logs hash-identical to the Phase-0 fingerprint
(real F47 seed 123456; synthetic even fights 424242/31337) · boot zero errors, expected
diagnostics present (`hk-verify-debug` walk/sleep/strength, `[Leaderboard] submit
skipped`) · screen spot-renders (habits/quests/boss cards/boss detail/tower/social) ·
T2b extra: computed-style probes (bcard 6px, ar-cta 700, pkb-plate 13px) · T3a extra:
LIVE battle mounts (pkb-stage + move grid) · T3b extra: 40 on-screen images, zero broken.
**Every gate green at every tier. No gate failure occurred at any point.**

## Tier 1 — empty by analysis (deliberate)
- No commented-out code found: 91 detector hits inspected, all prose documentation.
- Console logs untouched: the diagnostics exception covers the corpus.
- Duplicate consolidation declined: `_prsLogBreadcrumb` ≡ `_paeLog` are byte-identical
  but subsystem-local with live call sites each; consolidating crosses two cleanly
  separated modules for ~150 B. KEPT BOTH.

## Removed (one-line evidence each)
**T2a JS (30)** — every item occurs exactly once repo-wide (tokenize-count over 49 code
files + independent grep + adversarial agent pass, 500 verdicts):
boss UI: `_bossHuntActive` `_bossesSlainRowHtml` `_statusPillIcon` `_buildHuntingPills` ·
cards: `getEquippedCardId` `unequipCard` `countEquippedSlots` ·
pack shims (comments said "backward-compat wrappers"; zero callers remained):
`getMorningPack` `getMorningHabitDefs` `getHabitCompoundPackIds`
`userHasAllCanonicalMorning` `MORNING_HABIT_INDICES` ·
UI orphans: `showDayPopup` `renderAchievements` `showReminderConfirmToast`
`stopQuoteRotation` `openXpDetail` `refreshEquipmentModalIfOpenNew`
`_formatBuildBonusValue` `bindLongPress` `openOriginStorySheet` `buildPRStripHTML`
`buildCompoundBadgesHTML` ·
misc: `GUILDHALL_ACTIVITY_DISPLAY_LIMIT` `_ASC_ARCH_ROTATION` `getClosestStatToAwaken`
`_originWeekdayNoun` `HG_DCOL` `_socialDisplayAlias` `LB_100K_CLUB_METRICS`.

**T2b CSS (640 rules / 391 classes / 9 keyframes)** — class token absent (not even as a
substring) from index.html + app.js + sw.js + all 7 preview-*.html; 66 concatenation
prefixes protected; removal unit = whole rule blocks where every comma-selector contains
≥1 dead class. Clusters: old `.ar-*` combat/move-selector/loadout screens, `.account-*`,
`.add-form*`, `.mc-*`, `.dmc-*`, `.bro-*` families. Keyframes: dmc/mc/bro/am families
(names survive nowhere).

**T3a JS (28, cascaded to fixpoint)** — the W229 interactive-round engine and the
W215/216 timer-reveal system it drove: `arenaStartSession` `arenaResolveRound`
`arenaFinalizeSession` `ARENA_MOVES` `_ARENA_MOVE_LABEL/META/BEATS`
`_ARENA_READ_WIN/LOSE` `_ARENA_ALLIN_HIT/PUNISH` `_ARENA_BOT_BIAS` `_arenaBotMove`
`_arenaReadMult` `_arPlayReveal` `_arPlayFlawless` `_arRenderFight` `_arRenderFlawless`
`_arShowKoContinue` `_arHitSound` `_arHitJuice` + T2a cascade `_killLogShieldSvg`
`ACH_CATEGORIES` `_buildAchCard` `_shortDate` `_formatUnlockDate` `_formatProgressNum`.
The current engine (arenaStartBattle/arenaTakeTurn/arenaFinalizeBattle + pkb screens)
shares nothing with this cluster — proven by the fight-hash gate + live battle mount.

**T3b assets (10 → assets-archive/, not deleted)** — listed in the commit; all outside
the build whitelist; restore = `git mv` back.

## FLAGGED-BUT-KEPT (read this first)
1. `_REF_POWER` (app.js) — sim-mirror documentation anchor (W233 reference power).
   Never-delete list. KEEP.
2. `_enqueueVerifiedEvents` — unreferenced writer for the verified-event outbox; the
   outbox storage key + reader side are live. Storage-adjacent → KEEP. If you confirm
   the outbox enqueue path was fully superseded by `_queuePublicAchievementEvent`,
   this is a future removal candidate.
3. `_prsLogBreadcrumb` ≡ `_paeLog` — intentional-looking subsystem-local duplication.
   KEPT BOTH (Tier-1 note above).
4. `.ar-total`, `.prog-total` CSS — end with the dynamic suffix `'-total'` found in
   `x + '-total'` compositions (probably element IDs, but uncertainty → keep).
5. `_ARENA_MISS_MULT`, `_ARENA_CRIT_MULT`, `_ARENA_EFF_PEN`, `_arGlyph` — count==2
   (one live reference each); ACTIVE per protocol. If their remaining referrers are
   themselves W229-adjacent, a future pass could re-examine — not touched here.
6. 427 count==2 items — definition + 1 reference = ACTIVE, untouched, list in
   `.git/inv_functions.json`.
7. index.html orphan elements (`achievements-grid`, `xp-detail-overlay`, `origin-overlay`
   nodes whose openers were removed) — HTML left intact; harmless inert nodes; a future
   pass with on-device verification could prune them.
8. Five TRACKED preview-*.html mockups reference classes that look "dead" from
   index.html/app.js alone (codex-*, notif-ping-*, settings-rem-*, friend-avatar--*) —
   these read as STAGED FEATURES (designs landed, CSS landed, JS pending). Their CSS
   was excluded from the cut.

## The near-miss (why the merge is left to you)
The first CSS cut (applied to the working tree, NEVER committed) would have removed
live styling: the prefix harvester required exactly one trailing `-`/`_`, so BEM
double-hyphen compositions (`'reveal-overlay--' + rarity` — the ultra-rare item-reveal
glow — plus 19 other live families like `pokedex-card--`, `market-sheet-rarity--`)
were unprotected. The orphan-keyframes signal (`reveal-card-ultra-pulse` going orphan)
exposed it during dry-run audit; the apply was fully reverted, the regex fixed, and two
further composition shapes audited to closure (dynamic suffixes → 2 classes kept;
prefix-in-variable indirection → zero CSS-shaped hits). The re-cut passed every gate
including computed-style probes.

The defect never reached a commit and the final state gates green — but it proves the
CSS classifier had a real hole mid-pass, and the regression it would have caused
(ultra-rare reveal glow) is exactly the kind my headless gate cannot exercise. Under
"WHEN UNCERTAIN, KEEP AND REPORT" applied at the merge level: the branch stays
unmerged for a human eye.

**Suggested 10-minute on-device smoke before merging:**
ultra-rare item reveal (Sigil Bloom glow/pulse) · market/relic sheet rarity tints ·
pokédex card states · build-picker rarity tiles · guild feed icons · one full arena
fight + boss detail + equipment + settings + leaderboards. If those look right,
`git merge cleanup/dead-code-pass` — and if this ever ships via the Netlify web
target, bump `sw.js` CACHE_VERSION at deploy time (not bumped on this branch; no
TestFlight build was made).

## Stop conditions — none tripped
No gate failure (the CSS issue was pre-commit, caught in audit) · no LEGACY-SUSPECT cut
without airtight evidence · no refactors · git state stayed clean (two pre-existing
untracked preview mockups noted) · uncertainty never hit three borderline calls in a
row (the four keeps were rule-applications, not coin flips).
