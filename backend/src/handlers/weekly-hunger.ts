/**
 * weekly-hunger.ts — W845 (Train 5, E2) owner-override read for the rotating
 * weekly boss modifier.
 *
 * GET /v1/weekly-hunger → { ok, week_start, boss_id | null }
 *
 * The weekly pick is deterministic CLIENT-side (hash of the PT-Sunday week
 * key over the eligible catalog — no server needed for devices to agree).
 * This endpoint only surfaces the owner's hand-pick for the current week
 * (weekly_hunger_overrides, 0050); null means "no override — your
 * deterministic pick stands". Cheap single-PK read, cached client-side per
 * week, so failure/absence degrades to determinism, never to no-feature.
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk, jsonError } from '../lib/responses';

/** PT-Sunday 'YYYY-MM-DD' week key for now — mirrors the client's board-week
 *  anchor (lbGetCurrentWeekStartPT) and the leaderboard week_start values. */
function ptWeekStartNow(): string {
  const now = new Date();
  const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(now);
  let weekday = 0;
  for (const p of new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
  }).formatToParts(now)) {
    if (p.type === 'weekday') weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.value);
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m || weekday < 0) return dayKey;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) - weekday * 86400000);
  return (
    d.getUTCFullYear() + '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(d.getUTCDate()).padStart(2, '0')
  );
}

export async function handleWeeklyHungerGet(
  _request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_FRIENDS_READ.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');

  const week = ptWeekStartNow();
  const row = await env.DB.prepare(
    'SELECT boss_id FROM weekly_hunger_overrides WHERE week_start = ?',
  )
    .bind(week)
    .first<{ boss_id: string }>();
  return jsonOk({ ok: true, week_start: week, boss_id: row ? row.boss_id : null });
}
