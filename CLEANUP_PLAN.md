# CLEANUP_PLAN — dead-code pass (branch cleanup/dead-code-pass)

Baseline: HEAD `416d447` · selfTest **37/37** · fight fingerprints
real_123456=439674144 / synth_424242=470825381 / synth_31337=69879316 (turns 5/7/7)
· sizes: app.js 2,213,419 B · styles.css 1,014,899 B · index.html 202,370 B ·
sw.js 17,500 B · assets/ 198,095,957 B (266 files).
Boot diagnostics that must persist: `[hk-verify-debug] walk/sleep/strength-entry`,
`[Leaderboard] submit skipped`. Screen roots: habits_root, tabbar, arena_btn,
settings_ver, boss_overlay_node — all present at baseline.

## Method
- **Functions/consts (1a):** extracted all 1,582 IIFE-level declarations from app.js;
  counted identifier occurrences by raw-text tokenization over 49 code files
  (app.js, index.html, sw.js, capacitor.config.json, scripts/**, backend/src/**,
  preview-*.html). Raw text ⇒ string literals, onclick markup, and dynamic-property
  strings are all counted. DEAD ⇐ exactly 1 occurrence (the definition). Each of the
  39 hits was re-verified with an independent `grep -rho '\b<name>\b'` (all = 1) and
  its definition context read for never-delete classification.
- **CSS (1b):** 3,315 class tokens parsed from styles.css selectors; liveness =
  substring presence in index.html + app.js + sw.js + preview-*.html (substring is
  stricter than word-boundary: a candidate's token appears NOWHERE, not even inside a
  longer name). 46 concatenation prefixes harvested from `'…-' +` fragments protect
  composed names; `class="...${...}"` template interpolation: **0 occurrences** in
  app.js, so the prefix rule is exhaustive. 464 candidates.
- **Assets (1c):** 266 files vs literal `assets/...` strings + expanded dynamic
  patterns (foe_<arch>, boss_<floor>, bg_<tier>, audio slots ×{m4a,mp3}, bosses/<id>,
  dynamic roots assets/{bosses,arena,audio,habit-icons}/ and prefixes
  foe_/boss_/bg_/first-awakened-). 10 unreferenced files (5.4 MB), all design-source
  artifacts. **prep-local-build.sh copies by explicit whitelist** — none of the 10 are
  copied to www/, so they are repo-only weight, NOT app-bundle weight.
- **Stale noise (1d):** 91 candidate comment blocks inspected → all prose
  documentation (false positives). Decisions: comments KEPT (documentation; stripping
  = formatting sweep, out of scope) · console.logs KEPT (the diagnostics exception
  covers the corpus: hk-verify-debug, audioDiag, boss-art warnings, pkb timing) ·
  unreachable-code hunting SKIPPED (no safe mechanical detection).

## Candidates

### Tier 1 — (empty by analysis)
- Duplicate pair `_prsLogBreadcrumb` (app.js:17026) ≡ `_paeLog` (app.js:17172):
  byte-identical wrappers, both live in separate subsystems (public-rank-summary vs
  public-achievement-events). **DECISION: KEEP BOTH** — consolidation crosses two
  deliberately separated modules for ~150 B; reads as refactor, not removal.
  (Judgment call #1 — recorded.)

### Tier 2 — DEAD functions/consts (count==1 repo-wide), clustered
- **Boss UI orphans:** `_bossHuntActive` (905) · `_bossesSlainRowHtml` (4495) ·
  `_statusPillIcon` (24340) · `_buildHuntingPills` (24351)
- **Cards helpers:** `getEquippedCardId` (5678) · `unequipCard` (5709) ·
  `countEquippedSlots` (5734)
- **Pack/morning compat shims (comments say "backward-compat wrappers"; zero callers
  remain):** `getMorningPack` (16441) · `getMorningHabitDefs` (16442) ·
  `getHabitCompoundPackIds` (30954) · `userHasAllCanonicalMorning` (30961) ·
  `MORNING_HABIT_INDICES` (39775)
- **UI orphans:** `showDayPopup` (19715) · `renderAchievements` (20739) ·
  `showReminderConfirmToast` (22219) · `stopQuoteRotation` (23093) ·
  `openXpDetail` (24386) · `refreshEquipmentModalIfOpenNew` (24763, "New"-suffixed
  refactor leftover; non-New sibling is live) · `_formatBuildBonusValue` (24979) ·
  `bindLongPress` (30664) · `openOriginStorySheet` (31116) · `buildPRStripHTML`
  (35401) · `buildCompoundBadgesHTML` (35425)
- **Misc consts/helpers:** `GUILDHALL_ACTIVITY_DISPLAY_LIMIT` (3337) ·
  `_ASC_ARCH_ROTATION` (5859) · `getClosestStatToAwaken` (18113) ·
  `_originWeekdayNoun` (18218) · `HG_DCOL` (18906) · `_socialDisplayAlias` (31786) ·
  `LB_100K_CLUB_METRICS` (32644)
- **Never-matching CSS:** 464 classes (clusters: old `.ar-*` pre-Pokémon combat
  screens / move selector / loadout module, `.account-*`, `.add-form*`, etc.) —
  removal unit = whole rule blocks where EVERY comma-selector contains ≥1 dead class;
  @media-aware parser; orphan @keyframes only when the animation name survives
  nowhere.

### Tier 3 — LEGACY-SUSPECT with airtight evidence (zero occurrences incl. strings)
- **W229-era round engine cluster:** `arenaStartSession` (6263) ·
  `arenaResolveRound` (6276) · `_ARENA_MOVE_LABEL` (6060) · `_ARENA_MOVE_META`
  (6062) · `_ARENA_BEATS` (6114) · `_arPlayReveal` (7913) · `_arPlayFlawless`
  (7976). After the cut, re-run the inventory for newly-dead support constants
  (cascade) and remove those in the same commit IF count==1 then.
- **Orphan assets → archive move (not delete):** brand/spark*.svg ·
  equipment/panel-base.png (2.3 MB) · item-icons/README.md · stat-icons/*-source.png
  ×6. Bundle impact: **zero** (not in prep-local-build whitelist); repo hygiene only.

## KEPT — never-delete / uncertainty (the list Richie reads first)
- `_REF_POWER` (6351): sim-mirror infrastructure (W233 sim reference power) —
  never-delete list.
- `_enqueueVerifiedEvents` (31919): unreferenced, but storage-adjacent (verified-event
  outbox writer; reader side live). Uncertainty → KEEP, flag.
- `_prsLogBreadcrumb`/`_paeLog` duplication — kept (above).
- All count==2 items (428) — definition + 1 ref = ACTIVE, untouched.
- Simulated leaderboard + kill switch, QA_UNLOCK flag block, all diagnostics —
  untouched (never-delete).
- All comments, all console diagnostics, index.html orphan elements (e.g.
  `achievements-grid`, `xp-detail-overlay` nodes stay; HTML edits out of scope).

## Self-check against NEVER-DELETE
Kill-switched ✓ (none in candidates) · W-diagnostics ✓ (logs untouched) ·
index.html/sw.js/scripts refs ✓ (count==1 excludes) · string literals ✓ (tokenizer
covers raw text) · storage/migration ✓ (_enqueueVerifiedEvents kept; no migration fn
in list) · Capacitor lifecycle ✓ (none) · selfTest/sim ✓ (_REF_POWER kept) ·
LEGACY-SUSPECT ✓ (W229 cluster has airtight zero-occurrence evidence; everything else
flagged-kept).

## Gate (after every tier)
selfTest 37/37 · three fight hashes byte-identical · boot zero new errors + expected
diagnostics · screen-root spot-render (habits, tower, battle-capable arena, settings,
boss overlay).
