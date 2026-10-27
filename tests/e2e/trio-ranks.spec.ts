/**
 * Awakened — a steps trio at every rank D to A (W1104), client side.
 *
 * Owner 2026-10-27: D 16,000 · C 21,000 (the Threefold Court, was 27,000) · B 24,000 ·
 * A 27,000, three hunters, 24 hours. These specs pin:
 *   - each trio's sheet: its name, rank, goal and the trio mode;
 *   - every trio has its own portrait and summons picture, and both load;
 *   - each new trio drops only relics of its own rank (its gate's pool).
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
      localStorage.setItem('hb_habits', '[]');
      localStorage.setItem('hb_whats_new_seen', '99.99.99');
      localStorage.setItem('hb_onboarding_first_xp_date', '2026-01-01');
    } catch (_) { /* noop */ }
  });
  await page.goto('/');
  await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });
}

const TRIOS = [
  { id: 'the_crossroads_hound', name: 'The Crossroads Hound', rank: 'D', goal: '16,000', fresh: true },
  { id: 'the_threefold_court',  name: 'The Threefold Court',  rank: 'C', goal: '21,000', fresh: false },
  { id: 'the_triune_sentinel',  name: 'The Triune Sentinel',  rank: 'B', goal: '24,000', fresh: true },
  { id: 'the_trinity_colossus', name: 'The Trinity Colossus', rank: 'A', goal: '27,000', fresh: true },
];

test.describe('A steps trio at every rank (W1104)', () => {
  test('each trio opens on its name, rank and goal', async ({ page }) => {
    await boot(page);
    for (const t of TRIOS) {
      await page.evaluate((id) => (window as any).openCoopSheet(id), t.id);
      await expect(page.locator('#coop-fs-name')).toHaveText(t.name);
      await expect(page.locator('#coop-fs-rank')).toHaveText(t.rank);
      await expect(page.locator('#coop-fs-body .coop-goal-big')).toHaveText(t.goal);
      await page.evaluate(() => (window as any).closeCoopSheet());
    }
  });

  test('every trio has its own portrait and summons picture, and both load', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async (ids) => {
      const out: Array<{ path: string; ok: boolean }> = [];
      for (const id of ids) {
        const portrait = (window as any).__bossArt.path(id);
        for (const path of [portrait, portrait.replace(/\.png$/, '-summons.png')]) {
          let ok = false;
          try { const res = await fetch(path, { cache: 'no-store' }); ok = res.ok && (res.headers.get('content-type') || '').indexOf('image') >= 0; } catch (_) { /* not ok */ }
          out.push({ path, ok });
        }
      }
      return out;
    }, TRIOS.map((t) => t.id));
    expect(r.map((x) => x.path)).toEqual([
      'assets/bosses/the-crossroads-hound.png', 'assets/bosses/the-crossroads-hound-summons.png',
      'assets/bosses/the-threefold-court.png', 'assets/bosses/the-threefold-court-summons.png',
      'assets/bosses/the-triune-sentinel.png', 'assets/bosses/the-triune-sentinel-summons.png',
      'assets/bosses/the-trinity-colossus.png', 'assets/bosses/the-trinity-colossus-summons.png',
    ]);
    expect(r.filter((x) => !x.ok)).toEqual([]);
  });

  test('each new trio drops only relics of its own rank', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate((ids) => {
      const w = window as any;
      const out: Record<string, { tiers: string[]; drops: number }> = {};
      for (const id of ids) {
        const tiers = new Set<string>(); let drops = 0;
        for (let i = 0; i < 80; i++) {
          const c = w.Drops.rollBossDrop(id, { pity: null });
          if (c && c.card) { drops++; tiers.add(c.card.tier); }
        }
        out[id] = { tiers: Array.from(tiers), drops };
      }
      return out;
    }, TRIOS.filter((t) => t.fresh).map((t) => t.id));
    expect(r.the_crossroads_hound.tiers).toEqual(['D']);
    expect(r.the_triune_sentinel.tiers).toEqual(['B']);
    expect(r.the_trinity_colossus.tiers).toEqual(['A']);
    for (const k of Object.keys(r)) expect(r[k].drops).toBeGreaterThan(20);
  });
});
