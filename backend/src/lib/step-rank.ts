/**
 * step-rank.ts — W1178 (owner 2026-11-09): "your average steps per day (last 14 days) vs how it
 * ranks statistically vs the people using the app". Pure helpers for GET /v1/steps/rank.
 *
 * A hunter's average = the mean of the days in the window that HAVE steps (a day with nothing
 * recorded doesn't drag it down), and a hunter is ranked only with MIN_DAYS such days. The window
 * is the 14 finished Pacific days before today: today is still being walked.
 */
import { prevDay, ptDayKey } from './pact-streak';

export const STEP_RANK_DAYS = 14;
export const STEP_RANK_MIN_DAYS = 3;

/** The 14 finished Pacific days before `nowMs`, oldest first. */
export function stepRankWindow(nowMs: number): string[] {
  const out: string[] = [];
  let d = prevDay(ptDayKey(nowMs));
  for (let i = 0; i < STEP_RANK_DAYS && d; i++) { out.push(d); d = prevDay(d); }
  return out.reverse();
}

/** One hunter's average over `days` from a steps_daily map, or null when fewer than MIN_DAYS have steps. */
export function stepAverage(daily: unknown, days: string[]): number | null {
  if (!daily || typeof daily !== 'object') return null;
  const m = daily as Record<string, unknown>;
  let sum = 0, n = 0;
  for (const k of days) {
    const v = Number(m[k]);
    if (Number.isFinite(v) && v > 0 && v < 200_000) { sum += v; n++; }   // 200k a day = a broken reading, not a walk
  }
  return n >= STEP_RANK_MIN_DAYS ? Math.round(sum / n) : null;
}

/** steps_daily as SQLite hands it back (JSON text of the map, or null). */
export function parseDaily(text: unknown): Record<string, unknown> | null {
  if (typeof text !== 'string' || !text) return null;
  try { const o = JSON.parse(text); return o && typeof o === 'object' && !Array.isArray(o) ? o : null; } catch { return null; }
}
