/**
 * scheduled-dispatch.test.ts — W904: the one line that fixes the Monday push.
 *
 * For seven weeks scheduled() ran the update job ONLY when event.cron equalled
 * the every-5-minutes trigger with numeric weekday "1" — which fires on SUNDAY
 * under Cloudflare's 1 = Sunday numbering — and nothing tested the dispatch
 * itself, so a
 * 599-green suite proved nothing about it. These tests import the real worker
 * and drive scheduled() directly: the update job must run on EVERY trigger
 * (it self-gates by PT clock), and the five sweeps must keep running on the
 * 2-minute cron exactly as before, skipping only the dedicated update runs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from './env';

vi.mock('./lib/update-push', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/update-push')>()),
  runUpdatePushCron: vi.fn(async () => undefined),
}));
vi.mock('./handlers/coop-boss', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./handlers/coop-boss')>()),
  runRaidMatchmakeSweep: vi.fn(async () => undefined),
  sweepPendingSummonsReminders: vi.fn(async () => undefined),
  sweepCrunchTimeReminders: vi.fn(async () => undefined),
}));
vi.mock('./lib/win-back', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/win-back')>()),
  sweepWinBackPushes: vi.fn(async () => 0),
}));
vi.mock('./lib/pact-flame-risk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/pact-flame-risk')>()),
  sweepPactFlameRisk: vi.fn(async () => 0),
}));

import worker from './index';
import { runUpdatePushCron, UPDATE_PUSH_CRON } from './lib/update-push';
import { runRaidMatchmakeSweep, sweepCrunchTimeReminders, sweepPendingSummonsReminders } from './handlers/coop-boss';
import { sweepWinBackPushes } from './lib/win-back';
import { sweepPactFlameRisk } from './lib/pact-flame-risk';

const SWEEPS = [runRaidMatchmakeSweep, sweepPendingSummonsReminders, sweepCrunchTimeReminders, sweepWinBackPushes, sweepPactFlameRisk];

async function fire(cron: string): Promise<{ env: Env; waited: number }> {
  const env = { DB: {} } as unknown as Env;
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => {
      pending.push(p);
    },
    passThroughOnException: () => undefined,
  } as unknown as ExecutionContext;
  const event = { cron, scheduledTime: 0, noRetry: () => undefined } as unknown as ScheduledController;
  await worker.scheduled!(event, env, ctx);
  await Promise.all(pending);
  return { env, waited: pending.length };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('scheduled() dispatch (W904)', () => {
  it('the dedicated update trigger runs the update job with its cron string and NO sweeps', async () => {
    const { env, waited } = await fire(UPDATE_PUSH_CRON);
    expect(runUpdatePushCron).toHaveBeenCalledTimes(1);
    expect(runUpdatePushCron).toHaveBeenCalledWith(env, UPDATE_PUSH_CRON);
    for (const s of SWEEPS) expect(s).not.toHaveBeenCalled();
    expect(waited).toBe(1);
  });

  it('the 2-minute sweep trigger runs the update job TOO (self-gated) and all five sweeps exactly once', async () => {
    const { env, waited } = await fire('*/2 * * * *');
    expect(runUpdatePushCron).toHaveBeenCalledTimes(1);
    expect(runUpdatePushCron).toHaveBeenCalledWith(env, '*/2 * * * *');
    for (const s of SWEEPS) expect(s).toHaveBeenCalledTimes(1);
    expect(runRaidMatchmakeSweep).toHaveBeenCalledWith(env, expect.anything());
    expect(sweepWinBackPushes).toHaveBeenCalledWith(env);
    expect(waited).toBe(1 + SWEEPS.length);
  });

  it('dispatch never depends on string equality: an unexpected cron string still runs the update job', async () => {
    // The old shape — `if (event.cron === '<update cron>') push else sweeps` —
    // would drop the update job for any string the platform did not deliver
    // byte-for-byte. Any normalization now costs at most some extra sweep
    // runs (idempotent by construction), never the broadcast.
    for (const odd of ['*/5 16-17 * * 1', '*/5 16-17 * * mon', '0/5 16-17 * * MON']) await fire(odd);
    expect(runUpdatePushCron).toHaveBeenCalledTimes(3);
    expect((runUpdatePushCron as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => c[1])).toEqual([
      '*/5 16-17 * * 1',
      '*/5 16-17 * * mon',
      '0/5 16-17 * * MON',
    ]);
  });

  it('the constant the dispatcher compares against is the wrangler.toml trigger', () => {
    expect(UPDATE_PUSH_CRON).toBe('*/5 16-17 * * MON');
  });
});
