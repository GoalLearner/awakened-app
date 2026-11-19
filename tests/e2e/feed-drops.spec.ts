/**
 * Awakened — mythic drops in Hunter Activity, and the crown on names (W1229, W1230).
 *
 * Owner 2026-11-16: "Make sure mythics have their own announcement as well on hunter activity" → a
 * mythic weapon is its own gold row at the top of its day, for every hunter. W1230: "I didn't want
 * ultra rares to appear only mythics" → the server reads strangers' mythic_drop only, so there is no
 * ultra-rare fold (a friend's ultra-rare stays in the friend's row, as before). The server takes a
 * mythic_drop only under the weapon's exact name, so the names are read from the backend here.
 * And: "me and rendiesel should have a crown next to our name and we don't here" (the profile card)
 * → "Even here too" (Hunter Activity).
 */
import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';

const BACKEND = readFileSync(join(__dirname, '../../backend/src/handlers/public-achievement-events.ts'), 'utf8');
function backendMythicNames(): Record<string, string> {
  const block = /const MYTHIC_DROP_NAMES[^=]*= \{([\s\S]*?)\n\};/.exec(BACKEND);
  if (!block) throw new Error('MYTHIC_DROP_NAMES not found in the backend');
  const out: Record<string, string> = {};
  for (const m of block[1].matchAll(/^\s*([a-z0-9_]+): "(.+)",$/gm)) out[m[1]] = m[2];
  return out;
}
const SERVER_MYTHICS = backendMythicNames();
const ROSTER = [{ alias: 'Richie', role: 'owner' }, { alias: 'RenDIESEL', role: 'mod' }];

async function boot(page: Page, events: unknown[] = []) {
  await page.addInitScript(([evs, roster]) => {
    try {
      ['hb_onboarding_seen_v2', 'hb_welcomed', 'hb_hunter_name_claimed', 'hb_cloud_restore_dismissed'].forEach((k) => localStorage.setItem(k, '1'));
      localStorage.setItem('hb_habits', '[]');
      localStorage.setItem('hb_whats_new_seen', '99.99.99');
      const d = new Date();
      const ymd = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      localStorage.setItem('hb_fri_banner_' + ymd, '1'); localStorage.setItem('hb_fri_banner_' + new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date()), '1');
      localStorage.setItem('hb_daily_insight_last_shown', ymd);
      localStorage.setItem('hb_fa_seen_ts', String(Date.now()));
      localStorage.setItem('hb_friends_activity_cache_v1', JSON.stringify({ ts: Date.now(), events: evs }));
      localStorage.setItem('hb_crown_roster_v1', JSON.stringify({ at: Date.now(), list: roster }));
    } catch (_) {}
  }, [events, ROSTER] as [unknown[], unknown[]]);
  await page.goto('/');
  await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });
}
async function openFeed(page: Page) {
  await page.evaluate(() => document.getElementById('tab-social')!.click());
  await page.evaluate(() => (document.querySelector('[data-cm-pane="friends"]') as HTMLElement).click());
  await page.locator('.fa-dh').first().click();
}
const ev = (id: string, alias: string, type: string, at: number, stranger: boolean, extra: Record<string, unknown> = {}) => ({
  id, alias, rankLabel: 'C I', eventType: type,
  eventKey: type === 'ultra_rare_drop' ? 'ultra_rare' : type === 'mythic_drop' ? 'nightfall_blade' : 'the_carouser',
  eventLabel: type === 'ultra_rare_drop' ? 'looted an ultra-rare item' : type === 'mythic_drop' ? 'found ' + SERVER_MYTHICS.nightfall_blade : 'defeated The Carouser',
  eventValue: type === 'boss_kill' ? 1 : null, rarity: type === 'boss_kill' ? 'E' : null,
  createdAt: new Date(at).toISOString(), likes: 0, liked: false, likers: [], likedAt: null,
  ...(stranger ? { stranger: true } : {}), ...extra,
});
// The dev session never posts (_stubGate), so stand in at the one call that would.
const catchPosts = (page: Page) => page.evaluate(() => {
  const w = window as any;
  w.__posted = [];
  w.Auth.submitPublicAchievementEvents = (events: unknown[]) => { w.__posted.push(...events); return Promise.resolve({ ok: true, insertedCount: events.length, duplicateCount: 0 }); };
  const me = w.Auth.getCurrentUser() || {};
  w.Auth.getCurrentUser = () => ({ ...me, jwt: me.jwt || 'x' });
});

test.describe('Mythic drops in Hunter Activity (W1229 · W1230)', () => {
  test('a mythic reveal posts one mythic_drop the server accepts, for each of the three weapons; an ultra-rare posts no mythic', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await boot(page);
    const cat = await page.evaluate(() => { const C = (window as any).Drops.CARDS; return Object.keys(C).filter((k) => C[k].rarity === 'mythic').map((k) => ({ id: k, name: C[k].name })); });
    expect(cat.map((c) => c.id).sort()).toEqual(Object.keys(SERVER_MYTHICS).sort());   // the two lists cannot drift
    for (const c of cat) expect(c.name, c.id).toBe(SERVER_MYTHICS[c.id]);
    await catchPosts(page);
    for (const id of ['nightfall_blade', 'reverie_staff', 'vigil_bow', 'crown_of_eternal_night']) {
      await page.evaluate((id) => (window as any).__openCardReveal(id), id);
      await page.evaluate(() => { const o = document.getElementById('reveal-overlay'); if (o) o.classList.add('hidden'); });
    }
    await expect.poll(() => page.evaluate(() => ((window as any).__posted as any[]).filter((e) => e.eventType === 'mythic_drop').length), { timeout: 15_000 }).toBe(3);
    const my = (await page.evaluate(() => (window as any).__posted as any[])).filter((e) => e.eventType === 'mythic_drop');
    for (const e of my) {
      expect(e.eventLabel).toBe('found ' + SERVER_MYTHICS[e.eventKey]);
      expect(e.clientEventId).toMatch(/^mythic:[A-Za-z0-9_\-]{4,64}$/);
      expect([e.eventValue, e.rarity]).toEqual([null, null]);
    }
    expect(my.map((e) => e.eventKey).sort()).toEqual(['nightfall_blade', 'reverie_staff', 'vigil_bow']);
    // the ultra-rare still posts its own fixed, nameless event
    const ultra = (await page.evaluate(() => (window as any).__posted as any[])).filter((e) => e.eventType === 'ultra_rare_drop');
    expect(ultra.map((e) => e.eventLabel)).toEqual(['looted an ultra-rare item']);
  });

  test('the feed asks the server for every hunter\'s drops', async ({ page }) => {
    await boot(page);
    const src = await page.evaluate(() => String((window as any).Auth.fetchFriendsActivity));
    expect(src).toContain("'&drops=1'");
  });

  test('a mythic drop is its own gold row at the top of its day, naming the weapon and the hunter, a friend\'s too', async ({ page }) => {
    const now = Date.now();
    await boot(page, [
      ev('b1', 'Galilea', 'boss_kill', now, false),
      ev('m1', 'Galilea', 'mythic_drop', now - 60_000, false),
      ev('m2', 'Mercury', 'mythic_drop', now - 120_000, true, { eventKey: 'vigil_bow', eventLabel: 'found ' + SERVER_MYTHICS.vigil_bow }),
    ]);
    await openFeed(page);
    const rows = page.locator('.fa-day').first().locator('.fa-dbody > .fa-hunter');
    await expect(rows.nth(0)).toHaveClass(/fa-hunter--mythic/);
    await expect(rows.nth(1)).toHaveClass(/fa-hunter--mythic/);
    await expect(page.locator('.fa-hunter--mythic')).toHaveCount(2);
    const first = page.locator('.fa-hunter--mythic').first();
    await expect(first.locator('.fa-hn')).toHaveText('Mythic drop');
    await expect(first.locator('.fa-chip--my')).toHaveText('Nightfall');
    await expect(first.locator('.fa-chip--who')).toHaveText('galilea');
    await expect(page.locator('.fa-hunter--mythic').nth(1).locator('.fa-chip--my')).toHaveText('Vigil');
    await first.locator('.fa-hh').click();
    const act = first.locator('.fa-act--mythic');
    await expect(act).toHaveCount(1);
    await expect(act.locator('.fa-ico--mythic')).toHaveText('✦');
    await expect(act.locator('.fa-act-txt')).toHaveText('galilea found Nightfall, Blade of the Shadow Sovereign');
    await expect(act.locator('.fa-like')).toHaveCount(1);
    // Galilea's own row keeps her kill and never repeats the mythic
    const gal = page.locator('.fa-hunter').filter({ has: page.locator('.fa-hn[data-board-profile="Galilea"]') });
    await expect(gal).toHaveCount(1);
    await expect(gal.locator('.fa-num')).toHaveText('1');
    // the day stack leads with the gold mythic mark
    await expect(page.locator('.fa-day').first().locator('.fa-stack .fa-mini').first()).toHaveText('✦');
    await page.evaluate(() => { const o = document.querySelector('.fa-hunter--mythic') as HTMLElement; o.scrollIntoView(); });
  });

  // W1241 — owner 2026-11-18: "If a team completes a grinning god raid, it gets put on the friend's activity to be
  // recognized by everyone". The server posts it (official:raid:<id>) under the MVP, naming the party.
  test('W1241 — a raid team\'s win is its own gold row: Raid cleared, the boss, the party size, the names', async ({ page }) => {
    const now = Date.now();
    await boot(page, [
      ev('b1', 'Galilea', 'boss_kill', now, false),
      ev('r1', 'Techniz', 'raid_won', now - 30_000, true, { eventKey: 'the_grinning_god', eventLabel: 'defeated The Grinning God with Amanda, Anducal, Angelo, Galilea and Renaldo', eventValue: 6, rarity: 'S' }),
    ]);
    await openFeed(page);
    const raid = page.locator('.fa-hunter--raid');
    await expect(raid).toHaveCount(1);
    const SHOT = process.env.FD_SHOTS || '';
    if (SHOT) { await page.setViewportSize({ width: 390, height: 844 }); await raid.scrollIntoViewIfNeeded(); await page.waitForTimeout(300); await page.screenshot({ path: SHOT + '/raid-feed-closed.png' }); }
    await expect(raid.locator('.fa-hn')).toHaveText('Raid cleared');
    await expect(raid.locator('.fa-chip--my')).toHaveText('The Grinning God');
    await expect(raid.locator('.fa-chip--mvp')).toHaveText('technizMVP');   // W1242 — the MVP beside their name
    await expect(raid.locator('.fa-chip--n')).toHaveText('6 hunters');
    await raid.locator('.fa-hh').click();
    const act = raid.locator('.fa-act');
    await expect(act.locator('.fa-ico--mythic')).toHaveText('♛');
    await expect(act.locator('.fa-act-txt')).toHaveText('technizMVP defeated The Grinning God with Amanda, Anducal, Angelo, Galilea and Renaldo');
    await expect(act.locator('.fa-who + .fa-mvp')).toHaveText('MVP');   // W1242
    await expect(act.locator('.fa-like')).toHaveCount(1);
    await expect(page.locator('.fa-day').first().locator('.fa-stack .fa-mini').first()).toHaveText('♛');
    if (SHOT) { await page.waitForTimeout(300); await page.screenshot({ path: SHOT + '/raid-feed-open.png' }); }
  });

  test('the crown rides Richie\'s and RenDIESEL\'s names in Hunter Activity, and no one else\'s', async ({ page }) => {
    const now = Date.now();
    await boot(page, [
      ev('b1', 'RenDIESEL', 'boss_kill', now, false),
      ev('b2', 'Richie', 'boss_kill', now - 1000, false),
      ev('b3', 'Galilea', 'boss_kill', now - 2000, false),
    ]);
    await openFeed(page);
    const name = (a: string) => page.locator('.fa-hn[data-board-profile="' + a + '"]');
    await expect(name('RenDIESEL').locator('.name-crown')).toHaveCount(1);
    await expect(name('Richie').locator('.name-crown')).toHaveCount(1);
    await expect(name('Galilea').locator('.name-crown')).toHaveCount(0);
    await expect(name('RenDIESEL')).toHaveText('rendiesel');   // the crown is a picture, the name reads the same
  });

  test('the crown rides the username on the profile card, own and visited, and no one else\'s; no badge-row crown comes back', async ({ page }) => {
    await boot(page);
    const card = (alias: string, own: boolean) => page.evaluate(([a, o]) => (window as any).__pcRender({ alias: a, rankLabel: 'S I', power: 5877, bossesSlain: 377, avgStepsPerDay: 5217, ultraRareDropsTotal: 24, bestFloor: 100 }, o), [alias, own] as [string, boolean]);
    await card('RenDIESEL', false);
    const alias = page.locator('#pc-body .pc-alias');
    await expect(alias).toHaveText('rendiesel');
    await expect(alias.locator('.name-crown')).toHaveCount(1);
    await card('Richie', true);
    await expect(alias.locator('.name-crown')).toHaveCount(1);
    await card('Galilea', false);
    await expect(alias.locator('.name-crown')).toHaveCount(0);
    expect(await page.evaluate(() => document.querySelectorAll('.pc-crown, .board-av-crown').length)).toBe(0);
  });
});
