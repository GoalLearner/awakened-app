/**
 * iap-entitlements.ts — GET /v1/users/me/entitlements (auth required).
 *
 * Returns the caller's owned cosmetic skin ids + Founder status. The client
 * treats THIS as the source of truth for ownership; its localStorage copy is a
 * display-only cache (same contract as user_accolades). Cosmetic only.
 *
 * W618 — `founder` is true if the caller owns the Founder entitlement (bought
 * the one-time pack) OR is grandfathered (joined before the go-live cutoff — the
 * "all pre-launch users are Founders" grant). The reserved 'founder' entitlement
 * id is filtered OUT of `skins` so the client never renders it as an avatar.
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk } from '../lib/responses';
import { FOUNDER_ENTITLEMENT_ID } from '../lib/skin-products';

// Default grandfather cutoff (Unix ms) when FOUNDER_GRANDFATHER_BEFORE_MS is
// unset: everyone who joined before 2027-01-01 UTC — i.e. the entire 2026
// pre-monetization cohort — is a Founder. This errs toward GRANTING (per the
// owner's "all existing users must get Founder") so a forgotten env var can't
// paywall a returning user. Override at go-live with the exact launch timestamp
// so only genuinely-pre-launch accounts qualify; set to "0" to disable.
const DEFAULT_GRANDFATHER_BEFORE_MS = Date.UTC(2027, 0, 1);

/** Grandfather check: is this account older than the cutoff? Reads users.created_at
 *  (Unix ms). Only queried when the user has no explicit Founder entitlement. */
async function isGrandfatheredFounder(env: Env, userId: string): Promise<boolean> {
  const raw = env.FOUNDER_GRANDFATHER_BEFORE_MS;
  const cutoff = raw && /^\d+$/.test(raw) ? Number(raw) : DEFAULT_GRANDFATHER_BEFORE_MS;
  if (!(cutoff > 0)) return false; // "0" (or invalid non-numeric) disables grandfathering
  const row = await env.DB.prepare('SELECT created_at FROM users WHERE id = ? LIMIT 1')
    .bind(userId)
    .first<{ created_at: number }>();
  const created = row && Number(row.created_at);
  return !!(created && created < cutoff);
}

export async function handleEntitlementsGet(
  _request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT skin_id FROM skin_entitlements WHERE user_id = ? ORDER BY acquired_at ASC`,
  )
    .bind(session.userId)
    .all<{ skin_id: string }>();

  const owned = (rows.results ?? []).map((r) => r.skin_id);
  let founder = owned.includes(FOUNDER_ENTITLEMENT_ID);
  const skins = owned.filter((id) => id !== FOUNDER_ENTITLEMENT_ID);
  if (!founder) founder = await isGrandfatheredFounder(env, session.userId);

  return jsonOk({ skins, founder });
}
