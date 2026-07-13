/**
 * weekly-champion.ts — W657: the ONE idempotent write path for the
 * 'weekly_step_champion' accolade (the Step Crown).
 *
 * Extracted from leaderboard-last-week.ts (W322) so the Week Recap endpoint
 * and the last-week recap strip share the SAME SQL. The idempotency contract:
 * re-granting for a week already recorded in last_qualified_week_start leaves
 * repeat_count unchanged — viewing the recap N times, or viewing the recap AND
 * the last-week strip, can never mint a second crown for one week.
 *
 * The SQL is exported as a constant so the double-grant regression test can
 * execute the EXACT statement against a real SQLite database — proving the
 * CASE semantics, not a mock's imitation of them.
 */
import type { Env } from '../env';

export const WEEKLY_CHAMPION_ACCOLADE_TYPE = 'weekly_step_champion';

/** Bind order: id, user_id, unlock_week_start, unlock_value, best_value,
 *  last_qualified_week_start, unlocked_at, updated_at.
 *
 *  W657 review fix — ORDER-PROOF: the count bumps ONLY when the incoming week
 *  is strictly NEWER than the stored one, and the stored week never moves
 *  backwards (MAX over ISO date strings == chronological). Two in-flight
 *  requests straddling the Sunday-midnight boundary (one stamped week A, one
 *  week B, committing in either order) therefore settle at exactly one crown
 *  per distinct championship week — a stale/replayed older week is a no-op
 *  instead of a phantom double-bump. */
export const WEEKLY_CHAMPION_UPSERT_SQL = `INSERT INTO user_accolades
   (id, user_id, accolade_type, unlock_week_start, unlock_value,
    best_value, repeat_count, last_qualified_week_start, unlocked_at, updated_at)
 VALUES (?, ?, '${WEEKLY_CHAMPION_ACCOLADE_TYPE}', ?, ?, ?, 1, ?, ?, ?)
 ON CONFLICT(user_id, accolade_type) DO UPDATE SET
   best_value   = MAX(user_accolades.best_value, excluded.best_value),
   repeat_count = CASE
     WHEN excluded.last_qualified_week_start > user_accolades.last_qualified_week_start
       THEN user_accolades.repeat_count + 1
       ELSE user_accolades.repeat_count
   END,
   last_qualified_week_start = MAX(user_accolades.last_qualified_week_start, excluded.last_qualified_week_start),
   updated_at = excluded.updated_at`;

/**
 * Credit the Step Crown for `weekKey` if the caller finished rank 1 with real
 * steps. Returns { count, isNew } for the client's title chip, or null when
 * the caller wasn't the champion. Idempotent per (user, week).
 */
export async function grantWeeklyChampionIfEarned(
  env: Env,
  userId: string,
  weekKey: string,
  myRank: number | null,
  mySteps: number | null,
): Promise<{ count: number; isNew: boolean } | null> {
  if (myRank !== 1 || !mySteps || mySteps <= 0) return null;

  const prior = await env.DB.prepare(
    `SELECT repeat_count, last_qualified_week_start FROM user_accolades
      WHERE user_id = ? AND accolade_type = '${WEEKLY_CHAMPION_ACCOLADE_TYPE}'`,
  ).bind(userId).first<{ repeat_count: number; last_qualified_week_start: string }>();
  const priorCount = prior && typeof prior.repeat_count === 'number' ? prior.repeat_count : 0;
  // Mirrors the SQL: only a strictly NEWER week counts as a new crown.
  const isNew = !prior || weekKey > prior.last_qualified_week_start;
  const nowMs = Date.now();
  await env.DB.prepare(WEEKLY_CHAMPION_UPSERT_SQL)
    .bind(crypto.randomUUID(), userId, weekKey, mySteps, mySteps, weekKey, nowMs, nowMs)
    .run();
  return { count: isNew ? priorCount + 1 : priorCount, isNew };
}
