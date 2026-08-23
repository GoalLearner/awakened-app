/**
 * tower.ts — W870 (Wave 2 Train B) THE TOWER REMEMBERS.
 *
 * The Ascent stops being a solo hallucination: friends' rated clears plant
 * weekly BANNERS (earliest clear per floor among your friends), run-ending
 * losses kneel as ECHOES for 7 days, and clearing a friend's echo floor
 * AVENGES them — the avenger earns souls (client-granted from the response,
 * the co-op award model), the defeated regains a daily life and gets the
 * push. All floor data is client-submitted (the Ascent is client-side by
 * design); the server is the shared memory, not the referee.
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk, jsonError } from '../lib/responses';
import { notifyUser } from '../lib/apns';

const ECHO_TTL_MS = 7 * 24 * 3600 * 1000;
export const AVENGE_SOULS = 40;

function ptWeekStartNow(): string {
  const now = new Date();
  const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(now);
  let weekday = 0;
  for (const p of new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short' }).formatToParts(now)) {
    if (p.type === 'weekday') weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.value);
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m || weekday < 0) return dayKey;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) - weekday * 86400000);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}

async function friendIdsOf(env: Env, userId: string): Promise<string[]> {
  const rows = await env.DB.prepare(
    `SELECT requester_user_id AS a, recipient_user_id AS b FROM friends
      WHERE status = 'accepted' AND (requester_user_id = ? OR recipient_user_id = ?) LIMIT 100`,
  ).bind(userId, userId).all<{ a: string; b: string }>();
  const out: string[] = [];
  (rows.results ?? []).forEach((r) => { out.push(r.a === userId ? r.b : r.a); });
  return out;
}

export async function handleTowerEventPost(
  request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_FRIENDS_WRITE.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  let body: { kind?: unknown; floor?: unknown };
  try { body = await request.json(); } catch { return jsonError(400, 'BAD_JSON', 'Invalid JSON body.'); }
  const kind = body.kind === 'clear' || body.kind === 'defeat' ? body.kind : null;
  const floor = Number(body.floor);
  if (!kind || !Number.isInteger(floor) || floor < 1 || floor > 100) {
    return jsonError(400, 'BAD_EVENT', 'kind clear|defeat and floor 1-100 required.');
  }
  const now = Date.now();
  const week = ptWeekStartNow();
  if (kind === 'defeat') {
    // Latest defeat only; an unavenged prior kneels no more.
    await env.DB.prepare(
      "DELETE FROM tower_events WHERE user_id = ? AND kind = 'defeat' AND avenged_by IS NULL",
    ).bind(session.userId).run();
  }
  try {
    await env.DB.prepare(
      'INSERT INTO tower_events (id, user_id, kind, floor, week_start, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(crypto.randomUUID(), session.userId, kind, floor, week, now).run();
  } catch {
    // clear-once unique index — same floor already recorded this week. Fine.
  }
  return jsonOk({ ok: true });
}

export async function handleTowerFriendsGet(
  _request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_FRIENDS_READ.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  const friends = await friendIdsOf(env, session.userId);
  const week = ptWeekStartNow();
  const since = Date.now() - ECHO_TTL_MS;
  let banners: { floor: number; alias: string; user_id: string }[] = [];
  let echoes: { id: string; floor: number; alias: string }[] = [];
  if (friends.length) {
    const ph = friends.map(() => '?').join(',');
    const clears = await env.DB.prepare(
      `SELECT t.floor, t.user_id, t.created_at, u.alias FROM tower_events t JOIN users u ON u.id = t.user_id
        WHERE t.kind = 'clear' AND t.week_start = ? AND t.user_id IN (${ph}) ORDER BY t.created_at ASC LIMIT 400`,
    ).bind(week, ...friends).all<{ floor: number; user_id: string; created_at: number; alias: string }>();
    const seen: Record<number, boolean> = {};
    (clears.results ?? []).forEach((c) => {
      if (seen[c.floor]) return;
      seen[c.floor] = true;
      banners.push({ floor: c.floor, alias: c.alias, user_id: c.user_id });
    });
    const defeats = await env.DB.prepare(
      `SELECT t.id, t.floor, u.alias FROM tower_events t JOIN users u ON u.id = t.user_id
        WHERE t.kind = 'defeat' AND t.avenged_by IS NULL AND t.created_at > ? AND t.user_id IN (${ph})
        ORDER BY t.created_at DESC LIMIT 50`,
    ).bind(since, ...friends).all<{ id: string; floor: number; alias: string }>();
    echoes = defeats.results ?? [];
  }
  // My latest defeat — the client uses this to deliver the avenged notice + life credit.
  const mine = await env.DB.prepare(
    `SELECT t.id, t.floor, t.avenged_at, u.alias AS avenger_alias FROM tower_events t
       LEFT JOIN users u ON u.id = t.avenged_by
      WHERE t.user_id = ? AND t.kind = 'defeat' ORDER BY t.created_at DESC LIMIT 1`,
  ).bind(session.userId).first<{ id: string; floor: number; avenged_at: number | null; avenger_alias: string | null }>();
  return jsonOk({ ok: true, week_start: week, banners, echoes, my_defeat: mine ?? null, avenge_souls: AVENGE_SOULS });
}

export async function handleTowerAvengePost(
  request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_FRIENDS_WRITE.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  let body: { event_id?: unknown };
  try { body = await request.json(); } catch { return jsonError(400, 'BAD_JSON', 'Invalid JSON body.'); }
  const eventId = typeof body.event_id === 'string' ? body.event_id : '';
  if (!eventId) return jsonError(400, 'MISSING_EVENT', 'event_id required.');
  const ev = await env.DB.prepare(
    "SELECT * FROM tower_events WHERE id = ? AND kind = 'defeat'",
  ).bind(eventId).first<{ id: string; user_id: string; floor: number; created_at: number; avenged_by: string | null }>();
  if (!ev || ev.avenged_by || ev.user_id === session.userId || Date.now() - ev.created_at > ECHO_TTL_MS) {
    return jsonError(404, 'NOT_AVENGEABLE', 'That echo is beyond avenging.');
  }
  const friends = await friendIdsOf(env, session.userId);
  if (friends.indexOf(ev.user_id) === -1) return jsonError(403, 'NOT_FRIENDS', 'Only a friend may avenge.');
  // The avenger must have cleared that floor this week (their own submitted event).
  const myClear = await env.DB.prepare(
    "SELECT 1 FROM tower_events WHERE user_id = ? AND kind = 'clear' AND floor = ? AND week_start = ? LIMIT 1",
  ).bind(session.userId, ev.floor, ptWeekStartNow()).first();
  if (!myClear) return jsonError(409, 'FLOOR_UNCLEARED', 'Clear the floor first — then avenge.');
  const upd = await env.DB.prepare(
    'UPDATE tower_events SET avenged_by = ?, avenged_at = ? WHERE id = ? AND avenged_by IS NULL',
  ).bind(session.userId, Date.now(), eventId).run();
  if (Number(upd.meta?.changes ?? 0) < 1) return jsonError(409, 'RACED', 'Someone avenged them first.');
  const me = await env.DB.prepare('SELECT alias FROM users WHERE id = ?').bind(session.userId).first<{ alias: string }>();
  await notifyUser(env, ev.user_id, {
    title: 'You were avenged',
    body: (me?.alias ?? 'A hunter') + ' brought down Floor ' + ev.floor + ' in your name. The Tower grants you another attempt today.',
    type: 'tower_avenged',
    data: {},
  });
  return jsonOk({ ok: true, souls: AVENGE_SOULS });
}
