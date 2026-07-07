/**
 * APNs push sender (W603 — Push notifications v1).
 *
 * Sends a REMOTE Apple Push Notification so a recipient whose app is
 * CLOSED/backgrounded is told, at that moment, about a friend request,
 * a friend acceptance, a co-op invite, or a co-op join. Until now these
 * events were discoverable ONLY by the client's open-app pollers.
 *
 * Transport: token-based (provider JWT) APNs over HTTP/2 — Cloudflare
 * Workers' `fetch` speaks HTTP/2 to APNs. No new dependency: `jose` is
 * already in the tree (session JWTs) and implements the ES256 signing an
 * APNs provider token needs.
 *
 * Auth chain:
 *   provider JWT  = ES256(header{alg:ES256, kid:APNS_KEY_ID},
 *                          claims{iss:APPLE_TEAM_ID, iat:now})
 *                   signed with the .p8 private key (APNS_AUTH_KEY).
 *   The one .p8 key works for BOTH the production and sandbox hosts and
 *   does not expire yearly. The token is cached ~50 min (APNs wants it
 *   refreshed no more than every 20 min and no older than 60 min).
 *
 * Fail-safe: every export is wrapped so a push failure can NEVER throw
 * into the request path — a missing secret, a dead token, or an APNs
 * outage must not break sending a friend request. Dead tokens (410 /
 * BadDeviceToken) are pruned so device_tokens self-heals.
 *
 * Config (secrets, set via `wrangler secret put`):
 *   APNS_AUTH_KEY  — the .p8 file contents (PEM PKCS8).
 *   APNS_KEY_ID    — the 10-char Key ID of that .p8 key.
 *   APPLE_TEAM_ID  — already stored (reused as the JWT `iss`).
 *   APPLE_BUNDLE_ID— already stored (reused as the `apns-topic`).
 */
import { SignJWT, importPKCS8 } from 'jose';
import type { Env } from '../env';

const PROD_HOST = 'https://api.push.apple.com';
const SANDBOX_HOST = 'https://api.sandbox.push.apple.com';

/** A push to deliver. `type` (+ optional data) rides in the payload so the
 *  client tap handler can deep-link (friend_request → Guild tab, coop_invite
 *  → the hunt sheet, etc.). */
export interface PushNotif {
  title: string;
  body: string;
  type: string;
  data?: Record<string, string>;
}

interface DeviceTokenRow {
  token: string;
  environment: string | null;
  bundle_id: string | null;
}

// Module-scoped provider-JWT cache. Workers isolates are short-lived, so this
// is a best-effort warm cache — correctness never depends on it.
let _jwtCache: { token: string; expMs: number } | null = null;

/** True only when both push secrets are present — lets callers no-op cleanly
 *  on a deploy that hasn't had the APNs key set yet. */
export function pushConfigured(env: Env): boolean {
  return !!(env.APNS_AUTH_KEY && env.APNS_KEY_ID && env.APPLE_TEAM_ID && env.APPLE_BUNDLE_ID);
}

async function getProviderJwt(env: Env): Promise<string> {
  // Callers reach here only via notifyUser after pushConfigured() — this guard
  // both narrows the optional secrets for TS and fails safe if called directly.
  if (!env.APNS_AUTH_KEY || !env.APNS_KEY_ID) {
    throw new Error('APNs not configured (APNS_AUTH_KEY / APNS_KEY_ID unset).');
  }
  const now = Date.now();
  if (_jwtCache && _jwtCache.expMs > now) return _jwtCache.token;
  // Secrets may arrive with escaped "\n" if pasted as a single line — normalize
  // back to a real PEM so importPKCS8 accepts it.
  const pem = env.APNS_AUTH_KEY.includes('\\n')
    ? env.APNS_AUTH_KEY.replace(/\\n/g, '\n')
    : env.APNS_AUTH_KEY;
  const key = await importPKCS8(pem, 'ES256');
  const token = await new SignJWT({ iss: env.APPLE_TEAM_ID })
    .setProtectedHeader({ alg: 'ES256', kid: env.APNS_KEY_ID })
    .setIssuedAt()
    .sign(key);
  _jwtCache = { token, expMs: now + 50 * 60 * 1000 }; // 50 min
  return token;
}

/** Send one push to one token. Returns { prune } so the caller can drop a
 *  token APNs reports as gone. Never throws. */
async function sendOne(
  jwt: string,
  host: string,
  token: string,
  topic: string,
  notif: PushNotif,
): Promise<{ ok: boolean; prune: boolean }> {
  try {
    const payload: Record<string, unknown> = {
      aps: {
        alert: { title: notif.title, body: notif.body },
        sound: 'default',
      },
      type: notif.type,
      ...(notif.data || {}),
    };
    const res = await fetch(`${host}/3/device/${token}`, {
      method: 'POST',
      headers: {
        authorization: `bearer ${jwt}`,
        'apns-topic': topic,
        'apns-push-type': 'alert',
        'apns-priority': '10',
      },
      body: JSON.stringify(payload),
    });
    if (res.status === 200) return { ok: true, prune: false };
    // 410 Unregistered = token permanently dead. 400 BadDeviceToken = wrong
    // host/env or malformed → also prune (a re-register will re-add the good one).
    let reason = '';
    try {
      const j = (await res.json()) as { reason?: string };
      reason = j?.reason || '';
    } catch {
      /* body not JSON */
    }
    // W613 — keep ONE minimal failure log (no token/secrets). The 2-day push
    // hunt happened partly because the send path was silent; a status+reason
    // line surfaces a bad key/topic/env without redeploying diagnostics.
    console.log('[APNS] send failed', { status: res.status, reason });
    const prune = res.status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered';
    return { ok: false, prune };
  } catch {
    return { ok: false, prune: false }; // transient (network) — keep the token
  }
}

/**
 * Fan out a push to EVERY device the recipient has registered. Call via
 * `ctx.waitUntil(notifyUser(env, userId, notif))` — fire-and-forget, so it
 * never adds latency to (or can fail) the triggering request.
 */
export async function notifyUser(env: Env, userId: string, notif: PushNotif): Promise<void> {
  try {
    if (!pushConfigured(env) || !userId) return;
    const rows = await env.DB.prepare(
      'SELECT token, environment, bundle_id FROM device_tokens WHERE user_id = ?',
    )
      .bind(userId)
      .all<DeviceTokenRow>();
    const tokens = rows.results || [];
    if (!tokens.length) return;

    const jwt = await getProviderJwt(env);
    for (const t of tokens) {
      const host = t.environment === 'sandbox' ? SANDBOX_HOST : PROD_HOST;
      const topic = t.bundle_id || env.APPLE_BUNDLE_ID;
      const { prune } = await sendOne(jwt, host, t.token, topic, notif);
      if (prune) {
        try {
          await env.DB.prepare('DELETE FROM device_tokens WHERE token = ?').bind(t.token).run();
        } catch {
          /* prune best-effort */
        }
      }
    }
  } catch {
    /* push must never break the triggering request */
  }
}
