/**
 * update-push.test.ts — W680 Monday update-push broadcast: paging, cursor CAS,
 * idempotency, and the not-configured no-op. Hand-rolled substring-routed D1
 * mock (same pattern as founder-mark.test.ts); notifyUser is exercised via a
 * mocked global fetch (APNs) so the real apns.ts pipeline runs.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseStorePage, runUpdatePushCron, runUpdatePushPage, storeRelease, STORE_REPORT_EVENT, UPDATE_PUSH_CRON } from './update-push';
import type { Env } from '../env';

interface MockState {
  cursor: string;
  completed: number;
  sent: number;
  users: string[]; // distinct device_tokens.user_id, sorted
  tokensByUser: Record<string, string[]>;
  notified: string[]; // tokens APNs "received"
  casLoseOnce?: boolean; // simulate a concurrent run winning the claim
  buildsByUser?: Record<string, string | null>; // W835 — latest app_opens.build per user
  cronRuns?: unknown[][]; // W904 — cron_runs journal rows (bind args: job, cron, day_key, decision, detail, ...)
  reports?: { detail: string | null; at: number }[]; // W1044 — store_version funnel events
  installed?: string[]; // W1044 — builds anyone has opened lately (app_opens.build)
}

function makeEnv(state: MockState): Env {
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => {
          if (/FROM push_broadcast_log/.test(sql)) {
            return { cursor: state.cursor, completed: state.completed, sent_users: state.sent };
          }
          return null;
        },
        run: async () => {
          if (/INSERT INTO cron_runs/.test(sql)) {
            (state.cronRuns || (state.cronRuns = [])).push(args);
            return { success: true, meta: { changes: 1 } };
          }
          if (/INSERT OR IGNORE INTO push_broadcast_log/.test(sql)) {
            return { success: true, meta: { changes: 0 } };
          }
          if (/UPDATE push_broadcast_log/.test(sql) && /completed = 1,/.test(sql)) {
            // empty-page completion path (no CAS args beyond day+cursor)
            state.completed = 1;
            return { success: true, meta: { changes: 1 } };
          }
          if (/UPDATE push_broadcast_log/.test(sql)) {
            // CAS claim: WHERE cursor = <old>
            const oldCursor = args[4] as string;
            if (state.casLoseOnce) { state.casLoseOnce = false; return { success: true, meta: { changes: 0 } }; }
            if (oldCursor !== state.cursor) return { success: true, meta: { changes: 0 } };
            state.cursor = args[0] as string;
            state.sent += args[1] as number;
            state.completed = args[2] as number;
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 1 } };
        },
        all: async () => {
          if (/SELECT DISTINCT dt\.user_id/.test(sql)) {
            // W835 page query: user_id + latest reported build subselect.
            const after = args[0] as string;
            const limit = args[1] as number;
            const page = state.users.filter((u) => u > after).slice(0, limit);
            return {
              results: page.map((u) => ({ user_id: u, build: (state.buildsByUser || {})[u] ?? null })),
              success: true,
              meta: {},
            };
          }
          if (/^SELECT DISTINCT build FROM app_opens/.test(sql)) {   // W1044 — what anyone runs
            return { results: (state.installed || []).map((build) => ({ build })), success: true, meta: {} };
          }
          if (/FROM funnel_events/.test(sql)) {   // W1044 — the phones' reports, grouped by detail
            const since = args[1] as number;
            const by = new Map<string | null, number>();
            (state.reports || []).filter((r) => args[0] === STORE_REPORT_EVENT && r.at > since)
              .forEach((r) => by.set(r.detail, Math.max(by.get(r.detail) || 0, r.at)));
            const results = [...by.entries()].map(([detail, last_at]) => ({ detail, last_at })).sort((x, y) => y.last_at - x.last_at);
            return { results, success: true, meta: {} };
          }
          if (/FROM device_tokens/.test(sql)) {
            // notifyUser's per-user token read
            const uid = args[0] as string;
            return {
              results: (state.tokensByUser[uid] || []).map((t) => ({ token: t, environment: 'production', bundle_id: null })),
              success: true,
              meta: {},
            };
          }
          return { results: [], success: true, meta: {} };
        },
      }),
    }),
  } as unknown as D1Database;
  return {
    DB: db,
    // minimal APNs config so pushConfigured() passes; the JWT/key path is
    // bypassed by mocking apns internals via fetch? No — importPKCS8 needs a real
    // key, so tests below that reach notifyUser stub global fetch AND the JWT
    // cache seam is avoided by using an invalid key + asserting notifyUser's
    // never-throws contract (send failures are swallowed per-token).
    APNS_AUTH_KEY: 'invalid-pem',
    APNS_KEY_ID: 'KEYID12345',
    APPLE_TEAM_ID: 'TEAM123456',
    APPLE_BUNDLE_ID: 'com.goallearner.awakened',
  } as unknown as Env;
}

afterEach(() => vi.restoreAllMocks());

describe('runUpdatePushPage', () => {
  it('not configured → no-op with PUSH_NOT_CONFIGURED', async () => {
    const env = { DB: {} } as unknown as Env; // no APNs secrets
    const r = await runUpdatePushPage(env, 'test-day');
    expect(r).toEqual({ ok: false, sent: 0, completed: false, reason: 'PUSH_NOT_CONFIGURED' });
  });

  it('already completed day → ALREADY_COMPLETED, sends nothing', async () => {
    const st: MockState = { cursor: 'zz', completed: 1, sent: 5, users: ['a', 'b'], tokensByUser: {}, notified: [] };
    const r = await runUpdatePushPage(makeEnv(st), 'd1');
    expect(r.completed).toBe(true);
    expect(r.reason).toBe('ALREADY_COMPLETED');
  });

  it('empty device_tokens → marks completed immediately', async () => {
    const st: MockState = { cursor: '', completed: 0, sent: 0, users: [], tokensByUser: {}, notified: [] };
    const r = await runUpdatePushPage(makeEnv(st), 'd1');
    expect(r.completed).toBe(true);
    expect(st.completed).toBe(1);
  });

  it('short page (< PAGE_USERS) → sends, advances cursor, marks completed', async () => {
    const st: MockState = {
      cursor: '', completed: 0, sent: 0,
      users: ['u1', 'u2', 'u3'],
      tokensByUser: { u1: ['t1'], u2: ['t2'], u3: ['t3'] },
      notified: [],
    };
    const r = await runUpdatePushPage(makeEnv(st), 'd1');
    expect(r.ok).toBe(true);
    expect(r.sent).toBe(3);
    expect(r.completed).toBe(true);
    expect(st.cursor).toBe('u3');
    expect(st.sent).toBe(3);
    expect(st.completed).toBe(1);
  });

  it('full page (50, W835 ceiling) → advances cursor, NOT completed; second call takes the rest', async () => {
    const users = Array.from({ length: 55 }, (_, i) => 'u' + String(i + 10).padStart(3, '0')); // sorted
    const st: MockState = {
      cursor: '', completed: 0, sent: 0, users,
      tokensByUser: Object.fromEntries(users.map((u) => [u, []])), // no tokens → notifyUser no-ops
      notified: [],
    };
    const env = makeEnv(st);
    const r1 = await runUpdatePushPage(env, 'd1');
    expect(r1.sent).toBe(50);
    expect(r1.completed).toBe(false);
    expect(st.cursor).toBe(users[49]);
    const r2 = await runUpdatePushPage(env, 'd1');
    expect(r2.sent).toBe(5);
    expect(r2.completed).toBe(true);
    expect(st.sent).toBe(55);
  });

  // ── W835 (R1b) — per-user version gate ─────────────────────────────
  it('skips users already on the store version; null/old/malformed builds still get the push', async () => {
    const st: MockState = {
      cursor: '', completed: 0, sent: 0,
      users: ['u1', 'u2', 'u3', 'u4', 'u5'],
      tokensByUser: {},
      notified: [],
      buildsByUser: {
        u1: '2.5.0-w833',   // current → skipped
        u2: '2.4.8-w817',   // older → sent
        u3: null,           // pre-W834 client, never reported → sent
        u4: 'garbage',      // unparseable → sent (fail open toward nudging)
        u5: '2.5.1-w840',   // AHEAD of store (TestFlight) → skipped
      },
    };
    const r = await runUpdatePushPage(makeEnv(st), 'd1', '2.5.0');
    expect(r.ok).toBe(true);
    expect(r.sent).toBe(3);
    expect(r.skipped_current).toBe(2);
    expect(r.completed).toBe(true);
    expect(st.cursor).toBe('u5');   // skipped users still advance the cursor
    expect(st.sent).toBe(3);        // sent_users counts actual sends only
  });

  it('no storeVersion (admin test-fire) → gate bypassed, everyone sent', async () => {
    const st: MockState = {
      cursor: '', completed: 0, sent: 0,
      users: ['u1', 'u2'],
      tokensByUser: {},
      notified: [],
      buildsByUser: { u1: '9.9.9-w999', u2: '9.9.9-w999' },
    };
    const r = await runUpdatePushPage(makeEnv(st), 'd1');
    expect(r.sent).toBe(2);
    expect(r.skipped_current).toBe(0);
  });

  it('an all-current page sends nothing but still advances and completes', async () => {
    const st: MockState = {
      cursor: '', completed: 0, sent: 0,
      users: ['u1', 'u2'],
      tokensByUser: {},
      notified: [],
      buildsByUser: { u1: '2.5.0-w830', u2: '2.5.0-w833' },
    };
    const r = await runUpdatePushPage(makeEnv(st), 'd1', '2.5.0');
    expect(r.sent).toBe(0);
    expect(r.skipped_current).toBe(2);
    expect(r.completed).toBe(true);
    expect(st.cursor).toBe('u2');
  });

  it('CAS claim lost (concurrent run) → sends nothing, reports LOST_CLAIM_RACE', async () => {
    const st: MockState = {
      cursor: '', completed: 0, sent: 0,
      users: ['u1', 'u2'], tokensByUser: { u1: ['t1'], u2: ['t2'] }, notified: [],
      casLoseOnce: true,
    };
    const r = await runUpdatePushPage(makeEnv(st), 'd1');
    expect(r.ok).toBe(true);
    expect(r.sent).toBe(0);
    expect(r.reason).toBe('LOST_CLAIM_RACE');
    expect(st.sent).toBe(0);
  });

  it('APNs failures never fail the page (notifyUser never-throws contract)', async () => {
    // Users HAVE tokens; the invalid PEM makes the JWT step throw inside
    // notifyUser, which swallows per its contract — the page still completes.
    const st: MockState = {
      cursor: '', completed: 0, sent: 0,
      users: ['u1'], tokensByUser: { u1: ['t1', 't2'] }, notified: [],
    };
    const r = await runUpdatePushPage(makeEnv(st), 'd1');
    expect(r.ok).toBe(true);
    expect(r.sent).toBe(1);
    expect(r.completed).toBe(true);
  });
});

// ── W904 — the cron entry: PT gate, journal, lookup retry ───────────────
// Background: the trigger "*/5 16-17 * * 1" fired every SUNDAY for seven weeks
// (Cloudflare weekdays are 1 = Sunday); the gate refused correctly and nothing
// recorded it. These pin the gate on the exact days involved and make every
// outcome leave a row.
function lookupResponse(version: string, releasedAt: string, status = 200): Response {
  return new Response(JSON.stringify({ resultCount: 1, results: [{ version, currentVersionReleaseDate: releasedAt }] }), {
    status,
    headers: { 'content-type': 'text/javascript; charset=utf-8' },
  });
}
function cronState(over: Partial<MockState> = {}): MockState {
  return { cursor: '', completed: 0, sent: 0, users: ['u1', 'u2'], tokensByUser: {}, notified: [], cronRuns: [], ...over };
}
const decisionsOf = (st: MockState) => (st.cronRuns || []).map((r) => r[3]);
const detailOf = (st: MockState, i = 0) => JSON.parse((st.cronRuns as unknown[][])[i][4] as string);

describe('runUpdatePushCron (W904)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('SUNDAY 9 AM PT (the day the old trigger actually fired) → refuses without a lookup; only the dedicated trigger leaves a heartbeat', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-30T16:30:00Z')); // Sunday 9:30 AM PDT
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const st = cronState();
    const env = makeEnv(st);
    await runUpdatePushCron(env, '*/2 * * * *');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(decisionsOf(st)).toEqual([]);
    await runUpdatePushCron(env, UPDATE_PUSH_CRON);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(decisionsOf(st)).toEqual(['SKIP_GATE']);
    expect(st.cursor).toBe(''); // no page ran
  });

  it('MONDAY 9 AM PT + fresh release → runs the page under the version gate and journals PAGE', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-31T16:30:00Z')); // Monday 9:30 AM PDT — the run that should have happened
    vi.stubGlobal('fetch', vi.fn(async () => lookupResponse('3.0.1', '2026-08-31T13:25:41Z')));
    const st = cronState({ buildsByUser: { u1: '3.0.1-w903', u2: null } });
    await runUpdatePushCron(makeEnv(st), '*/2 * * * *');
    expect(st.sent).toBe(1); // u1 is current; u2 never reported a build → nudged
    expect(st.completed).toBe(1);
    expect(decisionsOf(st)).toEqual(['PAGE']);
    const detail = detailOf(st);
    expect(detail.release.fresh).toBe(true);
    expect(detail.release.version).toBe('3.0.1');
    expect(detail.page.sent).toBe(1);
    expect(detail.page.skipped_current).toBe(1);
    expect((st.cronRuns as unknown[][])[0][1]).toBe('*/2 * * * *'); // journal names the trigger that did the work
  });

  it('MONDAY 10 AM PT (the second UTC hour in summer) → gate refuses, heartbeat only', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-31T17:30:00Z')); // Monday 10:30 AM PDT
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const st = cronState();
    await runUpdatePushCron(makeEnv(st), UPDATE_PUSH_CRON);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(decisionsOf(st)).toEqual(['SKIP_GATE']);
  });

  it('winter MONDAY: 17:30Z is 9:30 AM PST → proceeds', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-12-07T17:30:00Z'));
    vi.stubGlobal('fetch', vi.fn(async () => lookupResponse('3.1.0', '2026-12-05T12:00:00Z')));
    const st = cronState();
    await runUpdatePushCron(makeEnv(st), UPDATE_PUSH_CRON);
    expect(decisionsOf(st)).toEqual(['PAGE']);
    expect(st.completed).toBe(1);
  });

  it('MONDAY but a stale release → SKIP_NOT_FRESH with a reason, no page', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-31T16:30:00Z'));
    vi.stubGlobal('fetch', vi.fn(async () => lookupResponse('3.0.0', '2026-08-01T12:00:00Z')));
    const st = cronState();
    await runUpdatePushCron(makeEnv(st), '*/2 * * * *');
    expect(st.cursor).toBe('');
    expect(decisionsOf(st)).toEqual(['SKIP_NOT_FRESH:STALE']);
    const detail = detailOf(st);
    expect(detail.reason).toBe('STALE');
    expect(detail.version).toBe('3.0.0');
  });

  it('day already completed → later in-window runs do not touch the lookup or the journal', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-31T16:40:00Z'));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const st = cronState({ completed: 1, cursor: 'u2', sent: 2 });
    await runUpdatePushCron(makeEnv(st), '*/2 * * * *');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(decisionsOf(st)).toEqual([]);
  });

  it('nothing reachable (lookup twice, then the page) and no reports → SKIP_NOT_FRESH naming every source (fail closed, but visibly)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-31T16:30:00Z'));
    const fetchMock = vi.fn().mockRejectedValue(new Error('socket hang up'));
    vi.stubGlobal('fetch', fetchMock);
    const st = cronState();
    await runUpdatePushCron(makeEnv(st), '*/2 * * * *');
    expect(fetchMock).toHaveBeenCalledTimes(3);   // W1044 — two lookups, one page
    expect(st.cursor).toBe('');
    const why = 'lookup:FETCH_socket hang up+page:FETCH_socket hang up+reports:NO_INSTALLED_BUILD';
    expect(decisionsOf(st)).toEqual(['SKIP_NOT_FRESH:' + why]); // the reason is part of the once-key
    const detail = detailOf(st);
    expect(detail.reason).toBe(why);
    expect(detail.source).toBeNull();
    expect(detail.attempts).toBe(2);
  });
});

describe('storeRelease (W904)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('retries once: a network failure then success is fresh', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-31T16:30:00Z'));
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(lookupResponse('3.0.1', '2026-08-31T13:25:41Z'));
    vi.stubGlobal('fetch', fetchMock);
    const r = await storeRelease();
    expect(r.fresh).toBe(true);
    expect(r.attempts).toBe(2);
    expect(r.version).toBe('3.0.1');
    expect(r.age_days).toBeCloseTo(0.13, 2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('every request refused → not fresh, each source named with its HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('forbidden', { status: 403 })));
    const r = await storeRelease();
    expect(r).toMatchObject({ fresh: false, version: null, reason: 'lookup:HTTP_403+page:HTTP_403', attempts: 2, source: null });
  });

  it('a lookup body with no release date is not an answer: the page is asked, and the version is still surfaced', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ results: [{ version: '3.0.1' }] }), { status: 200 })));
    const r = await storeRelease();
    expect(r).toMatchObject({ fresh: false, version: '3.0.1', reason: 'lookup:NO_RELEASE_DATE+page:NO_VERSION', attempts: 1 });
  });

  it('leading whitespace in the body (what Apple actually returns) parses', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-31T16:30:00Z'));
    const body = '\n\n\n' + JSON.stringify({ results: [{ version: '3.0.1', currentVersionReleaseDate: '2026-08-31T13:25:41Z' }] });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));
    const r = await storeRelease();
    expect(r.fresh).toBe(true);
  });
});

// ── W1044 — the lookup is refused from Cloudflare's network (HTTP 403 on every Monday the
// journal has), so the push had never gone out. Two more sources stand behind it. ──
const PAGE_HEAD = '<link rel="canonical" href="https://apps.apple.com/us/app/awakened-habit-rpg/id6764727990">';
const PAGE_DATA = '{"$kind":"TitledParagraph","text":"Every boss.","style":"overview","primarySubtitle":"Version 3.0.12","secondarySubtitle":"Mon Oct 12 2026 18:02:35 GMT+0000 (Coordinated Universal Time)"}';
const PAGE_MARKUP = '<div class="metadata svelte-1t5dyc5"><span class="svelte-1t5dyc5">Version 3.0.12</span> <time datetime="2026-10-12" class="svelte-1t5dyc5">3h ago</time></div>';
const PAGE_HISTORY = '{"primarySubtitle":"3.0.11","secondarySubtitle":"Sun Oct 11 2026 18:13:44 GMT+0000 (Coordinated Universal Time)"}<span class="x">3.0.11</span> <time datetime="2026-10-11" class="x">1d ago</time>';
const storePage = (...parts: string[]) => new Response('<html>' + parts.join('\n') + '</html>', { status: 200, headers: { 'content-type': 'text/html' } });
/** Routes by host, as the real thing does: the lookup API and the web page are different doors. */
function apple(lookup: () => Response | Promise<Response>, page: () => Response | Promise<Response>) {
  return vi.fn(async (url: unknown) => (String(url).includes('itunes.apple.com') ? lookup() : page()));
}
const refused = () => new Response('', { status: 403 });

describe('parseStorePage (W1044)', () => {
  it('reads the version and the exact release time from the page data', () => {
    expect(parseStorePage(PAGE_HEAD + PAGE_DATA + PAGE_HISTORY)).toEqual({ version: '3.0.12', iso: '2026-10-12T18:02:35.000Z' });
  });
  it('reads them from the markup alone (the date is the day, at midnight UTC)', () => {
    expect(parseStorePage(PAGE_HEAD + PAGE_MARKUP + PAGE_HISTORY)).toEqual({ version: '3.0.12', iso: '2026-10-12T00:00:00.000Z' });
  });
  it('the data wins when both are there; an older version in the history is never taken for the live one', () => {
    expect(parseStorePage(PAGE_HEAD + PAGE_HISTORY + PAGE_MARKUP + PAGE_DATA)).toEqual({ version: '3.0.12', iso: '2026-10-12T18:02:35.000Z' });
    expect(parseStorePage(PAGE_HEAD + PAGE_HISTORY)).toEqual({ version: null, iso: null });
  });
  it('a page for some other app, an empty page, or not a string at all → nothing', () => {
    expect(parseStorePage(PAGE_DATA + PAGE_MARKUP)).toEqual({ version: null, iso: null });
    expect(parseStorePage('')).toEqual({ version: null, iso: null });
    expect(parseStorePage(undefined as unknown as string)).toEqual({ version: null, iso: null });
  });
  it('a version with a date nobody can read is a version with no date', () => {
    const bad = PAGE_DATA.replace('Mon Oct 12 2026 18:02:35 GMT+0000 (Coordinated Universal Time)', 'sometime soon');
    expect(parseStorePage(PAGE_HEAD + bad)).toEqual({ version: '3.0.12', iso: null });
  });
});

describe('storeRelease — three sources (W1044)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('the lookup refused (what production sees) → the App Store page answers', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T16:30:00Z'));   // the Monday after 3.0.12
    const f = apple(refused, () => storePage(PAGE_HEAD, PAGE_DATA, PAGE_MARKUP));
    vi.stubGlobal('fetch', f);
    const r = await storeRelease();
    expect(r).toMatchObject({ fresh: true, version: '3.0.12', released_at: '2026-10-12T18:02:35.000Z', reason: null, source: 'page', tried: ['lookup:HTTP_403'] });
    expect(r.age_days).toBeCloseTo(6.94, 2);
    expect(f).toHaveBeenCalledTimes(3);
    expect(String(f.mock.calls[2][0])).toBe('https://apps.apple.com/us/app/id6764727990');
  });

  it('an answer from the lookup is final, stale or not: the page is never asked', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T16:30:00Z'));
    const page = vi.fn(() => storePage(PAGE_HEAD, PAGE_DATA));
    vi.stubGlobal('fetch', apple(() => lookupResponse('3.0.11', '2026-09-30T12:00:00Z'), page));
    expect(await storeRelease()).toMatchObject({ fresh: false, version: '3.0.11', reason: 'STALE', source: 'lookup', tried: [] });
    expect(page).not.toHaveBeenCalled();
  });

  it('the page is final too: a stale page does not go on to the reports', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-30T17:30:00Z'));
    vi.stubGlobal('fetch', apple(refused, () => storePage(PAGE_HEAD, PAGE_DATA)));
    const st = cronState({ installed: ['3.0.13-w1045'], reports: [{ detail: '3.0.13|2026-11-29T10:00:00Z', at: Date.now() - 3600_000 }] });
    expect(await storeRelease(makeEnv(st))).toMatchObject({ fresh: false, version: '3.0.12', reason: 'STALE', source: 'page' });
  });

  it('lookup refused and the page down → the newest version the phones reported', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T16:30:00Z'));
    vi.stubGlobal('fetch', apple(refused, () => new Response('', { status: 503 })));
    const now = Date.now();
    const st = cronState({
      installed: ['3.0.10-w1024', '3.0.12-w1041', '3.0.13-w1045'],
      reports: [
        { detail: '3.0.11|2026-10-11T18:13:44Z', at: now - 7 * 86400_000 },
        { detail: '3.0.12|2026-10-12T18:02:35Z', at: now - 2 * 86400_000 },
        { detail: '3.0.12|2026-10-12T18:02:35Z', at: now - 3600_000 },
      ],
    });
    const r = await storeRelease(makeEnv(st));
    expect(r).toMatchObject({ fresh: true, version: '3.0.12', released_at: '2026-10-12T18:02:35.000Z', source: 'reports', tried: ['lookup:HTTP_403', 'page:HTTP_503'] });
  });

  it('a report naming a version above every installed build is ignored', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T16:30:00Z'));
    vi.stubGlobal('fetch', apple(refused, refused));
    const now = Date.now();
    const st = cronState({
      installed: ['3.0.12-w1041', '3.0.13-w1045'],
      reports: [{ detail: '9.9.9|2026-10-19T00:00:00Z', at: now - 60_000 }, { detail: '3.0.12|2026-10-12T18:02:35Z', at: now - 3600_000 }],
    });
    expect(await storeRelease(makeEnv(st))).toMatchObject({ fresh: true, version: '3.0.12', source: 'reports' });
    st.reports = [{ detail: '9.9.9|2026-10-19T00:00:00Z', at: now - 60_000 }];
    expect(await storeRelease(makeEnv(st))).toMatchObject({ fresh: false, version: null, source: null, reason: 'lookup:HTTP_403+page:HTTP_403+reports:NONE' });
  });

  it('reports: junk is skipped, two weeks is the limit, and a version needs a date from some phone', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T16:30:00Z'));
    vi.stubGlobal('fetch', apple(refused, refused));
    const now = Date.now();
    const st = cronState({ installed: ['3.0.13-w1045'], reports: [{ detail: 'not a version', at: now - 1000 }, { detail: null, at: now - 1000 }, { detail: '3.0.12|2026-10-12T18:02:35Z', at: now - 15 * 86400_000 }] });
    expect((await storeRelease(makeEnv(st))).reason).toBe('lookup:HTTP_403+page:HTTP_403+reports:NONE');
    st.reports = [{ detail: '3.0.12', at: now - 1000 }];
    expect(await storeRelease(makeEnv(st))).toMatchObject({ fresh: false, version: '3.0.12', reason: 'lookup:HTTP_403+page:HTTP_403+reports:NO_RELEASE_DATE' });
    st.reports.push({ detail: '3.0.12|2026-10-12T18:02:35Z', at: now - 5000 });
    expect(await storeRelease(makeEnv(st))).toMatchObject({ fresh: true, version: '3.0.12', source: 'reports' });
    // nobody has opened any build lately: there is nothing to hold a report against
    st.installed = [];
    expect((await storeRelease(makeEnv(st))).reason).toBe('lookup:HTTP_403+page:HTTP_403+reports:NO_INSTALLED_BUILD');
  });

  it('without a database (no env) the reports are simply not a source', async () => {
    vi.stubGlobal('fetch', apple(refused, () => storePage(PAGE_HEAD)));
    expect(await storeRelease()).toMatchObject({ fresh: false, tried: ['lookup:HTTP_403', 'page:NO_VERSION'] });
  });
});

describe('runUpdatePushCron — the push goes out when only the page answers (W1044)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('MONDAY 9 AM PT, lookup 403, page fresh → the page runs under the version gate and the journal names the source', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T16:30:00Z'));
    vi.stubGlobal('fetch', apple(refused, () => storePage(PAGE_HEAD, PAGE_DATA, PAGE_MARKUP)));
    const st = cronState({ users: ['u1', 'u2', 'u3'], buildsByUser: { u1: '3.0.12-w1041', u2: '3.0.11-w1036', u3: '3.0.10-w1024' } });
    await runUpdatePushCron(makeEnv(st), '*/2 * * * *');
    expect(st.sent).toBe(2);            // u1 already has 3.0.12
    expect(st.completed).toBe(1);
    expect(decisionsOf(st)).toEqual(['PAGE']);
    const detail = detailOf(st);
    expect(detail.release).toMatchObject({ fresh: true, version: '3.0.12', source: 'page', tried: ['lookup:HTTP_403'] });
    expect(detail.page).toMatchObject({ sent: 2, skipped_current: 1 });
  });

  it('MONDAY 9 AM PT, lookup 403, page down, phones reported → the push still goes out', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T16:30:00Z'));
    vi.stubGlobal('fetch', apple(refused, () => new Response('', { status: 500 })));
    const st = cronState({
      users: ['u1', 'u2'], buildsByUser: { u1: '3.0.13-w1045', u2: '3.0.11-w1036' },
      installed: ['3.0.13-w1045', '3.0.11-w1036'], reports: [{ detail: '3.0.12|2026-10-12T18:02:35Z', at: Date.now() - 3600_000 }],
    });
    await runUpdatePushCron(makeEnv(st), '*/2 * * * *');
    expect(st.sent).toBe(1);            // u1 runs a newer build than the store's
    expect(detailOf(st).release).toMatchObject({ source: 'reports', version: '3.0.12' });
  });
});

