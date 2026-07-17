/**
 * founder-mark.ts — the earned "Founder" tier.
 *
 * W656 shipped this as a free prestige marker (capped 100, granted to early users).
 * W698 (owner) repurposed it: the Founder requirement is now simply 50 boss kills,
 * the FIRST 20 hunters to reach it are granted a Founder mark, and — the new part —
 * a Founder mark now confers LIFETIME MEMBERSHIP (see iap-entitlements: member =
 * premium OR founder). Once 20 marks exist the promo is closed; hunter #21+ reaching
 * 50 kills gets nothing (membership is subscription-only thereafter). The 3 legacy
 * W656 grandfather marks are kept — they hold the first slots and become the OG
 * lifetime members, leaving 17 for the 50-kill promo.
 *
 * Server-authoritative + atomically capped so a modded client cannot mint slot #21+.
 * The kill total itself is client-reported (public_profile_summary.bosses_slain_total,
 * same client-authoritative trust model as rank); the cap of 20 bounds any abuse and
 * the reward is free, so there is no revenue exposure.
 */
import type { Env } from '../env';

// W698 — the promo is capped at 20 lifetime Founders (was 100 for the W656 prestige badge).
export const FOUNDER_MARK_CAP = 20;
// W698 — the Founder requirement: 50 boss kills (solo + co-op), read from the
// client-reported public-profile total.
export const FOUNDER_KILL_THRESHOLD = 50;

/** W698 — eligible = the caller's reported cumulative boss-kill total is >= 50.
 *  Sims/unknowns have no public_profile_summary row → total treated as 0 → ineligible. */
export async function isFounderMarkEligible(env: Env, userId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT bosses_slain_total FROM public_profile_summary WHERE user_id = ? LIMIT 1',
  )
    .bind(userId)
    .first<{ bosses_slain_total: number | null }>();
  return !!(row && Number(row.bosses_slain_total ?? 0) >= FOUNDER_KILL_THRESHOLD);
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
