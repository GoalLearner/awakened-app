/**
 * skins-earn.ts — W1098 POST /v1/users/me/skins/earn (auth required).
 *
 * Owner (2026-10-26): the seven top-tier skins are no longer sold; each one is EARNED by a
 * milestone. Leaderboards only show a top-tier skin that skin_entitlements says the hunter owns
 * (the W739 check in public-profile-summary.ts), so earning one writes the same row a purchase
 * writes (source 'earned'). Hunters who bought one keep it: their purchase row is untouched.
 *
 *   Emberforged         keep a pact flame with one friend for 30 days     claim, or the server's pacts
 *   The Void-Touched    raise 10 shadows                                  claim (shadows live on the phone)
 *   The Verdant Oracle  open the app 30 days in a row                     SERVER ONLY (app_opens)
 *   Null Protocol       clear Floor 90 of the Ascent                      claim
 *   Null Protocol II    slay 200 bosses                                   claim
 *   Dawnbringer         reach S rank                                      claim
 *   Stardust Sovereign  walk 1,000,000 steps                              claim (lifetime steps live on the phone)
 *
 * A claim is the phone saying its own numbers met the milestone: the same client-reported trust
 * model as rank, floors and the card backgrounds (cosmetic, nothing for sale any more). The
 * one milestone the phone cannot know is the run of days the app was opened, so the server counts
 * it from app_opens, including the iOS 27 crash grace (owner 2026-10-26): a hunter locked out by
 * 3.0.15 has every day from 2026-10-23 until their first open of 3.0.16 or later counted as opened.
 *
 * Body: { claims?: string[] } (skin ids such as 'avatar-skin-stardust.png').
 * Returns { ok, skins: owned ids, granted: ids newly written by THIS call,
 *           progress: { opened: { best, current }, flame: { best } } }.
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk, jsonError, readJsonObject } from '../lib/responses';
import { readEntitlements } from './iap-entitlements';
import { computePacts } from '../lib/pact-streak';
import { loadStartedPactRows } from './coop-pacts';

export const EARN_VERDANT = 'avatar-skin-verdant.png';
export const EARN_EMBER = 'avatar-skin-emberforged.png';
/** Every earnable skin id. Ids are the catalog file names skin_entitlements already uses. */
export const EARNABLE_SKINS: readonly string[] = [
  EARN_EMBER,
  'avatar-skin-voidtouched.png',
  EARN_VERDANT,
  'avatar-skin-nullprotocol.png',
  'avatar-skin-nullprotocol-2.png',
  'avatar-skin-dawnbringer.png',
  'avatar-skin-stardust.png',
];
/** The one the phone may not claim: only the server knows the days the app was opened. */
const SERVER_ONLY = new Set([EARN_VERDANT]);
export const OPEN_RUN_GOAL = 30;
export const FLAME_GOAL = 30;

/** The iOS 27 crash (3.0.15, released 2026-10-23): the first day a locked-out hunter lost. */
export const CRASH_FIRST_DAY = '2026-10-23';
const CRASH_ACTIVE_FROM = '2026-10-22';

/** '3.0.14-w1074' → [3, 0, 14]; anything else → null. */
export function buildVersion(build: string | null | undefined): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(build || ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function cmpVer(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}
function dayAdd(dayKey: string, n: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) + n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/**
 * The crash grace: the UTC days counted as opened for a hunter locked out by 3.0.15.
 * Locked out = opened a build at or below 3.0.14 on or after 2026-10-22, and never once
 * opened 3.0.15. The grace runs from 2026-10-23 through the day before their first open of
 * 3.0.16 or later, or through `today` if they have not come back yet.
 */
export function crashGraceDays(rows: { date_utc: string; build: string | null }[], today: string): string[] {
  let before = false;
  let opened315 = false;
  let firstFix = '';
  for (const r of rows) {
    const v = buildVersion(r.build);
    if (!v) continue;
    if (v[0] === 3 && v[1] === 0 && v[2] === 15) opened315 = true;
    if (r.date_utc >= CRASH_ACTIVE_FROM && cmpVer(v, [3, 0, 14]) <= 0) before = true;
    if (cmpVer(v, [3, 0, 16]) >= 0 && r.date_utc >= CRASH_FIRST_DAY && (!firstFix || r.date_utc < firstFix)) firstFix = r.date_utc;
  }
  if (!before || opened315) return [];
  const last = firstFix ? dayAdd(firstFix, -1) : today;
  const out: string[] = [];
  for (let d = CRASH_FIRST_DAY; d && d <= last && out.length < 400; d = dayAdd(d, 1)) out.push(d);
  return out;
}

/** Longest run of consecutive UTC days, and the run still alive (ending today or yesterday). */
export function openRuns(days: string[], today: string): { best: number; current: number } {
  const set = Array.from(new Set(days.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))).sort();
  let best = 0;
  let run = 0;
  let prev = '';
  for (const d of set) {
    run = prev && dayAdd(prev, 1) === d ? run + 1 : 1;
    if (run > best) best = run;
    prev = d;
  }
  const last = set[set.length - 1] || '';
  const current = last && (last === today || last === dayAdd(today, -1)) ? run : 0;
  return { best, current };
}

async function openProgress(env: Env, userId: string): Promise<{ best: number; current: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const rows = (await env.DB.prepare('SELECT date_utc, build FROM app_opens WHERE user_id = ? ORDER BY date_utc')
    .bind(userId)
    .all<{ date_utc: string; build: string | null }>()).results ?? [];
  const days = rows.map((r) => r.date_utc).concat(crashGraceDays(rows, today));
  return openRuns(days, today);
}

async function flameProgress(env: Env, userId: string): Promise<{ best: number }> {
  try {
    const pacts = computePacts(await loadStartedPactRows(env, userId), userId);
    let best = 0;
    for (const k of Object.keys(pacts)) best = Math.max(best, pacts[k].best | 0);
    return { best };
  } catch {
    return { best: 0 };
  }
}

export async function handleSkinsEarn(request: Request, env: Env, session: SessionPayload): Promise<Response> {
  const rl = await env.RL_USER_ACCOLADES_READ.limit({ key: 'earn:' + session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  const body = await readJsonObject(request);
  const raw = body && Array.isArray(body.claims) ? body.claims : [];
  const claims = new Set(
    raw.filter((c): c is string => typeof c === 'string' && EARNABLE_SKINS.includes(c) && !SERVER_ONLY.has(c)),
  );

  const [ent, opened, flame] = await Promise.all([
    readEntitlements(env, session.userId),
    openProgress(env, session.userId),
    flameProgress(env, session.userId),
  ]);
  if (opened.best >= OPEN_RUN_GOAL) claims.add(EARN_VERDANT);
  if (flame.best >= FLAME_GOAL) claims.add(EARN_EMBER);

  const owned = new Set(ent.skins);
  const want = Array.from(claims).filter((id) => !owned.has(id));
  const granted: string[] = [];
  if (want.length) {
    const res = await env.DB.batch(
      want.map((id) =>
        env.DB.prepare(
          `INSERT OR IGNORE INTO skin_entitlements (user_id, skin_id, product_id, store, store_txn_id, source)
           VALUES (?, ?, 'earned', 'earned', NULL, 'earned_w1098')`,
        ).bind(session.userId, id),
      ),
    );
    res.forEach((r, i) => {
      if (Number(r?.meta?.changes ?? 0) > 0) {
        granted.push(want[i]);
        owned.add(want[i]);
      }
    });
  }
  return jsonOk({ ok: true, skins: Array.from(owned), granted, progress: { opened, flame } });
}
