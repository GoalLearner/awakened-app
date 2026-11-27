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
    // W1283 — all three events stay on one day: CI at 00:01 put the event two minutes back on the day before (b7b82a8 red).
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    const now = Math.max(Date.now(), midnight.getTime() + 5 * 60_000);
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

// W1307 — owner 2026-11-24: "Galilea had all these kills but no drop, is this because they're duplicates and sold for
// souls?" -> "Yeah it would give hunters more information as they play the game". Only the first copy of each relic
// used to post; every later rare, ultra-rare and mythic copy now posts too, and a rare past its cap names its souls.
test.describe('Repeat drops in Hunter Activity (W1307)', () => {
  test('every repeat rare, ultra-rare and mythic posts under a fresh id; a rare past its cap carries its souls; a first find waits for its reveal; commons stay off', async ({ page }) => {
    await boot(page);
    await catchPosts(page);
    const r = await page.evaluate(() => {
      const w = window as any, D = w.Drops, C = D.CARDS;
      const by: Record<string, { rare: string[]; ultra: string[] }> = {};
      Object.keys(C).forEach((id) => {
        const c = C[id]; if (!c.source_boss) return;
        const b = (by[c.source_boss] = by[c.source_boss] || { rare: [], ultra: [] });
        if (c.rarity === 'rare') b.rare.push(id); if (c.rarity === 'ultra_rare') b.ultra.push(id);
      });
      const own = (ids: string[], n: number) => ids.forEach((id) => { D.state.cards[id] = { ...(D.state.cards[id] || {}), discovered: n > 0, count: n, first_acquired_date: n > 0 ? '2026-11-01' : null }; });
      const seen = () => (w.__paeQueuePeek() as string[]).length + ((w.__posted || []) as unknown[]).length;
      for (const boss of Object.keys(by)) {
        const b = by[boss]; if (!b.rare.length || !b.ultra.length) continue;
        own(b.rare, 0);
        const before = seen();
        const first = D.rollBossDrop(boss, { dropTable: { rare: 1 } });
        if (!first) continue;   // a boss the solo roll does not know
        const firstPosts = seen() - before;
        D.state.reveal_queue.length = 0;   // the reveal (and its own post) is not this test's
        own(b.rare, 3);
        const sold = D.rollBossDrop(boss, { dropTable: { rare: 1 } });
        own(b.rare, 1);
        const kept = D.rollBossDrop(boss, { dropTable: { rare: 1 } });
        own(b.ultra, 1);
        const ultra = D.rollBossDrop(boss, { dropTable: { ultra_rare: 1 } });
        const common = Object.keys(C).find((id) => C[id].rarity === 'common');
        w.__postRepeatDrop(C[common!], 120);
        for (const id of ['nightfall_blade', 'reverie_staff', 'vigil_bow']) { w.__postRepeatDrop(C[id], 0); w.__postRepeatDrop(C[id], 0); }
        return { first: first.wasFirst, firstPosts, sold: [sold.wasCapped, sold.soldFor], kept: [kept.wasCapped, kept.wasFirst], ultra: [ultra.card.rarity, ultra.wasFirst] };
      }
      return null;
    });
    expect(r).not.toBeNull();
    expect(r!.first).toBe(true);
    expect(r!.firstPosts).toBe(0);   // the first copy posts from its reveal, as before
    expect(r!.sold[0]).toBe(true);
    expect(r!.sold[1]).toBeGreaterThan(0);
    expect(r!.kept).toEqual([false, false]);
    expect(r!.ultra).toEqual(['ultra_rare', false]);
    await expect.poll(() => page.evaluate(() => ((window as any).__posted as unknown[]).length), { timeout: 15_000 }).toBe(9);
    const posted = await page.evaluate(() => (window as any).__posted as any[]);
    const rares = posted.filter((e) => e.eventType === 'rare_item_drop');
    expect(rares.map((e) => [e.eventKey, e.eventLabel, e.rarity])).toEqual([['rare', 'found a rare item', null], ['rare', 'found a rare item', null]]);
    expect(rares.map((e) => e.eventValue)).toEqual([r!.sold[1], null]);
    const ultras = posted.filter((e) => e.eventType === 'ultra_rare_drop');
    expect(ultras.map((e) => [e.eventKey, e.eventLabel, e.eventValue, e.rarity])).toEqual([['ultra_rare', 'looted an ultra-rare item', null, null]]);
    const my = posted.filter((e) => e.eventType === 'mythic_drop');
    expect(my).toHaveLength(6);
    for (const e of my) {
      expect(e.eventLabel).toBe('found ' + SERVER_MYTHICS[e.eventKey]);
      expect(e.clientEventId).toMatch(/^mythic:[A-Za-z0-9_\-]{4,64}$/);
    }
    expect(posted.every((e) => /^[A-Za-z0-9_:\-]{1,128}$/.test(e.clientEventId))).toBe(true);
    expect(new Set(posted.map((e) => e.clientEventId)).size).toBe(9);   // every drop its own post
  });

  test('a sold rare names its souls, and a hunter\'s items fold into one chip per kind, ultra-rare first', async ({ page }) => {
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    const now = Math.max(Date.now(), midnight.getTime() + 5 * 60_000);
    const rare = { eventKey: 'rare', eventLabel: 'found a rare item' };
    await boot(page, [
      ev('b1', 'Galilea', 'boss_kill', now, false),
      ev('r1', 'Galilea', 'rare_item_drop', now - 10_000, false, { ...rare, eventValue: 1450 }),
      ev('r2', 'Galilea', 'rare_item_drop', now - 20_000, false, rare),
      ev('u1', 'Galilea', 'ultra_rare_drop', now - 30_000, false),
      ev('r3', 'Galilea', 'rare_item_drop', now - 40_000, false, rare),
    ]);
    await openFeed(page);
    const gal = page.locator('.fa-hunter').filter({ has: page.locator('.fa-hn[data-board-profile="Galilea"]') });
    await expect(gal).toHaveCount(1);
    const chips = gal.locator('.fa-hs .fa-chip');
    await expect(chips).toHaveCount(3);
    await expect(chips.nth(0)).toContainText('The Carouser');
    await expect(chips.nth(1)).toHaveText('ultra-rare item');
    await expect(chips.nth(2)).toHaveText('3 rare items');
    await gal.locator('.fa-hh').click();
    // W1321 — in groups: the boss, then the drops (the ultra-rare first); a drop reads as the item, its souls a tag
    await expect(gal.locator('.fa-sec')).toHaveText(['Bosses1', 'Drops4']);
    const sold = gal.locator('.fa-act-txt').filter({ has: page.locator('.fa-souls') });
    await expect(sold).toHaveCount(1);
    await expect(sold).toHaveText('Rare item+1,450 souls');
    await expect(sold.locator('.fa-souls')).toHaveText('+1,450 souls');
    await expect(gal.locator('.fa-act-txt').filter({ hasText: /^Rare item$/ })).toHaveCount(2);
    await expect(gal.locator('.fa-act .fa-act-txt')).toHaveText([/The Carouser/, 'Ultra-rare item', 'Rare item+1,450 souls', 'Rare item', 'Rare item']);
    await expect(gal.locator('.fa-like').first()).toHaveText('♡');
    await expect(gal.locator('.fa-like').first()).toHaveAttribute('aria-label', 'Like');
  });
});

// W1321 — owner 2026-11-25 (RenDIESEL's day: 13 rows of kills, ultra-rares and sold rares mixed): "let's organize this so
// it looks more organized and aesthetic instead of all randomly". Bosses strongest first, then the drops, each a group.
test.describe('W1321 — an opened hunter, organized', () => {
  for (const vp of [{ width: 390, height: 844 }, { width: 375, height: 667 }]) {
    test('bosses by rank, then drops (ultra-rare first, sold souls as a tag), a heart for the like @' + vp.width, async ({ page }) => {
      await page.setViewportSize(vp);
      const m = 60_000, midnight = new Date(); midnight.setHours(0, 0, 0, 0);
      const now = Math.max(Date.now(), midnight.getTime() + 25 * m);   // minutes apart, one day: run just after midnight (CI = UTC), the 20-minute-old rows would land on yesterday
      const kill = (id: string, name: string, rk: string, at: number) => ev(id, 'RenDIESEL', 'boss_kill', at, false, { eventKey: id, eventLabel: 'defeated ' + name, rarity: rk });
      const rare = (id: string, at: number, sold: number) => ev(id, 'RenDIESEL', 'rare_item_drop', at, false, { eventKey: 'rare', eventLabel: 'found a rare item', eventValue: sold });
      await boot(page, [
        kill('k1', 'The Steel Wolf', 'E', now - 2 * m), ev('u1', 'RenDIESEL', 'ultra_rare_drop', now - 2 * m, false),
        kill('k2', 'The Carouser', 'E', now - 2 * m), kill('k3', 'The Glass Strider', 'D', now - 2 * m),
        ev('u2', 'RenDIESEL', 'ultra_rare_drop', now - 2 * m, false), kill('k4', 'The Marathon Wraith', 'C', now - 2 * m),
        kill('k5', 'The Ascendant Colossus', 'C', now - 2 * m), rare('r1', now - 2 * m, 420), kill('k6', 'The Unbroken Anvil', 'A', now - 2 * m),
        rare('r2', now - 20 * m, 160), kill('k7', 'The Threefold Court', 'C', now - 20 * m), rare('r3', now - 20 * m, 160),
        kill('k8', 'The Gaunt Wardens', 'C', now - 20 * m),
      ]);
      await openFeed(page);
      const ren = page.locator('.fa-hunter').filter({ has: page.locator('.fa-hn[data-board-profile="RenDIESEL"]') });
      await ren.locator('.fa-hh').click();
      await expect(ren.locator('.fa-sec')).toHaveText(['Bosses8', 'Drops5']);
      const ranks = await ren.locator('.fa-act .guildhall-boss-sub-rank').allTextContents();
      expect(ranks).toEqual(['A', 'C', 'C', 'C', 'C', 'D', 'E', 'E']);
      const drops = ren.locator('.fa-sec--it ~ .fa-act .fa-act-txt');
      await expect(drops).toHaveText(['Ultra-rare item', 'Ultra-rare item', 'Rare item+420 souls', 'Rare item+160 souls', 'Rare item+160 souls']);
      // the drop rows (they wrapped to two lines before) stay on one line; a long boss name may wrap with the CI's fonts.
      // The like is a heart.
      const tall = await ren.locator('.fa-sec--it ~ .fa-act').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height > 40).length);
      expect(tall).toBe(0);
      await expect(ren.locator('.fa-like')).toHaveCount(13);
      await expect(ren.locator('.fa-like').first()).toHaveText('♡');
      if (process.env.LB_SHOTS) { await ren.scrollIntoViewIfNeeded(); await ren.screenshot({ path: process.env.LB_SHOTS + '/feed-organized-' + vp.width + '.png' }); }
    });
  }

  // W1322 — owner: "What about Shadows, New rank ups, slept over 7 hours, walked 10,000 steps, verified workout, etc."
  for (const vp of [{ width: 390, height: 844 }, { width: 375, height: 667 }]) {
    test('every kind has its group: Shadows, Milestones, Bosses, Drops, Health @' + vp.width, async ({ page }) => {
      await page.setViewportSize(vp);
      const m = 60_000, midnight = new Date(); midnight.setHours(0, 0, 0, 0);
      const now = Math.max(Date.now(), midnight.getTime() + 25 * m);   // one day, even just after midnight (CI = UTC)
      const e = (id: string, type: string, label: string, at: number, extra: Record<string, unknown> = {}) => ev(id, 'Galilea', type, at, false, { eventKey: id, eventLabel: label, eventValue: null, rarity: null, ...extra });
      await boot(page, [
        e('st1', 'step_milestone_bucket', 'crossed 10,000 steps today', now - 1 * m, { eventValue: 10000 }),
        e('ru1', 'rank_up', 'reached A II', now - 2 * m),
        e('sl1', 'verified_sleep_7h', 'slept over 7 hours last night', now - 3 * m),
        ev('bk1', 'Galilea', 'boss_kill', now - 4 * m, false, { eventKey: 'the_unbroken_anvil', eventLabel: 'defeated The Unbroken Anvil', rarity: 'A' }),
        e('wk1', 'verified_workout', 'completed a verified workout', now - 5 * m),
        e('sh1', 'shadow_drop', 'claimed the Shadow of The Steel Wolf', now - 6 * m, { eventKey: 'the_steel_wolf' }),
        e('pd1', 'perfect_day', 'sealed a 7-day Perfect streak', now - 7 * m, { eventValue: 7 }),
        ev('ur1', 'Galilea', 'ultra_rare_drop', now - 8 * m, false),
        e('fl1', 'flights_milestone_bucket', 'climbed 10 flights today', now - 9 * m, { eventValue: 10 }),
        e('vs1', 'verified_streak', 'reached a 7-day verified streak', now - 10 * m, { eventValue: 7 }),
      ]);
      await openFeed(page);
      const gal = page.locator('.fa-hunter').filter({ has: page.locator('.fa-hn[data-board-profile="Galilea"]') });
      await gal.locator('.fa-hh').click();
      await expect(gal.locator('.fa-sec')).toHaveText(['Shadows1', 'Milestones2', 'Bosses1', 'Drops1', 'Health5']);
      const ids = await gal.locator('.fa-act').evaluateAll((els) => els.map((x) => x.getAttribute('data-fa-ev')));
      expect(ids).toEqual(['sh1', 'ru1', 'pd1', 'bk1', 'ur1', 'wk1', 'sl1', 'vs1', 'st1', 'fl1']);
      // each row reads as the thing itself, on one line
      await expect(gal.locator('.fa-sec--ms ~ .fa-act .fa-act-txt').first()).toHaveText('Reached A II');
      await expect(gal.locator('.fa-act--shadow .fa-act-txt')).toHaveText('Shadow of The Steel Wolf');
      const txt = await gal.locator('.fa-act .fa-act-txt').allTextContents();
      expect(txt.slice(2)).toEqual(['7-day Perfect streak', 'AThe Unbroken Anvil',   // the rank chip's letter leads the boss row
         'Ultra-rare item', 'Verified workout ✓', 'Slept over 7 hours ✓', '7-day verified streak ✓', '10,000 steps', '10 flights']);
      const tall = await gal.locator('.fa-act:not(.fa-act--shadow)').evaluateAll((els) => els.filter((x) => x.getBoundingClientRect().height > 40).length);
      expect(tall).toBe(0);
      if (process.env.LB_SHOTS) { await gal.scrollIntoViewIfNeeded(); await gal.screenshot({ path: process.env.LB_SHOTS + '/feed-all-kinds-' + vp.width + '.png' }); }
    });
  }

  test('one kind only: no group label', async ({ page }) => {
    const now = Date.now();
    await boot(page, [ev('b1', 'Galilea', 'boss_kill', now, false), ev('b2', 'Galilea', 'boss_kill', now - 5000, false)]);
    await openFeed(page);
    const gal = page.locator('.fa-hunter').filter({ has: page.locator('.fa-hn[data-board-profile="Galilea"]') });
    await gal.locator('.fa-hh').click();
    await expect(gal.locator('.fa-act')).toHaveCount(2);
    await expect(gal.locator('.fa-sec')).toHaveCount(0);
  });
});
