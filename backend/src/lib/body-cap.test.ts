import { describe, it, expect } from 'vitest';
import { capRequestBody, bodyCapFor, DEFAULT_BODY_CAP_BYTES, USER_STATE_BODY_CAP_BYTES } from './body-cap';

const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request('https://x.test/v1/thing', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });

/** A body that arrives in pieces with no Content-Length, as a chunked upload does. */
function streamed(pieces: number, size: number): Request {
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) { if (sent++ >= pieces) { c.close(); return; } c.enqueue(new Uint8Array(size).fill(97)); },
  });
  return new Request('https://x.test/v1/thing', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
}

describe('capRequestBody (W1040)', () => {
  it('passes a small body through, still readable as JSON, with its headers and method', async () => {
    const out = await capRequestBody(post(JSON.stringify({ a: 1 }), { Authorization: 'Bearer t' }), 1024);
    expect(out).not.toBeNull();
    expect(out!.method).toBe('POST');
    expect(out!.headers.get('Authorization')).toBe('Bearer t');
    expect(await out!.json()).toEqual({ a: 1 });
  });

  it('leaves GET and bodiless requests alone', async () => {
    const get = new Request('https://x.test/v1/thing');
    expect(await capRequestBody(get, 10)).toBe(get);
    const empty = new Request('https://x.test/v1/thing', { method: 'POST' });
    expect(await capRequestBody(empty, 10)).toBe(empty);
  });

  it('refuses a body over the ceiling by its Content-Length', async () => {
    expect(await capRequestBody(post('x'.repeat(2000)), 1000)).toBeNull();
    expect(await capRequestBody(post('x'.repeat(1000)), 1000)).not.toBeNull();   // exactly at the ceiling is fine
  });

  it('refuses an oversized body that declares no length (or a false one)', async () => {
    expect(await capRequestBody(streamed(10, 500), 1000)).toBeNull();            // 5,000 bytes, no header
    const ok = await capRequestBody(streamed(2, 400), 1000);
    expect(ok).not.toBeNull();
    expect((await ok!.text()).length).toBe(800);
    const liar = new Request('https://x.test/v1/thing', { method: 'POST', body: 'y'.repeat(3000) });
    liar.headers.set('Content-Length', '10');
    expect(await capRequestBody(liar, 1000)).toBeNull();
  });

  it('gives the cloud save its own, larger ceiling and everything else the default', () => {
    expect(bodyCapFor('/v1/users/me/state')).toBe(USER_STATE_BODY_CAP_BYTES);
    expect(bodyCapFor('/v1/verified-events')).toBe(DEFAULT_BODY_CAP_BYTES);
    expect(USER_STATE_BODY_CAP_BYTES).toBeGreaterThan(512 * 1024);
  });
});
