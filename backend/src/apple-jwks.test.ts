/**
 * apple-jwks.test.ts — Unit tests for Apple identity token verifier.
 *
 * Scope: rejection-path tests for malformed tokens. End-to-end
 * verification against a real Apple-signed token requires Apple's
 * live JWKS + an active user session, which we only validate in
 * staging during Phase B (2/2)'s smoke tests.
 */
import { describe, expect, it } from 'vitest';
import { verifyAppleIdentityToken } from './apple-jwks';
import type { Env } from './env';

const noopRl = { limit: async () => ({ success: true }) };

// Only DB + APPLE_BUNDLE_ID are exercised here; cast past the (growing) Env
// binding list rather than stub 30+ rate-limiters the rejection paths never touch.
const mockEnv = {
  DB: {} as unknown as D1Database,
  JWT_SIGNING_KEY: 'test-key-not-used-here',
  APPLE_BUNDLE_ID: 'com.goallearner.awakened',
  APPLE_TEAM_ID: 'LK8FVGBQPL',
  RL_AUTH_VERIFY: noopRl,
  RL_LEADERBOARD_SUBMIT: noopRl,
  RL_LEADERBOARD_TOP: noopRl,
  RL_ACCOUNT_DELETE: noopRl,
} as unknown as Env;

describe('verifyAppleIdentityToken', () => {
  it('rejects an empty token', async () => {
    await expect(verifyAppleIdentityToken('', mockEnv)).rejects.toThrow();
  });

  it('rejects a token with only one segment', async () => {
    await expect(verifyAppleIdentityToken('not-a-jwt', mockEnv)).rejects.toThrow(
      /MALFORMED_TOKEN/,
    );
  });

  it('rejects a token with two segments (missing signature)', async () => {
    await expect(verifyAppleIdentityToken('aaa.bbb', mockEnv)).rejects.toThrow(
      /MALFORMED_TOKEN/,
    );
  });

  it('rejects a token whose header is not valid JSON', async () => {
    // 4 segments and Base64-ish but the header decodes to non-JSON
    const garbageHeader = btoa('not json {').replace(/=/g, '');
    await expect(
      verifyAppleIdentityToken(`${garbageHeader}.aaa.bbb`, mockEnv),
    ).rejects.toThrow(/MALFORMED_TOKEN_HEADER/);
  });

  it('rejects a token whose header has no kid claim', async () => {
    const header = btoa(JSON.stringify({ alg: 'RS256' })).replace(/=/g, '');
    await expect(
      verifyAppleIdentityToken(`${header}.aaa.bbb`, mockEnv),
    ).rejects.toThrow(/INVALID_TOKEN_HEADER/);
  });

  it('rejects a token whose alg is not RS256', async () => {
    const header = btoa(JSON.stringify({ alg: 'HS256', kid: 'fake-kid' })).replace(/=/g, '');
    await expect(
      verifyAppleIdentityToken(`${header}.aaa.bbb`, mockEnv),
    ).rejects.toThrow(/UNSUPPORTED_TOKEN_ALG/);
  });
});
