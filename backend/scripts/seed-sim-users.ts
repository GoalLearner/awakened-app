/**
 * seed-sim-users.ts — One-off Worker entrypoint for sim user seeding.
 *
 * v3 Phase 1z.279 — Duels permanently retired. This script was
 * originally written to provision sim users for duel testing and
 * still counts/cleans rows in `duels`, `duel_progress_snapshots`,
 * `verified_events`, and `user_souls_ledger`. Those tables are
 * preserved during the post-retirement transition window (see
 * backend/migrations/RETIREMENT_PLAN.md) so this script continues
 * to work as-is. When the final cleanup migration drops those
 * tables, update the count/teardown queries below to remove the
 * dropped-table references (or wrap them in try/catch).
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

/** Prefix-based identifiers we use to find sim-only rows in tables
 * where the row no longer joins back to a user (orphans after a
 * prior incomplete teardown). Every sim script writes
 * `client_event_id` values starting with one of these two prefixes. */
const SIM_EVENT_PREFIXES = ['sim-alpha-%', 'sim-bravo-%'] as const;

interface ArtifactCounts {
  users: number;
  friends: number;
  duels: number;
  verified_events: number;
  user_souls_ledger: number;
  duel_progress_snapshots: number;
  user_state_snapshots: number;
  leaderboard_snapshots: number;
}

/**
 * Counts the sim artifacts that would be reachable BEFORE a teardown
 * (joined via users.id) plus orphans reachable via prefix-based
 * identifiers. After teardown completes, every count should be 0.
 *
 * `simUserIds` may be empty when called post-teardown — in that case
 * artifact counts fall back to the prefix-based path for verified_events,
 * and the other tables read 0 (we have no FK target to query against).
 */
async function countSimArtifacts(env: Env, simUserIds: string[]): Promise<ArtifactCounts> {
  const allowed_subs = ALLOWED_TEST_USERS.map(u => u.apple_sub);
  const subPh = allowed_subs.map(() => '?').join(', ');

  // Users — always the canonical truth, queries by apple_sub allowlist.
  const usersRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM users WHERE apple_sub IN (${subPh})`,
  ).bind(...allowed_subs).first<{ n: number }>();

  // verified_events — by user_id OR client_event_id prefix. The prefix
  // path catches orphans whose owning user was deleted in a prior pass.
  const veRow = await env.DB.prepare(
    simUserIds.length > 0
      ? `SELECT COUNT(*) AS n FROM verified_events
         WHERE user_id IN (${simUserIds.map(() => '?').join(', ')})
            OR client_event_id LIKE ?
            OR client_event_id LIKE ?`
      : `SELECT COUNT(*) AS n FROM verified_events
         WHERE client_event_id LIKE ? OR client_event_id LIKE ?`,
  ).bind(...simUserIds, ...SIM_EVENT_PREFIXES).first<{ n: number }>();

  // For the remaining tables we MUST have a user_id to query. After a
  // user delete with no CASCADE these become orphans we can't easily
  // distinguish from real-user rows; the caller is responsible for
  // running teardown BEFORE the parent user delete so simUserIds is
  // populated. countSimArtifacts is also called BEFORE the user delete
  // to produce the "before" snapshot, then again AFTER. Post-delete
  // calls see simUserIds=[] and report 0 for these tables (the orphan
  // safety net lives in the SQL inside teardown() — every child row
  // for the sim user IDs is deleted before users are removed).
  const counts: ArtifactCounts = {
    users: usersRow?.n ?? 0,
    friends: 0,
    duels: 0,
    verified_events: veRow?.n ?? 0,
    user_souls_ledger: 0,
    duel_progress_snapshots: 0,
    user_state_snapshots: 0,
    leaderboard_snapshots: 0,
  };

  if (simUserIds.length === 0) return counts;

  const userPh = simUserIds.map(() => '?').join(', ');

  const friendsRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM friends
     WHERE requester_user_id IN (${userPh}) OR recipient_user_id IN (${userPh})`,
  ).bind(...simUserIds, ...simUserIds).first<{ n: number }>();
  counts.friends = friendsRow?.n ?? 0;

  const duelsRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM duels
     WHERE challenger_user_id IN (${userPh}) OR opponent_user_id IN (${userPh})`,
  ).bind(...simUserIds, ...simUserIds).first<{ n: number }>();
  counts.duels = duelsRow?.n ?? 0;

  const ledgerRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM user_souls_ledger WHERE user_id IN (${userPh})`,
  ).bind(...simUserIds).first<{ n: number }>();
  counts.user_souls_ledger = ledgerRow?.n ?? 0;

  // duel_progress_snapshots — legacy Phase 1y table; safe to query.
  try {
    const dpsRow = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM duel_progress_snapshots WHERE user_id IN (${userPh})`,
    ).bind(...simUserIds).first<{ n: number }>();
    counts.duel_progress_snapshots = dpsRow?.n ?? 0;
  } catch { /* table may be absent in some envs */ }

  try {
    const ussRow = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM user_state_snapshots WHERE user_id IN (${userPh})`,
    ).bind(...simUserIds).first<{ n: number }>();
    counts.user_state_snapshots = ussRow?.n ?? 0;
  } catch { /* table may be absent in some envs */ }

  const lbRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM leaderboard_snapshots WHERE user_id IN (${userPh})`,
  ).bind(...simUserIds).first<{ n: number }>();
  counts.leaderboard_snapshots = lbRow?.n ?? 0;

  return counts;
}

interface TeardownResult {
  ok: true;
  before: ArtifactCounts;
  after: ArtifactCounts;
  deleted: {
    users: number;
    friends: number;
    duels: number;
    verified_events: number;
    user_souls_ledger: number;
    duel_progress_snapshots: number;
    user_state_snapshots: number;
    leaderboard_snapshots: number;
  };
  note: string;
}

/**
 * Explicit sim-only teardown. Walks every table the sim harness might
 * have touched and deletes only rows joined back to the synthetic
 * allowlist (apple_sub IN {'sim_test_alpha', 'sim_test_bravo'}) or
 * carrying a sim-prefixed client_event_id ('sim-alpha-%', 'sim-bravo-%').
 *
 * Defense-in-depth design:
 *   1. Only the 0001 `leaderboard_snapshots` table actually carries
 *      ON DELETE CASCADE. Every other table (friends, duels,
 *      verified_events, user_souls_ledger, duel_progress_snapshots,
 *      user_state_snapshots) was added in later migrations without
 *      CASCADE, so a plain `DELETE FROM users` leaves orphans.
 *   2. Deleting child rows BEFORE the parent users avoids any
 *      `FOREIGN KEY constraint failed` should D1 enforce FKs.
 *   3. The user-id filter list is captured BEFORE the user delete and
 *      reused for child cleanup — children remain reachable even
 *      though the parent rows are about to disappear.
 *
 * CANNOT delete real-user data. Every DELETE either:
 *   - filters `users.apple_sub IN <synthetic allowlist>`, or
 *   - filters by `user_id IN <ids of synthetic users>` (cached up
 *     front from the same allowlist), or
 *   - filters by `client_event_id LIKE 'sim-alpha-%' / 'sim-bravo-%'`
 *     (a string prefix written only by the sim harness).
 */
async function teardown(env: Env): Promise<TeardownResult> {
  const allowed_subs = ALLOWED_TEST_USERS.map(u => u.apple_sub);
  const subPh = allowed_subs.map(() => '?').join(', ');

  // 1. Snapshot sim user IDs BEFORE deleting anything.
  const usersRows = await env.DB.prepare(
    `SELECT id FROM users WHERE apple_sub IN (${subPh})`,
  ).bind(...allowed_subs).all<{ id: string }>();
  const simUserIds = (usersRows.results ?? []).map(r => r.id);

  const before = await countSimArtifacts(env, simUserIds);

  const deleted = {
    users: 0,
    friends: 0,
    duels: 0,
    verified_events: 0,
    user_souls_ledger: 0,
    duel_progress_snapshots: 0,
    user_state_snapshots: 0,
    leaderboard_snapshots: 0,
  };

  // 2. Delete child rows first (orphan-safe even if a prior incomplete
  //    teardown removed users but left children).
  if (simUserIds.length > 0) {
    const userPh = simUserIds.map(() => '?').join(', ');

    // verified_events — by user_id AND by client_event_id prefix.
    let r = await env.DB.prepare(
      `DELETE FROM verified_events
       WHERE user_id IN (${userPh})
          OR client_event_id LIKE ?
          OR client_event_id LIKE ?`,
    ).bind(...simUserIds, ...SIM_EVENT_PREFIXES).run();
    deleted.verified_events += r.meta?.changes ?? 0;

    // user_souls_ledger
    r = await env.DB.prepare(
      `DELETE FROM user_souls_ledger WHERE user_id IN (${userPh})`,
    ).bind(...simUserIds).run();
    deleted.user_souls_ledger += r.meta?.changes ?? 0;

    // duel_progress_snapshots (legacy Phase 1y)
    try {
      r = await env.DB.prepare(
        `DELETE FROM duel_progress_snapshots WHERE user_id IN (${userPh})`,
      ).bind(...simUserIds).run();
      deleted.duel_progress_snapshots += r.meta?.changes ?? 0;
    } catch { /* table may be absent */ }

    // duels — either side of the duel
    r = await env.DB.prepare(
      `DELETE FROM duels
       WHERE challenger_user_id IN (${userPh})
          OR opponent_user_id IN (${userPh})`,
    ).bind(...simUserIds, ...simUserIds).run();
    deleted.duels += r.meta?.changes ?? 0;

    // friends — either side
    r = await env.DB.prepare(
      `DELETE FROM friends
       WHERE requester_user_id IN (${userPh})
          OR recipient_user_id IN (${userPh})`,
    ).bind(...simUserIds, ...simUserIds).run();
    deleted.friends += r.meta?.changes ?? 0;

    // user_state_snapshots
    try {
      r = await env.DB.prepare(
        `DELETE FROM user_state_snapshots WHERE user_id IN (${userPh})`,
      ).bind(...simUserIds).run();
      deleted.user_state_snapshots += r.meta?.changes ?? 0;
    } catch { /* table may be absent */ }

    // leaderboard_snapshots (CASCADE-protected, but explicit DELETE is
    // belt-and-suspenders + counts toward the report)
    r = await env.DB.prepare(
      `DELETE FROM leaderboard_snapshots WHERE user_id IN (${userPh})`,
    ).bind(...simUserIds).run();
    deleted.leaderboard_snapshots += r.meta?.changes ?? 0;
  }

  // 3. Always sweep orphan verified_events by client_event_id prefix
  //    — catches rows left over from a prior `/teardown` that deleted
  //    users but missed the events.
  const orphanEvents = await env.DB.prepare(
    `DELETE FROM verified_events
     WHERE client_event_id LIKE ? OR client_event_id LIKE ?`,
  ).bind(...SIM_EVENT_PREFIXES).run();
  deleted.verified_events += orphanEvents.meta?.changes ?? 0;

  // 4. Delete the sim users themselves (last, after all child cleanup).
  const userDel = await env.DB.prepare(
    `DELETE FROM users WHERE apple_sub IN (${subPh})`,
  ).bind(...allowed_subs).run();
  deleted.users = userDel.meta?.changes ?? 0;

  // 5. Verify — call countSimArtifacts again. We pass the original
  //    simUserIds (now-deleted) so the child-table queries still
  //    surface any orphans we missed. Every count in `after` must be 0.
  const after = await countSimArtifacts(env, simUserIds);

  const allClean =
    after.users === 0 &&
    after.friends === 0 &&
    after.duels === 0 &&
    after.verified_events === 0 &&
    after.user_souls_ledger === 0 &&
    after.duel_progress_snapshots === 0 &&
    after.user_state_snapshots === 0 &&
    after.leaderboard_snapshots === 0;

  const note = allClean
    ? 'CLEAN: all sim artifact tables read 0 post-teardown.'
    : `WARNING: post-teardown counts not all zero (after=${JSON.stringify(after)}). Inspect manually.`;

  return { ok: true, before, after, deleted, note };
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
      return Response.json(result);
    }

    if (url.pathname === '/verify' && req.method === 'GET') {
      // Read-only post-teardown verification. Returns counts of every
      // sim-artifact table. Operator runs after /teardown to confirm
      // every count is 0. Safe to call any time; never writes.
      const allowed_subs = ALLOWED_TEST_USERS.map(u => u.apple_sub);
      const subPh = allowed_subs.map(() => '?').join(', ');
      const usersRows = await env.DB.prepare(
        `SELECT id FROM users WHERE apple_sub IN (${subPh})`,
      ).bind(...allowed_subs).all<{ id: string }>();
      const simUserIds = (usersRows.results ?? []).map(r => r.id);
      const counts = await countSimArtifacts(env, simUserIds);
      const allClean =
        counts.users === 0 &&
        counts.friends === 0 &&
        counts.duels === 0 &&
        counts.verified_events === 0 &&
        counts.user_souls_ledger === 0 &&
        counts.duel_progress_snapshots === 0 &&
        counts.user_state_snapshots === 0 &&
        counts.leaderboard_snapshots === 0;
      return Response.json({
        ok: true,
        clean: allClean,
        counts,
        note: allClean
          ? 'CLEAN: zero sim artifacts present.'
          : 'sim artifacts still present; run POST /teardown',
      });
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
      'POST /seed     -- provision sim_alpha + sim_bravo, mint JWTs\n' +
      'POST /teardown -- explicit sim-only cleanup; returns before/after counts\n' +
      'GET  /verify   -- read-only: returns counts of every sim-artifact table\n' +
      'GET  /whoami   -- list sim users currently in D1 (no JWTs)\n',
      { status: 200, headers: { 'content-type': 'text/plain' } },
    );
  },
};
