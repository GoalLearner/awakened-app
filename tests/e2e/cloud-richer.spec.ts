/**
 * Awakened — offering back a richer cloud backup (W1102), client side.
 *
 * 2026-10-26: a reinstall that tapped Cancel at the restore prompt uploaded its fresh state over
 * the only backup (Zynfandel). The server now keeps a backup another phone made when a save holds
 * far less (W1101, 409 CLOUD_RICHER). These specs pin the app's half:
 *   - a refused save offers the backup, once a launch; Back up now always asks;
 *   - the offer comes at launch too, when the backup came from another device and holds more;
 *   - Reset all progress marks the next save fresh_start, and the mark goes once a save lands.
 *
 * Auth is patched after boot (the cloud calls are the only ones these specs care about).
 */
import { test, expect, Page } from '@playwright/test';

async function boot(page: Page) {
  await page.addInitScript(() => {
    const css = '#awakened-splash,#fri-challenge-overlay,#fri-challenge-modal,#upd-banner{display:none!important;visibility:hidden!important;pointer-events:none!important}';
    const inject = () => {
      const root = document.head || document.documentElement;
      if (root && !document.getElementById('e2e-splash-kill')) {
        const s = document.createElement('style'); s.id = 'e2e-splash-kill'; s.textContent = css; root.appendChild(s);
      }
    };
    inject();
    document.addEventListener('DOMContentLoaded', inject);
    try {
      ['hb_onboarding_seen_v2', 'hb_welcomed', 'hb_hunter_name_claimed', 'hb_cloud_restore_dismissed', 'hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_fg_guide_v1', 'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_healthkit_prompted', 'hb_first_completion_bonus_v1'].forEach((k) => localStorage.setItem(k, '1'));
      if (!localStorage.getItem('hb_habits')) localStorage.setItem('hb_habits', '[]');
      localStorage.setItem('hb_whats_new_seen', '99.99.99');
      localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
      localStorage.setItem('hb_onboarding_first_xp_date', '2026-01-01');
    } catch (_) { /* noop */ }
  });
  await page.goto('/');
  await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });
}

/**
 * Signs the page in for CloudSync and answers its two cloud calls; window.__cloud records them.
 * The phone gets a little progress first, or the app's own first-launch prompt (an empty phone,
 * a backup on the server) would answer the sign-in; `device` is this phone's cloud device id
 * (the backup's own, dev_old, unless a spec needs another phone).
 */
async function stubCloud(page: Page, opts: { upload: 'richer' | 'ok'; confirm: boolean; device?: string }) {
  await page.evaluate((o) => {
    localStorage.setItem('hb_points', '5');
    localStorage.setItem('hb_cloud_device_id', o.device || 'dev_old');
    const days = (n: number) => {
      const out: Record<string, string[]> = {};
      const d = new Date('2026-09-01T12:00:00Z');
      for (let i = 0; i < n; i++) { out[d.toISOString().slice(0, 10)] = ['h1']; d.setUTCDate(d.getUTCDate() + 1); }
      return JSON.stringify(out);
    };
    const rec = { uploads: [] as any[], pulls: 0, confirms: 0 };
    (window as any).__cloud = rec;
    const a = (window as any).Auth;
    a.getCurrentUser = () => ({ jwt: 't', alias: 'hunter' });
    a.uploadCloudState = async (p: any) => {
      rec.uploads.push(p);
      return o.upload === 'ok' ? { ok: true, bytes: 10 } : { ok: false, code: 'CLOUD_RICHER', detail: 'The backup holds more history than this device.' };
    };
    a.fetchCloudState = async () => {
      rec.pulls++;
      return { ok: true, exists: true, client_updated_at: '2026-10-23T20:03:13.016Z', device_id: 'dev_old', state: { keys: { hb_completions: days(34), hb_points: '1840' } } };
    };
    window.confirm = () => { rec.confirms++; return o.confirm; };
  }, opts);
}
const cloud = (page: Page) => page.evaluate(() => (window as any).__cloud);

test.describe('A richer backup is offered back (W1102)', () => {
  test('a refused save offers the backup once a launch; Back up now always asks', async ({ page }) => {
    await boot(page);
    await stubCloud(page, { upload: 'richer', confirm: false });
    const r1 = await page.evaluate(() => (window as any).CloudSync.pushNow('change'));
    expect(r1.code).toBe('CLOUD_RICHER');
    await expect.poll(async () => (await cloud(page)).confirms, { timeout: 5_000 }).toBe(1);

    await page.evaluate(() => (window as any).CloudSync.pushNow('change'));
    await page.waitForTimeout(1200);
    expect((await cloud(page)).confirms).toBe(1);

    const r3 = await page.evaluate(() => (window as any).CloudSync.pushNow('manual'));
    expect(r3.code).toBe('CLOUD_RICHER');
    expect((await cloud(page)).confirms).toBe(2);
    const asked = await page.evaluate(() => JSON.parse(localStorage.getItem('hb_cloud_richer_asked_at') || 'null'));
    expect(asked.n).toBe(2);
  });

  test('at launch, a backup from another device with more history is offered and nothing uploads', async ({ page }) => {
    await boot(page);
    await stubCloud(page, { upload: 'richer', confirm: false, device: 'dev_new' });
    await page.evaluate(() => (window as any).CloudSync.maybeSyncOnInit());
    await expect.poll(async () => (await cloud(page)).confirms, { timeout: 5_000 }).toBe(1);
    await page.waitForTimeout(800);
    expect((await cloud(page)).uploads.length).toBe(0);
  });

  test('three not-nows end the automatic offers', async ({ page }) => {
    await boot(page);
    await stubCloud(page, { upload: 'richer', confirm: false });
    await page.evaluate(() => localStorage.setItem('hb_cloud_richer_asked_at', JSON.stringify({ at: 1, n: 3 })));
    await page.evaluate(() => (window as any).CloudSync.pushNow('change'));
    await page.waitForTimeout(1500);
    expect((await cloud(page)).confirms).toBe(0);
  });

  test('Reset all progress marks the next save fresh_start; the mark goes once a save lands', async ({ page }) => {
    await boot(page);
    await Promise.all([
      page.waitForEvent('load'),
      page.evaluate(() => { const b = document.getElementById('reset2-confirm') as HTMLButtonElement; b.disabled = false; b.click(); }),
    ]);
    await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });
    expect(await page.evaluate(() => localStorage.getItem('hb_cloud_fresh_start_v1'))).toBe('1');

    await stubCloud(page, { upload: 'ok', confirm: false });
    const res = await page.evaluate(() => (window as any).CloudSync.pushNow('change'));
    expect(res.ok).toBe(true);
    const c = await cloud(page);
    expect(c.uploads[0].fresh_start).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('hb_cloud_fresh_start_v1'))).toBeNull();
  });

  test('at launch, a hunter who started over on purpose is not offered the old backup', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => localStorage.setItem('hb_cloud_fresh_start_v1', '1'));
    await stubCloud(page, { upload: 'richer', confirm: false, device: 'dev_new' });
    await page.evaluate(() => (window as any).CloudSync.maybeSyncOnInit());
    await page.waitForTimeout(1500);
    expect((await cloud(page)).confirms).toBe(0);
  });
});
