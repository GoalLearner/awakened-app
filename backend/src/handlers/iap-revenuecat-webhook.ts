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
import { entitlementForProduct } from '../lib/skin-products';
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

  // W636 — decide grant eligibility UP FRONT so a single structured log line can
  // cover EVERY webhook, including the ignored/test events that were silent during
  // the auth-mismatch hunt. isGrantEvent = a purchase event carrying the ids we need.
  const isGrantEvent = GRANT_EVENT_TYPES.has(type) && !!appUserId && !!productId;
  // W618 — resolve to a skin id OR the reserved 'founder' entitlement id.
  const grantId = isGrantEvent ? entitlementForProduct(productId) : null;

  // W636 — ONE structured line per webhook, visible in `wrangler tail`. No PII:
  // app_user_id is truncated to an 8-char prefix. reason:
  //   'granted'         — known product on a purchase event → entitlement written
  //   'unknown_product' — purchase event, but the product id maps to nothing
  //   'ignored_event'   — non-purchase event (e.g. TEST/CANCELLATION), or a
  //                       purchase event missing app_user_id / product_id
  const reason = grantId ? 'granted' : isGrantEvent ? 'unknown_product' : 'ignored_event';
  console.log('[iap-webhook]', JSON.stringify({
    type,
    product: productId || null,
    granted: grantId,
    user: appUserId ? appUserId.slice(0, 8) : null,
    reason,
  }));

  // Only purchase events grant; everything else is acknowledged and ignored so
  // RevenueCat stops retrying (responses are byte-identical to pre-W636).
  if (!isGrantEvent) return jsonOk({ ok: true, granted: null, reason: 'ignored' });
  if (!grantId) return jsonOk({ ok: true, granted: null, reason: 'unknown_product' });

  try {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO skin_entitlements
         (user_id, skin_id, product_id, store, store_txn_id, source)
       VALUES (?, ?, ?, 'app_store', ?, 'revenuecat_webhook')`,
    )
      .bind(appUserId, grantId, productId, txnId)
      .run();
  } catch (e) {
    // W636 — surface a grant-write failure (was silent). Rethrow so the handler
    // 500s and RevenueCat RETRIES the delivery, rather than dropping the grant.
    console.error('[iap-webhook] grant insert failed', JSON.stringify({
      product: productId,
      granted: grantId,
      error: e instanceof Error ? e.message : String(e),
    }));
    throw e;
  }

  return jsonOk({ ok: true, granted: grantId });
}
