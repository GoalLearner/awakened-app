/**
 * W658 — Leaderboard Archive (the week-flipper).
 *
 *   GET /v1/leaderboard/archive?week=YYYY-MM-DD
 *
 * The full FINAL Steps board for one finished week — the client's header
 * date-range becomes navigable ("‹ Jul 5 – 11 · FINAL ›"). Pure read over
 * the durable weekly_step_records merge (lib/week-board.ts — never the
 * eroding snapshots). Steps only: floor_best and relics_collected are
 * all-time metrics with no per-week history, so no archive exists for them.
 *
 * VALIDATION — one membership check does all three rules: the requested
 * week must be one of the last ARCHIVE_WEEKS_CAP (8) finished Sunday-Pacific
 * week keys. That simultaneously enforces (a) a real Sunday key, (b) past
 * weeks only (the live week is the live board's job), and (c) the owner's
 * 8-week cap ("recent history is interesting; ancient history is noise").
 *
 * min_week in the response = the earliest week with any real record,
 * clamped into the cap window — the client greys the back arrow there so
 * pre-launch, sims-only fake history can never be paged into.
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk, jsonError } from '../lib/responses';
import { getAccoladeWeekStart, priorWeekStart, weekEndFromStart } from '../lib/accolade-week';
import { readWeekBoard } from '../lib/week-board';

export const ARCHIVE_WEEKS_CAP = 8;

/** The valid archive keys, newest first: prior^1..prior^CAP of the current week. */
export function archiveWeekKeys(currentWeek: string): string[] {
  const keys: string[] = [];
  let k = currentWeek;
  for (let i = 0; i < ARCHIVE_WEEKS_CAP; i++) {
    k = priorWeekStart(k);
    keys.push(k);
  }
  return keys;
}

export async function handleLeaderboardArchiveGet(
  request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_LEADERBOARD_HOF.limit({ key: session.userId });
  if (!rl.success) {
    return jsonError(429, 'RATE_LIMITED', 'Too many requests. Slow down.');
  }

  const url = new URL(request.url);
  const week = url.searchParams.get('week') || '';
  const currentWeek = getAccoladeWeekStart();
  const valid = archiveWeekKeys(currentWeek);
  if (!valid.includes(week)) {
    return jsonError(
      400,
      'INVALID_WEEK',
      `week must be one of the last ${ARCHIVE_WEEKS_CAP} finished Sunday week keys.`,
    );
  }

  // Earliest week holding any REAL record (append-only table ⇒ cheap MIN),
  // clamped into the cap window. Weeks before this are sims-only fiction —
  // the client stops paging there.
  const minRow = await env.DB.prepare(
    'SELECT MIN(week_start) AS min_week FROM weekly_step_records',
  ).first<{ min_week: string | null }>();
  const oldestAllowed = valid[valid.length - 1];
  const minWeek = (minRow?.min_week && minRow.min_week > oldestAllowed)
    ? minRow.min_week
    : oldestAllowed;

  // W658 review fix — the floor is SERVER-enforced, not client-advisory:
  // a week inside the cap window but before the earliest real record would
  // return an empty board that the client's sim merge fills with bots — a
  // fully fake FINAL board for a pre-launch week. Reject it here so no
  // client race can ever render fiction under the FINAL badge.
  if (week < minWeek) {
    return jsonError(400, 'INVALID_WEEK', 'No records exist before ' + minWeek + '.');
  }

  const board = await readWeekBoard(env, week, session.userId);

  return jsonOk({
    week,
    weekEnd: weekEndFromStart(week),
    final: true,
    records: board.records,
    me: board.me,
    total: board.total,
    min_week: minWeek,
    // Newest-first keys the client may page through (bounded by min_week).
    weeks_available: valid.filter((k) => k >= minWeek),
  });
}
