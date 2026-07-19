/**
 * insights-weekly.test.ts — handler-shape tests for the members-only
 * weekly-step percentile endpoint (W723). A stub D1 routes by SQL substring
 * so we can verify the gate, the null-when-unranked path, and the percentile
 * math without real D1. Real distribution behavior is covered end-to-end once
 * it lands in remote D1.
 */
import { describe, expect, it } from 'vitest';
import { handleInsightsWeekly } from './insights-weekly';
import type { Env } from '../env';

const okRl = { limit: async () => ({ success: true }) };
const blockRl = { limit: async () => ({ success: false }) };

function makeDb(opts: {
  member?: boolean;
  myValue?: number | null;
  rankTier?: string | null;
  global?: { total: number; below: number };
  cohort?: { total: number; below: number };
} = {}) {
  const member = opts.member ?? true;
  const myValue = opts.myValue === undefined ? 100000 : opts.myValue;
  const rankTier = opts.rankTier === undefined ? 'B' : opts.rankTier;
  const global = opts.global ?? { total: 100, below: 92 };
  const cohort = opts.cohort ?? { total: 40, below: 30 };
  return {
    prepare: (sql: string) => ({
      bind: () => ({
        all: async () => ({ results: [], success: true, meta: {} }),
        first: async () => {
          if (sql.includes('skin_entitlements')) return null;
          if (sql.includes('premium_subscriptions')) return member ? { expires_at_ms: Date.now() + 1e9 } : null;
          if (sql.includes('founder_marks')) return null;
          if (sql.includes('public_profile_summary pps')) return cohort;       // cohort COUNT
          if (sql.includes('COUNT(*)') && sql.includes('leaderboard_snapshots')) return global; // global COUNT
          if (sql.includes('SELECT rank_tier FROM public_profile_summary')) return rankTier === null ? null : { rank_tier: rankTier };
          if (sql.includes('SELECT current_value FROM leaderboard_snapshots')) return myValue === null ? null : { current_value: myValue };
          return null;
        },
        run: async () => ({ success: true, meta: { changes: 0 } }),
      }),
    }),
  } as unknown as D1Database;
}

function makeEnv(db: D1Database, rl: typeof okRl = okRl): Env {
  return { DB: db, RL_INSIGHTS_READ: rl } as unknown as Env;
}

const session = { userId: 'u1' } as never;
const req = new Request('https://x/v1/insights/weekly');

describe('handleInsightsWeekly', () => {
  it('429s when rate-limited', async () => {
    const res = await handleInsightsWeekly(req, makeEnv(makeDb(), blockRl), session);
    expect(res.status).toBe(429);
  });

  it('403s for non-members', async () => {
    const res = await handleInsightsWeekly(req, makeEnv(makeDb({ member: false })), session);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect((body as { error: string }).error).toBe('MEMBERS_ONLY');
  });

  it('returns me:null when the member has no step row this week', async () => {
    const res = await handleInsightsWeekly(req, makeEnv(makeDb({ myValue: null })), session);
    expect(res.status).toBe(200);
    const body = await res.json() as { me: unknown; week: string };
    expect(body.me).toBeNull();
    expect(typeof body.week).toBe('string');
  });

  it('computes global topPct + cohort beatPct from the counts', async () => {
    // global: below 92 of (total-1)=99 → beat 93% → top 7%
    // cohort: below 30 of (total-1)=39 → beat 77%
    const res = await handleInsightsWeekly(req, makeEnv(makeDb()), session);
    const body = await res.json() as {
      me: { weekTotal: number; rankTier: string;
            global: { topPct: number; beatPct: number; size: number; lowConfidence: boolean };
            cohort: { beatPct: number; size: number; lowConfidence: boolean } };
    };
    expect(body.me.weekTotal).toBe(100000);
    expect(body.me.rankTier).toBe('B');
    expect(body.me.global.beatPct).toBe(93);
    expect(body.me.global.topPct).toBe(7);
    expect(body.me.global.size).toBe(100);
    expect(body.me.global.lowConfidence).toBe(false);
    expect(body.me.cohort.beatPct).toBe(77);
    expect(body.me.cohort.size).toBe(40);
  });

  it('flags lowConfidence on a sparse pool', async () => {
    const res = await handleInsightsWeekly(
      req,
      makeEnv(makeDb({ global: { total: 12, below: 10 }, cohort: { total: 4, below: 3 } })),
      session,
    );
    const body = await res.json() as {
      me: { global: { lowConfidence: boolean }; cohort: { lowConfidence: boolean } };
    };
    expect(body.me.global.lowConfidence).toBe(true);
    expect(body.me.cohort.lowConfidence).toBe(true);
  });

  it('returns cohort:null when the caller has no rank tier', async () => {
    const res = await handleInsightsWeekly(req, makeEnv(makeDb({ rankTier: null })), session);
    const body = await res.json() as { me: { cohort: unknown } };
    expect(body.me.cohort).toBeNull();
  });
});
