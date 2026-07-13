/**
 * iap-entitlements.ts — GET /v1/users/me/entitlements (auth required).
 *
 * Returns the caller's owned cosmetic skin ids + membership status. The client
 * treats THIS as the source of truth; its localStorage copy is a display-only
 * cache (same contract as user_accolades).
 *
 * W655 — the paid "Founder" tier (one-time pack + first-N grandfather promo)
 * was removed entirely; the Awakened Premium subscription is now the only paid
 * tier. `premium` is DERIVED at read time as (premium_subscriptions.expires_at_ms
 * > now): a lapsed subscription revokes itself with no revocation machinery.
 * `member` == `premium` — the one flag every membership perk (co-op fees/cap,
 * Ascent lives) gates on. (`member` is kept as a distinct field so client
 * gating code and any future non-subscription membership source need not change.)
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk } from '../lib/responses';
import { getFounderSeq } from '../lib/founder-mark';

/**
 * Read a user's owned entitlements from D1. Shared by GET /entitlements and the
 * W637 reconcile endpoint so both return the identical { skins, premium, member }
 * shape.
 */
export async function readEntitlements(
  env: Env,
  userId: string,
): Promise<{ skins: string[]; premium: boolean; member: boolean; founder_seq: number | null }> {
  const rows = await env.DB.prepare(
    `SELECT skin_id FROM skin_entitlements WHERE user_id = ? ORDER BY acquired_at ASC`,
  )
    .bind(userId)
    .all<{ skin_id: string }>();

  const skins = (rows.results ?? []).map((r) => r.skin_id);

  // W650/W655 — active premium subscription (paid-through horizon in the future).
  let premium = false;
  try {
    const sub = await env.DB.prepare(
      'SELECT expires_at_ms FROM premium_subscriptions WHERE user_id = ? LIMIT 1',
    )
      .bind(userId)
      .first<{ expires_at_ms: number }>();
    premium = !!sub && Number(sub.expires_at_ms) > Date.now();
  } catch (e) {
    // W652 — swallow ONLY the missing-table case (migration 0030 not applied
    // yet on this environment). Any OTHER D1 error must propagate as a 500:
    // a swallowed transient error would return premium=false on a clean 200,
    // wrongly capping a paying subscriber AND poisoning the client's member
    // cache for the whole session (a 500 leaves the client's cache untouched).
    const msg = String((e && (e as Error).message) || e);
    if (!/no such table/i.test(msg)) throw e;
  }

  // W656 — the caller's free Founder marker number (prestige only; null = none).
  const founder_seq = await getFounderSeq(env, userId);

  return { skins, premium, member: premium, founder_seq };
}

export async function handleEntitlementsGet(
  _request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  return jsonOk(await readEntitlements(env, session.userId));
}
