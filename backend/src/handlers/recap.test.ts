/**
 * recap.test.ts — W1015 the Monday recap written by DeepSeek; W1019 one thing per message,
 * never the count the card already shows. The facts come from the phone; every sentence is
 * checked before it leaves; anything off returns text: null so the phone shows its own
 * rules sentence.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkSentences, handleRecapText, parseFacts, ptMondayOf, RECAP_VERSION, type RecapFacts } from './recap';
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';

interface Captured { sql: string; binds: unknown[] }

function makeEnv(opts?: { rateLimited?: boolean; cachedRaw?: string | null; key?: string | null; prevRaw?: string | null }) {
  const calls: Captured[] = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => {
        calls.push({ sql, binds: args });
        return {
          run: async () => ({ success: true, meta: { changes: 1 } }),
          first: async () => {
            if (/week_start = \?/.test(sql) && opts?.cachedRaw) return { text: opts.cachedRaw };
            if (/week_start < \?/.test(sql) && opts?.prevRaw) return { text: opts.prevRaw };
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
  kept: 24, total: 28, best: false, perfect_week: false, perfect_days: 3, days_active: 7,
  weak: { name: 'Sleep', kept: 3, of: 7, weekly: false }, missed: null, suggestion: 'first_today',
};
const NEAR: RecapFacts = {
  kept: 287, total: 289, best: true, perfect_week: false, perfect_days: 6, days_active: 7,
  weak: null, missed: [{ name: 'Sleep', day: 'Saturday' }, { name: 'Read', day: 'Saturday' }], suggestion: null,
};
const req = (body: unknown) => new Request('https://x/v1/recap/text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const deepseekReply = (sentences: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ sentences }) } }] }), { status: 200 });
const GOOD = ['Sleep was the one that slipped: 3 of 7 days.', 'It is first on today\'s list.'];

afterEach(() => { vi.unstubAllGlobals(); });

describe('checkSentences', () => {
  it('keeps one plain thing built from the facts', () => { expect(checkSentences(GOOD, FACTS)).toEqual(GOOD); });
  it('keeps a near-perfect week that names what was missed and when', () => {
    expect(checkSentences(['Only Saturday slipped: Sleep and Read.'], NEAR)).toEqual(['Only Saturday slipped: Sleep and Read.']);
  });
  it('rejects restating the count the card already shows (W1019)', () => {
    expect(checkSentences(['You kept 24 of 28 vows.', 'Sleep is first on today\'s list.'], FACTS)).toBeNull();
    expect(checkSentences(['You kept 287 of 289 vows; Sleep and Read slipped on Saturday.'], NEAR)).toBeNull();
  });
  it('rejects a number pile-up, a number the facts do not hold, and a streak count', () => {
    expect(checkSentences(['Sleep hit 3 of 7 days across 7 active days.'], FACTS)).toBeNull();
    expect(checkSentences(['Sleep was kept 4 of 7 days. It is first today.'], FACTS)).toBeNull();
    expect(checkSentences(['Sleep is first today after a 12 day run.'], FACTS)).toBeNull();
  });
  it('rejects hype, shaming, filler advice and the banned word', () => {
    expect(checkSentences(['Great week! Sleep is first today.'], FACTS)).toBeNull();
    expect(checkSentences(['You failed Sleep this week.'], FACTS)).toBeNull();
    expect(checkSentences(['Sleep was 3 of 7, so keep that same slot in your day.'], FACTS)).toBeNull();
    expect(checkSentences(['Sleep fell behind. It is first today.'], FACTS)).toBeNull();
  });
  it('rejects more than 3 sentences, a step that never names the vow, and a near-perfect week that hides a miss', () => {
    expect(checkSentences(['a b c.', 'd e f.', 'g h i.', 'j k l.'], FACTS)).toBeNull();
    expect(checkSentences(['It is first on today\'s list.'], FACTS)).toBeNull();
    expect(checkSentences(['Only Saturday slipped: Sleep.'], NEAR)).toBeNull();
  });
});

describe('parseFacts', () => {
  it('accepts valid facts and trims a vow name', () => { expect(parseFacts({ ...FACTS, weak: { ...FACTS.weak, name: '  Sleep <b>  ' } })!.weak!.name).toBe('Sleep b'); });
  it('ignores what older builds still send (streak, prev_kept, strong)', () => {
    expect(parseFacts({ ...FACTS, streak: 12, prev_kept: 28, strong: { name: 'Read', kept: 7, of: 7 } })).toEqual(FACTS);
  });
  it('a near-perfect week carries its misses and no "hardest vow"', () => {
    expect(parseFacts({ ...NEAR, weak: { name: 'Sleep', kept: 6, of: 7, weekly: false } })).toEqual(NEAR);
    expect(parseFacts({ ...NEAR, missed: [{ name: 'Sleep', day: 'Caturday' }] })).toBeNull();
  });
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
  it('returns this version\'s stored text without calling DeepSeek', async () => {
    const fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy);
    const { env } = makeEnv({ cachedRaw: JSON.stringify({ v: RECAP_VERSION, s: ['Stored line.'] }) });
    expect(await (await handleRecapText(req({ week_start: WS, facts: FACTS }), env, session)).json()).toEqual({ ok: true, text: ['Stored line.'], source: 'cache' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('an older version\'s stored text is replaced with fresh words (W1019)', async () => {
    const fetchSpy = vi.fn(async () => deepseekReply(GOOD)); vi.stubGlobal('fetch', fetchSpy);
    const { env, calls } = makeEnv({ cachedRaw: JSON.stringify(['You kept 24 of 28 vows, with 12 days in a row.']) });
    const r = await (await handleRecapText(req({ week_start: WS, facts: FACTS }), env, session)).json() as { text: string[]; source: string };
    expect(r).toEqual({ ok: true, text: GOOD, source: 'ai' });
    const ins = calls.find((c) => /INSERT OR REPLACE INTO recap_texts/.test(c.sql))!;
    expect(JSON.parse(ins.binds[2] as string)).toEqual({ v: RECAP_VERSION, s: GOOD });
  });
  it('no key → text null (the phone uses its rules sentence)', async () => {
    const { env } = makeEnv({ key: null });
    expect(await (await handleRecapText(req({ week_start: WS, facts: FACTS }), env, session)).json()).toEqual({ ok: true, text: null, source: 'none' });
  });
  it('writes, checks, stores and returns; passes last week\'s words for variety; only facts leave', async () => {
    const fetchSpy = vi.fn(async () => deepseekReply(GOOD));
    vi.stubGlobal('fetch', fetchSpy);
    const { env, calls } = makeEnv({ prevRaw: JSON.stringify({ v: RECAP_VERSION, s: ['Old words.'] }) });
    const r = await (await handleRecapText(req({ week_start: WS, facts: FACTS }), env, session)).json() as { text: string[]; source: string };
    expect(r.source).toBe('ai');
    expect(calls.some((c) => /INSERT OR REPLACE INTO recap_texts/.test(c.sql) && c.binds[1] === WS)).toBe(true);
    const sent = JSON.parse((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent.model).toBe('deepseek-chat');
    expect(sent.messages[1].content).toContain('Old words.');
    expect(sent.messages[1].content).not.toContain('Richie');
    expect(sent.messages[1].content).not.toMatch(/streak|prev_kept|strong/);
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
