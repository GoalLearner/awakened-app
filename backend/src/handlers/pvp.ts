// handlers/pvp.ts — worker-side routing for realtime PvP (PVP.md §21). Validates
// auth, then forwards to the MatchRoom Durable Object addressed by idFromName(code).
// The DO owns ALL match logic + authoritative state; the worker is a thin auth +
// routing edge. WebSocket auth is via the ?token= query param (browsers can't set
// headers on a WS handshake); HTTP uses the standard Bearer gate in index.ts.
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { verifySessionJwt } from '../session-jwt';
import { jsonError } from '../lib/responses';

// Unambiguous 6-char invite code (no 0/O/1/I).
function genCode(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = crypto.getRandomValues(new Uint8Array(6));
  let s = '';
  for (let i = 0; i < 6; i++) s += A[b[i] % A.length];
  return s;
}

function forwardToDo(env: Env, code: string, action: string, userId: string, alias: string, body: unknown): Promise<Response> {
  const stub = env.MATCH.get(env.MATCH.idFromName(code));
  const req = new Request('https://do/?action=' + action, {
    method: 'POST',
    headers: { 'X-PvP-User': userId, 'X-PvP-Alias': alias, 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return stub.fetch(req);
}

// POST /v1/pvp/create { combatant, ranked? } -> { ok, code, state }
export async function handlePvpCreate(request: Request, env: Env, session: SessionPayload): Promise<Response> {
  const rl = await env.RL_DUELS_WRITE.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  let body: any = {};
  try { body = await request.json(); } catch { /* */ }
  const code = genCode();
  return forwardToDo(env, code, 'create', session.userId, session.alias, { code, combatant: body.combatant, ranked: !!body.ranked });
}

// POST /v1/pvp/join { code, combatant }
export async function handlePvpJoin(request: Request, env: Env, session: SessionPayload): Promise<Response> {
  const rl = await env.RL_DUELS_WRITE.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  let body: any = {};
  try { body = await request.json(); } catch { /* */ }
  const code = String(body.code || '').toUpperCase();
  if (!code) return jsonError(400, 'NO_CODE', 'code required');
  return forwardToDo(env, code, 'join', session.userId, session.alias, { combatant: body.combatant });
}

// POST /v1/pvp/submit { code, turn, moveId }
export async function handlePvpSubmit(request: Request, env: Env, session: SessionPayload): Promise<Response> {
  let body: any = {};
  try { body = await request.json(); } catch { /* */ }
  const code = String(body.code || '').toUpperCase();
  if (!code) return jsonError(400, 'NO_CODE', 'code required');
  return forwardToDo(env, code, 'submit', session.userId, session.alias, { turn: body.turn, moveId: body.moveId });
}

// POST /v1/pvp/forfeit { code }
export async function handlePvpForfeit(request: Request, env: Env, session: SessionPayload): Promise<Response> {
  let body: any = {};
  try { body = await request.json(); } catch { /* */ }
  const code = String(body.code || '').toUpperCase();
  if (!code) return jsonError(400, 'NO_CODE', 'code required');
  return forwardToDo(env, code, 'forfeit', session.userId, session.alias, {});
}

// GET /v1/pvp/state?code=XXX
export async function handlePvpState(request: Request, env: Env, session: SessionPayload): Promise<Response> {
  const code = String(new URL(request.url).searchParams.get('code') || '').toUpperCase();
  if (!code) return jsonError(400, 'NO_CODE', 'code required');
  return forwardToDo(env, code, 'state', session.userId, session.alias, {});
}

// GET /v1/pvp/ws?code=XXX&token=JWT  (Upgrade: websocket) — auth via query token,
// validated here at the edge; the resolved userId is forwarded to the DO.
export async function handlePvpWs(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = String(url.searchParams.get('code') || '').toUpperCase();
  const token = url.searchParams.get('token') || '';
  if (!code) return jsonError(400, 'NO_CODE', 'code required');
  let session: SessionPayload;
  try { session = await verifySessionJwt(token, env); } catch { return jsonError(401, 'INVALID_SESSION', 'bad token'); }
  const stub = env.MATCH.get(env.MATCH.idFromName(code));
  const headers = new Headers(request.headers);
  headers.set('X-PvP-User', session.userId);
  headers.set('X-PvP-Alias', session.alias);
  return stub.fetch(new Request(url.toString(), { method: 'GET', headers }));
}
