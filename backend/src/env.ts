/**
 * Env interface — shape of the runtime environment passed to every
 * Worker handler as the second argument of `fetch(req, env, ctx)`.
 *
 * Cloudflare populates this object at request time from:
 *   - [[d1_databases]] bindings declared in wrangler.toml
 *   - Secrets uploaded via `wrangler secret put NAME`
 *   - [vars] blocks declared in wrangler.toml (non-secret env vars)
 *
 * All handlers + helper modules import this type so the env shape is
 * consistent across the codebase. Adding a new binding/secret means
 * updating this interface alongside wrangler.toml + README.md secrets
 * list.
 */
/**
 * Cloudflare Workers Rate Limiting API binding shape. The
 * @cloudflare/workers-types package doesn't always export this type
 * directly (it's still under the "unsafe" namespace for now), so we
 * declare it locally to satisfy strict mode. Behaviour is documented
 * at https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
 */
export interface RateLimit {
  /** Returns success: true if the request is within the limit, false if rate-limited. */
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  /** D1 database binding. Maps to wrangler.toml's [[d1_databases]] block. */
  DB: D1Database;

  /** HMAC key for HS256-signing backend session JWTs. 32-byte hex string.
   * Generate via `openssl rand -hex 32`. Set with `wrangler secret put
   * JWT_SIGNING_KEY`. Never log or echo. */
  JWT_SIGNING_KEY: string;

  /** Expected audience claim in Apple identity tokens during verification.
   * Value: "com.goallearner.awakened" (the app's Apple App ID).
   * Set with `wrangler secret put APPLE_BUNDLE_ID`. */
  APPLE_BUNDLE_ID: string;

  /** Apple Developer Team ID. Reserved for v2.2+ server-to-server flows
   * (e.g. account-revocation webhook). Not used by v2.1 endpoints.
   * Value: "LK8FVGBQPL". Set with `wrangler secret put APPLE_TEAM_ID`. */
  APPLE_TEAM_ID: string;

  /** Rate limiters — one per endpoint. Cloudflare's API supports only
   * 10s or 60s periods, so the "12/hour" submit cap from BACKEND.md §8
   * is approximated as 2/minute (≈ 120/hour). Client-side debounce at
   * 5-min intervals keeps legit usage well under both caps. */
  RL_AUTH_VERIFY: RateLimit;
  RL_LEADERBOARD_SUBMIT: RateLimit;
  RL_LEADERBOARD_TOP: RateLimit;
  RL_ACCOUNT_DELETE: RateLimit;
  /** Cloud Sync v1 (v3 Phase 1w) — guards GET /v1/users/me/state. */
  RL_USER_STATE_GET: RateLimit;
  /** Cloud Sync v1 (v3 Phase 1w) — guards POST /v1/users/me/state. */
  RL_USER_STATE_POST: RateLimit;

  /** Discipline Duels v1 (v3 Phase 1x) — friend/duel reads. */
  RL_FRIENDS_READ: RateLimit;
  /** Discipline Duels v1 — friend writes (request/accept/decline/remove). */
  RL_FRIENDS_WRITE: RateLimit;
  /** v3 Phase 1z.279 — Duels retired. RL_DUELS_READ binding removed.
   *  RL_DUELS_WRITE kept because handleDuelsResolve and
   *  handleVerifiedEventsSubmit still use it for in-flight legacy
   *  settlements and outbox drains. */
  RL_DUELS_WRITE: RateLimit;
  /** 100K Step Club + future accolades (v3 Phase 1z.27) — guards
   *  GET /v1/users/me/accolades. 12/min per user. */
  RL_USER_ACCOLADES_READ: RateLimit;
  /** Weekly Steps Hall of Fame (v3 Phase 1z.36) — guards
   *  GET /v1/leaderboard/hall-of-fame. namespace_id 1012 in wrangler.toml. */
  RL_LEADERBOARD_HOF: RateLimit;
  /** 100K Step Club roster (v3 Phase 1z.52) — guards
   *  GET /v1/leaderboard/step-100k-club. namespace_id 1013 in wrangler.toml. */
  RL_LEADERBOARD_STEP_100K_CLUB: RateLimit;
  /** Friend rank badges MVP (v3 Phase 1z.190) — guards
   *  PUT /v1/users/me/public-profile-summary. namespace_id 1014 in
   *  wrangler.toml. Conservative: 6/min per user, since the client
   *  debounces submits to label-change + daily heartbeat. */
  RL_PUBLIC_PROFILE_WRITE: RateLimit;
  /** Public friend activity events MVP-B (v3 Phase 1z.200) — guards
   *  POST /v1/users/me/public-achievement-events. namespace_id 1015
   *  in wrangler.toml. 12/min per user — batch endpoint accepts up
   *  to 10 events per request, so 12/min covers ~120 events/min of
   *  legit usage while still capping abuse. */
  RL_PUBLIC_EVENTS_WRITE: RateLimit;
  /** Public friend activity events MVP-B (v3 Phase 1z.200) — guards
   *  GET /v1/friends/activity. namespace_id 1016 in wrangler.toml.
   *  30/min per user — matches the existing read budget for the
   *  other friend-adjacent reads (RL_FRIENDS_READ, HoF, 100K Club). */
  RL_PUBLIC_EVENTS_READ: RateLimit;
  /** The Hall of the Awakened (W270) — guards POST
   *  /v1/users/me/hall-of-awakened. namespace_id 1017 in wrangler.toml.
   *  Once-ever per user, so the budget is tiny: 6/min covers retries on
   *  a flaky network without permitting abuse. */
  RL_HALL_WRITE: RateLimit;
  /** The Hall of the Awakened (W270) — guards GET /v1/hall-of-awakened.
   *  namespace_id 1018 in wrangler.toml. 30/min per user — matches the
   *  other friend-adjacent reads. */
  RL_HALL_READ: RateLimit;
}
