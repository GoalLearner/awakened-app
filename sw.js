// ─────────────────────────────────────────────────────────────
// INCREMENT THIS VERSION NUMBER WITH EVERY NETLIFY DEPLOYMENT
const CACHE_VERSION = 'v5.392';
// ─────────────────────────────────────────────────────────────

const CACHE_NAME = 'awakened-cache-' + CACHE_VERSION;

// Assets to pre-cache during install (app shell for offline use)
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/auth.js',
  '/simulated-leaderboard.js',
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
  // Souls currency icon (v2.0.1) — replaces 💀 placeholder in the
  // header souls badge. Also shown in #souls-info-modal header.
  // Lives under assets/icons/ (new folder for general-purpose UI
  // iconography, distinct from habit-icons / tab-icons / etc).
  '/assets/icons/souls-icon.png',
  // PWA app-icons (rendered from app-icon-source.png by scripts/generate-app-icons.ps1)
  '/icon-192.png',
  '/icon-512.png',
  // Dungeon gates (v2.0.2 → v2.0.5). One gate per rank tier (E, D, C,
  // B, A, S). E is unlocked by default; D-S render in locked state and
  // unlock as the user climbs ranks. Future SS-tier gate added when a
  // boss populates that tier.
  '/assets/gates/gate-e-rank.png',
  '/assets/gates/gate-d-rank.png',
  '/assets/gates/gate-c-rank.png',
  '/assets/gates/gate-b-rank.png',
  '/assets/gates/gate-a-rank.png',
  '/assets/gates/gate-s-rank.png',
  // Boss illustrations (CARDS.md spec preview). 1254×1254 manhwa
  // portraits, used inside the new boss-card art window.
  '/assets/bosses/the-insomniac.png',
  '/assets/bosses/the-carouser.png',
  '/assets/bosses/the-steel-wolf.png',
  // v3 Phase 1v — D-rank daily bosses
  '/assets/bosses/the-iron-warden.png',
  '/assets/bosses/the-glass-strider.png',
  '/assets/bosses/the-dream-tyrant.png',
  // v3 Phase 1z.65 — first C-rank boss
  '/assets/bosses/the-ascendant-colossus.png',
  // v3 Phase 1z.68 — second C-rank boss (dual-condition)
  '/assets/bosses/the-furnace-knight.png',
  // v3 Phase 1z.70 — third C-rank boss (10k-steps daily)
  '/assets/bosses/the-marathon-wraith.png',
  // Item-card illustrations. Only paths that EXIST on disk get listed
  // here — cache.addAll rejects the entire install if any entry 404s.
  // The remaining 8 launch cards fall through to the network (404 in
  // dev), which the renderer cleanly handles by removing the <img>
  // and showing the emoji + rarity gradient placeholder. Add each
  // card's path here as its art lands on disk.
  '/assets/items/dream_woven_hood.png',
  '/assets/items/sleepwalkers_cloak.png',
  '/assets/items/pendant_of_the_wakeful.png',
  '/assets/items/vow_ring.png',
  '/assets/items/vessel_of_refusal.png',
  '/assets/items/sober_kings_gloves.png',
  '/assets/items/pack_leaders_greaves.png',
  '/assets/items/alphas_mantle.png',
  '/assets/items/trail_worn_boots.png',
  // v2.1 content patch — 6 new commons (2 per boss). Art landed
  // on disk this release; PRECACHE entries activate offline + SW
  // delivery for these paths starting v5.149.
  '/assets/items/tossing_bedroll.png',
  '/assets/items/drowsy_signet.png',
  '/assets/items/sobriety_token.png',
  '/assets/items/steady_steps.png',
  '/assets/items/pups_hood.png',
  '/assets/items/trackers_wrap.png',
  // v3 Phase 1v.3 — D-rank drops for the three new daily bosses
  // (Iron Warden, Glass Strider, Dream Tyrant). Filenames use
  // hyphens to match the production art deliveries.
  '/assets/items/iron-grip-wraps.png',
  '/assets/items/wardens-chain-belt.png',
  '/assets/items/rusted-training-blade.png',
  '/assets/items/wardens-plate.png',
  '/assets/items/titan-oathblade.png',
  '/assets/items/striders-laces.png',
  '/assets/items/glassstep-band.png',
  '/assets/items/shardwalker-wrap.png',
  '/assets/items/glass-path-boots.png',
  '/assets/items/horizon-step-ring.png',
  '/assets/items/quiet-thread.png',
  '/assets/items/moonlit-lens.png',
  '/assets/items/hushed-night-cloak.png',
  '/assets/items/tyrants-sleep-mask.png',
  '/assets/items/crown-of-deep-rest.png',
  // v3 Phase 1z.65 — C-rank Ascendant Colossus drops (5 items).
  // Art landed on disk this release; precache activates offline +
  // SW delivery so the BOSS DEFEATED modal renders real art via
  // setModalCardArt instead of the emoji+gradient fallback.
  '/assets/items/summit-treads.png',
  '/assets/items/stairbound-greaves.png',
  '/assets/items/upper-gate-band.png',
  '/assets/items/keystone-pendant.png',
  '/assets/items/crown-of-the-ascendant.png',
  // v3 Phase 1z.68 — C-rank Furnace Knight drops (5 items).
  '/assets/items/embergrip-gauntlets.png',
  '/assets/items/furnacewalk-legplates.png',
  '/assets/items/cinderplate-harness.png',
  '/assets/items/kilnforged-warblade.png',
  '/assets/items/ashen-monarchs-cape.png',
  // v3 Phase 1z.70 — C-rank Marathon Wraith drops (5 items).
  '/assets/items/roadworn-mantle.png',
  '/assets/items/phantom-mile-wraps.png',
  '/assets/items/wayfarers-signet.png',
  '/assets/items/ten-thousand-step-blade.png',
  '/assets/items/greaves-of-the-endless-road.png',
  // (v2.1 equipment panel-base.png retired in v3 Phase 1d — the
  //  Hunter Build replaces the body-slot armory art with a tiled
  //  6-slot grid. Asset remains on disk for archival.)
];

// ── INSTALL: pre-cache app shell ──────────────────────────────
// v3 Phase 1x debug: skipWaiting() is now called in install. Earlier
// guidance said don't (in case the client-side update banner wanted
// to control the timing), but on iOS Capacitor WebView every IPA
// update ships a new sw.js that needs to take over immediately —
// otherwise the OLD SW from the previous IPA keeps serving stale
// /index.html from its precache and new static markup never reaches
// the user. The web auto-update path in app.js still posts SKIP_WAITING
// for redundancy; this just shortens the window during which the old
// SW can intercept fetches with stale cached responses.
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
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
