/**
 * recap.test.ts — W1015 the Monday recap written by DeepSeek. The facts come from the
 * phone; every sentence is checked before it leaves; anything off returns text: null so
 * the phone shows its own rules sentence.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkSentences, handleRecapText, parseFacts, ptMondayOf, type RecapFacts } from './recap';
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';

interface Captured { sql: string; binds: unknown[] }

function makeEnv(opts?: { rateLimited?: boolean; cached?: string[] | null; key?: string | null; prev?: string[] | null }) {
  const calls: Captured[] = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => {
        calls.push({ sql, binds: args });
        return {
          run: async () => ({ success: true, meta: { changes: 1 } }),
          first: async () => {
            if (/week_start = \?/.test(sql) && opts?.cached) return { text: JSON.stringify(opts.cached) };
            if (/week_start < \?/.test(sql) && opts?.prev) return { text: JSON.stringify(opts.prev) };
            return null;
          },
        };
      },
    }),
  } as unknown as D1Database;
  const env = {
    DB: db,
    RL_RECAP: { limit: async () => ({ success: !opts?.rateLimited }) },
    DEEPSEEK_API_KEY: opts?.key === undefined ? 'sk-test' : opts.key ?? undefined,
  } as unknown as Env;
  return { env, calls };
}

const session: SessionPayload = { userId: 'user-abc', alias: 'Richie' };
const WS = ptMondayOf(new Date());
const FACTS: RecapFacts = {
  kept: 24, total: 28, prev_kept: 28, best: false, perfect_week: false, perfect_days: 3, days_active: 7, streak: 12,
  weak: { name: 'Sleep', kept: 3, of: 7, weekly: false }, strong: { name: 'Read', kept: 7, of: 7 }, suggestion: 'first_today',
};
const req = (body: unknown) => new Request('https://x/v1/recap/text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const deepseekReply = (sentences: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ sentences }) } }] }), { status: 200 });

afterEach(() => { vi.unstubAllGlobals(); });

describe('checkSentences', () => {
  it('keeps plain sentences built from the facts', () => {
    expect(checkSentences(['You kept 24 of 28 vows.', 'Sleep slipped to 3 of 7 days; it is first on today\'s list.'], FACTS)).toEqual(['You kept 24 of 28 vows.', 'Sleep slipped to 3 of 7 days; it is first on today\'s list.']);
  });
  it('rejects a number the facts do not hold', () => { expect(checkSentences(['You kept 25 of 28 vows. Sleep is next.'], FACTS)).toBeNull(); });
  it('rejects hype, shaming and the banned word', () => {
    expect(checkSentences(['Great week! Sleep is first today.'], FACTS)).toBeNull();
    expect(checkSentences(['You failed Sleep this week.'], FACTS)).toBeNull();
    expect(checkSentences(['Your streak fell. Sleep is first today.'], FACTS)).toBeNull();
  });
  it('rejects more than 3 sentences, and a weak-vow message that never names the vow', () => {
    expect(checkSentences(['a b c.', 'd e f.', 'g h i.', 'j k l.'], FACTS)).toBeNull();
    expect(checkSentences(['You kept 24 of 28 vows.'], FACTS)).toBeNull();
  });
});

describe('parseFacts', () => {
  it('accepts valid facts and trims a vow name', () => { expect(parseFacts({ ...FACTS, weak: { ...FACTS.weak, name: '  Sleep <b>  ' } })!.weak!.name).toBe('Sleep b'); });
  it('rejects nonsense', () => {
    expect(parseFacts({ ...FACTS, kept: 30 })).toBeNull();
    expect(parseFacts({ ...FACTS, perfect_days: 9 })).toBeNull();
    expect(parseFacts('x')).toBeNull();
  });
});

describe('POST /v1/recap/text', () => {
  it('429 when rate limited', async () => {
    const { env } = makeEnv({ rateLimited: true });
    expect((await handleRecapText(req({ week_start: WS, facts: FACTS }), env, session)).status).toBe(429);
  });
  it('400 for another week', async () => {
    const { env } = makeEnv();
    expect((await handleRecapText(req({ week_start: '2020-01-06', facts: FACTS }), env, session)).status).toBe(400);
  });
  it('returns the stored text without calling DeepSeek', async () => {
    const fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy);
    const { env } = makeEnv({ cached: ['Stored line.'] });
    const r = await (await handleRecapText(req({ week_start: WS, facts: FACTS }), env, session)).json();
    expect(r).toEqual({ ok: true, text: ['Stored line.'], source: 'cache' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('no key → text null (the phone uses its rules sentence)', async () => {
    const { env } = makeEnv({ key: null });
    expect(await (await handleRecapText(req({ week_start: WS, facts: FACTS }), env, session)).json()).toEqual({ ok: true, text: null, source: 'none' });
  });
  it('writes, checks, stores and returns; passes last week\'s words for variety', async () => {
    const fetchSpy = vi.fn(async () => deepseekReply(['You kept 24 of 28 vows.', 'Sleep was the one that slipped: 3 of 7. It is first on today\'s list.']));
    vi.stubGlobal('fetch', fetchSpy);
    const { env, calls } = makeEnv({ prev: ['Old words.'] });
    const r = await (await handleRecapText(req({ week_start: WS, facts: FACTS }), env, session)).json() as { text: string[]; source: string };
    expect(r.source).toBe('ai');
    expect(r.text).toHaveLength(2);
    expect(calls.some((c) => /INSERT OR IGNORE INTO recap_texts/.test(c.sql) && c.binds[1] === WS)).toBe(true);
    const sent = JSON.parse((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent.model).toBe('deepseek-chat');
    expect(sent.messages[1].content).toContain('Old words.');
    expect(sent.messages[1].content).not.toContain('Richie');   // only facts leave — never the hunter's name
  });
  it('retries once when a sentence fails the checks, then gives up to the rules sentence', async () => {
    const fetchSpy = vi.fn(async () => deepseekReply(['Amazing week!!! You kept 99 vows.']));
    vi.stubGlobal('fetch', fetchSpy);
    const { env, calls } = makeEnv();
    expect(await (await handleRecapText(req({ week_start: WS, facts: FACTS }), env, session)).json()).toEqual({ ok: true, text: null, source: 'none' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(calls.some((c) => /INSERT/.test(c.sql))).toBe(false);
  });
  it('a DeepSeek outage returns text null, never an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })));
    const { env } = makeEnv();
    const res = await handleRecapText(req({ week_start: WS, facts: FACTS }), env, session);
    expect(res.status).toBe(200);
    expect((await res.json() as { text: unknown }).text).toBeNull();
  });
});
