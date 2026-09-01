/**
 * cron-config.test.ts — W904 tripwire for wrangler.toml [triggers].crons.
 *
 * Cloudflare numbers weekdays 1 = Sunday … 7 = Saturday (NOT POSIX 0-6). The
 * update push ran on the every-5-minutes 16-17 UTC trigger with day-of-week
 * "1" — every SUNDAY — from 2026-07-16 to 2026-08-31 while its Monday gate
 * silently refused. Weekday fields must be NAMED, and the update trigger must
 * equal the constant the runtime journals against, so a config edit cannot
 * drift away from the code again.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { UPDATE_PUSH_CRON } from './update-push';

const HERE = dirname(fileURLToPath(import.meta.url));
const toml = readFileSync(join(HERE, '..', '..', 'wrangler.toml'), 'utf8');
const line = toml.split(/\r?\n/).find((l) => /^\s*crons\s*=/.test(l)) || '';
const crons: string[] = [];
const re = /"([^"]+)"/g;
let m: RegExpExecArray | null;
while ((m = re.exec(line))) crons.push(m[1]);

describe('wrangler.toml cron triggers (W904)', () => {
  it('has a crons line with at least the update trigger and the 2-minute sweep', () => {
    expect(crons.length).toBeGreaterThanOrEqual(2);
    expect(crons).toContain('*/2 * * * *');
  });

  it('declares the update-push trigger exactly as the runtime journals it', () => {
    expect(crons).toContain(UPDATE_PUSH_CRON);
  });

  it('never uses a bare number in the day-of-week field (1 = SUNDAY on Cloudflare)', () => {
    for (const c of crons) {
      const fields = c.trim().split(/\s+/);
      expect(fields, c).toHaveLength(5);
      expect(fields[4], `${c}: day-of-week must be * or 3-letter names`).toMatch(
        /^(\*|[A-Za-z]{3}(-[A-Za-z]{3})?(,[A-Za-z]{3}(-[A-Za-z]{3})?)*)$/,
      );
    }
  });

  it('the update trigger is aimed at Monday, in the 16-17 UTC window the PT gate expects', () => {
    const fields = UPDATE_PUSH_CRON.split(/\s+/);
    expect(fields[4].toUpperCase()).toBe('MON');
    expect(fields[1]).toBe('16-17');
  });
});
