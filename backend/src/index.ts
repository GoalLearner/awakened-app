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
import { handleAccountDelete } from './handlers/account-delete';
import { handleUserStateGet, handleUserStatePost } from './handlers/user-state';
import { handleUserAccoladesGet } from './handlers/accolades';
import {
  handleFriendsList,
  handleFriendsRequest,
  handleFriendsAccept,
  handleFriendsDecline,
  handleFriendsRemove,
} from './handlers/friends';
import {
  handleDuelsList,
  handleDuelsCreate,
  handleDuelsAccept,
  handleDuelsDecline,
  handleDuelsCancel,
  handleDuelsDetail,
  handleDuelsSubmitProgress,
  handleDuelsResolve,
  handleVerifiedEventsSubmit,
  handleDuelScoreGet,
} from './handlers/duels';
import { handlePreflight, withCors } from './lib/cors';
import { jsonError } from './lib/responses';

// Regex matchers for parameterized routes (Discipline Duels v1 / v3 Phase 1x).
// Capture group #1 is the row UUID. We accept the standard randomUUID()
// charset (hex + dashes) — anything else 404s implicitly.
const FRIENDS_ID_RE = /^\/v1\/friends\/([0-9a-fA-F-]{8,})\/(accept|decline|remove)$/;
const DUELS_ID_RE = /^\/v1\/duels\/([0-9a-fA-F-]{8,})\/(accept|decline|cancel)$/;
// Steps Duel Scoring v1 (v3 Phase 1y) — POST progress + resolve.
const DUELS_SCORING_RE = /^\/v1\/duels\/([0-9a-fA-F-]{8,})\/(progress|resolve)$/;
// Verified Duel Scoring Engine v1 (v3 Phase 1z) — GET /v1/duels/:id/score.
const DUELS_SCORE_RE = /^\/v1\/duels\/([0-9a-fA-F-]{8,})\/score$/;
const DUELS_DETAIL_RE = /^\/v1\/duels\/([0-9a-fA-F-]{8,})$/;

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
      // ── Health check (uncached, no auth) ──
      else if (path === '/health' && method === 'GET') {
        response = Response.json({
          status: 'ok',
          service: 'awakened-backend',
          time: new Date().toISOString(),
        });
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
          }
          // ── Discipline Duels v1 (v3 Phase 1x) ──
          else if (path === '/v1/friends' && method === 'GET') {
            response = await handleFriendsList(request, env, session);
          } else if (path === '/v1/friends/request' && method === 'POST') {
            response = await handleFriendsRequest(request, env, session);
          } else if (path === '/v1/duels' && method === 'GET') {
            response = await handleDuelsList(request, env, session);
          } else if (path === '/v1/duels' && method === 'POST') {
            response = await handleDuelsCreate(request, env, session);
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
          } else if (DUELS_ID_RE.test(path) && method === 'POST') {
            const match = path.match(DUELS_ID_RE)!;
            const duelId = match[1];
            const action = match[2];
            if (action === 'accept') {
              response = await handleDuelsAccept(request, env, session, duelId);
            } else if (action === 'decline') {
              response = await handleDuelsDecline(request, env, session, duelId);
            } else {
              // 'cancel' — challenger-only, pending-only (v3 Phase 1z.1).
              response = await handleDuelsCancel(request, env, session, duelId);
            }
          } else if (DUELS_SCORING_RE.test(path) && method === 'POST') {
            // Steps Duel Scoring v1 (v3 Phase 1y).
            const match = path.match(DUELS_SCORING_RE)!;
            const duelId = match[1];
            const action = match[2];
            if (action === 'progress') {
              response = await handleDuelsSubmitProgress(request, env, session, duelId);
            } else {
              response = await handleDuelsResolve(request, env, session, duelId);
            }
          } else if (path === '/v1/verified-events' && method === 'POST') {
            // Verified Duel Scoring Engine v1 (v3 Phase 1z).
            response = await handleVerifiedEventsSubmit(request, env, session);
          } else if (DUELS_SCORE_RE.test(path) && method === 'GET') {
            // Verified Duel Scoring Engine v1 (v3 Phase 1z).
            const match = path.match(DUELS_SCORE_RE)!;
            response = await handleDuelScoreGet(request, env, session, match[1]);
          } else if (DUELS_DETAIL_RE.test(path) && method === 'GET') {
            const match = path.match(DUELS_DETAIL_RE)!;
            response = await handleDuelsDetail(request, env, session, match[1]);
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
