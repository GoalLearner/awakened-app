/**
 * invites.ts — W842 (Train 4, G1) universal-link invite loop.
 *
 * The share cards were beautiful and structurally mute: every URL was the
 * bare App Store link — no token, no attribution, no reward, K-factor ≈ 0.
 * This module is the server side of the fix:
 *
 *   GET  /v1/users/me/invite-code        → get-or-create the caller's stable
 *                                          code + the shareable /i/ URL
 *   POST /v1/invites/redeem {code}       → once-ever per redeemer: records
 *                                          attribution, opens a pending
 *                                          friendship (redeemer → inviter,
 *                                          reusing the existing accept flow +
 *                                          push), returns the redeemer's
 *                                          souls grant
 *   POST /v1/users/me/invite-rewards/claim → inviter collects pending +souls
 *                                          (guarded 0→1 flip = exactly once)
 *
 *   GET  /.well-known/apple-app-site-association  (public, index.ts routes
 *        here) → the AASA document that makes iOS open /i/* links in-app
 *   GET  /i/<code>  (public) → 302 to the App Store — the browser fallback
 *        for recipients WITHOUT the app; installed devices never hit this
 *        (iOS intercepts the universal link before any request is made).
 *
 * Souls model: the backend owns THAT a reward happened (this table); the
 * client owns paying it out locally — the same split as coop_boss_awards.
 * INVITE_SOULS is 50/50 (owner to confirm; single constant to change).
 *
 * Anti-farm posture: one redemption per redeemer EVER (PK), self-redeem
 * blocked, and the redeemer must be a young account (created within
 * REDEEM_WINDOW_DAYS) — established hunters swapping codes get a friendly
 * refusal, not souls.
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk, jsonError } from '../lib/responses';
import { notifyUser } from '../lib/apns';

export const INVITE_SOULS = 50; // both sides; owner-confirmable knob
const REDEEM_WINDOW_DAYS = 14;
// Unambiguous alphabet — no 0/o/1/l/i. 8 chars ≈ 1.1e12 combinations.
const CODE_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
const CODE_LEN = 8;
const CODE_RE = /^[23456789abcdefghjkmnpqrstuvwxyz]{6,12}$/;

export const APP_STORE_URL = 'https://apps.apple.com/app/id6764727990';
// The universal-link host is the Worker itself (workers.dev serves valid
// HTTPS; a custom domain can replace this later — the AASA + links move
// together, keyed off this one constant).
export const INVITE_LINK_BASE = 'https://awakened-backend.richmondcampano93.workers.dev/i/';

function randomCode(): string {
  const bytes = new Uint8Array(CODE_LEN);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < CODE_LEN; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

/** GET /v1/users/me/invite-code — stable per-user code, created on first ask. */
export async function handleInviteCodeGet(
  _request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_FRIENDS_READ.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');

  const existing = await env.DB.prepare('SELECT code FROM invite_codes WHERE user_id = ?')
    .bind(session.userId)
    .first<{ code: string }>();
  if (existing) {
    return jsonOk({ ok: true, code: existing.code, url: INVITE_LINK_BASE + existing.code });
  }
  // Create — retry on the (astronomically rare) UNIQUE collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    try {
      const ins = await env.DB.prepare(
        'INSERT OR IGNORE INTO invite_codes (user_id, code, created_at) VALUES (?, ?, ?)',
      )
        .bind(session.userId, code, Date.now())
        .run();
      if (ins.meta && Number(ins.meta.changes) >= 1) {
        return jsonOk({ ok: true, code, url: INVITE_LINK_BASE + code });
      }
      // changes=0: either OUR row landed via a concurrent request, or the
      // code collided with another user's. Re-read to find out.
      const mine = await env.DB.prepare('SELECT code FROM invite_codes WHERE user_id = ?')
        .bind(session.userId)
        .first<{ code: string }>();
      if (mine) return jsonOk({ ok: true, code: mine.code, url: INVITE_LINK_BASE + mine.code });
    } catch {
      /* retry with a fresh code */
    }
  }
  return jsonError(500, 'CODE_GEN_FAILED', 'Could not mint an invite code. Try again.');
}

/** POST /v1/invites/redeem — body { code }. Once-ever per redeemer. */
export async function handleInviteRedeem(
  request: Request,
  env: Env,
  session: SessionPayload,
  ctx?: ExecutionContext,
): Promise<Response> {
  const rl = await env.RL_FRIENDS_WRITE.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonError(400, 'INVALID_BODY', 'Request body must be valid JSON.');
  }
  const code = String(body?.code ?? '').trim().toLowerCase();
  if (!CODE_RE.test(code)) return jsonError(400, 'INVALID_CODE', 'That invite code is not valid.');

  const inviter = await env.DB.prepare(
    `SELECT ic.user_id AS id, u.alias AS alias FROM invite_codes ic
       JOIN users u ON u.id = ic.user_id WHERE ic.code = ?`,
  )
    .bind(code)
    .first<{ id: string; alias: string }>();
  if (!inviter) return jsonError(404, 'CODE_NOT_FOUND', 'That invite code does not exist.');
  if (inviter.id === session.userId) {
    return jsonError(400, 'SELF_INVITE', 'You cannot answer your own call, Hunter.');
  }

  // Young-account guard — invites recruit NEW hunters; established accounts
  // swapping codes is farming, not growth.
  const me = await env.DB.prepare('SELECT created_at FROM users WHERE id = ?')
    .bind(session.userId)
    .first<{ created_at: number }>();
  const ageMs = Date.now() - Number(me?.created_at ?? 0);
  if (!me || !Number.isFinite(ageMs) || ageMs > REDEEM_WINDOW_DAYS * 86400000) {
    return jsonError(400, 'TOO_ESTABLISHED', 'Invite rewards are for hunters new to the Gate.');
  }

  // Exactly-once: the redeemer PK is the claim. A second redeem — any code,
  // any inviter — changes 0 rows and stops here.
  const ins = await env.DB.prepare(
    `INSERT OR IGNORE INTO invite_redemptions
       (redeemer_user_id, inviter_user_id, code, redeemed_at) VALUES (?, ?, ?, ?)`,
  )
    .bind(session.userId, inviter.id, code, Date.now())
    .run();
  if (!(ins.meta && Number(ins.meta.changes) >= 1)) {
    return jsonError(409, 'ALREADY_REDEEMED', 'You have already answered a call.');
  }

  // Pending friendship (redeemer → inviter) unless a live pair already
  // exists in either direction. Reuses the friends accept flow untouched.
  let friendshipCreated = false;
  try {
    const pair = await env.DB.prepare(
      `SELECT 1 FROM friends
        WHERE ((requester_user_id = ?1 AND recipient_user_id = ?2)
            OR (requester_user_id = ?2 AND recipient_user_id = ?1))
          AND status IN ('pending', 'accepted') LIMIT 1`,
    )
      .bind(session.userId, inviter.id)
      .first();
    if (!pair) {
      await env.DB.prepare(
        `INSERT INTO friends (id, requester_user_id, recipient_user_id, status)
         VALUES (?, ?, ?, 'pending')`,
      )
        .bind(crypto.randomUUID(), session.userId, inviter.id)
        .run();
      friendshipCreated = true;
    }
  } catch {
    /* a raced UNIQUE conflict means a pair already exists — fine, skip */
  }

  // One push to the inviter: the recruit + the waiting reward.
  if (ctx) {
    ctx.waitUntil(
      notifyUser(env, inviter.id, {
        title: 'Your call was answered',
        body: `${session.alias} entered through your Gate. +${INVITE_SOULS} souls await — and their guild request.`,
        type: 'invite_redeemed',
        data: {},
      }),
    );
  }

  // The redeemer's grant rides THIS response — the PK insert above makes it
  // exactly-once; the client pays out locally on ok:true.
  return jsonOk({
    ok: true,
    inviter_alias: inviter.alias,
    reward_souls: INVITE_SOULS,
    friendship_created: friendshipCreated,
  });
}

/** POST /v1/users/me/invite-rewards/claim — inviter collects pending souls. */
export async function handleInviteRewardsClaim(
  _request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_FRIENDS_WRITE.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');

  // Read the unclaimed redeemers (for the celebration copy), then flip the
  // SAME rows 0→1. The guarded UPDATE's change-count is the exactly-once
  // payout amount even if two devices race — each row pays exactly once.
  const pending = await env.DB.prepare(
    `SELECT ir.redeemer_user_id AS id, u.alias AS alias
       FROM invite_redemptions ir JOIN users u ON u.id = ir.redeemer_user_id
      WHERE ir.inviter_user_id = ? AND ir.inviter_claimed = 0
      LIMIT 20`,
  )
    .bind(session.userId)
    .all<{ id: string; alias: string }>();
  const rows = pending.results ?? [];
  if (rows.length === 0) return jsonOk({ ok: true, claimed: 0, souls: 0, recruits: [] });

  const upd = await env.DB.prepare(
    `UPDATE invite_redemptions SET inviter_claimed = 1
      WHERE inviter_user_id = ? AND inviter_claimed = 0
        AND redeemer_user_id IN (${rows.map(() => '?').join(', ')})`,
  )
    .bind(session.userId, ...rows.map((r) => r.id))
    .run();
  const claimed = Number(upd.meta?.changes ?? 0);
  return jsonOk({
    ok: true,
    claimed,
    souls: claimed * INVITE_SOULS,
    recruits: rows.slice(0, claimed).map((r) => r.alias),
  });
}

/** The AASA document — served at /.well-known/apple-app-site-association
 *  (and the legacy root path). Content-type must be application/json and the
 *  file must be reachable WITHOUT redirects for iOS to accept it. appID =
 *  <TeamID>.<bundle> — LK8FVGBQPL is the live APNs `iss` (provably correct).
 *  Both modern (appIDs/components) and legacy (appID/paths) shapes included
 *  for older iOS versions. */
export function handleAasaGet(): Response {
  const appId = 'LK8FVGBQPL.com.goallearner.awakened';
  return new Response(
    JSON.stringify({
      applinks: {
        apps: [],
        details: [
          {
            appID: appId,
            appIDs: [appId],
            paths: ['/i/*'],
            components: [{ '/': '/i/*', comment: 'invite links' }],
          },
        ],
      },
    }),
    { headers: { 'content-type': 'application/json' } },
  );
}

/** GET /i/<code> — browser fallback for recipients without the app: send
 *  them to the App Store. Installed devices never reach this route (iOS
 *  opens the app instead of loading the URL). */
export function handleInviteLinkFallback(): Response {
  return Response.redirect(APP_STORE_URL, 302);
}
