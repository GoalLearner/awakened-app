/**
 * Awakened — W1177: a way out when the app cannot start, and a way to tell us from inside it.
 *
 * Owner 2026-11-09: "make sure the app doesn't break down and there's no way to enter or tell me" (Katherine had to
 * find an email address when 3.0.15 closed at launch on iOS 27). Pinned here:
 *   - app.js never arrives → after 15 s the card offers Try again and an email with the details filled in;
 *   - a normal start never shows it;
 *   - Settings > Help & About > Report a problem builds an email with the hunter, the build and the phone.
 */
import { test, expect } from '@playwright/test';

test.describe('W1177 · a way out when the app cannot start', () => {
  test('app.js never arrives: after 15 s the card offers Try again and an email with the details', async ({ page }) => {
    await page.route(/\/app\.js(\?|$)/, (r) => r.abort());
    await page.clock.install();
    await page.goto('/');
    await expect(page.locator('#awakened-splash')).toBeVisible();
    await page.clock.runFor(10_000);
    await expect(page.locator('#aw-rescue')).toBeHidden();       // a slow start is not a failed one
    await page.clock.runFor(6_000);
    await expect(page.locator('#aw-rescue')).toBeVisible();
    await expect(page.locator('#aw-rescue-t')).toHaveText('Awakened didn’t start');
    await expect(page.locator('#aw-rescue-retry')).toHaveText('Try again');
    const href = await page.locator('#aw-rescue-mail').getAttribute('href');
    expect(href).toMatch(/^mailto:[^?]+@[^?]+\?subject=/);
    const mail = decodeURIComponent(href || '');
    expect(mail).toContain('Awakened did not start');
    expect(mail).toMatch(/App: web \d+ \(stuck\)/);
    expect(mail).toContain('iOS: ');
    await page.locator('#aw-rescue-x').click();
    await expect(page.locator('#aw-rescue')).toBeHidden();
  });

  test('a normal start never shows it', async ({ page }) => {
    await page.clock.install();
    await page.goto('/');
    await page.clock.runFor(20_000);
    await expect(page.locator('#awakened-splash')).toHaveCount(0);
    await expect(page.locator('#aw-rescue')).toBeHidden();
  });

  test('Settings > Help & About > Report a problem: an email with the hunter, the build and the phone filled in', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => typeof (window as any).__reportProblemMail === 'function');
    const row = page.locator('#settings-report-problem');
    await expect(row).toHaveCount(1);
    await expect(row.locator('.settings-v2-fname')).toHaveText('Report a problem');
    const href: string = await page.evaluate(() => (window as any).__reportProblemMail());
    expect(href).toMatch(/^mailto:[^?]+@[^?]+\?subject=Awakened%3A%20a%20problem&body=/);
    const mail = decodeURIComponent(href);
    expect(mail).toContain('What happened:');
    expect(mail).toMatch(/App: 3\.\d+\.\d+-w\d+/);
    expect(mail).toContain('Hunter: ');
  });
});
