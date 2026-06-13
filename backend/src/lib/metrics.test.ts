/**
 * metrics.test.ts — registry sanity, focused on W274's floor_best.
 */
import { describe, expect, it } from 'vitest';
import { METRICS, METRIC_CAPS, isValidMetric, isWeeklyMetric, WEEKLY_METRICS } from './metrics';

describe('metric registry', () => {
  it('every metric has a cap', () => {
    for (const m of METRICS) expect(typeof METRIC_CAPS[m]).toBe('number');
  });

  it('W274 — floor_best is registered, capped at 100, and NOT weekly', () => {
    expect(isValidMetric('floor_best')).toBe(true);
    expect(METRIC_CAPS.floor_best).toBe(100);
    expect(isWeeklyMetric('floor_best')).toBe(false);
    expect(WEEKLY_METRICS.has('floor_best')).toBe(false);
  });

  it('rejects unknown metrics', () => {
    expect(isValidMetric('floor')).toBe(false);
    expect(isValidMetric(42)).toBe(false);
  });
});
