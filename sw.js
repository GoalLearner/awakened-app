// ─────────────────────────────────────────────────────────────
// INCREMENT THIS VERSION NUMBER WITH EVERY NETLIFY DEPLOYMENT
const CACHE_VERSION = 'v5.79';
// ─────────────────────────────────────────────────────────────

const CACHE_NAME = 'awakened-cache-' + CACHE_VERSION;

// Assets to pre-cache during install (app shell for offline use)
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  // Class avatar silhouettes
  '/avatar-base.png',
  '/avatar-warrior.png',
  '/avatar-ranger.png',
  '/avatar-mage.png',
  '/avatar-assassin.png',
  '/avatar-paladin.png',
  '/avatar-merchant.png',
  '/avatar-sage.png',
  // Tab-bar icons (DALL-E art replacing the emoji set)
  '/assets/tab-icons/tab-status.png',
  '/assets/tab-icons/tab-habits.png',
  '/assets/tab-icons/tab-stats.png',
  '/assets/tab-icons/tab-history.png',
  '/assets/tab-icons/tab-dungeon.png',
  '/assets/tab-icons/tab-items.png',
  '/assets/tab-icons/tab-social.png',
  // Stat icons (DALL-E art)
  '/assets/stat-icons/stat-str.png',
  '/assets/stat-icons/stat-vit.png',
  '/assets/stat-icons/stat-int.png',
  '/assets/stat-icons/stat-focus.png',
  '/assets/stat-icons/stat-will.png',
  '/assets/stat-icons/stat-wlt.png',
  // Habit icons (DALL-E art) — full curated coverage
  '/assets/habit-icons/icon-water.png',
  '/assets/habit-icons/icon-sleep.png',
  '/assets/habit-icons/icon-wake.png',
  '/assets/habit-icons/icon-walk.png',
  '/assets/habit-icons/icon-cardio.png',
  '/assets/habit-icons/icon-strength.png',
  '/assets/habit-icons/icon-sunlight.png',
  '/assets/habit-icons/icon-gratitude.png',
  '/assets/habit-icons/icon-vitamins.png',
  '/assets/habit-icons/icon-meditate.png',
  '/assets/habit-icons/icon-nutrition.png',
  '/assets/habit-icons/icon-nophone.png',
  '/assets/habit-icons/icon-business.png',
  '/assets/habit-icons/icon-cold.png',
  '/assets/habit-icons/icon-connection.png',
  '/assets/habit-icons/icon-finance.png',
  '/assets/habit-icons/icon-grounding.png',
  '/assets/habit-icons/icon-journal.png',
  '/assets/habit-icons/icon-learning.png',
  '/assets/habit-icons/icon-mobility.png',
  '/assets/habit-icons/icon-noalcohol.png',
  '/assets/habit-icons/icon-nocaffeine.png',
  '/assets/habit-icons/icon-nodoomscroll.png',
  '/assets/habit-icons/icon-noscreen-bed.png',
  '/assets/habit-icons/icon-nosugar.png',
  '/assets/habit-icons/icon-protein.png',
  '/assets/habit-icons/icon-read.png',
  '/assets/habit-icons/icon-target.png',
  '/assets/habit-icons/icon-tidy.png',
  '/assets/habit-icons/icon-sprint.png',
  '/assets/habit-icons/icon-nosocial.png',
  '/assets/habit-icons/icon-priority.png',
  '/assets/habit-icons/icon-plan-tomorrow.png',
  '/assets/habit-icons/icon-screen-cap.png',
  '/assets/habit-icons/icon-podcast.png',
  '/assets/habit-icons/icon-pray.png',
  '/assets/habit-icons/icon-visualize.png',
  // Pack/path entry icons (Add Habits library headers)
  '/assets/habit-icons/icon-pack-morning.png',
  '/assets/habit-icons/icon-pack-lockedin.png',
  '/assets/habit-icons/icon-pack-custom.png',
  // Class emblem icons
  '/assets/habit-icons/icon-class-civilian.png',
  '/assets/habit-icons/icon-class-warrior.png',
  '/assets/habit-icons/icon-class-ranger.png',
  '/assets/habit-icons/icon-class-mage.png',
  '/assets/habit-icons/icon-class-assassin.png',
  '/assets/habit-icons/icon-class-paladin.png',
  '/assets/habit-icons/icon-class-merchant.png',
  '/assets/habit-icons/icon-class-sage.png',
  // Streak/flame icon — replaces 🔥 emoji system-wide in live UI
  '/assets/habit-icons/icon-streak.png',
  // XP/lightning icon — replaces ⚡ emoji system-wide in live UI
  '/assets/habit-icons/icon-xp.png',
  // PWA app-icons (rendered from app-icon-source.png by scripts/generate-app-icons.ps1)
  '/icon-192.png',
  '/icon-512.png',
];

// ── INSTALL: pre-cache app shell ──────────────────────────────
// Do NOT call skipWaiting() here — the update banner handles it.
// The new SW waits until the user taps "Refresh" or closes all tabs.
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(PRECACHE_ASSETS))
  );
});

// ── ACTIVATE: wipe every cache that isn't the current version ─
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── MESSAGE: app sends SKIP_WAITING when user taps the banner ─
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// ── FETCH ─────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // NOTE: /icon-192.png and /icon-512.png are now real static files in
  // the project root (generated from app-icon-source.png). The dynamic
  // OffscreenCanvas-based generator that lived here previously has been
  // removed — those static files fall through the cache-first path below.

  // ── Network-first for HTML ─────────────────────────────────
  // Always fetch the latest index.html so version bumps are picked
  // up immediately. Falls back to cache only when offline.
  // CRITICAL: res.clone() must be called SYNCHRONOUSLY (before res is
  // returned to respondWith and its body is consumed). Calling .clone()
  // inside an async .then() throws "Response body is already used".
  if (url.pathname === '/' || url.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) {
            const cacheCopy = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, cacheCopy));
          }
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // ── Cache-first for all other assets (CSS, JS, icons, etc.) ─
  // ignoreSearch so versioned URLs like app.js?v=26 match the
  // pre-cached app.js entry — keeps offline mode working even
  // when the HTML requests a newer query-string version.
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true })
      .then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          if (res.ok) {
            const cacheCopy = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, cacheCopy));
          }
          return res;
        });
      })
  );
});

// (Procedural icon generator removed — replaced by static PNGs at
//  /icon-192.png and /icon-512.png rendered from app-icon-source.png.)
