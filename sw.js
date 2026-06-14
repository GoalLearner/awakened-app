// ─────────────────────────────────────────────────────────────
// INCREMENT THIS VERSION NUMBER WITH EVERY NETLIFY DEPLOYMENT
const CACHE_VERSION = 'v5.643';
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
  // v3 Phase 1z.282 — The First Awakened coach pose set. Five PNGs
  // (idle / pointing / speaking / nodding / scroll), each ~50-60 KB.
  // Loaded by the coachmark engine + Field Manual cover/index views.
  '/assets/coach/first-awakened-idle.png',
  '/assets/coach/first-awakened-pointing.png',
  '/assets/coach/first-awakened-speaking.png',
  '/assets/coach/first-awakened-nodding.png',
  '/assets/coach/first-awakened-scroll.png',
  // W244/W248 — battle + menu music (gapless AAC loops processed by
  // scripts/process-battle-audio.js), stings + battle SFX one-shots
  // (scripts/process-sting-audio.js). mp3 twins = iOS decode fallback.
  // Licenses: assets/audio/LICENSES.md.
  // W249 — battle tier backgrounds (webp ≤252KB each, 1.16MB total)
  '/assets/backgrounds/bg_e.webp',
  '/assets/backgrounds/bg_d.webp',
  '/assets/backgrounds/bg_c.webp',
  '/assets/backgrounds/bg_b.webp',
  '/assets/backgrounds/bg_a.webp',
  '/assets/backgrounds/bg_s.webp',
  '/assets/audio/battle_loop.m4a',
  '/assets/audio/boss_loop.m4a',
  '/assets/audio/arena_menu.m4a',
  '/assets/audio/victory_sting.m4a',
  '/assets/audio/defeat_sting.m4a',
  '/assets/audio/sfx_lunge.m4a',
  '/assets/audio/sfx_hit_normal.m4a',
  '/assets/audio/sfx_hit_crit.m4a',
  '/assets/audio/sfx_hit_slice.m4a',
  '/assets/audio/sfx_hit_burst.m4a',
  '/assets/audio/sfx_hit_heavy.m4a',
  '/assets/audio/sfx_hit_magic.m4a',
  '/assets/audio/sfx_hit_arrow.m4a',
  '/assets/audio/sfx_miss_dodge.m4a',
  '/assets/audio/sfx_hp_drain.m4a',
  '/assets/audio/sfx_ko.m4a',
  '/assets/audio/sfx_boss_intro.m4a',
  '/assets/audio/sfx_rank_up.m4a',
  '/assets/audio/sfx_achievement.m4a',
  '/assets/audio/sfx_stat_up.m4a',
  '/assets/audio/sfx_rare_drop.m4a',
  '/assets/audio/sfx_perfect_day.m4a',
  '/assets/audio/sfx_hall_greeting.m4a',
  '/assets/audio/sfx_habit_check.m4a',
  '/assets/audio/sfx_heal.m4a',
  '/assets/audio/sfx_status_burn.m4a',
  '/assets/audio/sfx_status_stun.m4a',
  '/assets/audio/sfx_cauterize.m4a',
  '/assets/audio/sfx_mythic_reveal.m4a',
  '/assets/audio/battle_loop.mp3',
  '/assets/audio/boss_loop.mp3',
  '/assets/audio/arena_menu.mp3',
  '/assets/audio/victory_sting.mp3',
  '/assets/audio/defeat_sting.mp3',
  '/assets/audio/sfx_lunge.mp3',
  '/assets/audio/sfx_hit_normal.mp3',
  '/assets/audio/sfx_hit_crit.mp3',
  '/assets/audio/sfx_hit_slice.mp3',
  '/assets/audio/sfx_hit_burst.mp3',
  '/assets/audio/sfx_hit_heavy.mp3',
  '/assets/audio/sfx_hit_magic.mp3',
  '/assets/audio/sfx_hit_arrow.mp3',
  '/assets/audio/sfx_miss_dodge.mp3',
  '/assets/audio/sfx_hp_drain.mp3',
  '/assets/audio/sfx_ko.mp3',
  '/assets/audio/sfx_boss_intro.mp3',
  '/assets/audio/sfx_rank_up.mp3',
  '/assets/audio/sfx_achievement.mp3',
  '/assets/audio/sfx_stat_up.mp3',
  '/assets/audio/sfx_rare_drop.mp3',
  '/assets/audio/sfx_perfect_day.mp3',
  '/assets/audio/sfx_hall_greeting.mp3',
  '/assets/audio/sfx_habit_check.mp3',
  '/assets/audio/sfx_heal.mp3',
  '/assets/audio/sfx_status_burn.mp3',
  '/assets/audio/sfx_status_stun.mp3',
  '/assets/audio/sfx_cauterize.mp3',
  '/assets/audio/sfx_mythic_reveal.mp3',
  // W296 — mythic mega-rare hero art (the Eclipse Coronation reveal)
  '/assets/items/nightfall-blade-of-the-sovereign.png',
  // W251 — NPC battle sprites (archetypes; boss portraits added as art lands)
  '/assets/arena/foe_aggressor.webp',
  '/assets/arena/foe_sentinel.webp',
  '/assets/arena/foe_trickster.webp',
  '/assets/arena/foe_glasscannon.webp',
  '/assets/arena/foe_juggernaut.webp',
  '/assets/arena/foe_balanced.webp',
  '/assets/arena/boss_10.webp',
  '/assets/arena/boss_20.webp',
  '/assets/arena/boss_30.webp',
  '/assets/arena/boss_40.webp',
  '/assets/arena/boss_50.webp',
  '/assets/arena/boss_60.webp',
  '/assets/arena/boss_70.webp',
  '/assets/arena/boss_80.webp',
  '/assets/arena/boss_90.webp',
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
  // v3 Phase 1z.271B/C — three B-rank bosses (verified-only,
  // 5-of-7 qualifying-days/nights inside a weekly hunt window).
  // Portraits added in 1z.271C.
  '/assets/bosses/the-forge-of-ten-thousand-days.png',
  '/assets/bosses/the-vow-keeper.png',
  '/assets/bosses/the-patient-flame.png',
  // Item-card illustrations. Only paths that EXIST on disk are listed
  // here. (Historical note: this list used to be kept strictly in-sync
  // with disk because the old cache.addAll() rejected the entire install
  // on any 404. As of W199 the install precaches each asset
  // independently with a per-asset catch, so a stray 404 no longer fails
  // the install — but keeping the list accurate is still good hygiene.)
  // The remaining launch cards fall through to the network (404 in dev),
  // which the renderer cleanly handles by removing the <img> and showing
  // the emoji + rarity gradient placeholder. Add each card's path here
  // as its art lands on disk.
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
  // v3 Phase 1z.271D-C — B-rank drops (15 items, 5 per boss).
  // The Forge of Ten Thousand Days
  '/assets/items/forge-blackened-handwraps.png',
  '/assets/items/ember-anvil-circlet.png',
  '/assets/items/coalstep-band.png',
  '/assets/items/hammerfall-warmaul.png',
  '/assets/items/gauntlets-of-ten-thousand-days.png',
  // The Vow Keeper
  '/assets/items/candlekeepers-charm.png',
  '/assets/items/nightwatchers-gloves.png',
  '/assets/items/mantle-of-kept-hours.png',
  '/assets/items/ring-of-the-unbroken-vow.png',
  '/assets/items/amulet-of-the-kept-word.png',
  // The Patient Flame
  '/assets/items/emberstep-boots.png',
  '/assets/items/waiting-flame-signet.png',
  '/assets/items/pilgrims-coal-wraps.png',
  '/assets/items/boots-of-the-long-road.png',
  '/assets/items/ember-ledger-of-the-patient-flame.png',
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
      // v3 W199 hardening (audit P1) — precache each asset INDEPENDENTLY.
      // cache.addAll() is atomic-fail: a single missing/404'd entry
      // rejects the whole install → the new SW never activates → on iOS
      // Capacitor the user is stranded on the OLD service worker (serving
      // stale markup) until a full reinstall, blocking ALL future
      // updates. Per-asset add() with a per-asset swallow keeps install
      // resilient: the critical shell (/, index.html, app.js, styles.css)
      // is near-guaranteed present, and any genuinely missing asset is
      // simply re-fetched from network at runtime. The trailing catch +
      // skipWaiting guarantees the SW always activates so updates land.
      .then(c => Promise.all(PRECACHE_ASSETS.map(url => c.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
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
