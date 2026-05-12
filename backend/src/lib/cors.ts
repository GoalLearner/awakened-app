/**
 * cors.ts — CORS headers + preflight handler.
 *
 * Capacitor's iOS WebView uses the `capacitor://localhost` scheme as
 * the origin for fetch() requests from app.js / auth.js. The Origin
 * header sent to the backend looks like:
 *   Origin: capacitor://localhost
 *
 * Allow-Origin: * is the simplest correct response for an iOS-only
 * native app. The backend serves no browser-fronted UI; CORS exists
 * purely to satisfy fetch()'s preflight requirement.
 *
 * Phase 2.2+ may tighten this to explicit origins if Awakened ever
 * gets a web-side admin panel or marketing-site sign-in flow.
 */

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

/** Handles a CORS preflight (OPTIONS) request. Returns 204 No Content. */
export function handlePreflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Wraps an existing Response with CORS headers (additive — preserves
 * the original body, status, and any existing headers). */
export function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    headers.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
