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
// W644 — the promo window CLOSED at monetization go-live (2026-07-09T00:00:00Z).
// Grandfathering exists to thank accounts that were ALREADY here before the
// Founder pack was purchasable; without this cutoff every post-launch signup
// (including App Review's fresh test accounts — the 2.1(b) rejection: "Founder's
// Lifetime was already purchased when we made a new account") kept getting
// auto-Founder'd until account #100, which also made the pack unpurchasable
// for exactly the reviewers who needed to test buying it.
const FOUNDER_PROMO_CUTOFF_MS = 1783555200000; // 2026-07-09T00:00:00Z (users.created_at is epoch-ms)

/** First-N grandfather check: is this account among the first N registered
 *  AND registered before the promo closed (go-live)?
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
  if (created >= FOUNDER_PROMO_CUTOFF_MS) return false; // W644 — joined after go-live: not grandfathered
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
 * the identical shape. The reserved 'founder' id is filtered out of `skins`
 * and surfaced as the `founder` flag.
 *
 * W650 — `premium` is the auto-renewable membership, DERIVED at read time as
 * (premium_subscriptions.expires_at_ms > now): a lapsed subscription revokes
 * itself with no revocation machinery. `member` = founder OR premium — the ONE
 * flag every membership perk (co-op fees/cap, Ascent lives) gates on; Founder
 * is simply the lifetime tier of the same membership.
 */
export async function readEntitlements(
  env: Env,
  userId: string,
): Promise<{ skins: string[]; founder: boolean; premium: boolean; member: boolean }> {
  const rows = await env.DB.prepare(
    `SELECT skin_id FROM skin_entitlements WHERE user_id = ? ORDER BY acquired_at ASC`,
  )
    .bind(userId)
    .all<{ skin_id: string }>();

  const owned = (rows.results ?? []).map((r) => r.skin_id);
  let founder = owned.includes(FOUNDER_ENTITLEMENT_ID);
  const skins = owned.filter((id) => id !== FOUNDER_ENTITLEMENT_ID);
  if (!founder) founder = await isFirstNFounder(env, userId);   // W626 — first-N promo

  // W650 — active premium subscription (paid-through horizon in the future).
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

  return { skins, founder, premium, member: founder || premium };
}

export async function handleEntitlementsGet(
  _request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  return jsonOk(await readEntitlements(env, session.userId));
}
