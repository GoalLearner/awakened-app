/**
 * Awakened backend — Cloudflare Worker entry point.
 *
 * Routes 4 endpoints per BACKEND.md §8:
 *
 *   POST /v1/auth/verify         (public — issues session JWT)
 *   POST /v1/leaderboard/submit  (auth required)
 *   GET  /v1/leaderboard/top     (auth required)
 *   POST /v1/account/delete      (auth required)
 *
 * All authenticated routes share the same gate: parse the Bearer token
 * from Authorization header, verify the session JWT (signature, iss,
 * aud, exp, plus LOCALHOST_DEV_STUB rejection), pass the resulting
 * { userId, alias } to the handler. Failure at any step returns 401.
 *
 * Error handling is centralized in the try/catch wrapping the router:
 * any uncaught throw returns 500 INTERNAL with the error message in
 * the detail field (Cloudflare also captures it in wrangler tail
 * output via console.error).
 *
 * Every request logs method + path + status + duration to console.log
 * for `wrangler tail` observability.
 */
import type { Env } from './env';
import { verifySessionJwt } from './session-jwt';
import { handleAuthVerify } from './handlers/auth-verify';
import { handleLeaderboardSubmit } from './handlers/leaderboard-submit';
import { handleLeaderboardTop } from './handlers/leaderboard-top';
import { handleLeaderboardHallOfFame } from './handlers/hall-of-fame';
import { handleLeaderboardLastWeek } from './handlers/leaderboard-last-week';
import { handleStep100kClub } from './handlers/step-100k-club';
import { handleAccountDelete } from './handlers/account-delete';
import { handleUserStateGet, handleUserStatePost } from './handlers/user-state';
import { handleUserAccoladesGet } from './handlers/accolades';
import { handleRevenueCatWebhook } from './handlers/iap-revenuecat-webhook';
import { handleEntitlementsGet } from './handlers/iap-entitlements';
import { handlePublicProfileSummaryPut } from './handlers/public-profile-summary';
import { handleHallFinishPost, handleHallGet } from './handlers/hall-of-awakened';
import { handleRankBandGet } from './handlers/leaderboard-rank-band';
import { handlePublicProfileGet } from './handlers/public-profile-get';
import {
  handlePublicAchievementEventsPost,
  handleFriendsActivityGet,
} from './handlers/public-achievement-events';
import {
  handleFriendsList,
  handleFriendsRequest,
  handleFriendsAccept,
  handleFriendsDecline,
  handleFriendsRemove,
} from './handlers/friends';
import { handleFriendsLeaderboardGet } from './handlers/friends-leaderboard';
import {
  // v3 Phase 1z.279 — Duels permanently retired. Only two endpoints
  // remain to handle in-flight settlements + legacy outbox drains
  // from upgraded clients. All other duel handlers were removed.
  handleDuelsResolve,
  handleVerifiedEventsSubmit,
} from './handlers/duels';
import {
  // Co-op Dungeon Bosses v1 (W370) — two friends jointly meet a combined
  // verified-step goal to defeat one shared boss; both are credited.
  handleCoopBossCreate,
  handleCoopBossList,
  handleCoopBossGet,
  handleCoopBossJoin,
  handleCoopBossDecline,
  handleCoopBossCancel,
  handleCoopBossResolve,
} from './handlers/coop-boss';
import {
  // Realtime human PvP (PVP.md §21) — invite-by-code duels over a MatchRoom
  // Durable Object (WebSocket primary + HTTP fallback).
  handlePvpCreate,
  handlePvpJoin,
  handlePvpSubmit,
  handlePvpForfeit,
  handlePvpState,
  handlePvpRating,
  handlePvpLeaderboard,
  handlePvpFind,
  handlePvpHistory,
  handlePvpWs,
} from './handlers/pvp';
import { handlePreflight, withCors } from './lib/cors';

// The MatchRoom Durable Object must be a named export of the worker module so the
// runtime can instantiate it (matches class_name in wrangler.toml).
export { MatchRoom } from './pvp/match-room';
import { jsonError } from './lib/responses';

// Regex matchers for parameterized routes.
// Capture group #1 is the row UUID. We accept the standard randomUUID()
// charset (hex + dashes) — anything else 404s implicitly.
const FRIENDS_ID_RE = /^\/v1\/friends\/([0-9a-fA-F-]{8,})\/(accept|decline|remove)$/;
// W-next — public profile card by alias. Exact /v1/users/me/* routes are
// matched before this, so the :alias capture never shadows them.
const USER_PROFILE_RE = /^\/v1\/users\/([^/]+)\/profile$/;
// v3 Phase 1z.279 — Duels permanently retired. The only remaining
// duel-shaped route is POST /v1/duels/:id/resolve (legacy in-flight
// settlement from pre-w160 clients). All other duel regexes removed.
const DUELS_RESOLVE_RE = /^\/v1\/duels\/([0-9a-fA-F-]{8,})\/resolve$/;
// Co-op Dungeon Bosses v1 (W370). Action routes (capture #1 = instance id,
// #2 = action) are matched before the bare detail route so /:id/join etc.
// never shadow GET /:id.
const COOP_BOSS_ACTION_RE = /^\/v1\/coop-boss\/([0-9a-fA-F-]{8,})\/(join|decline|cancel|resolve)$/;
const COOP_BOSS_ID_RE = /^\/v1\/coop-boss\/([0-9a-fA-F-]{8,})$/;

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    // CORS preflight short-circuit
    if (request.method === 'OPTIONS') {
      return handlePreflight();
    }

    const startMs = Date.now();
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    let response: Response;

    try {
      // ── Public routes ──
      if (path === '/v1/auth/verify' && method === 'POST') {
        response = await handleAuthVerify(request, env);
      }
      // ── RevenueCat purchase webhook (W297 — public; shared-secret auth) ──
      // Called by RevenueCat's servers, not the app, so it has no session JWT;
      // it authenticates via the REVENUECAT_WEBHOOK_AUTH shared secret instead.
      else if (path === '/v1/iap/revenuecat-webhook' && method === 'POST') {
        response = await handleRevenueCatWebhook(request, env);
      }
      // ── Health check (uncached, no auth) ──
      else if (path === '/health' && method === 'GET') {
        response = Response.json({
          status: 'ok',
          service: 'awakened-backend',
          time: new Date().toISOString(),
        });
      }
      // ── Realtime PvP WebSocket upgrade (PVP.md §21) ──
      // Browsers cannot set an Authorization header on a WS handshake, so this
      // route authenticates via the ?token= query param (validated inside the
      // handler) and lives BEFORE the Bearer gate below.
      else if (path === '/v1/pvp/ws' && request.headers.get('Upgrade') === 'websocket') {
        response = await handlePvpWs(request, env);
      }
      // ── Authenticated routes ──
      else {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          response = jsonError(
            401,
            'AUTH_REQUIRED',
            'Authorization header missing or malformed (expected "Bearer <jwt>").',
          );
        } else {
          let session;
          try {
            session = await verifySessionJwt(authHeader.slice(7), env);
          } catch (err) {
            const detail = err instanceof Error ? err.message : 'Session verification failed.';
            response = jsonError(401, 'INVALID_SESSION', detail);
            logRequest(method, path, response.status, Date.now() - startMs);
            return withCors(response);
          }

          if (path === '/v1/leaderboard/submit' && method === 'POST') {
            response = await handleLeaderboardSubmit(request, env, session);
          } else if (path === '/v1/leaderboard/top' && method === 'GET') {
            response = await handleLeaderboardTop(request, env, session);
          } else if (path === '/v1/leaderboard/hall-of-fame' && method === 'GET') {
            // v3 Phase 1z.36 — Weekly Steps Hall of Fame read endpoint.
            response = await handleLeaderboardHallOfFame(request, env, session);
          } else if (path === '/v1/leaderboard/last-week' && method === 'GET') {
            // W321 — last week's final step standings (the retention recap).
            response = await handleLeaderboardLastWeek(request, env, session);
          } else if (path === '/v1/leaderboard/step-100k-club' && method === 'GET') {
            // v3 Phase 1z.52 — 100K Step Club roster (real users only).
            response = await handleStep100kClub(request, env, session);
          } else if (path === '/v1/leaderboard/rank-band' && method === 'GET') {
            // W319 — "Hunters in your rank" cohort board. Ranks the caller's
            // rank_tier by power; reuses public_profile_summary (no new schema,
            // no new binding — read budget shares RL_HALL_READ).
            response = await handleRankBandGet(request, env, session);
          } else if (path === '/v1/account/delete' && method === 'POST') {
            response = await handleAccountDelete(request, env, session);
          } else if (path === '/v1/users/me/state' && method === 'GET') {
            // Cloud Sync v1 (v3 Phase 1w) — backup fetch.
            response = await handleUserStateGet(request, env, session);
          } else if (path === '/v1/users/me/state' && method === 'POST') {
            // Cloud Sync v1 (v3 Phase 1w) — backup upsert.
            response = await handleUserStatePost(request, env, session);
          } else if (path === '/v1/users/me/accolades' && method === 'GET') {
            // v3 Phase 1z.27 — 100K Step Club + future accolade types.
            response = await handleUserAccoladesGet(request, env, session);
          } else if (path === '/v1/users/me/entitlements' && method === 'GET') {
            // W297 — owned cosmetic skin ids (real-money IAP). Source of truth
            // for skin ownership; the client caches it display-only.
            response = await handleEntitlementsGet(request, env, session);
          } else if (path === '/v1/users/me/public-profile-summary' && method === 'PUT') {
            // v3 Phase 1z.190 — Friend rank badges MVP. Upserts the
            // caller's public_profile_summary row. Read path is the
            // LEFT JOIN inside handleFriendsList.
            response = await handlePublicProfileSummaryPut(request, env, session);
          } else if (path === '/v1/users/me/public-achievement-events' && method === 'POST') {
            // v3 Phase 1z.200 — Public friend activity events
            // MVP-B. Batch write of allowlisted public events;
            // duplicates collapse via UNIQUE (user_id,
            // client_event_id). Read path is GET /v1/friends/
            // activity.
            response = await handlePublicAchievementEventsPost(request, env, session);
          } else if (path === '/v1/friends/activity' && method === 'GET') {
            // v3 Phase 1z.200 — Friend-scoped feed read. Returns
            // newest events across accepted friends + self with
            // alias + rankLabel joined for one-roundtrip render.
            response = await handleFriendsActivityGet(request, env, session);
          } else if (path === '/v1/users/me/hall-of-awakened' && method === 'POST') {
            // W270 — The Hall of the Awakened. Records the caller as a
            // finisher of all 100 Ascent floors and assigns the eternal
            // global ordinal (once-ever; #1 is the first finisher forever).
            response = await handleHallFinishPost(request, env, session);
          } else if (path === '/v1/hall-of-awakened' && method === 'GET') {
            // W270 — the Roll: top finishers + the caller's neighbourhood.
            response = await handleHallGet(request, env, session);
          } else if (USER_PROFILE_RE.test(path) && method === 'GET') {
            // W-next — public profile card for any user by alias.
            const m = path.match(USER_PROFILE_RE)!;
            response = await handlePublicProfileGet(request, env, session, m[1]);
          }
          // ── Friends + legacy-Duels residuals ──
          else if (path === '/v1/friends' && method === 'GET') {
            response = await handleFriendsList(request, env, session);
          } else if (path === '/v1/friends/leaderboard' && method === 'GET') {
            // W320 — friends leaderboard: steps this week among accepted
            // friends + self. Reuses leaderboard_snapshots + the friend graph
            // (no new schema/binding; read budget shares RL_FRIENDS_READ).
            response = await handleFriendsLeaderboardGet(request, env, session);
          } else if (path === '/v1/friends/request' && method === 'POST') {
            response = await handleFriendsRequest(request, env, session);
          } else if (FRIENDS_ID_RE.test(path) && method === 'POST') {
            const match = path.match(FRIENDS_ID_RE)!;
            const friendshipId = match[1];
            const action = match[2];
            if (action === 'accept') {
              response = await handleFriendsAccept(request, env, session, friendshipId);
            } else if (action === 'decline') {
              response = await handleFriendsDecline(request, env, session, friendshipId);
            } else {
              response = await handleFriendsRemove(request, env, session, friendshipId);
            }
          } else if (DUELS_RESOLVE_RE.test(path) && method === 'POST') {
            // v3 Phase 1z.279 — Duels permanently retired. The only
            // remaining duel-shaped route handles in-flight settlement
            // for clients still on pre-w160 builds. New clients (w160+)
            // never call this. Idempotent: re-calling on an already-
            // completed duel returns the existing payload without
            // any DB writes.
            const match = path.match(DUELS_RESOLVE_RE)!;
            response = await handleDuelsResolve(request, env, session, match[1]);
          } else if (path === '/v1/verified-events' && method === 'POST') {
            // v3 Phase 1z.279 — Drain target for the legacy verified-
            // event outbox on upgraded clients. New clients don't
            // enqueue events (producer removed in w160) but still drain
            // any pre-retirement queue contents on cold launch +
            // foreground. Backend dedupes via UNIQUE(user_id,
            // client_event_id).
            response = await handleVerifiedEventsSubmit(request, env, session);
          }
          // ── Co-op Dungeon Bosses (W370) ──
          else if (path === '/v1/coop-boss' && method === 'POST') {
            // Challenger invites an accepted friend to a shared boss hunt.
            response = await handleCoopBossCreate(request, env, session);
          } else if (path === '/v1/coop-boss' && method === 'GET') {
            // List the caller's co-op hunts (both challenger + partner roles).
            response = await handleCoopBossList(request, env, session);
          } else if (COOP_BOSS_ACTION_RE.test(path) && method === 'POST') {
            const match = path.match(COOP_BOSS_ACTION_RE)!;
            const instanceId = match[1];
            const action = match[2];
            if (action === 'join') {
              response = await handleCoopBossJoin(request, env, session, instanceId);
            } else if (action === 'decline') {
              response = await handleCoopBossDecline(request, env, session, instanceId);
            } else if (action === 'cancel') {
              response = await handleCoopBossCancel(request, env, session, instanceId);
            } else {
              response = await handleCoopBossResolve(request, env, session, instanceId);
            }
          } else if (COOP_BOSS_ID_RE.test(path) && method === 'GET') {
            const match = path.match(COOP_BOSS_ID_RE)!;
            response = await handleCoopBossGet(request, env, session, match[1]);
          }
          // ── Realtime human PvP (PVP.md §21) — invite-by-code duels. The WS
          //    upgrade is handled above (pre-auth, ?token=); these are the HTTP
          //    create/join + the HTTP fallback for state/move submission. ──
          else if (path === '/v1/pvp/create' && method === 'POST') {
            response = await handlePvpCreate(request, env, session);
          } else if (path === '/v1/pvp/join' && method === 'POST') {
            response = await handlePvpJoin(request, env, session);
          } else if (path === '/v1/pvp/find' && method === 'POST') {
            response = await handlePvpFind(request, env, session);
          } else if (path === '/v1/pvp/submit' && method === 'POST') {
            response = await handlePvpSubmit(request, env, session);
          } else if (path === '/v1/pvp/forfeit' && method === 'POST') {
            response = await handlePvpForfeit(request, env, session);
          } else if (path === '/v1/pvp/state' && method === 'GET') {
            response = await handlePvpState(request, env, session);
          } else if (path === '/v1/pvp/rating' && method === 'GET') {
            response = await handlePvpRating(request, env, session);
          } else if (path === '/v1/pvp/leaderboard' && method === 'GET') {
            response = await handlePvpLeaderboard(request, env, session);
          } else if (path === '/v1/pvp/history' && method === 'GET') {
            response = await handlePvpHistory(request, env, session);
          } else {
            response = jsonError(404, 'NOT_FOUND', `No route for ${method} ${path}.`);
          }
        }
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Internal server error.';
      console.error(`Unhandled error on ${method} ${path}:`, err);
      response = jsonError(500, 'INTERNAL', detail);
    }

    logRequest(method, path, response.status, Date.now() - startMs);
    return withCors(response);
  },
} satisfies ExportedHandler<Env>;

/** Single-line request log for `wrangler tail` filtering. */
function logRequest(method: string, path: string, status: number, durationMs: number): void {
  // Format: 2026-05-12T19:30:00.000Z POST /v1/auth/verify 200 142ms
  console.log(`${new Date().toISOString()} ${method} ${path} ${status} ${durationMs}ms`);
}
