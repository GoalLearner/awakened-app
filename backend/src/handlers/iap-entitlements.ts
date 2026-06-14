/**
 * iap-entitlements.ts — GET /v1/users/me/entitlements (auth required).
 *
 * Returns the caller's owned cosmetic skin ids. The client treats THIS as the
 * source of truth for skin ownership; its localStorage copy is a display-only
 * cache (same contract as user_accolades). Cosmetic only.
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk } from '../lib/responses';

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

  const skins = (rows.results ?? []).map((r) => r.skin_id);
  return jsonOk({ skins });
}
