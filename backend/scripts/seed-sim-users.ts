/**
 * seed-sim-users.ts — One-off Worker entrypoint for duel-sim user seeding.
 *
 * Runs LOCALLY via `wrangler dev --remote` with prod bindings. The
 * Worker code executes inside the Cloudflare runtime sandbox on your
 * machine but D1 reads/writes hit the REAL `awakened-db` and JWTs are
 * signed with the REAL `JWT_SIGNING_KEY` secret. The signing key
 * never touches your local terminal — only the resulting JWTs come
 * back through the response body.
 *
 * Usage:
 *   cd backend
 *   npx wrangler dev scripts/seed-sim-users.ts --remote --port 8788
 *
 *   # In another terminal:
 *   curl -X POST http://localhost:8788/seed
 *   # → { alpha: { id, jwt }, bravo: { id, jwt } }
 *
 *   # When sims are done:
 *   curl -X POST http://localhost:8788/teardown
 *   # → { ok: true, deleted: <count> }
 *
 * Safety:
 *   - Hardcoded alias allowlist: ONLY 'sim_alpha' and 'sim_bravo'.
 *   - Hardcoded apple_sub allowlist: ONLY 'sim_test_alpha' and
 *     'sim_test_bravo' — these strings DO NOT match Apple's real
 *     apple_sub format (`NNNNNN.<32-hex>`), so any future audit can
 *     trivially distinguish them.
 *   - /teardown only deletes rows whose apple_sub matches the
 *     synthetic allowlist. Cannot accidentally delete real users.
 *   - /seed is idempotent — re-running returns the existing row's
 *     user_id with a freshly-minted JWT.
 *   - The Worker has no authentication. SAFE because it only runs
 *     LOCALLY via `wrangler dev` against localhost:8788; it never
 *     deploys to production. Do NOT deploy this entrypoint.
 *
 * Lifecycle:
 *   - Run before duel sims to provision/refresh JWTs.
 *   - JWTs land in sims/.secrets/{alpha,bravo}.jwt (manually saved
 *     by the operator running the curl commands).
 *   - Run /teardown after sims to wipe the test users + cascaded
 *     friends/duels/verified_events/ledger rows.
 *
 * Do NOT add this file to wrangler.toml's `main` field. It's a
 * standalone CLI entrypoint, invoked via `wrangler dev <path>`.
 */
import { issueSessionJwt } from '../src/session-jwt';
import type { Env } from '../src/env';

const ALLOWED_TEST_USERS = [
  { alias: 'sim_alpha', apple_sub: 'sim_test_alpha' },
  { alias: 'sim_bravo', apple_sub: 'sim_test_bravo' },
] as const;

interface SeededUser {
  id: string;
  alias: string;
  apple_sub: string;
  jwt: string;
}

async function seedOrFetchUser(
  env: Env,
  alias: string,
  apple_sub: string,
): Promise<SeededUser> {
  // Idempotent upsert: if a row with this synthetic apple_sub already
  // exists, reuse its UUID. Otherwise insert a new row.
  const existing = await env.DB.prepare(
    'SELECT id, alias FROM users WHERE apple_sub = ?',
  ).bind(apple_sub).first<{ id: string; alias: string }>();

  let userId: string;
  if (existing) {
    userId = existing.id;
  } else {
    userId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      'INSERT INTO users (id, apple_sub, alias, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(userId, apple_sub, alias, now, now).run();
  }

  const jwt = await issueSessionJwt(userId, alias, env);
  return { id: userId, alias, apple_sub, jwt };
}

async function teardown(env: Env): Promise<{ deleted_users: number }> {
  // Only deletes rows whose apple_sub is in the synthetic allowlist.
  // Foreign-key CASCADE on the schema wipes friends + duels +
  // verified_events + user_souls_ledger + user_state_snapshots +
  // leaderboard_snapshots rows for those users automatically.
  const allowed_subs = ALLOWED_TEST_USERS.map(u => u.apple_sub);
  const placeholders = allowed_subs.map(() => '?').join(', ');
  const result = await env.DB.prepare(
    `DELETE FROM users WHERE apple_sub IN (${placeholders})`,
  ).bind(...allowed_subs).run();
  return { deleted_users: result.meta?.changes ?? 0 };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === '/seed' && req.method === 'POST') {
      const seeded: Record<string, SeededUser> = {};
      for (const u of ALLOWED_TEST_USERS) {
        const out = await seedOrFetchUser(env, u.alias, u.apple_sub);
        // Map alias → seeded record, with the alias prefix stripped
        // (sim_alpha → alpha) for readability.
        const key = u.alias.replace(/^sim_/, '');
        seeded[key] = out;
      }
      return Response.json({ ok: true, ...seeded });
    }

    if (url.pathname === '/teardown' && req.method === 'POST') {
      const result = await teardown(env);
      return Response.json({ ok: true, ...result });
    }

    if (url.pathname === '/whoami' && req.method === 'GET') {
      // Read-only diagnostic. Returns the current sim test users if
      // they exist (without exposing JWTs). Safe to call any time.
      const allowed_subs = ALLOWED_TEST_USERS.map(u => u.apple_sub);
      const placeholders = allowed_subs.map(() => '?').join(', ');
      const rows = await env.DB.prepare(
        `SELECT id, alias, apple_sub, datetime(created_at, 'unixepoch') AS created
         FROM users WHERE apple_sub IN (${placeholders})`,
      ).bind(...allowed_subs).all();
      return Response.json({ ok: true, users: rows.results });
    }

    return new Response(
      'seed-sim-users worker.\n' +
      'POST /seed     — provision sim_alpha + sim_bravo, mint JWTs\n' +
      'POST /teardown — delete both sim users + cascade their data\n' +
      'GET  /whoami   — list sim users currently in D1 (no JWTs)\n',
      { status: 200, headers: { 'content-type': 'text/plain' } },
    );
  },
};
