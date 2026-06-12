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


---

# FLAGGED RESOLUTION — live session with Richie (2026-06-12)

Method: temporary probe layer (counters at 8 suspect entry points + orphan-node
visibility watcher), Richie driving — full sweep, offline cycle, organic rank-up,
unrated rematch, rated win, rated forfeit loss (his reviewer additions). Probes
stripped at session end (zero residue, runtime-verified). Every removal: explicit
per-item verdict, atomic commit, full gate (selfTest 37/37 + 3 fight hashes +
boot + spot-renders + brace-depth, added mid-session).

| Item | Runtime evidence | Verdict | Action | Commit |
|---|---|---|---|---|
| 1a _enqueueVerifiedEvents | 0 firings everywhere incl. rated win/loss; backend documents producer removed (w160) | CUT | removed (~1 KB) | e142b56 |
| 1b drain (reader) | fires at boot (legacy flush working) | KEEP (pre-decided) | dated deprecation comment; remove ≥ v2.2.7 | 57ce7ec |
| 2 logger twins | PRS alive on 3 surfaces; PAE alive via W258 E2E (sole title-broadcast route); plain fights broadcast nothing BY DESIGN | KEEP BOTH | documented intentional; de-flagged | 3e8954d |
| 3 W229 count==2 | _arGlyph + _ARENA_EFF_PEN: live 2nd refs → ACTIVE. Resolver chain (5 fns + 2 consts): export-only, 0 firings | CUT cluster | removed (~5 KB) + Arena.resolve/.fight keys | 8354bc4 |
| 4a achievements-grid | never visible; no tab targets the panel | CUT (dead memory) | node+panel removed | 22fcab1 |
| 4b XP·30D sheet | opener never wired (card repurposed to Kill Log) | CUT (dead memory) | nodes + ~10 KB JS + CSS family | 22fcab1/c1ce16e |
| 4c Origin sheet | opener orphaned; LIVE arena-button opener found hiding inside setupOriginStorySheet under a stale comment — preserved, gate-proven | CUT (dead memory) | nodes + JS + 16-class CSS family; origin DATA untouched | babcc3b/c1ce16e |
| 4d burned banner | W261-retired mechanic | CUT | node + JS + CSS | babcc3b/c1ce16e |
| 5 mockups | product verdicts | 4 PLANNED → STAGED_FEATURES.md; Duels pair ABANDONED | preview-social + duels-polish removed; morning-briefing now tracked | 5979a72 |

**Session bytes:** app.js −20.6 KB · styles.css −47.4 KB · index.html −7.4 KB
(≈ −75 KB on top of the unsupervised pass's −139 KB).

**Incident (caught + fixed in-session):** the inline origin-CSS cutter left
styles.css at brace depth 3 (committed in babcc3b) — three cuts swallowed @media
closing braces. Style probes missed it; a brace-balance audit caught it. Full redo
from last-good styles.css via the proven parser (c1ce16e); depth-0 now a standing
gate check. Lesson recorded: never hand-roll a second CSS parser mid-session.

**Deferred / future pass:** orphan @keyframes (~1-2 KB; cut_keyframes.js usage-scan
has a slicing bug — DO NOT TRUST until rewritten) · 12 unattributed dead CSS classes
(ar-total/prog-total suffix-caution, habit-sched-pills codex-adjacent, xp-particle--1..4,
lib-pack-*, nb-icon, hk-preprompt-secondary, is-first-unlock) · setupOriginStorySheet
+ setupXpDetail rename candidates (stale names, live contents).

# UX FINDINGS (observations only — no verdicts, no code changes)

1. **Hunter Report share-card preview misrenders at desktop viewport widths**
   (canvas card cropped both edges, medallion overlapping wordmark). Verified
   byte-identical on main — PRE-EXISTING, not a cleanup regression. Mobile-designed
   canvas (1200×1500) + hr-preview-frame sizing assume iPhone aspect. Trigger
   confirmed working as designed (rank-up → fa_rankup → share offer, once per rank).
2. **Offline habit completion:** the designed offline→online trigger was part of
   Richie's Phase A but his observation template came back unfilled and the
   offline step was never explicitly confirmed; later screenshots suggest
   completions seal instantly with no pending-sync indication anywhere. UNCONFIRMED
   — re-run deliberately if offline UX matters.
3. **Build-stale confusion:** Richie attempted the device smoke before anything had
   been pushed/built — GitHub was 4 builds behind the desktop. Process note: say
   explicitly when work has NOT shipped.

# Merge state (end of live session)

cleanup/dead-code-pass = unsupervised pass + probe layer + 9 verdict commits +
probe strip. Step-0 smoke: NOT YET RUN at session start; Richie is building
smoke/cleanup-w263 (0d66b36, pre-verdicts) for the device smoke. After that smoke
passes: merge cleanup/dead-code-pass (which now extends past the smoke ref by the
gated verdict commits) into main. If the web/Netlify target ever deploys this,
bump sw.js CACHE_VERSION at deploy time.
