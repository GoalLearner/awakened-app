/**
 * POST /v1/users/me/app-open — record that the caller opened the app today.
 *
 * Per-user retention tracking (owner-requested; see migration 0027_app_opens).
 * Append-light: a single UPSERT of one row per (user, UTC day), so repeated
 * foregrounds the same day touch the same row. Fire-and-forget on the client —
 * NO reads on the hot path, returns 200 immediately, idempotent.
 *
 * Auth: required. user_id is ALWAYS the verified session `sub`; clients cannot
 * specify or override it (date_utc is derived server-side from the Worker clock,
 * not from the request body, so the table can't be back/forward-dated by a client).
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk } from '../lib/responses';

export async function handleAppOpenPost(
  _request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  // Cheap throttle. The day's row already exists after the first call, so
  // dropping bursts is correct — and we return 200 either way (this is a
  // fire-and-forget lifecycle ping; the client ignores the body, and we never
  // want a metrics write to surface an error to the app).
  const rl = await env.RL_APP_OPEN.limit({ key: session.userId });
  if (!rl.success) {
    return jsonOk({ ok: true, deduped: true });
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const dateUtc = new Date(nowSec * 1000).toISOString().slice(0, 10); // 'YYYY-MM-DD' (UTC)

  await env.DB.prepare(
    `INSERT INTO app_opens (user_id, opened_at, date_utc)
       VALUES (?, ?, ?)
     ON CONFLICT(user_id, date_utc) DO UPDATE SET opened_at = excluded.opened_at`,
  )
    .bind(session.userId, nowSec, dateUtc)
    .run();

  return jsonOk({ ok: true, date_utc: dateUtc });
}
