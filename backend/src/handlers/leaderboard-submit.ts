/**
 * POST /v1/leaderboard/submit
 *
 * Authenticated endpoint. Upserts the calling user's snapshot for
 * a single metric:
 *
 *   - current_value is overwritten with the new value (this is the
 *     user's latest measurement)
 *   - best_value is MAX(existing_best, new_current) — best is sticky
 *     and never decreases. Powers "personal record" surfaces in client.
 *
 * Body: { metric, current_value }
 * Response: { current_value, best_value } reflecting actual DB state
 *
 * BACKEND.md §8.
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk, jsonError } from '../lib/responses';
import { isValidMetric, METRIC_CAPS, type Metric } from '../lib/metrics';
import { getAccoladeWeekStart } from '../lib/accolade-week';

// v3 Phase 1z.27 -- 100K Step Club accolade. Awarded inline during
// leaderboard submit when `metric === 'step_total'` and the submitted
// value crosses 100,000 in the current Sunday-UTC week. Type kept
// generic so future accolade types ('sleep_perfect_month', etc.) can
// be awarded from their own write paths without schema changes.
const STEP_100K_THRESHOLD = 100000;
const STEP_100K_ACCOLADE_TYPE = 'step_100k_club';
// Sim test users (sims/scripts seed worker) must not earn real
// accolades. Their apple_sub values are 'sim_test_alpha' /
// 'sim_test_bravo' (see backend/scripts/seed-sim-users.ts).
const SIM_APPLE_SUB_PREFIX = 'sim_test_';

interface SubmitBody {
  metric?: unknown;
  current_value?: unknown;
}

interface SnapshotRow {
  current_value: number;
  best_value: number;
}

export async function handleLeaderboardSubmit(
  request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_LEADERBOARD_SUBMIT.limit({ key: session.userId });
  if (!rl.success) {
    return jsonError(
      429,
      'RATE_LIMITED',
      'Too many leaderboard submissions. Try again in a minute.',
    );
  }

  let body: SubmitBody;
  try {
    body = (await request.json()) as SubmitBody;
  } catch {
    return jsonError(400, 'INVALID_BODY', 'Request body must be valid JSON.');
  }
  if (!body || typeof body !== 'object') {
    return jsonError(400, 'INVALID_BODY', 'Request body must be a JSON object.');
  }

  if (!isValidMetric(body.metric)) {
    return jsonError(
      400,
      'INVALID_METRIC',
      'metric must be one of: step_total, sleep_streak, bedtime_streak.',
    );
  }
  const metric: Metric = body.metric;

  const rawValue = body.current_value;
  if (!Number.isInteger(rawValue) || (rawValue as number) < 0) {
    return jsonError(400, 'INVALID_VALUE', 'current_value must be a non-negative integer.');
  }
  const value = rawValue as number;
  if (value > METRIC_CAPS[metric]) {
    return jsonError(
      400,
      'INVALID_VALUE',
      `current_value exceeds sanity cap (${METRIC_CAPS[metric]}) for metric ${metric}.`,
    );
  }

  const now = Date.now();

  // UPSERT with MAX preservation on best_value. SQLite (D1) supports
  // ON CONFLICT...DO UPDATE syntax. excluded.<col> refers to the values
  // we tried to insert.
  await env.DB.prepare(
    `INSERT INTO leaderboard_snapshots (user_id, metric, current_value, best_value, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, metric) DO UPDATE SET
       current_value = excluded.current_value,
       best_value = MAX(leaderboard_snapshots.best_value, excluded.current_value),
       updated_at = excluded.updated_at`,
  )
    .bind(session.userId, metric, value, value, now)
    .run();

  // Read back the row to return DB-authoritative values. Cheap (PK
  // lookup, single row). Caller's client may have outdated state.
  const row = await env.DB.prepare(
    'SELECT current_value, best_value FROM leaderboard_snapshots WHERE user_id = ? AND metric = ?',
  )
    .bind(session.userId, metric)
    .first<SnapshotRow>();

  // v3 Phase 1z.27 -- 100K Step Club accolade award (inline).
  // Runs ONLY when:
  //   - metric is step_total
  //   - submitted value >= 100,000 (sanity cap already applied above)
  //   - the user is NOT a sim test user
  // Same-week resubmits at higher value bump best_value via MAX but
  // do NOT increment repeat_count (CASE on last_qualified_week_start).
  // Cross-week qualifying submits increment repeat_count.
  if (metric === 'step_total' && value >= STEP_100K_THRESHOLD) {
    const userRow = await env.DB.prepare(
      'SELECT apple_sub FROM users WHERE id = ?',
    ).bind(session.userId).first<{ apple_sub: string }>();
    const isSimUser = !!userRow?.apple_sub && userRow.apple_sub.startsWith(SIM_APPLE_SUB_PREFIX);
    if (!isSimUser) {
      const weekStart = getAccoladeWeekStart(now);
      const accoladeId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO user_accolades
           (id, user_id, accolade_type, unlock_week_start, unlock_value,
            best_value, repeat_count, last_qualified_week_start, unlocked_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
         ON CONFLICT(user_id, accolade_type) DO UPDATE SET
           best_value   = MAX(user_accolades.best_value, excluded.best_value),
           repeat_count = CASE
             WHEN user_accolades.last_qualified_week_start = excluded.last_qualified_week_start
               THEN user_accolades.repeat_count
               ELSE user_accolades.repeat_count + 1
           END,
           last_qualified_week_start = excluded.last_qualified_week_start,
           updated_at = excluded.updated_at`,
      )
        .bind(
          accoladeId,
          session.userId,
          STEP_100K_ACCOLADE_TYPE,
          weekStart,        // unlock_week_start (only used on INSERT)
          value,            // unlock_value      (only used on INSERT)
          value,            // best_value        (INSERT + MAX UPDATE candidate)
          weekStart,        // last_qualified_week_start
          now,              // unlocked_at       (only used on INSERT)
          now,              // updated_at
        )
        .run();
    }
  }

  return jsonOk({
    metric,
    current_value: row?.current_value ?? value,
    best_value: row?.best_value ?? value,
  });
}
