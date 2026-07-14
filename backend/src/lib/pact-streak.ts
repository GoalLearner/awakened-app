/**
 * pact-streak.ts — server-authoritative co-op "Pact" daily-streak computation.
 *
 * v1 (client-only) had each device reconstruct a friend-pair's daily streak from
 * its own local co-op-win history, so two friends could see DIFFERENT numbers
 * (LIMIT-20 truncation, a missed award, or timestamp parsing that differed by the
 * device timezone). This module is the Phase-2 fix: the Worker owns the durable
 * `coop_boss_instances` history and computes the CANONICAL pact per pair, so both
 * friends fetch the same numbers.
 *
 * The day math intentionally mirrors the client (app.js `_pactDayKey` /
 * `_pactPrevDay` / `_coopBackfillPacts`): a shared co-op WIN on a **Pacific**
 * calendar day advances the streak once per day; the streak returned here is the
 * run ending at the most recent day, and the client applies the alive/lit check
 * (last win today or yesterday) at read time.
 */

/** Pacific ('America/Los_Angeles') 'YYYY-MM-DD' day key for a UTC epoch-ms value. */
export function ptDayKey(ms: number): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(ms));
  } catch {
    return '';
  }
}

/**
 * The calendar day BEFORE a 'YYYY-MM-DD' key. Pure UTC date-math on a date-only
 * value (Date.UTC ± 86_400_000) — no wall-clock, so it is DST-safe. Drives the
 * consecutive-day checks; lexicographic order of 'YYYY-MM-DD' == chronological.
 */
export function prevDay(dayKey: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey || '');
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) - 86_400_000);
  return (
    d.getUTCFullYear() +
    '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getUTCDate()).padStart(2, '0')
  );
}

/**
 * Parse a SQLite `CURRENT_TIMESTAMP` value ('YYYY-MM-DD HH:MM:SS', **UTC**, no
 * zone suffix) — or any ISO-ish string — to epoch ms as UTC. The space-form is
 * NOT ISO 8601, so `Date.parse` would interpret it in the runtime's local zone;
 * we normalize (space→'T', append 'Z' when no offset present) so it is always
 * read as UTC regardless of where the code runs. Returns 0 when unparseable.
 */
export function sqliteUtcToMs(ts: string | null | undefined): number {
  if (!ts) return 0;
  let s = String(ts).trim();
  if (!s) return 0;
  if (!s.includes('T')) s = s.replace(' ', 'T');
  if (!/[Zz]$|[+-]\d{2}:?\d{2}$/.test(s)) s += 'Z';
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : 0;
}

export interface WinRow {
  challenger_user_id: string;
  partner_user_id: string;
  boss_id: string | null;
  resolved_at: string | null;
}

export interface PactAgg {
  streak: number; // current run ending at the most recent day (client applies alive check)
  best: number; // all-time longest consecutive-day run
  total: number; // every co-op boss ever felled together (the Bond)
  daysBonded: number; // distinct Pacific days cleared together
  lastDay: string; // most recent PT day key ('' if none)
  firstWonAt: number; // epoch ms of the first win (pact forged)
  lastWonAt: number; // epoch ms of the most recent win
  lastBossId: string | null;
}

/**
 * Group a viewer's winning co-op instances by the OTHER participant and compute
 * the canonical daily-streak aggregate per pair. `rows` MUST already be filtered
 * to wins (status='completed' AND result='success') where the viewer is a
 * participant; ordering is irrelevant (sorted internally).
 */
export function computePacts(rows: WinRow[], viewerUserId: string): Record<string, PactAgg> {
  const groups = new Map<string, { ms: number; boss: string | null }[]>();
  for (const r of rows || []) {
    if (!r) continue;
    const other =
      r.challenger_user_id === viewerUserId
        ? r.partner_user_id
        : r.partner_user_id === viewerUserId
          ? r.challenger_user_id
          : '';
    if (!other) continue; // viewer isn't a participant (defensive; the query guarantees they are)
    const ms = sqliteUtcToMs(r.resolved_at);
    if (!ms) continue; // unresolved / unparseable timestamp — can't place it on a day
    let g = groups.get(other);
    if (!g) {
      g = [];
      groups.set(other, g);
    }
    g.push({ ms, boss: r.boss_id || null });
  }

  const out: Record<string, PactAgg> = {};
  for (const [other, times] of groups) {
    times.sort((a, b) => a.ms - b.ms);
    // distinct PT days, in chronological order
    const days: string[] = [];
    const seen = new Set<string>();
    for (const t of times) {
      const dk = ptDayKey(t.ms);
      if (dk && !seen.has(dk)) {
        seen.add(dk);
        days.push(dk);
      }
    }
    let best = 0;
    let cur = 0;
    for (let i = 0; i < days.length; i++) {
      cur = i > 0 && days[i - 1] === prevDay(days[i]) ? cur + 1 : 1;
      if (cur > best) best = cur;
    }
    const last = times[times.length - 1];
    out[other] = {
      streak: cur,
      best,
      total: times.length,
      daysBonded: days.length,
      lastDay: days.length ? days[days.length - 1] : '',
      firstWonAt: times[0] ? times[0].ms : 0,
      lastWonAt: last ? last.ms : 0,
      lastBossId: last ? last.boss : null,
    };
  }
  return out;
}
