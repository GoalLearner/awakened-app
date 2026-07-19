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

// W383 (account-delete completeness, Apple 5.1.1(v)) — best-effort cleanup of a
// user-scoped table that does NOT cascade from users.id. Each call is isolated
// in its own try/catch so a missing table (e.g. skins / co-op before their
// migration is applied) or a transient D1 error can NEVER abort the deletion —
// only the core `users` delete must succeed.
async function bestEffortDelete(env: Env, sql: string, ...binds: string[]): Promise<void> {
  try {
    await env.DB.prepare(sql).bind(...binds).run();
  } catch (_) {
    // swallow: completeness cleanup must not break the Apple-required delete
  }
}

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

  const uid = session.userId;

  // W383 — purge user-scoped tables that have NO `ON DELETE CASCADE` to
  // users.id; the single `DELETE FROM users` below would otherwise orphan them.
  // Apple 5.1.1(v) requires deleting the user's data — most importantly the
  // real-money skin_entitlements purchase rows. All best-effort (guarded), so a
  // not-yet-migrated table can't break deletion. (Tables: skin_entitlements 0017,
  // verified_events / user_souls_ledger 0006, friends 0003,
  // coop_boss_instances 0019, duels 0003.)
  await bestEffortDelete(env, 'DELETE FROM skin_entitlements WHERE user_id = ?', uid);
  await bestEffortDelete(env, 'DELETE FROM verified_events WHERE user_id = ?', uid);
  await bestEffortDelete(env, 'DELETE FROM user_souls_ledger WHERE user_id = ?', uid);
  await bestEffortDelete(env, 'DELETE FROM friends WHERE requester_user_id = ? OR recipient_user_id = ?', uid, uid);
  await bestEffortDelete(env, 'DELETE FROM coop_boss_instances WHERE challenger_user_id = ? OR partner_user_id = ?', uid, uid);
  // W677 — the trio seat (0035), as its OWN statement: folding partner2_user_id into
  // the line above would make the WHOLE duo purge fail (swallowed) on a not-yet-
  // migrated DB — bestEffortDelete isolation is the point of this file's structure.
  await bestEffortDelete(env, 'DELETE FROM coop_boss_instances WHERE partner2_user_id = ?', uid);
  // W692 — N-hunter raids (0037): drop the hunts this user is a participant on (raid
  // seats 4/5 have no legacy partner column), then their own participant rows, then any
  // orphan rows left by the instance deletes above (each its own guarded statement so a
  // not-yet-migrated participants table can't break the rest of the deletion).
  await bestEffortDelete(
    env,
    'DELETE FROM coop_boss_instances WHERE id IN (SELECT instance_id FROM coop_boss_participants WHERE user_id = ?)',
    uid,
  );
  await bestEffortDelete(env, 'DELETE FROM coop_boss_participants WHERE user_id = ?', uid);
  await bestEffortDelete(env, 'DELETE FROM coop_boss_participants WHERE instance_id NOT IN (SELECT id FROM coop_boss_instances)');
  await bestEffortDelete(env, 'DELETE FROM duels WHERE challenger_user_id = ? OR opponent_user_id = ?', uid, uid);
  await bestEffortDelete(env, 'DELETE FROM app_opens WHERE user_id = ?', uid); // 0027 retention rows
  // W721 — user-id-keyed tables added after W383 that have no cascade and were
  // never purged. Each its own guarded statement (a not-yet-migrated table can't
  // break the rest). Why each matters:
  //   premium_subscriptions (0030) — real-money record (Apple 5.1.1(v) retention)
  //   device_tokens (0029)          — APNs tokens (privacy)
  //   founder_marks (0031)          — frees the capped lifetime slot (cap 20) a
  //                                   deleted founder would otherwise hold forever
  //   raid_queue (0038)             — else the matchmaking cron can still pull a
  //                                   deleted user into a hunt
  //   coop_boss_awards (0026), pvp_ratings/pvp_queue/pvp_matches (0021)
  await bestEffortDelete(env, 'DELETE FROM premium_subscriptions WHERE user_id = ?', uid);
  await bestEffortDelete(env, 'DELETE FROM device_tokens WHERE user_id = ?', uid);
  await bestEffortDelete(env, 'DELETE FROM founder_marks WHERE user_id = ?', uid);
  await bestEffortDelete(env, 'DELETE FROM raid_queue WHERE user_id = ?', uid);
  await bestEffortDelete(env, 'DELETE FROM coop_boss_awards WHERE user_id = ?', uid);
  await bestEffortDelete(env, 'DELETE FROM pvp_ratings WHERE user_id = ?', uid);
  await bestEffortDelete(env, 'DELETE FROM pvp_queue WHERE user_id = ?', uid);
  await bestEffortDelete(env, 'DELETE FROM pvp_matches WHERE p1_user_id = ? OR p2_user_id = ?', uid, uid);

  // ── Core deletion (MUST succeed) ──
  // user_state_snapshots has no FK on users.id (kept independent so the schema
  // can evolve without coupling), so its cascade is manual.
  await deleteUserStateSnapshot(env, uid);

  // This DELETE cascades to the 6 ON DELETE CASCADE tables (leaderboard_snapshots,
  // user_accolades, weekly_step_records, public_profile_summary,
  // public_achievement_events, hall_of_awakened).
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(uid).run();

  return jsonOk({ deleted: true });
}
