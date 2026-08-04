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
 * `_pactPrevDay` / `_coopBackfillPacts`): a shared co-op HUNT on a **Pacific**
 * calendar day advances the streak once per day; the streak returned here is the
 * run ending at the most recent day, and the client applies the alive/lit check
 * (last hunt today or yesterday) at read time.
 *
 * W813 (owner rule change) — the pact is a COMMITMENT streak, not a victory
 * streak: any hunt the pair actually STARTED together (every seat accepted →
 * starts_at stamped) keeps the flame burning, win or lose. The day anchor is
 * the hunt's start day (`starts_at`), so a multi-day raid credits the day the
 * pact was made and the flame lights the moment the hunt begins. Only `total`
 * (the Bond — "bosses defeated together") still counts wins, via `is_win`.
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
  id?: string;
  challenger_user_id: string;
  partner_user_id: string;
  // W677 — trio hunts: the second ally (null on duo rows).
  partner2_user_id?: string | null;
  // W692 — N-hunter raids: the FULL roster (challenger + every participant). When
  // present it supersedes the legacy 3 columns, so a 4th/5th raid seat is credited.
  participant_ids?: string[];
  boss_id: string | null;
  resolved_at: string | null;
  // W813 — attempt anchor: when present it supersedes resolved_at as the streak
  // day (the PT day the hunt STARTED — i.e. when both hunters committed).
  starts_at?: string | null;
  // W813 — SQLite 0/1 (or boolean). undefined = legacy wins-only caller, treated
  // as a win so pre-W813 call sites keep their `total` semantics.
  is_win?: number | boolean;
}

export interface PactAgg {
  streak: number; // current run ending at the most recent day (client applies alive check)
  best: number; // all-time longest consecutive-day run
  total: number; // every co-op boss ever defeated together (the Bond — WINS only, W813)
  daysBonded: number; // distinct Pacific days hunted together (win or lose, W813)
  lastDay: string; // most recent PT day key ('' if none)
  firstWonAt: number; // epoch ms of the first hunt together (pact forged)
  lastWonAt: number; // epoch ms of the most recent hunt together
  lastBossId: string | null;
}

/**
 * Group a viewer's STARTED co-op instances by the OTHER participant and compute
 * the canonical daily-streak aggregate per pair. W813: `rows` should be every
 * instance the viewer participated in that actually began (starts_at NOT NULL),
 * each carrying `is_win` — the streak counts attempts, `total` counts wins.
 * (Legacy callers passing wins-only rows without `is_win` keep old semantics.)
 * Ordering is irrelevant (sorted internally).
 */
export function computePacts(rows: WinRow[], viewerUserId: string): Record<string, PactAgg> {
  const groups = new Map<string, { ms: number; boss: string | null; win: boolean }[]>();
  for (const r of rows || []) {
    if (!r) continue;
    // W677/W692 — a win credits the viewer's pact with EVERY other hunter on the
    // instance: one other on a duo, both on a trio, up to four on a 5-hunter raid
    // (owner: a raid win "counts for the flames" for every pair — each daily streak
    // advances). Prefer the N-hunter roster; fall back to the legacy 3 columns.
    const participants =
      Array.isArray(r.participant_ids) && r.participant_ids.length
        ? r.participant_ids
        : r.partner2_user_id
          ? [r.challenger_user_id, r.partner_user_id, r.partner2_user_id]
          : [r.challenger_user_id, r.partner_user_id];
    if (!participants.includes(viewerUserId)) continue; // defensive; the query guarantees membership
    const others = participants.filter((uid) => uid && uid !== viewerUserId);
    // W813 — prefer the attempt anchor (start day); fall back to resolved_at for
    // legacy wins-only callers.
    const ms = sqliteUtcToMs(r.starts_at ?? r.resolved_at);
    if (!ms) continue; // never started / unparseable timestamp — can't place it on a day
    const win = r.is_win === undefined ? true : !!r.is_win;
    for (const other of others) {
      let g = groups.get(other);
      if (!g) {
        g = [];
        groups.set(other, g);
      }
      g.push({ ms, boss: r.boss_id || null, win });
    }
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
      // W813 — the Bond counts only bosses actually DEFEATED together.
      total: times.reduce((n, t) => n + (t.win ? 1 : 0), 0),
      daysBonded: days.length,
      lastDay: days.length ? days[days.length - 1] : '',
      firstWonAt: times[0] ? times[0].ms : 0,
      lastWonAt: last ? last.ms : 0,
      lastBossId: last ? last.boss : null,
    };
  }
  return out;
}
