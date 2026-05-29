/**
 * cors.test.ts — Worker CORS helper coverage (v3 Phase 1z.192).
 *
 * The 1z.190 friend-rank backend introduced the first PUT route
 * on the Worker. The 1z.192 fix ensures Capacitor's WebView
 * preflight check accepts PUT (it previously failed before
 * reaching the Worker, surfacing as the NETWORK code observed
 * in w65 device debug). These tests lock in the methods +
 * headers contract so it can't silently regress.
 */
import { describe, expect, it } from 'vitest';
import { handlePreflight, withCors } from './cors';

describe('CORS preflight (1z.192)', () => {
  it('returns 204 with permissive Origin and the full method allowlist', () => {
    const res = handlePreflight();
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe(
      'GET, POST, PUT, OPTIONS',
    );
  });

  it('advertises Authorization + Content-Type as allowed request headers', () => {
    const res = handlePreflight();
    const headers = res.headers.get('Access-Control-Allow-Headers') || '';
    expect(headers).toContain('Authorization');
    expect(headers).toContain('Content-Type');
  });

  it('includes PUT so the 1z.190 public-profile-summary endpoint is reachable', () => {
    const res = handlePreflight();
    const methods = res.headers.get('Access-Control-Allow-Methods') || '';
    expect(methods).toContain('PUT');
  });

  it('caches the preflight for a day so we are not hammered with OPTIONS', () => {
    const res = handlePreflight();
    expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
  });
});

describe('withCors wrapper (1z.192)', () => {
  it('preserves the original status code', () => {
    const inner = new Response('boom', { status: 500 });
    const wrapped = withCors(inner);
    expect(wrapped.status).toBe(500);
  });

  it('preserves the original body for non-error responses', async () => {
    const inner = Response.json({ ok: true });
    const wrapped = withCors(inner);
    const body = await wrapped.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('adds the full CORS header set to success responses', () => {
    const inner = Response.json({ ok: true });
    const wrapped = withCors(inner);
    expect(wrapped.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(wrapped.headers.get('Access-Control-Allow-Methods')).toContain('PUT');
    expect(wrapped.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
  });

  it('adds the full CORS header set to error responses', () => {
    const inner = Response.json({ error: 'INVALID_TIER' }, { status: 400 });
    const wrapped = withCors(inner);
    expect(wrapped.status).toBe(400);
    expect(wrapped.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(wrapped.headers.get('Access-Control-Allow-Methods')).toContain('PUT');
  });
});
