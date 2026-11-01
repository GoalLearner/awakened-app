/**
 * Awakened — a risen shadow reaches the public feed (W1117).
 *
 * W1093 made shadow_drop a feed event, but _PAE_ALLOWED_EVENT_TYPES never listed it, so the queue
 * dropped every one silently and production held no shadow_drop rows at all. These tests stand at
 * the two ends of that pipe: what the hunter's phone posts, under the server's own rules, and what
 * another hunter's feed shows. The rules are read from the backend source, so a new boss whose name
 * the server would refuse fails here rather than vanishing in production.
 */
import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';

const BACKEND = readFileSync(join(__dirname, '../../backend/src/handlers/public-achievement-events.ts'), 'utf8');
// W1118 — the server's list of bosses a shadow may name, one per line.
function backendBossNames(): Record<string, string> {
  const block = /const SHADOW_BOSS_NAMES[^=]*= \{([\s\S]*?)\n\};/.exec(BACKEND);
  if (!block) throw new Error('SHADOW_BOSS_NAMES not found in the backend');
  const out: Record<string, string> = {};
  for (const m of block[1].matchAll(/^\s*([a-z0-9_]+): "(.+)",$/gm)) out[m[1]] = m[2];
  return out;
}
const SERVER_BOSSES = backendBossNames();

async function boot(page: Page, events: unknown[] = []) {
  await page.addInitScript((evs) => {
    try {
      ['hb_onboarding_seen_v2', 'hb_welcomed', 'hb_hunter_name_claimed', 'hb_cloud_restore_dismissed'].forEach((k) => localStorage.setItem(k, '1'));
      localStorage.setItem('hb_habits', '[]');
      localStorage.setItem('hb_whats_new_seen', '99.99.99');
      const d = new Date();
      const ymd = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      localStorage.setItem('hb_fri_banner_' + ymd, '1');
      localStorage.setItem('hb_daily_insight_last_shown', ymd);
      localStorage.setItem('hb_fa_seen_ts', String(Date.now()));
      localStorage.setItem('hb_friends_activity_cache_v1', JSON.stringify({ ts: Date.now(), events: evs }));
    } catch (_) {}
  }, events);
  await page.goto('/');
  await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });
}

// The dev session never posts (_stubGate), so stand in at the one call that would.
const catchPosts = (page: Page) => page.evaluate(() => {
  const w = window as any;
  w.__posted = [];
  w.Auth.submitPublicAchievementEvents = (events: unknown[]) => { w.__posted.push(...events); return Promise.resolve({ ok: true, insertedCount: events.length, duplicateCount: 0 }); };
  const me = w.Auth.getCurrentUser() || {};
  w.Auth.getCurrentUser = () => ({ ...me, jwt: me.jwt || 'x' });
});
const posted = (page: Page) => page.evaluate(() => (window as any).__posted as any[]);
const shadows = (page: Page) => page.evaluate(() => Object.keys((window as any).__shadows().extracted));

test.describe('A risen shadow reaches the public feed (W1117)', () => {
  test('the ceremony posts one shadow_drop the server accepts, and only once', async ({ page }) => {
    await boot(page);
    await catchPosts(page);
    await page.evaluate(() => (window as any).__arise('the_carouser'));
    await expect.poll(() => page.evaluate(() => (window as any).__paeQueuePeek().concat((window as any).__posted.map((e: any) => e.eventType + ':' + e.clientEventId))), { timeout: 8000 })
      .toContain('shadow_drop:shadow:the_carouser');
    await expect.poll(() => posted(page).then((p) => p.length), { timeout: 12_000 }).toBe(1);
    const ev = (await posted(page))[0];
    expect(ev).toMatchObject({ eventType: 'shadow_drop', eventKey: 'the_carouser', eventLabel: 'claimed the Shadow of The Carouser', eventValue: null, rarity: null, clientEventId: 'shadow:the_carouser' });
    expect(ev.eventLabel).toBe('claimed the Shadow of ' + SERVER_BOSSES.the_carouser);
    // a second ceremony for an owned boss says nothing
    await page.evaluate(() => (window as any).__arise('the_carouser'));
    await page.waitForTimeout(5500);
    expect((await posted(page)).length).toBe(1);
  });

  test('the announcement does not wait for the seal: a hunter who closes the app mid-ceremony is still announced', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => (window as any).__arise('the_steel_wolf'));
    await expect(page.locator('.arise-overlay')).toBeVisible();
    expect(await page.evaluate(() => (window as any).__paeQueuePeek())).toContain('shadow_drop:shadow:the_steel_wolf');
    expect(await shadows(page)).toEqual(['the_steel_wolf']);
  });

  test('reduced motion has no ceremony and no seal, and still announces', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await boot(page);
    await page.evaluate(() => (window as any).__arise('the_insomniac'));
    await expect(page.locator('.arise-overlay')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__paeQueuePeek())).toContain('shadow_drop:shadow:the_insomniac');
    expect(await shadows(page)).toEqual(['the_insomniac']);
  });

  test('every solo boss can announce its shadow under the server\'s rules, Erebus included', async ({ page }) => {
    test.setTimeout(60_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await boot(page);
    await catchPosts(page);
    const ids = await page.evaluate(() => (window as any).__shadowSoloIds() as string[]);
    expect(ids.length).toBeGreaterThanOrEqual(29);
    expect(ids).toContain('erebus_the_shadow_sovereign');
    for (const id of ids) {
      await page.evaluate((id) => (window as any).__arise(id), id);
    }
    await expect.poll(() => posted(page).then((p) => p.length), { timeout: 30_000 }).toBe(ids.length);
    const refused = (await posted(page)).filter((e) =>
      e.eventLabel !== 'claimed the Shadow of ' + SERVER_BOSSES[e.eventKey] || e.clientEventId !== 'shadow:' + e.eventKey);
    expect(refused).toEqual([]);
    expect(Object.keys(SERVER_BOSSES).sort()).toEqual(ids.slice().sort());   // W1118 — the two lists cannot drift
    expect((await posted(page)).find((e) => e.eventKey === 'erebus_the_shadow_sovereign').eventLabel).toBe('claimed the Shadow of Erebus, the Shadow Sovereign');
  });

  test('another hunter sees the shadow: folded chip, opened row, and what it is worth', async ({ page }) => {
    const now = Date.now();
    const row = (id: string, alias: string, key: string, boss: string, at: number) => ({
      id, alias, rankLabel: 'C I', eventType: 'shadow_drop', eventKey: key, eventLabel: 'claimed the Shadow of ' + boss,
      eventValue: null, rarity: null, createdAt: new Date(at).toISOString(), likes: 0, liked: false, likers: [], likedAt: null,
    });
    await boot(page, [
      row('s1', 'Justin', 'the_ascendant_colossus', 'The Ascendant Colossus', now),
      row('s2', 'RenDIESEL', 'erebus_the_shadow_sovereign', 'Erebus, the Shadow Sovereign', now - 1000),
    ]);
    await page.evaluate(() => document.getElementById('tab-social')!.click());
    await page.evaluate(() => (document.querySelector('[data-cm-pane="friends"]') as HTMLElement).click());
    await expect(page.locator('#guildhall-activity-section .board-h2')).toHaveText('Hunter Activity');   // W1118 — not only friends now
    await page.locator('.fa-dh').first().click();
    const justin = page.locator('.fa-hunter').filter({ hasText: /justin/i });
    await expect(justin.locator('.fa-chip--sh')).toHaveText('Shadow of The Ascendant Colossus');
    await justin.locator('.fa-hh').click();
    const opened = justin.locator('.fa-act--shadow');
    await expect(opened).toHaveCount(1);
    await expect(opened.locator('.fa-ico--shadow')).toHaveText('✧');
    await expect(opened.locator('.fa-act-txt')).toHaveText('claimed the Shadow of The Ascendant Colossus');
    await expect(opened.locator('.fa-act-sub')).toHaveText('+1.25% in every Ascent fight');   // a C-rank boss
    const ren = page.locator('.fa-hunter').filter({ hasText: /rendiesel/i });
    await expect(ren.locator('.fa-chip--sh')).toHaveText('Shadow of Erebus, the Shadow Sovereign');
    await ren.locator('.fa-hh').click();
    await expect(ren.locator('.fa-act-sub')).toHaveText('+2% in every Ascent fight');          // an S-rank boss
  });
});
