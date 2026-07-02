/**
 * timing-safe.ts — constant-time string comparison for shared secrets.
 *
 * W585 (security audit hardening). The RevenueCat webhook and the admin-metrics
 * route authenticate by comparing a caller-supplied header to a server secret.
 * A plain `a !== b` short-circuits on the first differing byte, which in theory
 * leaks the secret one byte at a time via response-timing. It isn't practically
 * exploitable here (network jitter swamps the signal, and both secrets guard
 * only cosmetic skins / read-only analytics) — but a constant-time compare
 * removes the side channel entirely, at zero cost.
 *
 * Implementation notes:
 *  - Iterates over max(|a|,|b|) so the loop count doesn't early-exit on a length
 *    mismatch; the length difference is folded into the accumulator.
 *  - Works on the raw byte encodings (TextEncoder), so it's correct for any
 *    UTF-8 secret, and does not depend on Node's crypto being present.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  const len = Math.max(ab.length, bb.length, 1);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}
