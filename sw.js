// ─────────────────────────────────────────────────────────────
// INCREMENT THIS VERSION NUMBER WITH EVERY NETLIFY DEPLOYMENT
const CACHE_VERSION = 'v4.87';
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

  // Generate PNG icons dynamically (never cached by URL)
  if (url.pathname === '/icon-192.png') {
    e.respondWith(getOrGenerateIcon(192));
    return;
  }
  if (url.pathname === '/icon-512.png') {
    e.respondWith(getOrGenerateIcon(512));
    return;
  }

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

// ── ICON GENERATION ───────────────────────────────────────────
async function getOrGenerateIcon(size) {
  const cache  = await caches.open(CACHE_NAME);
  const key    = `/icon-${size}.png`;
  const cached = await cache.match(key);
  if (cached) return cached;

  const response = await generateIcon(size);
  cache.put(key, response.clone());
  return response;
}

async function generateIcon(size) {
  try {
    const canvas = new OffscreenCanvas(size, size);
    const ctx    = canvas.getContext('2d');
    const r      = size * 0.22;

    // Rounded dark background
    ctx.fillStyle = '#0f1a12';
    roundRect(ctx, 0, 0, size, size, r);
    ctx.fill();

    // Subtle inner glow ring
    const grad = ctx.createRadialGradient(size/2, size/2, size*0.1, size/2, size/2, size*0.5);
    grad.addColorStop(0, 'rgba(34,197,94,0.08)');
    grad.addColorStop(1, 'rgba(34,197,94,0)');
    ctx.fillStyle = grad;
    roundRect(ctx, 0, 0, size, size, r);
    ctx.fill();

    // Checkmark
    const lw = size * 0.085;
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth   = lw;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';

    const cx = size * 0.5;
    const cy = size * 0.52;
    const s  = size * 0.38;

    ctx.beginPath();
    ctx.moveTo(cx - s * 0.48, cy - s * 0.04);
    ctx.lineTo(cx - s * 0.05, cy + s * 0.42);
    ctx.lineTo(cx + s * 0.55, cy - s * 0.4);
    ctx.stroke();

    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return new Response(blob, {
      status:  200,
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800' },
    });
  } catch (_) {
    // Fallback: 1×1 green pixel
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Response(arr.buffer, { status: 200, headers: { 'Content-Type': 'image/png' } });
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
