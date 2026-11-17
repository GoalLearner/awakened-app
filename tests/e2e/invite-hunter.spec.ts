/**
 * Awakened — Invite a Hunter (W596 / W843 / W898), checked end to end on the phone side.
 *
 * Owner 2026-11-16 (screenshot of Community → the Invite a Hunter row): "Make sure this invite a
 * hunter function works correctly." What a tap must do:
 *   - open the share sheet with the hunter's name, their invite code and their /i/<code> link;
 *   - with no share sheet, copy the same text + link and say so;
 *   - with no code yet, still share the name and the App Store link;
 * and what the friend does with it: type the code under Community → ANSWER → +souls and the
 * "The call, answered" card; a malformed code is refused before any request.
 */
import { test, expect, Page } from '@playwright/test';

const CODE = 'bp934hyq';
const LINK = 'https://awakened-backend.richmondcampano93.workers.dev/i/' + CODE;

async function boot(page: Page, opts: { link?: string | null; share?: boolean } = {}) {
  await page.addInitScript(({ link, share }) => {
    try {
      ['hb_onboarding_seen_v2', 'hb_welcomed', 'hb_hunter_name_claimed', 'hb_cloud_restore_dismissed'].forEach((k) => localStorage.setItem(k, '1'));
      localStorage.setItem('hb_habits', '[]');
      localStorage.setItem('hb_whats_new_seen', '99.99.99');
      const d = new Date();
      const ymd = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      localStorage.setItem('hb_fri_banner_' + ymd, '1'); localStorage.setItem('hb_fri_banner_' + new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date()), '1');
      localStorage.setItem('hb_daily_insight_last_shown', ymd);
      if (link) localStorage.setItem('hb_invite_url', link);
      const w = window as any;
      w.__shared = []; w.__copied = [];
      if (share) Object.defineProperty(navigator, 'share', { configurable: true, value: async (p: unknown) => { w.__shared.push(p); } });
      else Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => { w.__copied.push(t); } } });
    } catch (_) {}
  }, { link: opts.link === undefined ? LINK : opts.link, share: opts.share !== false });
  await page.goto('/');
  await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => document.getElementById('tab-social')!.click());
  await page.evaluate(() => (document.querySelector('[data-cm-pane="friends"]') as HTMLElement).click());
}
const me = (page: Page) => page.evaluate(() => { const u = (window as any).Auth.getCurrentUser(); return String((u && u.alias) || ''); });
const inviteBtn = (page: Page) => page.locator('#social-panel [data-guild-invite]').first();

test.describe('Invite a Hunter (W596/W843/W898)', () => {
  test('a tap opens the share sheet with your name, your code and your invite link', async ({ page }) => {
    await boot(page);
    const alias = await me(page);
    await inviteBtn(page).scrollIntoViewIfNeeded();
    await inviteBtn(page).click();
    await expect.poll(() => page.evaluate(() => (window as any).__shared.length)).toBe(1);
    const p = await page.evaluate(() => (window as any).__shared[0]);
    expect(p.title).toBe('Awakened');
    expect(p.url).toBe(LINK);
    if (alias) expect(p.text).toContain('Add me by my name: ' + alias + '.');
    expect(p.text).toContain('Enter code ' + CODE + ' under Community and we both get 500 souls.');   // W1225
    expect(await page.evaluate(() => (window as any).__copied.length)).toBe(0);   // shared, so nothing copied
    await expect(inviteBtn(page)).toContainText('You both get 500 souls');                            // W1225
  });

  test('no share sheet: the same text and link are copied, and the toast says so', async ({ page }) => {
    await boot(page, { share: false });
    await inviteBtn(page).scrollIntoViewIfNeeded();
    await inviteBtn(page).click();
    await expect.poll(() => page.evaluate(() => (window as any).__copied.length)).toBe(1);
    const t: string = await page.evaluate(() => (window as any).__copied[0]);
    expect(t).toContain('Enter code ' + CODE + ' under Community');
    expect(t.endsWith('\n' + LINK)).toBe(true);
    await expect(page.locator('.habit-toast').first()).toContainText('Invite copied');
  });

  test('no code yet: still shares your name and the App Store link', async ({ page }) => {
    await boot(page, { link: null });
    await inviteBtn(page).scrollIntoViewIfNeeded();
    await inviteBtn(page).click();
    await expect.poll(() => page.evaluate(() => (window as any).__shared.length)).toBe(1);
    const p = await page.evaluate(() => (window as any).__shared[0]);
    expect(p.url).toBe('https://apps.apple.com/app/awakened-habit-rpg/id6764727990');
    expect(p.text).not.toContain('Enter code');
  });

  test('the friend types the code under Community: ANSWER redeems it once and shows the card', async ({ page }) => {
    await boot(page, { link: null });
    await page.evaluate(() => {
      const w = window as any; w.__redeemed = [];
      w.Auth.redeemInvite = async (c: string) => { w.__redeemed.push(c); return { ok: true, inviter_alias: 'Richie', reward_souls: 500, friendship_created: true }; };
    });
    const input = page.locator('#social-invite-code');
    await input.scrollIntoViewIfNeeded();
    await input.fill(' BP9-34HYQ ');   // spaces, capitals and a dash are forgiven
    await page.locator('#social-invite-redeem').click();
    await expect.poll(() => page.evaluate(() => (window as any).__redeemed)).toEqual([CODE]);
    await expect(page.getByText('The call, answered')).toBeVisible();
    await expect(page.getByText(/entered through Richie/)).toBeVisible();
    await expect(page.getByText(/\+500 souls/)).toBeVisible();   // W1225
    await expect(input).toHaveValue('');
    expect(await page.evaluate(() => localStorage.getItem('hb_pending_invite_code'))).toBeNull();
  });

  test('a malformed code is refused on the spot, with no request', async ({ page }) => {
    await boot(page, { link: null });
    await page.evaluate(() => { const w = window as any; w.__redeemed = []; w.Auth.redeemInvite = async (c: string) => { w.__redeemed.push(c); return { ok: true }; }; });
    const input = page.locator('#social-invite-code');
    await input.scrollIntoViewIfNeeded();
    await input.fill('abc');
    await input.press('Enter');
    await expect(page.locator('.habit-toast').first()).toContainText('That code does not look right.');
    expect(await page.evaluate(() => (window as any).__redeemed.length)).toBe(0);
  });
});
