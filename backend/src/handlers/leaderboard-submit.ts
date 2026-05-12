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

  return jsonOk({
    metric,
    current_value: row?.current_value ?? value,
    best_value: row?.best_value ?? value,
  });
}
