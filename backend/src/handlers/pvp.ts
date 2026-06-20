// handlers/pvp.ts — worker-side routing for realtime PvP (PVP.md §21). Validates
// auth, then forwards to the MatchRoom Durable Object addressed by idFromName(code).
// The DO owns ALL match logic + authoritative state; the worker is a thin auth +
// routing edge. WebSocket auth is via the ?token= query param (browsers can't set
// headers on a WS handshake); HTTP uses the standard Bearer gate in index.ts.
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { verifySessionJwt } from '../session-jwt';
import { jsonError, jsonOk } from '../lib/responses';
import { eloTier } from '../pvp/elo';
import { currentSeason, softResetElo, daysLeft, PVP_PLACEMENT_GAMES, type Season } from '../pvp/seasons';
import { pickBot, botMeta } from '../pvp/bots';

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

// POST /v1/pvp/create { combatant } -> { ok, code, state }
// Invite-by-code duels are ALWAYS unranked (friendly). You pick your opponent here, so a
// ranked one would let you farm a weak friend for free ELO. Rating moves ONLY through
// matchmade duels (POST /v1/pvp/find), where the opponent is server-chosen near your rank.
// Enforced here server-side — the client's `ranked` flag is intentionally ignored.
export async function handlePvpCreate(request: Request, env: Env, session: SessionPayload): Promise<Response> {
  const rl = await env.RL_DUELS_WRITE.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  let body: any = {};
  try { body = await request.json(); } catch { /* */ }
  const code = genCode();
  return forwardToDo(env, code, 'create', session.userId, session.alias, { code, combatant: body.combatant, ranked: false });
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

// POST /v1/pvp/find { combatant } — instant ranked match vs an ELO-matched AI bot
// (PVP.md §11.1). The bot is chosen from the SERVER roster (never client input); the
// MatchRoom resolves its moves with the shipped Ascent AI. Returns { ok, code, vsBot,
// opponent } so the client can show the VS screen and connect.
export async function handlePvpFind(request: Request, env: Env, session: SessionPayload): Promise<Response> {
  const rl = await env.RL_DUELS_WRITE.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  let body: any = {};
  try { body = await request.json(); } catch { /* */ }
  let elo = 1500;
  try { const row = await env.DB.prepare('SELECT elo FROM pvp_ratings WHERE user_id=?').bind(session.userId).first<any>(); if (row) elo = Number(row.elo); } catch { /* */ }
  const bot = pickBot(elo);
  const meta = botMeta(bot);
  const code = genCode();
  let res: Response;
  try {
    res = await forwardToDo(env, code, 'createVsBot', session.userId, session.alias, {
      code, combatant: body.combatant, bot: { id: bot.id, alias: bot.name, elo: bot.elo, combatant: bot.combatant },
    });
  } catch { return jsonError(503, 'PVP_UNAVAILABLE', 'Matchmaking is busy. Try again in a moment.'); }
  let j: any = {};
  try { j = await res.json(); } catch { /* */ }
  if (!j || !j.ok) return jsonError(503, 'PVP_UNAVAILABLE', 'Could not start the match. Try again.');
  j.vsBot = true; j.opponent = meta;
  return jsonOk(j);
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

// POST /v1/pvp/rematch { code } — request/accept a rematch on an ended human match.
export async function handlePvpRematch(request: Request, env: Env, session: SessionPayload): Promise<Response> {
  const rl = await env.RL_DUELS_WRITE.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  let body: any = {};
  try { body = await request.json(); } catch { /* */ }
  const code = String(body.code || '').toUpperCase();
  if (!code) return jsonError(400, 'NO_CODE', 'code required');
  return forwardToDo(env, code, 'rematch', session.userId, session.alias, {});
}

// POST /v1/pvp/rematch/decline { code } — decline an outstanding rematch offer.
export async function handlePvpRematchDecline(request: Request, env: Env, session: SessionPayload): Promise<Response> {
  let body: any = {};
  try { body = await request.json(); } catch { /* */ }
  const code = String(body.code || '').toUpperCase();
  if (!code) return jsonError(400, 'NO_CODE', 'code required');
  return forwardToDo(env, code, 'rematchNo', session.userId, session.alias, {});
}

// GET /v1/pvp/state?code=XXX
export async function handlePvpState(request: Request, env: Env, session: SessionPayload): Promise<Response> {
  const code = String(new URL(request.url).searchParams.get('code') || '').toUpperCase();
  if (!code) return jsonError(400, 'NO_CODE', 'code required');
  return forwardToDo(env, code, 'state', session.userId, session.alias, {});
}

// GET /v1/pvp/rating — the caller's own ELO + tier + W/L/D + global rank (PVP.md §12.4).
export async function handlePvpRating(request: Request, env: Env, session: SessionPayload): Promise<Response> {
  const rl = await env.RL_HALL_READ.limit({ key: session.userId });   // mirror sibling reads (30/min)
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  let season: Season | null = null;
  try { season = await currentSeason(env); } catch { /* table may predate deploy */ }
  let row: any = null;
  try { row = await env.DB.prepare('SELECT elo, peak_elo, wins, losses, draws, season_id, placement_games FROM pvp_ratings WHERE user_id=?').bind(session.userId).first<any>(); } catch { /* table may predate deploy */ }
  // a row from a PRIOR season is shown as its projected soft-reset (committed on next match).
  const inSeason = !!(row && season && row.season_id === season.id);
  const elo = inSeason ? Number(row.elo) : (row ? softResetElo(Number(row.elo)) : 1500);
  const placementGames = inSeason ? Number(row.placement_games || 0) : 0;
  const placed = placementGames >= PVP_PLACEMENT_GAMES;
  let rank: number | null = null;
  if (placed && season) {
    try { const rk = await env.DB.prepare('SELECT COUNT(*) AS n FROM pvp_ratings WHERE season_id=? AND placement_games >= ? AND elo > ?').bind(season.id, PVP_PLACEMENT_GAMES, elo).first<any>(); rank = rk ? Number(rk.n) + 1 : null; } catch { /* */ }
  }
  return jsonOk({
    ok: true, elo, peakElo: row ? Number(row.peak_elo) : 1500, tier: eloTier(elo),
    wins: inSeason ? Number(row.wins) : 0, losses: inSeason ? Number(row.losses) : 0, draws: inSeason ? Number(row.draws) : 0,
    rank, placed, placementGames, placementNeeded: PVP_PLACEMENT_GAMES,
    season: season ? { number: season.number, endsAt: season.ends_at, daysLeft: daysLeft(season) } : null,
  });
}

// GET /v1/pvp/leaderboard?limit=50 — global top-N by ELO (PVP.md §12.4).
export async function handlePvpLeaderboard(request: Request, env: Env, session: SessionPayload): Promise<Response> {
  const rl = await env.RL_HALL_READ.limit({ key: session.userId });   // mirror sibling reads (30/min)
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  const limit = Math.min(100, Math.max(1, parseInt(new URL(request.url).searchParams.get('limit') || '50', 10) || 50));
  let season: Season | null = null;
  try { season = await currentSeason(env); } catch { /* */ }
  let rows: any[] = [];
  try {
    if (season) {
      const res = await env.DB.prepare(
        'SELECT user_id, alias, elo, wins, losses, draws FROM pvp_ratings WHERE season_id=? AND placement_games >= ? ORDER BY elo DESC, last_match_at ASC LIMIT ?',
      ).bind(season.id, PVP_PLACEMENT_GAMES, limit).all<any>();
      rows = res.results || [];
    } else {
      const res = await env.DB.prepare('SELECT user_id, alias, elo, wins, losses, draws FROM pvp_ratings ORDER BY elo DESC LIMIT ?').bind(limit).all<any>();
      rows = res.results || [];
    }
  } catch { /* table may predate deploy */ }
  const top = rows.map((r, i) => ({
    rank: i + 1, alias: r.alias || 'Hunter', elo: Number(r.elo), tier: eloTier(Number(r.elo)),
    wins: Number(r.wins), losses: Number(r.losses), draws: Number(r.draws), you: r.user_id === session.userId,
  }));
  return jsonOk({ ok: true, top, season: season ? { number: season.number, daysLeft: daysLeft(season) } : null });
}

// GET /v1/pvp/history?limit=12 — the caller's recent finished duels (newest first):
// outcome (win/loss/draw), opponent alias, vs-bot, ranked, when. The client derives the
// current win streak from these.
export async function handlePvpHistory(request: Request, env: Env, session: SessionPayload): Promise<Response> {
  const rl = await env.RL_HALL_READ.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  const limit = Math.min(25, Math.max(1, parseInt(new URL(request.url).searchParams.get('limit') || '12', 10) || 12));
  const uid = session.userId;
  let rows: any[] = [];
  try {
    const res = await env.DB.prepare(
      `SELECT p1_user_id, p2_user_id, p1_alias, p2_alias, winner_user_id, result, ranked, ended_at
         FROM pvp_matches WHERE status='ended' AND (p1_user_id=? OR p2_user_id=?)
         ORDER BY ended_at DESC LIMIT ?`,
    ).bind(uid, uid, limit).all<any>();
    rows = res.results || [];
  } catch { /* table may predate deploy */ }
  const items = rows.map((r) => {
    const meIsP1 = r.p1_user_id === uid;
    const oppAlias = meIsP1 ? r.p2_alias : r.p1_alias;
    const oppId = (meIsP1 ? r.p2_user_id : r.p1_user_id) || '';
    const outcome = r.result === 'draw' ? 'draw' : (r.winner_user_id === uid ? 'win' : 'loss');
    return { outcome, opponent: String(oppAlias || (oppId.indexOf('bot:') === 0 ? 'Bot' : 'Hunter')), vsBot: oppId.indexOf('bot:') === 0, ranked: !!r.ranked, when: r.ended_at };
  });
  return jsonOk({ ok: true, items });
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
