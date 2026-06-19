// elo.ts — PvP rating brackets (PVP.md §12.2). Shared by the MatchRoom DO (per-slot
// rating in match_end) and the rating/leaderboard handlers. New players start at
// Silver (1500); Bronze exists for sub-1500 (no anti-fall protection at v1).
export function eloTier(elo: number): string {
  if (elo >= 3000) return 'Awakened';
  if (elo >= 2600) return 'Master';
  if (elo >= 2300) return 'Diamond';
  if (elo >= 2000) return 'Platinum';
  if (elo >= 1700) return 'Gold';
  if (elo >= 1500) return 'Silver';
  return 'Bronze';
}

// K-factor by bracket (PVP.md §11.3): higher volatility for newer/lower players,
// stable rating up top.
export function kFactor(elo: number): number {
  return elo < 1700 ? 32 : elo < 2200 ? 24 : elo < 2600 ? 16 : 12;
}
