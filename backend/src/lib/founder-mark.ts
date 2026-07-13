/**
 * founder-mark.ts — W656 free/earned "Founder" prestige marker (capped at 100).
 *
 * Server-authoritative and idempotent. Eligibility is checkable only from
 * server truth (registration date + the step_100k_club accolade + co-op wins),
 * so a modded client cannot fake its way into a permanently-scarce badge.
 * Sims never qualify: they have no `users` row, which both the created_at gate
 * and the accolade/coop-win joins require.
 */
import type { Env } from '../env';

export const FOUNDER_MARK_CAP = 100;
// 2026-07-09T00:00:00Z — the monetization go-live cutoff (mirrors the removed
// FOUNDER_PROMO_CUTOFF_MS). "You were here before the store opened."
export const FOUNDER_CUTOFF_MS = 1783555200000;
export const FOUNDER_COOP_WIN_THRESHOLD = 25;
const STEP_100K_ACCOLADE = 'step_100k_club';

/** BOTH conditions, all server-verifiable: registered before go-live AND
 *  (100K Club accolade OR >= 25 co-op boss wins). */
export async function isFounderMarkEligible(env: Env, userId: string): Promise<boolean> {
  const u = await env.DB.prepare('SELECT created_at FROM users WHERE id = ? LIMIT 1')
    .bind(userId)
    .first<{ created_at: number }>();
  const created = u && Number(u.created_at);
  if (!(typeof created === 'number' && created >= 0 && created < FOUNDER_CUTOFF_MS)) return false;

  const acc = await env.DB.prepare(
    'SELECT 1 AS x FROM user_accolades WHERE user_id = ? AND accolade_type = ? LIMIT 1',
  )
    .bind(userId, STEP_100K_ACCOLADE)
    .first();
  if (acc) return true;

  const wins = await env.DB.prepare('SELECT COUNT(*) AS n FROM coop_boss_awards WHERE user_id = ?')
    .bind(userId)
    .first<{ n: number }>();
  return !!(wins && Number(wins.n) >= FOUNDER_COOP_WIN_THRESHOLD);
}

/** Grant + publish the Founder mark for an eligible user, atomically capped.
 *  Returns the Founder number if the user now holds one (new OR pre-existing),
 *  else null. Cheap fast-path once granted (1 query). Safe to call redundantly.
 *  Never throws — a marker failure must not break its caller. */
export async function maybeGrantFounderMark(env: Env, userId: string): Promise<number | null> {
  try {
    // Fast path: already a Founder? (the common case after the first grant)
    let seq: number | null = null;
    const existing = await env.DB.prepare('SELECT seq FROM founder_marks WHERE user_id = ? LIMIT 1')
      .bind(userId)
      .first<{ seq: number }>();
    if (existing) {
      seq = Number(existing.seq);
    } else if (await isFounderMarkEligible(env, userId)) {
      // Atomic guarded insert: ONE statement so the count-check and the insert
      // cannot interleave. seq = current count + 1. UNIQUE(seq) is the belt.
      await env.DB.prepare(
        `INSERT INTO founder_marks (user_id, seq)
         SELECT ?1, (SELECT COUNT(*) FROM founder_marks) + 1
          WHERE (SELECT COUNT(*) FROM founder_marks) < ${FOUNDER_MARK_CAP}
            AND NOT EXISTS (SELECT 1 FROM founder_marks WHERE user_id = ?1)`,
      )
        .bind(userId)
        .run();
      const row = await env.DB.prepare('SELECT seq FROM founder_marks WHERE user_id = ? LIMIT 1')
        .bind(userId)
        .first<{ seq: number }>();
      seq = row ? Number(row.seq) : null;
    }

    // Publish onto the public profile so leaderboard + profile-card reads carry
    // it cross-user (no per-read JOIN). Guarded so it writes only when the row
    // exists and the value changed (a no-op on the steady state). If the user
    // has no profile row yet, it lands on their next rank-summary PUT.
    if (seq != null) {
      await env.DB.prepare(
        'UPDATE public_profile_summary SET founder_seq = ? WHERE user_id = ? AND (founder_seq IS NULL OR founder_seq <> ?)',
      )
        .bind(seq, userId, seq)
        .run();
    }
    return seq;
  } catch (e) {
    console.error('[founder-mark] grant failed', JSON.stringify({ user: userId.slice(0, 8), error: e instanceof Error ? e.message : String(e) }));
    return null;
  }
}

/** Read a user's Founder number (or null). */
export async function getFounderSeq(env: Env, userId: string): Promise<number | null> {
  const row = await env.DB.prepare('SELECT seq FROM founder_marks WHERE user_id = ? LIMIT 1')
    .bind(userId)
    .first<{ seq: number }>();
  return row ? Number(row.seq) : null;
}
