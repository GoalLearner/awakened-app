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
