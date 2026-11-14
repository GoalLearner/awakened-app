/**
 * steps-rank.ts — GET /v1/steps/rank (W1178). Read-only; W1212 adds the shared row (0076).
 *
 * Today's Briefing ranks the caller's 14-day average steps against every hunter who walked with
 * the app in those 14 days. The days come from each hunter's cloud save (hb_leaderboard →
 * steps_daily, Apple Health only — W799), the same source the boss audits read.
 *
 * Response: { ok, days: [first, last], others: number[] } — every OTHER hunter's average,
 * highest first, anonymous. The phone places its own (fresher) average among them.
 *
 * W1212 (owner 2026-11-14: "make sure the awakened server / app won't crash if there's a mass
 * influx") — the scan reads every recent save's JSON. It used to run once per Worker isolate per
 * CACHE_MS, so a rush (many isolates) multiplied it. Now the cron computes it once into
 * steps_rank_cache (0076) every CACHE_MS, the endpoint reads that row, and an isolate only scans
 * itself when the row is missing, from another window, or older than STALE_MS (the cron stopped).
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk, jsonError } from '../lib/responses';
import { parseDaily, stepAverage, stepRankWindow } from '../lib/step-rank';

const CACHE_MS = 15 * 60 * 1000;
/** W1212 — past this the shared row is too old to serve and an isolate computes it itself. */
const STALE_MS = 45 * 60 * 1000;
type RankRow = { u: string; a: number };
let cache: { at: number; first: string; rows: RankRow[] } | null = null;

export function _resetStepRankCache(): void { cache = null; }

/** Every hunter's 14-day average from the recent saves, highest first (the scan). */
async function computeRanks(env: Env, nowMs: number, days: string[]): Promise<RankRow[]> {
  // A save last written before the window began can't hold a day inside it.
  const since = nowMs - (days.length + 2) * 86_400_000;
  const res = await env.DB.prepare(
    `SELECT s.user_id AS u,
            json_extract(json_extract(s.state_json, '$.keys.hb_leaderboard'), '$.steps_daily') AS d
       FROM user_state_snapshots s JOIN users u ON u.id = s.user_id
      WHERE s.server_updated_at >= ?
        AND COALESCE(u.apple_sub, '') NOT LIKE 'sim_test_%'`,
  ).bind(since).all<{ u: string; d: string | null }>();
  const rows: RankRow[] = [];
  for (const r of res.results || []) {
    let a: number | null = null;
    try { a = stepAverage(parseDaily(r.d), days); } catch { a = null; }
    if (a != null) rows.push({ u: r.u, a });
  }
  rows.sort((x, y) => y.a - x.a);
  return rows;
}

async function writeShared(env: Env, first: string, rows: RankRow[], nowMs: number): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO steps_rank_cache (id, first_day, averages_json, computed_at) VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET first_day = excluded.first_day, averages_json = excluded.averages_json, computed_at = excluded.computed_at`,
    ).bind(first, JSON.stringify(rows), nowMs).run();
  } catch {
    /* pre-0076 database: the isolate copy still serves */
  }
}

async function readShared(env: Env): Promise<{ first: string; at: number; rows: RankRow[] } | null> {
  try {
    const row = await env.DB.prepare('SELECT first_day, averages_json, computed_at FROM steps_rank_cache WHERE id = 1')
      .first<{ first_day: string; averages_json: string; computed_at: number }>();
    if (!row) return null;
    const rows = JSON.parse(row.averages_json);
    if (!Array.isArray(rows)) return null;
    return { first: String(row.first_day), at: Number(row.computed_at) || 0, rows: rows as RankRow[] };
  } catch {
    return null;
  }
}

/** W1212 — the cron's half: recompute the shared row when it is from another window or older than
 *  CACHE_MS. One SELECT when it is fresh. Returns true when it recomputed. */
export async function refreshStepRankCache(env: Env, nowMs: number = Date.now()): Promise<boolean> {
  try {
    const days = stepRankWindow(nowMs);
    const cur = await readShared(env);
    if (cur && cur.first === days[0] && nowMs - cur.at < CACHE_MS) return false;
    const rows = await computeRanks(env, nowMs, days);
    await writeShared(env, days[0], rows, nowMs);
    return true;
  } catch (err) {
    console.error('[steps-rank] cache refresh failed', err);
    return false;
  }
}

export async function handleStepsRank(_request: Request, env: Env, session: SessionPayload): Promise<Response> {
  const rl = await env.RL_LEADERBOARD_TOP.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');

  const now = Date.now();
  const days = stepRankWindow(now);
  if (!cache || now - cache.at > CACHE_MS || cache.first !== days[0]) {
    const shared = await readShared(env);
    if (shared && shared.first === days[0] && now - shared.at < STALE_MS) {
      cache = { at: now, first: shared.first, rows: shared.rows };
    } else {
      const rows = await computeRanks(env, now, days);
      cache = { at: now, first: days[0], rows };
      await writeShared(env, days[0], rows, now);
    }
  }
  const others = cache.rows.filter((r) => r.u !== session.userId).map((r) => r.a);
  return jsonOk({ ok: true, days: [days[0], days[days.length - 1]], others });
}
