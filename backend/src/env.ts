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
}
