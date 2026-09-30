// W1015 — the Monday recap, written by DeepSeek (owner 2026-09-29: "I would want the AI
// to create unique and personalized messages for the user").
//
// The app works out last week's facts on the phone (the W1014 rules: kept / total, the
// hardest vow, a perfect or best week, the streak) and posts ONLY those facts here. This
// handler asks DeepSeek for 1-3 plain sentences built from them, checks every sentence
// before it leaves (length, no number the facts don't hold, no hype, no shaming, the
// banned word), stores it once per hunter per week, and returns it. Anything that goes
// wrong — no key, a timeout, a sentence that fails the checks — returns `text: null` and
// the phone shows its own rules sentence instead. Nothing here ever blocks the briefing.
//
// POST /v1/recap/text   { week_start: 'YYYY-MM-DD' (this week's Monday, PST), facts }
//   200 { ok: true, text: string[] | null, source: 'ai' | 'cache' | 'none' }

import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonError, jsonOk } from '../lib/responses';

export interface RecapFacts {
  kept: number;
  total: number;
  prev_kept: number | null;
  best: boolean;
  perfect_week: boolean;
  perfect_days: number;
  days_active: number;
  weak: { name: string; kept: number; of: number; weekly: boolean } | null;
  strong: { name: string; kept: number; of: number } | null;
  suggestion: 'first_today' | 'weekly_goal' | null;
}

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const MODEL = 'deepseek-chat';
const CALL_TIMEOUT_MS = 8000;

/** This week's Monday in Pacific time (the app's week for vows and the recap). */
export function ptMondayOf(now: Date): string {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(now);
  const dow = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short' }).format(now);
  const back = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(dow);
  const d = new Date(ymd + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - Math.max(0, back));
  return d.toISOString().slice(0, 10);
}

const int = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null;
const cleanName = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f<>{}]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  return s.length ? s : null;
};

/** Validate + normalise the posted facts. null = reject. */
export function parseFacts(raw: unknown): RecapFacts | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as Record<string, unknown>;
  const kept = int(f.kept, 0, 2000), total = int(f.total, 1, 2000);
  if (kept === null || total === null || kept > total) return null;
  const prev = f.prev_kept === null || f.prev_kept === undefined ? null : int(f.prev_kept, 0, 2000);
  // W1017 — the streak is not a recap fact (older builds still send it; it is ignored)
  const pd = int(f.perfect_days, 0, 7), da = int(f.days_active, 0, 7);
  if (pd === null || da === null) return null;
  let weak: RecapFacts['weak'] = null;
  if (f.weak && typeof f.weak === 'object') {
    const w = f.weak as Record<string, unknown>;
    const name = cleanName(w.name), k = int(w.kept, 0, 7), of = int(w.of, 1, 7);
    if (!name || k === null || of === null || k > of) return null;
    weak = { name, kept: k, of, weekly: w.weekly === true };
  }
  let strong: RecapFacts['strong'] = null;
  if (f.strong && typeof f.strong === 'object') {
    const s = f.strong as Record<string, unknown>;
    const name = cleanName(s.name), k = int(s.kept, 0, 7), of = int(s.of, 1, 7);
    if (name && k !== null && of !== null && k <= of) strong = { name, kept: k, of };
  }
  const sug = f.suggestion === 'first_today' || f.suggestion === 'weekly_goal' ? f.suggestion : null;
  return { kept, total, prev_kept: prev, best: f.best === true, perfect_week: f.perfect_week === true, perfect_days: pd, days_active: da, weak, strong, suggestion: weak ? sug : null };
}

/** Every number the message is allowed to say. */
export function allowedNumbers(f: RecapFacts): Set<number> {
  const s = new Set<number>([f.kept, f.total, f.perfect_days, f.days_active, 7]);
  if (f.prev_kept !== null) { s.add(f.prev_kept); if (f.kept > f.prev_kept) s.add(f.kept - f.prev_kept); }
  if (f.weak) { s.add(f.weak.kept); s.add(f.weak.of); }
  if (f.strong) { s.add(f.strong.kept); s.add(f.strong.of); }
  if (f.suggestion === 'weekly_goal') s.add(3);
  return s;
}

const SHAMING = /\b(lazy|fail(ed|ure|ing|s)?|disappoint\w*|pathetic|ashamed|shame\w*|terrible|awful|worst|bad week|should have|slacking|slacked|excuses?)\b/i;
const BANNED = /\bfell(ed)?\b/i;   // house rule: never in user copy
const HYPE = /[!]|\p{Extended_Pictographic}/u;

/** 1-3 plain sentences, each checked. Returns the cleaned sentences or null. */
export function checkSentences(raw: unknown, f: RecapFacts): string[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 3) return null;
  const out: string[] = [];
  const allowed = allowedNumbers(f);
  let words = 0;
  for (const r of raw) {
    if (typeof r !== 'string') return null;
    const t = r.replace(/\s+/g, ' ').trim();
    if (t.length < 3 || t.length > 160) return null;
    if (SHAMING.test(t) || BANNED.test(t) || HYPE.test(t)) return null;
    for (const m of t.match(/\d+/g) || []) if (!allowed.has(Number(m))) return null;
    words += t.split(' ').length;
    out.push(t);
  }
  if (words > 55) return null;
  if (f.weak && f.suggestion && !out.some((s) => s.toLowerCase().includes(f.weak!.name.toLowerCase()))) return null;
  return out;
}

export const SYSTEM_PROMPT = [
  'You write the weekly recap line in a habit-tracking app. Each habit is called a vow.',
  'Write 1 to 3 short sentences, 45 words at most in total, speaking to the user as "you".',
  'Tone: plain, direct, specific and useful. No hype, no exclamation marks, no emoji, no metaphors, no fantasy or game voice, no greetings.',
  'Use only the facts given and write every number as digits exactly as given. Never invent a number, a day or a vow.',
  'Never shame, scold or guilt the user. A quiet week is simply a fresh start.',
  'If "weak" is present, name that vow and give one concrete, doable step for this week.',
  'If "suggestion" is "first_today", mention that it is first on today\'s list. If it is "weekly_goal", suggest making it 3 times a week.',
  'Otherwise, say what went well and, if useful, what to keep doing.',
  'Vary the wording from week to week. Reply as JSON: {"sentences": ["...", "..."]}.',
].join(' ');

async function callDeepSeek(env: Env, facts: RecapFacts, lastText: string | null, temperature: number): Promise<unknown> {
  const user = 'Facts for last week (Monday to Sunday):\n' + JSON.stringify(facts) +
    (lastText ? '\nLast week\'s message, do not reuse its wording: ' + JSON.stringify(lastText) : '');
  const res = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.DEEPSEEK_API_KEY },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: user }],
      response_format: { type: 'json_object' },
      max_tokens: 220,
      temperature,
    }),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error('deepseek ' + res.status);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content || '';
  return (JSON.parse(content) as { sentences?: unknown }).sentences;
}

export async function handleRecapText(request: Request, env: Env, session: SessionPayload): Promise<Response> {
  const rl = await env.RL_RECAP.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  let body: { week_start?: unknown; facts?: unknown } | null = null;
  try { body = await request.json(); } catch { body = null; }
  if (!body) return jsonError(400, 'BAD_JSON', 'Invalid JSON body.');
  const ws = typeof body.week_start === 'string' ? body.week_start : '';
  if (ws !== ptMondayOf(new Date())) return jsonError(400, 'BAD_WEEK', 'Only this week\'s recap.');
  const facts = parseFacts(body.facts);
  if (!facts) return jsonError(400, 'BAD_FACTS', 'Facts did not validate.');

  // once per hunter per week
  try {
    const hit = await env.DB.prepare('SELECT text FROM recap_texts WHERE user_id = ? AND week_start = ?').bind(session.userId, ws).first<{ text: string }>();
    if (hit && hit.text) return jsonOk({ ok: true, text: JSON.parse(hit.text) as string[], source: 'cache' });
  } catch { /* fall through — a cache miss only costs a call */ }

  if (!env.DEEPSEEK_API_KEY) return jsonOk({ ok: true, text: null, source: 'none' });

  let lastText: string | null = null;
  try {
    const prev = await env.DB.prepare('SELECT text FROM recap_texts WHERE user_id = ? AND week_start < ? ORDER BY week_start DESC LIMIT 1').bind(session.userId, ws).first<{ text: string }>();
    if (prev && prev.text) lastText = (JSON.parse(prev.text) as string[]).join(' ');
  } catch { /* variety is a nicety */ }

  let text: string[] | null = null;
  for (const temp of [1.0, 0.6]) {   // one retry, a little calmer, when a sentence fails the checks
    try { text = checkSentences(await callDeepSeek(env, facts, lastText, temp), facts); } catch { text = null; }
    if (text) break;
  }
  if (!text) return jsonOk({ ok: true, text: null, source: 'none' });

  try {
    await env.DB.prepare('INSERT OR IGNORE INTO recap_texts (user_id, week_start, text, created_at) VALUES (?, ?, ?, ?)')
      .bind(session.userId, ws, JSON.stringify(text), Date.now()).run();
  } catch { /* still return it */ }
  return jsonOk({ ok: true, text, source: 'ai' });
}
