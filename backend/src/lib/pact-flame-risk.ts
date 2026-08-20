/**
 * pact-flame-risk.ts — W837 (Train 3, R3) pact-flame-at-risk evening push.
 *
 * The Pact Flame is the app's strongest social hook, and it dies SILENTLY at
 * Pacific midnight: a pair with a live streak that doesn't START a hunt
 * together that day loses the flame with zero warning (W813 commitment rule —
 * entering counts, win or lose). This sweep warns BOTH partners in the
 * evening while there is still time to act.
 *
 * At-risk definition: the pair's consecutive-day run ends at YESTERDAY (PT)
 * — nothing started together today — and the run is >= MIN_STREAK days (a
 * 1-day flame is left to die quietly; nudging every first hunt would be
 * noise, and noise is the opt-out risk this train exists to avoid).
 *
 * Rides the every-2-minute cron sweep, gated to the 19:00 (7 PM) PT hour —
 * evening enough to be urgent, early enough that entering a hunt is
 * realistic. pact_flame_pushes (0048) PK (user_a, user_b, day_key) is the
 * claim, inserted BEFORE the sends, so the cadence can never double-send.
 * Day math reuses pact-streak.ts so the warning can never disagree with the
 * canonical streak the Pact Flames screen shows.
 */
import type { Env } from '../env';
import { notifyUser, pushConfigured } from './apns';
import { ptDayKey, prevDay, sqliteUtcToMs } from './pact-streak';

const RISK_PT_HOUR = 19; // 7 PM Pacific
const MIN_STREAK = 2;
const MAX_PAIRS_PER_RUN = 20;
const HISTORY_DAYS = 180; // streak window: runs longer than this are still >= MIN_STREAK, so eligibility is unaffected

export interface StartedRow {
  id?: string;
  challenger_user_id: string;
  partner_user_id: string;
  partner2_user_id?: string | null;
  participant_ids?: string[];
  starts_at: string | null;
}

/** Every unordered pair on a started instance's roster, canonical (a < b). */
function rosterPairs(r: StartedRow): [string, string][] {
  const parts =
    Array.isArray(r.participant_ids) && r.participant_ids.length
      ? r.participant_ids
      : r.partner2_user_id
        ? [r.challenger_user_id, r.partner_user_id, r.partner2_user_id]
        : [r.challenger_user_id, r.partner_user_id];
  const uniq = [...new Set(parts.filter(Boolean))];
  const out: [string, string][] = [];
  for (let i = 0; i < uniq.length; i++) {
    for (let j = i + 1; j < uniq.length; j++) {
      out.push(uniq[i] < uniq[j] ? [uniq[i], uniq[j]] : [uniq[j], uniq[i]]);
    }
  }
  return out;
}

/** Pure core (unit-tested): pairs whose flame dies tonight. */
export function findAtRiskPairs(
  rows: StartedRow[],
  todayPt: string,
): { a: string; b: string; streak: number }[] {
  const yesterday = prevDay(todayPt);
  const pairDays = new Map<string, Set<string>>();
  for (const r of rows || []) {
    const ms = sqliteUtcToMs(r && r.starts_at);
    if (!ms) continue;
    const dk = ptDayKey(ms);
    if (!dk) continue;
    for (const [a, b] of rosterPairs(r)) {
      const key = a + '|' + b;
      let s = pairDays.get(key);
      if (!s) {
        s = new Set();
        pairDays.set(key, s);
      }
      s.add(dk);
    }
  }
  const out: { a: string; b: string; streak: number }[] = [];
  for (const [key, days] of pairDays) {
    if (days.has(todayPt)) continue; // already committed today — flame safe
    if (!days.has(yesterday)) continue; // flame not alive (or already dead)
    let streak = 1;
    let d = yesterday;
    while (days.has(prevDay(d))) {
      streak++;
      d = prevDay(d);
    }
    if (streak < MIN_STREAK) continue;
    const [a, b] = key.split('|');
    out.push({ a, b, streak });
  }
  // Longest flames first — if the per-run cap ever bites, the biggest losses
  // get warned first.
  out.sort((x, y) => y.streak - x.streak);
  return out;
}

export function flameRiskNotif(partnerAlias: string, streak: number) {
  return {
    title: 'The Pact Flame gutters',
    body:
      streak +
      ' days strong with ' +
      partnerAlias +
      ' — the flame dies at midnight unless you enter a hunt together tonight.',
    type: 'pact_flame_risk',
  } as const;
}

/** Cron sweep entry. `ptHourOverride` exists for tests/admin only. */
export async function sweepPactFlameRisk(
  env: Env,
  ptHourOverride?: number,
): Promise<{ ok: boolean; pairs: number; sent: number; reason?: string }> {
  try {
    const hour =
      typeof ptHourOverride === 'number'
        ? ptHourOverride
        : Number(
            new Intl.DateTimeFormat('en-US', {
              timeZone: 'America/Los_Angeles',
              hour12: false,
              hour: '2-digit',
            })
              .formatToParts(new Date())
              .find((p) => p.type === 'hour')?.value ?? -1,
          ) % 24;
    if (hour !== RISK_PT_HOUR) return { ok: true, pairs: 0, sent: 0, reason: 'OFF_HOUR' };
    if (!pushConfigured(env)) return { ok: false, pairs: 0, sent: 0, reason: 'PUSH_NOT_CONFIGURED' };

    // Every started instance in the streak-relevant window + its full roster.
    const rows = await env.DB.prepare(
      `SELECT i.id, i.challenger_user_id, i.partner_user_id, i.partner2_user_id, i.starts_at
         FROM coop_boss_instances i
        WHERE i.starts_at IS NOT NULL
          AND i.starts_at >= datetime('now', '-${HISTORY_DAYS} days')`,
    ).all<StartedRow>();
    const list = rows.results ?? [];
    const ids = list.map((r) => r.id).filter((x): x is string => !!x);
    if (ids.length) {
      const ph = ids.map(() => '?').join(', ');
      const pr = await env.DB.prepare(
        `SELECT instance_id, user_id FROM coop_boss_participants WHERE instance_id IN (${ph})`,
      )
        .bind(...ids)
        .all<{ instance_id: string; user_id: string }>();
      const byInstance = new Map<string, string[]>();
      for (const p of pr.results ?? []) {
        const a = byInstance.get(p.instance_id) ?? [];
        a.push(p.user_id);
        byInstance.set(p.instance_id, a);
      }
      for (const r of list) {
        r.participant_ids = [r.challenger_user_id, ...(r.id ? byInstance.get(r.id) ?? [] : [])];
      }
    }

    const today = ptDayKey(Date.now());
    const atRisk = findAtRiskPairs(list, today).slice(0, MAX_PAIRS_PER_RUN);
    if (atRisk.length === 0) return { ok: true, pairs: 0, sent: 0 };

    // Aliases for the personalized body ("… with James —").
    const userIds = [...new Set(atRisk.flatMap((p) => [p.a, p.b]))];
    const ph = userIds.map(() => '?').join(', ');
    const ur = await env.DB.prepare(`SELECT id, alias FROM users WHERE id IN (${ph})`)
      .bind(...userIds)
      .all<{ id: string; alias: string }>();
    const aliasById = new Map((ur.results ?? []).map((u) => [u.id, u.alias]));

    let sent = 0;
    for (const pair of atRisk) {
      // CLAIM before send — one warning per (pair, evening), ever.
      const claim = await env.DB.prepare(
        'INSERT OR IGNORE INTO pact_flame_pushes (user_a, user_b, day_key, sent_at) VALUES (?, ?, ?, ?)',
      )
        .bind(pair.a, pair.b, today, Date.now())
        .run();
      if (!(claim.meta && Number(claim.meta.changes) >= 1)) continue;
      await notifyUser(env, pair.a, {
        ...flameRiskNotif(aliasById.get(pair.b) || 'your partner', pair.streak),
        data: {},
      });
      await notifyUser(env, pair.b, {
        ...flameRiskNotif(aliasById.get(pair.a) || 'your partner', pair.streak),
        data: {},
      });
      sent += 2;
    }
    if (sent > 0) console.log(`[pact-flame-risk] warned ${sent / 2} pairs (${sent} pushes)`);
    return { ok: true, pairs: atRisk.length, sent };
  } catch (e) {
    console.error(
      '[pact-flame-risk] sweep failed',
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
    );
    return { ok: false, pairs: 0, sent: 0, reason: 'INTERNAL' };
  }
}
