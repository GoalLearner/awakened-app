/**
 * Awakened backend — Cloudflare Worker entry point.
 *
 * v2.1 Phase B placeholder. This file is intentionally a no-op router
 * during scaffolding (B.1 + B.2) so the Worker is deployable for
 * sanity-check purposes. Real endpoint handlers (POST /v1/auth/verify,
 * POST /v1/leaderboard/submit, GET /v1/leaderboard/top, POST
 * /v1/account/delete) land in Phase B.3 per BACKEND.md §8.
 *
 * Until then, all routes return a JSON placeholder so curling the
 * Worker URL confirms it's reachable and the Wrangler deploy succeeded.
 */
import type { Env } from './env';

export default {
  async fetch(_request: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
    return Response.json(
      {
        status: 'Phase B in progress',
        message: 'Endpoints land in next session. See ../BACKEND.md §8.',
        deployed_at: new Date().toISOString(),
      },
      { status: 200 },
    );
  },
} satisfies ExportedHandler<Env>;
