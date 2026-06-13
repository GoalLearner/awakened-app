# STAGED_FEATURES — design-staged, not yet built

Ledger of features with landed design mockups (and in some cases pre-landed CSS)
that are **still planned**. Cleanup passes: these mockups and CSS families are
KEEP — do not re-flag. Verdicts recorded live with Richie, 2026-06-12.

| Feature | Mockup file | CSS families in styles.css | Intent (one line) |
|---|---|---|---|
| Codex habits tab | `preview-habits.html` | `codex-*` (section headers/counters/progress) | Grimoire-style redesign of the Habits tab. |
| Notifications UI | `preview-notifications.html` | `notif-ping-*`, `settings-rem-*`, `notif-explain-btn--ghost`, `notif-subsection-label` | Redesigned reminder rows + ping settings surface. |
| Notification copy showcase | `preview-notif-copy.html` | — (self-contained) | Dev page rendering all 6 `composeDigestBody` branches for copy review. |
| Leaderboard preview | `preview-leaderboards.html` | `friend-avatar--*` (also live elsewhere) | Leaderboard design preview fed by the (kill-switched, dormant-by-design) simulated-hunters system. |
| Morning briefing | `preview-morning-briefing.html` (tracked as of this ledger) | — (builds on live generic pack helpers) | A morning-routine briefing surface; the old morning-pack compat shims were removed (cleanup T2a), the generic pack system it would use is live. |

Removed as ABANDONED in the same session (Duels permanently retired):
`preview-social.html` ("Discipline Duels tab") and the untracked
`preview-duels-polish.html`, plus the `social-empty-icon` CSS orphan.

## Parked engineering follow-ups (no mockup)

- **Hall-ordinal cross-link** (W276, parked 2026-06-12) — join `hall_of_awakened`
  to show each finisher's ordinal on the floor-100 crown of the Highest Floor
  leaderboard ("the 47th to awaken" instead of a bare crown). Build when the
  first real climber nears floor 100. Breadcrumb at the query:
  `backend/src/handlers/leaderboard-top.ts` (search "CROSS-LINK (parked)").
