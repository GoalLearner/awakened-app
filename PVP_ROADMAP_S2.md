# PvP Season-2 Roadmap (4-hour autonomous build)

**Context.** Ranked PvP is live (2.3.0). Already shipped across W404–W414, so NOT in scope:
same-as-Ascent combat (parity 3/3), the Arena lobby + rank band, invite-by-code, ranked
MMR (7 tiers, draw=0.5), the **ladder view**, **Find Match vs ELO-matched AI bots** (the
open-queue lane — done, bot-backed so it's always instant), the **pre-match VS screen**,
**rank-up/down moments**, **match history**, and **win-streak display**. Server-authoritative
MatchRoom DO on free-tier SQLite; itest 26/26.

## The pick (and why)

Two features, built to a polish, beat a pile of stubs. Per the brief's explicit steer and
what's genuinely missing:

### 1. REMATCH (headline — removes the biggest 2-player friction)
After a duel ends, "Rematch" re-challenges the **same opponent** with no code re-generation.
- **Human match:** an offer/accept handshake **in the same MatchRoom DO** (it persists
  post-match). A requests → opponent sees Accept/Decline → on mutual yes the DO **resets the
  match** (new seed, cleared history, phase active) and broadcasts a fresh `match_start`.
- **Bot match:** "Rematch" is an instant new Find-Match (bots are already instant).
- **Ugly paths:** decline → "Opponent declined"; no response in 20s → offer expires (DO
  alarm); opponent socket gone → "Opponent left." Each player can only request once per ended
  match; a reset clears the rematch flags. The WS now stays open on the result screen (closed
  on leave) so the offer can be delivered.
- **Why:** retention. The single biggest drag on a 2-player loop is re-sharing codes; rematch
  makes "best of N" frictionless. Reuses the entire battle path — no combat fork.

### 2. SHAREABLE BATTLE-RESULT CARD (cheapest viral surface)
A "Share this win" CTA on the ranked result, reusing the **boss-kill share-card pattern**
(`data-bkshare` → `_bksRenderCanvas` → `_bksShareCanvas`). A new `data-bk-source="pvp"` builds
the card `d` from **server-broadcast** numbers (tier, ELO + delta, opponent, outcome). Renders
client-side; the numbers come from the match_end / rating state, never invented.
- **Why:** virality at near-zero cost — every shared card is an ad with the player's real
  ranked result, and it reuses an existing, tested renderer.

### 3. Win-streak milestone moment (polish, if time)
At streak milestones (3/5/10) a celebratory "🔥 5 WIN STREAK" beat on the result. Pure
client, derived from the already-built history/streak — no reward-grant, no currency risk.

## Deferred (honest cut)
- **Seasons / placement / ranked decay** — meaningful only with a population + a season clock;
  premature for the current userbase.
- **Ranked rewards / cosmetics** — needs the souls/IAP economy wired into a server grant +
  anti-farm; too much integration risk for the budget, and rating integrity must not depend on
  a half-built grant path.
- **Spectate / emotes / chat** — net-new surfaces, lower retention-per-hour than rematch+share.
- **Friend-list duels** — invite-by-code already covers friend duels; deep friends-graph
  delivery is a separate feature.
- **Daily duel quests with rewards** — same currency-grant risk as ranked rewards.

## Constraints honored
Server-authoritative (rematch reset + the numbers on the share card are DO/handler-computed);
no combat fork (rematch reuses the battle path, share is presentation-only); free-tier (rematch
is DO state — **no new table/migration needed**; share needs no backend); backward-compatible
(additive; the rematch handshake is gated to ended matches). Two real human JWTs aren't
available here, so the human-rematch flow is proven via itest on identical code + prod route
smoke, stated plainly in the report.

## Plan
- **P1 backend:** rematch handshake + reset in MatchRoom DO; `rematch_offer/declined`
  broadcasts; offer-expiry alarm; itest cases (request→accept→fresh match; decline; expiry).
- **P2 client:** rematch button + offer/accept UI on the result; keep WS open on result;
  `data-bk-source="pvp"` share card; streak-milestone moment. Version bump.
- **P3 integration:** itest two-client rematch + a regression pass on win/loss/draw MMR + ladder.
- **P4 deploy + adversarial self-review** (rematch-to-dodge-loss, double-reset, streak farming),
  docs, final commit.
