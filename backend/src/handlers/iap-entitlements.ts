/**
 * iap-entitlements.ts — GET /v1/users/me/entitlements (auth required).
 *
 * Returns the caller's owned cosmetic skin ids + Founder status. The client
 * treats THIS as the source of truth for ownership; its localStorage copy is a
 * display-only cache (same contract as user_accolades). Cosmetic only.
 *
 * W618/W626 — `founder` is true if the caller owns the Founder entitlement
 * (bought the one-time pack) OR is grandfathered as one of the first N registered
 * accounts (the capped "First 100 Founders" launch promotion). The reserved
 * 'founder' entitlement id is filtered OUT of `skins` so the client never renders
 * it as an avatar.
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk } from '../lib/responses';
import { FOUNDER_ENTITLEMENT_ID } from '../lib/skin-products';

// W626 — capped "First N Founders" launch promotion. The first N accounts by
// registration order (users.created_at, id tie-break) are grandfathered as
// Founders. Default 100. Replaces the old time-cutoff, which would have given the
// paid Founder pack away for free to EVERY 2026 joiner — this caps the giveaway.
const DEFAULT_FIRST_N_FOUNDERS = 100;

/** First-N grandfather check: is this account among the first N registered?
 *  Rank = how many accounts registered strictly BEFORE this one (deterministic
 *  tie-break: same created_at → lower id ranks first). Founder iff rank < N.
 *  Derived at read-time — idempotent, no stored grant, can't double-count. Only
 *  queried when the user has no explicit (purchased) Founder entitlement. */
async function isFirstNFounder(env: Env, userId: string): Promise<boolean> {
  const raw = env.FOUNDER_FIRST_N;
  const n = raw && /^\d+$/.test(raw) ? Number(raw) : DEFAULT_FIRST_N_FOUNDERS;
  if (!(n > 0)) return false; // "0" (or invalid) disables the promo
  const me = await env.DB.prepare('SELECT created_at FROM users WHERE id = ? LIMIT 1')
    .bind(userId)
    .first<{ created_at: number }>();
  const created = me && Number(me.created_at);
  if (!(typeof created === 'number' && created >= 0)) return false;
  const rank = await env.DB.prepare(
    'SELECT COUNT(*) AS earlier FROM users WHERE created_at < ? OR (created_at = ? AND id < ?)',
  )
    .bind(created, created, userId)
    .first<{ earlier: number }>();
  const earlier = rank ? Number(rank.earlier) : Infinity;
  return earlier < n; // ranks 0 .. n-1 are the first N
}

/**
 * Read a user's owned entitlements from D1 (+ the first-N Founder promo).
 * Shared by GET /entitlements and the W637 reconcile endpoint so both return
 * the identical { skins, founder } shape. The reserved 'founder' id is filtered
 * out of `skins` and surfaced as the `founder` flag.
 */
export async function readEntitlements(
  env: Env,
  userId: string,
): Promise<{ skins: string[]; founder: boolean }> {
  const rows = await env.DB.prepare(
    `SELECT skin_id FROM skin_entitlements WHERE user_id = ? ORDER BY acquired_at ASC`,
  )
    .bind(userId)
    .all<{ skin_id: string }>();

  const owned = (rows.results ?? []).map((r) => r.skin_id);
  let founder = owned.includes(FOUNDER_ENTITLEMENT_ID);
  const skins = owned.filter((id) => id !== FOUNDER_ENTITLEMENT_ID);
  if (!founder) founder = await isFirstNFounder(env, userId);   // W626 — first-N promo
  return { skins, founder };
}

export async function handleEntitlementsGet(
  _request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  return jsonOk(await readEntitlements(env, session.userId));
}
