// seasons.ts — ranked season window + the soft reset. Shared by the rating/leaderboard
// handlers and the MatchRoom DO. The "current" season is the latest row; if it has expired,
// the next one is created lazily on read (idempotent via the UNIQUE number) so no scheduled
// job is required. The worker runs in UTC, so all timestamp math is UTC-consistent.
import type { Env } from '../env';

export const SEASON_LENGTH_DAYS = 35;
export const PVP_PLACEMENT_GAMES = 5;   // ranked matches before a season rank is revealed
const DAY_MS = 86_400_000;

export interface Season { id: number; number: number; started_at: string; ends_at: string; }

// New-season starting elo: halve the distance to 1500 (a soft reset — keeps relative standing
// but compresses the ladder so everyone re-places without starting from scratch).
export function softResetElo(elo: number): number { return Math.round(1500 + (elo - 1500) * 0.5); }

export function daysLeft(season: Season): number {
  const ms = Date.parse(season.ends_at) - Date.now();
  return Math.max(0, Math.ceil(ms / DAY_MS));
}

async function createSeason(env: Env, number: number, startMs: number): Promise<Season> {
  const started = new Date(startMs).toISOString();
  const ends = new Date(startMs + SEASON_LENGTH_DAYS * DAY_MS).toISOString();
  try {
    await env.DB.prepare('INSERT OR IGNORE INTO pvp_seasons (number, started_at, ends_at) VALUES (?, ?, ?)')
      .bind(number, started, ends).run();
  } catch { /* race — re-read below */ }
  const s = await env.DB.prepare('SELECT id, number, started_at, ends_at FROM pvp_seasons WHERE number = ?')
    .bind(number).first<Season>();
  return s || { id: number, number, started_at: started, ends_at: ends };
}

// The active season, creating/rolling lazily. Safe under concurrency (UNIQUE number gate).
export async function currentSeason(env: Env): Promise<Season> {
  const s = await env.DB.prepare('SELECT id, number, started_at, ends_at FROM pvp_seasons ORDER BY number DESC LIMIT 1')
    .first<Season>();
  const now = Date.now();
  if (!s) return await createSeason(env, 1, now);
  if (Date.parse(s.ends_at) <= now) return await createSeason(env, s.number + 1, now);   // roll
  return s;
}
