/**
 * Device-token registration (W603 — Push notifications v1).
 *
 *   POST   /v1/users/me/device-token   — upsert this device's APNs token
 *   DELETE /v1/users/me/device-token   — unregister (on sign-out)
 *
 * Auth required. The recipient key is always the verified session's
 * user_id — clients never pass a user_id. The token is the APNs device
 * token the client obtains from the PushNotifications 'registration'
 * event; it upserts on the token PRIMARY KEY so re-registering the same
 * device (rotated token, reinstall, or a different hunter on the same
 * phone) just re-points it.
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk, jsonError } from '../lib/responses';

// APNs device tokens are hex strings (32 bytes = 64 chars historically; allow a
// generous band for future formats). Reject anything else outright.
const TOKEN_RE = /^[0-9a-fA-F]{32,200}$/;

export async function handleDeviceTokenRegister(
  request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_PUSH_WRITE.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');

  let body: { token?: unknown; platform?: unknown; environment?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError(400, 'INVALID_BODY', 'Request body must be valid JSON.');
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!TOKEN_RE.test(token)) {
    return jsonError(400, 'BAD_TOKEN', 'A valid APNs device token is required.');
  }
  const platform = body.platform === 'ios' ? 'ios' : 'ios'; // only APNs today
  const environment = body.environment === 'sandbox' ? 'sandbox' : 'production';

  // Upsert on the token PK: a device that re-registers (or moves to a new
  // hunter) re-points to the current session.userId + environment.
  await env.DB.prepare(
    `INSERT INTO device_tokens (token, user_id, platform, environment, bundle_id)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(token) DO UPDATE SET
       user_id = excluded.user_id,
       platform = excluded.platform,
       environment = excluded.environment,
       bundle_id = excluded.bundle_id,
       updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(token, session.userId, platform, environment, env.APPLE_BUNDLE_ID)
    .run();

  // W690 — lazy per-user pruning at the only write point (scale-audit: dead
  // tokens accumulated forever — iOS rotates APNs tokens on restore/reinstall,
  // and the APNs-410 prune only fires when a send actually targets the row).
  // Registration happens on every cold launch, so active devices constantly
  // refresh updated_at; anything a user hasn't refreshed in 60 days is a
  // rotated corpse. The count cap (newest 8) bounds pathological rotation
  // between sends. Both DELETEs ride idx_device_tokens_user; best-effort —
  // a prune failure must never fail the registration.
  try {
    await env.DB.prepare(
      `DELETE FROM device_tokens
        WHERE user_id = ?1 AND updated_at < datetime('now', '-60 days')`,
    ).bind(session.userId).run();
    await env.DB.prepare(
      `DELETE FROM device_tokens
        WHERE user_id = ?1 AND token NOT IN (
          SELECT token FROM device_tokens WHERE user_id = ?1
           ORDER BY updated_at DESC, token DESC LIMIT 8)`,
    ).bind(session.userId).run();
  } catch (e) {
    console.warn('[push] token prune failed (non-fatal)', String(e instanceof Error ? e.message : e));
  }

  return jsonOk({ ok: true });
}

export async function handleDeviceTokenUnregister(
  request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_PUSH_WRITE.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');

  let body: { token?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError(400, 'INVALID_BODY', 'Request body must be valid JSON.');
  }
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!TOKEN_RE.test(token)) {
    return jsonError(400, 'BAD_TOKEN', 'A valid APNs device token is required.');
  }
  // Scope the delete to the caller so one user can't unregister another's device.
  await env.DB.prepare('DELETE FROM device_tokens WHERE token = ? AND user_id = ?')
    .bind(token, session.userId)
    .run();
  return jsonOk({ ok: true });
}
