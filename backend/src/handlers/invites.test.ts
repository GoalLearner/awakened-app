/**
 * invites.test.ts — W842 (Train 4, G1) universal-link invite loop. Substring-
 * routed D1 mock in the house style; notifyUser spied via the apns mock.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../lib/apns', () => ({ notifyUser: vi.fn(async () => {}) }));
import { notifyUser } from '../lib/apns';
import {
  handleAasaGet,
  handleInviteLinkFallback,
  handleInviteCodeGet,
  handleInviteRedeem,
  handleInviteRewardsClaim,
  INVITE_SOULS,
} from './invites';
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';

const mockNotify = vi.mocked(notifyUser);

interface MockOpts {
  myCode?: string | null;              // invite_codes row for the caller
  inviter?: { id: string; alias: string } | null; // code lookup result
  myCreatedAt?: number;                // users.created_at for the redeemer
  alreadyRedeemed?: boolean;           // redemption PK collision
  pairExists?: boolean;                // live friends pair in either direction
  pendingRecruits?: { id: string; alias: string }[];
  claimChanges?: number;
}

function makeEnv(o: MockOpts) {
  const calls: { sql: string; binds: unknown[] }[] = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => {
        calls.push({ sql, binds: args });
        return {
          first: async () => {
            if (/FROM invite_codes ic/.test(sql)) return o.inviter ?? null;
            if (/SELECT code FROM invite_codes/.test(sql)) return o.myCode ? { code: o.myCode } : null;
            if (/SELECT created_at FROM users/.test(sql)) {
              return { created_at: o.myCreatedAt ?? Date.now() - 86400000 };
            }
            if (/FROM friends/.test(sql)) return o.pairExists ? { 1: 1 } : null;
            return null;
          },
          run: async () => {
            if (/INSERT OR IGNORE INTO invite_codes/.test(sql)) return { success: true, meta: { changes: 1 } };
            if (/INSERT OR IGNORE INTO invite_redemptions/.test(sql)) {
              return { success: true, meta: { changes: o.alreadyRedeemed ? 0 : 1 } };
            }
            if (/UPDATE invite_redemptions SET inviter_claimed = 1/.test(sql)) {
              return { success: true, meta: { changes: o.claimChanges ?? 0 } };
            }
            return { success: true, meta: { changes: 1 } };
          },
          all: async () => {
            if (/inviter_claimed = 0/.test(sql)) {
              return { results: o.pendingRecruits ?? [], success: true, meta: {} };
            }
            return { results: [], success: true, meta: {} };
          },
        };
      },
    }),
  } as unknown as D1Database;
  const env = {
    DB: db,
    RL_FRIENDS_READ: { limit: async () => ({ success: true }) },
    RL_FRIENDS_WRITE: { limit: async () => ({ success: true }) },
  } as unknown as Env;
  return { env, calls };
}

const session: SessionPayload = { userId: 'u-me', alias: 'Richie' } as SessionPayload;
const ctx = { waitUntil: (_p: Promise<unknown>) => {} } as unknown as ExecutionContext;

function redeemReq(code: unknown): Request {
  return new Request('https://x/v1/invites/redeem', { method: 'POST', body: JSON.stringify({ code }) });
}

beforeEach(() => mockNotify.mockClear());

describe('AASA + fallback (W842)', () => {
  it('serves valid applinks JSON with the Team-ID appID and /i/* scope', async () => {
    const res = handleAasaGet();
    expect(res.headers.get('content-type')).toBe('application/json');
    const j = (await res.json()) as { applinks: { details: { appID: string; paths: string[] }[] } };
    expect(j.applinks.details[0].appID).toBe('LK8FVGBQPL.com.goallearner.awakened');
    expect(j.applinks.details[0].paths).toContain('/i/*');
  });

  it('the /i/ browser fallback 302s to the App Store', () => {
    const res = handleInviteLinkFallback();
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('apps.apple.com');
  });
});

describe('GET /v1/users/me/invite-code', () => {
  it('returns the existing code with its share URL', async () => {
    const { env } = makeEnv({ myCode: 'k7m2npqr' });
    const res = await handleInviteCodeGet(new Request('https://x'), env, session);
    const j = (await res.json()) as { code: string; url: string };
    expect(j.code).toBe('k7m2npqr');
    expect(j.url).toMatch(/\/i\/k7m2npqr$/);
  });

  it('mints a fresh code (unambiguous alphabet) when none exists', async () => {
    const { env } = makeEnv({ myCode: null });
    const res = await handleInviteCodeGet(new Request('https://x'), env, session);
    const j = (await res.json()) as { code: string };
    expect(j.code).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{8}$/);
  });
});

describe('POST /v1/invites/redeem', () => {
  const INVITER = { id: 'u-inviter', alias: 'James' };

  it('happy path: records, opens the pending friendship, pushes the inviter, pays the redeemer', async () => {
    const { env, calls } = makeEnv({ inviter: INVITER });
    const res = await handleInviteRedeem(redeemReq('k7m2npqr'), env, session, ctx);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { reward_souls: number; inviter_alias: string; friendship_created: boolean };
    expect(j.reward_souls).toBe(INVITE_SOULS);
    expect(j.inviter_alias).toBe('James');
    expect(j.friendship_created).toBe(true);
    expect(calls.some((c) => /INSERT INTO friends/.test(c.sql) && c.binds[1] === 'u-me' && c.binds[2] === 'u-inviter')).toBe(true);
    expect(mockNotify).toHaveBeenCalledTimes(1);
    const push = mockNotify.mock.calls[0];
    expect(push[1]).toBe('u-inviter');
    expect((push[2] as { type: string }).type).toBe('invite_redeemed');
    expect((push[2] as { body: string }).body).toContain('Richie');
  });

  it('a second redemption (any code) is refused — once per redeemer, ever', async () => {
    const { env } = makeEnv({ inviter: INVITER, alreadyRedeemed: true });
    const res = await handleInviteRedeem(redeemReq('k7m2npqr'), env, session, ctx);
    expect(res.status).toBe(409);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('self-redeem is blocked', async () => {
    const { env } = makeEnv({ inviter: { id: 'u-me', alias: 'Richie' } });
    const res = await handleInviteRedeem(redeemReq('k7m2npqr'), env, session, ctx);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('SELF_INVITE');
  });

  it('established accounts (past the 14d window) are refused — anti-farm', async () => {
    const { env } = makeEnv({ inviter: INVITER, myCreatedAt: Date.now() - 60 * 86400000 });
    const res = await handleInviteRedeem(redeemReq('k7m2npqr'), env, session, ctx);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('TOO_ESTABLISHED');
  });

  it('an existing live pair skips the friendship but still rewards', async () => {
    const { env, calls } = makeEnv({ inviter: INVITER, pairExists: true });
    const res = await handleInviteRedeem(redeemReq('k7m2npqr'), env, session, ctx);
    const j = (await res.json()) as { friendship_created: boolean; reward_souls: number };
    expect(j.friendship_created).toBe(false);
    expect(j.reward_souls).toBe(INVITE_SOULS);
    expect(calls.some((c) => /INSERT INTO friends/.test(c.sql))).toBe(false);
  });

  it('garbage codes are rejected before any lookup', async () => {
    const { env, calls } = makeEnv({ inviter: INVITER });
    const res = await handleInviteRedeem(redeemReq('NOT A CODE!!'), env, session, ctx);
    expect(res.status).toBe(400);
    expect(calls.length).toBe(0);
  });
});

describe('POST /v1/users/me/invite-rewards/claim', () => {
  it('pays exactly the guarded-flip count and names the recruits', async () => {
    const { env } = makeEnv({
      pendingRecruits: [{ id: 'u-a', alias: 'Tyler' }, { id: 'u-b', alias: 'Andrew' }],
      claimChanges: 2,
    });
    const res = await handleInviteRewardsClaim(new Request('https://x'), env, session);
    const j = (await res.json()) as { claimed: number; souls: number; recruits: string[] };
    expect(j.claimed).toBe(2);
    expect(j.souls).toBe(2 * INVITE_SOULS);
    expect(j.recruits).toEqual(['Tyler', 'Andrew']);
  });

  it('nothing pending → clean zero', async () => {
    const { env } = makeEnv({ pendingRecruits: [] });
    const res = await handleInviteRewardsClaim(new Request('https://x'), env, session);
    const j = (await res.json()) as { claimed: number; souls: number };
    expect(j.claimed).toBe(0);
    expect(j.souls).toBe(0);
  });
});
