/**
 * POST /v1/account/delete
 *
 * Authenticated endpoint. Hard-deletes the calling user's row.
 * leaderboard_snapshots cascades via FK ON DELETE CASCADE so a single
 * statement removes the user from all leaderboards.
 *
 * App Store requirement: any app offering Sign in with Apple MUST
 * provide in-app account deletion. This endpoint satisfies that.
 *
 * No body required. Returns 200 { deleted: true } on success.
 *
 * BACKEND.md §8.
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk, jsonError } from '../lib/responses';
import { deleteUserStateSnapshot } from './user-state';

export async function handleAccountDelete(
  _request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_ACCOUNT_DELETE.limit({ key: session.userId });
  if (!rl.success) {
    return jsonError(
      429,
      'RATE_LIMITED',
      'Too many account-deletion attempts. Try again in a minute.',
    );
  }

  // Cloud Sync v1 (v3 Phase 1w) — wipe the state snapshot first.
  // user_state_snapshots has no FK on users.id (kept independent so
  // schema can evolve without coupling), so the cascade is manual.
  await deleteUserStateSnapshot(env, session.userId);

  // DELETE cascades to leaderboard_snapshots via FK. No need to clean
  // up other tables manually.
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(session.userId).run();

  return jsonOk({ deleted: true });
}
