/**
 * auth-sign-out.ts — W1075: server-side sign-out.
 *
 * POST /v1/auth/sign-out  (authenticated)
 *
 * Until W1075 "sign out" only cleared the phone: the session JWT itself stayed valid for
 * its 90 days and could be refreshed for another 90, so a token copied off a device (or a
 * backup) kept working after the hunter had signed out. This bumps users.token_version;
 * every token minted before the bump carries a smaller `tv` claim and is refused by the
 * gate (session-jwt.ts sessionLiveness) and by /v1/auth/refresh. It is "sign out
 * everywhere" by design: one tap on one phone ends the session on every device.
 *
 * The device's push registrations go too — a push to a signed-out device would name the
 * wrong hunter. The client also unregisters its own token before calling this (W1040),
 * so the DELETE is a belt for the other devices.
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonError, jsonOk } from '../lib/responses';

export async function handleAuthSignOut(env: Env, session: SessionPayload): Promise<Response> {
  // The account-delete bucket (3/min): a sign-out is at most a tap or two.
  const rl = await env.RL_ACCOUNT_DELETE.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');

  const upd = await env.DB.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?')
    .bind(session.userId)
    .run();
  if (!(upd.meta && Number(upd.meta.changes) >= 1)) {
    return jsonError(401, 'SESSION_REVOKED', 'This account no longer exists.');
  }
  try {
    await env.DB.prepare('DELETE FROM device_tokens WHERE user_id = ?').bind(session.userId).run();
  } catch (err) {
    console.error('sign-out: device token purge failed', err instanceof Error ? err.message : err);
  }
  return jsonOk({ ok: true, signed_out: true });
}
