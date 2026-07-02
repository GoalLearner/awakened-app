/**
 * iap-revenuecat-webhook.ts — RevenueCat → backend purchase webhook.
 *
 * PUBLIC route (RevenueCat's servers call it, not the app), authenticated by a
 * shared secret: RevenueCat sends the exact `Authorization` header value you
 * configure in its dashboard, and we compare it to env.REVENUECAT_WEBHOOK_AUTH.
 * FAIL CLOSED — a missing/mismatched secret → 401, and an UNSET env secret
 * rejects everything (so a misconfigured deploy can't silently grant skins).
 *
 * On a purchase event for a known skin product we grant the entitlement
 * (INSERT OR IGNORE, keyed by the (user_id, skin_id) PK), where user_id is the
 * RevenueCat `app_user_id` — which the client sets to the backend userId when
 * it configures RevenueCat at sign-in. The grant is idempotent, so webhook
 * redelivery and restore-purchases replays are safe no-ops. Unknown products /
 * non-purchase events return 200 (acknowledged, no-op) so RevenueCat doesn't
 * retry forever.
 *
 * COSMETIC ONLY — these entitlements never affect stats, the Ascent, or rank.
 */
import type { Env } from '../env';
import { jsonOk, jsonError } from '../lib/responses';
import { skinForProduct } from '../lib/skin-products';
import { timingSafeEqual } from '../lib/timing-safe';

// Non-consumable skins arrive as one of these RevenueCat event types.
const GRANT_EVENT_TYPES = new Set(['INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE']);

export async function handleRevenueCatWebhook(request: Request, env: Env): Promise<Response> {
  // ── shared-secret auth (fail closed) ──
  const expected = env.REVENUECAT_WEBHOOK_AUTH;
  const provided = request.headers.get('Authorization');
  // W585 — constant-time compare (see lib/timing-safe). Fail closed on a
  // missing/unset secret before comparing.
  if (!expected || !provided || !timingSafeEqual(provided, expected)) {
    return jsonError(401, 'WEBHOOK_AUTH_FAILED', 'Invalid or missing webhook authorization.');
  }

  let body: { event?: Record<string, unknown> } | null = null;
  try {
    body = (await request.json()) as { event?: Record<string, unknown> };
  } catch (_) {
    return jsonError(400, 'BAD_JSON', 'Webhook body was not valid JSON.');
  }
  const ev = body && body.event;
  if (!ev || typeof ev !== 'object') {
    return jsonError(400, 'NO_EVENT', 'Webhook body had no event object.');
  }

  const type = String(ev.type ?? '');
  const appUserId = ev.app_user_id ? String(ev.app_user_id) : '';
  const productId = ev.product_id ? String(ev.product_id) : '';
  const txnId = ev.transaction_id
    ? String(ev.transaction_id)
    : ev.original_transaction_id
      ? String(ev.original_transaction_id)
      : null;

  // Only purchase events grant; everything else is acknowledged and ignored.
  if (!GRANT_EVENT_TYPES.has(type) || !appUserId || !productId) {
    return jsonOk({ ok: true, granted: null, reason: 'ignored' });
  }
  const skinId = skinForProduct(productId);
  if (!skinId) {
    return jsonOk({ ok: true, granted: null, reason: 'unknown_product' });
  }

  await env.DB.prepare(
    `INSERT OR IGNORE INTO skin_entitlements
       (user_id, skin_id, product_id, store, store_txn_id, source)
     VALUES (?, ?, ?, 'app_store', ?, 'revenuecat_webhook')`,
  )
    .bind(appUserId, skinId, productId, txnId)
    .run();

  return jsonOk({ ok: true, granted: skinId });
}
