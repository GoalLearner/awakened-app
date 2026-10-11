import { describe, it, expect } from 'vitest';
import { chunks, D1_SAFE_PARAMS } from './chunk';

describe('chunks (W1040)', () => {
  it('splits a long id list into slices D1 will accept, losing and repeating nothing', () => {
    const ids = Array.from({ length: 369 }, (_, i) => 'h' + i);
    const out = chunks(ids);
    expect(out.every((s) => s.length <= D1_SAFE_PARAMS && s.length > 0)).toBe(true);
    expect(D1_SAFE_PARAMS).toBeLessThan(100);
    expect(out.flat()).toEqual(ids);
    expect(out.length).toBe(Math.ceil(369 / D1_SAFE_PARAMS));
  });
  it('an empty list is no queries at all; a short one is a single slice', () => {
    expect(chunks([])).toEqual([]);
    expect(chunks([1, 2, 3])).toEqual([[1, 2, 3]]);
  });
});
