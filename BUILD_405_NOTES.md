# Build 405 — what's on main + how to build

`git pull` on the Mac picks up everything below (build 405 = current `main` HEAD).
All client-side; the two backend features here (recap + archive) are ALREADY
deployed, so nothing else server-side is needed.

## Build it (MacBook)

```bash
cd /Volumes/AwakenedDev/repos/awakened-app && git pull && npm install && bash scripts/prep-local-build.sh 405 && npx cap open ios
```

Then Xcode: Product → Archive → Distribute. `prep-local-build.sh` forces
MARKETING_VERSION = 2.4.3; the `405` arg is CFBundleVersion.

## What's in 405 (since 404)

- **W657 — Week Recap** (the Sunday ceremony). First app-open after the Sunday
  00:00-Pacific boundary shows last week's final standings + a personal recap.
  Display-only; nothing pauses. Backend LIVE (migration 0032 + Worker).
- **W658 — Leaderboard Archive** (week-flipper). `‹ Jul 5–11 · FINAL ›` on the
  Steps board; 8-week cap, server-enforced floor. Backend LIVE.
- **W659 — perf cleanup (Guild + save path)**:
  - Guild/friends tab now paints **cache-first** (was network-gated) + the 90s
    poller keeps the roster it used to discard.
  - `save()` **coalesced**: a habit tap re-serialized the whole state 3–9×; now
    one write per action. Completions flush **synchronously** at the moment of
    completion (durable before the celebration renders — a hard kill can't lose
    one). Proven by 6 E2E tests (backgrounding / force-quit / real reload).
  - Deleted a 114 KB inert comment from app.js (prose in CHANGELOG-buildtag.md).
- **W660 — perf cleanup (co-op + breadcrumbs)**:
  - Co-op list double-fetch on boot/resume deduped to one request.
  - Diagnostic breadcrumb writers no longer re-parse localStorage per call;
    per-call console.log gated behind a debug flag. Copy Debug Info unchanged.
- **W661 — pre-submission fixes (from Rendell's testing)**:
  - Ranked "Awakened" tier-up ceremony no longer borrows the tower's "summit /
    First Awakened" language (it was confusingly describing the tower endgame in
    a PvP screen). Copy-only; not a mis-wire.
  - The First Awakened (tower Floor-100 boss) buffed: phase-1 4278→4400,
    phase-2 4546→4600.
  - Ascent floor opponents are now FIXED per floor — a loss re-faces the same
    foe (was re-rolling to an easier type, which also enabled savescum-by-reopen).

Every persistence/money-adjacent change was adversarially reviewed (multi-agent,
find→verify) before ship — those reviews caught a phantom-crown bug (W657), a
completion-loss window (W659), and a co-op cache that didn't actually dedupe
(W660), all fixed. Full E2E suite: 33/33.

## Known tech debt (logged in CLAUDE.md, not fixed)

`hb_completions` still grows unbounded (one entry per active day). W659 made
writing it ~9× cheaper but didn't bound it — needs a structural pass later
(month-chunking / server-side paging). Do NOT solve by deleting history.

## Note on the App Store submission

`SUBMISSION_2.4.3.md` (subscription + Founder marker) references build **404**.
If you already submitted 404 to Apple, build 405 is a perf follow-up. If you
haven't submitted yet, 405 is a superset — use it for the submission and I'll
update that doc's build number to match.
