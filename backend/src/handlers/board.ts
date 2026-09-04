/**
 * board.ts — W907 THE COMMUNITY BOARD (Friends tab → Community).
 *
 * One open, server-wide forum: hunters open TOPICS (tagged improvement /
 * bug / talk) and REPLY underneath; topics list by newest activity. Named
 * MODERATORS (board_moderators: the owner + whoever the owner grants) can
 * delete, hide and mute. This is the first free text the backend stores for
 * other hunters to read, so the Apple 1.2 user-generated-content pillars
 * live here, not in a later phase:
 *
 *   FILTER   — isProfane() from profanity.ts, applied PER WHITESPACE TOKEN
 *              (the alias filter matches substrings of a fully-stripped
 *              string; run whole over a 1000-char body it would false-
 *              positive on "class action" — per token it keeps the alias
 *              semantics it was tuned for) plus the whole title.
 *   REPORT   — POST /v1/board/report; UNIQUE per reporter; the 3rd DISTINCT
 *              reporter auto-hides the target; every report pushes every
 *              moderator (type 'board_report') — the "timely response" hook.
 *   BLOCK    — board_blocks, symmetric on every read: you never see a
 *              hunter you blocked, and they never see you.
 *   CONSENT  — rules acceptance (board_consents) before the first write.
 *   CONTACT  — the client's rules sheet carries the support email.
 *
 * Every mutation is POST (the CORS layer allows no DELETE). Sims
 * (users.apple_sub LIKE 'sim_test_%') can read and never write, and are
 * filtered on every read. Timestamps are epoch ms written here.
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk, jsonError } from '../lib/responses';
import { notifyUser } from '../lib/apns';
import { isProfane } from '../profanity';

export const BOARD_RULES_VERSION = 1;
export const BOARD_TAGS = ['improvement', 'bug', 'talk'] as const;
export const TITLE_MAX = 80;
export const BODY_MAX = 1000;
export const AUTO_HIDE_REPORTS = 3;
export const MUTE_MAX_DAYS = 30;
const PAGE = 20;
const REPLY_PAGE = 50;
const REPORT_REASONS = new Set(['harassment', 'spam', 'offensive', 'other']);
const ID_RE = /^[0-9a-fA-F-]{8,}$/;
/** users.id is crypto.randomUUID() in production; keep the shape check loose so
 *  fixtures and any future id scheme still pass — the existence check is the real gate. */
const USER_ID_RE = /^[A-Za-z0-9_-]{2,64}$/;
/** House convention (hall-of-fame.ts, step-100k-club.ts, week-board.ts): the
 *  literal, never a bind — tests assert its presence in the read SQL. */
const SIM_FILTER = "u.apple_sub NOT LIKE 'sim_test_%'";

type Tag = (typeof BOARD_TAGS)[number];
type Role = 'owner' | 'mod' | null;

interface Me {
  consented: boolean;
  muted_until: number | null;
  role: Role;
  sim: boolean;
}

interface AuthorRow {
  author_id: string;
  alias: string;
  rank_label: string | null;
  founder_seq: number | null;
  is_mod: number;
  mod_role?: string | null;
}

interface TopicRow extends AuthorRow {
  id: string;
  tag: string;
  title: string;
  body: string;
  created_at: number;
  last_activity_at: number;
  reply_count: number;
  hidden_at: number | null;
  deleted_at: number | null;
}

interface ReplyRow extends AuthorRow {
  id: string;
  topic_id: string;
  body: string;
  created_at: number;
  hidden_at: number | null;
}

// ── helpers ─────────────────────────────────────────────────────────────

function clampText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

/** Per-token profanity: true when the text is clean. */
export function textIsClean(text: string): boolean {
  if (text.length <= 20 && isProfane(text)) return false;
  for (const tok of text.split(/\s+/)) {
    if (tok && isProfane(tok)) return false;
  }
  return true;
}

function isTag(v: unknown): v is Tag {
  return typeof v === 'string' && (BOARD_TAGS as readonly string[]).includes(v);
}

function isModRole(role: Role): boolean {
  return role === 'owner' || role === 'mod';
}

async function readJson<T>(request: Request): Promise<T | null> {
  try { return (await request.json()) as T; } catch { return null; }
}

/** Who is the caller, board-wise. Four small reads; every handler needs them. */
async function meState(env: Env, userId: string): Promise<Me> {
  const now = Date.now();
  const consent = await env.DB.prepare('SELECT version FROM board_consents WHERE user_id = ? LIMIT 1')
    .bind(userId).first<{ version: number }>();
  const mute = await env.DB.prepare('SELECT until FROM board_mutes WHERE user_id = ? AND until > ? LIMIT 1')
    .bind(userId, now).first<{ until: number }>();
  const mod = await env.DB.prepare('SELECT role FROM board_moderators WHERE user_id = ? LIMIT 1')
    .bind(userId).first<{ role: string }>();
  const user = await env.DB.prepare('SELECT apple_sub FROM users WHERE id = ? LIMIT 1')
    .bind(userId).first<{ apple_sub: string }>();
  return {
    consented: !!consent && Number(consent.version) >= BOARD_RULES_VERSION,
    muted_until: mute ? Number(mute.until) : null,
    role: mod && (mod.role === 'owner' || mod.role === 'mod') ? (mod.role as Role) : null,
    sim: !!user && typeof user.apple_sub === 'string' && user.apple_sub.startsWith('sim_test_'),
  };
}

/** The write gate every posting route shares: rate limit → sim → consent → mute. */
async function writeGate(env: Env, session: SessionPayload): Promise<{ me: Me } | { deny: Response }> {
  const rl = await env.RL_BOARD_WRITE.limit({ key: session.userId });
  if (!rl.success) return { deny: jsonError(429, 'RATE_LIMITED', 'Slow down.') };
  const me = await meState(env, session.userId);
  if (me.sim) return { deny: jsonError(403, 'SIM_READ_ONLY', 'Simulated hunters cannot post.') };
  if (!me.consented) return { deny: jsonError(403, 'CONSENT_REQUIRED', 'Read and accept the community rules first.') };
  if (me.muted_until) {
    return { deny: jsonError(403, 'MUTED', 'You are muted.', { muted_until: me.muted_until }) };
  }
  return { me };
}

async function modGate(env: Env, session: SessionPayload): Promise<{ me: Me } | { deny: Response }> {
  const rl = await env.RL_BOARD_WRITE.limit({ key: session.userId });
  if (!rl.success) return { deny: jsonError(429, 'RATE_LIMITED', 'Slow down.') };
  const me = await meState(env, session.userId);
  if (!isModRole(me.role)) return { deny: jsonError(403, 'NOT_MODERATOR', 'Moderators only.') };
  return { me };
}

function authorOut(r: AuthorRow) {
  return {
    author_id: r.author_id,
    alias: r.alias,
    rank_label: r.rank_label || null,
    founder_seq: r.founder_seq ? Number(r.founder_seq) : 0,
    is_mod: !!Number(r.is_mod),
    // 'owner' renders the gold DEV chip, 'mod' the violet MOD chip.
    mod_role: r.mod_role === 'owner' || r.mod_role === 'mod' ? r.mod_role : null,
  };
}

function topicOut(r: TopicRow, full: boolean) {
  return {
    id: r.id,
    tag: r.tag,
    title: r.title,
    body: full ? r.body : undefined,
    preview: full ? undefined : String(r.body || '').slice(0, 160),
    created_at: Number(r.created_at),
    last_activity_at: Number(r.last_activity_at),
    reply_count: Number(r.reply_count) || 0,
    hidden: r.hidden_at != null,
    author: authorOut(r),
  };
}

function replyOut(r: ReplyRow) {
  return {
    id: r.id,
    body: r.body,
    created_at: Number(r.created_at),
    hidden: r.hidden_at != null,
    author: authorOut(r),
  };
}

const AUTHOR_JOIN = `
     JOIN users u ON u.id = x.author_id
     LEFT JOIN public_profile_summary pps ON pps.user_id = x.author_id
     LEFT JOIN board_moderators bm ON bm.user_id = x.author_id`;
const AUTHOR_COLS = `x.author_id AS author_id, u.alias AS alias, pps.rank_label AS rank_label,
            pps.founder_seq AS founder_seq, (bm.user_id IS NOT NULL) AS is_mod, bm.role AS mod_role`;
/** Symmetric block exclusion, bound twice with the caller's id. */
const BLOCK_FILTER = `x.author_id NOT IN (SELECT blocked_id FROM board_blocks WHERE blocker_id = ?)
       AND x.author_id NOT IN (SELECT blocker_id FROM board_blocks WHERE blocked_id = ?)`;

/** Resolve an alias to a user (case- and space-insensitive, as friends.ts does). */
async function findUserByAlias(env: Env, raw: string): Promise<{ id: string; alias: string } | null> {
  const norm = String(raw || '').toLowerCase().replace(/\s+/g, '');
  if (!norm) return null;
  const row = await env.DB.prepare("SELECT id, alias FROM users WHERE LOWER(REPLACE(alias, ' ', '')) = ? LIMIT 1")
    .bind(norm).first<{ id: string; alias: string }>();
  return row ?? null;
}

async function userExists(env: Env, id: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT 1 AS one FROM users WHERE id = ? LIMIT 1').bind(id).first<{ one: number }>();
  return !!row;
}

// ── reads ───────────────────────────────────────────────────────────────

export async function handleBoardTopicsGet(request: Request, env: Env, session: SessionPayload): Promise<Response> {
  const rl = await env.RL_BOARD_READ.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  const url = new URL(request.url);
  const tag = url.searchParams.get('tag') || '';
  if (tag && !isTag(tag)) return jsonError(400, 'INVALID_TAG', 'tag must be improvement, bug or talk.');
  const cursorRaw = url.searchParams.get('cursor') || '';
  let cAt = 0; let cId = '';
  if (cursorRaw) {
    const m = /^(\d{1,16})\|([0-9a-fA-F-]{8,})$/.exec(cursorRaw);
    if (!m) return jsonError(400, 'INVALID_CURSOR', 'Bad cursor.');
    cAt = Number(m[1]); cId = m[2];
  }
  const me = await meState(env, session.userId);
  const modView = isModRole(me.role) ? 1 : 0;
  const rows = await env.DB.prepare(
    `SELECT x.id, x.tag, x.title, x.body, x.created_at, x.last_activity_at, x.reply_count, x.hidden_at, x.deleted_at,
            ${AUTHOR_COLS}
       FROM board_topics x${AUTHOR_JOIN}
      WHERE x.deleted_at IS NULL
        AND ${SIM_FILTER}
        AND (? = 1 OR x.hidden_at IS NULL)
        AND (? = '' OR x.tag = ?)
        AND ${BLOCK_FILTER}
        AND (? = 0 OR x.last_activity_at < ? OR (x.last_activity_at = ? AND x.id < ?))
      ORDER BY x.last_activity_at DESC, x.id DESC
      LIMIT ?`,
  )
    .bind(modView, tag, tag, session.userId, session.userId, cAt ? 1 : 0, cAt, cAt, cId, PAGE + 1)
    .all<TopicRow>();
  const list = rows.results ?? [];
  const page = list.slice(0, PAGE);
  const last = page[page.length - 1];
  return jsonOk({
    topics: page.map((r) => topicOut(r, false)),
    next_cursor: list.length > PAGE && last ? `${Number(last.last_activity_at)}|${last.id}` : null,
    me: { consented: me.consented, muted_until: me.muted_until, role: me.role, rules_version: BOARD_RULES_VERSION },
  });
}

export async function handleBoardTopicGet(request: Request, env: Env, session: SessionPayload, topicId: string): Promise<Response> {
  const rl = await env.RL_BOARD_READ.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  if (!ID_RE.test(topicId)) return jsonError(404, 'NOT_FOUND', 'No such topic.');
  const url = new URL(request.url);
  const after = Number(url.searchParams.get('cursor') || 0) || 0;
  const me = await meState(env, session.userId);
  const modView = isModRole(me.role) ? 1 : 0;
  const topic = await env.DB.prepare(
    `SELECT x.id, x.tag, x.title, x.body, x.created_at, x.last_activity_at, x.reply_count, x.hidden_at, x.deleted_at,
            ${AUTHOR_COLS}
       FROM board_topics x${AUTHOR_JOIN}
      WHERE x.id = ? AND x.deleted_at IS NULL AND ${SIM_FILTER}
        AND (? = 1 OR x.hidden_at IS NULL)
        AND ${BLOCK_FILTER}
      LIMIT 1`,
  )
    .bind(topicId, modView, session.userId, session.userId)
    .first<TopicRow>();
  if (!topic) return jsonError(404, 'NOT_FOUND', 'No such topic.');
  const replies = await env.DB.prepare(
    `SELECT x.id, x.topic_id, x.body, x.created_at, x.hidden_at,
            ${AUTHOR_COLS}
       FROM board_replies x${AUTHOR_JOIN}
      WHERE x.topic_id = ? AND x.deleted_at IS NULL AND ${SIM_FILTER}
        AND (? = 1 OR x.hidden_at IS NULL)
        AND ${BLOCK_FILTER}
        AND x.created_at > ?
      ORDER BY x.created_at ASC, x.id ASC
      LIMIT ?`,
  )
    .bind(topicId, modView, session.userId, session.userId, after, REPLY_PAGE + 1)
    .all<ReplyRow>();
  const list = replies.results ?? [];
  const page = list.slice(0, REPLY_PAGE);
  const last = page[page.length - 1];
  return jsonOk({
    topic: topicOut(topic, true),
    replies: page.map(replyOut),
    next_cursor: list.length > REPLY_PAGE && last ? String(Number(last.created_at)) : null,
    me: { consented: me.consented, muted_until: me.muted_until, role: me.role, rules_version: BOARD_RULES_VERSION },
  });
}

// ── writes ──────────────────────────────────────────────────────────────

export async function handleBoardConsentPost(request: Request, env: Env, session: SessionPayload): Promise<Response> {
  const rl = await env.RL_BOARD_WRITE.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  const body = await readJson<{ version?: unknown }>(request);
  const version = body && Number.isInteger(body.version) ? Number(body.version) : BOARD_RULES_VERSION;
  if (version < BOARD_RULES_VERSION) return jsonError(400, 'STALE_RULES', 'The rules changed; read the current version.');
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO board_consents (user_id, accepted_at, version) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET accepted_at = excluded.accepted_at, version = excluded.version`,
  ).bind(session.userId, now, version).run();
  return jsonOk({ ok: true, consented: true, version });
}

export async function handleBoardTopicPost(request: Request, env: Env, session: SessionPayload): Promise<Response> {
  const gate = await writeGate(env, session);
  if ('deny' in gate) return gate.deny;
  const body = await readJson<{ tag?: unknown; title?: unknown; body?: unknown }>(request);
  if (!body) return jsonError(400, 'BAD_JSON', 'Invalid JSON body.');
  if (!isTag(body.tag)) return jsonError(400, 'INVALID_TAG', 'tag must be improvement, bug or talk.');
  const title = clampText(body.title, TITLE_MAX);
  const text = clampText(body.body, BODY_MAX);
  if (!title) return jsonError(400, 'MISSING_TITLE', 'Give the topic a title.');
  if (!text) return jsonError(400, 'MISSING_BODY', 'Say something.');
  if (!textIsClean(title) || !textIsClean(text)) return jsonError(400, 'OBJECTIONABLE', 'That contains language the board does not allow.');
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO board_topics (id, author_id, tag, title, body, created_at, last_activity_at, reply_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
  ).bind(id, session.userId, body.tag, title, text, now, now).run();
  return jsonOk({ ok: true, id, created_at: now });
}

export async function handleBoardReplyPost(request: Request, env: Env, session: SessionPayload, topicId: string): Promise<Response> {
  if (!ID_RE.test(topicId)) return jsonError(404, 'NOT_FOUND', 'No such topic.');
  const gate = await writeGate(env, session);
  if ('deny' in gate) return gate.deny;
  const body = await readJson<{ body?: unknown }>(request);
  if (!body) return jsonError(400, 'BAD_JSON', 'Invalid JSON body.');
  const text = clampText(body.body, BODY_MAX);
  if (!text) return jsonError(400, 'MISSING_BODY', 'Say something.');
  if (!textIsClean(text)) return jsonError(400, 'OBJECTIONABLE', 'That contains language the board does not allow.');
  const topic = await env.DB.prepare('SELECT id, hidden_at, deleted_at FROM board_topics WHERE id = ? LIMIT 1')
    .bind(topicId).first<{ id: string; hidden_at: number | null; deleted_at: number | null }>();
  if (!topic || topic.deleted_at != null) return jsonError(404, 'NOT_FOUND', 'No such topic.');
  if (topic.hidden_at != null && !isModRole(gate.me.role)) return jsonError(404, 'NOT_FOUND', 'No such topic.');
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO board_replies (id, topic_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(id, topicId, session.userId, text, now).run();
  await env.DB.prepare(
    'UPDATE board_topics SET reply_count = reply_count + 1, last_activity_at = ? WHERE id = ?',
  ).bind(now, topicId).run();
  return jsonOk({ ok: true, id, created_at: now });
}

export async function handleBoardReportPost(request: Request, env: Env, session: SessionPayload, ctx?: ExecutionContext): Promise<Response> {
  const rl = await env.RL_BOARD_WRITE.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  const body = await readJson<{ kind?: unknown; id?: unknown; reason?: unknown }>(request);
  if (!body) return jsonError(400, 'BAD_JSON', 'Invalid JSON body.');
  const kind = body.kind === 'topic' || body.kind === 'reply' ? body.kind : null;
  const id = typeof body.id === 'string' && ID_RE.test(body.id) ? body.id : null;
  const reason = typeof body.reason === 'string' && REPORT_REASONS.has(body.reason) ? body.reason : null;
  if (!kind || !id) return jsonError(400, 'INVALID_TARGET', 'kind (topic|reply) and id required.');
  if (!reason) return jsonError(400, 'INVALID_REASON', 'reason must be harassment, spam, offensive or other.');
  const table = kind === 'topic' ? 'board_topics' : 'board_replies';
  const target = await env.DB.prepare(`SELECT id, author_id, hidden_at FROM ${table} WHERE id = ? AND deleted_at IS NULL LIMIT 1`)
    .bind(id).first<{ id: string; author_id: string; hidden_at: number | null }>();
  if (!target) return jsonError(404, 'NOT_FOUND', 'Nothing to report here.');
  if (target.author_id === session.userId) return jsonError(400, 'SELF_REPORT', 'You cannot report your own post.');
  const now = Date.now();
  const ins = await env.DB.prepare(
    'INSERT OR IGNORE INTO board_reports (target_kind, target_id, reporter_id, reason, created_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(kind, id, session.userId, reason, now).run();
  const fresh = !!(ins.meta && Number(ins.meta.changes) >= 1);
  const countRow = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM board_reports WHERE target_kind = ? AND target_id = ? AND resolved_at IS NULL',
  ).bind(kind, id).first<{ n: number }>();
  const n = countRow ? Number(countRow.n) : 0;
  let autoHidden = false;
  if (n >= AUTO_HIDE_REPORTS && target.hidden_at == null) {
    const upd = await env.DB.prepare(`UPDATE ${table} SET hidden_at = ?, hidden_by = 'auto' WHERE id = ? AND hidden_at IS NULL`)
      .bind(now, id).run();
    autoHidden = !!(upd.meta && Number(upd.meta.changes) >= 1);
  }
  if (fresh) {
    // Every moderator hears about every report — that is the 1.2 "timely
    // response" mechanism. notifyUser never throws.
    const mods = await env.DB.prepare('SELECT user_id FROM board_moderators').bind().all<{ user_id: string }>();
    const push = async () => {
      for (const m of mods.results ?? []) {
        if (m.user_id === session.userId) continue;
        await notifyUser(env, m.user_id, {
          title: 'Board report',
          body: `A ${kind} was reported for ${reason}${autoHidden ? ' and is now hidden' : ''}. Open the Community board to review it.`,
          type: 'board_report',
          data: { kind, id },
        });
      }
    };
    if (ctx) ctx.waitUntil(push()); else await push();
  }
  return jsonOk({ ok: true, already: !fresh, reports: n, auto_hidden: autoHidden });
}

export async function handleBoardBlockPost(request: Request, env: Env, session: SessionPayload, unblock: boolean): Promise<Response> {
  const rl = await env.RL_BOARD_WRITE.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  const body = await readJson<{ user_id?: unknown }>(request);
  const target = body && typeof body.user_id === 'string' && USER_ID_RE.test(body.user_id) ? body.user_id : null;
  if (!target) return jsonError(400, 'INVALID_TARGET', 'user_id required.');
  if (target === session.userId) return jsonError(400, 'SELF_BLOCK', 'You cannot block yourself.');
  if (unblock) {
    await env.DB.prepare('DELETE FROM board_blocks WHERE blocker_id = ? AND blocked_id = ?').bind(session.userId, target).run();
    return jsonOk({ ok: true, blocked: false });
  }
  if (!(await userExists(env, target))) return jsonError(404, 'NOT_FOUND', 'No such hunter.');
  await env.DB.prepare('INSERT OR IGNORE INTO board_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)')
    .bind(session.userId, target, Date.now()).run();
  return jsonOk({ ok: true, blocked: true });
}

export async function handleBoardBlocksGet(_request: Request, env: Env, session: SessionPayload): Promise<Response> {
  const rl = await env.RL_BOARD_READ.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  const rows = await env.DB.prepare(
    `SELECT b.blocked_id AS user_id, u.alias AS alias, b.created_at AS created_at
       FROM board_blocks b JOIN users u ON u.id = b.blocked_id
      WHERE b.blocker_id = ? ORDER BY b.created_at DESC LIMIT 200`,
  ).bind(session.userId).all<{ user_id: string; alias: string; created_at: number }>();
  return jsonOk({ blocks: rows.results ?? [] });
}

// ── moderation ──────────────────────────────────────────────────────────

export async function handleBoardTopicDelete(_request: Request, env: Env, session: SessionPayload, topicId: string): Promise<Response> {
  if (!ID_RE.test(topicId)) return jsonError(404, 'NOT_FOUND', 'No such topic.');
  const gate = await modGate(env, session);
  if ('deny' in gate) return gate.deny;
  const upd = await env.DB.prepare(
    "UPDATE board_topics SET deleted_at = ?, deleted_by = ?, body = '' WHERE id = ? AND deleted_at IS NULL",
  ).bind(Date.now(), session.userId, topicId).run();
  if (!(upd.meta && Number(upd.meta.changes) >= 1)) return jsonError(404, 'NOT_FOUND', 'No such topic.');
  return jsonOk({ ok: true, deleted: true });
}

export async function handleBoardReplyDelete(_request: Request, env: Env, session: SessionPayload, replyId: string): Promise<Response> {
  if (!ID_RE.test(replyId)) return jsonError(404, 'NOT_FOUND', 'No such reply.');
  const gate = await modGate(env, session);
  if ('deny' in gate) return gate.deny;
  const row = await env.DB.prepare('SELECT topic_id FROM board_replies WHERE id = ? AND deleted_at IS NULL LIMIT 1')
    .bind(replyId).first<{ topic_id: string }>();
  if (!row) return jsonError(404, 'NOT_FOUND', 'No such reply.');
  await env.DB.prepare("UPDATE board_replies SET deleted_at = ?, deleted_by = ?, body = '' WHERE id = ?")
    .bind(Date.now(), session.userId, replyId).run();
  await env.DB.prepare('UPDATE board_topics SET reply_count = MAX(0, reply_count - 1) WHERE id = ?')
    .bind(row.topic_id).run();
  return jsonOk({ ok: true, deleted: true });
}

export async function handleBoardTopicHide(_request: Request, env: Env, session: SessionPayload, topicId: string): Promise<Response> {
  if (!ID_RE.test(topicId)) return jsonError(404, 'NOT_FOUND', 'No such topic.');
  const gate = await modGate(env, session);
  if ('deny' in gate) return gate.deny;
  const row = await env.DB.prepare('SELECT hidden_at FROM board_topics WHERE id = ? AND deleted_at IS NULL LIMIT 1')
    .bind(topicId).first<{ hidden_at: number | null }>();
  if (!row) return jsonError(404, 'NOT_FOUND', 'No such topic.');
  const hide = row.hidden_at == null;
  await env.DB.prepare('UPDATE board_topics SET hidden_at = ?, hidden_by = ? WHERE id = ?')
    .bind(hide ? Date.now() : null, hide ? session.userId : null, topicId).run();
  return jsonOk({ ok: true, hidden: hide });
}

export async function handleBoardMutePost(request: Request, env: Env, session: SessionPayload, unmute: boolean): Promise<Response> {
  const gate = await modGate(env, session);
  if ('deny' in gate) return gate.deny;
  const body = await readJson<{ user_id?: unknown; days?: unknown; reason?: unknown }>(request);
  const target = body && typeof body.user_id === 'string' && USER_ID_RE.test(body.user_id) ? body.user_id : null;
  if (!target) return jsonError(400, 'INVALID_TARGET', 'user_id required.');
  if (target === session.userId) return jsonError(400, 'SELF_MUTE', 'You cannot mute yourself.');
  if (unmute) {
    await env.DB.prepare('DELETE FROM board_mutes WHERE user_id = ?').bind(target).run();
    return jsonOk({ ok: true, muted: false });
  }
  const days = body && Number.isInteger(body.days) ? Number(body.days) : 0;
  if (days < 1 || days > MUTE_MAX_DAYS) return jsonError(400, 'INVALID_DAYS', `days must be 1–${MUTE_MAX_DAYS}.`);
  const targetMod = await env.DB.prepare('SELECT role FROM board_moderators WHERE user_id = ? LIMIT 1')
    .bind(target).first<{ role: string }>();
  if (targetMod) return jsonError(403, 'CANNOT_MUTE_MODERATOR', 'Moderators cannot be muted.');
  if (!(await userExists(env, target))) return jsonError(404, 'NOT_FOUND', 'No such hunter.');
  const reason = clampText(body ? body.reason : null, 120);
  const now = Date.now();
  const until = now + days * 86400000;
  await env.DB.prepare(
    `INSERT INTO board_mutes (user_id, until, by_user_id, reason, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET until = excluded.until, by_user_id = excluded.by_user_id,
                                         reason = excluded.reason, created_at = excluded.created_at`,
  ).bind(target, until, session.userId, reason, now).run();
  return jsonOk({ ok: true, muted: true, until });
}

export async function handleBoardReportsGet(_request: Request, env: Env, session: SessionPayload): Promise<Response> {
  const rl = await env.RL_BOARD_READ.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  const me = await meState(env, session.userId);
  if (!isModRole(me.role)) return jsonError(403, 'NOT_MODERATOR', 'Moderators only.');
  const rows = await env.DB.prepare(
    `SELECT r.id, r.target_kind, r.target_id, r.reason, r.created_at, u.alias AS reporter_alias,
            COALESCE((SELECT title FROM board_topics WHERE id = r.target_id),
                     (SELECT substr(body, 1, 120) FROM board_replies WHERE id = r.target_id)) AS preview,
            COALESCE((SELECT topic_id FROM board_replies WHERE id = r.target_id), r.target_id) AS topic_id
       FROM board_reports r JOIN users u ON u.id = r.reporter_id
      WHERE r.resolved_at IS NULL
      ORDER BY r.created_at DESC LIMIT 100`,
  ).bind().all<Record<string, unknown>>();
  return jsonOk({ reports: rows.results ?? [] });
}

export async function handleBoardReportsResolve(request: Request, env: Env, session: SessionPayload): Promise<Response> {
  const gate = await modGate(env, session);
  if ('deny' in gate) return gate.deny;
  const body = await readJson<{ kind?: unknown; id?: unknown }>(request);
  const kind = body && (body.kind === 'topic' || body.kind === 'reply') ? body.kind : null;
  const id = body && typeof body.id === 'string' && ID_RE.test(body.id) ? body.id : null;
  if (!kind || !id) return jsonError(400, 'INVALID_TARGET', 'kind and id required.');
  const upd = await env.DB.prepare(
    'UPDATE board_reports SET resolved_at = ?, resolved_by = ? WHERE target_kind = ? AND target_id = ? AND resolved_at IS NULL',
  ).bind(Date.now(), session.userId, kind, id).run();
  return jsonOk({ ok: true, resolved: upd.meta ? Number(upd.meta.changes) || 0 : 0 });
}

// ── owner: moderator roster ─────────────────────────────────────────────

export async function handleBoardModeratorsGet(_request: Request, env: Env, session: SessionPayload): Promise<Response> {
  const rl = await env.RL_BOARD_READ.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  const rows = await env.DB.prepare(
    `SELECT bm.user_id AS user_id, u.alias AS alias, bm.role AS role, bm.granted_at AS granted_at
       FROM board_moderators bm JOIN users u ON u.id = bm.user_id ORDER BY bm.granted_at ASC`,
  ).bind().all<{ user_id: string; alias: string; role: string; granted_at: number }>();
  return jsonOk({ moderators: rows.results ?? [] });
}

export async function handleBoardModeratorGrant(request: Request, env: Env, session: SessionPayload, remove: boolean): Promise<Response> {
  const rl = await env.RL_BOARD_WRITE.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  const me = await meState(env, session.userId);
  if (me.role !== 'owner') return jsonError(403, 'NOT_OWNER', 'Only the owner grants moderator status.');
  const body = await readJson<{ alias?: unknown }>(request);
  const alias = body && typeof body.alias === 'string' ? body.alias.trim() : '';
  if (!alias) return jsonError(400, 'MISSING_ALIAS', 'alias required.');
  const user = await findUserByAlias(env, alias);
  if (!user) return jsonError(404, 'NOT_FOUND', 'No hunter by that alias.');
  if (user.id === session.userId) return jsonError(400, 'SELF_GRANT', 'You are already the owner.');
  if (remove) {
    await env.DB.prepare("DELETE FROM board_moderators WHERE user_id = ? AND role = 'mod'").bind(user.id).run();
    return jsonOk({ ok: true, alias: user.alias, moderator: false });
  }
  await env.DB.prepare(
    "INSERT OR IGNORE INTO board_moderators (user_id, role, granted_by, granted_at) VALUES (?, 'mod', ?, ?)",
  ).bind(user.id, session.userId, Date.now()).run();
  return jsonOk({ ok: true, alias: user.alias, moderator: true });
}

/** Admin bootstrap (ADMIN_METRICS_SECRET-gated in index.ts, no session): seat
 *  the one owner row by alias. Refuses to seat a second owner. */
export async function handleAdminBoardOwner(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const alias = (url.searchParams.get('alias') || '').trim();
  if (!alias) return jsonError(400, 'MISSING_ALIAS', 'Pass ?alias=<hunter alias>.');
  const user = await findUserByAlias(env, alias);
  if (!user) return jsonError(404, 'NOT_FOUND', 'No hunter by that alias.');
  const existing = await env.DB.prepare("SELECT user_id FROM board_moderators WHERE role = 'owner' LIMIT 1")
    .bind().first<{ user_id: string }>();
  if (existing && existing.user_id !== user.id) return jsonError(409, 'OWNER_EXISTS', 'An owner is already seated.');
  await env.DB.prepare(
    `INSERT INTO board_moderators (user_id, role, granted_by, granted_at) VALUES (?, 'owner', 'admin', ?)
       ON CONFLICT(user_id) DO UPDATE SET role = 'owner'`,
  ).bind(user.id, Date.now()).run();
  return jsonOk({ ok: true, owner: user.alias, user_id: user.id });
}
