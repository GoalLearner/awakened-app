// W1015 — the Monday recap, written by DeepSeek (owner 2026-09-29: "I would want the AI
// to create unique and personalized messages for the user").
//
// The app works out last week's facts on the phone and posts ONLY those facts here. This
// handler asks DeepSeek for one or two plain sentences built from them, checks every
// sentence before it leaves, stores it once per hunter per week, and returns it. Anything
// that goes wrong — no key, a timeout, a sentence that fails the checks — returns
// `text: null` and the phone shows its own rules sentence. Nothing here blocks the briefing.
//
// W1019 (owner 2026-09-30, "I am not a fan of this message"): the first messages restated
// the count the card already shows in big type, stacked five numbers into a sentence and
// closed on filler advice. Now: never restate kept/total, one thing per message — on a
// near-perfect week exactly what was missed and on which day; otherwise the hardest vow
// and its one step; otherwise the best/perfect week — and no generic advice. The streak
// (W1017), the week-before count and the "strongest vow" are no longer facts.
// Stored messages carry a version, so a prompt change replaces last version's words.
//
// POST /v1/recap/text   { week_start: 'YYYY-MM-DD' (this week's Monday, PST), facts }
//   200 { ok: true, text: string[] | null, source: 'ai' | 'cache' | 'none' }

import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonError, jsonOk } from '../lib/responses';

export const RECAP_VERSION = 2;

export interface RecapFacts {
  kept: number;
  total: number;
  best: boolean;
  perfect_week: boolean;
  perfect_days: number;
  days_active: number;
  weak: { name: string; kept: number; of: number; weekly: boolean } | null;
  /** a near-perfect week: the one to three seals that were missed, and the day */
  missed: Array<{ name: string; day: string }> | null;
  suggestion: 'first_today' | 'weekly_goal' | null;
}

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const MODEL = 'deepseek-chat';
const CALL_TIMEOUT_MS = 8000;
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

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

/** Validate + normalise the posted facts. null = reject. Fields older builds still send
 *  (streak, prev_kept, strong) are ignored. */
export function parseFacts(raw: unknown): RecapFacts | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as Record<string, unknown>;
  const kept = int(f.kept, 0, 2000), total = int(f.total, 1, 2000);
  if (kept === null || total === null || kept > total) return null;
  const pd = int(f.perfect_days, 0, 7), da = int(f.days_active, 0, 7);
  if (pd === null || da === null) return null;
  let weak: RecapFacts['weak'] = null;
  if (f.weak && typeof f.weak === 'object') {
    const w = f.weak as Record<string, unknown>;
    const name = cleanName(w.name), k = int(w.kept, 0, 7), of = int(w.of, 1, 7);
    if (!name || k === null || of === null || k > of) return null;
    weak = { name, kept: k, of, weekly: w.weekly === true };
  }
  let missed: RecapFacts['missed'] = null;
  if (Array.isArray(f.missed) && f.missed.length >= 1 && f.missed.length <= 3) {
    const out: Array<{ name: string; day: string }> = [];
    for (const m of f.missed) {
      if (!m || typeof m !== 'object') return null;
      const name = cleanName((m as Record<string, unknown>).name), day = (m as Record<string, unknown>).day;
      if (!name || typeof day !== 'string' || DAYS.indexOf(day) < 0) return null;
      out.push({ name, day });
    }
    missed = out;
  }
  if (missed) weak = null;   // a near-perfect week names its misses, not a "hardest vow"
  const sug = f.suggestion === 'first_today' || f.suggestion === 'weekly_goal' ? f.suggestion : null;
  return { kept, total, best: f.best === true, perfect_week: f.perfect_week === true, perfect_days: pd, days_active: da, weak, missed, suggestion: weak ? sug : null };
}

/** Every number the message is allowed to say. */
export function allowedNumbers(f: RecapFacts): Set<number> {
  const s = new Set<number>([f.kept, f.total, f.perfect_days, f.days_active, 7]);
  if (f.weak) { s.add(f.weak.kept); s.add(f.weak.of); }
  if (f.missed) s.add(f.missed.length);
  if (f.suggestion === 'weekly_goal') s.add(3);
  return s;
}

const SHAMING = /\b(lazy|fail(ed|ure|ing|s)?|disappoint\w*|pathetic|ashamed|shame\w*|terrible|awful|worst|bad week|should have|slacking|slacked|excuses?)\b/i;
const BANNED = /\bfell(ed)?\b/i;   // house rule: never in user copy
const HYPE = /[!]|\p{Extended_Pictographic}/u;
const FILLER = /\b(keep it up|keep that|keep up|keep going|same slot|stay consistent|well done|great job|good job|nice work)\b/i;

/** One to three plain sentences, each checked. Returns the cleaned sentences or null. */
export function checkSentences(raw: unknown, f: RecapFacts): string[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 3) return null;
  const out: string[] = [];
  const allowed = allowedNumbers(f);
  let words = 0;
  for (const r of raw) {
    if (typeof r !== 'string') return null;
    const t = r.replace(/\s+/g, ' ').trim();
    if (t.length < 3 || t.length > 150) return null;
    if (SHAMING.test(t) || BANNED.test(t) || HYPE.test(t) || FILLER.test(t)) return null;
    const nums = (t.match(/\d+/g) || []).map(Number);
    for (const n of nums) if (!allowed.has(n)) return null;
    if (nums.length > 2) return null;                                         // no number pile-ups
    if (f.total > 7 && nums.includes(f.total)) return null;                   // the card already shows kept of total
    words += t.split(' ').length;
    out.push(t);
  }
  if (words > 38) return null;
  const all = out.join(' ').toLowerCase();
  if (f.weak && f.suggestion && !all.includes(f.weak.name.toLowerCase())) return null;
  if (f.missed && !f.missed.every((m) => all.includes(m.name.toLowerCase()))) return null;   // a near-perfect week names what was missed
  return out;
}

export const SYSTEM_PROMPT = [
  'You write the short note under a weekly recap card in a habit-tracking app. Each habit is called a vow.',
  'The card ABOVE your note already shows the total in large type ("kept of total vows") and one dot per day, so never restate the total, the kept count or "X of Y vows".',
  'Write 1 or 2 short sentences, 30 words at most in total, speaking to the user as "you". Say ONE useful thing; do not list statistics.',
  'Pick by this order:',
  '(1) "perfect_week" true: one sentence saying every vow was kept all 7 days.',
  '(2) "missed" present (a near-perfect week): say exactly which vow(s) were missed and on which day, plainly, e.g. "Only Saturday slipped: Sleep and Read." Nothing else is needed.',
  '(3) "weak" present: name that vow with its count (kept of "of" days, or times if "weekly"), then one concrete step: if "suggestion" is "first_today" say it is first on today\'s list; if "weekly_goal" suggest making it 3 times a week.',
  '(4) otherwise: one sentence on what the week was, using "perfect_days" or "days_active".',
  'If "best" is true you may open with a few words that it was the best week yet.',
  'Tone: plain, direct, specific. No hype, no exclamation marks, no emoji, no metaphors, no fantasy or game voice, no greetings.',
  'No generic advice or praise: never write "keep it up", "keep that slot", "stay consistent", "well done" or similar.',
  'Use only the facts given, digits for numbers, at most two numbers per sentence. Never invent a number, a day or a vow. Never shame or scold.',
  'Vary the wording from week to week. Reply as JSON: {"sentences": ["...", "..."]}.',
].join(' ');

async function callDeepSeek(env: Env, facts: RecapFacts, lastText: string | null, temperature: number): Promise<unknown> {
  const user = 'Facts for last week (Monday to Sunday):\n' + JSON.stringify(facts) +
    (lastText ? '\nLast week\'s note, do not reuse its wording: ' + JSON.stringify(lastText) : '');
  const res = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.DEEPSEEK_API_KEY },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: user }],
      response_format: { type: 'json_object' },
      max_tokens: 200,
      temperature,
    }),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error('deepseek ' + res.status);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content || '';
  return (JSON.parse(content) as { sentences?: unknown }).sentences;
}

/** Stored as { v, s }. A bare array is a W1015 (v1) message. */
function readStored(text: string): { v: number; s: string[] } | null {
  try {
    const o = JSON.parse(text) as unknown;
    if (Array.isArray(o)) return { v: 1, s: o.map(String) };
    const r = o as { v?: unknown; s?: unknown };
    if (r && typeof r.v === 'number' && Array.isArray(r.s)) return { v: r.v, s: r.s.map(String) };
  } catch { /* unreadable = no message */ }
  return null;
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

  // once per hunter per week (per message version)
  try {
    const hit = await env.DB.prepare('SELECT text FROM recap_texts WHERE user_id = ? AND week_start = ?').bind(session.userId, ws).first<{ text: string }>();
    const st = hit && hit.text ? readStored(hit.text) : null;
    if (st && st.v === RECAP_VERSION && st.s.length) return jsonOk({ ok: true, text: st.s, source: 'cache' });
  } catch { /* fall through — a cache miss only costs a call */ }

  if (!env.DEEPSEEK_API_KEY) return jsonOk({ ok: true, text: null, source: 'none' });

  let lastText: string | null = null;
  try {
    const prev = await env.DB.prepare('SELECT text FROM recap_texts WHERE user_id = ? AND week_start < ? ORDER BY week_start DESC LIMIT 1').bind(session.userId, ws).first<{ text: string }>();
    const st = prev && prev.text ? readStored(prev.text) : null;
    if (st && st.s.length) lastText = st.s.join(' ');
  } catch { /* variety is a nicety */ }

  let text: string[] | null = null;
  for (const temp of [1.0, 0.6]) {   // one retry, a little calmer, when a sentence fails the checks
    try { text = checkSentences(await callDeepSeek(env, facts, lastText, temp), facts); } catch { text = null; }
    if (text) break;
  }
  if (!text) return jsonOk({ ok: true, text: null, source: 'none' });

  try {
    await env.DB.prepare('INSERT OR REPLACE INTO recap_texts (user_id, week_start, text, created_at) VALUES (?, ?, ?, ?)')
      .bind(session.userId, ws, JSON.stringify({ v: RECAP_VERSION, s: text }), Date.now()).run();
  } catch { /* still return it */ }
  return jsonOk({ ok: true, text, source: 'ai' });
}
