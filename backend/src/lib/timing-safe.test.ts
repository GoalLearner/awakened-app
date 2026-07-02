import { describe, expect, it } from 'vitest';
import { timingSafeEqual } from './timing-safe';

describe('timingSafeEqual (W585)', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeEqual('Bearer abc123', 'Bearer abc123')).toBe(true);
    expect(timingSafeEqual('', '')).toBe(true);
  });

  it('returns false for differing strings of equal length', () => {
    expect(timingSafeEqual('Bearer abc123', 'Bearer abc124')).toBe(false);
    expect(timingSafeEqual('aaaa', 'aaab')).toBe(false);
  });

  it('returns false for differing lengths (no early exit)', () => {
    expect(timingSafeEqual('short', 'shorter')).toBe(false);
    expect(timingSafeEqual('secret', '')).toBe(false);
    expect(timingSafeEqual('', 'secret')).toBe(false);
  });

  it('handles multibyte UTF-8 secrets correctly', () => {
    expect(timingSafeEqual('sé🔐cret', 'sé🔐cret')).toBe(true);
    expect(timingSafeEqual('sé🔐cret', 'se🔐cret')).toBe(false);
  });
});
