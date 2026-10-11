/**
 * body-cap.ts — W1040 SECURITY. No handler reads a request body past its route's ceiling.
 *
 * Before this, only POST /v1/users/me/state measured its body; every other JSON route
 * called request.json() on whatever arrived. A signed-in account could post megabytes
 * of text into a table with no length checks and fill the database (the 2026-10-11
 * review's one high finding: POST /v1/verified-events, metadata_json).
 *
 * The body is read ONCE here, counted as it streams, and abandoned the moment it passes
 * the ceiling (a Content-Length header is only a hint: it can be absent or false). What
 * was read is handed on as a fresh Request, so handlers keep calling request.json().
 */

/** Everything but the cloud save is a few kilobytes at most. */
export const DEFAULT_BODY_CAP_BYTES = 128 * 1024;
/** The cloud save's own limit is 512 KB of state; the envelope around it needs headroom. */
export const USER_STATE_BODY_CAP_BYTES = 640 * 1024;

/**
 * How much of an over-ceiling body is read and discarded before the stream is let go: more
 * than Cloudflare accepts in one request on this plan (100 MB), so in practice all of it.
 * Discarding costs no memory. With a lower limit (8 MB was tried) a body that ended just
 * past it left the same broken connection behind.
 */
export const DRAIN_LIMIT_BYTES = 128 * 1024 * 1024;

export function bodyCapFor(path: string): number {
  return path === '/v1/users/me/state' ? USER_STATE_BODY_CAP_BYTES : DEFAULT_BODY_CAP_BYTES;
}

/**
 * Returns a Request whose body is known to be within `max` bytes (the same Request when
 * there is no body to read), or null when the body is larger than `max`.
 */
export async function capRequestBody(request: Request, max: number): Promise<Request | null> {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS' || !request.body) return request;
  const advertised = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(advertised) && advertised > max) return null;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > max) {
      // Over the ceiling: nothing more is KEPT, but the rest is still read and thrown away
      // (up to DRAIN_LIMIT_BYTES) so the connection is left clean. Measured in `wrangler dev`
      // 2026-10-11: a body abandoned partway (reader.cancel() or releaseLock()) made the NEXT
      // request on the local proxy fail with a 503; a body read to its end never did. Past
      // the drain limit the stream is simply let go, and the runtime closes the connection.
      try {
        while (total <= DRAIN_LIMIT_BYTES) {
          const next = await reader.read();
          if (next.done) break;
          total += next.value ? next.value.byteLength : 0;
        }
      } catch { /* a broken upload is the sender's problem */ }
      try { reader.releaseLock(); } catch { /* nothing more to do with it */ }
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { buf.set(c, at); at += c.byteLength; }
  return new Request(request.url, { method: request.method, headers: request.headers, body: buf });
}
