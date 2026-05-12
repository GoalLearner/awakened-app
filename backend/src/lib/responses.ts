/**
 * responses.ts — JSON response builders.
 *
 * Standardized success + error shapes so client-side error handling
 * has a single switch on { error: code }. BACKEND.md §8 lists the
 * canonical error codes per endpoint.
 */

export function jsonOk<T extends Record<string, unknown>>(data: T, status = 200): Response {
  return Response.json(data, { status });
}

/**
 * Error response shape: { error: "MACHINE_CODE", detail: "Human string", ...extra }
 *
 *   - error:  uppercase snake_case code; client switches on this
 *   - detail: human-readable string; safe to surface to user
 *   - extra:  arbitrary additional fields (e.g. { suggested: [...] }
 *             for ALIAS_TAKEN responses)
 */
export function jsonError(
  status: number,
  code: string,
  detail: string,
  extra?: Record<string, unknown>,
): Response {
  const body: Record<string, unknown> = { error: code, detail };
  if (extra) {
    for (const [k, v] of Object.entries(extra)) body[k] = v;
  }
  return Response.json(body, { status });
}
