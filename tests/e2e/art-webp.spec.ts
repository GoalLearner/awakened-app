/**
 * Awakened — the relic and boss paintings ship as WebP (W1192).
 *
 * Owner 2026-11-12: downloads stopped. The app was 376.9 MB on the App Store, over Apple's 200 MB cellular-download
 * prompt, and 290 MB of it was PNG art. The same paintings, same pixel size, as WebP: 23 MB. Pinned here:
 *   - every painting the app names (each relic's art, every solo and co-op boss, the co-op summons art) loads, as WebP,
 *     and no catalog still points at a .png;
 *   - a path saved before the change (drop history, a friend's card) still finds its painting: an <img> on an old
 *     .png path swaps to the .webp beside it and shows, even when it carries its own "hide me on error" handler;
 *   - the iOS build copies the WebP files (a build that copied *.png would ship with no art at all).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test.use({ viewport: { width: 390, height: 844 } });

test.describe('W1192 — the paintings ship as WebP', () => {
  test('every relic, boss and summons painting the app names loads as WebP; no catalog points at a .png', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!(window as any).Drops && !!(window as any).__bossArt && !!(window as any).Bosses);
    const r = await page.evaluate(async () => {
      const w = window as any;
      const paths = new Set<string>();
      Object.values(w.Drops.CARDS).forEach((c: any) => { if (c && c.art_path) paths.add(c.art_path); });
      Object.keys(w.Bosses.BOSSES).forEach((id) => { const p = w.__bossArt.path(id); if (/assets\/bosses\//.test(p)) paths.add(p); });
      w.__bossArt.coopIds().forEach((id: string) => paths.add(w.__bossArt.path(id)));
      paths.add('assets/bosses/the-twin-maw-summons.webp');
      const bad: string[] = [], png: string[] = [];
      for (const p of paths) {
        if (/\.png$/.test(p) && /assets\/(items|bosses)\//.test(p)) png.push(p);
        const res = await fetch(p, { cache: 'no-store' });
        const type = res.headers.get('content-type') || '';
        if (!res.ok || type.indexOf('image/webp') < 0) bad.push(p + ' → ' + res.status + ' ' + type);
      }
      return { n: paths.size, bad, png };
    });
    expect(r.n).toBeGreaterThan(150);   // 109 relics, the solo and co-op bosses
    expect(r.png).toEqual([]);
    expect(r.bad).toEqual([]);
  });

  test('an old .png path still finds its painting, even with its own hide-on-error handler', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!(window as any).Drops);
    await page.evaluate(() => {
      const box = document.createElement('div');
      box.innerHTML = '<img id="old-relic" src="assets/items/vow_ring.png" onerror="this.style.visibility=\'hidden\'">' +
        '<img id="old-boss" src="assets/bosses/the-steel-wolf.png" onerror="this.style.display=\'none\'">';
      document.body.appendChild(box);
    });
    for (const id of ['old-relic', 'old-boss']) {
      await expect.poll(() => page.evaluate((i) => { const im = document.getElementById(i) as HTMLImageElement; return im.complete && im.naturalWidth > 0 ? im.getAttribute('src') : ''; }, id), { timeout: 8000 }).toMatch(/\.webp$/);
      const st = await page.evaluate((i) => { const im = document.getElementById(i) as HTMLImageElement; return [getComputedStyle(im).visibility, getComputedStyle(im).display]; }, id);
      expect(st).toEqual(['visible', 'inline']);
    }
  });

  test('the iOS build copies the WebP files, and the repo ships no PNG paintings', async () => {
    const root = path.join(__dirname, '..', '..');
    const prep = fs.readFileSync(path.join(root, 'scripts', 'prep-local-build.sh'), 'utf8');
    expect(prep).toContain('cp assets/bosses/*.webp www/assets/bosses/');
    expect(prep).toContain('cp assets/items/*.webp www/assets/items/');
    expect(prep).not.toMatch(/cp assets\/(bosses|items)\/\*\.png/);
    for (const d of ['items', 'bosses']) {
      const files = fs.readdirSync(path.join(root, 'assets', d));
      expect(files.filter((f) => /\.png$/.test(f))).toEqual([]);
      expect(files.filter((f) => /\.webp$/.test(f)).length).toBeGreaterThan(d === 'items' ? 100 : 50);
    }
  });
});
