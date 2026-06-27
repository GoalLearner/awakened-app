/**
 * Playwright config for Awakened smoke tests.
 *
 * Goal: a small, reliable browser-level confidence pass before
 * Codemagic / TestFlight. Boots the existing PowerShell static
 * server (`serve.ps1`) at http://localhost:8080, runs Chromium
 * only (the iOS WKWebView shipping shape is closest to a Chromium-
 * family engine; cross-browser matrix is unnecessary for a PWA
 * wrapped in Capacitor).
 *
 * Auth: localhost dev mode auto-signs in as "DevUser" via
 * `Auth.devSignInIfLocalhost()` — see auth.js. No production JWT,
 * no Apple Sign In flow needed.
 *
 * Service worker: we forcibly unregister any SW + clear caches in
 * the test setup so stale assets don't interfere with reloads.
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,           // app is stateful (localStorage); avoid races
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,                     // single-worker, single-tab — no cross-test contamination
  // CI: 'list' for the live log + 'github' so each failure becomes a GitHub check
  // annotation (file:line + error), readable via the public annotations API without
  // admin/log access — added after a CI-only failure whose cause was only in the log.
  reporter: process.env.CI ? [['list'], ['github']] : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: 'http://localhost:8080',
    serviceWorkers: 'block',         // W492 — app registers sw.js; block it so cached assets can't interfere with reloads
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // The dev sign-in path triggers a few Auth network calls that
    // would otherwise need the production worker. We don't block
    // them — the stub JWT path handles 401s gracefully — but the
    // test waits don't rely on network either way.
    actionTimeout: 8_000,
    navigationTimeout: 20_000,
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 414, height: 896 },  // iPhone-ish portrait
      },
    },
  ],

  // Use the existing serve.ps1 PowerShell server. Playwright will
  // start it if not already running and tear it down at the end.
  // reuseExistingServer = true so a manually-running `pwsh serve.ps1`
  // doesn't conflict during local dev iterations.
  webServer: {
    command: 'node serve.mjs',   // W492 — cross-platform (was Windows-only serve.ps1; can't run on Linux CI). serve.ps1 kept for local muscle-memory.
    url: 'http://localhost:8080',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
