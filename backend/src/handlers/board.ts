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
import { isProfaneWord } from '../profanity';

export const BOARD_RULES_VERSION = 1;
export const BOARD_TAGS = ['improvement', 'bug', 'talk'] as const;
export const TITLE_MAX = 80;
export const BODY_MAX = 1000;
export const AUTO_HIDE_REPORTS = 3;

// ── W914 — THE SPAM GUARD (owner: "prevent people from spamming the board").
// Every number is a knob. Moderators are exempt from all of it.
export const SPAM = {
  TOPICS_PER_DAY: 3,
  TOPIC_COOLDOWN_MS: 10 * 60 * 1000,
  REPLIES_PER_DAY: 30,
  REPLY_COOLDOWN_MS: 20 * 1000,
  REPLIES_PER_TOPIC_PER_HOUR: 5,
  DUPLICATE_WINDOW_MS: 7 * 86400 * 1000,
  DUPLICATE_LOOKBACK: 10,
  BODY_MIN: 8,
  MIN_LETTERS: 3,
  STRIKES_TO_MUTE: 5,
  STRIKE_WINDOW_MS: 86400 * 1000,
  STRIKE_MUTE_MS: 86400 * 1000,
  HIDDEN_TO_MUTE: 2,
  HIDDEN_WINDOW_MS: 7 * 86400 * 1000,
  HIDDEN_MUTE_MS: 7 * 86400 * 1000,
  PURGE_MAX_HOURS: 168,
} as const;
const DAY_MS = 86400 * 1000;
const HOUR_MS = 3600 * 1000;
export const MUTE_MAX_DAYS = 30;
// W911 — RANK GATES (owner, 2026-09-06): only C-tier and better open topics; only
// D-tier and better reply. Moderators are exempt. Rank comes from the hunter's own
// public_profile_summary mirror; a hunter with no mirror yet reads as E.
export const TIER_ORDER = ['E', 'D', 'C', 'B', 'A', 'S', 'S+'] as const;
export const TOPIC_MIN_TIER = 'C';
export const REPLY_MIN_TIER = 'D';
export function tierIndex(t: string | null | undefined): number {
  const i = (TIER_ORDER as readonly string[]).indexOf(String(t || 'E').trim().toUpperCase());
  return i < 0 ? 0 : i;
}
const PAGE = 20;
// W913 — list sorts (v3 board): pinned topics lead the first page of every sort.
const SORTS = ['latest', 'hot', 'unanswered'] as const;
type Sort = (typeof SORTS)[number];
const LATEST_CURSOR_RE = /^(\d{1,16})\|([0-9a-fA-F-]{8,})$/;
const HOT_CURSOR_RE = /^(\d{1,9})\|(\d{1,16})\|([0-9a-fA-F-]{8,})$/;
const PINNED_MAX = 5;
const REPLIERS_MAX = 3;
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
  rank_tier: string | null;
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
  up_count?: number;          // W913
  pinned_at?: number | null;  // W913
  locked_at?: number | null;  // W914
}

interface Replier { alias: string; rank_label: string | null }
interface TopicExtra { voted: boolean; repliers: Replier[] }

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

/** Per-word profanity (W914: word-aware — "second", "Japan", "grape" are words, not slurs): true when the text is clean. */
export function textIsClean(text: string): boolean {
  const toks = text.split(/\s+/).filter(Boolean);
  for (const tok of toks) { if (isProfaneWord(tok)) return false; }
  // spaced-out obfuscation ("f u c k") — short texts only, joined
  if (text.length <= 20 && toks.length > 1 && isProfaneWord(toks.join(''))) return false;
  return true;
}

// ── W914 — junk + repeat helpers (exported for the tests) ───────────────
const URL_RE = /(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|app|co|gg|me|ly|xyz|info|dev|ai|us|uk|ca|tv|cc|link|site|online|shop|store|biz)\b/i;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
/** A run of 9–15 digits with phone punctuation between them reads as a phone number. */
export function looksLikePhone(text: string): boolean {
  const runs = text.match(/\+?[\d\s().-]{9,}/g) || [];
  return runs.some((r) => { const d = (r.match(/\d/g) || []).length; return d >= 9 && d <= 15; });
}
export function junkReason(text: string, kind: 'title' | 'body'): { code: string; detail: string } | null {
  if (kind === 'body') {
    const letters = (text.match(/\p{L}/gu) || []).length;
    if (text.trim().length < SPAM.BODY_MIN || letters < SPAM.MIN_LETTERS) {
      return { code: 'TOO_SHORT', detail: `Say a little more — at least ${SPAM.BODY_MIN} characters.` };
    }
  }
  if (EMAIL_RE.test(text)) return { code: 'LINKS_NOT_ALLOWED', detail: 'Emails are not allowed on the board.' };
  if (URL_RE.test(text)) return { code: 'LINKS_NOT_ALLOWED', detail: 'Links are not allowed on the board.' };
  if (looksLikePhone(text)) return { code: 'LINKS_NOT_ALLOWED', detail: 'Phone numbers are not allowed on the board.' };
  return null;
}
/** Case, spacing and punctuation do not make a post different. */
export function normText(s: string): string {
  return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
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
  const prof = await env.DB.prepare('SELECT rank_tier FROM public_profile_summary WHERE user_id = ? LIMIT 1')
    .bind(userId).first<{ rank_tier: string | null }>();
  return {
    consented: !!consent && Number(consent.version) >= BOARD_RULES_VERSION,
    muted_until: mute ? Number(mute.until) : null,
    role: mod && (mod.role === 'owner' || mod.role === 'mod') ? (mod.role as Role) : null,
    sim: !!user && typeof user.apple_sub === 'string' && user.apple_sub.startsWith('sim_test_'),
    rank_tier: prof && typeof prof.rank_tier === 'string' ? prof.rank_tier : null,
  };
}

/** What the client learns about itself on every read (W914 adds the spam knobs it preflights with). */
function meOut(me: Me) {
  return {
    consented: me.consented, muted_until: me.muted_until, role: me.role, rules_version: BOARD_RULES_VERSION,
    rank_tier: me.rank_tier || 'E', topic_min_tier: TOPIC_MIN_TIER, reply_min_tier: REPLY_MIN_TIER,
    limits: {
      topics_per_day: SPAM.TOPICS_PER_DAY, topic_cooldown_ms: SPAM.TOPIC_COOLDOWN_MS,
      replies_per_day: SPAM.REPLIES_PER_DAY, reply_cooldown_ms: SPAM.REPLY_COOLDOWN_MS,
      replies_per_topic_per_hour: SPAM.REPLIES_PER_TOPIC_PER_HOUR, body_min: SPAM.BODY_MIN,
    },
  };
}

/** The write gate every posting route shares: rate limit → sim → consent → mute → rank. */
async function writeGate(env: Env, session: SessionPayload, kind: 'topic' | 'reply'): Promise<{ me: Me } | { deny: Response }> {
  const rl = await env.RL_BOARD_WRITE.limit({ key: session.userId });
  if (!rl.success) return { deny: jsonError(429, 'RATE_LIMITED', 'Slow down.') };
  const me = await meState(env, session.userId);
  if (me.sim) return { deny: jsonError(403, 'SIM_READ_ONLY', 'Simulated hunters cannot post.') };
  if (!me.consented) return { deny: jsonError(403, 'CONSENT_REQUIRED', 'Read and accept the community rules first.') };
  if (me.muted_until) {
    return { deny: jsonError(403, 'MUTED', 'You are muted.', { muted_until: me.muted_until }) };
  }
  // W911 — rank gate (moderators exempt).
  const need = kind === 'topic' ? TOPIC_MIN_TIER : REPLY_MIN_TIER;
  if (!isModRole(me.role) && tierIndex(me.rank_tier) < tierIndex(need)) {
    return {
      deny: jsonError(403, 'RANK_TOO_LOW',
        kind === 'topic' ? `Reach ${need} rank to open a topic.` : `Reach ${need} rank to reply.`,
        { need, rank_tier: me.rank_tier || 'E' }),
    };
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

function topicOut(r: TopicRow, full: boolean, extra: TopicExtra = { voted: false, repliers: [] }) {
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
    // W913 — upvotes, pins, and the last distinct repliers (avatar stack).
    up_count: Number(r.up_count) || 0,
    voted: !!extra.voted,
    pinned: r.pinned_at != null,
    locked: r.locked_at != null,   // W914
    repliers: extra.repliers,
    author: authorOut(r),
  };
}

const TOPIC_COLS = `x.id, x.tag, x.title, x.body, x.created_at, x.last_activity_at, x.reply_count, x.hidden_at, x.deleted_at, x.up_count, x.pinned_at, x.locked_at`;

/** Which of these topics the caller upvoted. */
async function votedSet(env: Env, userId: string, ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!ids.length) return out;
  const rows = await env.DB.prepare(
    `SELECT topic_id FROM board_votes WHERE user_id = ? AND topic_id IN (${ids.map(() => '?').join(',')})`,
  ).bind(userId, ...ids).all<{ topic_id: string }>();
  for (const r of rows.results ?? []) out.add(r.topic_id);
  return out;
}

/** The last REPLIERS_MAX distinct visible repliers per topic, newest first (block-filtered). */
async function repliersMap(env: Env, userId: string, ids: string[]): Promise<Map<string, Replier[]>> {
  const out = new Map<string, Replier[]>();
  if (!ids.length) return out;
  const rows = await env.DB.prepare(
    `SELECT r.topic_id AS topic_id, u.alias AS alias, pps.rank_label AS rank_label, MAX(r.created_at) AS last_at
       FROM board_replies r
       JOIN users u ON u.id = r.author_id
       LEFT JOIN public_profile_summary pps ON pps.user_id = r.author_id
      WHERE r.topic_id IN (${ids.map(() => '?').join(',')})
        AND r.deleted_at IS NULL AND r.hidden_at IS NULL AND ${SIM_FILTER}
        AND r.author_id NOT IN (SELECT blocked_id FROM board_blocks WHERE blocker_id = ?)
        AND r.author_id NOT IN (SELECT blocker_id FROM board_blocks WHERE blocked_id = ?)
      GROUP BY r.topic_id, r.author_id
      ORDER BY last_at DESC`,
  ).bind(...ids, userId, userId).all<{ topic_id: string; alias: string; rank_label: string | null }>();
  for (const r of rows.results ?? []) {
    const list = out.get(r.topic_id) || [];
    if (list.length >= REPLIERS_MAX) continue;
    list.push({ alias: r.alias, rank_label: r.rank_label ?? null });
    out.set(r.topic_id, list);
  }
  return out;
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
  const sortRaw = url.searchParams.get('sort') || 'latest';
  if (!(SORTS as readonly string[]).includes(sortRaw)) return jsonError(400, 'INVALID_SORT', 'sort must be latest, hot or unanswered.');
  const sort = sortRaw as Sort;
  const cursorRaw = url.searchParams.get('cursor') || '';
  let cUp = 0; let cAt = 0; let cId = '';
  if (cursorRaw) {
    if (sort === 'hot') {
      const m = HOT_CURSOR_RE.exec(cursorRaw);
      if (!m) return jsonError(400, 'INVALID_CURSOR', 'Bad cursor.');
      cUp = Number(m[1]); cAt = Number(m[2]); cId = m[3];
    } else {
      const m = LATEST_CURSOR_RE.exec(cursorRaw);
      if (!m) return jsonError(400, 'INVALID_CURSOR', 'Bad cursor.');
      cAt = Number(m[1]); cId = m[2];
    }
  }
  const me = await meState(env, session.userId);
  const modView = isModRole(me.role) ? 1 : 0;
  const where = `x.deleted_at IS NULL
        AND ${SIM_FILTER}
        AND (? = 1 OR x.hidden_at IS NULL)
        AND (? = '' OR x.tag = ?)
        AND ${BLOCK_FILTER}`;
  const whereBinds = [modView, tag, tag, session.userId, session.userId];
  const firstPage = !cursorRaw;

  // W913 — pinned topics lead the first page of every sort; the keyset list excludes them.
  let pinned: TopicRow[] = [];
  if (firstPage) {
    const p = await env.DB.prepare(
      `SELECT ${TOPIC_COLS}, ${AUTHOR_COLS}
         FROM board_topics x${AUTHOR_JOIN}
        WHERE ${where}
          AND x.pinned_at IS NOT NULL
        ORDER BY x.pinned_at DESC
        LIMIT ${PINNED_MAX}`,
    ).bind(...whereBinds).all<TopicRow>();
    pinned = p.results ?? [];
  }
  const cursorClause = sort === 'hot'
    ? `(? = 0 OR x.up_count < ? OR (x.up_count = ? AND (x.last_activity_at < ? OR (x.last_activity_at = ? AND x.id < ?))))`
    : `(? = 0 OR x.last_activity_at < ? OR (x.last_activity_at = ? AND x.id < ?))`;
  const cursorBinds = sort === 'hot' ? [cursorRaw ? 1 : 0, cUp, cUp, cAt, cAt, cId] : [cursorRaw ? 1 : 0, cAt, cAt, cId];
  const order = sort === 'hot' ? 'x.up_count DESC, x.last_activity_at DESC, x.id DESC' : 'x.last_activity_at DESC, x.id DESC';
  const rows = await env.DB.prepare(
    `SELECT ${TOPIC_COLS}, ${AUTHOR_COLS}
       FROM board_topics x${AUTHOR_JOIN}
      WHERE ${where}
        AND x.pinned_at IS NULL${sort === 'unanswered' ? '\n        AND x.reply_count = 0' : ''}
        AND ${cursorClause}
      ORDER BY ${order}
      LIMIT ?`,
  )
    .bind(...whereBinds, ...cursorBinds, PAGE + 1)
    .all<TopicRow>();
  const list = rows.results ?? [];
  const page = list.slice(0, PAGE);
  const last = page[page.length - 1];
  const all = pinned.concat(page);
  const ids = all.map((r) => r.id);
  const [voted, repliers] = await Promise.all([votedSet(env, session.userId, ids), repliersMap(env, session.userId, ids)]);

  // Tag counts for the filter rail (visible topics, every tag) — first page only.
  let counts: { all: number; improvement: number; bug: number; talk: number } | undefined;
  if (firstPage) {
    const c = await env.DB.prepare(
      `SELECT x.tag AS tag, COUNT(*) AS n
         FROM board_topics x${AUTHOR_JOIN}
        WHERE ${where}
        GROUP BY x.tag`,
    ).bind(modView, '', '', session.userId, session.userId).all<{ tag: string; n: number }>();
    counts = { all: 0, improvement: 0, bug: 0, talk: 0 };
    for (const r of c.results ?? []) {
      const n = Number(r.n) || 0;
      if (isTag(r.tag)) counts[r.tag] = n;
      counts.all += n;
    }
  }
  let next_cursor: string | null = null;
  if (list.length > PAGE && last) {
    next_cursor = sort === 'hot'
      ? `${Number(last.up_count) || 0}|${Number(last.last_activity_at)}|${last.id}`
      : `${Number(last.last_activity_at)}|${last.id}`;
  }
  return jsonOk({
    topics: all.map((r) => topicOut(r, false, { voted: voted.has(r.id), repliers: repliers.get(r.id) || [] })),
    next_cursor,
    sort,
    counts,
    me: meOut(me),
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
    `SELECT ${TOPIC_COLS},
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
  const [voted, repliers] = await Promise.all([votedSet(env, session.userId, [topicId]), repliersMap(env, session.userId, [topicId])]);
  return jsonOk({
    topic: topicOut(topic, true, { voted: voted.has(topicId), repliers: repliers.get(topicId) || [] }),
    replies: page.map(replyOut),
    next_cursor: list.length > REPLY_PAGE && last ? String(Number(last.created_at)) : null,
    me: meOut(me),
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

// ── W914 — the spam guard: junk → caps/cooldowns → repeats; every rejection is a strike ──
async function autoMute(env: Env, userId: string, until: number, reason: string, now: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO board_mutes (user_id, until, by_user_id, reason, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET until = MAX(board_mutes.until, excluded.until), by_user_id = excluded.by_user_id,
                                         reason = excluded.reason, created_at = excluded.created_at`,
  ).bind(userId, until, 'system', reason, now).run();
}
async function pushMods(env: Env, exceptUserId: string, title: string, body: string, type: string, data: Record<string, string>, ctx?: ExecutionContext): Promise<void> {
  const mods = await env.DB.prepare('SELECT user_id FROM board_moderators').bind().all<{ user_id: string }>();
  const push = async () => {
    for (const m of mods.results ?? []) {
      if (m.user_id === exceptUserId) continue;
      await notifyUser(env, m.user_id, { title, body, type, data });
    }
  };
  if (ctx) ctx.waitUntil(push()); else await push();
}
/** Record a strike; at SPAM.STRIKES_TO_MUTE inside the window the hunter is muted for a day. Returns muted_until or null. */
async function strike(env: Env, userId: string, code: string, now: number, ctx?: ExecutionContext): Promise<number | null> {
  await env.DB.prepare('INSERT INTO board_strikes (user_id, reason, created_at) VALUES (?, ?, ?)').bind(userId, code, now).run();
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM board_strikes WHERE user_id = ? AND created_at > ?')
    .bind(userId, now - SPAM.STRIKE_WINDOW_MS).first<{ n: number }>();
  const n = Number(row?.n) || 0;
  if (n < SPAM.STRIKES_TO_MUTE) return null;
  const until = now + SPAM.STRIKE_MUTE_MS;
  await autoMute(env, userId, until, `auto: spam (${n} rejected posts in a day)`, now);
  await pushMods(env, userId, 'Spam guard', `A hunter was muted for a day after ${n} rejected posts. Open the Community board to review.`, 'board_spam', { user_id: userId }, ctx);
  return until;
}
async function spamGate(
  env: Env, session: SessionPayload, me: Me, kind: 'topic' | 'reply', topicId: string,
  title: string, text: string, ctx?: ExecutionContext,
): Promise<{ deny: Response } | null> {
  if (isModRole(me.role)) return null;
  const now = Date.now();
  const reject = async (status: number, code: string, detail: string, extra?: Record<string, unknown>) => {
    const mutedUntil = await strike(env, session.userId, code, now, ctx);
    if (mutedUntil) return { deny: jsonError(403, 'MUTED', 'Too many rejected posts — you are muted for a day.', { muted_until: mutedUntil, auto: true }) };
    return { deny: jsonError(status, code, detail, extra) };
  };
  // 1. junk — links, emails, phone numbers, nothing-posts
  const junk = (title ? junkReason(title, 'title') : null) || junkReason(text, 'body');
  if (junk) return reject(400, junk.code, junk.detail);
  // 2. caps + cooldowns
  if (kind === 'topic') {
    const rows = await env.DB.prepare('SELECT created_at FROM board_topics WHERE author_id = ? AND created_at > ? ORDER BY created_at DESC')
      .bind(session.userId, now - DAY_MS).all<{ created_at: number }>();
    const list = (rows.results ?? []).map((r) => Number(r.created_at));
    if (list.length && now - list[0]! < SPAM.TOPIC_COOLDOWN_MS) {
      return reject(429, 'COOLDOWN', 'Give it a few minutes before the next topic.', { retry_after_ms: SPAM.TOPIC_COOLDOWN_MS - (now - list[0]!) });
    }
    if (list.length >= SPAM.TOPICS_PER_DAY) {
      return reject(429, 'TOO_MANY_TOPICS_TODAY', `${SPAM.TOPICS_PER_DAY} topics a day is the limit.`, { retry_after_ms: list[list.length - 1]! + DAY_MS - now });
    }
  } else {
    const rows = await env.DB.prepare('SELECT created_at, topic_id FROM board_replies WHERE author_id = ? AND created_at > ? ORDER BY created_at DESC')
      .bind(session.userId, now - DAY_MS).all<{ created_at: number; topic_id: string }>();
    const list = rows.results ?? [];
    if (list.length && now - Number(list[0]!.created_at) < SPAM.REPLY_COOLDOWN_MS) {
      return reject(429, 'COOLDOWN', 'Give it a moment before the next reply.', { retry_after_ms: SPAM.REPLY_COOLDOWN_MS - (now - Number(list[0]!.created_at)) });
    }
    if (list.length >= SPAM.REPLIES_PER_DAY) {
      return reject(429, 'TOO_MANY_REPLIES_TODAY', `${SPAM.REPLIES_PER_DAY} replies a day is the limit.`, { retry_after_ms: Number(list[list.length - 1]!.created_at) + DAY_MS - now });
    }
    const onTopic = list.filter((r) => r.topic_id === topicId && now - Number(r.created_at) < HOUR_MS);
    if (onTopic.length >= SPAM.REPLIES_PER_TOPIC_PER_HOUR) {
      return reject(429, 'TOPIC_FLOOD', `${SPAM.REPLIES_PER_TOPIC_PER_HOUR} replies an hour on one topic is the limit — let others speak.`, { retry_after_ms: Number(onTopic[onTopic.length - 1]!.created_at) + HOUR_MS - now });
    }
  }
  // 3. repeats — the same text as anything this hunter posted in the last week
  const since = now - SPAM.DUPLICATE_WINDOW_MS;
  const [pt, pr] = await Promise.all([
    env.DB.prepare('SELECT title, body FROM board_topics WHERE author_id = ? AND created_at > ? ORDER BY created_at DESC LIMIT ?')
      .bind(session.userId, since, SPAM.DUPLICATE_LOOKBACK).all<{ title: string; body: string }>(),
    env.DB.prepare('SELECT body FROM board_replies WHERE author_id = ? AND created_at > ? ORDER BY created_at DESC LIMIT ?')
      .bind(session.userId, since, SPAM.DUPLICATE_LOOKBACK).all<{ body: string }>(),
  ]);
  const seen = new Set<string>();
  for (const r of pt.results ?? []) { seen.add(normText(`${r.title || ''} ${r.body || ''}`)); seen.add(normText(r.body || '')); }
  for (const r of pr.results ?? []) seen.add(normText(r.body || ''));
  seen.delete('');
  const cand = kind === 'topic' ? [normText(`${title} ${text}`), normText(text)] : [normText(text)];
  if (cand.some((c) => c && seen.has(c))) return reject(400, 'DUPLICATE', 'You already posted this.');
  return null;
}

export async function handleBoardTopicPost(request: Request, env: Env, session: SessionPayload, ctx?: ExecutionContext): Promise<Response> {
  const gate = await writeGate(env, session, 'topic');
  if ('deny' in gate) return gate.deny;
  const body = await readJson<{ tag?: unknown; title?: unknown; body?: unknown }>(request);
  if (!body) return jsonError(400, 'BAD_JSON', 'Invalid JSON body.');
  if (!isTag(body.tag)) return jsonError(400, 'INVALID_TAG', 'tag must be improvement, bug or talk.');
  const title = clampText(body.title, TITLE_MAX);
  const text = clampText(body.body, BODY_MAX);
  if (!title) return jsonError(400, 'MISSING_TITLE', 'Give the topic a title.');
  if (!text) return jsonError(400, 'MISSING_BODY', 'Say something.');
  if (!textIsClean(title) || !textIsClean(text)) return jsonError(400, 'OBJECTIONABLE', 'That contains language the board does not allow.');
  const spam = await spamGate(env, session, gate.me, 'topic', '', title, text, ctx);   // W914
  if (spam) return spam.deny;
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO board_topics (id, author_id, tag, title, body, created_at, last_activity_at, reply_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
  ).bind(id, session.userId, body.tag, title, text, now, now).run();
  return jsonOk({ ok: true, id, created_at: now });
}

export async function handleBoardReplyPost(request: Request, env: Env, session: SessionPayload, topicId: string, ctx?: ExecutionContext): Promise<Response> {
  if (!ID_RE.test(topicId)) return jsonError(404, 'NOT_FOUND', 'No such topic.');
  const gate = await writeGate(env, session, 'reply');
  if ('deny' in gate) return gate.deny;
  const body = await readJson<{ body?: unknown }>(request);
  if (!body) return jsonError(400, 'BAD_JSON', 'Invalid JSON body.');
  const text = clampText(body.body, BODY_MAX);
  if (!text) return jsonError(400, 'MISSING_BODY', 'Say something.');
  if (!textIsClean(text)) return jsonError(400, 'OBJECTIONABLE', 'That contains language the board does not allow.');
  const topic = await env.DB.prepare('SELECT id, hidden_at, deleted_at, locked_at FROM board_topics WHERE id = ? LIMIT 1')
    .bind(topicId).first<{ id: string; hidden_at: number | null; deleted_at: number | null; locked_at: number | null }>();
  if (!topic || topic.deleted_at != null) return jsonError(404, 'NOT_FOUND', 'No such topic.');
  if (topic.hidden_at != null && !isModRole(gate.me.role)) return jsonError(404, 'NOT_FOUND', 'No such topic.');
  if (topic.locked_at != null && !isModRole(gate.me.role)) return jsonError(403, 'TOPIC_LOCKED', 'This topic is locked.');   // W914
  const spam = await spamGate(env, session, gate.me, 'reply', topicId, '', text, ctx);   // W914
  if (spam) return spam.deny;
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
  // W914 — a hunter whose posts keep getting auto-hidden is muted for a week (moderators never).
  let autoMuted = false;
  if (autoHidden) {
    const since = now - SPAM.HIDDEN_WINDOW_MS;
    const h = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM board_topics WHERE author_id = ? AND hidden_by = 'auto' AND hidden_at > ?)
            + (SELECT COUNT(*) FROM board_replies WHERE author_id = ? AND hidden_by = 'auto' AND hidden_at > ?) AS n`,
    ).bind(target.author_id, since, target.author_id, since).first<{ n: number }>();
    if ((Number(h?.n) || 0) >= SPAM.HIDDEN_TO_MUTE) {
      const targetMod = await env.DB.prepare('SELECT role FROM board_moderators WHERE user_id = ? LIMIT 1')
        .bind(target.author_id).first<{ role: string }>();
      if (!targetMod) {
        await autoMute(env, target.author_id, now + SPAM.HIDDEN_MUTE_MS, `auto: reports (${Number(h?.n)} posts hidden in a week)`, now);
        autoMuted = true;
      }
    }
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
          body: `A ${kind} was reported for ${reason}${autoHidden ? ' and is now hidden' : ''}${autoMuted ? '; the author is muted for a week' : ''}. Open the Community board to review it.`,
          type: 'board_report',
          data: { kind, id },
        });
      }
    };
    if (ctx) ctx.waitUntil(push()); else await push();
  }
  return jsonOk({ ok: true, already: !fresh, reports: n, auto_hidden: autoHidden, auto_muted: autoMuted });
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

// ── W913 — upvotes + pins ──────────────────────────────────────────────

/** Toggle the caller's upvote on a topic. Sims are read-only; hidden topics only for moderators. */
export async function handleBoardVotePost(_request: Request, env: Env, session: SessionPayload, topicId: string): Promise<Response> {
  if (!ID_RE.test(topicId)) return jsonError(404, 'NOT_FOUND', 'No such topic.');
  const rl = await env.RL_BOARD_WRITE.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  const me = await meState(env, session.userId);
  if (me.sim) return jsonError(403, 'SIM_READ_ONLY', 'Simulated hunters cannot vote.');
  const topic = await env.DB.prepare('SELECT id, hidden_at, deleted_at FROM board_topics WHERE id = ? LIMIT 1')
    .bind(topicId).first<{ id: string; hidden_at: number | null; deleted_at: number | null }>();
  if (!topic || topic.deleted_at != null) return jsonError(404, 'NOT_FOUND', 'No such topic.');
  if (topic.hidden_at != null && !isModRole(me.role)) return jsonError(404, 'NOT_FOUND', 'No such topic.');
  const ins = await env.DB.prepare('INSERT OR IGNORE INTO board_votes (topic_id, user_id, created_at) VALUES (?, ?, ?)')
    .bind(topicId, session.userId, Date.now()).run();
  let voted = true;
  if (!(ins.meta && ins.meta.changes)) {
    await env.DB.prepare('DELETE FROM board_votes WHERE topic_id = ? AND user_id = ?').bind(topicId, session.userId).run();
    voted = false;
  }
  // Recount from the truth table so the denormalised count can never drift.
  await env.DB.prepare('UPDATE board_topics SET up_count = (SELECT COUNT(*) FROM board_votes WHERE topic_id = ?) WHERE id = ?')
    .bind(topicId, topicId).run();
  const row = await env.DB.prepare('SELECT up_count FROM board_topics WHERE id = ? LIMIT 1').bind(topicId).first<{ up_count: number }>();
  return jsonOk({ ok: true, voted, up_count: Number(row?.up_count) || 0 });
}

/** Moderators pin / unpin a topic (toggle). Pinned topics lead the first page of every sort. */
export async function handleBoardPinPost(_request: Request, env: Env, session: SessionPayload, topicId: string): Promise<Response> {
  if (!ID_RE.test(topicId)) return jsonError(404, 'NOT_FOUND', 'No such topic.');
  const gate = await modGate(env, session);
  if ('deny' in gate) return gate.deny;
  const row = await env.DB.prepare('SELECT pinned_at FROM board_topics WHERE id = ? AND deleted_at IS NULL LIMIT 1')
    .bind(topicId).first<{ pinned_at: number | null }>();
  if (!row) return jsonError(404, 'NOT_FOUND', 'No such topic.');
  const pin = row.pinned_at == null;
  await env.DB.prepare('UPDATE board_topics SET pinned_at = ?, pinned_by = ? WHERE id = ?')
    .bind(pin ? Date.now() : null, pin ? session.userId : null, topicId).run();
  return jsonOk({ ok: true, pinned: pin });
}

// ── W914 — moderator tools: LOCK a topic, PURGE a hunter's recent posts ──
export async function handleBoardTopicLock(_request: Request, env: Env, session: SessionPayload, topicId: string): Promise<Response> {
  if (!ID_RE.test(topicId)) return jsonError(404, 'NOT_FOUND', 'No such topic.');
  const gate = await modGate(env, session);
  if ('deny' in gate) return gate.deny;
  const row = await env.DB.prepare('SELECT locked_at FROM board_topics WHERE id = ? AND deleted_at IS NULL LIMIT 1')
    .bind(topicId).first<{ locked_at: number | null }>();
  if (!row) return jsonError(404, 'NOT_FOUND', 'No such topic.');
  const lock = row.locked_at == null;
  await env.DB.prepare('UPDATE board_topics SET locked_at = ?, locked_by = ? WHERE id = ?')
    .bind(lock ? Date.now() : null, lock ? session.userId : null, topicId).run();
  return jsonOk({ ok: true, locked: lock });
}

/** Soft-delete everything a hunter posted in the last N hours (default 24, max 168). One tap after a spam burst. */
export async function handleBoardPurgePost(request: Request, env: Env, session: SessionPayload): Promise<Response> {
  const gate = await modGate(env, session);
  if ('deny' in gate) return gate.deny;
  const body = await readJson<{ user_id?: unknown; hours?: unknown }>(request);
  const target = body && typeof body.user_id === 'string' && USER_ID_RE.test(body.user_id) ? body.user_id : null;
  if (!target) return jsonError(400, 'INVALID_TARGET', 'user_id required.');
  if (target === session.userId) return jsonError(400, 'SELF_PURGE', 'Delete your own posts one by one.');
  const hours = body && Number.isInteger(body.hours) ? Number(body.hours) : 24;
  if (hours < 1 || hours > SPAM.PURGE_MAX_HOURS) return jsonError(400, 'INVALID_HOURS', `hours must be 1–${SPAM.PURGE_MAX_HOURS}.`);
  const targetMod = await env.DB.prepare('SELECT role FROM board_moderators WHERE user_id = ? LIMIT 1')
    .bind(target).first<{ role: string }>();
  if (targetMod) return jsonError(403, 'CANNOT_PURGE_MODERATOR', 'Moderators cannot be purged.');
  const now = Date.now();
  const since = now - hours * HOUR_MS;
  const t = await env.DB.prepare('UPDATE board_topics SET deleted_at = ?, deleted_by = ? WHERE author_id = ? AND created_at > ? AND deleted_at IS NULL')
    .bind(now, session.userId, target, since).run();
  const r = await env.DB.prepare("UPDATE board_replies SET deleted_at = ?, deleted_by = ?, body = '' WHERE author_id = ? AND created_at > ? AND deleted_at IS NULL")
    .bind(now, session.userId, target, since).run();
  await env.DB.prepare(
    `UPDATE board_topics SET reply_count = (SELECT COUNT(*) FROM board_replies r WHERE r.topic_id = board_topics.id AND r.deleted_at IS NULL)
      WHERE id IN (SELECT DISTINCT topic_id FROM board_replies WHERE author_id = ? AND created_at > ?)`,
  ).bind(target, since).run();
  return jsonOk({ ok: true, topics: Number(t.meta?.changes) || 0, replies: Number(r.meta?.changes) || 0 });
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
