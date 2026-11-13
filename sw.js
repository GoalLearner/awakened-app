// ─────────────────────────────────────────────────────────────
// INCREMENT THIS VERSION NUMBER WITH EVERY NETLIFY DEPLOYMENT
const CACHE_VERSION = 'v6.469';
// ─────────────────────────────────────────────────────────────

const CACHE_NAME = 'awakened-cache-' + CACHE_VERSION;

// Assets to pre-cache during install (app shell for offline use)
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/lib/economy.js',
  '/lib/drops.js',
  // W1188 — the battle FX: the Lottie player, Kenney's particles, the LottieFiles effects
  '/lib/lottie_light.min.js',
  '/assets/fx/k-slash_01.png',
  '/assets/fx/k-slash_02.png',
  '/assets/fx/k-slash_03.png',
  '/assets/fx/k-slash_04.png',
  '/assets/fx/k-scratch_01.png',
  '/assets/fx/k-twirl_01.png',
  '/assets/fx/k-twirl_02.png',
  '/assets/fx/k-trace_06.png',
  '/assets/fx/k-trace_07.png',
  '/assets/fx/k-spark_01.png',
  '/assets/fx/k-spark_02.png',
  '/assets/fx/k-spark_07.png',
  '/assets/fx/k-star_06.png',
  '/assets/fx/k-star_07.png',
  '/assets/fx/k-star_08.png',
  '/assets/fx/k-star_09.png',
  '/assets/fx/k-circle_02.png',
  '/assets/fx/k-circle_03.png',
  '/assets/fx/k-magic_03.png',
  '/assets/fx/k-magic_05.png',
  '/assets/fx/k-light_02.png',
  '/assets/fx/k-fire_01.png',
  '/assets/fx/k-fire_02.png',
  '/assets/fx/k-muzzle_02.png',
  '/assets/fx/k-scorch_02.png',
  '/assets/fx/k-dirt_02.png',
  '/assets/fx/k-smoke_10.png',
  '/assets/fx/k-flare_01.png',
  '/assets/fx/lottie/poof.json',
  '/assets/fx/lottie/explosion-red-particles.json',
  '/assets/fx/lottie/red-explosion.json',
  '/assets/fx/lottie/explosion-anisimov.json',
  '/assets/fx/lottie/fire-element.json',
  '/assets/fx/lottie/thunder-element.json',
  '/assets/fx/lottie/smoke-dust.json',
  '/assets/fx/lottie/sparkles-burst.json',
  '/assets/fx/lottie/golden-glow.json',
  '/assets/fx/lottie/charge-aura.json',
  '/assets/fx/lottie/fog-smoke.json',
  '/sandbox.js',
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
  // W711 — head-and-shoulders BUST portraits for the leaderboard crest + profile
  // medallion (8 class + 10 skin). Any user's board row can show a skin bust, so all 18
  // are precached (~410KB). Full-body sprites above stay for battle/PvP/home.
  '/assets/busts/avatar-base-bust.webp',
  '/assets/busts/avatar-warrior-bust.webp',
  '/assets/busts/avatar-ranger-bust.webp',
  '/assets/busts/avatar-mage-bust.webp',
  '/assets/busts/avatar-assassin-bust.webp',
  '/assets/busts/avatar-paladin-bust.webp',
  '/assets/busts/avatar-merchant-bust.webp',
  '/assets/busts/avatar-sage-bust.webp',
  '/assets/busts/avatar-skin-stardust-bust.webp',
  '/assets/busts/avatar-skin-dawnbringer-bust.webp',
  '/assets/busts/avatar-skin-nullprotocol-bust.webp',
  '/assets/busts/avatar-skin-nullprotocol-2-bust.webp',
  '/assets/busts/avatar-skin-emberforged-bust.webp',
  '/assets/busts/avatar-skin-voidtouched-bust.webp',
  '/assets/busts/avatar-skin-frostweaver-bust.webp',
  '/assets/busts/avatar-skin-tempest-bust.webp',
  '/assets/busts/avatar-skin-verdant-bust.webp',
  '/assets/busts/avatar-skin-huntmaster-bust.webp',     // W1105 — the Rising
  '/assets/busts/avatar-skin-vanguard-bust.webp',
  '/assets/busts/avatar-skin-ascendant-bust.webp',
  '/assets/busts/avatar-skin-stridewalker-bust.webp',
  '/assets/busts/avatar-skin-unbroken-bust.webp',
  '/assets/busts/avatar-skin-oathbound-bust.webp',
  '/assets/busts/avatar-skin-thirdblade-bust.webp',
  '/assets/busts/avatar-skin-triarch-bust.webp',
  '/assets/busts/avatar-skin-gatebreaker-bust.webp',
  '/assets/busts/avatar-skin-bloodmoon-bust.webp',
  // Tab-bar icons (DALL-E art replacing the emoji set)
  '/assets/tab-icons/tab-status.png',
  '/assets/tab-icons/tab-habits.png',
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
  // Vertical Jump Program movement icons (W578)
  '/assets/habit-icons/icon-maxjump.png',
  '/assets/habit-icons/icon-depthjump.png',
  '/assets/habit-icons/icon-broadjump.png',
  '/assets/habit-icons/icon-bandjump.png',
  '/assets/habit-icons/icon-weightedjump.png',
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
  // W945 — Add Habits pack cards
  '/assets/backgrounds/pack-morning-road.webp',
  '/assets/backgrounds/pack-lockedin-tower.webp',
  // W705 — leaderboard painted strips (21KB total; offline boards keep their art)
  '/assets/backgrounds/lb-row-basic.webp',
  '/assets/backgrounds/lb-hero.webp',
  // W706 + W714 — the 19 member card backgrounds (offline rows/cards keep their
  // chosen art). Keep in sync with CARD_BG_CATALOG.
  '/assets/backgrounds/lb-bg-100k.webp',
  '/assets/backgrounds/lb-bg-floor100.webp',
  '/assets/backgrounds/lb-bg-srank.webp',
  '/assets/backgrounds/lb-bg-splus.webp',
  '/assets/backgrounds/lb-bg-boss500.webp',
  '/assets/backgrounds/lb-bg-arena.webp',
  '/assets/backgrounds/lb-bg-mega.webp',
  '/assets/backgrounds/lb-bg-streak365.webp',
  '/assets/backgrounds/lb-bg-god.webp',
  '/assets/backgrounds/lb-bg-founder.webp',
  // W714 — six rank-Gate borders + three completion trophies.
  '/assets/backgrounds/lb-bg-egate.webp',
  '/assets/backgrounds/lb-bg-dgate.webp',
  '/assets/backgrounds/lb-bg-cgate.webp',
  '/assets/backgrounds/lb-bg-bgate.webp',
  '/assets/backgrounds/lb-bg-agate.webp',
  '/assets/backgrounds/lb-bg-sgate.webp',
  '/assets/backgrounds/lb-bg-allmega.webp',
  '/assets/backgrounds/lb-bg-collog.webp',
  '/assets/backgrounds/lb-bg-streak30.webp',
  '/assets/audio/battle_loop.m4a',
  '/assets/audio/boss_loop.m4a',
  '/assets/audio/arena_menu.m4a',
  '/assets/audio/victory_sting.m4a',
  '/assets/audio/defeat_sting.m4a',
  '/assets/audio/ascent_promote.mp3',
  '/assets/audio/ascent_apex.mp3',
  '/assets/audio/ascent_demote.mp3',
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
  // W755 — the battle's Suno one-shots (execute / finisher-freeze / bleed / heartbeat)
  '/assets/audio/sfx_hit_execute.m4a',
  '/assets/audio/sfx_finisher_stop.m4a',
  '/assets/audio/sfx_bleed_apply.m4a',
  '/assets/audio/sfx_heartbeat.m4a',
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
  '/assets/items/nightfall-blade-of-the-sovereign.webp',
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
  '/assets/bosses/the-insomniac.webp',
  '/assets/bosses/the-carouser.webp',
  '/assets/bosses/the-steel-wolf.webp',
  // v3 Phase 1v — D-rank daily bosses
  '/assets/bosses/the-iron-warden.webp',
  '/assets/bosses/the-glass-strider.webp',
  '/assets/bosses/the-dream-tyrant.webp',
  // v3 Phase 1z.65 — first C-rank boss
  '/assets/bosses/the-ascendant-colossus.webp',
  // v3 Phase 1z.68 — second C-rank boss (dual-condition)
  '/assets/bosses/the-furnace-knight.webp',
  // v3 Phase 1z.70 — third C-rank boss (10k-steps daily)
  '/assets/bosses/the-marathon-wraith.webp',
  // v3 Phase 1z.271B/C — three B-rank bosses (verified-only,
  // 5-of-7 qualifying-days/nights inside a weekly hunt window).
  // Portraits added in 1z.271C.
  '/assets/bosses/the-forge-of-ten-thousand-days.webp',
  '/assets/bosses/the-vow-keeper.webp',
  '/assets/bosses/the-patient-flame.webp',
  // W877 — full boss-art catalog parity (the W821 relic lesson, same drift):
  // every A/S/co-op portrait + summons plate that had landed on disk since
  // the B-rank block above, plus the four v3 wave-1 portraits arriving in
  // this commit (Starved Sentinel, Worldspine, Cloven Titan, Gray Pilgrim).
  // Verified against assets/bosses/*.png — 38 files, all listed.
  '/assets/bosses/erebus-the-shadow-sovereign.webp',
  '/assets/bosses/the-cloven-titan.webp',
  '/assets/bosses/the-coursing-dread.webp',
  '/assets/bosses/the-coursing-dread-summons.webp',
  '/assets/bosses/the-gaunt-wardens.webp',
  '/assets/bosses/the-gaunt-wardens-summons.webp',
  '/assets/bosses/the-gray-pilgrim.webp',
  '/assets/bosses/the-grinning-god.webp',
  '/assets/bosses/the-grinning-god-summons.webp',
  '/assets/bosses/the-hollow-monarch.webp',
  '/assets/bosses/the-hollow-monarch-summons.webp',
  '/assets/bosses/the-myrmidon-king.webp',
  '/assets/bosses/the-myrmidon-king-summons.webp',
  '/assets/bosses/the-sleepless-ascent.webp',
  '/assets/bosses/the-starved-sentinel.webp',
  '/assets/bosses/the-sundered-choir.webp',
  '/assets/bosses/the-sundered-choir-summons.webp',
  '/assets/bosses/the-threefold-court.webp',
  '/assets/bosses/the-threefold-court-summons.webp',
  '/assets/bosses/the-crossroads-hound.webp',          // W1104 — the D, B and A steps trios
  '/assets/bosses/the-crossroads-hound-summons.webp',
  '/assets/bosses/the-triune-sentinel.webp',
  '/assets/bosses/the-triune-sentinel-summons.webp',
  '/assets/bosses/the-trinity-colossus.webp',
  '/assets/bosses/the-trinity-colossus-summons.webp',
  '/assets/bosses/the-tideless-marcher.webp',
  '/assets/bosses/the-twin-maw.webp',
  '/assets/bosses/the-twin-maw-summons.webp',
  '/assets/bosses/the-unbroken-anvil.webp',
  '/assets/bosses/the-unresting-march.webp',
  '/assets/bosses/the-unresting-march-summons.webp',
  '/assets/bosses/the-worldspine.webp',
  '/assets/bosses/the-footsore-herald.webp',
  '/assets/bosses/the-milestone-hound.webp',
  '/assets/bosses/the-wayfarer-knight.webp',
  '/assets/bosses/the-seven-league-stalker.webp',
  '/assets/bosses/the-unending-road.webp',
  '/assets/bosses/the-sevenfold-colossus.webp',
  '/assets/bosses/the-lullaby-wraith.webp',
  '/assets/bosses/the-moonwell-keeper.webp',
  '/assets/bosses/the-oracle-of-deep-hours.webp',
  '/assets/bosses/the-seventh-night.webp',
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
  // W821 (Train 1, C6) — 34 relic arts had shipped to disk without their
  // precache entries (the exact follow-up the app.js dropTable comment
  // predicted), so those relics rendered blank offline / on a cold cache.
  // Full catalog now precached; verified against assets/items/*.png.
  '/assets/items/aetherspire-staff.webp',
  '/assets/items/amulet-of-the-endless-stair.webp',
  '/assets/items/anvilrest-cuirass.webp',
  '/assets/items/ascent-worn-cloak.webp',
  '/assets/items/band-of-the-roadkeeper.webp',
  '/assets/items/bothsight_longbow.webp',
  '/assets/items/charm-of-the-emberkeeper.webp',
  '/assets/items/coursing_houndcall.webp',
  '/assets/items/crown-of-eternal-night.webp',
  '/assets/items/crownpiercer.webp',
  '/assets/items/duskforge-the-anvils-verdict.webp',
  '/assets/items/forgewarden-gauntlets.webp',
  '/assets/items/greaves-of-the-umbral-throne.webp',
  '/assets/items/houndsfang_recurve.webp',
  '/assets/items/mantle-of-the-long-vigil.webp',
  '/assets/items/mantle-of-the-shadow-sovereign.webp',
  '/assets/items/nightcrown-of-the-climb.webp',
  '/assets/items/restplate-of-the-wanderer.webp',
  '/assets/items/skyward-vigil-ring.webp',
  '/assets/items/striders-of-the-tideless-road.webp',
  '/assets/items/the_antiphon_striders.webp',
  '/assets/items/the_choirmasters_vestment.webp',
  '/assets/items/the_discordant_crown.webp',
  '/assets/items/the_famished_circlet.webp',
  '/assets/items/the_gaunt_mantle.webp',
  '/assets/items/the_hollow_crown.webp',
  '/assets/items/the_long_pursuit.webp',
  '/assets/items/the_monarchs_writ.webp',
  '/assets/items/the_stairwalkers_treads.webp',
  '/assets/items/the_sundered_grips.webp',
  '/assets/items/the_wardens_vigil.webp',
  '/assets/items/twin_fang_cleaver.webp',
  '/assets/items/twofold_gaze.webp',
  '/assets/items/wraithwind-bow.webp',
  '/assets/items/dream_woven_hood.webp',
  '/assets/items/sleepwalkers_cloak.webp',
  '/assets/items/pendant_of_the_wakeful.webp',
  '/assets/items/vow_ring.webp',
  '/assets/items/vessel_of_refusal.webp',
  '/assets/items/sober_kings_gloves.webp',
  '/assets/items/pack_leaders_greaves.webp',
  '/assets/items/alphas_mantle.webp',
  '/assets/items/trail_worn_boots.webp',
  // v2.1 content patch — 6 new commons (2 per boss). Art landed
  // on disk this release; PRECACHE entries activate offline + SW
  // delivery for these paths starting v5.149.
  '/assets/items/tossing_bedroll.webp',
  '/assets/items/drowsy_signet.webp',
  '/assets/items/sobriety_token.webp',
  '/assets/items/steady_steps.webp',
  '/assets/items/pups_hood.webp',
  '/assets/items/trackers_wrap.webp',
  // v3 Phase 1v.3 — D-rank drops for the three new daily bosses
  // (Iron Warden, Glass Strider, Dream Tyrant). Filenames use
  // hyphens to match the production art deliveries.
  '/assets/items/iron-grip-wraps.webp',
  '/assets/items/wardens-chain-belt.webp',
  '/assets/items/rusted-training-blade.webp',
  '/assets/items/wardens-plate.webp',
  '/assets/items/titan-oathblade.webp',
  '/assets/items/striders-laces.webp',
  '/assets/items/glassstep-band.webp',
  '/assets/items/shardwalker-wrap.webp',
  '/assets/items/glass-path-boots.webp',
  '/assets/items/horizon-step-ring.webp',
  '/assets/items/quiet-thread.webp',
  '/assets/items/moonlit-lens.webp',
  '/assets/items/hushed-night-cloak.webp',
  '/assets/items/tyrants-sleep-mask.webp',
  '/assets/items/crown-of-deep-rest.webp',
  // v3 Phase 1z.65 — C-rank Ascendant Colossus drops (5 items).
  // Art landed on disk this release; precache activates offline +
  // SW delivery so the BOSS DEFEATED modal renders real art via
  // setModalCardArt instead of the emoji+gradient fallback.
  '/assets/items/summit-treads.webp',
  '/assets/items/stairbound-greaves.webp',
  '/assets/items/upper-gate-band.webp',
  '/assets/items/keystone-pendant.webp',
  '/assets/items/crown-of-the-ascendant.webp',
  // v3 Phase 1z.68 — C-rank Furnace Knight drops (5 items).
  '/assets/items/embergrip-gauntlets.webp',
  '/assets/items/furnacewalk-legplates.webp',
  '/assets/items/cinderplate-harness.webp',
  '/assets/items/kilnforged-warblade.webp',
  '/assets/items/ashen-monarchs-cape.webp',
  // v3 Phase 1z.70 — C-rank Marathon Wraith drops (5 items).
  '/assets/items/roadworn-mantle.webp',
  '/assets/items/phantom-mile-wraps.webp',
  '/assets/items/wayfarers-signet.webp',
  '/assets/items/ten-thousand-step-blade.webp',
  '/assets/items/greaves-of-the-endless-road.webp',
  // v3 Phase 1z.271D-C — B-rank drops (15 items, 5 per boss).
  // The Forge of Ten Thousand Days
  '/assets/items/forge-blackened-handwraps.webp',
  '/assets/items/ember-anvil-circlet.webp',
  '/assets/items/coalstep-band.webp',
  '/assets/items/hammerfall-warmaul.webp',
  '/assets/items/gauntlets-of-ten-thousand-days.webp',
  // The Vow Keeper
  '/assets/items/candlekeepers-charm.webp',
  '/assets/items/nightwatchers-gloves.webp',
  '/assets/items/mantle-of-kept-hours.webp',
  '/assets/items/ring-of-the-unbroken-vow.webp',
  '/assets/items/amulet-of-the-kept-word.webp',
  // The Patient Flame
  '/assets/items/emberstep-boots.webp',
  '/assets/items/waiting-flame-signet.webp',
  '/assets/items/pilgrims-coal-wraps.webp',
  '/assets/items/boots-of-the-long-road.webp',
  '/assets/items/ember-ledger-of-the-patient-flame.webp',
  // W678/W684 — Threefold Court (trio) + Unresting March (48h duo) pools.
  '/assets/items/vestments_of_the_final_verdict.webp',
  '/assets/items/courthunters_grips.webp',
  '/assets/items/seal_of_the_threefold_court.webp',
  '/assets/items/roadwardens_harness.webp',
  '/assets/items/milestone_cowl.webp',
  '/assets/items/longroad_grips.webp',
  // W688 — The Myrmidon King raid pool (2 mythics + 6 S ultras).
  '/assets/items/reverie_staff.webp',
  '/assets/items/vigil_bow.webp',
  '/assets/items/watchkeepers_carapace.webp',
  '/assets/items/grips_of_the_third_night.webp',
  '/assets/items/striders_of_the_waking_march.webp',
  '/assets/items/circlet_of_lucid_sleep.webp',
  '/assets/items/shroud_of_the_dreaming_court.webp',
  '/assets/items/pendant_of_the_seventh_hour.webp',
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
  // W784 — EXACT match first (query string INCLUDED), ignoreSearch only as the
  // OFFLINE fallback. The old order matched ignoreSearch FIRST, which meant a
  // versioned request like app.js?v=1199 was satisfied by the previously cached
  // /app.js no matter what the version said — so bumping ?v= never busted
  // anything. Only a CACHE_VERSION change refreshed assets, and that lands one
  // launch late (the outgoing worker still controls the first page load after an
  // update), which is why a fresh TestFlight build could still paint the previous
  // build's UI. Now:
  //   • new version  -> exact miss -> network -> fresh code, cached under that URL
  //   • same version -> exact hit  -> instant, no network
  //   • offline      -> network throws -> ignoreSearch finds the precached copy
  // so version bumps land immediately AND offline still works.
  e.respondWith(
    caches.match(e.request)
      .then(exact => {
        if (exact) return exact;
        return fetch(e.request)
          .then(res => {
            if (res.ok) {
              const cacheCopy = res.clone();
              caches.open(CACHE_NAME).then(c => c.put(e.request, cacheCopy));
            }
            return res;
          })
          .catch(() => caches.match(e.request, { ignoreSearch: true }));
      })
  );
});

// (Procedural icon generator removed — replaced by static PNGs at
//  /icon-192.png and /icon-512.png rendered from app-icon-source.png.)
