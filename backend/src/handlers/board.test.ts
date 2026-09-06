/**
 * board.test.ts — W907 THE COMMUNITY BOARD. Substring-routed, stateful D1
 * mock in the house style; notifyUser spied via the apns mock. Pins the
 * Apple 1.2 pillars (consent, filter, report auto-hide at the 3rd DISTINCT
 * reporter, symmetric block) and the moderation authz ladder.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../lib/apns', () => ({ notifyUser: vi.fn(async () => {}) }));
import { notifyUser } from '../lib/apns';
import {
  handleAdminBoardOwner,
  handleBoardBlockPost,
  handleBoardConsentPost,
  handleBoardModeratorGrant,
  handleBoardMutePost,
  handleBoardReplyPost,
  handleBoardReportPost,
  handleBoardTopicDelete,
  handleBoardTopicGet,
  handleBoardTopicHide,
  handleBoardTopicPost,
  handleBoardTopicsGet,
  handleBoardVotePost,
  handleBoardPinPost,
  handleBoardTopicLock,
  handleBoardPurgePost,
  junkReason,
  normText,
  SPAM,
  textIsClean,
  TOPIC_MIN_TIER,
  REPLY_MIN_TIER,
  AUTO_HIDE_REPORTS,
  BODY_MAX,
} from './board';
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';

const mockNotify = vi.mocked(notifyUser);

interface State {
  users: Record<string, { alias: string; apple_sub: string }>;
  ranks: Record<string, string>;   // W911 — public_profile_summary.rank_tier per user
  consents: Set<string>;
  mutes: Record<string, number>;
  mods: Record<string, 'owner' | 'mod'>;
  topics: Record<string, { author_id: string; hidden_at: number | null; deleted_at: number | null; reply_count: number; last_activity_at: number; up_count?: number; pinned_at?: number | null; created_at?: number; title?: string; body?: string; hidden_by?: string | null; locked_at?: number | null }>;
  votes: Set<string>;     // W913 — `${topic}|${user}`
  replies: Record<string, { topic_id: string; deleted_at: number | null; author_id?: string; created_at?: number; body?: string }>;
  strikes: { user_id: string; created_at: number }[];   // W914
  reports: Set<string>;   // `${kind}|${id}|${reporter}`
  blocks: Set<string>;    // `${blocker}|${blocked}`
  calls: { sql: string; binds: unknown[] }[];
}

function fresh(): State {
  return {
    users: {
      'u-me': { alias: 'Richie', apple_sub: 'apple-1' },
      'u-ren': { alias: 'RenDIESEL', apple_sub: 'apple-2' },
      'u-x': { alias: 'Guake', apple_sub: 'apple-3' },
      'u-y': { alias: 'Minn', apple_sub: 'apple-4' },
      'u-sim': { alias: 'shadowmonarch_k', apple_sub: 'sim_test_alpha' },
    },
    // W911 — Richie A, Rendell S, Guake C (can open topics), Minn D (can reply, not open), sim E
    ranks: { 'u-me': 'A', 'u-ren': 'S', 'u-x': 'C', 'u-y': 'D', 'u-sim': 'E' },
    consents: new Set(['u-me', 'u-ren', 'u-x', 'u-y', 'u-sim']),
    mutes: {},
    mods: {},
    topics: {},
    replies: {},
    reports: new Set(),
    blocks: new Set(),
    votes: new Set(),
    strikes: [],
    calls: [],
  };
}

function makeEnv(st: State, rlWriteOk = true): Env {
  const db = {
    prepare: (sql: string) => ({
      bind: (...binds: unknown[]) => {
        st.calls.push({ sql, binds });
        const api = {
          first: async () => {
            if (/FROM board_consents/.test(sql)) return st.consents.has(binds[0] as string) ? { version: 1 } : null;
            if (/FROM board_mutes/.test(sql)) {
              const u = st.mutes[binds[0] as string];
              return u && u > (binds[1] as number) ? { until: u } : null;
            }
            if (/SELECT role FROM board_moderators/.test(sql)) {
              const r = st.mods[binds[0] as string]; return r ? { role: r } : null;
            }
            if (/SELECT user_id FROM board_moderators WHERE role = 'owner'/.test(sql)) {
              const o = Object.keys(st.mods).find((k) => st.mods[k] === 'owner'); return o ? { user_id: o } : null;
            }
            if (/SELECT rank_tier FROM public_profile_summary/.test(sql)) {
              const t = st.ranks[binds[0] as string]; return t ? { rank_tier: t } : null;
            }
            if (/SELECT apple_sub FROM users/.test(sql)) {
              const u = st.users[binds[0] as string]; return u ? { apple_sub: u.apple_sub } : null;
            }
            if (/SELECT id, alias FROM users WHERE LOWER/.test(sql)) {
              const norm = binds[0] as string;
              const hit = Object.entries(st.users).find(([, u]) => u.alias.toLowerCase().replace(/\s+/g, '') === norm);
              return hit ? { id: hit[0], alias: hit[1].alias } : null;
            }
            if (/SELECT 1 AS one FROM users/.test(sql)) return st.users[binds[0] as string] ? { one: 1 } : null;
            if (/SELECT id, hidden_at, deleted_at(, locked_at)? FROM board_topics/.test(sql)) {
              const t = st.topics[binds[0] as string]; return t ? { id: binds[0], hidden_at: t.hidden_at, deleted_at: t.deleted_at, locked_at: t.locked_at ?? null } : null;
            }
            if (/SELECT locked_at FROM board_topics/.test(sql)) {
              const t = st.topics[binds[0] as string]; return t && t.deleted_at == null ? { locked_at: t.locked_at ?? null } : null;
            }
            if (/SELECT COUNT\(\*\) AS n FROM board_strikes/.test(sql)) {
              return { n: st.strikes.filter((k) => k.user_id === binds[0] && k.created_at > (binds[1] as number)).length };
            }
            if (/hidden_by = 'auto' AND hidden_at >/.test(sql)) {
              const n = Object.values(st.topics).filter((t) => t.author_id === binds[0] && t.hidden_by === 'auto' && (t.hidden_at || 0) > (binds[1] as number)).length;
              return { n };
            }
            if (/SELECT id, author_id, hidden_at FROM board_topics/.test(sql)) {
              const t = st.topics[binds[0] as string];
              return t && t.deleted_at == null ? { id: binds[0], author_id: t.author_id, hidden_at: t.hidden_at } : null;
            }
            if (/SELECT id, author_id, hidden_at FROM board_replies/.test(sql)) {
              const r = st.replies[binds[0] as string];
              return r && r.deleted_at == null ? { id: binds[0], author_id: 'u-x', hidden_at: null } : null;
            }
            if (/SELECT COUNT\(\*\) AS n FROM board_reports/.test(sql)) {
              const prefix = `${binds[0]}|${binds[1]}|`;
              return { n: [...st.reports].filter((k) => k.startsWith(prefix)).length };
            }
            if (/SELECT pinned_at FROM board_topics/.test(sql)) {
              const t = st.topics[binds[0] as string]; return t && t.deleted_at == null ? { pinned_at: t.pinned_at ?? null } : null;
            }
            if (/SELECT up_count FROM board_topics/.test(sql)) {
              const t = st.topics[binds[0] as string]; return t ? { up_count: t.up_count || 0 } : null;
            }
            if (/SELECT hidden_at FROM board_topics/.test(sql)) {
              const t = st.topics[binds[0] as string]; return t && t.deleted_at == null ? { hidden_at: t.hidden_at } : null;
            }
            if (/SELECT topic_id FROM board_replies/.test(sql)) {
              const r = st.replies[binds[0] as string]; return r && r.deleted_at == null ? { topic_id: r.topic_id } : null;
            }
            if (/FROM board_topics x/.test(sql)) {
              // topic detail read — return the row when it exists and passes hide/block rules
              const id = binds[0] as string; const t = st.topics[id]; const modView = binds[1] as number;
              if (!t || t.deleted_at != null) return null;
              if (t.hidden_at != null && !modView) return null;
              const me = binds[2] as string;
              if (st.blocks.has(`${me}|${t.author_id}`) || st.blocks.has(`${t.author_id}|${me}`)) return null;
              return { id, tag: 'talk', title: 'T', body: 'B', created_at: 1, last_activity_at: t.last_activity_at, reply_count: t.reply_count, hidden_at: t.hidden_at, deleted_at: null, up_count: t.up_count || 0, pinned_at: t.pinned_at ?? null, author_id: t.author_id, alias: st.users[t.author_id].alias, rank_label: 'E', founder_seq: 0, is_mod: st.mods[t.author_id] ? 1 : 0 };
            }
            return null;
          },
          run: async () => {
            if (/INSERT INTO board_consents/.test(sql)) { st.consents.add(binds[0] as string); return ok(1); }
            if (/INSERT INTO board_topics/.test(sql)) {
              st.topics[binds[0] as string] = { author_id: binds[1] as string, hidden_at: null, deleted_at: null, reply_count: 0, last_activity_at: binds[6] as number, up_count: 0, pinned_at: null, created_at: binds[5] as number, title: binds[3] as string, body: binds[4] as string };
              return ok(1);
            }
            if (/INSERT OR IGNORE INTO board_votes/.test(sql)) {
              const k = `${binds[0]}|${binds[1]}`; if (st.votes.has(k)) return ok(0); st.votes.add(k); return ok(1);
            }
            if (/DELETE FROM board_votes/.test(sql)) { st.votes.delete(`${binds[0]}|${binds[1]}`); return ok(1); }
            if (/UPDATE board_topics SET up_count/.test(sql)) {
              const t = st.topics[binds[1] as string]; if (t) t.up_count = [...st.votes].filter((k) => k.startsWith(`${binds[1]}|`)).length; return ok(1);
            }
            if (/UPDATE board_topics SET pinned_at/.test(sql)) {
              const t = st.topics[binds[2] as string]; if (t) t.pinned_at = binds[0] as number | null; return ok(1);
            }
            if (/INSERT INTO board_replies/.test(sql)) { st.replies[binds[0] as string] = { topic_id: binds[1] as string, deleted_at: null, author_id: binds[2] as string, body: binds[3] as string, created_at: binds[4] as number }; return ok(1); }
            if (/INSERT INTO board_strikes/.test(sql)) { st.strikes.push({ user_id: binds[0] as string, created_at: binds[2] as number }); return ok(1); }
            if (/UPDATE board_topics SET locked_at/.test(sql)) { const t = st.topics[binds[2] as string]; if (t) t.locked_at = binds[0] as number | null; return ok(1); }
            if (/UPDATE board_topics SET deleted_at = \?, deleted_by = \? WHERE author_id/.test(sql)) {
              let n = 0; for (const t of Object.values(st.topics)) if (t.author_id === binds[2] && (t.created_at || 0) > (binds[3] as number) && t.deleted_at == null) { t.deleted_at = binds[0] as number; n++; }
              return ok(n);
            }
            if (/UPDATE board_replies SET deleted_at = \?, deleted_by = \?, body = '' WHERE author_id/.test(sql)) {
              let n = 0; for (const r of Object.values(st.replies)) if (r.author_id === binds[2] && (r.created_at || 0) > (binds[3] as number) && r.deleted_at == null) { r.deleted_at = binds[0] as number; r.body = ''; n++; }
              return ok(n);
            }
            if (/UPDATE board_topics SET reply_count = \(SELECT COUNT/.test(sql)) {
              for (const [id, t] of Object.entries(st.topics)) t.reply_count = Object.values(st.replies).filter((r) => r.topic_id === id && r.deleted_at == null).length;
              return ok(1);
            }
            if (/UPDATE board_topics SET reply_count = reply_count \+ 1/.test(sql)) { const t = st.topics[binds[1] as string]; if (t) { t.reply_count++; t.last_activity_at = binds[0] as number; } return ok(1); }
            if (/INSERT OR IGNORE INTO board_reports/.test(sql)) {
              const k = `${binds[0]}|${binds[1]}|${binds[2]}`; if (st.reports.has(k)) return ok(0); st.reports.add(k); return ok(1);
            }
            if (/SET hidden_at = \?, hidden_by = 'auto'/.test(sql)) {
              const t = st.topics[binds[1] as string]; if (t && t.hidden_at == null) { t.hidden_at = binds[0] as number; t.hidden_by = 'auto'; return ok(1); } return ok(0);
            }
            if (/INSERT OR IGNORE INTO board_blocks/.test(sql)) { st.blocks.add(`${binds[0]}|${binds[1]}`); return ok(1); }
            if (/DELETE FROM board_blocks/.test(sql)) { st.blocks.delete(`${binds[0]}|${binds[1]}`); return ok(1); }
            if (/UPDATE board_topics SET deleted_at/.test(sql)) {
              const t = st.topics[binds[2] as string]; if (t && t.deleted_at == null) { t.deleted_at = binds[0] as number; return ok(1); } return ok(0);
            }
            if (/UPDATE board_topics SET hidden_at = \?, hidden_by = \? WHERE id = \?/.test(sql)) {
              const t = st.topics[binds[2] as string]; if (t) t.hidden_at = binds[0] as number | null; return ok(1);
            }
            if (/INSERT INTO board_mutes/.test(sql)) { st.mutes[binds[0] as string] = binds[1] as number; return ok(1); }
            if (/DELETE FROM board_mutes/.test(sql)) { delete st.mutes[binds[0] as string]; return ok(1); }
            if (/INSERT OR IGNORE INTO board_moderators/.test(sql)) { if (!st.mods[binds[0] as string]) st.mods[binds[0] as string] = 'mod'; return ok(1); }
            if (/DELETE FROM board_moderators/.test(sql)) { if (st.mods[binds[0] as string] === 'mod') delete st.mods[binds[0] as string]; return ok(1); }
            if (/INSERT INTO board_moderators/.test(sql)) { st.mods[binds[0] as string] = 'owner'; return ok(1); }
            return ok(1);
          },
          all: async () => {
            if (/SELECT user_id FROM board_moderators/.test(sql)) return { results: Object.keys(st.mods).map((user_id) => ({ user_id })), success: true, meta: {} };
            if (/SELECT created_at FROM board_topics WHERE author_id/.test(sql)) {
              const results = Object.values(st.topics).filter((t) => t.author_id === binds[0] && (t.created_at || 0) > (binds[1] as number))
                .map((t) => ({ created_at: t.created_at || 0 })).sort((a, b) => b.created_at - a.created_at);
              return { results, success: true, meta: {} };
            }
            if (/SELECT created_at, topic_id FROM board_replies WHERE author_id/.test(sql)) {
              const results = Object.values(st.replies).filter((r) => r.author_id === binds[0] && (r.created_at || 0) > (binds[1] as number))
                .map((r) => ({ created_at: r.created_at || 0, topic_id: r.topic_id })).sort((a, b) => b.created_at - a.created_at);
              return { results, success: true, meta: {} };
            }
            if (/SELECT title, body FROM board_topics WHERE author_id/.test(sql)) {
              const results = Object.values(st.topics).filter((t) => t.author_id === binds[0] && (t.created_at || 0) > (binds[1] as number))
                .sort((a, b) => (b.created_at || 0) - (a.created_at || 0)).slice(0, binds[2] as number).map((t) => ({ title: t.title || '', body: t.body || '' }));
              return { results, success: true, meta: {} };
            }
            if (/SELECT body FROM board_replies WHERE author_id/.test(sql)) {
              const results = Object.values(st.replies).filter((r) => r.author_id === binds[0] && (r.created_at || 0) > (binds[1] as number))
                .sort((a, b) => (b.created_at || 0) - (a.created_at || 0)).slice(0, binds[2] as number).map((r) => ({ body: r.body || '' }));
              return { results, success: true, meta: {} };
            }
            if (/SELECT topic_id FROM board_votes/.test(sql)) {
              const uid = binds[0] as string;
              const results = [...st.votes].filter((k) => k.endsWith(`|${uid}`)).map((k) => ({ topic_id: k.split('|')[0] }));
              return { results, success: true, meta: {} };
            }
            if (/FROM board_topics x/.test(sql)) {
              const modView = binds[0] as number; const tag = binds[1] as string; const me = binds[3] as string;
              const wantPinned = /x\.pinned_at IS NOT NULL/.test(sql);
              const wantUnpinned = /x\.pinned_at IS NULL/.test(sql);
              const unanswered = /x\.reply_count = 0/.test(sql);
              const isCount = /COUNT\(\*\) AS n\s+FROM board_topics x/.test(sql);
              let entries = Object.entries(st.topics)
                .filter(([, t]) => t.deleted_at == null && (modView || t.hidden_at == null))
                .filter(([, t]) => !st.blocks.has(`${me}|${t.author_id}`) && !st.blocks.has(`${t.author_id}|${me}`))
                .filter(([, t]) => !st.users[t.author_id].apple_sub.startsWith('sim_test_'))
                .filter(() => !tag || tag === 'talk');
              if (isCount) return { results: entries.length ? [{ tag: 'talk', n: entries.length }] : [], success: true, meta: {} };
              if (wantPinned) entries = entries.filter(([, t]) => t.pinned_at != null);
              if (wantUnpinned) entries = entries.filter(([, t]) => t.pinned_at == null);
              if (unanswered) entries = entries.filter(([, t]) => !t.reply_count);
              if (/ORDER BY x\.up_count DESC/.test(sql)) entries.sort((a, b) => (b[1].up_count || 0) - (a[1].up_count || 0));
              const results = entries
                .map(([id, t]) => ({ id, tag: 'talk', title: 'T', body: 'B', created_at: 1, last_activity_at: t.last_activity_at, reply_count: t.reply_count, hidden_at: t.hidden_at, deleted_at: null, up_count: t.up_count || 0, pinned_at: t.pinned_at ?? null, locked_at: t.locked_at ?? null, author_id: t.author_id, alias: st.users[t.author_id].alias, rank_label: 'E', founder_seq: 0, is_mod: st.mods[t.author_id] ? 1 : 0 }));
              return { results, success: true, meta: {} };
            }
            return { results: [], success: true, meta: {} };
          },
        };
        return api;
      },
    }),
  } as unknown as D1Database;
  return {
    DB: db,
    RL_BOARD_WRITE: { limit: async () => ({ success: rlWriteOk }) },
    RL_BOARD_READ: { limit: async () => ({ success: true }) },
  } as unknown as Env;
}
function ok(changes: number) { return { success: true, meta: { changes } }; }

const me: SessionPayload = { userId: 'u-me', alias: 'Richie' } as SessionPayload;
const ren: SessionPayload = { userId: 'u-ren', alias: 'RenDIESEL' } as SessionPayload;
const x: SessionPayload = { userId: 'u-x', alias: 'Guake' } as SessionPayload;
const y: SessionPayload = { userId: 'u-y', alias: 'Minn' } as SessionPayload;
const sim: SessionPayload = { userId: 'u-sim', alias: 'shadowmonarch_k' } as SessionPayload;
const ctx = { waitUntil: (p: Promise<unknown>) => { void p; } } as unknown as ExecutionContext;

function post(path: string, body: unknown): Request {
  return new Request('https://x' + path, { method: 'POST', body: JSON.stringify(body) });
}
function get(path: string): Request { return new Request('https://x' + path); }
async function json(r: Response): Promise<Record<string, unknown>> { return (await r.json()) as Record<string, unknown>; }

async function postTopic(st: State, who: SessionPayload, over: Record<string, unknown> = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const r = await handleBoardTopicPost(post('/v1/board/topics', { tag: 'talk', title: 'Hello hunters', body: 'First topic on the board.', ...over }), makeEnv(st), who);
  return { status: r.status, body: await json(r) };
}

beforeEach(() => { mockNotify.mockClear(); });

describe('textIsClean (per-token profanity)', () => {
  it('rejects a spaced-out obscenity and a leet slur', () => {
    expect(textIsClean('you F_U_C_K')).toBe(false);
    expect(textIsClean('hi N1gger')).toBe(false);
  });
  it('passes long ordinary prose the whole-string alias filter would false-positive on', () => {
    // (Per-token keeps exactly the alias filter's semantics — including its known
    //  substring limits, e.g. 'Scunthorpe' still trips; that is the documented v1 trade-off.)
    const prose = 'We should file a class action about the passenger assault on the brass Lancashire bus. '.repeat(8);
    expect(prose.length).toBeGreaterThan(400);
    expect(textIsClean(prose)).toBe(true);
  });
});

describe('POST /v1/board/topics — write gate', () => {
  it('posts a topic for a consented hunter', async () => {
    const st = fresh();
    const r = await postTopic(st, me);
    expect(r.status).toBe(200);
    expect(typeof r.body.id).toBe('string');
    expect(Object.keys(st.topics)).toHaveLength(1);
  });
  it('429 when the write bucket is dry', async () => {
    const st = fresh();
    const r = await handleBoardTopicPost(post('/v1/board/topics', { tag: 'talk', title: 't', body: 'b' }), makeEnv(st, false), me);
    expect(r.status).toBe(429);
  });
  it('CONSENT_REQUIRED before the rules are accepted, then consent unlocks', async () => {
    const st = fresh(); st.consents.delete('u-me');
    let r = await postTopic(st, me);
    expect(r.status).toBe(403); expect(r.body.error).toBe('CONSENT_REQUIRED');
    await handleBoardConsentPost(post('/v1/board/consent', { version: 1 }), makeEnv(st), me);
    r = await postTopic(st, me);
    expect(r.status).toBe(200);
  });
  it('MUTED carries muted_until; an expired mute does not block', async () => {
    const st = fresh(); st.mutes['u-me'] = Date.now() + 3600000;
    let r = await postTopic(st, me);
    expect(r.status).toBe(403); expect(r.body.error).toBe('MUTED'); expect(typeof r.body.muted_until).toBe('number');
    st.mutes['u-me'] = Date.now() - 1000;
    r = await postTopic(st, me);
    expect(r.status).toBe(200);
  });
  it('a sim can never write', async () => {
    const st = fresh();
    const r = await postTopic(st, sim);
    expect(r.status).toBe(403); expect(r.body.error).toBe('SIM_READ_ONLY');
  });
  it('validates tag, title, body, and objectionable language', async () => {
    const st = fresh();
    expect((await postTopic(st, me, { tag: 'rant' })).body.error).toBe('INVALID_TAG');
    expect((await postTopic(st, me, { title: '   ' })).body.error).toBe('MISSING_TITLE');
    expect((await postTopic(st, me, { body: '' })).body.error).toBe('MISSING_BODY');
    expect((await postTopic(st, me, { body: 'this is sh!t' })).body.error).toBe('OBJECTIONABLE');
    const long = await postTopic(st, me, { body: 'x'.repeat(BODY_MAX + 500) });
    expect(long.status).toBe(200); // clamped, not rejected
  });
});

describe('replies', () => {
  it('reply bumps the count and activity; hidden topics refuse non-moderators', async () => {
    const st = fresh();
    const t = await postTopic(st, me); const id = t.body.id as string;
    const r = await handleBoardReplyPost(post(`/v1/board/topics/${id}/replies`, { body: 'Welcome.' }), makeEnv(st), x, id);
    expect(r.status).toBe(200);
    expect(st.topics[id].reply_count).toBe(1);
    st.topics[id].hidden_at = Date.now();
    const r2 = await handleBoardReplyPost(post(`/v1/board/topics/${id}/replies`, { body: 'Still here?' }), makeEnv(st), y, id);
    expect(r2.status).toBe(404);
  });
});

describe('reports', () => {
  it('auto-hides at the 3rd DISTINCT reporter, not the 3rd report from one hunter; every fresh report pushes moderators', async () => {
    const st = fresh(); st.mods['u-me'] = 'owner'; st.mods['u-ren'] = 'mod';
    const t = await postTopic(st, x); const id = t.body.id as string;
    const report = (who: SessionPayload) => handleBoardReportPost(post('/v1/board/report', { kind: 'topic', id, reason: 'spam' }), makeEnv(st), who, ctx);
    let b = await json(await report(y));
    expect(b.reports).toBe(1); expect(b.auto_hidden).toBe(false);
    b = await json(await report(y)); // same reporter again
    expect(b.already).toBe(true); expect(b.reports).toBe(1);
    b = await json(await report(ren));
    expect(b.reports).toBe(2); expect(b.auto_hidden).toBe(false);
    b = await json(await report(me));
    expect(b.reports).toBe(AUTO_HIDE_REPORTS); expect(b.auto_hidden).toBe(true);
    expect(st.topics[id].hidden_at).not.toBeNull();
    // 3 fresh reports → pushes went to moderators other than the reporter
    expect(mockNotify).toHaveBeenCalled();
    const targets = mockNotify.mock.calls.map((c) => c[1]);
    expect(targets).toContain('u-me');
    expect(targets).toContain('u-ren');
    expect(mockNotify.mock.calls.every((c) => c[2].type === 'board_report')).toBe(true);
  });
  it('rejects self-reports and bad reasons', async () => {
    const st = fresh();
    const t = await postTopic(st, me); const id = t.body.id as string;
    const self = await handleBoardReportPost(post('/v1/board/report', { kind: 'topic', id, reason: 'spam' }), makeEnv(st), me, ctx);
    expect((await json(self)).error).toBe('SELF_REPORT');
    const bad = await handleBoardReportPost(post('/v1/board/report', { kind: 'topic', id, reason: 'ugly' }), makeEnv(st), x, ctx);
    expect((await json(bad)).error).toBe('INVALID_REASON');
  });
});

describe('blocks are symmetric', () => {
  it('a blocked author vanishes from the blocker AND the blocker vanishes from the blocked', async () => {
    const st = fresh();
    await postTopic(st, x);   // Guake posts
    await postTopic(st, me);  // Richie posts
    await handleBoardBlockPost(post('/v1/board/block', { user_id: 'u-x' }), makeEnv(st), me, false);
    const mine = await json(await handleBoardTopicsGet(get('/v1/board/topics'), makeEnv(st), me));
    expect((mine.topics as { author: { alias: string } }[]).map((t) => t.author.alias)).toEqual(['Richie']);
    const theirs = await json(await handleBoardTopicsGet(get('/v1/board/topics'), makeEnv(st), x));
    expect((theirs.topics as { author: { alias: string } }[]).map((t) => t.author.alias)).toEqual(['Guake']);
    await handleBoardBlockPost(post('/v1/board/unblock', { user_id: 'u-x' }), makeEnv(st), me, true);
    const after = await json(await handleBoardTopicsGet(get('/v1/board/topics'), makeEnv(st), me));
    expect((after.topics as unknown[]).length).toBe(2);
  });
  it('cannot block yourself', async () => {
    const st = fresh();
    const r = await handleBoardBlockPost(post('/v1/board/block', { user_id: 'u-me' }), makeEnv(st), me, false);
    expect((await json(r)).error).toBe('SELF_BLOCK');
  });
});

describe('reads', () => {
  it('the list SQL carries the sim filter literal and excludes sim authors; hidden topics show only to moderators', async () => {
    const st = fresh();
    await postTopic(st, x);
    st.topics['sim-topic'] = { author_id: 'u-sim', hidden_at: null, deleted_at: null, reply_count: 0, last_activity_at: 5 };
    st.topics['hidden-topic'] = { author_id: 'u-y', hidden_at: 1, deleted_at: null, reply_count: 0, last_activity_at: 6 };
    const plain = await json(await handleBoardTopicsGet(get('/v1/board/topics'), makeEnv(st), me));
    const listSql = st.calls.find((c) => /FROM board_topics x/.test(c.sql))!.sql;
    expect(listSql).toMatch(/u\.apple_sub\s+NOT LIKE\s+'sim_test_%'/);
    expect((plain.topics as { author: { alias: string } }[]).map((t) => t.author.alias)).toEqual(['Guake']);
    st.mods['u-me'] = 'mod';
    const modv = await json(await handleBoardTopicsGet(get('/v1/board/topics'), makeEnv(st), me));
    const names = (modv.topics as { author: { alias: string }; hidden: boolean }[]);
    expect(names.some((t) => t.hidden)).toBe(true);
    expect((modv.me as { role: string }).role).toBe('mod');
  });
  it('a hidden topic 404s for a hunter and opens for a moderator', async () => {
    const st = fresh();
    const t = await postTopic(st, x); const id = t.body.id as string;
    st.topics[id].hidden_at = 1;
    expect((await handleBoardTopicGet(get(`/v1/board/topics/${id}`), makeEnv(st), me, id)).status).toBe(404);
    st.mods['u-me'] = 'mod';
    expect((await handleBoardTopicGet(get(`/v1/board/topics/${id}`), makeEnv(st), me, id)).status).toBe(200);
  });
});

describe('moderation authz', () => {
  it('a plain hunter cannot delete, hide or mute; a moderator can; moderators cannot be muted', async () => {
    const st = fresh(); st.mods['u-ren'] = 'mod';
    const t = await postTopic(st, x); const id = t.body.id as string;
    expect((await handleBoardTopicDelete(get('/'), makeEnv(st), y, id)).status).toBe(403);
    expect((await handleBoardTopicHide(get('/'), makeEnv(st), y, id)).status).toBe(403);
    expect((await handleBoardMutePost(post('/', { user_id: 'u-x', days: 7 }), makeEnv(st), y, false)).status).toBe(403);
    const hide = await json(await handleBoardTopicHide(get('/'), makeEnv(st), ren, id));
    expect(hide.hidden).toBe(true);
    const mute = await json(await handleBoardMutePost(post('/', { user_id: 'u-x', days: 7, reason: 'spam' }), makeEnv(st), ren, false));
    expect(mute.muted).toBe(true); expect(st.mutes['u-x']).toBeGreaterThan(Date.now());
    const muteMod = await handleBoardMutePost(post('/', { user_id: 'u-ren', days: 1 }), makeEnv(st), ren, false);
    expect((await json(muteMod)).error).toBe('SELF_MUTE');
    st.mods['u-me'] = 'owner';
    const muteMod2 = await handleBoardMutePost(post('/', { user_id: 'u-ren', days: 1 }), makeEnv(st), me, false);
    expect((await json(muteMod2)).error).toBe('CANNOT_MUTE_MODERATOR');
    expect((await json(await handleBoardMutePost(post('/', { user_id: 'u-x', days: 31 }), makeEnv(st), ren, false))).error).toBe('INVALID_DAYS');
    const del = await json(await handleBoardTopicDelete(get('/'), makeEnv(st), ren, id));
    expect(del.deleted).toBe(true); expect(st.topics[id].deleted_at).not.toBeNull();
  });
  it('only the owner grants or removes moderators, by alias, space-insensitively', async () => {
    const st = fresh(); st.mods['u-me'] = 'owner'; st.mods['u-ren'] = 'mod';
    const byMod = await handleBoardModeratorGrant(post('/', { alias: 'Guake' }), makeEnv(st), ren, false);
    expect((await json(byMod)).error).toBe('NOT_OWNER');
    const grant = await json(await handleBoardModeratorGrant(post('/', { alias: 'gu ake' }), makeEnv(st), me, false));
    expect(grant.moderator).toBe(true); expect(st.mods['u-x']).toBe('mod');
    const rm = await json(await handleBoardModeratorGrant(post('/', { alias: 'Guake' }), makeEnv(st), me, true));
    expect(rm.moderator).toBe(false); expect(st.mods['u-x']).toBeUndefined();
    const rmOwner = await handleBoardModeratorGrant(post('/', { alias: 'Richie' }), makeEnv(st), me, true);
    expect((await json(rmOwner)).error).toBe('SELF_GRANT');
  });
  it('admin bootstrap seats exactly one owner', async () => {
    const st = fresh();
    const seat = await json(await handleAdminBoardOwner(get('/v1/admin/board/owner?alias=Richie'), makeEnv(st)));
    expect(seat.owner).toBe('Richie'); expect(st.mods['u-me']).toBe('owner');
    const again = await handleAdminBoardOwner(get('/v1/admin/board/owner?alias=RenDIESEL'), makeEnv(st));
    expect((await json(again)).error).toBe('OWNER_EXISTS');
    const same = await handleAdminBoardOwner(get('/v1/admin/board/owner?alias=richie'), makeEnv(st));
    expect(same.status).toBe(200);
  });
});

describe('rank gates (W911)', () => {
  it('constants: topics need C, replies need D', () => {
    expect(TOPIC_MIN_TIER).toBe('C'); expect(REPLY_MIN_TIER).toBe('D');
  });
  it('an E-rank hunter can neither open a topic nor reply; the error names the bar', async () => {
    const st = fresh(); st.ranks['u-y'] = 'E';
    const t = await postTopic(st, me); const id = t.body.id as string;
    const open = await postTopic(st, y);
    expect(open.status).toBe(403); expect(open.body.error).toBe('RANK_TOO_LOW'); expect(open.body.need).toBe('C'); expect(open.body.rank_tier).toBe('E');
    const r = await handleBoardReplyPost(post(`/v1/board/topics/${id}/replies`, { body: 'hi' }), makeEnv(st), y, id);
    expect(r.status).toBe(403); expect((await json(r)).need).toBe('D');
  });
  it('a D-rank hunter can reply but not open; a C-rank hunter can do both', async () => {
    const st = fresh();
    const t = await postTopic(st, me); const id = t.body.id as string;
    expect((await postTopic(st, y)).body.error).toBe('RANK_TOO_LOW');   // Minn is D
    expect((await handleBoardReplyPost(post(`/v1/board/topics/${id}/replies`, { body: 'Count me in for this one.' }), makeEnv(st), y, id)).status).toBe(200);   // W914 — 'ok' is now TOO_SHORT
    expect((await postTopic(st, x)).status).toBe(200);                  // Guake is C
  });
  it('a hunter with no profile mirror reads as E; a moderator is exempt', async () => {
    const st = fresh(); delete st.ranks['u-y'];
    expect((await postTopic(st, y)).body.error).toBe('RANK_TOO_LOW');
    st.mods['u-y'] = 'mod';
    expect((await postTopic(st, y)).status).toBe(200);
  });
  it('the list tells the client its rank and the two bars', async () => {
    const st = fresh();
    const res = await json(await handleBoardTopicsGet(get('/v1/board/topics'), makeEnv(st), y));
    expect(res.me).toMatchObject({ rank_tier: 'D', topic_min_tier: 'C', reply_min_tier: 'D' });
  });
});

// ── W913 — upvotes, pins, sorts, counts ───────────────────────────────────
describe('W913 — the v3 board: votes, pins, sorts and counts', () => {
  it('a vote toggles on and off, recounts up_count, and the list marks voted', async () => {
    const st = fresh();
    const t = await postTopic(st, me);
    const id = (t.body as { id: string }).id;
    const on = await json(await handleBoardVotePost(get('/x'), makeEnv(st), x, id));
    expect(on).toMatchObject({ ok: true, voted: true, up_count: 1 });
    const again = await json(await handleBoardVotePost(get('/x'), makeEnv(st), ren, id));
    expect(again.up_count).toBe(2);
    const list = await json(await handleBoardTopicsGet(get('/v1/board/topics'), makeEnv(st), x));
    const row = (list.topics as Array<Record<string, unknown>>).find((r) => r.id === id)!;
    expect(row.up_count).toBe(2); expect(row.voted).toBe(true); expect(row.pinned).toBe(false);
    const off = await json(await handleBoardVotePost(get('/x'), makeEnv(st), x, id));
    expect(off).toMatchObject({ voted: false, up_count: 1 });
  });

  it('sims cannot vote; a dry write bucket 429s; a missing topic 404s', async () => {
    const st = fresh();
    const t = await postTopic(st, me);
    const id = (t.body as { id: string }).id;
    expect((await handleBoardVotePost(get('/x'), makeEnv(st), sim, id)).status).toBe(403);
    expect((await handleBoardVotePost(get('/x'), makeEnv(st, false), x, id)).status).toBe(429);
    expect((await handleBoardVotePost(get('/x'), makeEnv(st), x, 'deadbeef-0000')).status).toBe(404);
  });

  it('only moderators pin; pinned topics lead the first page and carry pinned:true', async () => {
    const st = fresh();
    const a = (await postTopic(st, me)).body as { id: string };
    st.topics[a.id]!.last_activity_at = 10;
    const b = (await postTopic(st, ren)).body as { id: string };
    st.topics[b.id]!.last_activity_at = 20;
    expect((await handleBoardPinPost(get('/x'), makeEnv(st), x, a.id)).status).toBe(403);
    st.mods['u-me'] = 'owner';
    const pin = await json(await handleBoardPinPost(get('/x'), makeEnv(st), me, a.id));
    expect(pin).toMatchObject({ ok: true, pinned: true });
    const list = await json(await handleBoardTopicsGet(get('/v1/board/topics'), makeEnv(st), x));
    const ids = (list.topics as Array<{ id: string; pinned: boolean }>).map((r) => r.id);
    expect(ids[0]).toBe(a.id);
    expect((list.topics as Array<{ pinned: boolean }>)[0]!.pinned).toBe(true);
    expect(ids.length).toBe(2);
    const unpin = await json(await handleBoardPinPost(get('/x'), makeEnv(st), me, a.id));
    expect(unpin.pinned).toBe(false);
  });

  it('sort=hot orders by up_count, sort=unanswered keeps only reply_count 0, bad sort 400s', async () => {
    const st = fresh();
    const a = (await postTopic(st, me)).body as { id: string };
    const b = (await postTopic(st, ren)).body as { id: string };
    await handleBoardVotePost(get('/x'), makeEnv(st), x, b.id);
    st.topics[a.id]!.reply_count = 3;
    const hot = await json(await handleBoardTopicsGet(get('/v1/board/topics?sort=hot'), makeEnv(st), x));
    expect((hot.topics as Array<{ id: string }>)[0]!.id).toBe(b.id);
    expect(hot.sort).toBe('hot');
    const un = await json(await handleBoardTopicsGet(get('/v1/board/topics?sort=unanswered'), makeEnv(st), x));
    expect((un.topics as Array<{ id: string }>).map((r) => r.id)).toEqual([b.id]);
    expect((await handleBoardTopicsGet(get('/v1/board/topics?sort=spicy'), makeEnv(st), x)).status).toBe(400);
    expect((await handleBoardTopicsGet(get('/v1/board/topics?sort=hot&cursor=nope'), makeEnv(st), x)).status).toBe(400);
  });

  it('the first page carries tag counts; a cursor page does not', async () => {
    const st = fresh();
    await postTopic(st, me); await postTopic(st, ren);
    const first = await json(await handleBoardTopicsGet(get('/v1/board/topics'), makeEnv(st), x));
    expect(first.counts).toEqual({ all: 2, improvement: 0, bug: 0, talk: 2 });
    const later = await json(await handleBoardTopicsGet(get('/v1/board/topics?cursor=5%7Cdeadbeef-0000'), makeEnv(st), x));
    expect(later.counts).toBeUndefined();
  });
});

// ── W914 — THE SPAM GUARD ──────────────────────────────────────────────────
function backdate(st: State, ms: number) {
  // every stored topic / reply / strike moves `ms` into the past — the clock the guard reads is Date.now()
  for (const t of Object.values(st.topics)) { if (t.created_at) t.created_at -= ms; }
  for (const r of Object.values(st.replies)) { if (r.created_at) r.created_at -= ms; }
  for (const k of st.strikes) k.created_at -= ms;
}
async function reply(st: State, who: SessionPayload, topicId: string, text: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const r = await handleBoardReplyPost(post('/x', { body: text }), makeEnv(st), who, topicId, ctx);
  return { status: r.status, body: await json(r) };
}

describe('W914 — spam guard: junk', () => {
  it('helpers: links, emails, phone numbers and nothing-posts are junk; prose is not', () => {
    expect(junkReason('check https://example.com now', 'body')!.code).toBe('LINKS_NOT_ALLOWED');
    expect(junkReason('visit awakened.app for more', 'body')!.code).toBe('LINKS_NOT_ALLOWED');
    expect(junkReason('mail me at richie@example.com please', 'body')!.detail).toMatch(/Emails/);
    expect(junkReason('call 415-555-0199 tonight', 'body')!.detail).toMatch(/Phone/);
    expect(junkReason('aaaaaaaaaa', 'body')).toBeNull();   // letters, long enough
    expect(junkReason('12345678', 'body')!.code).toBe('TOO_SHORT');   // no letters
    expect(junkReason('hi', 'body')!.code).toBe('TOO_SHORT');
    expect(junkReason('floor 45 - 50 - 55 - 60 was rough, e.g. the Warden', 'body')).toBeNull();
    expect(junkReason('Steps doubled after last update', 'title')).toBeNull();
    expect(normText('  Buy NOW!!!  ')).toBe(normText('buy now'));
  });

  it('rejects a link, an email, and a one-word post; a moderator may post a link', async () => {
    const st = fresh();
    expect((await postTopic(st, me, { body: 'see https://spam.example.com' })).body.error).toBe('LINKS_NOT_ALLOWED');
    expect((await postTopic(st, me, { body: 'ping me at a@b.co' })).body.error).toBe('LINKS_NOT_ALLOWED');
    expect((await postTopic(st, me, { body: 'ok' })).body.error).toBe('TOO_SHORT');
    st.mods['u-me'] = 'owner';
    expect((await postTopic(st, me, { body: 'see https://spam.example.com' })).status).toBe(200);
  });
});

describe('W914 — spam guard: caps and cooldowns', () => {
  it('a second topic inside the cooldown is refused with retry_after_ms; after it, three a day is the cap', async () => {
    const st = fresh();
    expect((await postTopic(st, me)).status).toBe(200);
    const second = await postTopic(st, me, { body: 'Another thought entirely, different words.' });
    expect(second.status).toBe(429); expect(second.body.error).toBe('COOLDOWN');
    expect(Number(second.body.retry_after_ms)).toBeGreaterThan(0);
    backdate(st, SPAM.TOPIC_COOLDOWN_MS + 1000);
    expect((await postTopic(st, me, { body: 'Another thought entirely, different words.' })).status).toBe(200);
    backdate(st, SPAM.TOPIC_COOLDOWN_MS + 1000);
    expect((await postTopic(st, me, { body: 'A third thought, still fresh and different.' })).status).toBe(200);
    backdate(st, SPAM.TOPIC_COOLDOWN_MS + 1000);
    const fourth = await postTopic(st, me, { body: 'A fourth thought that should not pass today.' });
    expect(fourth.status).toBe(429); expect(fourth.body.error).toBe('TOO_MANY_TOPICS_TODAY');
    backdate(st, 86400000);
    expect((await postTopic(st, me, { body: 'A fourth thought, but it is tomorrow now.' })).status).toBe(200);
  });

  it('replies: 20 s cooldown, then 5 an hour on one topic, then 30 a day; moderators are exempt', async () => {
    const st = fresh();
    const t = (await postTopic(st, ren)).body as { id: string };
    expect((await reply(st, x, t.id, 'First reply with enough words.')).status).toBe(200);
    const quick = await reply(st, x, t.id, 'Another reply, hot on the heels of the first.');
    expect(quick.status).toBe(429); expect(quick.body.error).toBe('COOLDOWN');
    for (let i = 2; i <= 5; i++) { backdate(st, SPAM.REPLY_COOLDOWN_MS + 1000); expect((await reply(st, x, t.id, `Reply number ${i} on the same topic.`)).status).toBe(200); }
    backdate(st, SPAM.REPLY_COOLDOWN_MS + 1000);
    const flood = await reply(st, x, t.id, 'Reply number six on the same topic.');
    expect(flood.status).toBe(429); expect(flood.body.error).toBe('TOPIC_FLOOD');
    st.mods['u-x'] = 'mod';
    expect((await reply(st, x, t.id, 'A moderator is never throttled here.')).status).toBe(200);
  });
});

describe('W914 — spam guard: repeats and strikes', () => {
  it('the same text again (case, spacing, punctuation aside) is a DUPLICATE', async () => {
    const st = fresh();
    expect((await postTopic(st, me, { body: 'Buy now, hunters!!!' })).status).toBe(200);
    backdate(st, SPAM.TOPIC_COOLDOWN_MS + 1000);
    const dup = await postTopic(st, me, { title: 'Totally new title', body: '  buy   now hunters ' });
    expect(dup.status).toBe(400); expect(dup.body.error).toBe('DUPLICATE');
    const t = (await postTopic(st, ren)).body as { id: string };
    expect((await reply(st, x, t.id, 'Great point, well said.')).status).toBe(200);
    backdate(st, SPAM.REPLY_COOLDOWN_MS + 1000);
    expect((await reply(st, x, t.id, 'GREAT point — well said!')).body.error).toBe('DUPLICATE');
  });

  it('five rejected writes in a day mute the hunter for a day and push the moderators', async () => {
    const st = fresh();
    st.mods['u-ren'] = 'mod';
    for (let i = 1; i <= 4; i++) {
      const r = await postTopic(st, me, { body: 'https://spam.example.com/' + i });
      expect(r.body.error).toBe('LINKS_NOT_ALLOWED');
    }
    expect(st.strikes.length).toBe(4);
    const fifth = await postTopic(st, me, { body: 'https://spam.example.com/5' });
    expect(fifth.status).toBe(403); expect(fifth.body.error).toBe('MUTED'); expect(fifth.body.auto).toBe(true);
    expect(Number(fifth.body.muted_until)).toBeGreaterThan(Date.now());
    expect(st.mutes['u-me']).toBeGreaterThan(Date.now());
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect((mockNotify.mock.calls[0]![2] as { type: string }).type).toBe('board_spam');
    // muted now — the write gate refuses before the guard even runs
    expect((await postTopic(st, me, { body: 'A perfectly innocent post now.' })).body.error).toBe('MUTED');
  });

  it('two auto-hidden posts in a week mute the author for a week; the report push says so', async () => {
    const st = fresh();
    st.mods['u-ren'] = 'mod';
    const a = (await postTopic(st, x)).body as { id: string };
    backdate(st, SPAM.TOPIC_COOLDOWN_MS + 1000);
    const b = (await postTopic(st, x, { body: 'Another post that will also be reported.' })).body as { id: string };
    const report = (who: SessionPayload, id: string) => handleBoardReportPost(post('/v1/board/report', { kind: 'topic', id, reason: 'spam' }), makeEnv(st), who, ctx);
    for (const who of [me, ren, y]) await report(who, a.id);
    expect(st.topics[a.id]!.hidden_by).toBe('auto');
    expect(st.mutes['u-x']).toBeUndefined();
    mockNotify.mockClear();
    for (const who of [me, ren]) await report(who, b.id);
    const last = await json(await report(y, b.id));
    expect(last.auto_hidden).toBe(true); expect(last.auto_muted).toBe(true);
    expect(st.mutes['u-x']).toBeGreaterThan(Date.now() + 6 * 86400000);
    const lastPush = mockNotify.mock.calls[mockNotify.mock.calls.length - 1]!;
    expect(String((lastPush[2] as { body: string }).body)).toMatch(/muted for a week/);
  });
});

describe('W914 — moderator tools: lock and purge', () => {
  it('only moderators lock; a locked topic refuses hunter replies but not moderators; the list carries locked', async () => {
    const st = fresh();
    const t = (await postTopic(st, ren)).body as { id: string };
    expect((await handleBoardTopicLock(get('/x'), makeEnv(st), x, t.id)).status).toBe(403);
    st.mods['u-me'] = 'owner';
    expect(await json(await handleBoardTopicLock(get('/x'), makeEnv(st), me, t.id))).toMatchObject({ ok: true, locked: true });
    const refused = await reply(st, x, t.id, 'Trying to reply to a locked topic.');
    expect(refused.status).toBe(403); expect(refused.body.error).toBe('TOPIC_LOCKED');
    expect((await reply(st, me, t.id, 'A moderator can still add a closing note.')).status).toBe(200);
    const list = await json(await handleBoardTopicsGet(get('/v1/board/topics'), makeEnv(st), x));
    expect((list.topics as Array<{ id: string; locked: boolean }>).find((r) => r.id === t.id)!.locked).toBe(true);
    expect((await json(await handleBoardTopicLock(get('/x'), makeEnv(st), me, t.id))).locked).toBe(false);
    expect((await reply(st, x, t.id, 'Open again, replying works.')).status).toBe(200);
  });

  it('purge soft-deletes a hunter\'s last 24 h (topics + replies), recounts, and is moderator-only', async () => {
    const st = fresh();
    const host = (await postTopic(st, ren)).body as { id: string };
    const spam = (await postTopic(st, x, { body: 'A topic that is about to be purged.' })).body as { id: string };
    expect((await reply(st, x, host.id, 'A reply that is about to be purged.')).status).toBe(200);
    expect(st.topics[host.id]!.reply_count).toBe(1);
    expect((await handleBoardPurgePost(post('/v1/board/purge', { user_id: 'u-x' }), makeEnv(st), x)).status).toBe(403);
    st.mods['u-me'] = 'owner';
    expect((await json(await handleBoardPurgePost(post('/v1/board/purge', { user_id: 'u-me' }), makeEnv(st), me))).error).toBe('SELF_PURGE');
    expect((await json(await handleBoardPurgePost(post('/v1/board/purge', { user_id: 'u-x', hours: 999 }), makeEnv(st), me))).error).toBe('INVALID_HOURS');
    const out = await json(await handleBoardPurgePost(post('/v1/board/purge', { user_id: 'u-x' }), makeEnv(st), me));
    expect(out).toMatchObject({ ok: true, topics: 1, replies: 1 });
    expect(st.topics[spam.id]!.deleted_at).not.toBeNull();
    expect(st.topics[host.id]!.reply_count).toBe(0);
    st.mods['u-ren'] = 'mod';
    expect((await json(await handleBoardPurgePost(post('/v1/board/purge', { user_id: 'u-ren' }), makeEnv(st), me))).error).toBe('CANNOT_PURGE_MODERATOR');
  });

  it('the list tells the client the spam knobs', async () => {
    const st = fresh();
    const res = await json(await handleBoardTopicsGet(get('/v1/board/topics'), makeEnv(st), x));
    expect((res.me as { limits: Record<string, number> }).limits).toEqual({
      topics_per_day: 3, topic_cooldown_ms: 600000, replies_per_day: 30, reply_cooldown_ms: 20000, replies_per_topic_per_hour: 5, body_min: 8,
    });
  });
});

describe('W914 — prose profanity is word-aware', () => {
  it('ordinary words that merely contain a root pass; slurs, compounds, leet and spaced-out forms fail', () => {
    for (const ok of ['second try', 'connect the boss', 'a Japan trip', 'raccoon', 'grape juice', 'ashtray', 'pistol', 'analysis', 'the economy', 'icon', 'therapeutic', 'class pass', 'Lancashire', 'Count me in for this one.']) {
      expect(textIsClean(ok), ok).toBe(true);
    }
    for (const bad of ['fucking hell', 'bullshit', 'you cunt', 'Sh1t', 'F4ggot', 'f u c k', 'raped', 'raping', 'dumb retard', 'go to hell asshole']) {
      expect(textIsClean(bad), bad).toBe(false);
    }
  });
});
