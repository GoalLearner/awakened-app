/**
 * iap-reconcile.ts — POST /v1/users/me/entitlements/reconcile (auth required).
 *
 * SELF-HEALING grant path (W637). The RevenueCat webhook is best-effort: a
 * delivery can be lost (a bad/rotated auth secret, an RC outage, a network
 * blip) — and once lost it is NOT re-sent by a re-purchase, because Apple
 * treats a non-consumable as already-owned and RevenueCat won't re-fire an
 * event it already emitted. That left a paying customer permanently stuck with
 * no recovery. This endpoint closes the gap: it reads the AUTHORITATIVE list of
 * the caller's purchases straight from RevenueCat's REST API
 * (GET /v1/subscribers/{app_user_id}) and grants any that are missing locally.
 *
 * Pairs with the client's restore-on-already-owned flow (auth.js purchaseSkin):
 * a restore pushes Apple's receipt to RevenueCat so RC learns about a purchase
 * it never captured, and THEN this reconcile grants it.
 *
 * SECURITY: app_user_id === the caller's own backend userId (from the session
 * JWT), and RevenueCat only returns THAT subscriber's real purchases — a client
 * cannot grant itself a skin it did not actually buy. Uses the PUBLIC RevenueCat
 * SDK key (the GET /subscribers endpoint accepts it), so no secret key is
 * required. Idempotent (INSERT OR IGNORE). Cosmetic only — never power.
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk, jsonError } from '../lib/responses';
import { entitlementForProduct, isPremiumProduct } from '../lib/skin-products';
import { readEntitlements } from './iap-entitlements';

// RevenueCat PUBLIC SDK key — the SAME value the client uses (auth.js
// REVENUECAT_PUBLIC_SDK_KEY). Public by design (safe in the repo; the SECRET
// key never appears here). Verified: the v1 REST GET /subscribers endpoint
// accepts this key from a server (HTTP 200), so a read-only reconcile needs no
// secret. Overridable via the REVENUECAT_PUBLIC_KEY var without a code change.
const RC_PUBLIC_KEY_FALLBACK = 'appl_phiMKPUJwIaixRkGliIxAfwOQVF';

interface RcNonSubRecord {
  store_transaction_id?: string;
  id?: string;
}
interface RcSubscriptionRecord {
  expires_date?: string | null;               // ISO-8601 paid-through, RC REST shape
  grace_period_expires_date?: string | null;  // W652 — billing-grace horizon when Apple grants one
}
interface RcSubscriberResponse {
  subscriber?: {
    non_subscriptions?: Record<string, RcNonSubRecord[]>;
    subscriptions?: Record<string, RcSubscriptionRecord>;
  };
}

export async function handleEntitlementsReconcile(
  _request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const userId = session.userId;

  // Reconcile makes an EXTERNAL RevenueCat REST call, so bound it per user
  // (a dedicated bucket — never share, so a reconcile can't 429 off another
  // endpoint's budget or vice-versa). Fail OPEN if the limiter is unavailable:
  // never block a legitimate grant on the limiter itself.
  try {
    const rl = await env.RL_IAP_RECONCILE.limit({ key: userId });
    if (!rl.success) {
      return jsonError(429, 'RATE_LIMITED', 'Too many reconcile requests; try again shortly.');
    }
  } catch (_) {
    /* limiter unavailable → proceed */
  }

  const key = env.REVENUECAT_PUBLIC_KEY || RC_PUBLIC_KEY_FALLBACK;
  let seen = 0;
  let granted = 0;
  let refused = 0;
  let premiumSwept = 0;   // W650 — latest premium horizon adopted from RC (0 = none)

  try {
    const res = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`,
      {
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        // Bound the external call so a slow/hung RC subrequest can't hold the
        // client's await; a timeout aborts → throws → the catch below fails soft.
        signal: AbortSignal.timeout(8000),
      },
    );
    if (res.ok) {
      const data = (await res.json()) as RcSubscriberResponse;
      const nonSubs = (data && data.subscriber && data.subscriber.non_subscriptions) || {};
      const productIds = Object.keys(nonSubs);
      seen = productIds.length;
      for (const pid of productIds) {
        const grantId = entitlementForProduct(pid);
        if (!grantId) continue; // unknown product — ignore (e.g. a test SKU)
        const recs = Array.isArray(nonSubs[pid]) ? nonSubs[pid] : [];
        const last = recs.length ? recs[recs.length - 1] : null;
        const txn = last && (last.store_transaction_id || last.id)
          ? String(last.store_transaction_id || last.id)
          : null;
        // W637.1 — ANTI-FARMING: an Apple transaction may back a grant on only ONE
        // account. A restore can TRANSFER a receipt onto a second (free) backend
        // account's RevenueCat subscriber; without this guard, reconcile would grant
        // that single purchase to unlimited accounts (any owned skin).
        // If this transaction is already claimed by a DIFFERENT user, refuse it.
        // (The webhook path needs no such guard — it only grants on
        // INITIAL/NON_RENEWING_PURCHASE, never on a TRANSFER — so the exposure is
        // unique to reconcile, which reads whatever is on the caller's subscriber.)
        if (txn) {
          const claimed = await env.DB.prepare(
            `SELECT user_id FROM skin_entitlements WHERE store_txn_id = ? AND user_id <> ? LIMIT 1`,
          )
            .bind(txn, userId)
            .first<{ user_id: string }>();
          if (claimed) {
            refused += 1;
            console.warn(
              '[iap-reconcile] txn already claimed by another user — refusing',
              JSON.stringify({ user: userId.slice(0, 8), claimant: String(claimed.user_id).slice(0, 8), product: pid }),
            );
            continue;
          }
        }
        const r = await env.DB.prepare(
          `INSERT OR IGNORE INTO skin_entitlements
             (user_id, skin_id, product_id, store, store_txn_id, source)
           VALUES (?, ?, ?, 'app_store', ?, 'revenuecat_reconcile')`,
        )
          .bind(userId, grantId, pid, txn)
          .run();
        if (r.meta && r.meta.changes) granted += r.meta.changes; // 1 if newly inserted, 0 if already owned
      }
      // W650/W652 — the self-heal path for the PREMIUM membership. RC's REST
      // record is the CURRENT truth at fetch time, so adopt it exactly (the
      // horizon may move in either direction — forward for a missed renewal,
      // BACKWARD for a refund the webhook never delivered). Ordered against
      // webhook writes via last_event_ms = now. Grace-period horizons count
      // (grace_period_expires_date > expires_date while Apple retries billing).
      // Sharing-via-restore stays bounded by expiry — no per-txn guard needed.
      const subs = (data && data.subscriber && data.subscriber.subscriptions) || {};
      for (const pid of Object.keys(subs)) {
        if (!isPremiumProduct(pid)) continue;
        const rec = subs[pid] || {};
        const expMs = rec.expires_date ? Date.parse(String(rec.expires_date)) : NaN;
        const graceMs = rec.grace_period_expires_date ? Date.parse(String(rec.grace_period_expires_date)) : NaN;
        const horizon = Math.max(
          Number.isFinite(expMs) ? expMs : 0,
          Number.isFinite(graceMs) ? graceMs : 0,
        );
        if (!(horizon > 0)) continue;
        await env.DB.prepare(
          `INSERT INTO premium_subscriptions (user_id, product_id, expires_at_ms, last_event_ms, updated_at)
           VALUES (?, ?, ?, ?, datetime('now'))
           ON CONFLICT(user_id) DO UPDATE SET
             product_id    = excluded.product_id,
             expires_at_ms = excluded.expires_at_ms,
             last_event_ms = excluded.last_event_ms,
             updated_at    = excluded.updated_at
           WHERE excluded.last_event_ms > premium_subscriptions.last_event_ms`,
        )
          .bind(userId, pid, horizon, Date.now())
          .run();
        premiumSwept = Math.max(premiumSwept, horizon);
      }
    } else {
      // RC unreachable/error → don't fail the client; fall through and return
      // whatever is already granted locally so the UI still gets the user's skins.
      console.error(
        '[iap-reconcile] RC non-200',
        JSON.stringify({ status: res.status, user: userId.slice(0, 8) }),
      );
    }
  } catch (e) {
    console.error(
      '[iap-reconcile] RC fetch failed',
      JSON.stringify({ user: userId.slice(0, 8), error: e instanceof Error ? e.message : String(e) }),
    );
    /* fall through — return current D1 entitlements */
  }

  // One structured line per reconcile (mirrors the [iap-webhook] observability).
  console.log('[iap-reconcile]', JSON.stringify({ user: userId.slice(0, 8), seen, granted, refused, premiumUntil: premiumSwept || null }));

  const ent = await readEntitlements(env, userId);
  return jsonOk({ ok: true, reconciled: granted, ...ent });
}
