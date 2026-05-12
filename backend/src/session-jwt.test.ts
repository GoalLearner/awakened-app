/**
 * session-jwt.test.ts — Round-trip + rejection-path tests for the
 * backend session JWT module.
 */
import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { issueSessionJwt, verifySessionJwt } from './session-jwt';
import type { Env } from './env';

const noopRl = { limit: async () => ({ success: true }) };

const baseEnv: Env = {
  DB: {} as unknown as D1Database,
  JWT_SIGNING_KEY: 'test-signing-key-32-bytes-or-more-for-hs256',
  APPLE_BUNDLE_ID: 'com.goallearner.awakened',
  APPLE_TEAM_ID: 'LK8FVGBQPL',
  RL_AUTH_VERIFY: noopRl,
  RL_LEADERBOARD_SUBMIT: noopRl,
  RL_LEADERBOARD_TOP: noopRl,
  RL_ACCOUNT_DELETE: noopRl,
};

describe('issueSessionJwt + verifySessionJwt', () => {
  it('round-trips: issued JWT verifies to the same userId + alias', async () => {
    const jwt = await issueSessionJwt('user-uuid-123', 'TopDog', baseEnv);
    const decoded = await verifySessionJwt(jwt, baseEnv);
    expect(decoded.userId).toBe('user-uuid-123');
    expect(decoded.alias).toBe('TopDog');
  });

  it('rejects a JWT signed with a different key', async () => {
    const jwt = await issueSessionJwt('user-uuid-123', 'TopDog', baseEnv);
    const wrongEnv: Env = { ...baseEnv, JWT_SIGNING_KEY: 'a-different-signing-key-entirely-32b' };
    await expect(verifySessionJwt(jwt, wrongEnv)).rejects.toThrow();
  });

  it('rejects a JWT with wrong issuer', async () => {
    const key = new TextEncoder().encode(baseEnv.JWT_SIGNING_KEY);
    const malicious = await new SignJWT({ alias: 'TopDog' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-uuid-123')
      .setIssuer('not-our-issuer')
      .setAudience('awakened-app')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key);
    await expect(verifySessionJwt(malicious, baseEnv)).rejects.toThrow();
  });

  it('rejects a JWT with wrong audience', async () => {
    const key = new TextEncoder().encode(baseEnv.JWT_SIGNING_KEY);
    const malicious = await new SignJWT({ alias: 'TopDog' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-uuid-123')
      .setIssuer('awakened-backend')
      .setAudience('some-other-app')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key);
    await expect(verifySessionJwt(malicious, baseEnv)).rejects.toThrow();
  });

  it('rejects an expired JWT', async () => {
    const key = new TextEncoder().encode(baseEnv.JWT_SIGNING_KEY);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expired = await new SignJWT({ alias: 'TopDog' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-uuid-123')
      .setIssuer('awakened-backend')
      .setAudience('awakened-app')
      .setIssuedAt(nowSeconds - 7200)
      .setExpirationTime(nowSeconds - 3600) // 1h ago
      .sign(key);
    await expect(verifySessionJwt(expired, baseEnv)).rejects.toThrow();
  });

  it('rejects LOCALHOST_DEV_STUB pattern (sub=localhost-dev-user, alias=DevUser)', async () => {
    // Even if someone forges a properly-signed JWT with the dev-stub
    // identity (which would require leaking JWT_SIGNING_KEY), the
    // explicit pattern check rejects it.
    const key = new TextEncoder().encode(baseEnv.JWT_SIGNING_KEY);
    const forgedDevStub = await new SignJWT({ alias: 'DevUser' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('localhost-dev-user')
      .setIssuer('awakened-backend')
      .setAudience('awakened-app')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key);
    await expect(verifySessionJwt(forgedDevStub, baseEnv)).rejects.toThrow(
      /LOCALHOST_DEV_STUB/,
    );
  });

  it('rejects a JWT missing the alias claim', async () => {
    const key = new TextEncoder().encode(baseEnv.JWT_SIGNING_KEY);
    const noAlias = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-uuid-123')
      .setIssuer('awakened-backend')
      .setAudience('awakened-app')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key);
    await expect(verifySessionJwt(noAlias, baseEnv)).rejects.toThrow(
      /SESSION_JWT_MISSING_ALIAS/,
    );
  });
});

describe('issueSessionJwt input validation', () => {
  it('rejects empty userId', async () => {
    await expect(issueSessionJwt('', 'TopDog', baseEnv)).rejects.toThrow(
      /USER_ID_REQUIRED/,
    );
  });

  it('rejects empty alias', async () => {
    await expect(issueSessionJwt('user-uuid-123', '', baseEnv)).rejects.toThrow(
      /ALIAS_REQUIRED/,
    );
  });

  it('rejects missing signing key', async () => {
    const env: Env = { ...baseEnv, JWT_SIGNING_KEY: '' };
    await expect(issueSessionJwt('user-uuid-123', 'TopDog', env)).rejects.toThrow(
      /JWT_SIGNING_KEY_MISSING_OR_EMPTY/,
    );
  });
});
