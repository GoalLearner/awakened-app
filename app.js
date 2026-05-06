/* Awakened — Daily Habit Tracker */
(function () {
  'use strict';

  // ── CONSTANTS ─────────────────────────────────────────────
  const DIFFICULTY = {
    easy:      { label: 'Easy',      pts: 1  },
    medium:    { label: 'Medium',    pts: 3  },
    hard:      { label: 'Hard',      pts: 5  },
    legendary: { label: 'Legendary', pts: 10 },
  };

  // ── APP VERSION ──────────────────────────────────────────
  // Single source of truth for the app's marketing version. Bump this
  // when shipping a new TestFlight / App Store build (and add the
  // matching WHATS_NEW entry below).
  const APP_VERSION = '1.1.5';

  // ── HealthKit auto-verification thresholds ───────────────
  // v1.1.5: Daily walk auto-verifies via Apple Health when steps
  // reach the user's chosen goal. Default 3,000 ≈ 30 min of
  // moderate-pace walking, matching the canonical "Daily walk · 30 min"
  // habit. The goal is stored PER HABIT (habit.stepGoal field) — see
  // CLAUDE.md "habit identity is the name string" + "single source of
  // truth" patterns. The Edit Habit modal hosts the configuration UI.
  // Always read via getHabitStepGoal(habit) — never reference the
  // default directly outside the helper.
  const HEALTHKIT_WALK_DEFAULT_THRESHOLD = 3000;
  const HEALTHKIT_WALK_THRESHOLD_MIN = 100;
  const HEALTHKIT_WALK_THRESHOLD_MAX = 50000;
  // Preset chips offered in the Edit Habit step-goal control. "Custom"
  // outside this list reveals the inline numeric input.
  const HEALTHKIT_WALK_PRESETS = [1000, 3000, 5000, 8000, 10000];

  // ── HealthKit auth version ───────────────────────────────
  // BUMP THIS NUMBER any time you add a new HealthKit category to the
  // requestAuthorization() read array. The migration in init() compares
  // this against hb_healthkit_authversion in localStorage; if the
  // user's stored version is lower, all per-category "already-asked"
  // flags are cleared so the upgrade-path helpers will re-fire and
  // iOS shows a permission sheet for the newly-added categories. The
  // existing grants for previously-authorized categories stay intact —
  // iOS dedupes within a single requestAuthorization call.
  //
  // Version log:
  //   1 — v1.1.4: steps only
  //   2 — v1.1.5: steps + sleep + workouts (via 'activity' alias)
  //
  // When you bump, also update HEALTHKIT_AUTH_FLAGS_TO_CLEAR below
  // with any new per-category flags so the migration knows what to
  // wipe. (For v1 → v2 there's only one such flag.)
  const HEALTHKIT_AUTH_VERSION = 2;
  const HEALTHKIT_AUTH_FLAGS_TO_CLEAR = ['hb_healthkit_sleep_requested'];

  // ── HealthKit sleep auto-verification ────────────────────
  // v1.1.5: canonical 'Sleep' habit auto-verifies via Apple Health
  // when total asleep hours ≥ habit.sleepGoalHours. The canonical
  // 'Sleep before midnight' habit auto-verifies binarily when the
  // earliest qualifying asleep sample.startDate < device-local
  // midnight today. See Health.getSleepLastNight() for the full
  // sample-handling caveats. Always read goal via getSleepGoalHours().
  const HEALTHKIT_SLEEP_DEFAULT_GOAL_HOURS = 7;
  const HEALTHKIT_SLEEP_GOAL_MIN_HOURS = 3;
  const HEALTHKIT_SLEEP_GOAL_MAX_HOURS = 14;
  const HEALTHKIT_SLEEP_PRESETS = [6, 7, 8, 9];
  const HEALTHKIT_SLEEP_NAP_MIN_MINUTES = 30; // sample duration < this = nap
  const HEALTHKIT_SLEEP_LOOKBACK_HOURS = 18;  // query window backwards from now

  function getSleepGoalHours(habit) {
    if (!habit) return HEALTHKIT_SLEEP_DEFAULT_GOAL_HOURS;
    const n = parseFloat(habit.sleepGoalHours);
    if (Number.isFinite(n) && n >= HEALTHKIT_SLEEP_GOAL_MIN_HOURS && n <= HEALTHKIT_SLEEP_GOAL_MAX_HOURS) {
      return n;
    }
    return HEALTHKIT_SLEEP_DEFAULT_GOAL_HOURS;
  }
  function setSleepGoalHours(habit, hours) {
    if (!habit) return HEALTHKIT_SLEEP_DEFAULT_GOAL_HOURS;
    const parsed = parseFloat(hours);
    const fallback = Number.isFinite(parsed) ? parsed : HEALTHKIT_SLEEP_DEFAULT_GOAL_HOURS;
    const n = Math.max(HEALTHKIT_SLEEP_GOAL_MIN_HOURS, Math.min(HEALTHKIT_SLEEP_GOAL_MAX_HOURS, fallback));
    habit.sleepGoalHours = n;
    save();
    return n;
  }
  // Habits whose canonical goal is hours of sleep. Replaces the time
  // stepper in Edit Habit modal with chips, like Daily walk did for
  // steps. Custom habits never qualify (foreign-key uniqueness).
  function isSleepDurationHabit(habit) {
    if (!habit) return false;
    if (habit.custom) return false;
    if (habit.name !== 'Sleep') return false;
    return true;
  }
  // Binary auto-verify habit (no goal control). Identifies the canonical
  // "Sleep before midnight" habit so its row in the Edit modal stays
  // goal-less and so meetsMinimum() can short-circuit it.
  function isSleepBedtimeHabit(habit) {
    if (!habit) return false;
    if (habit.custom) return false;
    if (habit.name !== 'Sleep before midnight') return false;
    return true;
  }
  // Single gate that aggregates all habits with HealthKit auto-verify.
  // Used by meetsMinimum() to bypass the legacy MEASURABLE_HABITS minimum
  // check — these habits source their goal (or lack thereof) from new
  // per-habit fields, not the `habit.goal` shape.
  function isHealthAutoVerifiableHabit(habit) {
    return isStepGoalHabit(habit) || isSleepDurationHabit(habit) || isSleepBedtimeHabit(habit);
  }

  function getHabitStepGoal(habit) {
    if (!habit) return HEALTHKIT_WALK_DEFAULT_THRESHOLD;
    const n = parseInt(habit.stepGoal, 10);
    if (Number.isFinite(n) && n >= HEALTHKIT_WALK_THRESHOLD_MIN && n <= HEALTHKIT_WALK_THRESHOLD_MAX) {
      return n;
    }
    return HEALTHKIT_WALK_DEFAULT_THRESHOLD;
  }
  function setHabitStepGoal(habit, steps) {
    if (!habit) return HEALTHKIT_WALK_DEFAULT_THRESHOLD;
    const parsed = parseInt(steps, 10);
    const fallback = Number.isFinite(parsed) ? parsed : HEALTHKIT_WALK_DEFAULT_THRESHOLD;
    const n = Math.max(HEALTHKIT_WALK_THRESHOLD_MIN, Math.min(HEALTHKIT_WALK_THRESHOLD_MAX, fallback));
    habit.stepGoal = n;
    save();
    return n;
  }
  // True for habits whose canonical goal is expressed in steps rather
  // than time/count. The step-goal control replaces the time/count
  // stepper in the Edit Habit modal for these habits — on every
  // platform. (Auto-verify only fires on iOS, but the goal itself is
  // a property of the habit, not contingent on HealthKit being
  // currently available.) Custom habits never qualify, even if a user
  // names theirs "Daily walk" — the canonical foreign key is exclusive
  // to the system-defined habit.
  function isStepGoalHabit(habit) {
    if (!habit) return false;
    if (habit.custom) return false;
    if (habit.name !== 'Daily walk') return false;
    return true;
  }
  function isAutoVerifyDisabled() {
    return localStorage.getItem('hb_healthkit_disabled') === '1';
  }
  function setAutoVerifyDisabled(disabled) {
    if (disabled) localStorage.setItem('hb_healthkit_disabled', '1');
    else          localStorage.removeItem('hb_healthkit_disabled');
  }

  // ── WHAT'S NEW ───────────────────────────────────────────
  // Version-keyed announcements. The What's New sheet always displays
  // the highest version's content; future releases just add a new key.
  const WHATS_NEW = {
    '1.1.5': {
      subtitle: 'The system is watching now.',
      items: [
        { emoji: '', title: 'Walk Auto-Verifies',      description: 'Daily walk auto-verifies via Apple Health when you reach your step goal. No tap needed.' },
        { emoji: '', title: 'Customizable Step Goal',  description: 'Edit your Daily walk habit to set your step goal — 1,000, 3,000, 5,000, or any amount.' },
        { emoji: '', title: 'Sleep Auto-Verifies',     description: 'Hit your sleep goal? Apple Health verifies it. Edit your Sleep habit to choose how many hours.' },
        { emoji: '', title: 'Bedtime Auto-Verifies',   description: 'Asleep before midnight? Sleep before midnight checks itself — completing your Morning Routine streak chain on its own.' },
        { emoji: '', title: 'Apple Health Settings',   description: 'Pause auto-verify or manage your connection from Settings.' },
      ],
    },
    '1.1.4': {
      subtitle: 'The system is watching now.',
      items: [
        { emoji: '', title: 'Walk Auto-Verifies',  description: "Daily walk now auto-checks via Apple Health. 3,000+ steps and the habit completes itself — no tap needed. Manual still works on Apple Health-disabled devices." },
        { emoji: '', title: 'Auto Marker',          description: 'Auto-verified completions show a subtle AUTO pill on the habit card and a small dot in History. Earned, not celebrated.' },
        { emoji: '', title: 'Privacy First',        description: "Your steps stay on your device. Awakened reads what's already there — nothing leaves your phone, nothing gets stored." },
      ],
    },
    '1.1.3': {
      subtitle: 'One reminder. The path, illustrated.',
      items: [
        { emoji: '', title: 'Morning Reminder',      description: 'A single reminder at the time you choose. No spam. No per-habit pestering. The rest is on you.' },
        { emoji: '', title: 'Custom Habit Icons',    description: 'Morning Routine and Locked-In habits now show premium-rendered art instead of emoji. Same habits — sharper visual identity.' },
        { emoji: '', title: 'Per-Habit Reminders',   description: 'Set a reminder time on any individual habit from the Schedule sheet. View Note shows whether one is set.' },
        { emoji: '', title: 'All Streaks View',      description: 'Tap the streak fire in the header to see Perfect Day, Morning Routine, and Locked-In streaks all in one place.' },
        { emoji: '', title: 'Emoji-Free Pass',       description: 'A complete pass through every screen — class banners, achievements, celebrations, toasts. Custom DALL-E art and Cinzel typography only.' },
        { emoji: '', title: 'Daily Check-In',        description: 'A single 6 PM ping that knows where you are. Cleared every habit? It congratulates you. Halfway? It cheers you on. Just starting? It invites you back to the path.' },
        { emoji: '', title: 'Dark by Design',         description: 'Settings cleaned up. Awakened is dark-mode only by design.' },
      ],
    },
    '1.1.2': {
      subtitle: 'Build your own. Look the part.',
      items: [
        { emoji: '⚡', title: 'Create Your Own Habits',     description: "Author personal habits alongside the curated 49. Pick the stat it trains; the system handles the rest. Up to 5 customs at a time, fixed at 3 XP per completion so the rank economy stays honest." },
        { emoji: '🎨', title: 'New Tab Bar Art',             description: 'Custom-rendered icons replace the emoji set. Premium feel, every tap.' },
        { emoji: '✨', title: 'Custom Stat Icons',           description: 'STR, VIT, INT, FOCUS, WILL, WLT now have premium-rendered art. Same six stats — better aesthetic.' },
        { emoji: '🎨', title: 'New App Icon',                 description: 'A glowing eye, awakening. The new mark of the path.' },
        { emoji: '🔮', title: 'New Wordmark',                  description: 'The Awakened name now reads in Cinzel — mythic, deliberate, locked in.' },
        { emoji: '📋', title: 'Drag to Reorder',                description: 'Hold and drag any habit to reorder your list. Morning habits up top, night habits at the bottom. Your list, your order.' },
        { emoji: '🔔', title: 'Reminders',                      description: 'Set a reminder for any habit. Single notification at your chosen time. Quiet hours, pause anytime, max 3 per day default. Discipline you set, not spam.' },
      ],
    },
    '1.1.1': {
      subtitle: 'Polish & fixes.',
      items: [
        { emoji: '⚔️', title: 'Awakening Fires on Lv.5',     description: 'Hit your first Lv.5 stat and the Awakening celebration now plays as intended — Chapter 2 of your origin story is written and saved.' },
        { emoji: '👆', title: 'No More Cascade Dismissals', description: "Stacked celebrations (level up → class change → awakening) no longer collapse on a single tap. Each one waits for its own moment." },
        { emoji: '📍', title: 'Tappable Stat Labels',         description: 'On the radar chart, the stat names themselves now open the stat detail — not just the dots.' },
        { emoji: '📖', title: 'Cleaner Origin Story',         description: 'The date now lives only in the chapter header. The prose opens with you — the way it should.' },
      ],
    },
    '1.1.0': {
      subtitle: 'Welcome back, hunter.',
      items: [
        { emoji: '🦸', title: 'Custom Character Avatars',     description: 'Your status screen now shows a class-specific hero silhouette that evolves with your rank.' },
        { emoji: '🌅', title: 'Add Morning Routine Anytime',  description: 'Missed it during onboarding? Add the full 10-habit pack with one tap from the Habits tab.' },
        { emoji: '⚡', title: 'Compound Effect for Everyone', description: 'Build the Morning Routine your own way. Custom-path users now earn the daily bonus too.' },
        { emoji: '🎨', title: 'History in Color',             description: "Every completion box now reflects the stat you're building. Tap any habit to see why." },
        { emoji: '📖', title: 'Habit Detail Pages',           description: 'Long-press any habit to view full stats, streak data, and the philosophy behind it.' },
        { emoji: '🎺', title: 'Triumphant Fanfare',           description: 'Completing the full Morning Routine now plays the celebration it deserves.' },
        { emoji: '🔒', title: 'Locked-In Pack',               description: 'A new 16-habit pack covering the full discipline cycle. Master the day, earn a second compound bonus.' },
        { emoji: '🏆', title: 'Personal Records',             description: 'Track lifetime bests across 10 metrics on the Status tab. Break them. Repeat.' },
        { emoji: '🧍', title: 'Civilian Class & The Awakening', description: "Class is now earned, not assumed. Train any stat to Lv5 to awaken into your true path. Lv5 in two paths at once? You choose." },
        { emoji: '⚔️', title: 'Daily Legendary Mission', description: "A multi-component challenge appears every day. All-or-nothing bonus XP. Weekends lean toward stepping outside. Most won't attempt it — the days you do are the days that count." },
        { emoji: '🛡️', title: 'Streak Forgiveness',     description: "Earn a Streak Shield every 14 days. Take an Honest Rest once a month. Get Resilience XP when you come back. Streaks should reward consistency, not punish humanity." },
        { emoji: '📜', title: 'Origin Stories',           description: "Your start has been written. Your awakening will be written. A two-chapter narrative, yours alone, saved forever." },
      ],
    },
  };

  // Returns the highest semver key from WHATS_NEW (e.g., "1.1.0")
  function getLatestWhatsNewVersion() {
    const keys = Object.keys(WHATS_NEW);
    if (!keys.length) return null;
    keys.sort(compareSemver);
    return keys[keys.length - 1]; // highest at the end after ascending sort
  }
  // Returns negative if a < b, positive if a > b, zero if equal.
  function compareSemver(a, b) {
    const ap = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
    const bp = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
      const av = ap[i] || 0, bv = bp[i] || 0;
      if (av !== bv) return av - bv;
    }
    return 0;
  }

  // Habits that have a quantifiable goal (name → { unit, def, step, min })
  // min = minimum goal value required to check off; bodyweightMin = use stored bodyweight as min
  const MEASURABLE_HABITS = {
    'Hydrate':                            { unit: 'glasses', def: 6,   step: 1,   min: 6  },
    'Sleep':                              { unit: 'hrs',     def: 7,   step: 0.5, min: 7  },
    'Cardio workout':                     { unit: 'min',     def: 30,  step: 5,   min: 20 },
    'Strength training':                  { unit: 'min',     def: 30,  step: 5,   min: 20 },
    'Sprint session':                     { unit: 'min',     def: 15,  step: 5,   min: 10 },
    'Daily walk':                         { unit: 'min',     def: 30,  step: 5,   min: 15 },
    'Ice bath or cold plunge':            { unit: 'min',     def: 5,   step: 1,   min: 5  },
    'Cold shower':                        { unit: 'min',     def: 5,   step: 1,   min: 3  },
    'Mobility & Stretching':              { unit: 'min',     def: 15,  step: 5,   min: 10 },
    'Protein goal':                       { unit: 'g',       def: 150, step: 5,   min: 0, bodyweightMin: true },
    'Read':                               { unit: 'min',     def: 20,  step: 5,   min: 10 },
    'Meditate & Breathwork':              { unit: 'min',     def: 10,  step: 5,   min: 5  },
    'Get morning sunlight':               { unit: 'min',     def: 15,  step: 5,   min: 10 },
    'Work on a side project or business': { unit: 'min',     def: 30,  step: 5,   min: 30 },
    'Educational podcast':               { unit: 'min',     def: 20,  step: 5,   min: 15 },
    'Practice a skill':                   { unit: 'min',     def: 20,  step: 5,   min: 15 },
    'Flashcard review':                   { unit: 'min',     def: 15,  step: 5,   min: 10 },
    'Language learning':                  { unit: 'min',     def: 20,  step: 5,   min: 15 },
    'Barefoot grounding outside':         { unit: 'min',     def: 15,  step: 5,   min: 10 },
    'Visualization practice':             { unit: 'min',     def: 10,  step: 5,   min: 5  },
  };

  // Returns { base, goal } — goal is null if no goal explicitly set by user.
  //
  // HealthKit-auto-verifiable habits pre-empt the legacy MEASURABLE_HABITS
  // branch below:
  //   - Daily walk → "{N} steps" from getHabitStepGoal(habit)
  //   - Sleep      → "{N} hours" / "1 hour" from getSleepGoalHours(habit)
  //   - Sleep before midnight → no subtitle (binary habit, no goal)
  //
  // v1.1.4 users may still have habit.goal = {value: 30, unit: 'min'}
  // stored from the old time-based stepper — that field is silently
  // ignored from v1.1.5 onward; no migration. Their first save in the
  // Edit modal writes habit.stepGoal / habit.sleepGoalHours; the
  // legacy goal field can stay orphaned.
  function habitDisplayParts(habit) {
    if (isStepGoalHabit(habit)) {
      return { base: habit.name, goal: getHabitStepGoal(habit).toLocaleString() + ' steps' };
    }
    if (isSleepDurationHabit(habit)) {
      const h = getSleepGoalHours(habit);
      return { base: habit.name, goal: h + (h === 1 ? ' hour' : ' hours') };
    }
    if (isSleepBedtimeHabit(habit)) {
      // Binary auto-verify habit — no goal text. The base name alone
      // ("Sleep before midnight") already conveys the rule.
      return { base: habit.name, goal: null };
    }
    const m = MEASURABLE_HABITS[habit.name];
    if (!m) return { base: habit.name, goal: null };
    if (!habit.goal) return { base: habit.name, goal: null };
    return { base: habit.name, goal: habit.goal.value.toLocaleString() + ' ' + habit.goal.unit };
  }

  // Plain-text display name (for truncation / history labels)
  function habitDisplayName(habit) {
    const { base, goal } = habitDisplayParts(habit);
    return goal ? base + ' • ' + goal : base;
  }

  // Clean base name (no duration/quantity suffix) — used by the History tab
  // so rows read "Strength training" instead of "Strength training • 30 min".
  // Other tabs continue to use habitDisplayName for the full version.
  function habitBaseName(habit) {
    return habitDisplayParts(habit).base;
  }

  // Canonical description shown on the View Note sheet.
  // Pulled from the master library DEFAULT_HABITS by name — never from
  // user-editable storage. Returns empty string if no description exists.
  function getHabitDescription(habit) {
    if (!habit || !habit.name) return '';
    // Custom habits aren't in the master library — give them a generic
    // but on-brand description rather than falling back to "coming soon."
    if (habit.custom) {
      return 'A custom habit you chose for yourself. Build it day by day.';
    }
    const def = DEFAULT_HABITS.find(d => d.name === habit.name);
    return (def && def.description) || '';
  }

  // One-sentence description of what each stat builds — shown in the
  // History tab's per-habit info popup. (The longer multi-sentence
  // STAT_DESCRIPTIONS used by the Stats detail screen lives elsewhere.)
  const STAT_INFO_BLURB = {
    STR:   'Builds your physical strength and discipline.',
    VIT:   'Builds your vitality, recovery, and physical wellbeing.',
    INT:   'Builds your knowledge, learning, and mental sharpness.',
    FOCUS: 'Builds your concentration and resistance to distraction.',
    WILL:  'Builds your discipline, consistency, and mental toughness.',
    WLT:   'Builds your financial intelligence and long-term wealth.',
  };

  // Rich HTML for the main card — bullet is styled in muted purple
  function habitDisplayHTML(habit) {
    const { base, goal } = habitDisplayParts(habit);
    if (!goal) return esc(base);
    return esc(base) + '<span class="habit-name-sep"> • </span>' + esc(goal);
  }

  // ── DAILY QUOTES (Feature 2) ─────────────────────────────
  const QUOTES = [
    // Habit / discipline classics
    { text: 'We are what we repeatedly do. Excellence is not an act, but a habit.',                       attr: '— Aristotle' },
    { text: 'The secret of your future is hidden in your daily routine.',                                  attr: '— Mike Murdock' },
    { text: 'Small disciplines repeated with consistency every day lead to great achievements.',           attr: '— John Maxwell' },
    { text: 'You do not rise to the level of your goals. You fall to the level of your systems.',          attr: '— James Clear' },
    { text: 'Every action you take is a vote for the type of person you wish to become.',                  attr: '— James Clear' },
    { text: 'The chains of habit are too weak to be felt until they are too strong to be broken.',         attr: '— Samuel Johnson' },
    { text: 'Win the morning, win the day.',                                                               attr: '— Tim Ferriss' },
    { text: 'Motivation gets you started. Habit keeps you going.',                                         attr: '— Jim Ryun' },
    { text: 'An ounce of practice is worth more than a ton of theory.',                                    attr: '— Mahatma Gandhi' },
    { text: 'The difference between who you are and who you want to be is what you do.',                   attr: '— Anonymous' },
    { text: 'Success is the sum of small efforts repeated day in and day out.',                            attr: '— Robert Collier' },
    { text: 'Discipline is the bridge between goals and accomplishment.',                                  attr: '— Jim Rohn' },
    { text: 'It is not that we have a short time to live, but that we waste a good deal of it.',           attr: '— Seneca' },
    { text: 'A year from now you will wish you had started today.',                                        attr: '— Karen Lamb' },
    { text: 'Show up every day. That alone puts you ahead of most.',                                       attr: '— Anonymous' },

    // Stoic / philosophical
    { text: 'Waste no more time arguing what a good man should be. Be one.',                               attr: '— Marcus Aurelius' },
    { text: 'You have power over your mind — not outside events. Realize this, and you will find strength.', attr: '— Marcus Aurelius' },
    { text: 'The impediment to action advances action. What stands in the way becomes the way.',           attr: '— Marcus Aurelius' },
    { text: 'Confine yourself to the present.',                                                            attr: '— Marcus Aurelius' },
    { text: 'First say to yourself what you would be; then do what you have to do.',                       attr: '— Epictetus' },
    { text: 'It is not what happens to you, but how you react to it that matters.',                        attr: '— Epictetus' },
    { text: 'No man is free who is not master of himself.',                                                attr: '— Epictetus' },
    { text: 'While we wait for life, life passes.',                                                        attr: '— Seneca' },
    { text: 'Difficulties strengthen the mind, as labor does the body.',                                   attr: '— Seneca' },
    { text: 'Luck is what happens when preparation meets opportunity.',                                    attr: '— Seneca' },
    { text: 'Excellence is never an accident. It is the result of high intention and intelligent execution.', attr: '— Aristotle' },

    // Habit / self-improvement / discipline
    { text: 'Habits are the compound interest of self-improvement.',                                       attr: '— James Clear' },
    { text: 'You should be far more concerned with your current trajectory than with your current results.', attr: '— James Clear' },
    { text: 'Get 1% better every day.',                                                                    attr: '— James Clear' },
    { text: 'Discipline equals freedom.',                                                                  attr: '— Jocko Willink' },
    { text: "When things are going bad, don't take yourself with them.",                                   attr: '— Jocko Willink' },
    { text: 'Clarity about what matters provides clarity about what does not.',                            attr: '— Cal Newport' },
    { text: 'Human beings are at their best when immersed deeply in something challenging.',               attr: '— Cal Newport' },
    { text: 'Whatever the mind can conceive and believe, it can achieve.',                                 attr: '— Napoleon Hill' },
    { text: 'Patience, persistence, and perspiration make an unbeatable combination for success.',         attr: '— Napoleon Hill' },
    { text: "The key is not to prioritize what's on your schedule, but to schedule your priorities.",      attr: '— Stephen Covey' },
    { text: 'Begin with the end in mind.',                                                                 attr: '— Stephen Covey' },
    { text: 'Most people stop at 40% of their true capacity.',                                             attr: '— David Goggins' },
    { text: "Don't stop when you're tired. Stop when you're done.",                                        attr: '— David Goggins' },
    { text: 'Stay hard.',                                                                                  attr: '— David Goggins' },

    // Trading psychology / probabilistic thinking
    { text: 'The best traders think in probabilities.',                                                    attr: '— Mark Douglas' },
    { text: "You don't need to know what's going to happen next to make money.",                           attr: '— Mark Douglas' },
    { text: 'Play long-term games with long-term people.',                                                 attr: '— Naval Ravikant' },
    { text: 'Earn with your mind, not your time.',                                                         attr: '— Naval Ravikant' },
    { text: 'Read what you love until you love to read.',                                                  attr: '— Naval Ravikant' },
    { text: 'The most important skill for getting rich is becoming a perpetual learner.',                  attr: '— Naval Ravikant' },

    // Performance / mindset
    { text: 'Great things come from hard work and perseverance. No excuses.',                              attr: '— Kobe Bryant' },
    { text: 'Rest at the end, not in the middle.',                                                         attr: '— Kobe Bryant' },
    { text: 'I have failed over and over again in my life. That is why I succeed.',                        attr: '— Michael Jordan' },
    { text: 'Some people want it to happen, some wish it would happen, others make it happen.',            attr: '— Michael Jordan' },
    { text: 'Be water, my friend.',                                                                        attr: '— Bruce Lee' },
    { text: 'Knowing is not enough; we must apply. Willing is not enough; we must do.',                    attr: '— Bruce Lee' },
    { text: 'The supreme art of war is to subdue the enemy without fighting.',                             attr: '— Sun Tzu' },
    { text: 'In the midst of chaos, there is also opportunity.',                                           attr: '— Sun Tzu' },

    // Modern motivation
    { text: 'Effort is the only currency that creates lasting change.',                                    attr: '— Andrew Huberman' },
    { text: 'The longer the time horizon, the lower the competition.',                                     attr: '— Alex Hormozi' },
    { text: "Hard work beats talent when talent doesn't work hard.",                                       attr: '— Alex Hormozi' },
    { text: 'Focus on being productive instead of busy.',                                                  attr: '— Tim Ferriss' },
    { text: 'What we fear doing most is usually what we most need to do.',                                 attr: '— Tim Ferriss' },
    { text: 'It does not matter how slowly you go as long as you do not stop.',                            attr: '— Confucius' },
  ];

  const RANKS = [
    { id: 'E',  label: 'E Rank',  desc: 'Just getting started',                                       min: 0,     max: 499,    next: 500   },
    { id: 'D',  label: 'D Rank',  desc: 'Building awareness',                                         min: 500,   max: 1499,   next: 1500  },
    { id: 'C',  label: 'C Rank',  desc: 'Consistency is forming',                                     min: 1500,  max: 3499,   next: 3500  },
    { id: 'B',  label: 'B Rank',  desc: 'Above average discipline. Most people never get here.',      min: 3500,  max: 6999,   next: 7000  },
    { id: 'A',  label: 'A Rank',  desc: 'True excellence. This is rare.',                             min: 7000,  max: 13999,  next: 14000 },
    { id: 'S',  label: 'S Rank',  desc: 'Elite. You have become the habit.',                          min: 14000, max: 27999,  next: 28000 },
    { id: 'S+', label: 'S+ Rank', desc: 'Legendary. Less than 1% of humans operate at this level.',  min: 28000, max: Infinity, next: null },
  ];

  // ── PERSONAL RECORDS (PRs) ───────────────────────────────
  // 10 lifetime-best metrics. Single source of truth — change only here.
  // tier: 1 = subtle toast, 2 = modal, 3 = full-screen takeover
  // Master switch: when false, PRs still track and display silently
  // (visible via the 🏆 chip on the Status tab) but never fire popups.
  const PR_CELEBRATIONS_ENABLED = false;
  const PR_DEFS = [
    { id: 'most_habits_day',       label: 'habits in a day',     accent: '#a855f7', icon: '🏆',
      tier: 2, motivation: "Volume reveals what's possible. Break it again.",
      description: 'Most habits completed in a single day.' },
    { id: 'most_xp_day',           label: 'XP in a day',         accent: '#a855f7', icon: '⚡',
      tier: 2, motivation: "Volume reveals what's possible. Break it again.",
      description: 'Highest XP earned in a single day.' },
    { id: 'longest_mr_streak',     label: 'longest MR streak',   accent: '#f59e0b', icon: '🌅',
      tier: 3, takeoverDays: [30, 60, 100, 200, 365],
      motivation: 'Days you owned. Keep stacking.',
      description: 'Longest Morning Routine compound streak ever.' },
    { id: 'longest_li_streak',     label: 'longest LI streak',   accent: '#7c3aed', icon: '🔒',
      tier: 3, takeoverDays: [30, 60, 100, 200, 365],
      motivation: 'Days you owned. Keep stacking.',
      description: 'Longest Locked-In compound streak ever.' },
    { id: 'longest_stat_streak',   label: 'top stat streak',     accent: 'stat',    icon: '📈',
      tier: 2, motivation: "Specialization compounds. Don't lose the focus.",
      description: 'Longest single-stat consistency streak.' },
    { id: 'longest_habit_streak',  label: 'top habit streak',    accent: '#fbbf24', icon: '🔥',
      tier: 2, motivation: "Specialization compounds. Don't lose the focus.",
      description: 'Longest streak ever held by any single habit.' },
    { id: 'total_habits_lifetime', label: 'habits lifetime',     accent: '#f59e0b', icon: '✅',
      tier: 1, milestones: [100, 500, 1000, 5000, 10000],
      motivation: 'Every rep counts. The number only goes up.',
      description: 'Total habits completed across your entire journey.' },
    { id: 'total_xp_lifetime',     label: 'XP lifetime',         accent: '#f59e0b', icon: '💎',
      tier: 1, milestones: [500, 1000, 5000, 10000, 50000],
      motivation: 'Every rep counts. The number only goes up.',
      description: 'Total XP earned including all bonuses.' },
    { id: 'total_active_days',     label: 'active days',         accent: '#f59e0b', icon: '📅',
      tier: 1, milestones: [50, 100, 365, 730],
      motivation: 'Every rep counts. The number only goes up.',
      description: 'Calendar days you completed at least one habit.' },
    { id: 'highest_rank',          label: 'highest rank',        accent: '#fbbf24', icon: '👑',
      tier: 3,
      motivation: "You've been here before. Don't forget what you're capable of.",
      description: 'Highest rank tier you have ever reached.' },
    { id: 'total_missions_complete', label: 'missions complete',  accent: '#f59e0b', icon: '⚔️',
      tier: 1, milestones: [10, 25, 50, 100],
      motivation: "Most won't attempt them. The days you finish them are the days that count.",
      description: 'Lifetime count of fully-completed Legendary Missions.' },
  ];

  // ── DAILY LEGENDARY MISSIONS ─────────────────────────────
  // 30 multi-component daily challenges. Each has 2-6 components.
  // Component matchType: 'habit' = auto-checks when matching habit completed
  //                      'manual' = user toggles to confirm
  //                      'pack'   = derives from full pack completion
  const LEGENDARY_MISSIONS = [
    // EASIER (2-3 components)
    { id: 'athletes-morning', name: "The Athlete's Morning",
      description: "Cold plunge, sweat, fuel — the body chooses the day's tone.",
      tags: ['physical'],
      components: [
        { id: 'cold',     text: 'Cold shower',          matchType: 'habit', habitName: 'Cold shower' },
        { id: 'workout',  text: '30-min workout',       matchType: 'habit', habitName: 'Strength training' },
        { id: 'protein',  text: 'Protein meal goal',    matchType: 'habit', habitName: 'Protein goal' },
      ] },
    { id: 'triple-discipline', name: "The Triple Discipline",
      description: "Body, mind, knowledge — all three sharpened in one day.",
      tags: ['discipline', 'mental'],
      components: [
        { id: 'workout',  text: 'Workout',              matchType: 'habit', habitName: 'Strength training' },
        { id: 'meditate', text: 'Meditate & Breathwork',matchType: 'habit', habitName: 'Meditate & Breathwork' },
        { id: 'read',     text: 'Read 30+ pages',       matchType: 'habit', habitName: 'Read' },
      ] },
    { id: 'body-reset', name: "Body Reset",
      description: "Empty stomach, cold water, long miles. The reset.",
      tags: ['physical', 'recovery'],
      components: [
        { id: 'fasted',   text: 'Fasted morning workout', matchType: 'manual' },
        { id: 'plunge',   text: 'Cold plunge',          matchType: 'habit', habitName: 'Ice bath or cold plunge' },
        { id: 'walk',     text: '10k+ steps',           matchType: 'habit', habitName: 'Daily walk' },
      ] },
    { id: 'mind-over-matter', name: "Mind Over Matter",
      description: "Quiet the mind. Move the body. Capture the lesson.",
      tags: ['mental', 'physical'],
      components: [
        { id: 'meditate', text: '30-min meditation',    matchType: 'habit', habitName: 'Meditate & Breathwork' },
        { id: 'journal',  text: 'Journal',              matchType: 'habit', habitName: 'Journal' },
        { id: 'workout',  text: '30-min workout',       matchType: 'habit', habitName: 'Strength training' },
      ] },
    { id: 'discipline-trio', name: "Discipline Trio",
      description: "Same time. Cold start. Move the body. Three locks, one day.",
      tags: ['discipline'],
      components: [
        { id: 'wake',     text: 'Wake at consistent time', matchType: 'habit', habitName: 'Wake up at consistent time' },
        { id: 'cold',     text: 'Cold shower',          matchType: 'habit', habitName: 'Cold shower' },
        { id: 'workout',  text: 'Workout',              matchType: 'habit', habitName: 'Strength training' },
      ] },
    { id: 'nutrition-lock', name: "Nutrition Lock",
      description: "Eat like the body is a temple. Nothing processed crosses the line.",
      tags: ['nutrition', 'discipline'],
      components: [
        { id: 'whole',    text: 'Whole foods only',     matchType: 'habit', habitName: 'Whole foods diet' },
        { id: 'protein',  text: 'Protein goal',         matchType: 'habit', habitName: 'Protein goal' },
        { id: 'no-sugar', text: 'No sugar/junk food',   matchType: 'habit', habitName: 'No sugar/junk food' },
      ] },
    { id: 'learning-stack', name: "Learning Stack",
      description: "Input, practice, capture. The full learning loop in one day.",
      tags: ['mental'],
      components: [
        { id: 'read',     text: 'Read 20+ pages',       matchType: 'habit', habitName: 'Read' },
        { id: 'practice', text: 'Practice a skill 30+ min', matchType: 'habit', habitName: 'Practice a skill' },
        { id: 'lessons',  text: 'Write what you learned', matchType: 'habit', habitName: 'Write down lessons learned' },
      ] },
    { id: 'connection-reflection', name: "Connection + Reflection",
      description: "Real conversation. Real reflection.",
      tags: ['wellbeing'],
      components: [
        { id: 'connect',  text: 'Real conversation 30+ min', matchType: 'manual' },
        { id: 'journal',  text: 'Journal what you learned',  matchType: 'habit', habitName: 'Journal' },
      ] },

    // MEDIUM (4 components)
    { id: 'deep-work-sprint', name: "Deep Work Sprint",
      description: "One block. No noise. Output before consumption.",
      tags: ['discipline', 'mental'],
      components: [
        { id: 'block',    text: '90-min single-task block', matchType: 'manual' },
        { id: 'no-soc',   text: 'No social until done',    matchType: 'habit', habitName: 'No social media before noon' },
        { id: 'plan',     text: 'Plan tomorrow',           matchType: 'habit', habitName: 'Plan tomorrow the night before' },
        { id: 'journal',  text: 'Journal',                 matchType: 'habit', habitName: 'Journal' },
      ] },
    { id: 'the-operator', name: "The Operator",
      description: "Before most people are awake, you've already won.",
      tags: ['discipline'],
      components: [
        { id: 'wake',     text: 'Wake before 6 AM',        matchType: 'manual' },
        { id: 'plunge',   text: 'Cold plunge',             matchType: 'habit', habitName: 'Ice bath or cold plunge' },
        { id: 'workout',  text: 'Workout',                 matchType: 'habit', habitName: 'Strength training' },
        { id: 'block',    text: '90-min focus block before 10 AM', matchType: 'manual' },
      ] },
    { id: 'output-sprint', name: "Output Sprint",
      description: "Make. Ship. Reflect. Read.",
      tags: ['discipline', 'mental'],
      components: [
        { id: 'priority', text: 'Complete #1 priority task', matchType: 'habit', habitName: 'Complete your #1 priority task' },
        { id: 'ship',     text: 'Ship something publicly',  matchType: 'manual' },
        { id: 'reflect',  text: 'Reflect on it',            matchType: 'habit', habitName: 'Journal' },
        { id: 'read',     text: 'Read 20+ pages',           matchType: 'habit', habitName: 'Read' },
      ] },
    { id: 'triple-threat', name: "The Triple Threat",
      description: "Body, mind, focus, restraint — held all at once.",
      tags: ['discipline'],
      components: [
        { id: 'workout',  text: 'Workout',              matchType: 'habit', habitName: 'Strength training' },
        { id: 'meditate', text: 'Meditate',             matchType: 'habit', habitName: 'Meditate & Breathwork' },
        { id: 'read',     text: 'Read 30+ pages',       matchType: 'habit', habitName: 'Read' },
        { id: 'no-soc',   text: 'No social until 5 PM', matchType: 'habit', habitName: 'No doomscrolling until after 5PM' },
      ] },
    { id: 'no-input-day', name: "No Input Day",
      description: "Stop consuming. Listen to what surfaces.",
      tags: ['no-phone', 'mental'],
      components: [
        { id: 'no-soc',   text: 'No social media',         matchType: 'habit', habitName: 'No phone or social media after waking' },
        { id: 'no-pod',   text: 'No podcasts until 5 PM',  matchType: 'manual' },
        { id: 'no-music', text: 'No music until 5 PM',     matchType: 'manual' },
        { id: 'journal',  text: 'Journal what surfaced',   matchType: 'habit', habitName: 'Journal' },
      ] },

    // HARD (5-6 components)
    { id: 'locked-in-day', name: "The Locked-In Day",
      description: "All 10 morning habits + a deep work block + tomorrow planned.",
      tags: ['discipline'],
      components: [
        { id: 'mr',       text: 'All 10 Morning Routine habits', matchType: 'pack', packId: 'morning' },
        { id: 'block',    text: '90-min deep work block',  matchType: 'manual' },
        { id: 'plan',     text: 'Plan tomorrow',           matchType: 'habit', habitName: 'Plan tomorrow the night before' },
      ] },
    { id: 'awakening-day', name: "The Awakening Day",
      description: "Full Locked-In pack + journal at the end of the day.",
      tags: ['discipline'],
      components: [
        { id: 'li',       text: 'All 16 Locked-In habits', matchType: 'pack', packId: 'locked-in' },
        { id: 'journal',  text: 'Journal at end of day',   matchType: 'habit', habitName: 'Journal' },
      ] },
    { id: 'the-monk', name: "The Monk",
      description: "No screens, sunrise to sunset. Two hours of stillness. Pages of writing.",
      tags: ['no-phone', 'mental'],
      components: [
        { id: 'detox',    text: 'Full digital detox sunrise to sunset', matchType: 'manual' },
        { id: 'meditate', text: '2 hours total meditation',    matchType: 'habit', habitName: 'Meditate & Breathwork' },
        { id: 'journal',  text: 'Extensive journaling',        matchType: 'habit', habitName: 'Journal' },
      ] },
    { id: 'compound-day', name: "Compound Day",
      description: "Earn the bonus. Then earn three more hard habits on top.",
      tags: ['discipline'],
      components: [
        { id: 'compound', text: 'Earn the Compound Effect Bonus', matchType: 'manual' },
        { id: 'hard3',    text: 'Complete 3 Hard difficulty habits', matchType: 'manual' },
        { id: 'read',     text: 'Read 30+ pages',           matchType: 'habit', habitName: 'Read' },
        { id: 'workout',  text: 'Workout',                  matchType: 'habit', habitName: 'Strength training' },
      ] },
    { id: 'the-gauntlet', name: "The Gauntlet",
      description: "Volume. Pure volume. The body learns by repetition.",
      tags: ['physical'],
      components: [
        { id: 'pushups',  text: '100 pushups',              matchType: 'manual' },
        { id: 'squats',   text: '100 squats',               matchType: 'manual' },
        { id: 'plank',    text: '5-min plank',              matchType: 'manual' },
        { id: 'walk5',    text: '5-mile walk',              matchType: 'habit', habitName: 'Daily walk' },
      ] },
    { id: 'total-reset', name: "Total Reset",
      description: "Empty the tank. Refill from the inside.",
      tags: ['discipline', 'recovery'],
      components: [
        { id: 'fast24',   text: '24-hour fast',             matchType: 'manual' },
        { id: 'workout',  text: '60-min workout',           matchType: 'habit', habitName: 'Strength training' },
        { id: 'meditate', text: '30-min meditation',        matchType: 'habit', habitName: 'Meditate & Breathwork' },
        { id: 'read',     text: 'Read 50+ pages',           matchType: 'habit', habitName: 'Read' },
      ] },
    { id: 'hunters-trial', name: "The Hunter's Trial",
      description: "Six denials. One day. The hardest are worth the most.",
      tags: ['discipline', 'no-phone'],
      components: [
        { id: 'plunge',   text: 'Cold plunge',              matchType: 'habit', habitName: 'Ice bath or cold plunge' },
        { id: 'fasted',   text: 'Fasted workout',           matchType: 'manual' },
        { id: 'no-caf',   text: 'No caffeine',              matchType: 'habit', habitName: 'No caffeine' },
        { id: 'no-alc',   text: 'No alcohol',               matchType: 'habit', habitName: 'No alcohol' },
        { id: 'no-sugar', text: 'No sugar',                 matchType: 'habit', habitName: 'No sugar/junk food' },
        { id: 'no-soc',   text: 'No social media all day',  matchType: 'habit', habitName: 'No phone or social media after waking' },
      ] },

    // THEMED
    { id: 'mental-sharpen', name: "Mental Sharpen",
      description: "Read deep. Practice hard. Memorize. Reflect.",
      tags: ['mental'],
      components: [
        { id: 'read',     text: 'Read 50+ pages',           matchType: 'habit', habitName: 'Read' },
        { id: 'practice', text: 'Practice a skill 60 min',  matchType: 'habit', habitName: 'Practice a skill' },
        { id: 'memorize', text: 'Memorize a quote',         matchType: 'manual' },
        { id: 'journal',  text: 'Journal',                  matchType: 'habit', habitName: 'Journal' },
      ] },
    { id: 'the-centurion', name: "The Centurion",
      description: "100 + 100 + 100 + a mile.",
      tags: ['physical'],
      components: [
        { id: 'pushups',  text: '100 pushups',              matchType: 'manual' },
        { id: 'squats',   text: '100 squats',               matchType: 'manual' },
        { id: 'situps',   text: '100 sit-ups',              matchType: 'manual' },
        { id: 'run',      text: '1-mile run',               matchType: 'habit', habitName: 'Cardio workout' },
      ] },
    { id: 'silence-protocol', name: "Silence Protocol",
      description: "Twelve hours quiet. An hour each: stillness, writing, walking.",
      tags: ['no-phone', 'mental'],
      components: [
        { id: 'no-phone', text: 'No phone for 12 hours',    matchType: 'manual' },
        { id: 'meditate', text: 'Meditate 60 min',          matchType: 'habit', habitName: 'Meditate & Breathwork' },
        { id: 'journal',  text: 'Journal 60 min',           matchType: 'habit', habitName: 'Journal' },
        { id: 'walk',     text: 'Long outdoor walk',        matchType: 'habit', habitName: 'Daily walk' },
      ] },
    { id: 'discipline-test', name: "The Discipline Test",
      description: "Six locks. From wake to plan. The full chain held.",
      tags: ['discipline', 'no-phone'],
      components: [
        { id: 'wake',     text: 'Wake before 6 AM',         matchType: 'manual' },
        { id: 'plunge',   text: 'Cold plunge',              matchType: 'habit', habitName: 'Ice bath or cold plunge' },
        { id: 'fasted',   text: 'Fasted workout',           matchType: 'manual' },
        { id: 'no-soc',   text: 'No social until evening',  matchType: 'habit', habitName: 'No social media before noon' },
        { id: 'read',     text: 'Read 30+ pages',           matchType: 'habit', habitName: 'Read' },
        { id: 'plan',     text: 'Plan tomorrow',            matchType: 'habit', habitName: 'Plan tomorrow the night before' },
      ] },

    // OUTDOOR / NATURE / NO-PHONE (weekend-weighted)
    { id: 'forest-reset', name: "Forest Reset",
      description: "Phone away. Trees in. Notice what you've stopped seeing.",
      tags: ['outdoor', 'nature', 'no-phone'],
      components: [
        { id: 'walk-nat', text: '2-hour outdoor walk in nature', matchType: 'manual' },
        { id: 'no-phone', text: 'No phone during walk',     matchType: 'manual' },
        { id: 'journal',  text: 'Journal what you noticed', matchType: 'habit', habitName: 'Journal' },
      ] },
    { id: 'sunrise-mission', name: "Sunrise Mission",
      description: "Outside before the sun. The day starts before everyone else's.",
      tags: ['outdoor', 'nature', 'no-phone'],
      components: [
        { id: 'pre-sun',  text: 'Wake before sunrise',      matchType: 'manual' },
        { id: 'sunrise',  text: 'Watch the sunrise outside', matchType: 'habit', habitName: 'Get morning sunlight' },
        { id: 'walk',     text: 'Outdoor walk',             matchType: 'habit', habitName: 'Daily walk' },
        { id: 'no-phone', text: 'No phone until breakfast', matchType: 'habit', habitName: 'No phone or social media after waking' },
      ] },
    { id: 'trail-day', name: "Trail Day",
      description: "Long path. No screen. Bare feet on earth.",
      tags: ['outdoor', 'nature', 'no-phone', 'physical'],
      components: [
        { id: 'hike',     text: 'Hike or walk 5+ miles',    matchType: 'manual' },
        { id: 'no-phone', text: 'No phone except emergencies', matchType: 'manual' },
        { id: 'ground',   text: '10-min barefoot grounding', matchType: 'habit', habitName: 'Barefoot grounding outside' },
      ] },
    { id: 'the-naturalist', name: "The Naturalist",
      description: "Four hours outside. Five new things noticed. All written down.",
      tags: ['outdoor', 'nature'],
      components: [
        { id: 'outside4', text: '4+ hours outside today',   matchType: 'manual' },
        { id: 'notice5',  text: 'Identify 5 new things in nature', matchType: 'manual' },
        { id: 'journal',  text: 'Journal what you saw',     matchType: 'habit', habitName: 'Journal' },
      ] },
    { id: 'phone-off-world-on', name: "Phone Off, World On",
      description: "Eight hours airplane mode. Real conversation. The world that isn't on a screen.",
      tags: ['no-phone', 'outdoor', 'wellbeing'],
      components: [
        { id: 'airplane', text: 'Airplane mode 8 daylight hours', matchType: 'manual' },
        { id: 'walk',     text: '1+ hour outdoor walk',     matchType: 'habit', habitName: 'Daily walk' },
        { id: 'connect',  text: 'In-person meaningful conversation', matchType: 'habit', habitName: 'Call or text a family member' },
      ] },
    { id: 'the-long-walk', name: "The Long Walk",
      description: "Ten miles. Quiet for most of it. Written reflection at the end.",
      tags: ['outdoor', 'physical', 'no-phone'],
      components: [
        { id: 'walk10',   text: '10+ mile walk outdoors',   matchType: 'manual' },
        { id: 'no-phone', text: 'Phone limited (max 2hr audio)', matchType: 'manual' },
        { id: 'reflect',  text: 'Reflect in writing afterward', matchType: 'habit', habitName: 'Journal' },
      ] },
  ];

  // Achievement categories drive the section grouping in the UI.
  const ACH_CATEGORIES = [
    { id: 'streaks',  label: 'Streaks' },
    { id: 'rank',     label: 'Rank & Points' },
    { id: 'class',    label: 'Class & Awakening' },
    { id: 'packs',    label: 'Packs' },
    { id: 'quests',   label: 'Daily Quests' },
    { id: 'habits',   label: 'Habit Mastery' },
    { id: 'lifetime', label: 'Lifetime' },
  ];

  // Each achievement: id, icon, name, desc, category, target, getProgress(ctx).
  // getProgress(ctx) returns { current: N, target: T } so the UI can show
  // a live progress bar like "12 / 30 days" on locked rows. ctx is built
  // once in checkAchievements() and reused by render code.
  const ACHIEVEMENTS = [
    // ── 🔥 STREAKS ──────────────────────────────────────────
    { id: 'week_warrior',   category: 'streaks', icon: '🗓️', name: 'Week Warrior',
      desc: '7-day streak on any habit', target: 7,
      getProgress: c => ({ current: Math.min(c.maxStreak, 7), target: 7 }) },
    { id: 'streak_hunter',  category: 'streaks', icon: '🔥', name: 'Streak Hunter',
      desc: '30-day streak on any habit', target: 30,
      getProgress: c => ({ current: Math.min(c.maxStreak, 30), target: 30 }) },
    { id: 'iron_will',      category: 'streaks', icon: '⚔️', name: 'Iron Will',
      desc: '100-day streak on any habit', target: 100,
      getProgress: c => ({ current: Math.min(c.maxStreak, 100), target: 100 }) },
    { id: 'streak_200',     category: 'streaks', icon: '🌑', name: 'The 200',
      desc: '200-day streak on any habit', target: 200,
      getProgress: c => ({ current: Math.min(c.maxStreak, 200), target: 200 }) },
    { id: 'streak_365',     category: 'streaks', icon: '🌟', name: 'The 365',
      desc: 'Full year streak on any habit', target: 365,
      getProgress: c => ({ current: Math.min(c.maxStreak, 365), target: 365 }) },
    { id: 'streak_730',     category: 'streaks', icon: '👑', name: 'Two Years In',
      desc: '730-day streak on any habit', target: 730,
      getProgress: c => ({ current: Math.min(c.maxStreak, 730), target: 730 }) },

    // ── 🛡️ RANK & POINTS ───────────────────────────────────
    { id: 'first_step',    category: 'rank', icon: '👣', name: 'First Step',
      desc: 'Complete your first habit ever',
      getProgress: c => ({ current: Math.min(c.totalCompletions, 1), target: 1 }) },
    { id: 'centurion',     category: 'rank', icon: '🛡️', name: 'Centurion',
      desc: 'Earn 500 total points', target: 500,
      getProgress: c => ({ current: Math.min(c.totalPoints, 500), target: 500 }) },
    { id: 'the_grind',     category: 'rank', icon: '⚡', name: 'The Grind',
      desc: 'Earn 2,000 total points', target: 2000,
      getProgress: c => ({ current: Math.min(c.totalPoints, 2000), target: 2000 }) },
    { id: 'awakened',      category: 'rank', icon: '💎', name: 'Awakened',
      desc: 'Reach A Rank (7,000 pts)', target: 7000,
      getProgress: c => ({ current: Math.min(c.totalPoints, 7000), target: 7000 }) },
    { id: 'shadow_monarch',category: 'rank', icon: '🌑', name: 'Shadow Monarch',
      desc: 'Reach S Rank (14,000 pts)', target: 14000,
      getProgress: c => ({ current: Math.min(c.totalPoints, 14000), target: 14000 }) },
    { id: 'the_one',       category: 'rank', icon: '⭐', name: 'The One',
      desc: 'Reach S+ Rank (28,000 pts)', target: 28000,
      getProgress: c => ({ current: Math.min(c.totalPoints, 28000), target: 28000 }) },
    { id: 'golden_hour',   category: 'rank', icon: '🏆', name: 'Golden Hour',
      desc: 'Earn 10,000 lifetime XP', target: 10000,
      getProgress: c => ({ current: Math.min(c.totalPoints, 10000), target: 10000 }) },

    // ── 🧍 CLASS & AWAKENING ───────────────────────────────
    { id: 'first_awakening', category: 'class', icon: '✨', name: 'First Awakening',
      desc: 'Earn your first class (any of 7)', target: 1,
      getProgress: c => ({ current: c.hasClass ? 1 : 0, target: 1 }) },
    { id: 'specialist',      category: 'class', icon: '📈', name: 'Specialist',
      desc: 'Reach Lv10 in any single stat', target: 10,
      getProgress: c => ({ current: Math.min(c.maxStatLv, 10), target: 10 }) },
    { id: 'master',          category: 'class', icon: '⚜️', name: 'Master',
      desc: 'Reach Lv20 (MAX) in any single stat', target: 20,
      getProgress: c => ({ current: Math.min(c.maxStatLv, 20), target: 20 }) },
    { id: 'polymath',        category: 'class', icon: '🎴', name: 'Polymath',
      desc: 'Reach Lv5 in 3 or more stats', target: 3,
      getProgress: c => ({ current: Math.min(c.statsAtLv5, 3), target: 3 }) },
    { id: 'the_sage',        category: 'class', icon: '🌟', name: 'The Sage',
      desc: 'Achieve Sage class (all 6 stats Lv5+, balanced)', target: 1,
      getProgress: c => ({ current: c.isSage ? 1 : 0, target: 1 }) },
    { id: 'fully_awakened',  category: 'class', icon: '👑', name: 'Fully Awakened',
      desc: 'Max all 6 stats — Total Level 120 (+2,000 bonus XP)', target: 120,
      getProgress: c => ({ current: Math.min(c.totalStatLevel, 120), target: 120 }) },

    // ── 🌅 PACKS ────────────────────────────────────────────
    { id: 'compound_day',    category: 'packs', icon: '⚡', name: 'Compound Day',
      desc: 'Earn the Compound Effect Bonus once', target: 1,
      getProgress: c => ({ current: Math.min(c.mrStreak, 1), target: 1 }) },
    { id: 'compound_week',   category: 'packs', icon: '🌅', name: 'Compound Week',
      desc: '7-day Morning Routine streak', target: 7,
      getProgress: c => ({ current: Math.min(c.mrStreak, 7), target: 7 }) },
    { id: 'compound_month',  category: 'packs', icon: '🔥', name: 'Compound Month',
      desc: '30-day Morning Routine streak', target: 30,
      getProgress: c => ({ current: Math.min(c.mrStreak, 30), target: 30 }) },
    { id: 'locked_in_init',  category: 'packs', icon: '🔒', name: 'Locked-In Initiation',
      desc: 'Earn the Locked-In Bonus once', target: 1,
      getProgress: c => ({ current: Math.min(c.liStreak, 1), target: 1 }) },
    { id: 'locked_in_30',    category: 'packs', icon: '🛡️', name: 'Locked-In Disciple',
      desc: '30-day Locked-In streak', target: 30,
      getProgress: c => ({ current: Math.min(c.liStreak, 30), target: 30 }) },
    { id: 'both_crowns',     category: 'packs', icon: '👑', name: 'Both Crowns',
      desc: 'Earn both Compound + Locked-In bonuses on the same day', target: 1,
      getProgress: c => ({ current: c.bothCrownsToday ? 1 : 0, target: 1 }) },

    // ── ⚔️ DAILY QUESTS ─────────────────────────────────────
    { id: 'quest_first',  category: 'quests', icon: '⚔️', name: 'Quest Slayer',
      desc: 'Complete your first daily quest', target: 1,
      getProgress: c => ({ current: Math.min(c.questsComplete, 1), target: 1 }) },
    { id: 'quest_10',     category: 'quests', icon: '🎯', name: 'Quest Tier 10',
      desc: 'Complete 10 daily quests', target: 10,
      getProgress: c => ({ current: Math.min(c.questsComplete, 10), target: 10 }) },
    { id: 'quest_50',     category: 'quests', icon: '🏹', name: 'Quest Tier 50',
      desc: 'Complete 50 daily quests', target: 50,
      getProgress: c => ({ current: Math.min(c.questsComplete, 50), target: 50 }) },
    { id: 'quest_100',    category: 'quests', icon: '🏆', name: 'Quest Tier 100',
      desc: 'Complete 100 daily quests', target: 100,
      getProgress: c => ({ current: Math.min(c.questsComplete, 100), target: 100 }) },

    // ── 🎯 HABIT MASTERY ────────────────────────────────────
    { id: 'legendary_hunter', category: 'habits', icon: '👑', name: 'Legendary Hunter',
      desc: 'Complete a Legendary habit 30 days in a row', target: 30,
      getProgress: c => ({ current: Math.min(c.maxLegStreak, 30), target: 30 }) },
    { id: 'cold_soul',  category: 'habits', icon: '🧊', name: 'Cold Soul',
      desc: '30 cold plunge or cold shower completions', target: 30,
      getProgress: c => ({ current: Math.min(c.coldCount, 30), target: 30 }) },
    { id: 'bookworm',   category: 'habits', icon: '📖', name: 'Bookworm',
      desc: 'Read habit completed 100 days', target: 100,
      getProgress: c => ({ current: Math.min(c.readCount, 100), target: 100 }) },
    { id: 'iron_body',  category: 'habits', icon: '🏋️', name: 'Iron Body',
      desc: 'Strength training 100 days', target: 100,
      getProgress: c => ({ current: Math.min(c.strengthCount, 100), target: 100 }) },
    { id: 'stoic',      category: 'habits', icon: '🧠', name: 'Stoic',
      desc: 'Meditate 60 days', target: 60,
      getProgress: c => ({ current: Math.min(c.meditateCount, 60), target: 60 }) },
    { id: 'phone_off',  category: 'habits', icon: '📵', name: 'Phone-Off Champion',
      desc: '30 days of "No phone after waking"', target: 30,
      getProgress: c => ({ current: Math.min(c.phoneOffCount, 30), target: 30 }) },

    // ── 📅 LIFETIME ─────────────────────────────────────────
    { id: 'year_active',  category: 'lifetime', icon: '📅', name: 'Year of Sweat',
      desc: '365 active days lifetime', target: 365,
      getProgress: c => ({ current: Math.min(c.activeDays, 365), target: 365 }) },
    { id: 'discipline_test', category: 'lifetime', icon: '⚜️', name: 'Discipline Test',
      desc: '1,000 lifetime habit completions', target: 1000,
      getProgress: c => ({ current: Math.min(c.totalCompletions, 1000), target: 1000 }) },
    { id: 'perfect_week',  category: 'lifetime', icon: '✨', name: 'Perfect Week',
      desc: '7 perfect days in a row', target: 7,
      getProgress: c => ({ current: Math.min(c.perfectStreak, 7), target: 7 }) },
    { id: 'perfect_month', category: 'lifetime', icon: '💎', name: 'Perfect Month',
      desc: '30 perfect days in a row', target: 30,
      getProgress: c => ({ current: Math.min(c.perfectStreak, 30), target: 30 }) },
    { id: 'pr_breaker',    category: 'lifetime', icon: '🏆', name: 'Personal Best',
      desc: 'Break any Personal Record for the first time', target: 1,
      getProgress: c => ({ current: c.anyPRSet ? 1 : 0, target: 1 }) },
  ];

  const STATS = [
    { id: 'STR',   icon: '⚔️',  iconImg: 'assets/stat-icons/stat-str.png',   label: 'STR',   name: 'Strength',     color: '#ef4444',
      habits: [
        'Strength training', 'Cardio workout', 'Sprint session', 'Daily walk', 'Protein goal',
      ] },
    { id: 'VIT',   icon: '❤️',  iconImg: 'assets/stat-icons/stat-vit.png',   label: 'VIT',   name: 'Vitality',     color: '#22c55e',
      habits: [
        'Hydrate', 'Sleep', 'Sleep before midnight', 'Cardio workout', 'Daily walk',
        'Ice bath or cold plunge', 'Mobility & Stretching', 'Get morning sunlight',
        'Whole foods diet', 'No sugar/junk food', 'Barefoot grounding outside',
        'Vitamins and minerals', 'Sleep early before 11PM',
      ] },
    { id: 'INT',   icon: '🧠',  iconImg: 'assets/stat-icons/stat-int.png',   label: 'INT',   name: 'Intelligence', color: '#3b82f6',
      habits: [
        'Read', 'Journal', 'Educational podcast', 'Practice a skill',
        'Flashcard review', 'Write down lessons learned', 'Learn something new',
        'Language learning', 'Visualization practice',
        'Review your long term goals', 'Generate one new business or content idea',
      ] },
    { id: 'FOCUS', icon: '🎯',  iconImg: 'assets/stat-icons/stat-focus.png', label: 'FOCUS', name: 'Focus',        color: '#475569',
      habits: [
        'Meditate & Breathwork', 'No phone or social media after waking',
        'Review daily goals/intentions', 'No social media before noon',
        'Complete your #1 priority task', 'Plan tomorrow the night before',
        'Under 1 hour screen time', 'Digital declutter',
        'No doomscrolling until after 5PM', 'Review your long term goals',
        'Review investments or trading journal', 'Visualization practice',
      ] },
    { id: 'WILL',  icon: '🔥',  iconImg: 'assets/stat-icons/stat-will.png',  label: 'WILL',  name: 'Willpower',    color: '#f97316',
      habits: [
        'Ice bath or cold plunge', 'Cold shower', 'Meditate & Breathwork',
        'No screens 1 hour before bed', 'No sugar/junk food', 'No alcohol', 'No caffeine',
        'Wake up at consistent time', 'Complete your #1 priority task', 'Tidy/clean space',
        'Morning gratitude practice', 'Pray or set intentions',
        'Call or text a family member', 'Do something kind for someone',
      ] },
    { id: 'WLT',   icon: '💰',  iconImg: 'assets/stat-icons/stat-wlt.png',   label: 'WLT',   name: 'Wealth',       color: '#f59e0b',
      habits: [
        'Track finances & net worth', 'Work on a side project or business',
        'Review investments or trading journal', 'Generate one new business or content idea',
      ] },
  ];

  // Render helper — returns an <img> for the stat's custom art if available,
  // otherwise falls back to the raw emoji. The opts.size controls render
  // size in CSS px; opts.eager loads immediately (use for above-the-fold).
  function statIconHtml(st, opts) {
    opts = opts || {};
    const sz = opts.size || 32;
    if (st && st.iconImg) {
      const cls = 'stat-icon-img' + (opts.cls ? ' ' + opts.cls : '');
      return '<img class="' + cls + '" src="' + st.iconImg + '" alt="' +
        (st.label ? st.label.replace(/"/g, '') : '') + '" ' +
        'style="width:' + sz + 'px;height:' + sz + 'px" ' +
        'draggable="false" loading="' + (opts.eager ? 'eager' : 'lazy') + '" decoding="async">';
    }
    return st && st.icon ? st.icon : '';
  }
  // For elements that previously held a single emoji glyph via .textContent.
  function setStatIcon(el, st, sizePx) {
    if (!el) return;
    el.innerHTML = statIconHtml(st, { size: sizePx || 32, eager: true });
  }

  // ── HABIT ICON HELPERS ───────────────────────────────────
  // Mirrors the stat-icon pattern. getHabitIcon returns the PNG path if
  // the curated habit has a mapping; null otherwise. Custom user habits
  // ALWAYS return null — they keep their user-chosen emoji. habitIconHtml
  // returns the proper render markup (img tag OR escaped emoji string).
  // setHabitIcon writes the markup into an existing element via innerHTML.
  function getHabitIcon(habit) {
    if (!habit) return null;
    if (habit.custom) return null;
    return (habit.name && HABIT_ICONS[habit.name]) || null;
  }
  function habitIconHtml(habit, opts) {
    opts = opts || {};
    const sz   = opts.size || 32;
    const path = getHabitIcon(habit);
    if (path) {
      const cls = 'habit-icon-img' + (opts.cls ? ' ' + opts.cls : '');
      const alt = (habit.name || '').replace(/"/g, '');
      return '<img class="' + cls + '" src="' + path + '" alt="' + alt + '" ' +
        'style="width:' + sz + 'px;height:' + sz + 'px" ' +
        'draggable="false" loading="' + (opts.eager ? 'eager' : 'lazy') + '" decoding="async">';
    }
    return habit && habit.emoji ? habit.emoji : '';
  }
  function setHabitIcon(el, habit, sizePx) {
    if (!el) return;
    const path = getHabitIcon(habit);
    if (path) {
      el.innerHTML = habitIconHtml(habit, { size: sizePx || 32, eager: true });
    } else {
      el.textContent = habit && habit.emoji ? habit.emoji : '';
    }
  }

  const STAT_BONUS_THRESHOLDS = [
    { level:  5, pts:  25 },
    { level: 10, pts:  75 },
    { level: 15, pts: 150 },
    { level: 20, pts: 500 },
  ];

  // ── PERFECT DAY STREAK MILESTONES ────────────────────────
  const PERFECT_STREAK_MILESTONES = [
    { day:   7, bonus:  10, title: 'WEEK WARRIOR',        emoji: '🔥', subtitle: '7 Perfect Days in a row!',                                                       color: '#8b5cf6', shake: false, letterReveal: false, extended: false, chime: false },
    { day:  14, bonus:  25, title: 'FORTNIGHT HUNTER',    emoji: '⚡', subtitle: '14 Perfect Days. You are not like the others.',                                   color: '#3b82f6', shake: false, letterReveal: false, extended: false, chime: false },
    { day:  21, bonus:  50, title: 'BEAST MODE ACTIVATED',emoji: '💪', subtitle: '21 Days. A habit is now part of you.',                                            color: '#a855f7', shake: true,  letterReveal: false, extended: false, chime: false },
    { day:  30, bonus: 100, title: 'MONTHLY LEGEND',      emoji: '👑', subtitle: '30 Perfect Days. Most people quit by day 3.',                                     color: '#f97316', shake: false, letterReveal: false, extended: false, chime: true  },
    { day:  60, bonus: 250, title: 'IRON DISCIPLE',       emoji: '⚔️', subtitle: '60 Days. Your discipline is becoming legendary.',                                 color: '#ef4444', shake: true,  letterReveal: false, extended: false, chime: false },
    { day: 100, bonus: 500, title: 'CENTURY HUNTER',      emoji: '💎', subtitle: '100 Perfect Days. You have become the person most people only dream of being.',  color: '#f59e0b', shake: true,  letterReveal: true,  extended: true,  chime: true  },
  ];
  const PS_REPEAT = { bonus: 300, emoji: '🌟', color: '#f59e0b', shake: false, letterReveal: false, extended: false, chime: false,
    subtitle: 'The journey never ends. Neither do you.' };

  const ALL_DAYS   = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const DAY_LABELS = ['M','T','W','T','F','S','S'];

  const RANK_EFFECTS = {
    'D':  { color: '#8b5cf6', glow: 'rgba(139,92,246,0.55)', cls: 'rank-d',    shake: false, particles: 0,  rain: false, shockwave: false, lightning: false },
    'C':  { color: '#8b5cf6', glow: 'rgba(139,92,246,0.55)', cls: 'rank-c',    shake: false, particles: 12, rain: false, shockwave: false, lightning: false },
    'B':  { color: '#3b82f6', glow: 'rgba(59,130,246,0.55)', cls: 'rank-b',    shake: false, particles: 0,  rain: false, shockwave: true,  lightning: false },
    'A':  { color: '#a855f7', glow: 'rgba(168,85,247,0.55)', cls: 'rank-a',    shake: false, particles: 0,  rain: false, shockwave: false, lightning: true  },
    'S':  { color: '#f97316', glow: 'rgba(249,115,22,0.65)', cls: 'rank-s',    shake: true,  particles: 30, rain: false, shockwave: true,  lightning: false },
    'S+': { color: '#f59e0b', glow: 'rgba(245,158,11,0.75)', cls: 'rank-splus',shake: true,  particles: 0,  rain: true,  shockwave: false, lightning: false },
  };

  const STAT_FLAVOR = {
    STR:   'Your body grows stronger.',
    VIT:   'Your endurance increases.',
    INT:   'Your mind sharpens.',
    FOCUS: 'Your concentration deepens.',
    WILL:  'Your resolve hardens.',
    WLT:   'Your wealth expands.',
  };

  const STAT_DESCRIPTIONS = {
    STR:   'Raw physical power and bodily discipline. Warriors are forged through consistent physical effort. Every workout, every cold shower, every mile run builds this stat.',
    VIT:   'Your health, recovery, and longevity. Vitality is the foundation everything else is built on. Sleep, hydration, nutrition, and mobility keep your body running at full capacity.',
    INT:   'Mental growth, knowledge, and cognitive sharpness. The mind is a muscle — read, reflect, learn, and meditate to expand your intelligence stat over time.',
    FOCUS: 'Attention, presence, and distraction resistance. In a world designed to steal your attention, focus is a superpower. Protect your mornings and guard your mind.',
    WILL:  "Discipline over comfort. Willpower is doing what you said you would do when you don't feel like doing it. The rarest and most valuable stat of all.",
    WLT:   'Financial intelligence and growth mindset. Wealth is built through daily micro decisions — tracking, building, reaching, investing. Consistency here compounds harder than any other stat.',
  };

  // ── ORIGIN STORIES — two-chapter narrative artifact ──────
  // Chapter 1 (The Beginning): generated at onboarding completion,
  //   class-agnostic. Marks the moment the user started.
  // Chapter 2 (The Awakening): generated at first Civilian → class
  //   transition, class-specific. Marks the moment they earned a path.
  // Both are PERMANENT — never regenerate, never edit. Class shifts
  // after first awakening do NOT update Chapter 2.
  const BEGINNING_TEMPLATE =
    '{NAME} was nothing yet.\n' +
    'Not a Warrior. Not a Mage. Not a Hunter — only the idea of one.\n' +
    'But on this day he made the only choice that matters: to begin.';

  const ORIGIN_TEMPLATES = {
    STR:   '{NAME} chose the path of the Warrior.\nNot because strength came naturally. Because weakness had become unbearable.\nThe Awakening had begun.',
    INT:   '{NAME} chose the path of the Mage.\nNot because the world demanded knowledge. Because ignorance had become the cage.\nThe Awakening had begun.',
    FOCUS: '{NAME} chose the path of the Assassin.\nNot because focus came easily. Because distraction had cost him too much.\nThe Awakening had begun.',
    WILL:  '{NAME} chose the path of the Paladin.\nNot because nothing tested him. Because breaking had stopped being an option.\nThe Awakening had begun.',
    VIT:   '{NAME} chose the path of the Ranger.\nNot because his body was given. Because depletion had become the default he refused.\nThe Awakening had begun.',
    WLT:   '{NAME} chose the path of the Merchant.\nNot because comfort was the goal. Because dependence had been seen for what it was.\nThe Awakening had begun.',
    SAGE:  '{NAME} walked all six paths.\nNot because he was lucky. Because he refused to specialize before knowing himself.\nThe Awakening had begun.',
  };

  const CLASSES = {
    CIVILIAN: { emoji: '🧍', name: 'Civilian', color: '#6b7280', desc: "You haven't been awakened yet. Train any stat to Lv5 to find your path." },
    STR:   { emoji: '⚔️',  name: 'Warrior',  color: '#ef4444', desc: 'You build your body like a fortress. Discipline is your weapon.' },
    VIT:   { emoji: '🏹',  name: 'Ranger',   color: '#22c55e', desc: 'Your body is your temple. Recovery and endurance are your edge.' },
    INT:   { emoji: '🧙',  name: 'Mage',     color: '#3b82f6', desc: 'Your mind is your greatest asset. Knowledge compounds like interest.' },
    FOCUS: { emoji: '🥷',  name: 'Assassin', color: '#475569', desc: 'Precise, locked in, distraction-proof. You operate in silence.' },
    WILL:  { emoji: '🛡️', name: 'Paladin',  color: '#f97316', desc: "Unbreakable. You do what others won't on the days they can't." },
    WLT:   { emoji: '👑',  name: 'Merchant', color: '#f59e0b', desc: 'Every day is an investment. You play the long financial game.' },
    SAGE:  { emoji: '🌟',  name: 'Sage',     color: '#8b5cf6', desc: 'No single path defines you. You are building a complete human.' },
  };
  const CLASS_LV5_THRESHOLD = 5;
  const CLASS_SHIFT_DOMINANCE = 1.20;  // 20%+ over current class to shift
  const CLASS_BALANCE_RATIO   = 0.85;  // within 15% across all 6 stats → Sage

  // Custom habits are user-authored. They're locked at Medium (3 XP) so they
  // can't game the rank economy. The cap keeps the curated 49 as the
  // canonical path — customs are bonus tracking, not a parallel system.
  const MAX_CUSTOM_HABITS    = 5;
  const CUSTOM_HABIT_DIFFICULTY = 'medium';

  const EMOJIS = [
    '🏃','💪','🧘','🚴','🏊','🏋️',
    '💧','🥗','🍎','😴','💊','🧠',
    '📚','✍️','💻','📝','🎯','📖',
    '🌱','⭐','🔥','✨','🌟','🏆',
    '☀️','🌙','🎵','🎨','❤️','🐶',
  ];

  // ── STATE ──────────────────────────────────────────────────
  let habits = [];
  let completions = {};
  let streaks = {};
  let totalPoints = 0;
  let habitNotes = {}; // habitId → note string
  let unlockedAchievements = new Set();
  let achievementUnlockDates = {};  // achId → 'YYYY-MM-DD' first unlock
  let today = getPTDate();
  let currentTab = 'profile';
  let editingId = null;
  let ctxHabitId = null;
  let editFormEmoji = '';
  let editFormDiff = 'easy';
  let schedHabitId = null;
  let schedFormDays = [...ALL_DAYS];
  let pickerCallback = null;
  let achQueue = [];
  let achPopupTimer = null;
  let levelUpQueue = [];
  let levelUpActive = false;
  let needsOnboarding = false;
  let needsWelcome    = false;
  let obSelected = new Set();
  let obConfig   = new Map(); // index → config for habits configured during onboarding
  let selectedPackId  = null;
  let stats = {};
  let statBonuses = new Set();
  let playerName = 'Hunter';
  let perfectStreak = { count: 0, lastDate: null, prevCount: 0, prevLastDate: null };
  let psAwarded = new Set();
  let compoundStreaks  = {}; // packId → { streak, lastDate }
  let compoundAwarded = {}; // packId → date (last award date, prevents double-award)
  let personalRecords  = {}; // prId → { value, meta, lastUpdated }
  let dailyQuests      = {}; // 'YYYY-MM-DD' → { id, manualDone:[], bonusAwarded }
  let questHistory     = []; // [{ date, missionId }] — last ~60 entries for repeat avoidance

  // ── STREAK FORGIVENESS ─────────────────────────────────
  // Layer 1: Shields earned via 14-day pack streaks, max 3 per pack
  let streakShields    = {}; // packId → integer count (0..3)
  let shieldClaimedAt  = {}; // packId → highest streak count where a shield was earned (so we don't double-grant on re-roll)
  let pendingShieldNotices = []; // [{ packId, absorbedDate, streak, remaining }] — banners to show on next open
  // Layer 2: Honest Day — explicit user-chosen rest, 1/month/pack
  let honestDays       = {}; // packId → ['YYYY-MM-DD', ...] — every Honest Rest day ever
  // Layer 3: Resilience — pending comeback flag + tracking
  let pendingComeback  = null; // null | { packId, brokenStreak, breakDate } — set on real break
  let lastActiveDate   = null; // last 'YYYY-MM-DD' the user completed any habit
  let totalComebacks   = 0;    // lifetime count
  let streakBreakLog   = [];   // [{ packId, date, brokenStreak }] last 60 entries
  // Two-chapter origin: Chapter 1 at onboarding, Chapter 2 at awakening
  let originBeginning  = null; // { text, dateISO, dateDisplay, migrated? } | null
  let originAwakening  = null; // { text, classKey, dateISO, dateDisplay, migrated? } | null
  let _prCelebrationQueue = [];   // [{ prId, newValue, prevValue, meta, mode }]
  let _prCelebrationActive = false;
  let _suppressPRCelebrations = false; // true during migration backfill
  let histViewYear   = 0;
  let histViewMonth  = 0;
  let histViewMode   = 'weekly'; // 'weekly' | 'monthly' | 'yearly' | 'achievements'
  let histWeekOffset = 0;        // 0 = current week, negative = past
  let currentClass  = null; // null = unset (first run)

  // ── DATE ──────────────────────────────────────────────────
  function getPTDate() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
  }

  function prevDay(dateStr) {
    const ms = Date.parse(dateStr + 'T20:00:00Z');
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(ms - 86_400_000));
  }

  function formatDisplayDate(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function getTodayDayName() {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short' }).format(new Date());
  }

  function isWeekend() {
    const day = getTodayDayName();
    return day === 'Fri' || day === 'Sat' || day === 'Sun';
  }

  function isScheduledToday(habit) {
    if (!habit.days || habit.days.length === 7) return true;
    return habit.days.includes(getTodayDayName());
  }

  function nextDay(dateStr) {
    const ms = Date.parse(dateStr + 'T12:00:00Z');
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(ms + 86_400_000));
  }

  function isScheduledOn(days, dateStr) {
    if (!days || days.length === 7) return true;
    const name = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short' })
      .format(new Date(dateStr + 'T12:00:00Z'));
    return days.includes(name);
  }

  // ── NO ALCOHOL WEEKEND CHALLENGE ─────────────────────────

  // Returns { fri, sat, sun } date strings for the weekend containing today.
  // Returns null if today is not Fri/Sat/Sun.
  function getWeekendDates() {
    const day = getTodayDayName();
    if (day === 'Fri') return { fri: today, sat: nextDay(today),             sun: nextDay(nextDay(today)) };
    if (day === 'Sat') return { fri: prevDay(today),             sat: today, sun: nextDay(today) };
    if (day === 'Sun') return { fri: prevDay(prevDay(today)), sat: prevDay(today), sun: today };
    return null;
  }

  // Returns true if the "No alcohol" habit was completed on the given date string.
  function noAlcoholDoneOn(dateStr) {
    const nah = habits.find(h => h.name === 'No alcohol');
    if (!nah) return false;
    return (completions[dateStr] || []).includes(nah.id);
  }

  // Returns badge config { text, cls } for the No Alcohol card today, or null.
  function getNoAlcoholBadge() {
    const day     = getTodayDayName();
    const weekend = getWeekendDates();
    if (!weekend) return null;
    if (day === 'Fri') {
      return { text: 'Weekend Challenge Starts', cls: 'na-badge-start' };
    }
    if (day === 'Sat') {
      // If Friday was missed, stay quiet — the streak forgiveness ethos
      // doesn't shame misses, it celebrates progress. No badge today.
      if (!noAlcoholDoneOn(weekend.fri)) return null;
      return { text: 'Day 2 of 3', cls: 'na-badge-progress' };
    }
    if (day === 'Sun') {
      const friOk = noAlcoholDoneOn(weekend.fri);
      const satOk = noAlcoholDoneOn(weekend.sat);
      if (friOk && satOk) return { text: 'Final Day — Complete for 30 XP', cls: 'na-badge-final' };
      // Challenge can no longer complete — show nothing rather than a
      // shame badge. The card still works as a normal habit.
      return null;
    }
    return null;
  }

  // Called after checking "No alcohol" on Sunday. Awards 30 XP if Fri+Sat+Sun all done.
  function checkWeekendChallenge(id) {
    if (getTodayDayName() !== 'Sun') return;
    const nah = habits.find(h => h.name === 'No alcohol');
    if (!nah || nah.id !== id) return;
    const weekend = getWeekendDates();
    if (!noAlcoholDoneOn(weekend.fri) || !noAlcoholDoneOn(weekend.sat)) return;

    const bonusKey = 'hb_wc_' + weekend.fri;
    if (localStorage.getItem(bonusKey)) return; // already awarded this weekend

    localStorage.setItem(bonusKey, '1');
    totalPoints += 30;
    save();
    renderRank();
    achQueue.push({
      label: 'WEEKEND WARRIOR',
      icon:  '🏆',
      name:  'Weekend Challenge Complete!',
      desc:  '+30 XP Bonus Awarded',
    });
    if (!levelUpActive && !achPopupTimer) drainAchQueue();
  }

  // ── WEEKEND WARRIOR BANNER + SHEET ───────────────────────
  // The Double XP banner on the Habits tab is tappable. Two states
  // depending on whether "No alcohol" is in the user's active list.

  function userHasNoAlcohol() {
    return habits.some(h => h.name === 'No alcohol');
  }

  // Returns 'complete' | 'missed' | 'pending' | 'future' for a given
  // weekend date (Fri/Sat/Sun). Used to render the State B progress rows.
  function getWeekendDayStatus(dateStr) {
    if (!dateStr) return 'future';
    if (dateStr > today) return 'future';
    const done = noAlcoholDoneOn(dateStr);
    if (done) return 'complete';
    if (dateStr === today) return 'pending';
    return 'missed';
  }

  function _wwStatusBadge(status) {
    switch (status) {
      case 'complete': return '<span class="ww-status ww-status--complete">✓ Complete</span>';
      case 'missed':   return '<span class="ww-status ww-status--missed">✗ Missed</span>';
      case 'pending':  return '<span class="ww-status ww-status--pending">○ Pending</span>';
      default:         return '<span class="ww-status ww-status--future">— Future</span>';
    }
  }

  function _wwRewardLine(friSt, satSt, sunSt) {
    const completed = [friSt, satSt, sunSt].filter(s => s === 'complete').length;
    const missed    = [friSt, satSt, sunSt].some(s => s === 'missed');
    const possible  = [friSt, satSt, sunSt].filter(s => s !== 'missed').length;

    if (completed === 3) {
      return '<div class="ww-reward ww-reward--earned">+30 XP earned — Weekend Warrior unlocked</div>';
    }
    if (missed && possible < 3) {
      return '<div class="ww-reward ww-reward--locked">Bonus locked for this weekend — try again next Friday</div>';
    }
    return '<div class="ww-reward">Finish all 3 nights to earn +30 XP</div>';
  }

  // Renders the popup body based on current state. Called on open AND
  // after a State A → State B transition (when user adds No alcohol).
  function renderWeekendWarriorBody() {
    const titleEl = document.getElementById('ww-title');
    const bodyEl  = document.getElementById('ww-body');
    if (!titleEl || !bodyEl) return;

    const hasIt = userHasNoAlcohol();

    if (!hasIt) {
      // ── State A: rules + Add CTA ────────────────────────
      titleEl.textContent = 'Weekend Warrior Challenge';
      bodyEl.innerHTML =
        '<p class="ww-rules">Complete <b>No alcohol</b> all three nights — Friday, Saturday, and Sunday — to earn <b>+30 bonus XP</b> on Sunday.</p>' +
        '<p class="ww-rules">Plus: every habit completed Fri-Sun earns <b>Double XP</b>.</p>' +
        '<button id="ww-add-btn" class="ww-add-btn">+ Add No Alcohol to my habits</button>';

      const addBtn = document.getElementById('ww-add-btn');
      if (addBtn) addBtn.addEventListener('click', addNoAlcoholFromWWBanner);
      return;
    }

    // ── State B: live Fri/Sat/Sun progress ─────────────────
    titleEl.textContent = 'Weekend Warrior Active';
    const w = getWeekendDates();
    if (!w) {
      bodyEl.innerHTML = '<p class="ww-rules">The Weekend Warrior challenge runs Friday through Sunday.</p>';
      return;
    }
    const friSt = getWeekendDayStatus(w.fri);
    const satSt = getWeekendDayStatus(w.sat);
    const sunSt = getWeekendDayStatus(w.sun);

    bodyEl.innerHTML =
      '<div class="ww-progress-list">' +
        '<div class="ww-day-row"><span class="ww-day-name">Friday</span>'   + _wwStatusBadge(friSt) + '</div>' +
        '<div class="ww-day-row"><span class="ww-day-name">Saturday</span>' + _wwStatusBadge(satSt) + '</div>' +
        '<div class="ww-day-row"><span class="ww-day-name">Sunday</span>'   + _wwStatusBadge(sunSt) + '</div>' +
      '</div>' +
      _wwRewardLine(friSt, satSt, sunSt);
  }

  function openWeekendWarriorSheet() {
    const overlay = document.getElementById('ww-overlay');
    const sheet   = document.getElementById('ww-sheet');
    console.log('[WW] openWeekendWarriorSheet', {
      overlay: !!overlay,
      sheet:   !!sheet,
      hasNoAlcohol: userHasNoAlcohol(),
    });
    if (!overlay || !sheet) {
      console.warn('[WW] Popup elements missing — index.html may be a stale cached version. Try hard refresh / reinstall.');
      return;
    }
    renderWeekendWarriorBody();
    overlay.classList.remove('hidden');
    sheet.classList.remove('hidden');
    console.log('[WW] Sheet shown');
  }

  function closeWeekendWarriorSheet() {
    document.getElementById('ww-overlay').classList.add('hidden');
    document.getElementById('ww-sheet').classList.add('hidden');
  }

  // Adds the canonical "No alcohol" habit (idempotent) and transitions
  // the popup from State A → State B with a small confirmation flash.
  function addNoAlcoholFromWWBanner() {
    if (userHasNoAlcohol()) {
      renderWeekendWarriorBody();
      updateDoubleXpBanner();
      return;
    }
    const def = DEFAULT_HABITS.find(d => d.name === 'No alcohol');
    if (!def) return;
    const newH = {
      id:          uid(),
      emoji:       def.emoji,
      name:        def.name,
      difficulty:  def.difficulty,
      type:        def.type || 'build',
      primaryStat: def.primaryStat,
    };
    habits.push(newH);
    if (def.note) habitNotes[newH.id] = def.note;
    save();
    renderHabits();
    updateDoubleXpBanner();

    // Brief "Added! ✓" flash, then transition popup body to State B
    const bodyEl = document.getElementById('ww-body');
    if (bodyEl) {
      bodyEl.innerHTML =
        '<div class="ww-added-flash">Added! ✓</div>' +
        '<p class="ww-rules" style="text-align:center">No alcohol — let the Weekend Warrior begin.</p>';
      setTimeout(renderWeekendWarriorBody, 900);
    }

    showHabitToast('No alcohol added — let the Weekend Warrior begin');
  }

  // Updates the Habits-tab Double XP banner: visibility, text, and active
  // state styling. Called on render() and after habit changes.
  function updateDoubleXpBanner() {
    const el = document.getElementById('double-xp-banner');
    if (!el) return;
    if (!isWeekend()) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    // innerHTML so the streak icon can render. streakify() escapes the
    // surrounding text, so this is safe even if upstream copy ever
    // includes user-generated content (it doesn't, but defensive).
    if (userHasNoAlcohol()) {
      el.classList.add('dxb--active');
      el.innerHTML = streakify('⚡ Weekend Warrior active — +30 XP if you finish all 3 nights 🔥', 16);
    } else {
      el.classList.remove('dxb--active');
      el.innerHTML = streakify('⚡ DOUBLE XP WEEKEND 🔥', 16);
    }
  }

  function setupDoubleXpBanner() {
    const el      = document.getElementById('double-xp-banner');
    const overlay = document.getElementById('ww-overlay');
    const sheet   = document.getElementById('ww-sheet');
    const closeBtn = document.getElementById('ww-close-btn');

    // Diagnostic logging — leave in for now per spec, user verifies in DevTools
    console.log('[WW] setupDoubleXpBanner called', {
      banner:  !!el,
      overlay: !!overlay,
      sheet:   !!sheet,
      closeBtn:!!closeBtn,
    });

    // CRITICAL FIX: previously this function early-returned if any popup
    // element was missing, silently abandoning the banner click handler.
    // Now we attach the click handler unconditionally — popup elements
    // are checked at click time inside openWeekendWarriorSheet.
    if (!el) {
      console.warn('[WW] #double-xp-banner not found — banner cannot be wired');
      return;
    }

    // Use BOTH click and pointerup. iOS Safari sometimes fails to fire
    // click after a :hover style is applied (the "first tap eats hover"
    // bug). pointerup fires reliably and we de-dupe via a flag.
    let _wwHandlingTap = false;
    function bannerActivate(e) {
      if (_wwHandlingTap) return;
      _wwHandlingTap = true;
      setTimeout(() => { _wwHandlingTap = false; }, 350);
      console.log('[WW] Banner tapped — opening Weekend Warrior sheet');
      if (e && e.preventDefault) e.preventDefault();
      openWeekendWarriorSheet();
    }
    el.addEventListener('click',     bannerActivate);
    el.addEventListener('pointerup', bannerActivate);
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        bannerActivate(e);
      }
    });
    console.log('[WW] click + pointerup handlers attached to #double-xp-banner');

    if (overlay) overlay.addEventListener('click', closeWeekendWarriorSheet);
    if (closeBtn) closeBtn.addEventListener('click', closeWeekendWarriorSheet);

    // Reuse the swipe-down gesture utility
    if (sheet && overlay && typeof attachSheetDismissGesture === 'function') {
      attachSheetDismissGesture(sheet, overlay, () => {
        sheet.classList.add('hidden');
        overlay.classList.add('hidden');
      }, {
        baseTransform:  'translateX(-50%) ',
        handleSelector: '.ww-drag-handle, .ww-header',
        scrollTarget:   '.ww-body',
      });
    }

    // ESC dismiss on desktop
    document.addEventListener('keydown', e => {
      if (sheet && e.key === 'Escape' && !sheet.classList.contains('hidden')) {
        closeWeekendWarriorSheet();
      }
    });
  }

  // Shows a one-time Friday challenge banner (once per Friday day, per device).
  function setupFridayBanner() {
    if (getTodayDayName() !== 'Fri') return;
    const bannerKey = 'hb_fri_banner_' + today;
    if (localStorage.getItem(bannerKey)) return;

    const nah      = habits.find(h => h.name === 'No alcohol');
    const day1Done = nah && (completions[today] || []).includes(nah.id);
    const msg      = day1Done
      ? 'Day 1 complete. Come back Saturday to continue your Weekend Challenge.'
      : 'The Weekend Challenge has begun, Hunter. No alcohol Friday, Saturday, and Sunday earns you 30 bonus XP. Your discipline this weekend defines your rank. Will you claim the reward?';

    const overlay = document.getElementById('fri-challenge-overlay');
    const modal   = document.getElementById('fri-challenge-modal');
    document.getElementById('fri-challenge-msg').textContent = msg;
    overlay.classList.remove('hidden');
    modal.classList.remove('hidden');

    const dismiss = () => {
      localStorage.setItem(bannerKey, '1');
      overlay.classList.add('hidden');
      modal.classList.add('hidden');
    };
    document.getElementById('fri-challenge-close').addEventListener('click', dismiss);
    document.getElementById('fri-challenge-action').addEventListener('click', dismiss);
    overlay.addEventListener('click', dismiss);
  }

  // Returns true if there is at least one scheduled day strictly between fromDate and toDate
  // (meaning the user could have missed a scheduled day)
  function hasScheduledDayBetween(days, fromDate, toDate) {
    if (!days || days.length === 7) return nextDay(fromDate) < toDate;
    let d = nextDay(fromDate);
    while (d < toDate) {
      if (isScheduledOn(days, d)) return true;
      d = nextDay(d);
    }
    return false;
  }

  // ── DEFAULT HABITS (first install only) ──────────────────
  // 49 habits across 7 categories. Indices drive OB_CATEGORIES and PACKS.
  const DEFAULT_HABITS = [
    // ── 💪 Physical Performance (0–10) ──────────────────────
    { emoji: '💧', name: 'Hydrate',                                   difficulty: 'easy'                },  // 0
    { emoji: '😴', name: 'Sleep',                                     difficulty: 'medium'              },  // 1
    { emoji: '🌙', name: 'Sleep before midnight',                     difficulty: 'medium'              },  // 2
    { emoji: '🏃', name: 'Cardio workout',                            difficulty: 'medium'              },  // 3
    { emoji: '🏋️', name: 'Strength training',                        difficulty: 'hard'                },  // 4
    { emoji: '⚡', name: 'Sprint session',                            difficulty: 'hard'                },  // 5
    { emoji: '🚶', name: 'Daily walk',                                difficulty: 'easy'                },  // 6
    { emoji: '🧊', name: 'Ice bath or cold plunge',                   difficulty: 'hard'                },  // 7
    { emoji: '🚿', name: 'Cold shower',                               difficulty: 'medium'              },  // 8
    { emoji: '🤸', name: 'Mobility & Stretching',                     difficulty: 'easy'                },  // 9
    { emoji: '🥩', name: 'Protein goal',                              difficulty: 'medium'              },  // 10
    // ── 🧠 Mental & Focus (11–18) ───────────────────────────
    { emoji: '📖', name: 'Read',                                      difficulty: 'easy'                },  // 11
    { emoji: '🧠', name: 'Meditate & Breathwork',                     difficulty: 'medium'              },  // 12
    { emoji: '✍️', name: 'Journal',                                   difficulty: 'easy'                },  // 13
    { emoji: '📵', name: 'No phone or social media after waking',     difficulty: 'medium', type: 'quit'},  // 14
    { emoji: '🎯', name: 'Review daily goals/intentions',             difficulty: 'easy'                },  // 15
    { emoji: '🌞', name: 'Get morning sunlight',                      difficulty: 'easy'                },  // 16
    { emoji: '📵', name: 'No social media before noon',               difficulty: 'medium', type: 'quit'},  // 17
    { emoji: '😴', name: 'No screens 1 hour before bed',             difficulty: 'medium', type: 'quit'},  // 18
    // ── 🥗 Nutrition (19–22) ────────────────────────────────
    { emoji: '🥗', name: 'Whole foods diet',                          difficulty: 'medium'              },  // 19
    { emoji: '❌', name: 'No sugar/junk food',                        difficulty: 'hard',   type: 'quit'},  // 20
    { emoji: '🍺', name: 'No alcohol',                                difficulty: 'medium', type: 'quit',  // 21
      note: '🏆 Weekend Challenge Bonus: Complete Friday, Saturday, AND Sunday alcohol-free to earn +30 bonus XP on Sunday. The hardest nights to stay disciplined are worth the most.' },
    { emoji: '☕', name: 'No caffeine',                               difficulty: 'medium', type: 'quit'},  // 22
    // ── ⚡ Discipline & Productivity (23–30) ────────────────
    { emoji: '🌅', name: 'Wake up at consistent time',               difficulty: 'medium'              },  // 23
    { emoji: '✅', name: 'Complete your #1 priority task',           difficulty: 'hard'                },  // 24
    { emoji: '📋', name: 'Plan tomorrow the night before',           difficulty: 'easy'                },  // 25
    { emoji: '🧹', name: 'Tidy/clean space',                         difficulty: 'easy'                },  // 26
    { emoji: '📱', name: 'Under 1 hour screen time',                 difficulty: 'hard',   type: 'quit'},  // 27
    { emoji: '🧹', name: 'Digital declutter',                        difficulty: 'easy'                },  // 28
    { emoji: '🚫', name: 'No doomscrolling until after 5PM',         difficulty: 'medium', type: 'quit'},  // 29
    { emoji: '🎯', name: 'Review your long term goals',              difficulty: 'easy'                },  // 30
    // ── 💰 Financial & Growth (31–34) ───────────────────────
    { emoji: '📊', name: 'Track finances & net worth',               difficulty: 'easy'                },  // 31
    { emoji: '🌐', name: 'Work on a side project or business',       difficulty: 'hard'                },  // 32
    { emoji: '📈', name: 'Review investments or trading journal',    difficulty: 'medium'              },  // 33
    { emoji: '💡', name: 'Generate one new business or content idea',difficulty: 'easy'                },  // 34
    // ── 🎯 Learning & Skills (35–40) ────────────────────────
    { emoji: '🎧', name: 'Educational podcast',                      difficulty: 'easy'                },  // 35
    { emoji: '✏️', name: 'Practice a skill',                        difficulty: 'medium'              },  // 36
    { emoji: '🃏', name: 'Flashcard review',                         difficulty: 'easy'                },  // 37
    { emoji: '📝', name: 'Write down lessons learned',               difficulty: 'easy'                },  // 38
    { emoji: '📚', name: 'Learn something new',                      difficulty: 'medium'              },  // 39
    { emoji: '🗣️', name: 'Language learning',                       difficulty: 'medium'              },  // 40
    // ── 🌱 Wellbeing & Relationships (41–48) ────────────────
    { emoji: '🙏', name: 'Morning gratitude practice',               difficulty: 'easy'                },  // 41
    { emoji: '🙏', name: 'Pray or set intentions',                   difficulty: 'easy'                },  // 42
    { emoji: '📞', name: 'Call or text a family member',             difficulty: 'easy'                },  // 43
    { emoji: '🤲', name: 'Do something kind for someone',            difficulty: 'easy'                },  // 44
    { emoji: '🦶', name: 'Barefoot grounding outside',               difficulty: 'easy'                },  // 45
    { emoji: '💊', name: 'Vitamins and minerals',                    difficulty: 'easy'                },  // 46
    { emoji: '🧘', name: 'Visualization practice',                   difficulty: 'medium'              },  // 47
    { emoji: '🌙', name: 'Sleep early before 11PM',                  difficulty: 'medium'              },  // 48
  ];

  const OB_CATEGORIES = [
    { label: 'Physical Performance',      start: 0,  end: 11 },
    { label: 'Mental & Focus',            start: 11, end: 19 },
    { label: 'Nutrition',                 start: 19, end: 23 },
    { label: 'Discipline & Productivity', start: 23, end: 31 },
    { label: 'Financial & Growth',        start: 31, end: 35 },
    { label: 'Learning & Skills',         start: 35, end: 41 },
    { label: 'Wellbeing & Relationships', start: 41, end: 49 },
  ];

  // ── PRIMARY STAT MAP ─────────────────────────────────────
  // Single source of truth for each habit's primary stat (drives the
  // History view's cell colors). The History tab is the only place this
  // map is read for visuals — every habit's `primaryStat` field is
  // derived from this map at startup.
  const HABIT_PRIMARY_STAT = {
    // STR (red)
    'Strength training': 'STR', 'Sprint session': 'STR', 'Mobility & Stretching': 'STR',
    'Cardio workout': 'STR', 'Cold shower': 'STR', 'Ice bath or cold plunge': 'STR',
    // VIT (pink)
    'Hydrate': 'VIT', 'Sleep': 'VIT', 'Sleep before midnight': 'VIT',
    'Sleep early before 11PM': 'VIT', 'Vitamins and minerals': 'VIT', 'Daily walk': 'VIT',
    'Whole foods diet': 'VIT', 'Protein goal': 'VIT', 'No sugar/junk food': 'VIT',
    'No alcohol': 'VIT', 'No caffeine': 'VIT', 'Barefoot grounding outside': 'VIT',
    'Call or text a family member': 'VIT', 'Do something kind for someone': 'VIT',
    // INT (blue)
    'Read': 'INT', 'Educational podcast': 'INT', 'Learn something new': 'INT',
    'Language learning': 'INT', 'Flashcard review': 'INT', 'Practice a skill': 'INT',
    'Write down lessons learned': 'INT',
    // FOCUS (yellow)
    'Meditate & Breathwork': 'FOCUS', 'Get morning sunlight': 'FOCUS',
    'No phone or social media after waking': 'FOCUS', 'No social media before noon': 'FOCUS',
    'No screens 1 hour before bed': 'FOCUS', 'Under 1 hour screen time': 'FOCUS',
    'No doomscrolling until after 5PM': 'FOCUS', 'Digital declutter': 'FOCUS',
    'Complete your #1 priority task': 'FOCUS',
    // WILL (orange)
    'Wake up at consistent time': 'WILL', 'Plan tomorrow the night before': 'WILL',
    'Tidy/clean space': 'WILL', 'Review daily goals/intentions': 'WILL',
    'Review your long term goals': 'WILL', 'Journal': 'WILL',
    'Visualization practice': 'WILL', 'Morning gratitude practice': 'WILL',
    'Pray or set intentions': 'WILL',
    // WLT (gold)
    'Track finances & net worth': 'WLT', 'Work on a side project or business': 'WLT',
    'Review investments or trading journal': 'WLT',
    'Generate one new business or content idea': 'WLT',
  };
  // Enrich each habit definition with its primary stat — single source of truth
  DEFAULT_HABITS.forEach(h => { h.primaryStat = HABIT_PRIMARY_STAT[h.name] || 'FOCUS'; });

  // ── HABIT ICONS ──────────────────────────────────────────
  // Custom DALL-E PNG icons for the canonical Morning Routine + Locked-In
  // habits. Habit name is the foreign key (matches DEFAULT_HABITS exactly).
  // Habits not listed here keep their emoji. Custom user habits ALWAYS
  // keep their emoji — they're never looked up here.
  //
  // Mirrors the STATS[].iconImg pattern. Files live in assets/habit-icons/
  // and are cached by sw.js. See `getHabitIcon`, `habitIconHtml`,
  // `setHabitIcon` near `statIconHtml` for render helpers.
  const HABIT_ICONS = {
    // ── Physical Performance ──
    'Hydrate':                              'assets/habit-icons/icon-water.png',
    'Sleep':                                'assets/habit-icons/icon-sleep.png',
    'Sleep before midnight':                'assets/habit-icons/icon-sleep.png',
    'Cardio workout':                       'assets/habit-icons/icon-cardio.png',
    'Strength training':                    'assets/habit-icons/icon-strength.png',
    'Sprint session':                       'assets/habit-icons/icon-sprint.png',
    'Daily walk':                           'assets/habit-icons/icon-walk.png',
    'Ice bath or cold plunge':              'assets/habit-icons/icon-cold.png',
    'Cold shower':                          'assets/habit-icons/icon-cold.png',
    'Mobility & Stretching':                'assets/habit-icons/icon-mobility.png',
    'Protein goal':                         'assets/habit-icons/icon-protein.png',

    // ── Mental & Focus ──
    'Read':                                 'assets/habit-icons/icon-read.png',
    'Meditate & Breathwork':                'assets/habit-icons/icon-meditate.png',
    'Journal':                              'assets/habit-icons/icon-journal.png',
    'No phone or social media after waking':'assets/habit-icons/icon-nophone.png',
    'Review daily goals/intentions':        'assets/habit-icons/icon-target.png',
    'Get morning sunlight':                 'assets/habit-icons/icon-sunlight.png',
    'No social media before noon':          'assets/habit-icons/icon-nosocial.png',
    'No screens 1 hour before bed':         'assets/habit-icons/icon-noscreen-bed.png',

    // ── Nutrition ──
    'Whole foods diet':                     'assets/habit-icons/icon-nutrition.png',
    'No sugar/junk food':                   'assets/habit-icons/icon-nosugar.png',
    'No alcohol':                           'assets/habit-icons/icon-noalcohol.png',
    'No caffeine':                          'assets/habit-icons/icon-nocaffeine.png',

    // ── Discipline & Productivity ──
    'Wake up at consistent time':           'assets/habit-icons/icon-wake.png',
    'Complete your #1 priority task':       'assets/habit-icons/icon-priority.png',
    'Plan tomorrow the night before':       'assets/habit-icons/icon-plan-tomorrow.png',
    'Tidy/clean space':                     'assets/habit-icons/icon-tidy.png',
    'Under 1 hour screen time':             'assets/habit-icons/icon-screen-cap.png',
    'Digital declutter':                    'assets/habit-icons/icon-tidy.png',
    'No doomscrolling until after 5PM':     'assets/habit-icons/icon-nodoomscroll.png',
    'Review your long term goals':          'assets/habit-icons/icon-target.png',

    // ── Financial & Growth ──
    'Track finances & net worth':           'assets/habit-icons/icon-finance.png',
    'Work on a side project or business':   'assets/habit-icons/icon-business.png',
    'Review investments or trading journal':'assets/habit-icons/icon-finance.png',
    'Generate one new business or content idea': 'assets/habit-icons/icon-business.png',

    // ── Learning & Skills ──
    'Educational podcast':                  'assets/habit-icons/icon-podcast.png',
    'Practice a skill':                     'assets/habit-icons/icon-learning.png',
    'Flashcard review':                     'assets/habit-icons/icon-learning.png',
    'Write down lessons learned':           'assets/habit-icons/icon-journal.png',
    'Learn something new':                  'assets/habit-icons/icon-learning.png',
    'Language learning':                    'assets/habit-icons/icon-learning.png',

    // ── Wellbeing & Relationships ──
    'Morning gratitude practice':           'assets/habit-icons/icon-gratitude.png',
    'Pray or set intentions':               'assets/habit-icons/icon-pray.png',
    'Call or text a family member':         'assets/habit-icons/icon-connection.png',
    'Do something kind for someone':        'assets/habit-icons/icon-connection.png',
    'Barefoot grounding outside':           'assets/habit-icons/icon-grounding.png',
    'Vitamins and minerals':                'assets/habit-icons/icon-vitamins.png',
    'Visualization practice':               'assets/habit-icons/icon-visualize.png',
    'Sleep early before 11PM':              'assets/habit-icons/icon-sleep.png',
  };

  // ── CLASS ICONS ──────────────────────────────────────────
  // Custom DALL-E art for the 8 class emblems. Renders in the Status
  // hero class line, class popup, awakening celebration, class-choice
  // screen, and origin Chapter-2 badge. Falls back to nothing if the
  // class id isn't mapped (no broken image).
  const CLASS_ICONS = {
    'CIVILIAN': 'assets/habit-icons/icon-class-civilian.png',
    'STR':      'assets/habit-icons/icon-class-warrior.png',
    'VIT':      'assets/habit-icons/icon-class-ranger.png',
    'INT':      'assets/habit-icons/icon-class-mage.png',
    'FOCUS':    'assets/habit-icons/icon-class-assassin.png',
    'WILL':     'assets/habit-icons/icon-class-paladin.png',
    'WLT':      'assets/habit-icons/icon-class-merchant.png',
    'SAGE':     'assets/habit-icons/icon-class-sage.png',
  };
  function classIconHtml(classKey, opts) {
    opts = opts || {};
    const path = CLASS_ICONS[classKey];
    if (!path) return '';
    const sz  = opts.size || 24;
    const cls = 'class-icon-img' + (opts.cls ? ' ' + opts.cls : '');
    return '<img class="' + cls + '" src="' + path + '" alt="" ' +
           'style="width:' + sz + 'px;height:' + sz + 'px" ' +
           'draggable="false" loading="' + (opts.eager ? 'eager' : 'lazy') + '" decoding="async">';
  }

  // ── DAILY CHECK-IN ───────────────────────────────────────
  // Single 6 PM local-time notification that acknowledges the user's
  // progress on today's habits. Five progress states × 5 variations
  // each = 25 unique copy strings. Re-scheduled on every meaningful
  // state change so the body reflects current progress at fire time.
  // (Sits alongside the morning digest and per-habit reminders, but
  // has its own reserved notification ID and bypasses the per-habit
  // daily limit. Subject to: master disable, pause, quiet hours, and
  // a "Day 1" suppression so brand-new users aren't overwhelmed.)
  const CHECKIN_TIME = '18:00';
  const CHECKIN_NOTIF_ID = 99999; // reserved; out of typical djb2 hash range

  const CHECKIN_COPY = {
    complete: [
      'All trials cleared, Hunter. Rest well.',
      'Day complete. Every trial honored.',
      'Perfect day in motion. Well done, Hunter.',
      'All habits cleared. The night is yours.',
      'Day mastered. Rest, Hunter — you earned it.',
    ],
    high: [
      '{N} cleared, {M} remain. Finish strong.',
      'Almost there, Hunter. {M} trials left.',
      '{N}/{TOTAL} done. Close the day clean.',
      '{M} trials between you and a perfect day.',
      'So close, Hunter. {M} left.',
    ],
    mid: [
      '{N} trials honored. {M} await.',
      'Halfway, Hunter. The day is still yours.',
      '{N}/{TOTAL} cleared. Keep moving.',
      'Solid progress. {M} trials remain.',
      'The path continues. {M} left.',
    ],
    low: [
      'The day is still open, Hunter.',
      'Even one more trial counts.',
      'Pick one, Hunter. Begin.',
      'Small steps still count. The path remains.',
      "The night isn't here yet. One trial, then another.",
    ],
    none: [
      "The day isn't done. Choose one.",
      "One trial, Hunter. That's all it takes.",
      'The path is still here. Begin.',
      'Even now, you can move forward.',
      'The day waits, Hunter. Take one step.',
    ],
  };

  function getCheckinProgressState(completed, total) {
    if (total === 0) return null;
    if (completed >= total) return 'complete';
    const pct = (completed / total) * 100;
    if (pct >= 70) return 'high';
    if (pct >= 30) return 'mid';
    if (pct > 0)   return 'low';
    return 'none';
  }

  function pickCheckinCopy(state, completed, total) {
    const variations = CHECKIN_COPY[state];
    if (!variations || !variations.length) return '';
    const text = variations[Math.floor(Math.random() * variations.length)];
    const remaining = total - completed;
    return text
      .replace('{N}', completed)
      .replace('{M}', remaining)
      .replace('{TOTAL}', total);
  }

  function getTodaysHabitProgress() {
    try {
      const t = (typeof getPTDate === 'function') ? getPTDate() : today;
      const completedIds = (completions && completions[t]) || [];
      const scheduled = Array.isArray(habits) ? habits.filter(isScheduledToday) : [];
      const completed = scheduled.filter(h => completedIds.indexOf(h.id) !== -1).length;
      return { completed, total: scheduled.length };
    } catch (_) {
      return { completed: 0, total: 0 };
    }
  }

  // Day-1 suppression — skip the check-in if the user has zero
  // historical completion days (i.e., they've never tracked a habit
  // before today). Once they complete their first habit, this returns
  // false and the check-in fires from the next 6 PM forward.
  function isDayOne() {
    try {
      if (typeof completions !== 'object' || !completions) return true;
      const days = Object.keys(completions).filter(d => (completions[d] || []).length > 0);
      return days.length === 0;
    } catch (_) {
      return false; // if anything fails, don't suppress — safer to ping
    }
  }

  // Compute next 6 PM in DEVICE-LOCAL time (matches the morning digest's
  // timezone behavior — see CLAUDE.md "Notifications fire in device-local").
  function computeNextCheckinDate() {
    const now    = new Date();
    const target = new Date();
    target.setHours(18, 0, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return target;
  }

  // ── PACK ICONS ───────────────────────────────────────────
  // Custom DALL-E art for the three pack/path entries at the top of
  // the Add Habits library. Keys match the rendering call sites in
  // renderLibrary(). Mirrors the HABIT_ICONS / PACK_ICONS pattern.
  const PACK_ICONS = {
    'morning':  'assets/habit-icons/icon-pack-morning.png',
    'lockedin': 'assets/habit-icons/icon-pack-lockedin.png',
    'custom':   'assets/habit-icons/icon-pack-custom.png',
  };
  function packIconHtml(packKey, opts) {
    opts = opts || {};
    const path = PACK_ICONS[packKey];
    if (!path) return '';
    const sz  = opts.size || 48;
    const cls = 'pack-icon-img' + (opts.cls ? ' ' + opts.cls : '');
    return '<img class="' + cls + '" src="' + path + '" alt="" ' +
           'style="width:' + sz + 'px;height:' + sz + 'px" ' +
           'draggable="false" loading="' + (opts.eager ? 'eager' : 'lazy') + '" decoding="async">';
  }

  // ── STREAK + XP ICONS ────────────────────────────────────
  // Custom flame + lightning icons replace the 🔥 and ⚡ emoji
  // system-wide in live UI. (Notifications, descriptions, and historical
  // WHATS_NEW entries keep the emoji — they go through non-HTML paths.)
  // The iconify() helper is a generic string transformer: pass any text
  // and it returns HTML with 🔥 / ⚡ swapped for the matching img tag,
  // escaping everything else. streakify() remains as a thin alias for
  // backward compat with earlier call sites.
  const STREAK_ICON_PATH = 'assets/habit-icons/icon-streak.png';
  const XP_ICON_PATH     = 'assets/habit-icons/icon-xp.png';

  function streakIconHtml(opts) {
    opts = opts || {};
    const sz  = opts.size || 20;
    const cls = 'streak-icon-img' + (opts.cls ? ' ' + opts.cls : '');
    return '<img class="' + cls + '" src="' + STREAK_ICON_PATH + '" alt="" ' +
           'style="width:' + sz + 'px;height:' + sz + 'px" ' +
           'draggable="false" loading="' + (opts.eager ? 'eager' : 'lazy') + '" decoding="async">';
  }
  function xpIconHtml(opts) {
    opts = opts || {};
    const sz  = opts.size || 16;
    const cls = 'xp-icon-img' + (opts.cls ? ' ' + opts.cls : '');
    return '<img class="' + cls + '" src="' + XP_ICON_PATH + '" alt="" ' +
           'style="width:' + sz + 'px;height:' + sz + 'px" ' +
           'draggable="false" loading="' + (opts.eager ? 'eager' : 'lazy') + '" decoding="async">';
  }

  // Replace every 🔥 / ⚡ in `text` with the matching img tag, escaping
  // the rest. Surrogate-pair-safe: 🔥 (U+1F525) is two code units, ⚡
  // (U+26A1) is one. We scan code points to slice cleanly.
  // Returns SAFE HTML — non-icon spans pass through esc().
  function iconify(text, opts) {
    opts = opts || {};
    const sz       = opts.size || 16;
    const fireSize = opts.fireSize || sz;
    const xpSize   = opts.xpSize   || sz;
    const s = String(text == null ? '' : text);
    if (!s) return '';
    if (s.indexOf('🔥') === -1 && s.indexOf('⚡') === -1) return esc(s);
    const fireImg = streakIconHtml({ size: fireSize });
    const xpImg   = xpIconHtml({ size: xpSize });
    let out = '';
    let buf = '';
    for (let i = 0; i < s.length; ) {
      const cp = s.codePointAt(i);
      if (cp === 0x1F525) {        // 🔥
        out += esc(buf) + fireImg; buf = ''; i += 2;
      } else if (cp === 0x26A1) {  // ⚡
        out += esc(buf) + xpImg;   buf = ''; i += 1;
      } else {
        buf += s[i]; i += 1;
      }
    }
    out += esc(buf);
    return out;
  }
  // Backward-compat alias — earlier code calls streakify(). The new
  // iconify also handles ⚡, which is a strict superset of the old behavior.
  function streakify(text, sizePx) { return iconify(text, { size: sizePx }); }

  // ── HABIT DESCRIPTIONS ───────────────────────────────────
  // One curated paragraph per habit, displayed on the View Note /
  // habit-detail sheet's "About this habit" section. Read-only —
  // single source of truth for the canonical description.
  const HABIT_DESCRIPTIONS = {
    // 💪 Physical Performance
    'Hydrate':                  'Water is the most underrated performance tool. Your brain, muscles, and recovery all depend on it.',
    'Sleep':                    'Recovery happens here. Skipping sleep is borrowing energy from tomorrow with high interest.',
    'Sleep before midnight':    'It all starts the night before. Quality sleep before midnight sets the foundation for everything.',
    'Cardio workout':           'Get your heart rate up. Run, bike, row, swim — sustained effort for 20+ minutes. The dedicated training that builds the engine.',
    'Strength training':        'You build your body like a fortress. Muscle is metabolic armor — protect what you build.',
    'Sprint session':           'Maximum effort, minimum time. Sprints train explosiveness and remind you what 100% feels like.',
    'Daily walk':               'The most underrated practice. Walking solves more problems than most strategies.',
    'Ice bath or cold plunge':  'The cold reveals who you really are. Discomfort by choice is power.',
    'Cold shower':              'Two minutes of voluntary suffering. Trains the mind to hold under pressure.',
    'Mobility & Stretching':    "The body you'll have at 60 is built today. Mobility is the difference between aging and breaking down.",
    'Protein goal':             'Muscle is built in the kitchen. Without protein, training is just damage with no rebuild.',

    // 🧠 Mental & Focus
    'Read':                                  'The cheapest mentorship in the world. Every great mind has left their playbook for you.',
    'Meditate & Breathwork':                 "The space between stimulus and response is where your power lives. Breathwork builds that space.",
    'Journal':                               "Thoughts you don't write down own you. Thoughts you write down, you own.",
    'No phone or social media after waking': "The first hour shapes the day. Don't hand it to algorithms before you've claimed it for yourself.",
    'Review daily goals/intentions':         'Direction beats motion. Five minutes of clarity saves hours of drift.',
    'Get morning sunlight':                  "Sets your circadian rhythm, your hormones, your mood. The cheapest performance tool you'll ever use.",
    'No social media before noon':           'Protect your morning brain. The deepest work happens before the noise begins.',
    'No screens 1 hour before bed':          'Your sleep quality starts an hour before bed. Screens steal it.',

    // 🥗 Nutrition
    'Whole foods diet':  'Real food builds real bodies. Eat what your great-grandparents would recognize.',
    'No sugar/junk food':'Sugar is a stimulant disguised as food. The discipline you build here transfers everywhere.',
    'No alcohol':        'Sleep, recovery, focus, mood — alcohol degrades all four. Sobriety is a performance edge most people refuse to take.',
    'No caffeine':       'Sometimes the best stimulant is no stimulant. Reset your baseline.',

    // ⚡ Discipline & Productivity
    'Wake up at consistent time':           'A consistent wake time anchors your whole day. The body trusts predictability.',
    'Complete your #1 priority task':       'One important thing done beats ten unimportant things. Move the needle that matters.',
    'Plan tomorrow the night before':       "Tomorrow's success is decided tonight. A 5-minute plan tonight saves 30 minutes of friction tomorrow.",
    'Tidy/clean space':                     'Your environment is a mirror of your mind. Order outside helps order inside.',
    'Under 1 hour screen time':             "Time you don't claim, attention economies will. Reclaim the hour.",
    'Digital declutter':                    'Notifications are interruptions disguised as importance. Cut the noise to hear the signal.',
    'No doomscrolling until after 5PM':     'The morning is for building, not consuming. Hold the line until the work is done.',
    'Review your long term goals':          "The compass needs frequent checking. Long-term goals fade if you don't look at them.",

    // 💰 Financial & Growth
    'Track finances & net worth':                'What you measure, you can manage. Unmeasured money disappears.',
    'Work on a side project or business':        "Today's small project is tomorrow's leverage. Asymmetric upside lives here.",
    'Review investments or trading journal':     'The journal is where the lessons live. Every trade reviewed is a teacher rehired.',
    'Generate one new business or content idea': 'Ideas compound. The mind that produces one today produces ten next month.',

    // 🎯 Learning & Skills
    'Educational podcast':         'Convert dead time into learning time. Walks, drives, dishes — all classrooms.',
    'Practice a skill':            'Practice is how potential becomes reality. There is no shortcut.',
    'Flashcard review':            'Spaced repetition is how memory becomes knowledge. Five minutes today, fluent in months.',
    'Write down lessons learned':  'A lesson not recorded is a lesson re-learned. Stop paying twice for the same education.',
    'Learn something new':         'A learning brain is a young brain. Curiosity is the antidote to stagnation.',
    'Language learning':           'Another language is another way of seeing the world. Daily reps build a second mind.',

    // 🌱 Wellbeing & Relationships
    'Morning gratitude practice':  "The mind that begins in gratitude doesn't easily fall into resentment. Train the lens.",
    'Pray or set intentions':      'Whether you call it prayer, meditation, or intention — the act of pausing to align matters more than the label.',
    'Call or text a family member':"Connection is the longest-running variable in human happiness research. Don't take the people who love you for granted.",
    'Do something kind for someone':'Kindness is its own reward and its own training. Strong people give without keeping score.',
    'Barefoot grounding outside':  "Direct contact with the earth is something we've forgotten we need. Try it before dismissing it.",
    'Vitamins and minerals':       "Cover the basics. The body can't perform on missing inputs.",
    'Visualization practice':      'The mind that has rehearsed the win is faster to execute it. See it before you live it.',
    'Sleep early before 11PM':     'Earlier bedtimes compound. Each hour before midnight is worth more than each hour after.',
  };
  // Apply the map onto DEFAULT_HABITS at startup. Each habit definition
  // gets the canonical description text. Habits without an entry are
  // logged so coverage gaps are obvious during development.
  DEFAULT_HABITS.forEach(h => {
    if (HABIT_DESCRIPTIONS[h.name]) {
      h.description = HABIT_DESCRIPTIONS[h.name];
    } else if (typeof console !== 'undefined' && console.warn) {
      console.warn('Habit missing description:', h.name);
    }
  });

  // ── HABIT STAT-COLOR HELPERS (used by History views) ─────
  function getHabitPrimaryStat(habit) {
    if (habit && habit.primaryStat) return habit.primaryStat;
    // Backward compat: habit was saved before primaryStat existed → look up by name
    const def = DEFAULT_HABITS.find(d => d.name === (habit && habit.name));
    return (def && def.primaryStat) || 'FOCUS';
  }
  function getHabitStatColor(habit) {
    const stId = getHabitPrimaryStat(habit);
    const st   = STATS.find(s => s.id === stId);
    return st ? st.color : '#475569'; // FOCUS shadow as ultimate fallback
  }
  // Difficulty → opacity within the stat color (preserves intensity signal)
  const DIFF_OPACITY = { easy: 0.6, medium: 0.75, hard: 0.9, legendary: 1.0 };
  function colorWithAlpha(hex, alpha) {
    if (!hex || hex[0] !== '#' || hex.length !== 7) return hex;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  // ── PACKS (Choose Your Path) ─────────────────────────────
  // Indices reference DEFAULT_HABITS (63 habits total, indices 0-62)
  // ── PACK COMPOSITION ───────────────────────────────────────
  // Indices into DEFAULT_HABITS. Locked-In is a SUPERSET of Morning
  // Routine — its habit list is composed from Morning's + 6 extras.
  // Single source of truth: change indices here, every UI surface follows.
  const _MORNING_HABIT_INDICES = [2, 23, 14, 16, 41, 6, 46, 12, 4, 19];
  // Locked-In adds: priority task(24), no social before noon(17),
  // no doomscrolling 5PM(29), plan tomorrow(25), no screens before bed(18), read(11)
  const _LOCKED_IN_EXTRA_INDICES = [24, 17, 29, 25, 18, 11];

  const PACKS = [
    {
      id:      'morning',
      emoji:   '🌅',
      name:    'Morning Routine',
      tagline: 'Win the morning. Win the day.',
      sub:     'For the intentional starter',
      color:   '#f59e0b',
      bonusLabel: '⚡ COMPOUND EFFECT BONUS',
      packLabel:  'Compound Effect Bonus',
      habits: _MORNING_HABIT_INDICES.slice(),
    },
    {
      id:      'locked-in',
      emoji:   '🔒',
      name:    'Locked-In',
      tagline: 'Master the day.',
      sub:     'The full discipline cycle — morning, afternoon, and evening.',
      color:   '#7c3aed',          // violet — distinct from MR's gold
      bonusLabel: '🔒 LOCKED-IN BONUS',
      packLabel:  'Locked-In Bonus',
      // Composed: 10 MR habits + 6 LI extras = 16 total. NEVER hardcode.
      habits: [..._MORNING_HABIT_INDICES, ..._LOCKED_IN_EXTRA_INDICES],
    },
    {
      id:      'custom',
      emoji:   '⚡',
      name:    'Make Your Own',
      tagline: 'Your path, your rules',
      color:   '#a855f7',
      habits:  [],
    },
  ];

  // Bonus-eligible packs in fire-order. MR fires before Locked-In so
  // when both complete in the same tick, the Compound Effect modal
  // shows first, then the Locked-In Bonus modal queues behind it.
  const BONUS_PACK_IDS = ['morning', 'locked-in'];

  // ── PACK HELPERS — generic, work for any packId ────────────
  function getPackById(packId)         { return PACKS.find(p => p.id === packId); }
  function getPackHabitDefs(packId) {
    const p = getPackById(packId);
    return (p && p.habits) ? p.habits.map(i => DEFAULT_HABITS[i]) : [];
  }
  function isHabitInPack(habit, packId) {
    if (!habit) return false;
    const names = new Set(getPackHabitDefs(packId).map(h => h.name));
    return names.has(habit.name);
  }
  function getMissingPackHabits(packId) {
    const activeNames = new Set(habits.map(h => h.name));
    return getPackHabitDefs(packId).filter(def => !activeNames.has(def.name));
  }
  function userHasAllPackHabits(packId) {
    return getMissingPackHabits(packId).length === 0;
  }

  // ── MORNING ROUTINE — backward-compat thin wrappers ─────────
  // Existing call sites continue to work; new code should use the
  // generic helpers above so future packs (3rd, 4th, ...) drop in cleanly.
  function getMorningPack()             { return getPackById('morning'); }
  function getMorningHabitDefs()        { return getPackHabitDefs('morning'); }
  function isMorningHabit(habit)        { return isHabitInPack(habit, 'morning'); }
  function getMissingMorningHabits()    { return getMissingPackHabits('morning'); }

  // ── STREAK FORGIVENESS — helpers ─────────────────────────
  const SHIELD_THRESHOLD = 14;  // days of consecutive completion to earn one
  const SHIELD_MAX       = 3;
  const COMEBACK_TIERS = [
    { minDays: 30, xp: 200, msg: 'Long road. Same destination. Welcome home, hunter.' },
    { minDays: 8,  xp: 100, msg: "You disappeared. You came back. That's the only metric that matters." },
    { minDays: 4,  xp: 50,  msg: 'A week away. The path waited.' },
    { minDays: 1,  xp: 25,  msg: 'The hunter who returns is stronger than the one who never fell.' },
  ];

  // Honest Day: 1 per calendar month per pack. Stored as date strings.
  function getHonestDayUsesThisMonth(packId) {
    const monthKey = today.slice(0, 7); // 'YYYY-MM'
    const list = honestDays[packId] || [];
    return list.filter(d => d.startsWith(monthKey)).length;
  }
  function isHonestDay(packId, dateStr) {
    return (honestDays[packId] || []).includes(dateStr);
  }
  function canMarkHonestDayToday(packId) {
    if (isHonestDay(packId, today)) return false;
    return getHonestDayUsesThisMonth(packId) < 1;
  }
  function markTodayAsHonestDay(packId) {
    if (!canMarkHonestDayToday(packId)) return false;
    if (!honestDays[packId]) honestDays[packId] = [];
    honestDays[packId].push(today);
    save();
    return true;
  }

  // Shield earning — called from awardCompoundEffect after streak increments.
  // One shield per 14-day milestone (14, 28, 42, ...) up to SHIELD_MAX stored.
  function tryEarnShield(packId, newStreak) {
    if (newStreak < SHIELD_THRESHOLD) return false;
    if ((newStreak % SHIELD_THRESHOLD) !== 0) return false;
    const lastClaimed = shieldClaimedAt[packId] || 0;
    if (newStreak <= lastClaimed) return false; // already granted at this threshold
    const cur = streakShields[packId] || 0;
    if (cur >= SHIELD_MAX) {
      shieldClaimedAt[packId] = newStreak;  // record so we don't notify again
      save();
      return false;
    }
    streakShields[packId] = cur + 1;
    shieldClaimedAt[packId] = newStreak;
    save();
    if (typeof showHabitToast === 'function') {
      showHabitToast('Streak Shield earned. You held ' + newStreak + ' straight days.');
    }
    return true;
  }

  // Day rollover — runs on init and on day-change. For each bonus pack
  // with an active streak, walks any missed days between lastDate and
  // yesterday, absorbing each via Honest Day or Shield. If absorption
  // fails, the streak breaks and a comeback flag is queued.
  function processStreakRollover() {
    BONUS_PACK_IDS.forEach(packId => {
      const cs = compoundStreaks[packId];
      if (!cs || !cs.lastDate || cs.streak === 0) return;
      if (cs.lastDate === today)            return;
      if (cs.lastDate === prevDay(today))   return;

      let cursor = nextDay(cs.lastDate);
      let broken = false;
      const safety = 400; // bound the loop
      let i = 0;
      while (cursor < today && i++ < safety) {
        // Absorb via Honest Day
        if (isHonestDay(packId, cursor)) {
          cs.lastDate = cursor;
          cursor = nextDay(cursor);
          continue;
        }
        // Absorb via Shield
        if ((streakShields[packId] || 0) > 0) {
          streakShields[packId] -= 1;
          pendingShieldNotices.push({
            packId,
            absorbedDate: cursor,
            streak:       cs.streak,
            remaining:    streakShields[packId],
          });
          cs.lastDate = cursor;
          cursor = nextDay(cursor);
          continue;
        }
        broken = true;
        break;
      }

      if (broken) {
        streakBreakLog.push({ packId, date: today, brokenStreak: cs.streak });
        if (streakBreakLog.length > 60) streakBreakLog = streakBreakLog.slice(-60);
        // Set comeback only if not already set (don't overwrite earlier break)
        if (!pendingComeback) {
          pendingComeback = { packId, brokenStreak: cs.streak, breakDate: today };
        }
        cs.streak = 0;
        cs.lastDate = null;
      }
    });
    save();
  }

  // Comeback detection — called from check() after a habit is completed.
  // If a real break is pending and this is the first completion since
  // the user was last active, fire the Comeback celebration.
  function checkComebackOnActivity() {
    if (!pendingComeback) return;
    if (!lastActiveDate || lastActiveDate === today) return; // already active today
    // Compute days away based on lastActiveDate
    const fromMs = Date.parse(lastActiveDate + 'T12:00:00Z');
    const toMs   = Date.parse(today + 'T12:00:00Z');
    const daysAway = Math.max(1, Math.round((toMs - fromMs) / 86400000));

    const tier = COMEBACK_TIERS.find(t => daysAway >= t.minDays) || COMEBACK_TIERS[COMEBACK_TIERS.length - 1];
    totalComebacks += 1;
    totalPoints    += tier.xp;
    pendingComeback = null;
    save();
    levelUpQueue.unshift({ type: 'comeback', daysAway, xp: tier.xp, msg: tier.msg });
    if (!levelUpActive) drainLevelUpQueue();
  }

  // Show queued shield notices as toasts on app open (one per packId batch)
  function flushPendingShieldNotices() {
    if (!pendingShieldNotices.length) return;
    const byPack = {};
    pendingShieldNotices.forEach(n => {
      if (!byPack[n.packId]) byPack[n.packId] = n;
      byPack[n.packId].count = (byPack[n.packId].count || 0) + 1;
    });
    pendingShieldNotices = [];
    save();
    Object.values(byPack).forEach((n, i) => {
      const pack = getPackById(n.packId);
      const name = pack ? pack.name : n.packId;
      const msg  = 'Shield used. ' + name + ' streak protected. ' + n.remaining + ' shield' + (n.remaining === 1 ? '' : 's') + ' remaining.';
      // Stagger so multiple don't pile on each other
      setTimeout(() => { if (typeof showHabitToast === 'function') showHabitToast(msg, { duration: 4500 }); }, 400 + i * 1800);
    });
  }

  // ── DAILY LEGENDARY MISSION — selection + state ─────────────
  // Returns today's mission object (selecting one if not yet picked).
  // Persists selection to localStorage, avoids repeats within 21 days,
  // and weights toward outdoor/nature/no-phone tags on weekends.
  function getOrPickTodayMission() {
    const existing = dailyQuests[today];
    if (existing && existing.id) {
      const found = LEGENDARY_MISSIONS.find(m => m.id === existing.id);
      if (found) return found;
    }
    // Avoid repeats within last 21 days
    const recent = new Set(
      (questHistory || []).slice(-21).map(h => h.missionId)
    );
    let pool = LEGENDARY_MISSIONS.filter(m => !recent.has(m.id));
    if (pool.length === 0) pool = LEGENDARY_MISSIONS.slice();

    let chosen = null;
    if (isWeekend() && Math.random() < 0.60) {
      const weekendTags = new Set(['outdoor', 'nature', 'no-phone']);
      const subset = pool.filter(m => (m.tags || []).some(t => weekendTags.has(t)));
      if (subset.length > 0) {
        chosen = subset[Math.floor(Math.random() * subset.length)];
      }
    }
    if (!chosen) {
      chosen = pool[Math.floor(Math.random() * pool.length)];
    }

    dailyQuests[today] = { id: chosen.id, manualDone: [], bonusAwarded: false };
    questHistory.push({ date: today, missionId: chosen.id });
    if (questHistory.length > 60) questHistory = questHistory.slice(-60);
    save();
    return chosen;
  }

  // Component completion derivation. Returns true if the component
  // should display as checked. Auto-derives from completion data
  // for habit-linked components (no stored flag), reads manualDone[]
  // for manual or fallback components.
  function isMissionComponentDone(comp) {
    const state = dailyQuests[today] || { manualDone: [] };
    const manualDone = state.manualDone || [];

    if (comp.matchType === 'manual') {
      return manualDone.includes(comp.id);
    }
    if (comp.matchType === 'habit') {
      const userHabit = habits.find(h => h.name === comp.habitName);
      if (userHabit) {
        return (completions[today] || []).includes(userHabit.id);
      }
      // User doesn't have the habit → fall back to manual toggle
      return manualDone.includes(comp.id);
    }
    if (comp.matchType === 'pack') {
      // Whole-pack completion: every canonical pack habit checked today
      const packId = comp.packId;
      if (packId === 'morning' && typeof userHasAllCanonicalMorning === 'function') {
        if (!userHasAllCanonicalMorning()) return manualDone.includes(comp.id);
        const { done, total } = getPackProgress('morning');
        return total > 0 && done === total;
      }
      if (packId === 'locked-in' && typeof userHasAllCanonicalLockedIn === 'function') {
        if (!userHasAllCanonicalLockedIn()) return manualDone.includes(comp.id);
        const { done, total } = getPackProgress('locked-in');
        return total > 0 && done === total;
      }
      return manualDone.includes(comp.id);
    }
    return false;
  }

  // Tappable when manual or when habit-linked but user doesn't have the habit
  function isMissionComponentTappable(comp) {
    if (comp.matchType === 'manual') return true;
    if (comp.matchType === 'pack')   return false; // derived-only
    if (comp.matchType === 'habit') {
      return !habits.some(h => h.name === comp.habitName);
    }
    return false;
  }

  // Toggle a manual or fallback-manual component on/off
  function toggleMissionComponent(componentId) {
    const state = dailyQuests[today];
    if (!state) return;
    const list = state.manualDone || (state.manualDone = []);
    const idx  = list.indexOf(componentId);
    if (idx >= 0) list.splice(idx, 1); else list.push(componentId);
    save();
    onMissionProgress();
  }

  function isMissionComplete(mission) {
    if (!mission) return false;
    return mission.components.every(c => isMissionComponentDone(c));
  }

  // Called any time a habit is checked or a manual component is toggled.
  // Awards the +50 XP bonus and fires the celebration on the transition
  // from incomplete → complete (idempotent via bonusAwarded flag).
  function onMissionProgress() {
    const mission = getOrPickTodayMission();
    if (!mission) return;
    const state = dailyQuests[today];
    if (!state) return;
    if (state.bonusAwarded) {
      renderDailyMissionCard();
      return;
    }
    if (isMissionComplete(mission)) {
      state.bonusAwarded = true;
      const baseXP  = 50;
      const finalXP = isWeekend() ? baseXP * 2 : baseXP;
      totalPoints  += finalXP;
      // PR hooks
      if (typeof prUpdate === 'function') {
        prUpdate('total_xp_lifetime', getPR('total_xp_lifetime').value + finalXP);
        prUpdate('total_missions_complete', getPR('total_missions_complete').value + 1);
        // Refresh today's xp PR (compound day, etc.)
        prUpdate('most_xp_day', computeTodayXP());
      }
      save();
      renderRank();
      // Queue celebration via levelUpQueue so it sequences after pack bonuses
      levelUpQueue.unshift({ type: 'mission', mission, xp: finalXP, doubled: isWeekend() });
      if (!levelUpActive) drainLevelUpQueue();
    }
    renderDailyMissionCard();
  }

  // ── STORAGE ───────────────────────────────────────────────
  function load() {
    try {
      const raw = localStorage.getItem('hb_habits');
      if (raw === null) {
        needsOnboarding = true;
        if (!localStorage.getItem('hb_welcomed')) needsWelcome = true;
      } else {
        habits = JSON.parse(raw);
      }
      completions = JSON.parse(localStorage.getItem('hb_completions') || '{}');
      streaks     = JSON.parse(localStorage.getItem('hb_streaks')     || '{}');
      totalPoints = parseInt(localStorage.getItem('hb_points') || '0', 10) || 0;
      const ach   = JSON.parse(localStorage.getItem('hb_achievements') || '[]');
      unlockedAchievements = new Set(ach);
      achievementUnlockDates = JSON.parse(localStorage.getItem('hb_ach_dates') || '{}');
      const rawStats = localStorage.getItem('hb_stats');
      stats = rawStats ? JSON.parse(rawStats) : initStats();
      const rawSB = localStorage.getItem('hb_stat_bonuses');
      statBonuses = new Set(rawSB ? JSON.parse(rawSB) : []);
      playerName  = localStorage.getItem('hb_name') || 'Hunter';
      const savedClass = localStorage.getItem('hb_class');
      const validClassKeys = [...STATS.map(st => st.id), 'SAGE'];
      currentClass = validClassKeys.includes(savedClass) ? savedClass : null;
      const rawPS  = localStorage.getItem('hb_perfect_streak');
      habitNotes      = JSON.parse(localStorage.getItem('hb_notes')             || '{}');
      compoundStreaks  = JSON.parse(localStorage.getItem('hb_compound')         || '{}');
      compoundAwarded  = JSON.parse(localStorage.getItem('hb_compound_awarded') || '{}');
      personalRecords  = JSON.parse(localStorage.getItem('hb_prs')               || '{}');
      dailyQuests      = JSON.parse(localStorage.getItem('hb_daily_quests')      || '{}');
      questHistory     = JSON.parse(localStorage.getItem('hb_quest_history')     || '[]');
      streakShields    = JSON.parse(localStorage.getItem('hb_shields')           || '{}');
      shieldClaimedAt  = JSON.parse(localStorage.getItem('hb_shield_claimed')    || '{}');
      pendingShieldNotices = JSON.parse(localStorage.getItem('hb_shield_notices') || '[]');
      honestDays       = JSON.parse(localStorage.getItem('hb_honest_days')       || '{}');
      pendingComeback  = JSON.parse(localStorage.getItem('hb_pending_comeback')  || 'null');
      lastActiveDate   = localStorage.getItem('hb_last_active') || null;
      totalComebacks   = parseInt(localStorage.getItem('hb_total_comebacks') || '0', 10) || 0;
      streakBreakLog   = JSON.parse(localStorage.getItem('hb_streak_breaks')     || '[]');
      originBeginning  = JSON.parse(localStorage.getItem('hb_origin_beginning')  || 'null');
      originAwakening  = JSON.parse(localStorage.getItem('hb_origin_awakening')  || 'null');
      // Backward-compat: an earlier version stored a single-story key.
      // If present and we have nothing in the new awakening slot, migrate it.
      if (!originAwakening) {
        const legacy = JSON.parse(localStorage.getItem('hb_origin_story') || 'null');
        if (legacy && legacy.text) {
          originAwakening = legacy;
          localStorage.setItem('hb_origin_awakening', JSON.stringify(originAwakening));
        }
      }
      perfectStreak = rawPS ? JSON.parse(rawPS)
        : { count: 0, lastDate: null, prevCount: 0, prevLastDate: null };
      const rawPSA = localStorage.getItem('hb_ps_awarded');
      psAwarded = new Set(rawPSA ? JSON.parse(rawPSA) : []);
      selectedPackId = localStorage.getItem('hb_path') || null;
    } catch (_) {
      habits = []; completions = {}; streaks = {};
      totalPoints = 0; unlockedAchievements = new Set();
      stats = initStats(); statBonuses = new Set();
      playerName = 'Hunter';
      perfectStreak = { count: 0, lastDate: null, prevCount: 0, prevLastDate: null };
      psAwarded = new Set();
    }
  }

  function initStats() {
    const s = {};
    STATS.forEach(st => s[st.id] = { pts: 0 });
    return s;
  }

  function save() {
    try {
      localStorage.setItem('hb_habits',         JSON.stringify(habits));
      localStorage.setItem('hb_completions',     JSON.stringify(completions));
      localStorage.setItem('hb_streaks',         JSON.stringify(streaks));
      localStorage.setItem('hb_points',          String(totalPoints));
      localStorage.setItem('hb_achievements',    JSON.stringify([...unlockedAchievements]));
      localStorage.setItem('hb_ach_dates',       JSON.stringify(achievementUnlockDates));
      localStorage.setItem('hb_stats',           JSON.stringify(stats));
      localStorage.setItem('hb_stat_bonuses',    JSON.stringify([...statBonuses]));
      localStorage.setItem('hb_perfect_streak',  JSON.stringify(perfectStreak));
      localStorage.setItem('hb_ps_awarded',      JSON.stringify([...psAwarded]));
      localStorage.setItem('hb_notes',             JSON.stringify(habitNotes));
      localStorage.setItem('hb_compound',          JSON.stringify(compoundStreaks));
      localStorage.setItem('hb_compound_awarded',  JSON.stringify(compoundAwarded));
      localStorage.setItem('hb_prs',               JSON.stringify(personalRecords));
      localStorage.setItem('hb_daily_quests',      JSON.stringify(dailyQuests));
      localStorage.setItem('hb_quest_history',     JSON.stringify(questHistory));
      localStorage.setItem('hb_shields',           JSON.stringify(streakShields));
      localStorage.setItem('hb_shield_claimed',    JSON.stringify(shieldClaimedAt));
      localStorage.setItem('hb_shield_notices',    JSON.stringify(pendingShieldNotices));
      localStorage.setItem('hb_honest_days',       JSON.stringify(honestDays));
      localStorage.setItem('hb_pending_comeback',  JSON.stringify(pendingComeback));
      if (lastActiveDate) localStorage.setItem('hb_last_active', lastActiveDate);
      localStorage.setItem('hb_total_comebacks',   String(totalComebacks));
      localStorage.setItem('hb_streak_breaks',     JSON.stringify(streakBreakLog));
      localStorage.setItem('hb_origin_beginning',  JSON.stringify(originBeginning));
      localStorage.setItem('hb_origin_awakening',  JSON.stringify(originAwakening));
    } catch (_) {}
  }

  // ── RANK HELPERS ──────────────────────────────────────────
  function getRank(pts) {
    for (let i = RANKS.length - 1; i >= 0; i--) {
      if (pts >= RANKS[i].min) return RANKS[i];
    }
    return RANKS[0];
  }

  // ── PERSONAL RECORDS — helpers ────────────────────────────
  function getPRDef(prId) { return PR_DEFS.find(p => p.id === prId); }
  function getPR(prId) {
    return personalRecords[prId] || { value: 0, meta: null, lastUpdated: null };
  }
  // Compares newValue against current PR. Updates if greater (numbers) or
  // higher-tier (rank). Queues the appropriate celebration unless suppressed.
  function prUpdate(prId, newValue, meta) {
    const def = getPRDef(prId);
    if (!def) return;
    const cur      = getPR(prId);
    const prevVal  = cur.value || 0;
    let isNew = false;

    if (prId === 'highest_rank') {
      // Rank PR: compare tier index, not numeric. Higher index = higher rank.
      const newIdx = RANKS.findIndex(r => r.id === newValue);
      const curIdx = cur.value ? RANKS.findIndex(r => r.id === cur.value) : -1;
      isNew = newIdx > curIdx;
    } else {
      isNew = (newValue > prevVal);
    }
    if (!isNew) return;

    personalRecords[prId] = {
      value:        newValue,
      meta:         meta || cur.meta || null,
      lastUpdated:  today,
    };
    save();

    // Celebrations disabled — PRs update silently. The user can still see
    // every value in the All-PRs sheet (🏆 chip on the Status tab). Flip
    // this constant to re-enable popups/toasts/takeovers in one line.
    if (!PR_CELEBRATIONS_ENABLED) return;
    if (_suppressPRCelebrations) return;

    // Determine celebration mode based on tier + milestone semantics
    let mode = 'tier' + def.tier; // default

    // Tier 1 PRs only celebrate on round-number milestones
    if (def.tier === 1) {
      const hit = (def.milestones || []).some(m => prevVal < m && newValue >= m);
      if (!hit) return; // increment without milestone — silent
    }
    // Tier 3 streak PRs only takeover on specific day thresholds
    if (def.tier === 3 && def.takeoverDays) {
      const hit = def.takeoverDays.some(d => prevVal < d && newValue >= d);
      if (!hit) {
        // Not a takeover day yet — fall back to tier 2 modal
        mode = 'tier2';
      }
    }
    // Highest-rank PR: takeover on every new-tier-ever
    // (already gated by isNew check above — every fire IS a new tier)

    _prCelebrationQueue.push({ prId, newValue, prevValue: prevVal, meta: personalRecords[prId].meta, mode });
    drainPRCelebrationQueue();
  }

  // Backfill from existing user data on first launch of v1.1+ (idempotent)
  function migratePRsIfNeeded() {
    if (localStorage.getItem('hb_prs_migrated') === '1') return;
    _suppressPRCelebrations = true;
    try {
      // total_habits_lifetime: count every completion logged
      let totalHabits = 0;
      let activeDays  = 0;
      let bestDayCount = 0;
      for (const d in completions) {
        const list = completions[d] || [];
        if (list.length === 0) continue;
        totalHabits += list.length;
        activeDays  += 1;
        if (list.length > bestDayCount) bestDayCount = list.length;
      }
      prUpdate('total_habits_lifetime', totalHabits);
      prUpdate('total_active_days',     activeDays);
      prUpdate('most_habits_day',       bestDayCount);
      // total_xp_lifetime: best estimate is current points (no historic XP log)
      prUpdate('total_xp_lifetime',     totalPoints);
      // pack streaks: current = lifetime best at upgrade time
      prUpdate('longest_mr_streak',     ((compoundStreaks['morning']   || {}).streak) || 0);
      prUpdate('longest_li_streak',     ((compoundStreaks['locked-in'] || {}).streak) || 0);
      // highest rank: current rank (only goes up from here)
      prUpdate('highest_rank',          getRank(totalPoints).id);
      // longest_habit_streak: scan current habit streaks
      let bestHabit = { name: null, count: 0 };
      Object.keys(streaks).forEach(hid => {
        const s = streaks[hid];
        if (s && s.count > bestHabit.count) {
          const h = habits.find(hh => hh.id === hid);
          if (h) bestHabit = { name: h.name, count: s.count };
        }
      });
      if (bestHabit.count > 0) prUpdate('longest_habit_streak', bestHabit.count, { habitName: bestHabit.name });
      // longest_stat_streak: compute current best across stats
      let bestStat = { id: null, count: 0 };
      STATS.forEach(st => {
        const c = computeCurrentStatStreak(st.id);
        if (c > bestStat.count) bestStat = { id: st.id, count: c };
      });
      if (bestStat.count > 0) prUpdate('longest_stat_streak', bestStat.count, { statId: bestStat.id });
    } finally {
      _suppressPRCelebrations = false;
      localStorage.setItem('hb_prs_migrated', '1');
    }
  }

  // Walks back from today day-by-day. Returns the current consecutive-day
  // count where at least one habit feeding `statId` was completed.
  function computeCurrentStatStreak(statId) {
    const stat = STATS.find(s => s.id === statId);
    if (!stat) return 0;
    const habitNames = new Set(stat.habits);
    const habitIdsByName = {};
    habits.forEach(h => { habitIdsByName[h.name] = h.id; });
    let d = today;
    let streak = 0;
    let safety = 0;
    while (safety++ < 1000) {
      const list = completions[d] || [];
      const dayHasStat = list.some(hid => {
        const h = habits.find(hh => hh.id === hid);
        return h && habitNames.has(h.name);
      });
      if (!dayHasStat) {
        // If today is the start (streak=0) and today not done yet, it's OK to break
        // (streak of 0 means "no current run"). Otherwise the run ends.
        break;
      }
      streak++;
      d = prevDay(d);
    }
    return streak;
  }

  // Counts XP earned today by walking today's completions (plus any compound bonuses).
  // Used to update most_xp_day at end of every check().
  function computeTodayXP() {
    const list = completions[today] || [];
    let xp = 0;
    list.forEach(hid => {
      const h = habits.find(hh => hh.id === hid);
      if (!h) return;
      const base = (DIFFICULTY[h.difficulty || 'easy'] || DIFFICULTY.easy).pts;
      xp += isWeekend() ? base * 2 : base;
    });
    // Add today's compound bonuses
    BONUS_PACK_IDS.forEach(packId => {
      if (compoundAwarded[packId] === today) {
        const cs = compoundStreaks[packId];
        const streak = (cs && cs.lastDate === today) ? cs.streak : 0;
        if (streak > 0) {
          const base = getCompoundXP(streak);
          xp += isWeekend() ? base * 2 : base;
        }
      }
    });
    return xp;
  }

  function diffPts(diff) {
    const base = (DIFFICULTY[diff] || DIFFICULTY.easy).pts;
    return isWeekend() ? base * 2 : base;
  }

  // ── STREAK / CHECK HELPERS ────────────────────────────────
  function getStreak(id) {
    return (streaks[id] && streaks[id].count) || 0;
  }

  function isChecked(id) {
    const list = completions[today];
    return Array.isArray(list) && list.includes(id);
  }

  function check(id) {
    if (isChecked(id)) return;
    if (!completions[today]) completions[today] = [];
    completions[today].push(id);

    const habit = habits.find(h => h.id === id);
    const habitDays = habit?.days || ALL_DAYS;

    const s = streaks[id] || { count: 0, lastDate: null, prevCount: 0, prevLastDate: null };
    s.prevCount = s.count;
    s.prevLastDate = s.lastDate;

    if (s.lastDate === today) {
      // already counted today
    } else if (!s.lastDate) {
      s.count = 1;
    } else {
      s.count = hasScheduledDayBetween(habitDays, s.lastDate, today) ? 1 : s.count + 1;
    }
    s.lastDate = today;
    streaks[id] = s;

    const pts = diffPts(habit ? habit.difficulty : 'easy');
    totalPoints += pts;
    applyStatPts(habit, pts, 1);
    save();
    checkAchievements();
    checkStatBonuses();
    checkWeekendChallenge(id);

    // ── Personal Records hooks ─────────────────────────────
    // Lifetime totals: increment on every completion.
    prUpdate('total_habits_lifetime', getPR('total_habits_lifetime').value + 1);
    prUpdate('total_xp_lifetime',     getPR('total_xp_lifetime').value     + pts);
    // Today's PRs: recompute against current totals.
    const todayCount = (completions[today] || []).length;
    prUpdate('most_habits_day', todayCount);
    prUpdate('most_xp_day',     computeTodayXP());
    // Active days: if this is the first completion of a new day, increment.
    if (todayCount === 1) {
      prUpdate('total_active_days', getPR('total_active_days').value + 1);
    }
    // Per-habit streak PR
    if (habit && s.count > getPR('longest_habit_streak').value) {
      prUpdate('longest_habit_streak', s.count, { habitName: habit.name });
    }
    // ── Streak Forgiveness: comeback detection ────────────────
    // Fire BEFORE updating lastActiveDate so we still see the old value
    // to compute days-away accurately.
    if (typeof checkComebackOnActivity === 'function') checkComebackOnActivity();
    lastActiveDate = today;

    // Daily Mission auto-progress: if this habit matches a component
    // of today's quest, the component flips to "done" automatically and
    // we check whether the whole quest is now complete.
    if (typeof onMissionProgress === 'function') onMissionProgress();
    // Per-stat streak — find the stat this habit feeds and check its streak
    if (habit) {
      STATS.forEach(st => {
        if (!st.habits.includes(habit.name)) return;
        const cur = computeCurrentStatStreak(st.id);
        if (cur > getPR('longest_stat_streak').value) {
          prUpdate('longest_stat_streak', cur, { statId: st.id });
        }
      });
    }
  }

  function uncheck(id) {
    if (!isChecked(id)) return;
    completions[today] = completions[today].filter(x => x !== id);

    const s = streaks[id];
    if (s && s.lastDate === today) {
      s.count = s.prevCount || 0;
      s.lastDate = s.prevLastDate || null;
    }

    const habit = habits.find(h => h.id === id);
    const pts = diffPts(habit ? habit.difficulty : 'easy');
    totalPoints = Math.max(0, totalPoints - pts);
    applyStatPts(habit, pts, -1);
    save();
  }

  // ── ACHIEVEMENTS ──────────────────────────────────────────
  // Build the achievement evaluation context — used by both unlock checks
  // and the renderer for live progress bars on locked rows.
  function buildAchievementContext() {
    const allStreaks    = Object.values(streaks).map(s => s.count || 0);
    const maxStreak     = allStreaks.length ? Math.max(...allStreaks) : 0;
    const legStreaks    = habits.filter(h => h.difficulty === 'legendary')
                                .map(h => (streaks[h.id] && streaks[h.id].count) || 0);
    const maxLegStreak  = legStreaks.length ? Math.max(...legStreaks) : 0;
    const totalCompletions = Object.values(completions).reduce((n, arr) => n + arr.length, 0);
    const totalStatLevel = STATS.reduce((sum, st) => sum + statLevel(stats[st.id]?.pts || 0), 0);
    const statsAtLv5 = STATS.filter(st => statLevel(stats[st.id]?.pts || 0) >= 5).length;
    const maxStatLv  = STATS.reduce((m, st) => Math.max(m, statLevel(stats[st.id]?.pts || 0)), 0);
    const hasClass   = currentClass && currentClass !== 'CIVILIAN';
    const isSage     = currentClass === 'SAGE';
    const mrStreak   = (compoundStreaks && compoundStreaks['morning']   && compoundStreaks['morning'].streak)   || 0;
    const liStreak   = (compoundStreaks && compoundStreaks['locked-in'] && compoundStreaks['locked-in'].streak) || 0;
    const bothCrownsToday = compoundAwarded['morning'] === today && compoundAwarded['locked-in'] === today;
    const questsComplete  = (typeof getPR === 'function')
      ? (getPR('total_missions_complete').value || 0) : 0;
    const perfectStreakNow = (perfectStreak && perfectStreak.count) || 0;
    const anyPRSet = (typeof personalRecords === 'object' &&
                      Object.keys(personalRecords).some(k => (personalRecords[k] || {}).value > 0));
    // Per-habit lifetime completion counts for habit-mastery achievements
    function countCompletionsByName(name) {
      const habit = habits.find(h => h.name === name);
      if (!habit) return 0;
      let n = 0;
      for (const d in completions) {
        if (Array.isArray(completions[d]) && completions[d].includes(habit.id)) n++;
      }
      return n;
    }
    return {
      maxStreak,
      maxLegStreak,
      totalCompletions,
      totalPoints,
      totalStatLevel,
      statsAtLv5,
      maxStatLv,
      hasClass,
      isSage,
      mrStreak,
      liStreak,
      bothCrownsToday,
      questsComplete,
      perfectStreak: perfectStreakNow,
      anyPRSet,
      activeDays:    Object.keys(completions).filter(d => (completions[d] || []).length > 0).length,
      coldCount:     countCompletionsByName('Cold shower') + countCompletionsByName('Ice bath or cold plunge'),
      readCount:     countCompletionsByName('Read'),
      strengthCount: countCompletionsByName('Strength training'),
      meditateCount: countCompletionsByName('Meditate & Breathwork'),
      phoneOffCount: countCompletionsByName('No phone or social media after waking'),
    };
  }

  function checkAchievements() {
    const ctx = buildAchievementContext();
    const newlyUnlocked = [];
    ACHIEVEMENTS.forEach(ach => {
      if (unlockedAchievements.has(ach.id)) return;
      const p = (typeof ach.getProgress === 'function') ? ach.getProgress(ctx) : null;
      if (!p) return;
      if (p.current >= p.target) {
        unlockedAchievements.add(ach.id);
        achievementUnlockDates[ach.id] = today;
        newlyUnlocked.push(ach);
      }
    });

    if (newlyUnlocked.length) {
      // FULLY AWAKENED grants a one-time +2,000 rank XP bonus (preserved)
      if (newlyUnlocked.find(a => a && a.id === 'fully_awakened')) {
        totalPoints += 2000;
      }
      save();
      achQueue.push(...newlyUnlocked.filter(Boolean));
    }
  }

  // ── STATS ─────────────────────────────────────────────────
  // XP required to advance FROM level `l` TO level `l+1`
  function xpToNextLevel(l) {
    // Explicit XP required to go FROM level l TO level l+1 (max level is 20)
    const TABLE = [5, 15, 30, 50, 75, 105, 140, 180, 225, 275, 330, 390, 455, 525, 600, 680, 765, 855, 950];
    return (l >= 1 && l <= 19) ? TABLE[l - 1] : 0; // 0 at cap — Level 20 has nowhere to go
  }

  // Total cumulative XP needed to REACH level `l` (level 1 = 0 XP)
  function xpForLevel(l) {
    let total = 0;
    for (let i = 1; i < l; i++) total += xpToNextLevel(i);
    return total;
  }

  function statLevel(pts) {
    if (!pts || pts <= 0) return 1;
    let lv = 1, cumXP = 0;
    while (lv < 20) {
      const needed = xpToNextLevel(lv);
      if (pts < cumXP + needed) break;
      cumXP += needed;
      lv++;
    }
    return lv;
  }

  function applyStatPts(habit, pts, direction) {
    if (!habit) return;
    const MAX_STAT_XP = 6650; // total XP to reach Level 20 (hard cap) — sum of all 19 level thresholds

    // Custom habits don't appear in any STATS[].habits list, so the
    // name-match path below would skip them. Use getHabitPrimaryStat
    // (which honors a habit's stored primaryStat) to route their XP.
    if (habit.custom && habit.primaryStat) {
      const stId = habit.primaryStat;
      if (!stats[stId]) stats[stId] = { pts: 0 };
      const raw = (stats[stId].pts || 0) + direction * pts;
      stats[stId].pts = Math.max(0, direction > 0 ? Math.min(MAX_STAT_XP, raw) : raw);
      if (currentTab === 'profile') renderProfile();
      if (currentTab === 'stats')   renderStats();
      return;
    }

    // Curated habits — name-based routing into every STATS bucket they
    // appear in. (A few habits like "Cardio" build both STR and VIT.)
    const habitName = habit.name;
    if (!habitName) return;
    STATS.forEach(st => {
      if (st.habits.includes(habitName)) {
        if (!stats[st.id]) stats[st.id] = { pts: 0 };
        const raw = (stats[st.id].pts || 0) + direction * pts;
        stats[st.id].pts = Math.max(0, direction > 0 ? Math.min(MAX_STAT_XP, raw) : raw);
      }
    });
    if (currentTab === 'profile') renderProfile();
    if (currentTab === 'stats')   renderStats();
  }

  function checkStatBonuses() {
    let bonusAwarded = false;
    STATS.forEach(st => {
      const level = statLevel(stats[st.id]?.pts || 0);
      STAT_BONUS_THRESHOLDS.forEach(thr => {
        const key = st.id + '_' + thr.level;
        if (level >= thr.level && !statBonuses.has(key)) {
          statBonuses.add(key);
          totalPoints += thr.pts;
          bonusAwarded = true;
          achQueue.push({
            label: 'STAT BONUS',
            icon: st.icon,
            name: st.label + ' reached Level ' + thr.level,
            desc: '+' + thr.pts + ' XP bonus added to your rank!',
          });
        }
      });
    });
    if (bonusAwarded) {
      save();
      renderRank();
    }
  }

  // ── CLASS SYSTEM ──────────────────────────────────────────
  // ── CLASS ASSIGNMENT (v1.2 rules) ─────────────────────────
  // - All stats < Lv5         → CIVILIAN  (the unawakened default)
  // - 1 stat ≥ Lv5            → that stat's class (auto-assigned, fires Awakening)
  // - 2+ stats ≥ Lv5 + still Civilian → CHOICE (user picks their path)
  // - All 6 ≥ Lv5 + within 15% → SAGE
  // - Has class → shift only if a different stat exceeds current class lv by 20%+
  function _statLevels() {
    const lv = STATS.map(st => ({ id: st.id, lv: statLevel(stats[st.id]?.pts || 0) }));
    lv.sort((a, b) => b.lv - a.lv);
    return lv;
  }

  // Returns { class, choice? }. If `choice` is set, the user must pick from
  // those class ids before the new class is committed.
  function evaluateClass(currentCls) {
    const levels     = _statLevels();
    const qualifiers = levels.filter(l => l.lv >= CLASS_LV5_THRESHOLD);

    if (qualifiers.length === 0) return { class: 'CIVILIAN' };

    // Sage: all 6 qualify and balance is within 15%
    if (qualifiers.length === 6) {
      const top = levels[0].lv;
      const min = levels[5].lv;
      if (top > 0 && (min / top) >= CLASS_BALANCE_RATIO) {
        return { class: 'SAGE' };
      }
    }

    // Single qualifier — auto-assign
    if (qualifiers.length === 1) return { class: qualifiers[0].id };

    // Multiple qualifiers, user is still Civilian → must choose
    if (!currentCls || currentCls === 'CIVILIAN') {
      return { class: 'CIVILIAN', choice: qualifiers.map(q => q.id) };
    }

    // Multiple qualifiers, user already has a class → shift only on dominance
    if (currentCls === 'SAGE') return { class: 'SAGE' };  // Sage is sticky once earned

    const top       = qualifiers[0];
    const currentLv = (levels.find(l => l.id === currentCls) || { lv: 0 }).lv;
    if (top.id !== currentCls && currentLv > 0 &&
        (top.lv / currentLv) >= CLASS_SHIFT_DOMINANCE) {
      return { class: top.id };
    }
    return { class: currentCls };
  }

  // Backward-compat shim — anything still calling determineClass() gets
  // a class id the same way the old function did.
  function determineClass() {
    return evaluateClass(currentClass).class;
  }

  function isClassShifting() {
    if (!currentClass || currentClass === 'CIVILIAN' || currentClass === 'SAGE') return false;
    const levels    = _statLevels();
    const top       = levels[0];
    if (top.lv < CLASS_LV5_THRESHOLD) return false;
    const currentLv = (levels.find(l => l.id === currentClass) || { lv: 0 }).lv;
    if (top.id === currentClass || currentLv === 0) return false;
    const ratio = top.lv / currentLv;
    return ratio >= 1.10 && ratio < CLASS_SHIFT_DOMINANCE;  // 10–20% transition zone
  }

  // For Civilian users — find the stat closest to Lv5 for the progress hint.
  function getClosestStatToAwaken() {
    const levels = _statLevels();
    const top    = levels[0];
    if (!top) return null;
    if (top.lv >= CLASS_LV5_THRESHOLD) return null;
    const tied = levels.filter(l => l.lv === top.lv).map(l => l.id);
    return { ids: tied, lv: top.lv, target: CLASS_LV5_THRESHOLD };
  }

  function checkClassChange(silent) {
    const result = evaluateClass(currentClass);

    // Choice required: 2+ stats hit Lv5 simultaneously while still Civilian
    if (result.choice && currentClass === 'CIVILIAN') {
      if (silent) {
        // Migration path — don't fire popup. User stays Civilian until they
        // either next earn a single new Lv5 (auto-assign) or open the app
        // and a level-up triggers the choice naturally.
        return;
      }
      levelUpQueue.push({ type: 'classChoice', options: result.choice });
      if (!levelUpActive) drainLevelUpQueue();
      return;
    }

    if (result.class === currentClass) return;

    const wasCivilian = (currentClass === 'CIVILIAN' || currentClass === null);
    currentClass = result.class;
    localStorage.setItem('hb_class', currentClass);
    // Re-arm the morning digest so its title ("Awakened — Warrior") and
    // its body (class-flavored copy) reflect the new class. This is
    // best-effort and silent — it can no-op on web (Notif.reapplyDigest
    // checks for the native plugin). Same goes for the 6 PM check-in.
    try { Notif.reapplyDigest(); } catch (_) {}
    try { Notif.reapplyCheckin(); } catch (_) {}

    if (!silent) {
      // First-time awakening (Civilian → any class) gets a special celebration.
      // Subsequent class shifts use the lighter class-change popup.
      const isAwakening = wasCivilian && currentClass !== 'CIVILIAN';
      const seenAwakeningKey = 'hb_awakened_once';
      if (isAwakening && !localStorage.getItem(seenAwakeningKey)) {
        localStorage.setItem(seenAwakeningKey, '1');
        // Generate + persist the origin story BEFORE queuing — so the
        // story is saved even if the user closes the app mid-celebration.
        saveAwakeningIfMissing(currentClass);
        levelUpQueue.push({ type: 'awakening', classData: CLASSES[currentClass] });
      } else {
        levelUpQueue.push({ type: 'class', classData: CLASSES[currentClass] });
      }
      if (!levelUpActive) drainLevelUpQueue();
    }
    if (currentTab === 'profile') renderProfile();
    if (currentTab === 'stats')   renderStats();
  }

  function showClassChangePopup(cls) {
    const popup = document.getElementById('class-popup');
    const card  = document.getElementById('class-popup-card');
    card.style.borderColor = cls.color + '60';
    card.style.boxShadow   = '0 0 48px ' + cls.color + '30';
    card.style.setProperty('--cp-color', cls.color);
    // Class emoji replaced with custom emblem icon. Falls back to empty
    // if the class id isn't mapped (no broken image).
    const _cpKey = (typeof currentClass === 'string') ? currentClass : null;
    document.getElementById('class-popup-emoji').innerHTML = classIconHtml(_cpKey, { size: 72 });
    document.getElementById('class-popup-name').textContent  = cls.name;
    document.getElementById('class-popup-desc').textContent  = cls.desc;
    popup.classList.remove('hidden');
    void card.offsetWidth;
    card.classList.add('cp-animate');
    navigator.vibrate && navigator.vibrate([40, 25, 70, 25, 40]);
    let timer;
    const dismiss = () => {
      clearTimeout(timer);
      popup.classList.add('hidden');
      card.classList.remove('cp-animate');
      levelUpActive = false;
      drainLevelUpQueue();
    };
    // Same tap-disarm guard as the stat level-up popup — prevents one tap
    // from blowing through several queued popups in a row.
    popup.onclick = null;
    setTimeout(() => { popup.onclick = dismiss; }, 400);
    timer = setTimeout(dismiss, 3500);
  }

  // ── AWAKENING — first-ever class assignment celebration ──
  // ── ORIGIN STORY — generation + migration ───────────────
  function _formatOriginDate(dateStr) {
    try {
      return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US',
        { month: 'long', day: 'numeric', year: 'numeric' });
    } catch (_) { return dateStr; }
  }
  // Short numeric form for chapter header labels — '5/1/2026'
  function _shortDate(dateStr) {
    try {
      return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US',
        { month: 'numeric', day: 'numeric', year: 'numeric' });
    } catch (_) { return dateStr; }
  }
  function _originWeekdayNoun(dateStr) {
    try {
      const wk = new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
      return WEEKDAY_NOUNS[wk] || 'soul';
    } catch (_) { return 'soul'; }
  }

  function _originName() {
    // Use the user's actual name. The default 'Hunter' is a real name
    // for narrative purposes — we only fall back to 'the hunter' when
    // the field is genuinely empty/null.
    if (playerName && playerName.trim()) return playerName.trim();
    return 'the hunter';
  }

  // Chapter 1 — class-agnostic, generated at onboarding completion.
  function generateBeginningStory(dateStr) {
    const useDate     = dateStr || today;
    const dateDisplay = _formatOriginDate(useDate);
    const text = BEGINNING_TEMPLATE
      .replace('{DATE}', dateDisplay)
      .replace('{NAME}', _originName());
    return { text, dateISO: useDate, dateDisplay };
  }

  // Chapter 2 — class-specific, generated at first awakening.
  function generateAwakeningStory(classKey, dateStr) {
    const tpl = ORIGIN_TEMPLATES[classKey];
    if (!tpl) return null;
    const useDate     = dateStr || today;
    const dateDisplay = _formatOriginDate(useDate);
    const text = tpl
      .replace('{DATE}', dateDisplay)
      .replace('{NAME}', _originName());
    return { text, classKey, dateISO: useDate, dateDisplay };
  }

  // Idempotent savers — called at generation moments. Never overwrite.
  function saveBeginningIfMissing() {
    if (originBeginning && originBeginning.text) return;
    originBeginning = generateBeginningStory();
    save();
  }
  function saveAwakeningIfMissing(classKey) {
    if (originAwakening && originAwakening.text) return;
    const story = generateAwakeningStory(classKey);
    if (!story) return;
    originAwakening = story;
    save();
  }

  // ── v3 TEMPLATE REWRITE — regenerate existing stories using the new
  // template text while preserving the ORIGINAL stored date and (for
  // Chapter 2) class. Silent migration — no animation, no toast.
  function migrateOriginTextV3IfNeeded() {
    if (localStorage.getItem('hb_origin_v3_migrated') === '1') return;
    let dirty = false;
    if (originBeginning && originBeginning.text && originBeginning.dateISO) {
      const fresh = generateBeginningStory(originBeginning.dateISO);
      if (fresh) {
        // Preserve any flags on the original entry (e.g., migrated)
        fresh.migrated = !!originBeginning.migrated;
        originBeginning = fresh;
        dirty = true;
      }
    }
    if (originAwakening && originAwakening.text &&
        originAwakening.classKey && originAwakening.dateISO) {
      const fresh = generateAwakeningStory(originAwakening.classKey, originAwakening.dateISO);
      if (fresh) {
        fresh.migrated = !!originAwakening.migrated;
        originAwakening = fresh;
        dirty = true;
      }
    }
    localStorage.setItem('hb_origin_v3_migrated', '1');
    if (dirty) save();
  }

  // ── v4 TEMPLATE REWRITE — strip leading "{DATE}. " from body so the
  // date only appears once (in the chapter header). Preserves original
  // dateISO and (for Chapter 2) classKey. Silent.
  function migrateOriginTextV4IfNeeded() {
    if (localStorage.getItem('hb_origin_v4_migrated') === '1') return;
    let dirty = false;
    if (originBeginning && originBeginning.text && originBeginning.dateISO) {
      const fresh = generateBeginningStory(originBeginning.dateISO);
      if (fresh) {
        fresh.migrated = !!originBeginning.migrated;
        originBeginning = fresh;
        dirty = true;
      }
    }
    if (originAwakening && originAwakening.text &&
        originAwakening.classKey && originAwakening.dateISO) {
      const fresh = generateAwakeningStory(originAwakening.classKey, originAwakening.dateISO);
      if (fresh) {
        fresh.migrated = !!originAwakening.migrated;
        originAwakening = fresh;
        dirty = true;
      }
    }
    localStorage.setItem('hb_origin_v4_migrated', '1');
    if (dirty) save();
  }

  // One-time migration on first launch of the two-chapter version.
  // Case A: Civilian + no Beginning → generate Beginning (silently)
  // Case B: Awakened user + no stories → generate BOTH (silently)
  // Case C: User has stories → no-op
  function migrateOriginStoriesIfNeeded() {
    if (localStorage.getItem('hb_origin_v2_migrated') === '1') return;
    // CRITICAL: skip migration entirely while the user is still in
    // pre-onboarding state. Their playerName is still 'Hunter' (default)
    // and they haven't typed their real name yet. Wait — completeOnboarding
    // calls saveBeginningIfMissing AFTER setting the real name, so the
    // story is generated authentically there instead.
    if (needsOnboarding) return;
    const isAwakened = currentClass && currentClass !== 'CIVILIAN';

    // Beginning — every user gets one
    if (!originBeginning || !originBeginning.text) {
      originBeginning = generateBeginningStory();
      originBeginning.migrated = true;
    }

    // Awakening — only awakened users get one retroactively
    if (isAwakened && (!originAwakening || !originAwakening.text)) {
      const story = generateAwakeningStory(currentClass);
      if (story) {
        story.migrated = true;
        originAwakening = story;
      }
    }
    localStorage.setItem('hb_origin_v2_migrated', '1');
    save();
  }

  function _awkAvatarSrc(classKey) {
    const map = {
      STR: 'avatar-warrior.png',  VIT: 'avatar-ranger.png',
      INT: 'avatar-mage.png',     FOCUS: 'avatar-assassin.png',
      WILL: 'avatar-paladin.png', WLT: 'avatar-merchant.png',
      SAGE: 'avatar-sage.png',
    };
    // Look up by class key — classData passed in is from CLASSES[id]
    // so resolve via reverse lookup on name/emoji.
    for (const k in CLASSES) {
      if (CLASSES[k] === classKey || CLASSES[k].name === classKey.name) return map[k] || 'avatar-base.png';
    }
    return 'avatar-base.png';
  }

  function playAwakeningFanfare() {
    if (!soundEnabled) return;
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const t0 = ac.currentTime;
      // Heroic ascent — A4 → C#5 → E5 → A5 sustained, distinct from compound/PR
      const notes = [
        { f: 440.00, s: 0.00, d: 0.30, p: 0.22 },
        { f: 554.37, s: 0.18, d: 0.32, p: 0.22 },
        { f: 659.25, s: 0.36, d: 0.36, p: 0.24 },
        { f: 880.00, s: 0.55, d: 1.40, p: 0.30 },
        { f: 659.25, s: 0.55, d: 1.40, p: 0.18 },  // E5 layered with A5 for chord body
      ];
      notes.forEach(n => {
        ['sine', 'triangle'].forEach(type => {
          const osc = ac.createOscillator();
          const gain = ac.createGain();
          osc.type = type;
          osc.frequency.setValueAtTime(n.f, t0 + n.s);
          osc.connect(gain); gain.connect(ac.destination);
          const peak = type === 'sine' ? n.p : n.p * 0.55;
          gain.gain.setValueAtTime(0.0001, t0 + n.s);
          gain.gain.exponentialRampToValueAtTime(peak, t0 + n.s + 0.04);
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.s + n.d);
          osc.start(t0 + n.s);
          osc.stop(t0 + n.s + n.d + 0.05);
        });
      });
    } catch (_) {}
  }

  function showAwakeningScreen(classData) {
    const overlay = document.getElementById('awakening-screen');
    if (!overlay) { levelUpActive = false; drainLevelUpQueue(); return; }
    overlay.style.setProperty('--awk-color', classData.color);
    document.getElementById('awk-avatar').src = _awkAvatarSrc(classData);
    document.getElementById('awk-name').textContent = classData.name.toUpperCase();
    document.getElementById('awk-desc').textContent = classData.desc;

    // Story text — revealed with typewriter after the avatar/title animation
    const storyEl = document.getElementById('awk-story');
    const hintEl  = document.getElementById('awk-hint');
    const fullText = (originAwakening && originAwakening.text) ? originAwakening.text : '';
    if (storyEl) {
      storyEl.textContent = '';
      storyEl.classList.remove('awk-story--done');
    }
    if (hintEl) hintEl.textContent = 'Tap to skip · or wait';

    overlay.classList.remove('hidden');
    void overlay.offsetWidth;
    overlay.classList.add('awk-show');
    playAwakeningFanfare();
    navigator.vibrate && navigator.vibrate([60, 40, 100, 40, 200]);

    // Typewriter — start after the content fade-in finishes (~800ms)
    let typeIdx = 0;
    let typing  = true;
    let typeTimer = null;
    const TYPE_MS = 28;

    function tick() {
      if (!typing || !storyEl) return;
      typeIdx++;
      storyEl.textContent = fullText.slice(0, typeIdx);
      if (typeIdx >= fullText.length) {
        typing = false;
        if (storyEl) storyEl.classList.add('awk-story--done');
        if (hintEl) hintEl.textContent = 'Tap to continue';
        return;
      }
      typeTimer = setTimeout(tick, TYPE_MS);
    }

    function startTypewriter() {
      if (!fullText) {
        typing = false;
        if (hintEl) hintEl.textContent = 'Tap to continue';
        return;
      }
      typeTimer = setTimeout(tick, 0);
    }
    const startTimer = setTimeout(startTypewriter, 850);

    // Auto-dismiss only AFTER the story has fully revealed (typing done) +
    // a generous read time. Tap behavior: first tap skips typing, second
    // tap dismisses.
    let autoDismissTimer = null;
    function scheduleAutoDismiss() {
      autoDismissTimer = setTimeout(dismiss, 5500);
    }
    // Initial loose auto-dismiss in case story is empty
    if (!fullText) scheduleAutoDismiss();

    function dismiss() {
      typing = false;
      clearTimeout(typeTimer);
      clearTimeout(startTimer);
      clearTimeout(autoDismissTimer);
      overlay.classList.remove('awk-show');
      overlay.classList.add('awk-hide');
      overlay.addEventListener('animationend', () => {
        overlay.classList.remove('awk-hide');
        overlay.classList.add('hidden');
        levelUpActive = false;
        drainLevelUpQueue();
      }, { once: true });
      overlay.removeEventListener('click', onTap);
    }
    function onTap() {
      if (typing) {
        // Skip typewriter — show full text immediately
        typing = false;
        clearTimeout(typeTimer);
        if (storyEl) {
          storyEl.textContent = fullText;
          storyEl.classList.add('awk-story--done');
        }
        if (hintEl) hintEl.textContent = 'Tap to continue';
        scheduleAutoDismiss();
      } else {
        dismiss();
      }
    }
    overlay.addEventListener('click', onTap);
    // Watchdog — if story is so long that it might not finish within reason,
    // start an auto-dismiss timer once typing completes naturally
    const watchdog = setInterval(() => {
      if (!typing && !autoDismissTimer) {
        scheduleAutoDismiss();
        clearInterval(watchdog);
      }
    }, 200);
  }

  // ── CLASS CHOICE — modal pick when 2+ stats hit Lv5 simultaneously
  function showClassChoiceScreen(optionKeys) {
    const overlay = document.getElementById('class-choice-screen');
    const list    = document.getElementById('cc-options');
    if (!overlay || !list) { levelUpActive = false; drainLevelUpQueue(); return; }

    const cards = optionKeys.map(key => {
      const c = CLASSES[key];
      if (!c) return '';
      return '<button class="cc-card" data-cc-key="' + esc(key) + '" ' +
                  'style="--cc-color:' + c.color + '">' +
        '<img class="cc-card-avatar" src="' + _awkAvatarSrc(c) + '" alt="">' +
        '<div class="cc-card-emoji">' + c.emoji + '</div>' +
        '<div class="cc-card-name">' + esc(c.name) + '</div>' +
        '<div class="cc-card-desc">' + esc(c.desc.split('.')[1] ? c.desc.split('.')[1].trim() : c.desc) + '</div>' +
        '<div class="cc-card-cta">Choose ' + esc(c.name) + '</div>' +
      '</button>';
    }).join('');
    list.innerHTML = cards;

    overlay.classList.remove('hidden');
    void overlay.offsetWidth;
    overlay.classList.add('cc-show');
    navigator.vibrate && navigator.vibrate([30, 30, 30]);

    function commit(classKey) {
      const wasCivilian = (currentClass === 'CIVILIAN' || !currentClass);
      currentClass = classKey;
      localStorage.setItem('hb_class', currentClass);
      // Close the choice overlay immediately
      overlay.classList.remove('cc-show');
      overlay.classList.add('cc-hide');
      overlay.addEventListener('animationend', () => {
        overlay.classList.remove('cc-hide');
        overlay.classList.add('hidden');
        // Then queue the Awakening celebration if this was the first class
        if (wasCivilian && !localStorage.getItem('hb_awakened_once')) {
          localStorage.setItem('hb_awakened_once', '1');
          // Save Chapter 2 now — survives if user closes the app
          // before the celebration finishes. Belt-and-suspenders: also
          // ensure Chapter 1 exists in case onboarding hook didn't fire.
          saveBeginningIfMissing();
          saveAwakeningIfMissing(classKey);
          levelUpQueue.unshift({ type: 'awakening', classData: CLASSES[classKey] });
        }
        levelUpActive = false;
        if (currentTab === 'profile') renderProfile();
        if (currentTab === 'stats')   renderStats();
        drainLevelUpQueue();
      }, { once: true });
    }

    list.querySelectorAll('.cc-card').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        commit(btn.getAttribute('data-cc-key'));
      });
    });
    // No background-click dismiss — choice is mandatory.
  }

  // ── LEVEL UP SCREENS ─────────────────────────────────────

  function showRankUpScreen(rank) {
    const screen  = document.getElementById('rankup-screen');
    const fx      = RANK_EFFECTS[rank.id] || RANK_EFFECTS['D'];
    const daysActive = Object.keys(completions).filter(d => completions[d].length > 0).length;

    // Reset, set color vars, apply rank class
    screen.className = 'rankup-screen ' + fx.cls;
    screen.style.setProperty('--ru-color', fx.color);
    screen.style.setProperty('--ru-glow',  fx.glow);

    // Badge
    const badgeEl = document.getElementById('rankup-badge');
    badgeEl.textContent = rank.id;

    // Top label
    const topLabel = document.getElementById('rankup-top-label');
    if (rank.id === 'S+') {
      topLabel.textContent = 'THE AWAKENED ONE';
      topLabel.classList.add('ru-awakened');
    } else {
      topLabel.textContent = 'RANK UP';
      topLabel.classList.remove('ru-awakened');
    }

    // Rank name + class
    document.getElementById('rankup-rank-name').textContent   = rank.label;
    document.getElementById('rankup-class-unlock').textContent = 'CLASS UNLOCKED: ' + getClass(rank.id);
    document.getElementById('rankup-xp-line').textContent     = totalPoints.toLocaleString() + ' Total XP';
    document.getElementById('rankup-days-line').textContent   = daysActive + ' Days Active';

    screen.classList.remove('hidden');

    // Screen shake
    if (fx.shake) {
      setTimeout(() => {
        screen.classList.add('ru-shake');
        screen.addEventListener('animationend', () => screen.classList.remove('ru-shake'), { once: true });
      }, 420);
    }

    // Particle burst
    if (fx.particles > 0) spawnBurstParticles(fx.particles, fx.color);

    // Shockwave ring
    if (fx.shockwave) {
      const sw = document.getElementById('rankup-shockwave');
      sw.style.setProperty('--ru-color', fx.color);
      void sw.offsetWidth;
      sw.classList.add('sw-active');
      sw.addEventListener('animationend', () => sw.classList.remove('sw-active'), { once: true });
    }

    // Lightning (A rank)
    if (fx.lightning) spawnLightning(fx.color);

    // Gold rain (S+)
    if (fx.rain) spawnGoldRain();

    navigator.vibrate && navigator.vibrate(rank.id === 'S+' ? [100,50,100,50,200] : rank.id === 'S' ? [80,40,120] : [60,30,80]);

    const dismiss = () => {
      screen.classList.add('ru-shake'); // clear any running shake
      screen.classList.add('hidden');
      document.querySelectorAll('.ru-particle,.ru-lightning,.ru-rain').forEach(el => el.remove());
      levelUpActive = false;
      drainLevelUpQueue();
    };
    document.getElementById('rankup-continue').onclick = dismiss;
  }

  function spawnBurstParticles(count, color) {
    const container = document.getElementById('rankup-particles-container');
    const cx = window.innerWidth  / 2;
    const cy = window.innerHeight / 2;
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      p.className = 'ru-particle';
      const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const dist  = 80 + Math.random() * 160;
      const size  = 4 + Math.random() * 7;
      p.style.cssText =
        'left:' + cx + 'px;top:' + cy + 'px;' +
        'width:' + size + 'px;height:' + size + 'px;' +
        'background:' + color + ';' +
        '--tx:' + (Math.cos(angle) * dist) + 'px;' +
        '--ty:' + (Math.sin(angle) * dist) + 'px;' +
        'animation-delay:' + (Math.random() * 0.15) + 's;';
      container.appendChild(p);
      p.addEventListener('animationend', () => p.remove(), { once: true });
    }
  }

  function spawnLightning(color) {
    const container = document.getElementById('rankup-particles-container');
    const cx = window.innerWidth  / 2;
    const cy = window.innerHeight / 2;
    for (let i = 0; i < 5; i++) {
      const bolt = document.createElement('div');
      bolt.className = 'ru-lightning';
      const angle = Math.random() * 360;
      const len   = 55 + Math.random() * 90;
      bolt.style.cssText =
        'left:' + cx + 'px;top:' + cy + 'px;' +
        'width:' + len + 'px;height:2px;' +
        'background:linear-gradient(90deg,' + color + ',transparent);' +
        'transform-origin:left center;' +
        'transform:rotate(' + angle + 'deg);' +
        'animation-delay:' + (0.35 + i * 0.12) + 's;';
      container.appendChild(bolt);
      bolt.addEventListener('animationend', () => bolt.remove(), { once: true });
    }
  }

  function spawnGoldRain() {
    const screen = document.getElementById('rankup-screen');
    const w = window.innerWidth;
    for (let i = 0; i < 45; i++) {
      const p = document.createElement('div');
      p.className = 'ru-rain';
      const size  = 3 + Math.random() * 6;
      const delay = Math.random() * 2.5;
      const dur   = 1.8 + Math.random() * 2;
      p.style.cssText =
        'left:' + (Math.random() * w) + 'px;top:-10px;' +
        'width:' + size + 'px;height:' + size + 'px;' +
        'background:' + (Math.random() > 0.45 ? '#f59e0b' : '#fbbf24') + ';' +
        'animation-duration:' + dur + 's;' +
        'animation-delay:' + delay + 's;';
      screen.appendChild(p);
      p.addEventListener('animationend', () => p.remove(), { once: true });
    }
    // Refill while screen is open
    setTimeout(() => {
      if (!document.getElementById('rankup-screen').classList.contains('hidden')) spawnGoldRain();
    }, 2800);
  }

  function showStatLevelUp(item) {
    const { stat, level, bonusPts } = item;
    const isMax = level >= 20;
    const popup = document.getElementById('statlvl-popup');
    const card  = document.getElementById('statlvl-card');

    card.style.setProperty('--sl-color', stat.color);
    card.style.setProperty('--sl-glow',  stat.color + '35');

    if (isMax) {
      card.classList.add('sl-maxed');
      card.style.boxShadow = '0 0 80px ' + stat.color + '60, 0 0 160px ' + stat.color + '18, 0 -6px 36px rgba(0,0,0,0.55)';
      document.querySelector('.statlvl-label-top').textContent = 'STAT MASTERED';
    } else {
      card.classList.remove('sl-maxed');
      card.style.boxShadow = '0 0 36px ' + stat.color + '40, 0 -6px 36px rgba(0,0,0,0.55)';
      document.querySelector('.statlvl-label-top').textContent = 'LEVEL UP';
    }

    setStatIcon(document.getElementById('statlvl-icon'), stat, 64); // Stat Level Up popup — large hero icon
    document.getElementById('statlvl-name').textContent   = isMax
      ? stat.label.toUpperCase() + ' MASTERED'
      : stat.label + ' — ' + stat.name.toUpperCase();
    document.getElementById('statlvl-level').textContent  = isMax ? 'LEVEL 20 — MAX' : 'LEVEL ' + level;
    document.getElementById('statlvl-flavor').textContent = STAT_FLAVOR[stat.id] || '';

    const bar = document.getElementById('statlvl-bar');
    bar.style.background = isMax ? '#f59e0b' : stat.color;
    bar.style.boxShadow  = '0 0 8px ' + (isMax ? '#f59e0b' : stat.color);
    bar.style.width      = '0%';

    const bonusEl = document.getElementById('statlvl-bonus');
    if (bonusPts) {
      bonusEl.textContent = isMax ? 'MAX BONUS +' + bonusPts + ' XP AWARDED' : 'BONUS +' + bonusPts + ' XP AWARDED';
      bonusEl.style.color = '#f59e0b';
      bonusEl.classList.remove('hidden');
      card.classList.add('sl-bonus-flash');
    } else {
      bonusEl.classList.add('hidden');
      card.classList.remove('sl-bonus-flash');
    }

    popup.classList.remove('hidden');
    void card.offsetWidth;
    card.classList.add('sl-animate');
    setTimeout(() => { bar.style.width = '100%'; }, 80);

    navigator.vibrate && navigator.vibrate(isMax
      ? [40, 20, 80, 20, 120, 20, 200]
      : bonusPts ? [40, 20, 80, 20, 120] : [40, 20, 60]);

    let timer;
    const dismiss = () => {
      clearTimeout(timer);
      popup.classList.add('hidden');
      card.classList.remove('sl-animate', 'sl-bonus-flash', 'sl-maxed');
      document.querySelector('.statlvl-label-top').textContent = 'LEVEL UP';
      levelUpActive = false;
      drainLevelUpQueue();
    };
    // Disarm tap-to-dismiss for the first 400ms so a stray tap from the
    // PREVIOUS popup in the queue doesn't carry through and instantly close
    // this one. Without this guard, multi-popup cascades (stat lvl-up → class
    // change → awakening) all collapse on a single tap.
    popup.onclick = null;
    setTimeout(() => { popup.onclick = dismiss; }, 400);
    timer = setTimeout(dismiss, isMax ? 5000 : 3000);
  }

  function captureStatLevels() {
    const levels = {};
    STATS.forEach(st => { levels[st.id] = statLevel(stats[st.id]?.pts || 0); });
    return levels;
  }

  function drainLevelUpQueue() {
    if (levelUpActive) return;
    if (!levelUpQueue.length) {
      if (achQueue.length && !achPopupTimer) drainAchQueue();
      return;
    }
    const item = levelUpQueue.shift();
    levelUpActive = true;
    if      (item.type === 'mission')     showMissionCompleteScreen(item);
    else if (item.type === 'comeback')    showComebackScreen(item);
    else if (item.type === 'rank')        showRankUpScreen(item.rank);
    else if (item.type === 'class')       showClassChangePopup(item.classData);
    else if (item.type === 'awakening')   showAwakeningScreen(item.classData);
    else if (item.type === 'classChoice') showClassChoiceScreen(item.options);
    else if (item.type === 'perfectday')  showPerfectDayScreen(item);
    else                                  showStatLevelUp(item);
  }

  function drainAchQueue() {
    if (!achQueue.length) { achPopupTimer = null; return; }
    const ach = achQueue.shift();
    showAchievementPopup(ach);
  }

  function showAchievementPopup(ach) {
    const popup = document.getElementById('ach-popup');
    document.querySelector('.ach-popup-label').textContent = ach.label || 'ACHIEVEMENT UNLOCKED';
    // Use innerHTML + streakify so 🔥-keyed achievements ("Streak Hunter",
    // "Compound Month") render the custom flame icon. Other achievement
    // emojis pass through escaped via streakify.
    // Achievement icon stripped — card identity comes from the title +
    // colored ring instead of an emoji glyph. (Emoji-free pass.)
    document.getElementById('ach-popup-icon').innerHTML = '';
    document.getElementById('ach-popup-name').textContent = ach.name;
    document.getElementById('ach-popup-desc').textContent = ach.desc;
    popup.classList.remove('hidden');
    navigator.vibrate && navigator.vibrate([60, 40, 80]);

    const dismiss = () => {
      clearTimeout(achPopupTimer);
      popup.classList.add('hidden');
      achPopupTimer = setTimeout(drainAchQueue, 400);
    };
    popup.onclick = dismiss;
    achPopupTimer = setTimeout(dismiss, 4000);
  }

  // ── HISTORY ──────────────────────────────────────────────
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const HG_DCOL = { easy: '#8b5cf6', medium: '#3b82f6', hard: '#f97316', legendary: '#f59e0b' };

  // Returns array of 7 date strings (Mon→Sun) for the week at offset
  function getWeekDates(offset) {
    const base = new Date(today + 'T12:00:00');
    const dow  = (base.getDay() + 6) % 7;   // Mon = 0
    const mon  = new Date(base);
    mon.setDate(base.getDate() - dow + offset * 7);
    const out = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(mon);
      d.setDate(mon.getDate() + i);
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  }

  function renderHistory() {
    const el = document.getElementById('history-content');
    el.innerHTML = '';

    // ── View mode tabs ────────────────────────────────────
    const tabs = document.createElement('div');
    tabs.className = 'hg-view-tabs';
    ['weekly','monthly','yearly','achievements'].forEach(mode => {
      const btn = document.createElement('button');
      btn.className = 'hg-view-tab' + (histViewMode === mode ? ' hg-view-tab--active' : '');
      btn.textContent = mode === 'achievements' ? 'Achieved' : mode.charAt(0).toUpperCase() + mode.slice(1);
      btn.addEventListener('click', () => { histViewMode = mode; renderHistory(); });
      tabs.appendChild(btn);
    });
    el.appendChild(tabs);

    // ── Mode content ──────────────────────────────────────
    if      (histViewMode === 'weekly')       hgBuildWeekly(el);
    else if (histViewMode === 'monthly')      hgBuildMonthly(el);
    else if (histViewMode === 'yearly')       hgBuildYearly(el);
    else                                      hgBuildAchievements(el);

    // ── Bottom stats bar (not shown in achievements view) ─
    if (histViewMode !== 'achievements') hgBuildStatsBar(el);
  }

  // ── HABIT INFO POPUP STATS ───────────────────────────────
  // Lifetime longest streak — walks every completion date and counts the
  // longest run of consecutive scheduled-day completions. Honours each
  // habit's day-of-week schedule via hasScheduledDayBetween.
  function computeBestStreakForHabit(habit) {
    const days = habit.days || ALL_DAYS;
    const dates = Object.keys(completions)
      .filter(d => Array.isArray(completions[d]) && completions[d].includes(habit.id))
      .sort();
    if (dates.length === 0) return 0;
    let best = 1, cur = 1;
    for (let i = 1; i < dates.length; i++) {
      // If no missed scheduled day exists between the previous completion
      // and this one, the streak continues; otherwise it resets to 1.
      if (!hasScheduledDayBetween(days, dates[i - 1], dates[i])) {
        cur += 1;
      } else {
        cur = 1;
      }
      if (cur > best) best = cur;
    }
    return best;
  }

  // Completions in the trailing 7 days (today inclusive)
  function computeWeekCompletionsForHabit(habit) {
    let n = 0;
    let d = today;
    for (let i = 0; i < 7; i++) {
      if (Array.isArray(completions[d]) && completions[d].includes(habit.id)) n++;
      d = prevDay(d);
    }
    return n;
  }

  // All-time completion count
  function computeTotalCompletionsForHabit(habit) {
    let n = 0;
    for (const d in completions) {
      if (Array.isArray(completions[d]) && completions[d].includes(habit.id)) n++;
    }
    return n;
  }

  // ── WEEKLY VIEW ───────────────────────────────────────────
  function hgBuildWeekly(el) {
    const DAY_ABBR = ['M','T','W','T','F','S','S'];
    const dates    = getWeekDates(histWeekOffset);
    const isCurr   = histWeekOffset === 0;

    function fmtD(ds) { return ds.slice(5,7) + '/' + ds.slice(8,10); }

    // Nav row
    const nav = document.createElement('div');
    nav.className = 'hg-nav';
    nav.innerHTML =
      '<button class="hist-nav-btn" id="hg-prev">&#8249;</button>' +
      '<span class="hg-nav-range">' + fmtD(dates[0]) + ' → ' + fmtD(dates[6]) + '</span>' +
      '<button class="hist-nav-btn" id="hg-next"' + (isCurr ? ' disabled' : '') + '>&#8250;</button>';
    el.appendChild(nav);
    document.getElementById('hg-prev').addEventListener('click', () => { histWeekOffset--; renderHistory(); });
    document.getElementById('hg-next').addEventListener('click', () => { if (!isCurr) { histWeekOffset++; renderHistory(); } });

    // Habits active this week
    const activeHabits = habits.filter(h =>
      dates.some(ds => isScheduledOn(h.days, ds) || (completions[ds] || []).includes(h.id))
    );

    if (activeHabits.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'hg-empty';
      empty.textContent = 'No habits scheduled for this week.';
      el.appendChild(empty);
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'hg-grid-wrap';

    // Header row: label + 7 day abbrs + badge placeholder
    const hdrRow = document.createElement('div');
    hdrRow.className = 'hg-row hg-header-row';
    hdrRow.appendChild(Object.assign(document.createElement('div'), { className: 'hg-label hg-label-hdr' }));
    dates.forEach((ds, i) => {
      const c = document.createElement('div');
      c.className = 'hg-day-hdr' + (ds === today ? ' hg-day-hdr--today' : '');
      c.textContent = DAY_ABBR[i];
      hdrRow.appendChild(c);
    });
    hdrRow.appendChild(Object.assign(document.createElement('div'), { className: 'hg-badge-col' }));
    wrap.appendChild(hdrRow);

    // One row per habit
    activeHabits.forEach(habit => {
      const diff       = habit.difficulty || 'easy';
      const statColor  = getHabitStatColor(habit);
      const opacity    = DIFF_OPACITY[diff] || 0.6;
      const cellBg     = colorWithAlpha(statColor, opacity);

      // Perfect week? Every scheduled past/today day must be done
      const schedPast = dates.filter(ds => ds <= today && isScheduledOn(habit.days, ds));
      const isPerfect = schedPast.length > 0 &&
        schedPast.every(ds => (completions[ds] || []).includes(habit.id));

      const row = document.createElement('div');
      row.className = 'hg-row';

      // Label — clean base name (no duration suffix), bold, no emoji on the History tab
      const label = document.createElement('div');
      label.className = 'hg-label';
      label.innerHTML =
        '<span class="hg-label-name">' + esc(habitBaseName(habit)) + '</span>' +
        '<button class="hg-info-btn" aria-label="More info about ' + esc(habitBaseName(habit)) +
          '" data-habit-info="' + esc(habit.id) + '">ⓘ</button>';
      row.appendChild(label);

      // 7 cells
      dates.forEach(ds => {
        const cell    = document.createElement('div');
        const isFuture   = ds > today;
        const isSchedDay = isScheduledOn(habit.days, ds);
        const isDone     = (completions[ds] || []).includes(habit.id);

        if (isDone) {
          cell.className = 'hg-cell hg-cell--done' + (diff === 'legendary' ? ' hg-cell--legendary' : '');
          // Stat color with difficulty-based opacity. Legendary gets a soft outer glow.
          cell.style.cssText = 'background:' + cellBg
            + ';box-shadow:0 0 6px ' + colorWithAlpha(statColor, 0.35)
            + (diff === 'legendary' ? ',0 0 0 1px ' + colorWithAlpha(statColor, 0.9) : '');
          // Tiny corner dot when this completion was auto-verified via
          // HealthKit. v1.1.4 scope: only Daily walk; design intentionally
          // does NOT recolor the cell (stat color stays the source-of-truth
          // signal). See AUTO_VERIFY module.
          if (typeof AUTO_VERIFY !== 'undefined' && AUTO_VERIFY.isAutoVerifiedOnDate(habit.id, ds)) {
            cell.classList.add('hg-cell--auto');
          }
        } else if (isFuture) {
          cell.className = 'hg-cell hg-cell--future';
        } else if (isSchedDay) {
          cell.className = 'hg-cell hg-cell--missed';
        } else {
          cell.className = 'hg-cell hg-cell--off';
        }
        row.appendChild(cell);
      });

      // Perfect badge
      const badgeCol = document.createElement('div');
      badgeCol.className = 'hg-badge-col';
      if (isPerfect) {
        const b = document.createElement('span');
        b.className = 'hg-perfect-badge';
        b.textContent = 'PERFECT';
        badgeCol.appendChild(b);
      }
      row.appendChild(badgeCol);
      wrap.appendChild(row);
    });

    el.appendChild(wrap);
  }

  // ── MONTHLY VIEW — per-habit mini calendar cards ─────────
  function hgBuildMonthly(el) {
    const year  = histViewYear;
    const month = histViewMonth;
    const now   = new Date();
    const isCurr = year === now.getFullYear() && month === now.getMonth();

    // Nav row
    const nav = document.createElement('div');
    nav.className = 'hg-nav';
    nav.innerHTML =
      '<button class="hist-nav-btn" id="hg-prev">&#8249;</button>' +
      '<span class="hg-nav-range">' + MONTH_NAMES[month] + ' ' + year + '</span>' +
      '<button class="hist-nav-btn" id="hg-next"' + (isCurr ? ' disabled' : '') + '>&#8250;</button>';
    el.appendChild(nav);
    document.getElementById('hg-prev').addEventListener('click', () => {
      histViewMonth--; if (histViewMonth < 0) { histViewMonth = 11; histViewYear--; } renderHistory();
    });
    document.getElementById('hg-next').addEventListener('click', () => {
      if (isCurr) return; histViewMonth++; if (histViewMonth > 11) { histViewMonth = 0; histViewYear++; } renderHistory();
    });

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDow    = (new Date(year, month, 1).getDay() + 6) % 7; // Mon=0

    // Only habits active at least one day this month (past/today)
    const activeHabits = habits.filter(h => {
      for (let d = 1; d <= daysInMonth; d++) {
        const ds = year + '-' + String(month+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
        if (ds <= today && isScheduledOn(h.days, ds)) return true;
      }
      return false;
    });

    if (!activeHabits.length) {
      const empty = document.createElement('div');
      empty.className = 'hg-empty';
      empty.textContent = 'No habits active this month.';
      el.appendChild(empty);
      return;
    }

    const cardsGrid = document.createElement('div');
    cardsGrid.className = 'hg-month-cards-grid';

    activeHabits.forEach(habit => {
      const diff      = habit.difficulty || 'easy';
      const statColor = getHabitStatColor(habit);
      const opacity   = DIFF_OPACITY[diff] || 0.6;
      const cellBg    = colorWithAlpha(statColor, opacity);

      const card = document.createElement('div');
      card.className = 'hg-habit-card';

      // ── Banner ─── stat-tinted, clean base name, info icon
      const banner = document.createElement('div');
      banner.className = 'hg-habit-card-banner';
      banner.style.cssText = 'background:linear-gradient(135deg,'
        + colorWithAlpha(statColor, 0.18) + ',' + colorWithAlpha(statColor, 0.06)
        + ');border-bottom:1px solid ' + colorWithAlpha(statColor, 0.35) + ';';
      const bName = document.createElement('span');
      bName.className = 'hg-habit-card-name';
      bName.textContent = habitBaseName(habit);
      const bInfo = document.createElement('button');
      bInfo.className = 'hg-info-btn';
      bInfo.setAttribute('aria-label', 'More info about ' + habitBaseName(habit));
      bInfo.setAttribute('data-habit-info', habit.id);
      bInfo.textContent = 'ⓘ';
      banner.append(bName, bInfo);
      card.appendChild(banner);

      // ── Mini calendar ────────────────────────────────────
      const calBody = document.createElement('div');
      calBody.className = 'hg-habit-cal-body';

      // DOW headers
      const hdrRow = document.createElement('div');
      hdrRow.className = 'hg-habit-cal-hdr';
      ['M','T','W','T','F','S','S'].forEach(d => {
        const c = document.createElement('div');
        c.className = 'hg-habit-cal-hdr-cell';
        c.textContent = d;
        hdrRow.appendChild(c);
      });
      calBody.appendChild(hdrRow);

      // Grid cells
      const calGrid = document.createElement('div');
      calGrid.className = 'hg-habit-cal-grid';

      // Blank offset cells
      for (let i = 0; i < firstDow; i++) {
        const blank = document.createElement('div');
        blank.className = 'hg-habit-cal-cell hg-habit-cal-cell--empty';
        calGrid.appendChild(blank);
      }

      let schedDays = 0, doneDays = 0;

      for (let d = 1; d <= daysInMonth; d++) {
        const ds         = year + '-' + String(month+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
        const isFuture   = ds > today;
        const isSchedDay = isScheduledOn(habit.days, ds);
        const isDone     = (completions[ds] || []).includes(habit.id);

        if (!isFuture && isSchedDay) schedDays++;
        if (!isFuture && isDone)     doneDays++;

        const cell = document.createElement('div');
        cell.className = 'hg-habit-cal-cell';
        cell.textContent = d;

        if (isFuture) {
          cell.classList.add('hg-habit-cal-cell--future');
        } else if (isDone) {
          cell.classList.add('hg-habit-cal-cell--done' + (diff === 'legendary' ? ' hg-habit-cal-cell--legendary' : ''));
          cell.style.cssText = 'background:' + cellBg + ';color:#000;font-weight:700;'
            + (diff === 'legendary' ? 'box-shadow:0 0 0 1px ' + colorWithAlpha(statColor, 0.9) + ';' : '');
        } else if (isSchedDay) {
          cell.classList.add('hg-habit-cal-cell--missed');
        } else {
          cell.classList.add('hg-habit-cal-cell--off');
        }
        calGrid.appendChild(cell);
      }

      calBody.appendChild(calGrid);
      card.appendChild(calBody);

      // ── Footer ───────────────────────────────────────────
      const isPerfect = schedDays > 0 && doneDays >= schedDays;
      const pct       = schedDays > 0 ? (doneDays / schedDays * 100) : 0;
      const pctStr    = Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(1);

      const footer = document.createElement('div');
      footer.className = 'hg-habit-card-footer';
      const stat = document.createElement('span');
      stat.className = 'hg-habit-card-stat';
      stat.textContent = pctStr + '% | ' + doneDays + 'd';
      footer.appendChild(stat);
      if (isPerfect) {
        const badge = document.createElement('span');
        badge.className = 'hg-perfect-badge';
        badge.textContent = 'PERFECT';
        footer.appendChild(badge);
      }
      card.appendChild(footer);

      cardsGrid.appendChild(card);
    });

    el.appendChild(cardsGrid);
  }

  // ── YEARLY VIEW — per-habit contribution rows ─────────────
  function hgBuildYearly(el) {
    const yearNum = histViewYear;
    const now     = new Date();
    const isCurr  = yearNum === now.getFullYear();

    // Nav
    const nav = document.createElement('div');
    nav.className = 'hg-nav';
    nav.innerHTML =
      '<button class="hist-nav-btn" id="hg-prev">&#8249;</button>' +
      '<span class="hg-nav-range">' + yearNum + '</span>' +
      '<button class="hist-nav-btn" id="hg-next"' + (isCurr ? ' disabled' : '') + '>&#8250;</button>';
    el.appendChild(nav);
    document.getElementById('hg-prev').addEventListener('click', () => { histViewYear--; renderHistory(); });
    document.getElementById('hg-next').addEventListener('click', () => { if (!isCurr) { histViewYear++; renderHistory(); } });

    const isLeap     = (yearNum % 4 === 0 && yearNum % 100 !== 0) || yearNum % 400 === 0;
    const totalDays  = isLeap ? 366 : 365;
    const jan1Dow    = (new Date(yearNum, 0, 1).getDay() + 6) % 7; // Mon=0
    const totalWeeks = Math.ceil((totalDays + jan1Dow) / 7);

    const wrap = document.createElement('div');
    wrap.className = 'hg-year-habits-wrap';

    habits.forEach(habit => {
      const diff      = habit.difficulty || 'easy';
      const statColor = getHabitStatColor(habit);
      const opacity   = DIFF_OPACITY[diff] || 0.6;
      const cellBg    = colorWithAlpha(statColor, opacity);

      // Tally totals for the year
      let schedDays = 0, doneDays = 0;
      for (let d = 0; d < totalDays; d++) {
        const dt = new Date(yearNum, 0, 1 + d);
        const ds = yearNum + '-' + String(dt.getMonth()+1).padStart(2,'0') + '-' + String(dt.getDate()).padStart(2,'0');
        if (ds > today) break;
        if (isScheduledOn(habit.days, ds)) {
          schedDays++;
          if ((completions[ds] || []).includes(habit.id)) doneDays++;
        }
      }

      const pct    = schedDays > 0 ? (doneDays / schedDays * 100) : 0;
      const pctStr = Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(1);

      const row = document.createElement('div');
      row.className = 'hg-year-habit-row';

      // Row header — clean base name, info icon, no emoji on History tab
      const hdr = document.createElement('div');
      hdr.className = 'hg-year-habit-hdr';
      const info = document.createElement('div');
      info.className = 'hg-year-habit-info';
      info.innerHTML =
        '<span class="hg-year-habit-name">' + esc(habitBaseName(habit)) + '</span>' +
        '<button class="hg-info-btn" aria-label="More info about ' + esc(habitBaseName(habit)) +
          '" data-habit-info="' + esc(habit.id) + '">ⓘ</button>';
      const stats = document.createElement('div');
      stats.className = 'hg-year-habit-stats';
      stats.textContent = pctStr + '% | ' + doneDays + 'D';
      hdr.append(info, stats);
      row.appendChild(hdr);

      // Grid wrap (month labels + week columns)
      const gridWrap = document.createElement('div');
      gridWrap.className = 'hg-year-habit-grid-wrap';

      const monthLabels = document.createElement('div');
      monthLabels.className = 'hg-year-habit-months';
      const weeksRow = document.createElement('div');
      weeksRow.className = 'hg-year-habit-grid';

      let prevMonth = -1;
      for (let w = 0; w < totalWeeks; w++) {
        const mlbl = document.createElement('div');
        mlbl.className = 'hg-year-habit-month-lbl';

        const col = document.createElement('div');
        col.className = 'hg-year-habit-col';

        for (let d = 0; d < 7; d++) {
          const dayIdx = w * 7 + d - jan1Dow;
          const cell   = document.createElement('div');
          cell.className = 'hg-year-habit-cell';

          if (dayIdx < 0 || dayIdx >= totalDays) {
            cell.classList.add('hg-year-habit-cell--empty');
            col.appendChild(cell);
            continue;
          }

          const dt  = new Date(yearNum, 0, 1 + dayIdx);
          const ds  = yearNum + '-' + String(dt.getMonth()+1).padStart(2,'0') + '-' + String(dt.getDate()).padStart(2,'0');
          const mo  = dt.getMonth();

          if (d === 0 && mo !== prevMonth) {
            mlbl.textContent = MONTH_SHORT[mo];
            prevMonth = mo;
          }

          const isFuture   = ds > today;
          const isSchedDay = isScheduledOn(habit.days, ds);
          const isDone     = (completions[ds] || []).includes(habit.id);

          if (isFuture) {
            cell.classList.add('hg-year-habit-cell--future');
          } else if (isDone) {
            cell.classList.add('hg-year-habit-cell--done' + (diff === 'legendary' ? ' hg-year-habit-cell--legendary' : ''));
            cell.style.background = cellBg;
            if (diff === 'legendary') {
              cell.style.boxShadow = '0 0 0 1px ' + colorWithAlpha(statColor, 0.9);
            }
          } else if (isSchedDay) {
            cell.classList.add('hg-year-habit-cell--missed');
          } else {
            cell.classList.add('hg-year-habit-cell--skip');
          }

          col.appendChild(cell);
        }

        monthLabels.appendChild(mlbl);
        weeksRow.appendChild(col);
      }

      gridWrap.appendChild(monthLabels);
      gridWrap.appendChild(weeksRow);
      row.appendChild(gridWrap);
      wrap.appendChild(row);
    });

    el.appendChild(wrap);
  }

  // ── STATS BAR (all views) ─────────────────────────────────
  function hgBuildStatsBar(el) {
    // All-time totals
    let totalDone = 0, totalSched = 0;
    const dayTotals = [0,0,0,0,0,0,0];
    const dayCounts = [0,0,0,0,0,0,0];
    Object.keys(completions).forEach(ds => {
      if (ds > today) return;
      const doneIds = completions[ds] || [];
      const sched   = habits.filter(h => isScheduledOn(h.days, ds));
      if (!sched.length) return;
      const nDone = doneIds.filter(id => sched.some(h => h.id === id)).length;
      totalSched += sched.length;
      totalDone  += nDone;
      const dow = (new Date(ds + 'T12:00:00').getDay() + 6) % 7;
      dayTotals[dow] += nDone / sched.length;
      dayCounts[dow]++;
    });

    const pct = totalSched > 0 ? Math.round((totalDone / totalSched) * 100) : 0;
    const DAY_NAMES = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const dayRates  = dayTotals.map((t, i) => dayCounts[i] > 0 ? t / dayCounts[i] : 0);
    const bestIdx   = dayRates.indexOf(Math.max(...dayRates));
    const bestDay   = dayRates[bestIdx] > 0 ? DAY_NAMES[bestIdx] : '—';
    const bestStreak = Object.values(streaks).reduce((m, s) => Math.max(m, s ? (s.count || 0) : 0), 0);

    const bar = document.createElement('div');
    bar.className = 'hist-stats-bar';
    bar.innerHTML =
      '<div class="hist-stat"><span class="hist-stat-val">' + pct + '%</span><span class="hist-stat-lbl">Completion</span></div>' +
      '<div class="hist-stat-divider"></div>' +
      '<div class="hist-stat"><span class="hist-stat-val">' + bestDay + '</span><span class="hist-stat-lbl">Best Day</span></div>' +
      '<div class="hist-stat-divider"></div>' +
      '<div class="hist-stat"><span class="hist-stat-val">' + totalDone.toLocaleString() + '</span><span class="hist-stat-lbl">Total Done</span></div>' +
      '<div class="hist-stat-divider"></div>' +
      '<div class="hist-stat"><span class="hist-stat-val">' + bestStreak + '</span><span class="hist-stat-lbl">Best Streak</span></div>';
    el.appendChild(bar);
  }

  // ── ACHIEVEMENTS VIEW ─────────────────────────────────────
  function hgBuildAchievements(el) {
    const unlockedCount = [...unlockedAchievements].length;
    const total         = ACHIEVEMENTS.length;

    // Header summary
    const header = document.createElement('div');
    header.className = 'hg-ach-header';
    header.innerHTML =
      '<span class="hg-ach-count">' + unlockedCount + ' / ' + total + '</span>' +
      '<span class="hg-ach-subtitle">Achievements Unlocked</span>';

    // Progress bar
    const trackWrap = document.createElement('div');
    trackWrap.className = 'hg-ach-track';
    const trackFill = document.createElement('div');
    trackFill.className = 'hg-ach-fill';
    trackFill.style.width = Math.round((unlockedCount / total) * 100) + '%';
    trackWrap.appendChild(trackFill);

    el.appendChild(header);
    el.appendChild(trackWrap);

    // Achievement list — unlocked first, then locked
    const sorted = [...ACHIEVEMENTS].sort((a, b) => {
      const au = unlockedAchievements.has(a.id);
      const bu = unlockedAchievements.has(b.id);
      if (au === bu) return 0;
      return au ? -1 : 1;
    });

    const list = document.createElement('div');
    list.className = 'hg-ach-list';

    sorted.forEach(ach => {
      const unlocked = unlockedAchievements.has(ach.id);
      const row = document.createElement('div');
      row.className = 'hg-ach-row' + (unlocked ? ' hg-ach-row--unlocked' : ' hg-ach-row--locked');
      row.innerHTML =
        // Icon column dropped from achievement rows — emoji-free pass.
        // Locked vs unlocked state is signaled by the row class only.
        '<div class="hg-ach-info">' +
          '<div class="hg-ach-name">' + esc(ach.name) + '</div>' +
          '<div class="hg-ach-desc">' + esc(ach.desc) + '</div>' +
        '</div>' +
        (unlocked ? '<div class="hg-ach-check">✓</div>' : '');
      list.appendChild(row);
    });

    el.appendChild(list);
  }

  function showDayPopup(dd) {
    const { dateStr, doneIds } = dd;
    const dateDisplay = new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'short', month: 'long', day: 'numeric'
    });

    // Compute XP for completed habits that still exist
    const dow = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short' })
      .format(new Date(dateStr + 'T12:00:00Z'));
    const wasWeekend = ['Fri','Sat','Sun'].includes(dow);
    let xpTotal = 0;
    const completedHabits = (doneIds || []).map(id => habits.find(h => h.id === id)).filter(Boolean);
    completedHabits.forEach(h => {
      const base = (DIFFICULTY[h.difficulty] || DIFFICULTY.easy).pts;
      xpTotal += wasWeekend ? base * 2 : base;
    });

    document.getElementById('day-popup-date').textContent = dateDisplay;

    const listEl = document.getElementById('day-popup-habits');
    if (completedHabits.length) {
      listEl.innerHTML = completedHabits.map(h =>
        '<div class="day-popup-habit">' +
          ((getHabitIcon(h) || h.emoji) ? '<span class="day-popup-habit-emoji">' + habitIconHtml(h, { size: 22 }) + '</span>' : '') +
          '<span>' + esc(h.name) + '</span>' +
        '</div>'
      ).join('');
    } else {
      listEl.innerHTML = '<div class="day-popup-none">No habits completed</div>';
    }

    const xpEl = document.getElementById('day-popup-xp');
    xpEl.textContent = xpTotal > 0 ? '+' + xpTotal + ' XP earned' : '';

    document.getElementById('day-popup').classList.remove('hidden');
    document.getElementById('day-popup-overlay').classList.remove('hidden');
  }

  function closeDayPopup() {
    document.getElementById('day-popup').classList.add('hidden');
    document.getElementById('day-popup-overlay').classList.add('hidden');
  }

  // ── DAY CHANGE ────────────────────────────────────────────
  function checkDayChange() {
    const newDate = getPTDate();
    if (newDate !== today) {
      today = newDate;
      streakDangerDismissed = false; // reset for new day
      // Streak Forgiveness: process the missed-day window now that we
      // know yesterday is locked in. Shields/Honest Days absorb missed
      // days; otherwise the streak breaks and a comeback flag is set.
      if (typeof processStreakRollover === 'function') processStreakRollover();
      if (typeof flushPendingShieldNotices === 'function') {
        setTimeout(flushPendingShieldNotices, 800);
      }
      checkClassChange();
      render();
      // Rebuild today's notification schedule under the new date —
      // honors paused/disabled/daily-limit/quiet-hours.
      try { Notif.rescheduleAll(habits, today, completions[today] || []); } catch (_) {}
    }
  }

  // ── PERFECT DAY STREAK ───────────────────────────────────

  function checkPerfectDay() {
    const todayHabits = habits.filter(isScheduledToday);
    if (!todayHabits.length) return;
    const allDone = todayHabits.every(h => isChecked(h.id));

    if (allDone) {
      if (perfectStreak.lastDate === today) return; // already logged today
      perfectStreak.prevCount    = perfectStreak.count;
      perfectStreak.prevLastDate = perfectStreak.lastDate;
      const yesterday = prevDay(today);
      perfectStreak.count    = perfectStreak.lastDate === yesterday ? perfectStreak.count + 1 : 1;
      perfectStreak.lastDate = today;
      save();
      updatePerfectStreakDisplay();
      checkPerfectStreakMilestone();
      // Feature 5: lightweight perfect-day celebration (every perfect day, separate from milestone screen)
      // Delay slightly so compound popup (if any) can appear first
      setTimeout(triggerPerfectDayCelebration, 400);
    } else {
      if (perfectStreak.lastDate !== today) return; // wasn't a perfect day anyway
      perfectStreak.count    = perfectStreak.prevCount    || 0;
      perfectStreak.lastDate = perfectStreak.prevLastDate || null;
      save();
      updatePerfectStreakDisplay();
    }
  }

  function checkPerfectStreakMilestone() {
    const n   = perfectStreak.count;
    const key = String(n);
    if (psAwarded.has(key)) return;

    let ms = PERFECT_STREAK_MILESTONES.find(m => m.day === n);
    if (!ms && n > 100 && (n - 100) % 30 === 0) {
      ms = { ...PS_REPEAT, day: n, title: 'UNSTOPPABLE — Day ' + n };
    }
    if (!ms) return;

    psAwarded.add(key);
    totalPoints += ms.bonus;
    save();
    renderRank();
    levelUpQueue.push({ type: 'perfectday', milestone: ms, streakCount: n });
    if (!levelUpActive) drainLevelUpQueue();
  }

  function updatePerfectStreakDisplay() {
    const el = document.getElementById('perfect-streak-display');
    if (!el) return;
    const todayHabits  = habits.filter(isScheduledToday);
    const isPerfect    = todayHabits.length > 0 && todayHabits.every(h => isChecked(h.id));
    const yesterday    = prevDay(today);
    const displayCount = (perfectStreak.lastDate === today || perfectStreak.lastDate === yesterday)
      ? perfectStreak.count : 0;
    el.className = 'perfect-streak-display' + (isPerfect ? ' ps-gold' : '');
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', 'View all streaks');
    el.innerHTML = '<span class="ps-fire">' + streakIconHtml({ size: 18 }) + '</span><span class="ps-count">' + displayCount + '</span>';
  }

  // ── ALL STREAKS SHEET ────────────────────────────────────
  // Opened by tapping the 🔥 streak pill in the header. Shows
  // perfect-day streak, Morning Routine compound streak, Locked-In
  // compound streak, and the user's chosen path — all info that
  // previously lived as cluttered rows on the Status tab.
  function openStreaksSheet() {
    const body = document.getElementById('streaks-body');
    if (!body) return;

    const yesterday = prevDay(today);
    const pdCount   = (perfectStreak.lastDate === today || perfectStreak.lastDate === yesterday)
      ? perfectStreak.count : 0;
    const pdBest    = Math.max(perfectStreak.count || 0, perfectStreak.prevCount || 0);

    // Determine the displayed path. Locked-In is a SUPERSET of Morning
    // Routine (10 MR habits + 6 extras), so if the user has an active
    // Locked-In streak, that's the path they're actually walking. Show
    // the highest-tier active pack:
    //   1. Locked-In (if streak is active today/yesterday)
    //   2. Morning Routine (if streak is active OR selectedPackId === 'morning')
    //   3. Whatever selectedPackId points at (custom path, etc.)
    let pathPackId = null;
    const liStreak = compoundStreaks['locked-in'];
    const mrStreak = compoundStreaks['morning'];
    const liActive = liStreak && liStreak.streak > 0 &&
                     (liStreak.lastDate === today || liStreak.lastDate === yesterday);
    const mrActive = mrStreak && mrStreak.streak > 0 &&
                     (mrStreak.lastDate === today || mrStreak.lastDate === yesterday);
    if (liActive)                                pathPackId = 'locked-in';
    else if (mrActive)                           pathPackId = 'morning';
    else if (selectedPackId)                     pathPackId = selectedPackId;
    const path = pathPackId && PACKS.find(p => p.id === pathPackId);

    const compoundRows = BONUS_PACK_IDS
      .filter(packId => {
        const cs = compoundStreaks[packId];
        return cs && (cs.streak > 0 || cs.lastDate);
      })
      .map(packId => {
        const pack = getPackById(packId);
        const cs   = compoundStreaks[packId] || {};
        const live = (cs.lastDate === today || cs.lastDate === yesterday) ? (cs.streak || 0) : 0;
        const accent = packId === 'locked-in' ? '#7c3aed' : '#f59e0b';
        const iconHTML = packId === 'morning'   ? packIconHtml('morning',  { size: 32 }) :
                         packId === 'locked-in' ? packIconHtml('lockedin', { size: 32 }) :
                         iconify(packId === 'locked-in' ? '🔒' : '⚡', { size: 22 });
        return (
          '<div class="streaks-row" style="--row-accent:' + accent + '">' +
            '<div class="streaks-row-icon">' + iconHTML + '</div>' +
            '<div class="streaks-row-main">' +
              '<div class="streaks-row-name">' + esc(pack.name) + '</div>' +
              '<div class="streaks-row-sub">Compound bonus pack</div>' +
            '</div>' +
            '<div class="streaks-row-count">' +
              '<span class="streaks-count-num">' + live + '</span>' +
              '<span class="streaks-count-lbl">day' + (live === 1 ? '' : 's') + '</span>' +
            '</div>' +
          '</div>'
        );
      }).join('');

    let html = '';

    // Perfect Day streak — always visible, even at 0
    html +=
      '<div class="streaks-row streaks-row--perfect" style="--row-accent:#fbbf24">' +
        '<div class="streaks-row-icon">' + streakIconHtml({ size: 28 }) + '</div>' +
        '<div class="streaks-row-main">' +
          '<div class="streaks-row-name">Perfect Day Streak</div>' +
          '<div class="streaks-row-sub">' +
            (pdBest > pdCount ? ('Best: ' + pdBest + ' day' + (pdBest === 1 ? '' : 's')) : 'All habits, every day') +
          '</div>' +
        '</div>' +
        '<div class="streaks-row-count">' +
          '<span class="streaks-count-num">' + pdCount + '</span>' +
          '<span class="streaks-count-lbl">day' + (pdCount === 1 ? '' : 's') + '</span>' +
        '</div>' +
      '</div>';

    // Compound pack streaks (only if user has data for them)
    if (compoundRows) html += compoundRows;

    // Path indicator (subtle row at the bottom)
    if (path) {
      html +=
        '<div class="streaks-path-row">' +
          '<span class="streaks-path-dot" style="background:' + path.color + '"></span>' +
          '<span class="streaks-path-label">Path: <strong>' + esc(path.name) + '</strong></span>' +
        '</div>';
    }

    // Empty state — no streaks active and no path
    if (pdCount === 0 && !compoundRows && !path) {
      html =
        '<div class="streaks-empty">' +
          '<div class="streaks-empty-icon">' + streakIconHtml({ size: 56 }) + '</div>' +
          '<div class="streaks-empty-title">No streaks yet.</div>' +
          '<div class="streaks-empty-sub">Complete every habit scheduled for today to start a Perfect Day streak.</div>' +
        '</div>';
    }

    body.innerHTML = html;
    document.getElementById('streaks-overlay').classList.remove('hidden');
    document.getElementById('streaks-sheet').classList.remove('hidden');
  }

  function closeStreaksSheet() {
    document.getElementById('streaks-overlay').classList.add('hidden');
    document.getElementById('streaks-sheet').classList.add('hidden');
  }

  function setupStreaksSheet() {
    const overlay = document.getElementById('streaks-overlay');
    const sheet   = document.getElementById('streaks-sheet');
    const closeBtn = document.getElementById('streaks-close-btn');
    if (!overlay || !sheet) return;

    overlay.addEventListener('click', closeStreaksSheet);
    if (closeBtn) closeBtn.addEventListener('click', closeStreaksSheet);

    // Tap the 🔥 streak pill in the header to open the sheet.
    const pill = document.getElementById('perfect-streak-display');
    if (pill) {
      pill.addEventListener('click', openStreaksSheet);
      pill.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openStreaksSheet(); }
      });
    }

    // Swipe-down dismiss
    if (typeof attachSheetDismissGesture === 'function') {
      attachSheetDismissGesture(sheet, overlay, closeStreaksSheet, {
        baseTransform:  'translateX(-50%) ',
        handleSelector: '.streaks-drag-handle, .streaks-header',
        scrollTarget:   '.streaks-body',
      });
    }

    // ESC dismisses
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!sheet.classList.contains('hidden')) closeStreaksSheet();
    });
  }

  // ── CLASS DETAIL SHEET ───────────────────────────────────
  // Tap the class emblem on the Status tab → showcases the emblem at
  // hero size + class info + linked stats + (if awakened) Chapter 2
  // origin story excerpt. Provides the "tap to learn more" affordance
  // for the class identity feature.
  function openClassDetail(classKey) {
    const cls = (typeof CLASSES === 'object') && CLASSES[classKey];
    if (!cls) return;
    const body = document.getElementById('class-detail-body');
    if (!body) return;

    // Linked stat list — for non-Sage classes, show the primary stat;
    // for Sage, list all six. (Civilian gets a "no class yet" hint.)
    let linkedStatsHTML = '';
    if (classKey === 'CIVILIAN') {
      linkedStatsHTML =
        '<div class="cd-stats-label">UNAWAKENED</div>' +
        '<div class="cd-stats-hint">Train any stat to Lv5 to find your path.</div>';
    } else if (classKey === 'SAGE') {
      const tiles = STATS.map(st =>
        '<div class="cd-stat-tile" style="--cd-tile-color:' + st.color + '">' +
          statIconHtml(st, { size: 22 }) +
          '<span class="cd-stat-tile-label">' + esc(st.label) + '</span>' +
        '</div>'
      ).join('');
      linkedStatsHTML =
        '<div class="cd-stats-label">UNIFIES ALL SIX STATS</div>' +
        '<div class="cd-stats-grid cd-stats-grid--six">' + tiles + '</div>';
    } else {
      const st = STATS.find(s => s.id === classKey);
      if (st) {
        const lv = (typeof statLevel === 'function')
          ? statLevel((stats[st.id] && stats[st.id].pts) || 0)
          : 0;
        linkedStatsHTML =
          '<div class="cd-stats-label">PRIMARY STAT</div>' +
          '<div class="cd-stat-tile cd-stat-tile--single" style="--cd-tile-color:' + st.color + '">' +
            statIconHtml(st, { size: 28 }) +
            '<span class="cd-stat-tile-label">' + esc(st.label) + '</span>' +
            '<span class="cd-stat-tile-lv">Lv.' + lv + '</span>' +
          '</div>';
      }
    }

    // Chapter 2 excerpt — only if the user has awakened into this exact class.
    let chapterHTML = '';
    if (classKey !== 'CIVILIAN' &&
        originAwakening && originAwakening.text && originAwakening.classKey === classKey) {
      chapterHTML =
        '<div class="cd-chapter-section">' +
          '<div class="cd-chapter-label">⚔️ THE AWAKENING'.replace('⚔️ ', '') +
            (originAwakening.dateDisplay ? ' · ' + esc(originAwakening.dateDisplay) : '') +
          '</div>' +
          '<div class="cd-chapter-text">' + esc(originAwakening.text) + '</div>' +
        '</div>';
    }

    body.innerHTML =
      '<div class="cd-emblem-wrap" style="--cd-color:' + cls.color + '">' +
        classIconHtml(classKey, { size: 144, eager: true }) +
      '</div>' +
      '<div class="cd-name" style="color:' + cls.color + '">' + esc(cls.name) + '</div>' +
      '<div class="cd-desc">' + esc(cls.desc) + '</div>' +
      '<div class="cd-stats-section">' + linkedStatsHTML + '</div>' +
      chapterHTML;

    document.getElementById('class-detail-overlay').classList.remove('hidden');
    document.getElementById('class-detail-sheet').classList.remove('hidden');
  }

  function closeClassDetail() {
    document.getElementById('class-detail-overlay').classList.add('hidden');
    document.getElementById('class-detail-sheet').classList.add('hidden');
  }

  function setupClassDetail() {
    const overlay  = document.getElementById('class-detail-overlay');
    const sheet    = document.getElementById('class-detail-sheet');
    const closeBtn = document.getElementById('class-detail-close-btn');
    if (!overlay || !sheet) return;

    overlay.addEventListener('click', closeClassDetail);
    if (closeBtn) closeBtn.addEventListener('click', closeClassDetail);

    // Delegated click on the entire class line (name + emblem). Every
    // render of the Status hero rebuilds the line, so a body-level
    // listener keeps it wired without re-attaching per render. Both the
    // text and the emblem are valid tap targets.
    document.addEventListener('click', (e) => {
      const t = e.target && e.target.closest && e.target.closest('.sc-hero-class[data-class-key]');
      if (!t) return;
      e.stopPropagation();
      const key = t.getAttribute('data-class-key') || currentClass;
      openClassDetail(key);
    });
    // Keyboard activation — Enter / Space on the focused class line
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const t = document.activeElement;
      if (!t || !t.classList || !t.classList.contains('sc-hero-class')) return;
      e.preventDefault();
      const key = t.getAttribute('data-class-key') || currentClass;
      openClassDetail(key);
    });

    // Swipe-down dismiss
    if (typeof attachSheetDismissGesture === 'function') {
      attachSheetDismissGesture(sheet, overlay, closeClassDetail, {
        baseTransform:  'translateX(-50%) ',
        handleSelector: '.class-detail-drag-handle, .class-detail-header',
        scrollTarget:   '.class-detail-body',
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!sheet.classList.contains('hidden')) closeClassDetail();
    });
  }

  // ── NOTIFICATION TAP ROUTING ─────────────────────────────
  // When the user taps any notification (digest, check-in, per-habit
  // reminder), we route them to the Habits tab. The Capacitor plugin
  // emits 'localNotificationActionPerformed' with the notification's
  // ID + payload — we listen once on init and switch tabs from there.
  function setupNotifTapRouting() {
    try {
      const cap = window.Capacitor;
      const plug = cap && cap.Plugins && cap.Plugins.LocalNotifications;
      if (!plug || !plug.addListener) return;
      plug.addListener('localNotificationActionPerformed', (event) => {
        // Always route notification taps to the Habits tab. Easy mental
        // model — tap any reminder, you land where you act on it.
        try {
          const targetTab = 'habits';
          const btn = document.getElementById('tab-' + targetTab);
          if (btn) btn.click();
        } catch (_) {}
      });
    } catch (_) { /* native plugin not present (web preview) — no-op */ }
  }

  // ── PERFECT DAY SCREEN ────────────────────────────────────

  function pdMakeParticles(W, H, color, n) {
    const isRain = n >= 100;
    return Array.from({ length: n }, (_, i) => {
      const vel = isRain ? 0 : 6 + (n / 100) * 8;
      const p = {
        x:     isRain ? Math.random() * W            : W / 2 + (Math.random() - 0.5) * 80,
        y:     isRain ? -10 - Math.random() * H * 0.5: H * 0.55 + (Math.random() - 0.5) * 60,
        vx:    isRain ? (Math.random() - 0.5) * 2    : (Math.random() - 0.5) * vel * 2,
        vy:    isRain ? Math.random() * 3 + 2         : -(Math.random() * vel + vel * 0.5),
        r:     Math.random() * 3 + (isRain ? 3 : 1.5),
        life:  0.3 + Math.random() * 0.7,
        decay: isRain ? 0.003 + Math.random() * 0.003 : 0.01 + Math.random() * 0.013,
        // Vary colour slightly: base + occasional white sparkle
        hue:   i % 5 === 0 ? '#ffffff' : color,
      };
      p.reset = function () {
        this.x    = isRain ? Math.random() * W            : W / 2 + (Math.random() - 0.5) * 80;
        this.y    = isRain ? -10                           : H * 0.55 + (Math.random() - 0.5) * 60;
        this.vx   = isRain ? (Math.random() - 0.5) * 2    : (Math.random() - 0.5) * vel * 2;
        this.vy   = isRain ? Math.random() * 3 + 2         : -(Math.random() * vel + vel * 0.5);
        this.life = 0.3 + Math.random() * 0.7;
      };
      p.tick = function () {
        this.x  += this.vx;
        this.vy += isRain ? 0.04 : 0.18;
        this.y  += this.vy;
        this.vx *= 0.99;
        this.life -= this.decay;
        if (this.life <= 0) this.reset();
      };
      p.draw = function (ctx) {
        ctx.globalAlpha = Math.max(0, this.life) * 0.85;
        ctx.fillStyle   = this.hue;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
        ctx.fill();
      };
      return p;
    });
  }

  function showPerfectDayScreen({ milestone: ms, streakCount }) {
    const screen     = document.getElementById('perfect-day-screen');
    const canvas     = document.getElementById('pd-canvas');
    const emojiEl    = document.getElementById('pd-emoji');
    const titleEl    = document.getElementById('pd-title');
    const subtEl     = document.getElementById('pd-subtitle');
    const bonusEl    = document.getElementById('pd-bonus');
    const dismissBtn = document.getElementById('pd-dismiss');

    // Theme
    screen.style.setProperty('--pd-color', ms.color);
    screen.classList.remove('hidden', 'pd-shake');
    void screen.offsetWidth;

    // Milestone emoji stripped — celebration screen reads via title +
    // subtitle + bonus XP only. (Emoji-free pass.)
    emojiEl.innerHTML = '';
    subtEl.textContent  = ms.subtitle;
    bonusEl.textContent = '+' + ms.bonus + ' XP Bonus Awarded';
    bonusEl.style.color = ms.color;
    bonusEl.classList.toggle('pd-bonus-xl', ms.day >= 100);
    titleEl.textContent = ms.letterReveal ? '' : ms.title;
    titleEl.classList.toggle('pd-reveal', !!ms.letterReveal);
    dismissBtn.classList.add('hidden');
    // For letter-reveal: hide subtitle/bonus until title done
    subtEl.style.opacity  = ms.letterReveal ? '0' : '';
    bonusEl.style.opacity = ms.letterReveal ? '0' : '';

    // ── Canvas particles ──────────────────────────────────
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx  = canvas.getContext('2d');
    const pCount = ms.day >= 100 ? 130 : ms.day >= 60 ? 90 : ms.day >= 30 ? 70 : ms.day >= 21 ? 50 : ms.day >= 14 ? 35 : 20;
    const pts  = pdMakeParticles(canvas.width, canvas.height, ms.color, pCount);
    let   raf  = null;
    let   live = true;
    const loop = () => {
      if (!live) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pts.forEach(p => { p.tick(); p.draw(ctx); });
      raf = requestAnimationFrame(loop);
    };
    loop();

    // ── Screen shake ──────────────────────────────────────
    if (ms.shake) {
      screen.classList.add('pd-shake');
      setTimeout(() => screen.classList.remove('pd-shake'), 600);
    }

    // ── Audio chime ───────────────────────────────────────
    if (ms.chime) {
      try {
        const ac = new (window.AudioContext || window.webkitAudioContext)();
        const freqs = ms.day >= 100
          ? [523, 659, 784, 1047, 1319]
          : [523, 659, 784, 1047];
        freqs.forEach((freq, i) => {
          const osc = ac.createOscillator(); const g = ac.createGain();
          osc.connect(g); g.connect(ac.destination);
          osc.frequency.value = freq; osc.type = 'sine';
          const t = ac.currentTime + i * 0.13;
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(0.25, t + 0.06);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
          osc.start(t); osc.stop(t + 0.6);
        });
      } catch (_) {}
    }

    // ── Title reveal (Day 100) ─────────────────────────────
    if (ms.letterReveal) {
      const chars = ms.title.split('');
      let i = 0;
      const next = () => {
        if (!live) return;
        if (i < chars.length) { titleEl.textContent += chars[i++]; setTimeout(next, 85); }
        else {
          setTimeout(() => {
            subtEl.style.transition  = 'opacity 0.7s ease';
            bonusEl.style.transition = 'opacity 0.7s ease';
            subtEl.style.opacity  = '1';
            bonusEl.style.opacity = '1';
          }, 300);
          setTimeout(() => { if (live) dismissBtn.classList.remove('hidden'); },
            ms.extended ? 5000 : 1200);
        }
      };
      setTimeout(next, 350);
    } else {
      setTimeout(() => { if (live) dismissBtn.classList.remove('hidden'); }, 1400);
    }

    // ── Dismiss ───────────────────────────────────────────
    const dismiss = () => {
      live = false;
      if (raf) cancelAnimationFrame(raf);
      screen.classList.add('hidden');
      levelUpActive = false;
      drainLevelUpQueue();
    };
    dismissBtn.onclick = dismiss;
  }

  // ── RENDER ────────────────────────────────────────────────
  function render() {
    document.getElementById('current-date').textContent = formatDisplayDate(today);
    updateDoubleXpBanner();
    document.getElementById('main-footer').style.display = currentTab === 'habits' ? '' : 'none';
    renderRank();
    renderHabits();
    renderDailyMissionCard();
    renderDailyQuote();
    checkStreakDanger();
    checkMorningRoutineNudge();
    if (currentTab === 'profile')      renderProfile();
    if (currentTab === 'stats')        renderStats();
    if (currentTab === 'history')      renderHistory();
  }

  function renderHabits() {
    // Mission card piggy-backs every habit re-render so progress stays
    // in sync with completions even when switchTab/onMissionProgress
    // didn't fire (e.g., partial state restoration from localStorage).
    renderDailyMissionCard();
    const list  = document.getElementById('habit-list');
    const empty = document.getElementById('empty-state');
    const todayHabits = habits.filter(isScheduledToday);
    updateMorningButtonVisibility();
    updateLockedInButtonVisibility();

    if (habits.length === 0) {
      list.innerHTML = '';
      empty.querySelector('p').innerHTML = 'No habits yet.<br>Tap below to add your first.';
      empty.classList.remove('hidden');
    } else if (todayHabits.length === 0) {
      list.innerHTML = '';
      empty.querySelector('p').innerHTML = 'No habits scheduled today.<br>Enjoy your rest day! 😴';
      empty.classList.remove('hidden');
    } else {
      empty.classList.add('hidden');
      const frag = document.createDocumentFragment();
      todayHabits.forEach(h => frag.appendChild(buildItem(h)));
      list.innerHTML = '';
      list.appendChild(frag);
      bindDrag();
    }
    updateProgress();

    // HealthKit auto-verify hooks. Fire async; both no-op on web /
    // when permission isn't granted / when threshold not met. Each
    // re-triggers renderHabits() once after a successful auto-check.
    try { autoVerifyWalk(); } catch (_) {}
    try { autoVerifySleep(); } catch (_) {}
  }

  function renderRank() {
    const rank = getRank(totalPoints);
    // PR hook — track highest rank ever reached (only goes up)
    prUpdate('highest_rank', rank.id);
    const badge = document.getElementById('rank-badge');
    const label = document.getElementById('rank-label');
    const pts   = document.getElementById('rank-pts');
    const next  = document.getElementById('rank-next');
    const bar   = document.getElementById('rank-bar');

    badge.textContent = rank.id;
    label.textContent = rank.label;
    pts.textContent   = totalPoints + ' pts';

    const isSPlus = rank.id === 'S+';
    badge.className = 'rank-badge' + (isSPlus ? ' rank-s-plus' : '');
    bar.className   = 'rank-fill'  + (isSPlus ? ' gold-fill'  : '');

    if (isSPlus) {
      next.textContent = 'MAX RANK';
      next.className = 'rank-next maxed';
      bar.style.width = '100%';
    } else {
      const progress = totalPoints - rank.min;
      const range    = rank.next - rank.min;
      bar.style.width = Math.min(100, (progress / range) * 100) + '%';
      next.textContent = (rank.next - totalPoints) + ' to ' + RANKS[RANKS.indexOf(rank) + 1].id;
      next.className = 'rank-next';
    }
  }

  function _formatUnlockDate(dateStr) {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr + 'T12:00:00');
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (_) { return dateStr; }
  }

  function _formatProgressNum(n) {
    return Number(n || 0).toLocaleString();
  }

  function renderAchievements() {
    const grid = document.getElementById('achievements-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const ctx = buildAchievementContext();
    const totalCount    = ACHIEVEMENTS.length;
    const unlockedCount = ACHIEVEMENTS.filter(a => unlockedAchievements.has(a.id)).length;

    // ── Top header: total + per-category breakdown ───────
    const top = document.createElement('div');
    top.className = 'ach-top';
    const catBreakdown = ACH_CATEGORIES.map(cat => {
      const inCat   = ACHIEVEMENTS.filter(a => a.category === cat.id);
      const haveCat = inCat.filter(a => unlockedAchievements.has(a.id)).length;
      // First token of cat.label is the emoji ("🔥 Streaks" → "🔥").
      // streakify swaps 🔥 for the flame icon; other category emojis
      // pass through escaped.
      return '<span class="ach-cat-pill">' + streakify(cat.label.split(' ')[0], 14) +
             ' <b>' + haveCat + '/' + inCat.length + '</b></span>';
    }).join('');
    top.innerHTML =
      '<div class="ach-top-summary">' +
        '<span class="ach-top-num">' + unlockedCount + ' / ' + totalCount + '</span>' +
        '<span class="ach-top-label">ACHIEVEMENTS UNLOCKED</span>' +
      '</div>' +
      '<div class="ach-cat-breakdown">' + catBreakdown + '</div>';
    grid.appendChild(top);

    // ── Recently unlocked (last 3) ──────────────────────
    const recent = ACHIEVEMENTS
      .filter(a => unlockedAchievements.has(a.id) && achievementUnlockDates[a.id])
      .sort((a, b) => (achievementUnlockDates[b.id] || '').localeCompare(achievementUnlockDates[a.id] || ''))
      .slice(0, 3);
    if (recent.length) {
      const recentSec = document.createElement('div');
      recentSec.className = 'ach-section';
      recentSec.innerHTML = '<div class="ach-section-label">RECENTLY UNLOCKED</div>';
      recent.forEach(ach => recentSec.appendChild(_buildAchCard(ach, ctx, true)));
      grid.appendChild(recentSec);
    }

    // ── Categorized sections, locked-by-progress-desc ───
    ACH_CATEGORIES.forEach(cat => {
      const inCat = ACHIEVEMENTS.filter(a => a.category === cat.id);
      if (!inCat.length) return;

      // Sort: unlocked first, then locked sorted by % progress descending
      const sorted = inCat.slice().sort((a, b) => {
        const aU = unlockedAchievements.has(a.id) ? 1 : 0;
        const bU = unlockedAchievements.has(b.id) ? 1 : 0;
        if (aU !== bU) return bU - aU;
        if (aU) return 0;
        const ap = a.getProgress ? a.getProgress(ctx) : { current: 0, target: 1 };
        const bp = b.getProgress ? b.getProgress(ctx) : { current: 0, target: 1 };
        return (bp.current / bp.target) - (ap.current / ap.target);
      });

      const sec = document.createElement('div');
      sec.className = 'ach-section';
      const haveCount = inCat.filter(a => unlockedAchievements.has(a.id)).length;
      sec.innerHTML =
        '<div class="ach-section-label">' + streakify(cat.label, 16) +
          '<span class="ach-section-count">' + haveCount + '/' + inCat.length + '</span>' +
        '</div>';
      sorted.forEach(ach => sec.appendChild(_buildAchCard(ach, ctx, false)));
      grid.appendChild(sec);
    });
  }

  function _buildAchCard(ach, ctx, isRecent) {
    const unlocked = unlockedAchievements.has(ach.id);
    const card = document.createElement('div');
    card.className = 'ach-card ' + (unlocked ? 'unlocked' : 'locked') + (isRecent ? ' ach-recent' : '');

    const progress = (typeof ach.getProgress === 'function') ? ach.getProgress(ctx) : null;
    let progressHTML = '';
    if (!unlocked && progress) {
      const pct = Math.min(100, Math.round((progress.current / progress.target) * 100));
      progressHTML =
        '<div class="ach-prog-bar"><div class="ach-prog-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="ach-prog-text">' +
          _formatProgressNum(progress.current) + ' / ' + _formatProgressNum(progress.target) +
        '</div>';
    } else if (unlocked) {
      const stamp = achievementUnlockDates[ach.id];
      progressHTML = stamp
        ? '<div class="ach-prog-text ach-prog-text--unlocked">Unlocked ' + _formatUnlockDate(stamp) + '</div>'
        : '';
    }

    card.innerHTML =
      // Achievement icon dropped — emoji-free pass.
      '<div class="ach-text">' +
        '<div class="ach-name">' + esc(ach.name) + '</div>' +
        '<div class="ach-desc">' + esc(ach.desc) + '</div>' +
        progressHTML +
      '</div>' +
      '<div class="ach-status">' + (unlocked ? '✓' : '🔒') + '</div>';
    return card;
  }

  function renderProfile() {
    renderStatus();
  }

  function renderStats() {
    const el = document.getElementById('stats-content');
    el.innerHTML = '';

    // ── Section label ──────────────────────────────────────
    const lbl = document.createElement('div');
    lbl.className = 'stats-section-label';
    lbl.textContent = 'CHARACTER STATS';
    el.appendChild(lbl);

    // ── OSRS-style skills panel ────────────────────────────
    const dominantStatId = currentClass !== 'SAGE' ? currentClass : null;
    const panel = document.createElement('div');
    panel.className = 'osrs-panel';

    STATS.forEach(st => {
      const stPts   = stats[st.id]?.pts || 0;
      const level   = statLevel(stPts);
      const isMaxed = level >= 20;
      const levelXP = xpForLevel(level);
      const ptsInLv = stPts - levelXP;
      const needed  = xpToNextLevel(level);
      const pct     = isMaxed ? 100 : Math.min(100, (ptsInLv / needed) * 100);
      const isDom   = st.id === dominantStatId;

      const cell = document.createElement('div');
      cell.className = 'osrs-cell' + (isDom ? ' osrs-cell--dominant' : '') + (isMaxed ? ' osrs-cell--maxed' : '');
      if (isMaxed) {
        cell.style.borderColor = '#f59e0b';
        cell.style.boxShadow   = 'inset 0 0 18px rgba(245,158,11,0.18), 0 0 16px rgba(245,158,11,0.30)';
      } else if (isDom) {
        cell.style.borderColor = st.color + '80';
        cell.style.boxShadow   = 'inset 0 0 18px ' + st.color + '18, 0 0 12px ' + st.color + '22';
      }
      cell.addEventListener('click', () => openStatDetail(st.id));

      // Accent top stripe
      const stripe = document.createElement('div');
      stripe.className = 'osrs-cell-stripe';
      stripe.style.background = st.color;

      // Icon — Stats tab tile cards. 32 CSS px, drawn from the custom art.
      const icon = document.createElement('div');
      icon.className = 'osrs-cell-icon';
      icon.innerHTML = statIconHtml(st, { size: 32, eager: true });

      // Abbrev label
      const abbr = document.createElement('div');
      abbr.className = 'osrs-cell-abbr';
      abbr.style.color = isMaxed ? '#f59e0b' : st.color;
      abbr.textContent = st.label + (isMaxed ? ' MAX' : isDom ? ' ★' : '');

      // Level number (shows MAX crown at cap)
      const lvNum = document.createElement('div');
      lvNum.className = 'osrs-cell-level' + (isMaxed ? ' osrs-cell-level--max' : '');
      lvNum.textContent = isMaxed ? '👑' : level;

      // Thin progress bar (gold when maxed)
      const track = document.createElement('div');
      track.className = 'osrs-cell-track';
      const fill = document.createElement('div');
      fill.className = 'osrs-cell-fill';
      fill.style.cssText = 'width:' + pct + '%;background:' + (isMaxed ? '#f59e0b' : st.color) + ';';
      if (isMaxed) fill.style.boxShadow = '0 0 6px rgba(245,158,11,0.6)';
      track.appendChild(fill);

      cell.append(stripe, icon, abbr, lvNum, track);
      panel.appendChild(cell);
    });

    el.appendChild(panel);

    // ── Total Level ────────────────────────────────────────
    const totalLv   = STATS.reduce((sum, st) => sum + statLevel(stats[st.id]?.pts || 0), 0);
    const isAllMaxed = totalLv >= 120;
    const totalEl   = document.createElement('div');
    totalEl.className = 'osrs-total-level' + (isAllMaxed ? ' osrs-total-level--maxed' : '');
    totalEl.innerHTML = 'Total Level: <span class="osrs-total-num">' + totalLv + '</span>'
      + ' <span class="osrs-total-max">/ 120</span>'
      + (isAllMaxed ? ' <span class="osrs-total-crown">👑 FULLY AWAKENED</span>' : '');
    el.appendChild(totalEl);

    // ── Next Stat Bonus ────────────────────────────────────
    const bonusEl = document.createElement('div');
    bonusEl.className = 'stats-next-bonus-section';

    const candidates = [];
    STATS.forEach(st => {
      const curLevel = statLevel(stats[st.id]?.pts || 0);
      STAT_BONUS_THRESHOLDS.forEach(thr => {
        const key = st.id + '_' + thr.level;
        if (!statBonuses.has(key)) {
          candidates.push({ st, thr, curLevel, levelsNeeded: Math.max(0, thr.level - curLevel) });
        }
      });
    });
    candidates.sort((a, b) => a.levelsNeeded - b.levelsNeeded);

    let bonusHTML = '<div class="stats-section-label" style="margin-top:24px">NEXT STAT BONUS</div>';
    if (candidates.length > 0) {
      const nx  = candidates[0];
      const pct = Math.min(100, Math.round((nx.curLevel / nx.thr.level) * 100));
      bonusHTML +=
        '<div class="nb-card">' +
          '<div class="nb-top">' +
            '<span class="nb-icon">' + statIconHtml(nx.st, { size: 32, eager: true }) + '</span>' +
            '<div class="nb-info">' +
              '<span class="nb-label" style="color:' + nx.st.color + '">' + nx.st.label + '</span>' +
              '<span class="nb-sublabel">Reach Level ' + nx.thr.level + '</span>' +
            '</div>' +
            '<span class="nb-reward">+' + nx.thr.pts + ' XP</span>' +
          '</div>' +
          '<div class="nb-track">' +
            '<div class="nb-fill" style="width:' + pct + '%;background:' + nx.st.color + '"></div>' +
          '</div>' +
          '<div class="nb-labels">' +
            '<span class="nb-cur">Lv.' + nx.curLevel + '</span>' +
            '<span class="nb-goal">Lv.' + nx.thr.level + '</span>' +
          '</div>' +
        '</div>';
    } else {
      bonusHTML += '<div class="nb-card nb-all-done"><span>🏆 All stat bonuses unlocked!</span></div>';
    }
    bonusEl.innerHTML = bonusHTML;
    el.appendChild(bonusEl);
  }

  // ── STATUS ────────────────────────────────────────────────
  function getClass(rankId) {
    const map = { 'E':'Civilian','D':'Civilian','C':'Apprentice Hunter','B':'Hunter','A':'Elite Hunter','S':'Shadow Monarch','S+':'The Awakened One' };
    return map[rankId] || 'Civilian';
  }

  // Avatar silhouette per class. Brand new players (0 XP) see the base
  // silhouette until they earn enough to lock into a class.
  const AVATAR_FILES = {
    STR:   'avatar-warrior.png',
    VIT:   'avatar-ranger.png',
    INT:   'avatar-mage.png',
    FOCUS: 'avatar-assassin.png',
    WILL:  'avatar-paladin.png',
    WLT:   'avatar-merchant.png',
    SAGE:  'avatar-sage.png',
  };
  function getAvatarSrc() {
    // Civilian (or pre-Lv5 in everything) always shows the base silhouette.
    if (!currentClass || currentClass === 'CIVILIAN') return 'avatar-base.png';
    if (totalPoints === 0)                            return 'avatar-base.png';
    return AVATAR_FILES[currentClass] || 'avatar-base.png';
  }
  // Tracks the last-rendered avatar so we only crossfade when class actually changes.
  let _lastAvatarSrc = null;

  function getTitle() {
    for (let i = ACHIEVEMENTS.length - 1; i >= 0; i--) {
      if (unlockedAchievements.has(ACHIEVEMENTS[i].id)) return ACHIEVEMENTS[i].name;
    }
    return '—';
  }

  function renderStatus() {
    const rank       = getRank(totalPoints);
    const isSPlus    = rank.id === 'S+';
    const daysActive = Object.keys(completions).filter(d => completions[d].length > 0).length;
    const maxStreak  = Object.values(streaks).reduce((m, s) => Math.max(m, s.count || 0), 0);
    const todayDone  = (completions[today] || []).length;
    const todaySched = habits.filter(isScheduledToday).length;
    const cls        = CLASSES[currentClass] || CLASSES.SAGE;
    const shifting   = isClassShifting();

    document.getElementById('status-content').innerHTML =
      '<div class="sc-card' + (isSPlus ? ' sc-splus' : '') + '">' +
        // Header label
        '<div class="sc-top">' +
          '<span class="sc-top-title">STATUS</span>' +
          (isWeekend() ? '<span class="stats-2x-badge">2x XP</span>' : '') +
        '</div>' +
        // Hero: rank badge + name + rank + class
        '<div class="sc-hero">' +
          '<div class="sc-rank-hero' + (isSPlus ? ' splus' : '') + '">' + rank.id + '</div>' +
          '<div class="sc-hero-info">' +
            '<div class="sc-hero-nameline">' +
              '<span class="sc-hero-name" id="sc-name-val">' + esc(playerName) + '</span>' +
              '<button class="sc-edit-btn" id="sc-name-edit" aria-label="Edit name">✎</button>' +
              // Compact Personal Records chip — taps open the All-PRs sheet
              buildPRStripHTML() +
            '</div>' +
            '<div class="sc-hero-rank' + (isSPlus ? ' sc-gold' : '') + '">' +
              rank.label + ' · ' + totalPoints.toLocaleString() + ' pts' +
            '</div>' +
            // Whole class line (name + emblem) is one tappable target —
            // opens the Class Detail sheet. Inner emblem still has its
            // own visual hover/press feedback, but tapping the name
            // works equivalently.
            '<div class="sc-hero-class" style="color:' + cls.color + '" data-class-key="' + esc(currentClass) + '" role="button" tabindex="0" aria-label="Class details">' +
              '<span class="sc-hero-class-name">' + esc(cls.name) + '</span>' +
              ' <span class="sc-class-emblem-btn">' +
                classIconHtml(currentClass, { size: 36 }) +
              '</span>' +
            '</div>' +
            '<div class="sc-hero-class-desc">' + esc(cls.desc) + '</div>' +
            // 'Your Origin' — visible whenever we have at least Chapter 1.
            // Counter shows "(2 chapters)" once the user has awakened.
            ((originBeginning && originBeginning.text)
              ? '<button class="sc-origin-btn" id="sc-origin-btn" type="button">📜 Your Origin' +
                  ((originAwakening && originAwakening.text) ? ' <span class="sc-origin-chapters">2 chapters</span>' : '') +
                '</button>'
              : '') +
            (shifting ? '<div class="sc-shifting" style="margin-top:4px">⚠️ Your class is shifting...</div>' : '') +
            // Path badge + compound streak badges (Morning Routine / Locked-In)
            // were removed from the Status hero in v1.1.4 — that information
            // now lives in the "All Streaks" sheet, accessible by tapping the
            // 🔥 streak pill in the app header.
          '</div>' +
        '</div>' +
        '<div class="sc-divider"></div>' +
        // Avatar portrait beside the radar chart
        (function() {
          const src         = getAvatarSrc();
          const justChanged = (_lastAvatarSrc !== null) && (_lastAvatarSrc !== src);
          _lastAvatarSrc    = src;
          return '<div class="sc-portrait-row">' +
            '<div class="sc-avatar-row">' +
              '<img class="sc-avatar' + (justChanged ? ' sc-avatar-changed' : '') + '" ' +
                   'src="' + src + '" alt="' + esc(cls.name) + ' avatar" loading="eager">' +
            '</div>' +
            '<div id="sc-radar-wrap" class="sc-radar-wrap"></div>' +
          '</div>';
        })() +
        // Metrics strip
        '<div class="sc-metrics">' +
          '<div class="sc-metric">' +
            '<span class="sc-metric-val">' + totalPoints.toLocaleString() + '</span>' +
            '<span class="sc-metric-lbl">Total XP</span>' +
          '</div>' +
          '<div class="sc-metric">' +
            '<span class="sc-metric-val">' + maxStreak + '</span>' +
            '<span class="sc-metric-lbl">Best Streak</span>' +
          '</div>' +
          '<div class="sc-metric">' +
            '<span class="sc-metric-val">' + (daysActive || 0) + '</span>' +
            '<span class="sc-metric-lbl">Days Active</span>' +
          '</div>' +
          '<div class="sc-metric">' +
            '<span class="sc-metric-val">' + todayDone + '/' + todaySched + '</span>' +
            '<span class="sc-metric-lbl">Today</span>' +
          '</div>' +
        '</div>' +
      '</div>';

    requestAnimationFrame(() => {
      buildRadarChart();
    });

    document.getElementById('sc-name-edit').addEventListener('click', () => {
      const nameVal = document.getElementById('sc-name-val');
      const editBtn = document.getElementById('sc-name-edit');
      const input = document.createElement('input');
      input.className = 'sc-name-input';
      input.value = playerName;
      input.maxLength = 20;
      input.setAttribute('autocomplete', 'off');
      input.setAttribute('autocapitalize', 'words');
      nameVal.replaceWith(input);
      editBtn.textContent = '✓';
      input.focus();
      const commit = () => {
        playerName = input.value.trim() || 'Hunter';
        localStorage.setItem('hb_name', playerName);
        // Re-arm the digest so the new name appears in tomorrow's notification.
        try { Notif.reapplyDigest(); } catch (_) {}
        renderStatus();
      };
      editBtn.onclick = commit;
      input.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') renderStatus(); });
    });
  }

  function buildRadarChart() {
    const wrap = document.getElementById('sc-radar-wrap');
    if (!wrap) return;

    // SVG viewport
    const SIZE   = 260;           // px square
    const CX     = SIZE / 2;
    const CY     = SIZE / 2;
    const RINGS  = 4;             // concentric background rings
    const N      = STATS.length; // 6 axes
    const MAX_LV = 20;            // axis maximum (Level 20 cap)

    // Stat levels, capped at MAX_LV for display; minimum 2 so the shape is always visible
    const levels = STATS.map(st => Math.max(2, Math.min(MAX_LV, statLevel(stats[st.id]?.pts || 0))));

    // Axis angles: first axis points straight up (−π/2), then clockwise
    function angle(i) { return (2 * Math.PI * i / N) - Math.PI / 2; }
    function pt(r, i)  { return [CX + r * Math.cos(angle(i)), CY + r * Math.sin(angle(i))]; }

    // Maximum usable radius (leaving room for labels). Bumped because the
    // radar now displays smaller (≤200px) so labels are larger in viewBox units.
    const LABEL_PAD = 50;
    const R_MAX     = CX - LABEL_PAD;

    // ── Build SVG string ──────────────────────────────────
    let svg = '<svg class="sc-radar-svg" viewBox="0 0 ' + SIZE + ' ' + SIZE + '" '
            + 'xmlns="http://www.w3.org/2000/svg" '
            + 'aria-label="Stat radar chart">';

    // 1. Background rings
    for (let ring = 1; ring <= RINGS; ring++) {
      const r = (ring / RINGS) * R_MAX;
      const pts = STATS.map((_, i) => pt(r, i).join(',')).join(' ');
      svg += '<polygon points="' + pts + '" '
           + 'fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>';
    }

    // 2. Axis spokes
    STATS.forEach((_, i) => {
      const [x, y] = pt(R_MAX, i);
      svg += '<line x1="' + CX + '" y1="' + CY + '" x2="' + x + '" y2="' + y + '" '
           + 'stroke="rgba(255,255,255,0.08)" stroke-width="1"/>';
    });

    // 3. Filled player shape — uses a CSS-animated clip trick via a path
    //    We give the path a data-target so JS can animate it
    const fullPts  = levels.map((lv, i) => pt((lv / MAX_LV) * R_MAX, i));
    const pathData = fullPts.map(([x, y], i) => (i === 0 ? 'M' : 'L') + x.toFixed(2) + ',' + y.toFixed(2)).join(' ') + ' Z';

    // Glow filter
    svg += '<defs>'
         + '<filter id="radar-glow" x="-30%" y="-30%" width="160%" height="160%">'
         + '<feGaussianBlur stdDeviation="4" result="blur"/>'
         + '<feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>'
         + '</filter>'
         + '</defs>';

    // Filled area (starts collapsed at center, animated via CSS)
    svg += '<path class="sc-radar-fill" d="' + pathData + '" '
         + 'fill="rgba(139,92,246,0.30)" stroke="#8b5cf6" stroke-width="1.8" '
         + 'stroke-linejoin="round" filter="url(#radar-glow)"/>';

    // 4. Outer axis dots in each stat's unique colour
    STATS.forEach((st, i) => {
      const r = R_MAX + 4; // slightly outside the ring
      const [x, y] = pt(r, i);
      svg += '<circle cx="' + x.toFixed(2) + '" cy="' + y.toFixed(2) + '" r="4" '
           + 'fill="' + st.color + '" opacity="0.85"/>';
    });

    // 5. Tappable hit-zones + labels for each axis
    STATS.forEach((st, i) => {
      const lv      = levels[i];
      const ang     = angle(i);
      const labelR  = R_MAX + LABEL_PAD * 0.72;
      const [lx, ly] = [CX + labelR * Math.cos(ang), CY + labelR * Math.sin(ang)];

      // Invisible hit circle centred at axis tip (easier to tap)
      const [hx, hy] = pt(R_MAX + 14, i);
      svg += '<circle class="sc-radar-hit" cx="' + hx.toFixed(2) + '" cy="' + hy.toFixed(2) + '" r="18" '
           + 'fill="transparent" data-statid="' + st.id + '"/>';

      // Label: abbreviation on first line, level on second.
      // Y offsets widened to keep larger labels from overlapping each other.
      // data-statid makes the text itself clickable, not just the hit-circle.
      svg += '<text x="' + lx.toFixed(2) + '" y="' + (ly - 8).toFixed(2) + '" '
           + 'class="sc-radar-lbl" fill="' + st.color + '" text-anchor="middle" '
           + 'data-statid="' + st.id + '" style="cursor:pointer">'
           + st.label + '</text>';
      svg += '<text x="' + lx.toFixed(2) + '" y="' + (ly + 14).toFixed(2) + '" '
           + 'class="sc-radar-sublbl" fill="' + (lv >= MAX_LV ? '#f59e0b' : 'rgba(255,255,255,0.45)') + '" text-anchor="middle" '
           + 'data-statid="' + st.id + '" style="cursor:pointer">'
           + (lv >= MAX_LV ? 'MAX' : 'Lv.' + lv) + '</text>';
    });

    svg += '</svg>';

    wrap.innerHTML = svg;

    // Animate fill in from center — setTimeout(0) guarantees a new task after paint,
    // so the browser registers the initial scale(0) before we flip to scale(1).
    setTimeout(() => {
      const fillEl = wrap.querySelector('.sc-radar-fill');
      if (fillEl) fillEl.classList.add('sc-radar-fill--animate');
    }, 20);

    // Tapping an axis hit-zone OR the text label opens the stat detail sheet
    wrap.querySelectorAll('[data-statid]').forEach(el => {
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => openStatDetail(el.dataset.statid));
    });
  }

  function buildSchedPills(habit) {
    if (!habit.days || habit.days.length === 7) return '';
    const pills = ALL_DAYS
      .map((d, i) => habit.days.includes(d) ? '<span class="sched-pill">' + DAY_LABELS[i] + '</span>' : '')
      .join('');
    return '<div class="sched-pills">' + pills + '</div>';
  }

  // Difficulty colour lookup for card left-border glow
  const DIFF_COLORS = { easy: '#8b5cf6', medium: '#3b82f6', hard: '#f97316', legendary: '#f59e0b' };

  function buildItem(habit) {
    const done  = isChecked(habit.id);
    const count = getStreak(habit.id);
    const diff  = habit.difficulty || 'easy';
    const xpVal = diffPts(diff);
    const wknd  = isWeekend();

    // No Alcohol weekend challenge badge
    const isNoAlcohol   = habit.name === 'No alcohol';
    const naBadge       = isNoAlcohol ? getNoAlcoholBadge() : null;
    // streakify the badge text so the "Day 2 of 3" variant uses the
    // custom flame icon. Other badges (🏆 💰 ✅) pass through escaped.
    const naBadgeHTML   = naBadge
      ? '<div class="na-challenge-badge ' + naBadge.cls + '">' + streakify(naBadge.text, 14) + '</div>'
      : '';

    // XP badge — ⚡+N XP (gold), ⚡+N XP 2× on weekends. The lightning
    // icon is sized small to sit cleanly next to the +N XP text.
    const xpBadge = wknd
      ? '<span class="habit-xp weekend">' + xpIconHtml({ size: 14 }) + '+' + xpVal + ' XP <span class="xp-2x">2×</span></span>'
      : '<span class="habit-xp">' + xpIconHtml({ size: 14 }) + '+' + xpVal + ' XP</span>';

    const li = document.createElement('li');
    li.className = 'habit-item' + (done ? ' completed' : '');
    li.dataset.id = habit.id;
    // Set difficulty colour variable for left-border glow and checkbox ring
    li.style.setProperty('--diff-color', DIFF_COLORS[diff] || DIFF_COLORS.easy);

    // Auto-verify pill: shown ONLY when the habit was auto-verified
    // today via HealthKit (currently only the canonical Daily walk).
    // Subtle by design — a marker, not a celebration. See CLAUDE.md
    // "Per-habit reminders" + "HealthKit auto-verify" sections.
    const isAutoVerified = (typeof AUTO_VERIFY !== 'undefined') && AUTO_VERIFY.isAutoVerifiedToday(habit.id);
    const autoPillHTML = isAutoVerified
      ? '<span class="auto-verify-pill" title="Auto-verified via Apple Health">AUTO</span>'
      : '';

    li.innerHTML =
      // Top row: streak badge (left) + auto-pill (when set) + check circle (right)
      '<div class="hg-top">' +
        '<div class="streak-badge' + (count > 0 ? ' active' : '') + '">' +
          (count > 0 ? '<span class="streak-fire">' + streakIconHtml({ size: 14 }) + '</span>' + count : '') +
        '</div>' +
        autoPillHTML +
        '<div class="habit-cb' + (done ? ' checked' : '') + '">' +
          '<span class="check-mark">✓</span>' +
        '</div>' +
      '</div>' +
      // Emoji / habit icon centered. Curated habits with mapped art
      // render as <img>; everything else (unmapped curated + custom)
      // falls back to the emoji glyph. The icon is sized larger than
      // an emoji so the DALL-E detail reads at habit-card scale.
      '<div class="hg-emoji-wrap">' +
        (getHabitIcon(habit)
          ? '<span class="habit-emoji">' + habitIconHtml(habit, { size: 72 }) + '</span>'
          : (habit.emoji ? '<span class="habit-emoji">' + habit.emoji + '</span>' : '')) +
      '</div>' +
      // Name (2-line clamp)
      '<span class="habit-name">' + habitDisplayHTML(habit) + '</span>' +
      // Bottom: diff badge + XP
      '<div class="habit-meta">' +
        '<span class="diff-badge ' + diff + '">' + DIFFICULTY[diff].label + '</span>' +
        xpBadge +
      '</div>' +
      naBadgeHTML +
      buildSchedPills(habit) +
      // Drag handle (hidden by default, shown in reorder mode)
      '<div class="drag-handle" data-drag>' +
        '<span class="drag-dot"></span><span class="drag-dot"></span>' +
        '<span class="drag-dot"></span><span class="drag-dot"></span>' +
        '<span class="drag-dot"></span><span class="drag-dot"></span>' +
      '</div>' +
      // More button (absolute bottom-right)
      '<button class="habit-more-btn" data-more aria-label="Options">' +
        (habitNotes[habit.id] ? '📝' : '···') +
      '</button>';

    li.addEventListener('pointerdown', e => { if (!e.target.closest('[data-drag]') && !e.target.closest('[data-more]')) li.classList.add('pressing'); });
    li.addEventListener('pointerup',    () => li.classList.remove('pressing'));
    li.addEventListener('pointercancel',() => li.classList.remove('pressing'));
    li.addEventListener('click', e => {
      if (e.target.closest('[data-drag]') || e.target.closest('[data-more]')) return;
      // Suppress click-through fired right after a long-press drop.
      if (Date.now() < _postDropGuardUntil) return;
      toggleHabit(habit.id, li);
    });
    li.querySelector('[data-more]').addEventListener('click', e => { e.stopPropagation(); showCtxMenu(habit.id, li); });
    return li;
  }

  // Returns true if a measurable habit's goal meets the minimum threshold.
  function meetsMinimum(habit) {
    // HealthKit-auto-verifiable habits (Daily walk step goal, Sleep
    // duration goal, Sleep before midnight binary) all bypass the
    // legacy MEASURABLE_HABITS minimum check. Their goals come from
    // dedicated per-habit fields (or no goal at all, for the binary
    // bedtime habit) and the Edit modal clamps to safe ranges — there's
    // nothing to block. Without this guard, v1.1.5 users with no
    // habit.goal field yet would hit the "Set your goal value" toast
    // and be unable to toggle these habits manually.
    if (isHealthAutoVerifiableHabit(habit)) return true;

    const m = MEASURABLE_HABITS[habit.name];
    if (!m) return true; // not measurable — always OK
    if (!habit.goal) return false; // no goal set at all
    let min = m.min;
    if (m.bodyweightMin) {
      const bw = parseInt(localStorage.getItem('hb_bodyweight') || '0', 10);
      min = bw > 0 ? bw : 1;
    }
    return habit.goal.value >= min;
  }

  // Brief floating toast anchored near the bottom of the screen.
  // showHabitToast(msg, opts?)
  // opts.onTap   — if provided, the toast becomes a tap target. Tapping
  //                it dismisses the toast and runs the callback.
  // opts.cta     — optional CTA label appended (default: '→')
  // opts.duration — ms before auto-dismiss (default: 2200; 4000 if tappable)
  // opts.sticky  — if true, NO auto-dismiss timer. Toast stays until the
  //                user taps it. Useful for important confirmations the
  //                user shouldn't miss (e.g., "✓ Reminder set for 9 AM").
  function showHabitToast(msg, opts) {
    opts = opts || {};
    document.querySelectorAll('.habit-toast').forEach(t => t.remove());
    const toast = document.createElement('div');
    const isTap   = typeof opts.onTap === 'function';
    const sticky  = !!opts.sticky;
    // Sticky toasts are always tap-dismissable, even without an onTap callback.
    const tappable = isTap || sticky;
    toast.className = 'habit-toast' + (tappable ? ' habit-toast--tappable' : '');
    if (tappable) {
      toast.setAttribute('role', 'button');
      toast.setAttribute('tabindex', '0');
      toast.innerHTML =
        '<span class="ht-msg">' + esc(msg) + '</span>' +
        '<span class="ht-cta">' + esc(opts.cta || (isTap ? '→' : '✕')) + '</span>';
    } else {
      toast.textContent = msg;
    }
    document.body.appendChild(toast);
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('habit-toast--visible')));

    const dismiss = () => {
      toast.classList.remove('habit-toast--visible');
      setTimeout(() => toast.remove(), 300);
    };
    // Sticky → no timer. Tappable (with onTap) → 4s default. Plain → 2.2s.
    const dismissTimer = sticky
      ? null
      : setTimeout(dismiss, opts.duration || (isTap ? 4000 : 2200));

    if (tappable) {
      toast.addEventListener('click', () => {
        if (dismissTimer) clearTimeout(dismissTimer);
        dismiss();
        if (isTap) { try { opts.onTap(); } catch (_) {} }
      });
      toast.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (dismissTimer) clearTimeout(dismissTimer);
          dismiss();
          if (isTap) { try { opts.onTap(); } catch (_) {} }
        }
      });
    }
  }

  // ── REMINDER-CONFIRM TOAST ──────────────────────────────
  // Sticky toast with an inline-editable time chip. Tapping the time
  // opens the native iOS time picker; on change, the digest is
  // rescheduled and the chip updates in place. Tap the ✕ to dismiss.
  // Used right after the user enables the daily morning reminder so
  // they can adjust it without navigating to Settings.
  function showReminderConfirmToast(initialTime) {
    document.querySelectorAll('.habit-toast').forEach(t => t.remove());

    function fmt(t) {
      const [hStr, mStr] = (t || '09:00').split(':');
      const h  = parseInt(hStr, 10);
      const m  = parseInt(mStr, 10) || 0;
      const pm = h >= 12;
      const h12 = ((h % 12) || 12);
      return h12 + ':' + String(m).padStart(2, '0') + ' ' + (pm ? 'PM' : 'AM');
    }

    // Parse the initial time into hour (24h) and minute components.
    let curH = 9, curM = 0;
    {
      const parts = (initialTime || '09:00').split(':');
      curH = parseInt(parts[0], 10) || 0;
      curM = parseInt(parts[1], 10) || 0;
      // snap to 15-min grid if upstream value drifted
      curM = Math.round(curM / 15) * 15;
      if (curM === 60) { curH = (curH + 1) % 24; curM = 0; }
    }

    // Build hour column. The list is rotated to start at 5 AM (a sensible
    // morning anchor for a "morning reminder") and wraps through midnight
    // back to 4 AM. So the order is: 5 AM, 6 AM, ..., 11 PM, 12 AM, 1 AM,
    // 2 AM, 3 AM, 4 AM. The default 9 AM still sits a few rows down.
    // Minute column (4 entries: 00 / 15 / 30 / 45) is independent.
    const HOUR_START = 5;
    const hourLabel = (h) => {
      const pm = h >= 12;
      const h12 = ((h % 12) || 12);
      return h12 + (pm ? ' PM' : ' AM');
    };
    const hoursHTML = Array.from({ length: 24 }, (_, i) => {
      const h = (HOUR_START + i) % 24;
      return '<button type="button" class="ht-rem-slot' +
        (h === curH ? ' ht-rem-slot--active' : '') +
        '" data-h="' + h + '">' + esc(hourLabel(h)) + '</button>';
    }).join('');
    const minutesHTML = [0, 15, 30, 45].map(m =>
      '<button type="button" class="ht-rem-slot' +
        (m === curM ? ' ht-rem-slot--active' : '') +
      '" data-m="' + m + '">' + String(m).padStart(2, '0') + '</button>'
    ).join('');

    // Toast is the visible pill. Popup is a SIBLING (also position: fixed)
    // anchored above the toast — putting them in separate fixed containers
    // sidesteps any clipping/stacking issues from nested elements.
    const toast = document.createElement('div');
    toast.className = 'habit-toast habit-toast--tappable habit-toast--reminder';
    toast.setAttribute('role', 'button');
    toast.setAttribute('tabindex', '0');
    toast.setAttribute('aria-label', 'Change reminder time');
    toast.innerHTML =
      '<span class="ht-msg">' +
        '✓ Reminder set for ' +
        '<span class="ht-rem-time">' + esc(fmt(initialTime)) + '</span>' +
      '</span>' +
      '<span class="ht-cta ht-rem-dismiss" role="button" aria-label="Dismiss">✕</span>';

    const popup = document.createElement('div');
    popup.className = 'ht-rem-popup hidden';
    popup.innerHTML =
      '<div class="ht-rem-col ht-rem-col--hours" data-col="h">' + hoursHTML + '</div>' +
      '<div class="ht-rem-col-divider"></div>' +
      '<div class="ht-rem-col ht-rem-col--mins"  data-col="m">' + minutesHTML + '</div>';

    // Append both as siblings to body so they're in the root stacking
    // context — no risk of being clipped or hidden by intermediate
    // overlays (e.g. the Beginning reveal screen).
    document.body.appendChild(toast);
    document.body.appendChild(popup);
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('habit-toast--visible')));

    const timeChip   = toast.querySelector('.ht-rem-time');
    const dismissBtn = toast.querySelector('.ht-rem-dismiss');

    const cleanup = () => { toast.remove(); popup.remove(); };
    const dismiss = () => {
      toast.classList.remove('habit-toast--visible');
      popup.classList.add('hidden');
      setTimeout(cleanup, 300);
    };

    const openPopup = () => {
      popup.classList.remove('hidden');
      // For each column: leave scrollTop at 0 if the active item is
      // already visible in the first viewport-worth of entries. Only
      // scroll if the active item is below the visible window. This
      // matches the spec: opening the picker shows 5 AM → 9 AM (default)
      // with no scroll needed; if the user has selected a later hour
      // and reopens, we scroll just enough to bring it into view.
      popup.querySelectorAll('.ht-rem-col').forEach(col => {
        const active = col.querySelector('.ht-rem-slot--active');
        if (!active) { col.scrollTop = 0; return; }
        const activeBottom = active.offsetTop + active.offsetHeight;
        if (activeBottom <= col.clientHeight) {
          col.scrollTop = 0;        // active is in the first viewport
        } else {
          // Place the active at the bottom of the visible area so the
          // user sees the items leading up to it (matches the
          // "9 AM at the bottom of 5/6/7/8/9" feel from the spec).
          col.scrollTop = activeBottom - col.clientHeight;
        }
      });
    };
    const closePopup = () => popup.classList.add('hidden');
    const isPopupOpen = () => !popup.classList.contains('hidden');

    // Helper: build "HH:MM" 24h string from current state, snapping minutes.
    const buildT = () => {
      const m = Math.round(curM / 15) * 15;
      const h = (m === 60) ? (curH + 1) % 24 : curH;
      const mm = (m === 60) ? 0 : m;
      return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
    };

    const applyTime = async () => {
      const newT = buildT();
      timeChip.textContent = fmt(newT);
      try { await Notif.setDailyDigest(newT); } catch (_) {}
      try { if (typeof refreshRemindersPanel === 'function') refreshRemindersPanel(); } catch (_) {}
    };

    // Column click: pick a value in that column. Other column stays put.
    popup.addEventListener('click', async (e) => {
      e.stopPropagation();
      const slot = e.target.closest('.ht-rem-slot');
      if (!slot) return;
      const col = slot.closest('.ht-rem-col');
      if (!col) return;
      // Update the active highlight within the column
      col.querySelectorAll('.ht-rem-slot').forEach(s => s.classList.remove('ht-rem-slot--active'));
      slot.classList.add('ht-rem-slot--active');
      // Update the corresponding state value
      if (col.dataset.col === 'h') curH = parseInt(slot.dataset.h, 10);
      else                          curM = parseInt(slot.dataset.m, 10);
      await applyTime();
    });

    // Toast-level click: toggle the popup, except for ✕ which dismisses.
    // stopPropagation so taps don't bubble to a parent overlay (e.g. the
    // Beginning reveal listens for taps to advance).
    toast.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target.closest('.ht-rem-dismiss')) {
        dismiss();
      } else {
        isPopupOpen() ? closePopup() : openPopup();
      }
    });
    toast.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (e.target.closest('.ht-rem-dismiss')) {
        e.preventDefault();
        dismiss();
      } else if (e.target === toast) {
        e.preventDefault();
        isPopupOpen() ? closePopup() : openPopup();
      }
    });

    // Tap outside closes the popup (but doesn't dismiss the toast).
    document.addEventListener('click', (e) => {
      if (popup.classList.contains('hidden')) return;
      if (e.target.closest('.habit-toast--reminder')) return;
      if (e.target.closest('.ht-rem-popup')) return;
      closePopup();
    });
  }

  // ── DIGEST TIME PICKER (centered modal) ─────────────────
  // Same two-column UI as the post-onboarding toast picker (hour rotated
  // to 5 AM start, minutes locked to 15-min increments) but presented as
  // a centered card with a dark backdrop. Used by Settings → Daily
  // morning reminder so the platform-native time wheel is bypassed
  // entirely. Calls onPick(newTime) whenever the user picks any slot.
  function openDigestTimePickerModal(initialTime, onPick) {
    function fmt(t) {
      const [hStr, mStr] = (t || '09:00').split(':');
      const h  = parseInt(hStr, 10);
      const m  = parseInt(mStr, 10) || 0;
      const pm = h >= 12;
      const h12 = ((h % 12) || 12);
      return h12 + ':' + String(m).padStart(2, '0') + ' ' + (pm ? 'PM' : 'AM');
    }

    let curH = 9, curM = 0;
    {
      const parts = (initialTime || '09:00').split(':');
      curH = parseInt(parts[0], 10) || 0;
      curM = parseInt(parts[1], 10) || 0;
      curM = Math.round(curM / 15) * 15;
      if (curM === 60) { curH = (curH + 1) % 24; curM = 0; }
    }

    const HOUR_START = 5;
    const hourLabel = (h) => {
      const pm = h >= 12;
      const h12 = ((h % 12) || 12);
      return h12 + (pm ? ' PM' : ' AM');
    };
    const hoursHTML = Array.from({ length: 24 }, (_, i) => {
      const h = (HOUR_START + i) % 24;
      return '<button type="button" class="ht-rem-slot' +
        (h === curH ? ' ht-rem-slot--active' : '') +
        '" data-h="' + h + '">' + esc(hourLabel(h)) + '</button>';
    }).join('');
    const minutesHTML = [0, 15, 30, 45].map(m =>
      '<button type="button" class="ht-rem-slot' +
        (m === curM ? ' ht-rem-slot--active' : '') +
      '" data-m="' + m + '">' + String(m).padStart(2, '0') + '</button>'
    ).join('');

    const overlay = document.createElement('div');
    overlay.className = 'digest-picker-overlay';
    overlay.innerHTML =
      '<div class="digest-picker-card" role="dialog" aria-label="Pick reminder time">' +
        '<div class="digest-picker-title">Daily Morning Reminder</div>' +
        '<div class="digest-picker-current">' + esc(fmt(initialTime || '09:00')) + '</div>' +
        '<div class="ht-rem-popup digest-picker-cols">' +
          '<div class="ht-rem-col ht-rem-col--hours" data-col="h">' + hoursHTML + '</div>' +
          '<div class="ht-rem-col-divider"></div>' +
          '<div class="ht-rem-col ht-rem-col--mins"  data-col="m">' + minutesHTML + '</div>' +
        '</div>' +
        '<div class="digest-picker-actions">' +
          '<button class="digest-picker-done" type="button">Done</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('digest-picker-overlay--visible'));

    // Auto-scroll each column the same way the toast picker does:
    // active item visible at the bottom of the first viewport.
    overlay.querySelectorAll('.ht-rem-col').forEach(col => {
      const active = col.querySelector('.ht-rem-slot--active');
      if (!active) { col.scrollTop = 0; return; }
      const activeBottom = active.offsetTop + active.offsetHeight;
      if (activeBottom <= col.clientHeight) {
        col.scrollTop = 0;
      } else {
        col.scrollTop = activeBottom - col.clientHeight;
      }
    });

    const close = () => {
      overlay.classList.remove('digest-picker-overlay--visible');
      setTimeout(() => overlay.remove(), 220);
    };

    const buildT = () => {
      const m = Math.round(curM / 15) * 15;
      const h = (m === 60) ? (curH + 1) % 24 : curH;
      const mm = (m === 60) ? 0 : m;
      return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
    };

    overlay.querySelector('.digest-picker-cols').addEventListener('click', (e) => {
      const slot = e.target.closest('.ht-rem-slot');
      if (!slot) return;
      const col = slot.closest('.ht-rem-col');
      if (!col) return;
      col.querySelectorAll('.ht-rem-slot').forEach(s => s.classList.remove('ht-rem-slot--active'));
      slot.classList.add('ht-rem-slot--active');
      if (col.dataset.col === 'h') curH = parseInt(slot.dataset.h, 10);
      else                          curM = parseInt(slot.dataset.m, 10);
      // Live update the "current selection" display
      const cur = overlay.querySelector('.digest-picker-current');
      if (cur) cur.textContent = fmt(buildT());
      // Apply immediately so the digest reschedules without waiting for Done.
      try { onPick && onPick(buildT()); } catch (_) {}
    });

    // Done commits the current selection AND closes. This ensures that
    // when the user opens the picker, doesn't change anything (the default
    // is already what they want), and taps Done — the time still saves.
    // Without this, opening fresh + tapping Done would never call onPick
    // and the per-habit reminder would never be created.
    overlay.querySelector('.digest-picker-done').addEventListener('click', () => {
      try { onPick && onPick(buildT()); } catch (_) {}
      close();
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();      // backdrop tap dismisses
    });

    // ESC dismisses
    const onKey = (e) => {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
    };
    document.addEventListener('keydown', onKey);
  }

  // ── SOUND PREFERENCE ─────────────────────────────────────
  let soundEnabled = localStorage.getItem('hb_sound') !== 'off';

  // ── FEATURE 1: CHECK SOUND ───────────────────────────────
  function playCheckSound() {
    if (!soundEnabled) return;
    try {
      const ac   = new (window.AudioContext || window.webkitAudioContext)();
      const osc  = ac.createOscillator();
      const gain = ac.createGain();
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(420, ac.currentTime);
      osc.frequency.exponentialRampToValueAtTime(660, ac.currentTime + 0.08);
      gain.gain.setValueAtTime(0.18, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.28);
      osc.start(ac.currentTime);
      osc.stop(ac.currentTime + 0.28);
    } catch (_) {}
  }

  // ── BIG-MOMENT FANFARE ────────────────────────────────────
  // Triumphant ascending D-major arpeggio (D4 → F#4 → A4 → D5)
  // with the final D5 sustained as a chord (D5 + A5 fifth) for warmth.
  // Reusable for compound bonus, rank-ups, major achievements.
  function playFanfare() {
    if (!soundEnabled) return;
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const t0 = ac.currentTime;

      // D major arpeggio (Hz)
      const D4  = 293.66;
      const Fs4 = 369.99;
      const A4  = 440.00;
      const D5  = 587.33;
      const A5  = 880.00;

      // Master bus — slight low-pass via a small gain dip on highs would need a filter,
      // but layered sine+triangle already gives a warm timbre without harshness.
      const master = ac.createGain();
      master.gain.value = 1.0;
      master.connect(ac.destination);

      // Each note = sine (fundamental) + triangle (warm harmonic body)
      function playNote(freq, start, dur, peak, sustain) {
        ['sine', 'triangle'].forEach(type => {
          const osc  = ac.createOscillator();
          const gain = ac.createGain();
          osc.type   = type;
          osc.frequency.setValueAtTime(freq, t0 + start);
          osc.connect(gain);
          gain.connect(master);

          // Sine carries the melody body; triangle is half-volume for warmth.
          const g = type === 'sine' ? peak : peak * 0.5;

          // Gentle attack, then either a quick release or a long sustain-decay tail
          gain.gain.setValueAtTime(0.0001, t0 + start);
          gain.gain.exponentialRampToValueAtTime(g, t0 + start + 0.025);
          if (sustain > 0) {
            gain.gain.setValueAtTime(g,            t0 + start + 0.20);
            gain.gain.exponentialRampToValueAtTime(g * 0.55, t0 + start + 0.45);
            gain.gain.exponentialRampToValueAtTime(0.0001,    t0 + start + dur);
          } else {
            gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
          }

          osc.start(t0 + start);
          osc.stop(t0 + start + dur + 0.05);
        });
      }

      // Ascending arpeggio — confident, not rushed (~100ms per step)
      playNote(D4,  0.00, 0.22, 0.26, 0);
      playNote(Fs4, 0.10, 0.22, 0.26, 0);
      playNote(A4,  0.20, 0.22, 0.26, 0);

      // Sustained triumphant chord on the octave: D5 + A5 (open fifth) = bright, "earned" peak
      playNote(D5,  0.30, 1.10, 0.32, 1);
      playNote(A5,  0.30, 1.10, 0.16, 1);   // softer fifth above for richness
    } catch (_) {}
  }

  // Locked-In fanfare — the standard fanfare followed by a final
  // emphatic two-note flourish (D5 → D6) to mark the bigger achievement.
  function playFanfareLockedIn() {
    if (!soundEnabled) return;
    // Reuse the standard fanfare (1.4s)…
    playFanfare();
    // …then layer a final octave punch at ~1.55s so it feels like a victory chord.
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const t0 = ac.currentTime + 1.55;

      const D5  = 587.33;
      const D6  = 1174.66;
      const Fs5 = 739.99;

      function punch(freq, start, dur, peak) {
        ['sine', 'triangle'].forEach(type => {
          const osc  = ac.createOscillator();
          const gain = ac.createGain();
          osc.type   = type;
          osc.frequency.setValueAtTime(freq, t0 + start);
          osc.connect(gain);
          gain.connect(ac.destination);
          const g = type === 'sine' ? peak : peak * 0.45;
          gain.gain.setValueAtTime(0.0001, t0 + start);
          gain.gain.exponentialRampToValueAtTime(g, t0 + start + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
          osc.start(t0 + start);
          osc.stop(t0 + start + dur + 0.05);
        });
      }

      // D5 + Fs5 grace note → D6 octave punch on top
      punch(D5,  0.00, 0.18, 0.22);
      punch(Fs5, 0.00, 0.18, 0.14);
      punch(D6,  0.18, 0.55, 0.32);
    } catch (_) {}
  }

  // ── FEATURE 1: XP PARTICLES ──────────────────────────────
  const DIFF_PARTICLE_COLOR = {
    easy:      '#a78bfa',
    medium:    '#60a5fa',
    hard:      '#fb923c',
    legendary: '#fbbf24',
  };

  function spawnXpParticles(li, diff) {
    const cb    = li.querySelector('.habit-cb');
    if (!cb) return;
    const rect  = cb.getBoundingClientRect();
    const liRect = li.getBoundingClientRect();
    const cx    = rect.left + rect.width  / 2 - liRect.left;
    const cy    = rect.top  + rect.height / 2 - liRect.top;
    const color = DIFF_PARTICLE_COLOR[diff] || '#a78bfa';
    const count = 6;

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
      const dist  = 18 + Math.random() * 18;
      const tx    = Math.cos(angle) * dist;
      const ty    = Math.sin(angle) * dist - 8;
      const size  = 3 + Math.random() * 3;
      const dur   = 0.5 + Math.random() * 0.25;

      const dot = document.createElement('span');
      dot.className = 'xp-particle';
      dot.style.cssText =
        'width:'  + size + 'px;' +
        'height:' + size + 'px;' +
        'left:'   + (cx - size / 2) + 'px;' +
        'top:'    + (cy - size / 2) + 'px;' +
        'background:' + color + ';' +
        '--xp-tx:' + tx + 'px;' +
        '--xp-ty:' + ty + 'px;' +
        '--xp-dur:' + dur + 's;';
      li.appendChild(dot);
      dot.addEventListener('animationend', () => dot.remove(), { once: true });
    }
  }

  // ── FEATURE 2: DAILY QUOTE ───────────────────────────────
  // ── QUOTE ROTATION (Feature 2 — rotating display) ────────
  let _quoteCurrent  = null;
  let _quoteTimer    = null;
  let _quoteRotating = false;

  function _quoteApply(el, q) {
    el.innerHTML = '“' + q.text + '”' + '<span class="dq-attr">' + q.attr + '</span>';
    _quoteCurrent = q;
  }

  function _quotePickNext() {
    if (QUOTES.length <= 1) return QUOTES[0];
    let q;
    do { q = QUOTES[Math.floor(Math.random() * QUOTES.length)]; }
    while (q === _quoteCurrent);
    return q;
  }

  function _quoteDisplayMs(text) {
    const len = (text || '').length;
    if (len < 40) return 4000;   // short
    if (len < 80) return 6000;   // medium
    return 8000;                 // long
  }

  function _quoteScheduleNext() {
    if (!_quoteRotating) return;
    const el = document.getElementById('daily-quote');
    if (!el || !_quoteCurrent) return;

    const displayMs = _quoteDisplayMs(_quoteCurrent.text);

    _quoteTimer = setTimeout(() => {
      if (!_quoteRotating) return;
      // Fade out (500ms via CSS opacity transition)
      el.style.opacity = '0';
      _quoteTimer = setTimeout(() => {
        if (!_quoteRotating) return;
        // Swap content while invisible, then fade back in
        _quoteApply(el, _quotePickNext());
        el.style.opacity = '';   // back to CSS default 0.85
        _quoteScheduleNext();
      }, 500);
    }, displayMs);
  }

  function startQuoteRotation() {
    if (_quoteRotating) return;
    _quoteRotating = true;
    _quoteScheduleNext();
  }

  function stopQuoteRotation() {
    _quoteRotating = false;
    if (_quoteTimer) { clearTimeout(_quoteTimer); _quoteTimer = null; }
    // If we paused mid-fade, restore visibility so the user sees the quote on return
    const el = document.getElementById('daily-quote');
    if (el) el.style.opacity = '';
  }

  function renderDailyQuote() {
    const el = document.getElementById('daily-quote');
    if (!el) return;
    el.classList.remove('hidden');

    // First call this session: show today's deterministic daily quote.
    // Subsequent calls (e.g., after habit toggles re-render the screen) keep
    // whatever quote the rotation has currently displayed.
    if (!_quoteCurrent) {
      const d   = new Date();
      const doy = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
      _quoteApply(el, QUOTES[doy % QUOTES.length]);
    }

    // The quote lives in the shared header, visible on every tab —
    // start rotation unconditionally on first render.
    startQuoteRotation();
  }

  // ── FEATURE 3: STREAK DANGER WARNING ─────────────────────
  let streakDangerDismissed = false;

  function checkStreakDanger() {
    const el = document.getElementById('streak-danger');
    if (!el) return;

    // Only show on the habits tab and only if there are incomplete habits
    if (currentTab !== 'habits') { el.classList.add('hidden'); return; }

    const todayHabits = habits.filter(isScheduledToday);
    if (!todayHabits.length) { el.classList.add('hidden'); return; }
    const allDone = todayHabits.every(h => isChecked(h.id));
    if (allDone) { el.classList.add('hidden'); return; }

    // Check if it's between 11 PM and midnight PT
    const ptStr  = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false }).format(new Date());
    const hour   = parseInt(ptStr, 10);
    const isLate = hour >= 23;

    if (isLate && !streakDangerDismissed) {
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  }

  function setupStreakDanger() {
    const btn = document.getElementById('streak-danger-dismiss');
    if (btn) {
      btn.addEventListener('click', () => {
        streakDangerDismissed = true;
        document.getElementById('streak-danger').classList.add('hidden');
        // Reset dismissed flag at midnight (next day change will handle it)
      });
    }
  }

  // ── PACK NUDGE BANNERS — Morning Routine + Locked-In ──────
  // Shown on the Habits tab when the user is 1–2 habits short of
  // completing a canonical bonus pack. Tap → opens the pack add modal.
  // Priority order (only one banner visible at a time):
  //   1. Streak Danger        (time-sensitive)
  //   2. Double XP Weekend    (already showing as gold banner)
  //   3. Locked-In nudge      (bigger achievement — wins over MR)
  //   4. Morning Routine nudge
  let morningNudgeDismissedDate  = null;
  let lockedInNudgeDismissedDate = null;

  function _highPriorityBannerShowing() {
    if (currentTab !== 'habits') return true; // suppress on other tabs
    const sd = document.getElementById('streak-danger');
    const dx = document.getElementById('double-xp-banner');
    if (sd && !sd.classList.contains('hidden')) return true;
    if (dx && !dx.classList.contains('hidden')) return true;
    return false;
  }

  function _isBrandNew() {
    return Object.keys(completions || {}).length === 0;
  }

  function shouldShowLockedInNudge() {
    if (_highPriorityBannerShowing()) return false;
    if (_isBrandNew()) return false;
    if (lockedInNudgeDismissedDate === today) return false;
    const missing = getMissingPackHabits('locked-in').length;
    return missing === 1 || missing === 2;
  }

  function shouldShowMorningNudge() {
    if (_highPriorityBannerShowing()) return false;
    if (_isBrandNew()) return false;
    if (morningNudgeDismissedDate === today) return false;
    // Locked-In nudge wins when both would apply
    if (shouldShowLockedInNudge()) return false;
    const missing = getMissingMorningHabits().length;
    return missing === 1 || missing === 2;
  }

  function checkLockedInNudge() {
    const el = document.getElementById('lockedin-nudge');
    if (!el) return;

    if (!shouldShowLockedInNudge()) {
      el.classList.add('hidden');
      return;
    }
    const missingDefs = getMissingPackHabits('locked-in');
    const missing     = missingDefs.length;
    const txtEl       = document.getElementById('li-text');

    if (missing === 1) {
      txtEl.innerHTML =
        "You're <b>1 habit away</b> from the Locked-In Bonus — Add <b>" +
        esc(missingDefs[0].name) + "</b>.";
    } else { // missing === 2
      const a = missingDefs[0].name;
      const b = missingDefs[1].name;
      const inlineFits = (a.length + b.length) <= 50;
      txtEl.innerHTML = inlineFits
        ? "You're <b>2 habits away</b> from the Locked-In Bonus — Add <b>" +
          esc(a) + "</b> and <b>" + esc(b) + "</b>."
        : "You're <b>2 habits away</b> from the Locked-In Bonus — Add 2 more.";
    }

    el.classList.remove('hidden');
  }

  function checkMorningRoutineNudge() {
    const el = document.getElementById('morning-nudge');
    if (!el) return;

    // Always evaluate Locked-In first so its visibility state is current
    checkLockedInNudge();

    if (!shouldShowMorningNudge()) {
      el.classList.add('hidden');
      return;
    }

    const missingDefs = getMissingMorningHabits();
    const missing     = missingDefs.length;
    const txtEl       = document.getElementById('mn-text');

    if (missing === 1) {
      txtEl.innerHTML =
        "You're <b>1 habit away</b> from the Compound Effect Bonus — Add <b>" +
        esc(missingDefs[0].name) + "</b> to unlock daily +XP.";
    } else { // missing === 2
      const a = missingDefs[0].name;
      const b = missingDefs[1].name;
      const inlineFits = (a.length + b.length) <= 50;
      txtEl.innerHTML = inlineFits
        ? "You're <b>2 habits away</b> from the Compound Effect Bonus — Add <b>" +
          esc(a) + "</b> and <b>" + esc(b) + "</b> to unlock daily +XP."
        : "You're <b>2 habits away</b> from the Compound Effect Bonus — Add 2 more morning habits to unlock daily +XP.";
    }

    el.classList.remove('hidden');
  }

  // ── HABIT INFO SHEET (History tab — quick read-only view) ────
  let _hiPrevFocus = null;
  let _hiHabitId   = null;
  function openHabitInfoSheet(habit) {
    if (!habit) return;
    const overlay = document.getElementById('hi-overlay');
    const sheet   = document.getElementById('hi-sheet');
    if (!overlay || !sheet) return;

    _hiHabitId = habit.id;

    // Populate header — full display name with duration if applicable
    document.getElementById('hi-name').textContent = habitDisplayName(habit);

    // Difficulty + XP per completion (base value, before weekend doubling)
    const diffKey = habit.difficulty || 'easy';
    const diff    = DIFFICULTY[diffKey] || DIFFICULTY.easy;
    document.getElementById('hi-difficulty').textContent =
      diff.label + ' difficulty • +' + diff.pts + ' XP per completion';

    // Shared stats block (badge + description + 4-cell grid)
    populateHabitInfoBlock('hi', habit);

    // About this habit — canonical description (read-only)
    const aboutEl = document.getElementById('hi-about-text');
    if (aboutEl) {
      const desc = (typeof getHabitDescription === 'function') ? getHabitDescription(habit) : '';
      aboutEl.textContent = desc || 'Description coming soon.';
      aboutEl.classList.toggle('hi-about-text--empty', !desc);
    }

    // Save focus + open
    _hiPrevFocus = document.activeElement;
    overlay.classList.remove('hidden');
    sheet.classList.remove('hidden');
    requestAnimationFrame(() => sheet.classList.add('hi-open'));
    // Move focus to the close button for keyboard users
    setTimeout(() => { document.getElementById('hi-close-btn').focus(); }, 30);
  }

  function closeHabitInfoSheet() {
    const overlay = document.getElementById('hi-overlay');
    const sheet   = document.getElementById('hi-sheet');
    if (!overlay || !sheet) return;
    sheet.classList.remove('hi-open');
    sheet.addEventListener('transitionend', () => {
      sheet.classList.add('hidden');
      overlay.classList.add('hidden');
    }, { once: true });
    if (_hiPrevFocus && typeof _hiPrevFocus.focus === 'function') {
      try { _hiPrevFocus.focus(); } catch (_) {}
    }
    _hiPrevFocus = null;
  }

  function setupHabitInfoSheet() {
    const overlay = document.getElementById('hi-overlay');
    const sheet   = document.getElementById('hi-sheet');
    const closeBtn = document.getElementById('hi-close-btn');
    if (!overlay || !sheet || !closeBtn) return;

    closeBtn.addEventListener('click', closeHabitInfoSheet);
    overlay.addEventListener('click', closeHabitInfoSheet);

    // "View full details" → close this popup and open the View Note sheet
    // 'View full details' button removed — the About text now lives
    // inline in this sheet, so the secondary navigation is unnecessary.
    // The View Note sheet (long-press → View Note) still exists as the
    // separate full-detail surface; users can reach it from there.

    // Reuse the swipe-down-to-dismiss gesture from settings
    if (typeof attachSheetDismissGesture === 'function') {
      attachSheetDismissGesture(sheet, overlay, () => {
        sheet.classList.add('hidden');
        overlay.classList.add('hidden');
        sheet.classList.remove('hi-open');
        if (_hiPrevFocus && typeof _hiPrevFocus.focus === 'function') {
          try { _hiPrevFocus.focus(); } catch (_) {}
        }
        _hiPrevFocus = null;
      }, {
        baseTransform:  'translateX(-50%) ',
        handleSelector: '.hi-drag-handle, .hi-header',
        openClass:      'hi-open',
      });
    }

    // ESC key dismiss
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !sheet.classList.contains('hidden')) {
        closeHabitInfoSheet();
      }
    });

    // Event delegation: any click on a .hg-info-btn opens the info sheet
    // for the corresponding habit. Stops propagation so it doesn't trigger
    // any parent click handler (e.g., card tap).
    document.addEventListener('click', e => {
      const btn = e.target.closest('.hg-info-btn[data-habit-info]');
      if (!btn) return;
      e.stopPropagation();
      e.preventDefault();
      const habitId = btn.getAttribute('data-habit-info');
      const habit   = habits.find(h => h.id === habitId);
      if (habit) openHabitInfoSheet(habit);
    });
  }

  function setupMorningNudge() {
    const el = document.getElementById('morning-nudge');
    const dismissBtn = document.getElementById('morning-nudge-dismiss');
    if (el && dismissBtn) {
      el.addEventListener('click', e => {
        if (e.target === dismissBtn || dismissBtn.contains(e.target)) return;
        openMorningPackModal();
      });
      dismissBtn.addEventListener('click', e => {
        e.stopPropagation();
        morningNudgeDismissedDate = today;
        el.classList.add('hidden');
      });
    }

    // Locked-In nudge — same pattern, separate dismiss state
    const liEl = document.getElementById('lockedin-nudge');
    const liDismissBtn = document.getElementById('lockedin-nudge-dismiss');
    if (liEl && liDismissBtn) {
      liEl.addEventListener('click', e => {
        if (e.target === liDismissBtn || liDismissBtn.contains(e.target)) return;
        openLockedInPackModal();
      });
      liDismissBtn.addEventListener('click', e => {
        e.stopPropagation();
        lockedInNudgeDismissedDate = today;
        liEl.classList.add('hidden');
      });
    }
  }

  // ── FEATURE 4: RANK INFO POPUP ───────────────────────────
  function showRankInfoPopup() {
    const rank      = getRank(totalPoints);
    const rankIdx   = RANKS.findIndex(r => r.id === rank.id);
    const isMax     = rank.next === null;
    const ptsIn     = totalPoints - rank.min;
    const range     = isMax ? 1 : (rank.max - rank.min + 1);
    const pct       = isMax ? 100 : Math.min(100, Math.round((ptsIn / range) * 100));
    const toNext    = isMax ? 0 : rank.next - totalPoints;

    // 7-day XP average
    const sevenDayXP = calcSevenDayXP();
    const dailyAvg   = Math.round(sevenDayXP / 7);

    document.getElementById('rp-badge').textContent    = rank.id;
    document.getElementById('rp-rank-name').textContent = rank.label || rank.id + ' Rank';
    document.getElementById('rp-xp-line').textContent   = totalPoints.toLocaleString() + ' XP total';

    const tonextEl = document.getElementById('rp-tonext');
    if (isMax) {
      tonextEl.textContent = 'MAX RANK reached 👑';
    } else {
      const nextRank = RANKS[rankIdx + 1];
      tonextEl.textContent = toNext.toLocaleString() + ' XP to ' + (nextRank ? nextRank.id : 'next') + ' Rank';
    }

    const avgEl = document.getElementById('rp-avg');
    avgEl.innerHTML = 'Last 7 days: <strong>' + sevenDayXP.toLocaleString() + ' XP</strong> · ~' + dailyAvg + '/day';

    const etaEl = document.getElementById('rp-eta');
    if (!isMax && dailyAvg > 0) {
      const daysLeft = Math.ceil(toNext / dailyAvg);
      etaEl.textContent = 'At this pace: ' + (daysLeft === 1 ? 'rank up tomorrow!' : daysLeft + ' days to next rank');
    } else if (isMax) {
      etaEl.textContent = 'You are the best of the best.';
    } else {
      etaEl.textContent = 'Keep going — every habit counts.';
    }

    // Show popup
    const overlay = document.getElementById('rank-popup-overlay');
    const popup   = document.getElementById('rank-popup');
    overlay.classList.remove('hidden');
    popup.classList.remove('hidden');
    requestAnimationFrame(() => {
      popup.classList.add('rp-open');
      setTimeout(() => {
        document.getElementById('rp-bar-fill').style.width = pct + '%';
      }, 60);
    });
    navigator.vibrate && navigator.vibrate(8);
  }

  function closeRankPopup() {
    const popup   = document.getElementById('rank-popup');
    const overlay = document.getElementById('rank-popup-overlay');
    popup.classList.remove('rp-open');
    popup.addEventListener('transitionend', () => {
      popup.classList.add('hidden');
      overlay.classList.add('hidden');
    }, { once: true });
  }

  function calcSevenDayXP() {
    let total = 0;
    let d = today;
    for (let i = 0; i < 7; i++) {
      const ids = completions[d] || [];
      ids.forEach(id => {
        const h = habits.find(x => x.id === id);
        if (h) total += DIFFICULTY[h.difficulty]?.pts || 0;
      });
      d = prevDay(d);
    }
    return total;
  }

  function setupRankPopup() {
    document.querySelector('.rank-track').addEventListener('click', showRankInfoPopup);
    document.getElementById('rank-popup-close').addEventListener('click', closeRankPopup);
    document.getElementById('rank-popup-overlay').addEventListener('click', closeRankPopup);
  }

  // ── FEATURE 5: PERFECT DAY CELEBRATION ───────────────────
  let pdcRafId = null;

  function triggerPerfectDayCelebration() {
    const overlay = document.getElementById('pdc-overlay');
    const canvas  = document.getElementById('pdc-canvas');
    const xpEl    = document.getElementById('pdc-xp');
    if (!overlay || !canvas) return;

    // Compute today's total XP
    const todayIds = completions[today] || [];
    const todayXP  = todayIds.reduce((sum, id) => {
      const h = habits.find(x => x.id === id);
      return sum + (h ? diffPts(h.difficulty) : 0);
    }, 0);
    xpEl.innerHTML = iconify('+' + todayXP + ' XP earned today ⚡', { size: 16 });

    // Confetti canvas
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext('2d');

    const COLORS = ['#f59e0b', '#fbbf24', '#22c55e', '#a78bfa', '#60a5fa', '#fff'];
    const dots   = Array.from({ length: 60 }, () => ({
      x:     Math.random() * canvas.width,
      y:     -10 - Math.random() * canvas.height * 0.4,
      vx:    (Math.random() - 0.5) * 3,
      vy:    2 + Math.random() * 3,
      r:     2.5 + Math.random() * 3,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      alpha: 1,
    }));

    if (pdcRafId) { cancelAnimationFrame(pdcRafId); pdcRafId = null; }

    function drawPDC() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      dots.forEach(p => {
        p.x += p.vx; p.y += p.vy; p.vy += 0.06; p.alpha -= 0.008;
        if (p.alpha <= 0) return;
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle   = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
      if (dots.some(p => p.alpha > 0)) pdcRafId = requestAnimationFrame(drawPDC);
    }
    pdcRafId = requestAnimationFrame(drawPDC);

    overlay.classList.remove('hidden');
    overlay.classList.add('pdc-active');
    navigator.vibrate && navigator.vibrate([50, 30, 80, 30, 50]);

    // Auto-dismiss after 2.2 s; tap to dismiss early
    const dismiss = () => {
      overlay.classList.remove('pdc-active');
      overlay.classList.add('hidden');
      if (pdcRafId) { cancelAnimationFrame(pdcRafId); pdcRafId = null; }
      overlay.removeEventListener('click', dismiss);
    };
    overlay.addEventListener('click', dismiss);
    setTimeout(dismiss, 2200);
  }

  // toggleHabit(id, li, opts?)
  //   opts.silent     — skip burst UI (chime, particles, flash, XP float).
  //                     Used by HealthKit auto-verify so walking 3,000 steps
  //                     doesn't trigger the same celebration as a manual tap.
  //                     Milestone popups (rank-up, stat-up, compound) still
  //                     fire — those are real moments worth celebrating.
  //   li may be null  — auto-verify can run when the user is on a different
  //                     tab. State mutations + popup queueing happen
  //                     regardless; DOM updates only when li is provided.
  function toggleHabit(id, li, opts) {
    opts = opts || {};
    const silent  = !!opts.silent;
    const wasDone = isChecked(id);
    const oldRank       = wasDone ? null : getRank(totalPoints);
    const oldStatLevels = wasDone ? null : captureStatLevels();

    if (wasDone) {
      uncheck(id);
      if (li) {
        li.classList.remove('completed');
        li.querySelector('.habit-cb').classList.remove('checked');
      }
      // If the user un-checks an auto-verified completion, that un-check
      // is permanent for the day — the auto-verifier must NOT re-check
      // it on later refresh. Recorded per-habit-name (Daily walk, Sleep,
      // Sleep before midnight, future auto-verify habits) under one
      // generic AUTO_VERIFY.markUnchecked() call.
      try {
        if (typeof AUTO_VERIFY !== 'undefined' && AUTO_VERIFY.isAutoVerifiedToday(id)) {
          const h = habits.find(x => x.id === id);
          if (h && isHealthAutoVerifiableHabit(h)) {
            AUTO_VERIFY.markUnchecked(h.name);
          }
          AUTO_VERIFY.clearAutoVerify(id);
        }
      } catch (_) {}
    } else {
      // Cancel today's pending reminder fire — habit just got done, no
      // need to nag. Tomorrow's will be re-scheduled at daily reset.
      try { Notif.onHabitCompleted(id); } catch (_) {}
      // Minimum enforcement for measurable habits
      const habit = habits.find(h => h.id === id);
      if (habit && !meetsMinimum(habit)) {
        // Tappable toast → opens Edit Habit straight to the goal stepper.
        // (Skip in silent mode — auto-verify shouldn't pop a CTA toast.)
        if (!silent) {
          showHabitToast('Set your goal value to check off this habit', {
            cta:   'Set goal',
            onTap: () => openEditModal(habit.id),
          });
        }
        return;
      }
      // Snapshot compound state so we can detect if THIS tap fires the bonus.
      // If it does, the fanfare in showCompoundPopup() replaces the regular chime.
      const compoundBefore = JSON.stringify(compoundAwarded);
      check(id);
      const compoundFiredNow = JSON.stringify(compoundAwarded) !== compoundBefore;

      if (li) {
        li.classList.add('completed');
        const cb = li.querySelector('.habit-cb');
        cb.classList.add('checked');
        const r = document.createElement('span');
        r.className = 'cb-ripple';
        cb.appendChild(r);
        r.addEventListener('animationend', () => r.remove(), { once: true });
      }

      // Feature 1: sound + particles + card flash + floating XP — the
      // per-tap "burst." Suppressed in silent mode (auto-verify) so the
      // experience feels like the system noticed, not like the user tapped.
      // Suppress regular chime if compound fanfare is taking over this moment.
      if (!silent) {
        if (!compoundFiredNow) playCheckSound();
        if (li) {
          const diff = habit ? habit.difficulty : 'medium';
          spawnXpParticles(li, diff);
          const DIFF_FLASH = { easy: 'rgba(167,139,250,0.6)', medium: 'rgba(96,165,250,0.6)', hard: 'rgba(251,146,60,0.6)', legendary: 'rgba(251,191,36,0.65)' };
          li.style.setProperty('--diff-flash-color', DIFF_FLASH[diff] || 'rgba(139,92,246,0.55)');
          li.classList.remove('card-flash-anim');
          void li.offsetWidth;
          li.classList.add('card-flash-anim');
          li.addEventListener('animationend', () => li.classList.remove('card-flash-anim'), { once: true });

          // Floating XP number (always shown; visually distinct on weekends)
          const xpAmt = habit ? diffPts(habit.difficulty) : 0;
          const xpFloat = document.createElement('span');
          xpFloat.className = 'xp-float';
          xpFloat.innerHTML = iconify('⚡+' + xpAmt + ' XP' + (isWeekend() ? ' 2×' : ''), { size: 14 });
          li.appendChild(xpFloat);
          xpFloat.addEventListener('animationend', () => xpFloat.remove(), { once: true });
        }
      }

      // Detect rank up
      const newRank = getRank(totalPoints);
      if (newRank.id !== oldRank.id) {
        levelUpQueue.unshift({ type: 'rank', rank: newRank });
      }

      // Detect stat level-ups — every level triggers a notification
      STATS.forEach(st => {
        const oldLv = oldStatLevels[st.id];
        const newLv = statLevel(stats[st.id]?.pts || 0);
        for (let lv = oldLv + 1; lv <= newLv; lv++) {
          const bonusThr = STAT_BONUS_THRESHOLDS.find(t => t.level === lv);
          levelUpQueue.push({ type: 'stat', stat: st, level: lv, bonusPts: bonusThr ? bonusThr.pts : null });
        }
      });

      // Class change: check on any stat level-up.
      // Route through checkClassChange() so first-time Civilian → class
      // transitions fire the Awakening celebration (and persist the
      // origin story), and multi-stat ties prompt the class-choice screen.
      if (STATS.some(st => statLevel(stats[st.id]?.pts || 0) > (oldStatLevels[st.id] || 0))) {
        checkClassChange(false);
      }

      if (levelUpQueue.length && !levelUpActive) drainLevelUpQueue();
      else if (!levelUpActive && achQueue.length && !achPopupTimer) drainAchQueue();
    }

    if (li) {
      const count = getStreak(id);
      const badge = li.querySelector('.streak-badge');
      badge.className = 'streak-badge' + (count > 0 ? ' active' : '');
      badge.innerHTML = count > 0 ? '<span class="streak-fire">' + streakIconHtml({ size: 14 }) + '</span>' + count : '—';
      if (!wasDone && count > 0) {
        void badge.offsetWidth;
        badge.classList.add('pop');
        badge.addEventListener('animationend', () => badge.classList.remove('pop'), { once: true });
      }
    }

    if (!wasDone) checkCompoundEffect(id);
    renderRank();
    updateProgress();
    checkPerfectDay();
    if (currentTab === 'profile') renderProfile();
  }

  function updateProgress() {
    const todayHabits = habits.filter(isScheduledToday);
    const total = todayHabits.length;
    const done  = todayHabits.filter(h => isChecked(h.id)).length;
    document.getElementById('completed-count').textContent = done;
    document.getElementById('total-count').textContent = total;
    const pct = total === 0 ? 0 : (done / total) * 100;
    document.getElementById('progress-bar').style.width = pct + '%';
    const listEl = document.getElementById('habit-list');
    if (listEl) listEl.classList.toggle('all-complete', total > 0 && done === total);
    updatePerfectStreakDisplay();
    renderCompoundProgress();
  }

  function esc(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── TABS ──────────────────────────────────────────────────
  function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
  }

  function switchTab(tab) {
    currentTab = tab;
    // Exit reorder mode whenever we leave the habits tab
    document.getElementById('habit-list').classList.remove('reorder-mode');
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    const profilePanel = document.getElementById('profile-panel');
    const habitsPanel  = document.getElementById('main-scroll');
    const statsPanel   = document.getElementById('stats-panel');
    const histPanel    = document.getElementById('history-panel');
    const questsPanel  = document.getElementById('quests-panel');
    const itemsPanel   = document.getElementById('items-panel');
    const socialPanel  = document.getElementById('social-panel');
    const footer       = document.getElementById('main-footer');

    profilePanel.classList.toggle('hidden', tab !== 'profile');
    habitsPanel.classList.toggle('hidden',  tab !== 'habits');
    statsPanel.classList.toggle('hidden',   tab !== 'stats');
    histPanel.classList.toggle('hidden',    tab !== 'history');
    questsPanel.classList.toggle('hidden',  tab !== 'quests');
    itemsPanel.classList.toggle('hidden',   tab !== 'items');
    socialPanel.classList.toggle('hidden',  tab !== 'social');
    footer.style.display = tab === 'habits' ? '' : 'none';

    if (tab === 'profile')      renderProfile();
    if (tab === 'stats')        renderStats();
    if (tab === 'history')      renderHistory();
    // Daily Mission card now lives in the Quests tab — render when that
    // tab is opened (and on initial app load via the existing init path).
    if (tab === 'quests')       renderDailyMissionCard();
    checkStreakDanger();
    checkMorningRoutineNudge();
  }

  // ── HABIT LIBRARY ─────────────────────────────────────────
  function setupLibrary() {
    document.getElementById('add-habit-btn').addEventListener('click', openLibrary);
    document.getElementById('lib-close-btn').addEventListener('click', closeLibrary);
    document.getElementById('lib-overlay').addEventListener('click', closeLibrary);

    // Swipe-down-to-dismiss on the Add Habits sheet
    if (typeof attachSheetDismissGesture === 'function') {
      const libSheet   = document.getElementById('lib-sheet');
      const libOverlay = document.getElementById('lib-overlay');
      attachSheetDismissGesture(libSheet, libOverlay, () => {
        libSheet.classList.add('hidden');
        libOverlay.classList.add('hidden');
      }, {
        baseTransform:  'translateX(-50%) ',
        handleSelector: '.lib-drag-handle, .lib-header',
        scrollTarget:   '#lib-list',
      });
    }

    // Standalone pack add buttons removed — pack strips themselves are now
    // the entry point for adding missing pack habits. These guards stay in
    // case the HTML is reintroduced later without causing a crash.
    const mrBtn = document.getElementById('add-morning-btn');
    if (mrBtn) mrBtn.addEventListener('click', openMorningPackModal);
    const liBtn = document.getElementById('add-lockedin-btn');
    if (liBtn) liBtn.addEventListener('click', openLockedInPackModal);
    document.getElementById('mr-cancel-btn').addEventListener('click',  closeMorningPackModal);
    document.getElementById('mr-overlay').addEventListener('click', e => {
      if (e.target.id === 'mr-overlay') closeMorningPackModal();
    });
    document.getElementById('mr-confirm-btn').addEventListener('click', confirmMorningPackAdd);
  }

  // ── MORNING ROUTINE PACK — UI ────────────────────────────────
  function updateMorningButtonVisibility() {
    const btn = document.getElementById('add-morning-btn');
    if (!btn) return;
    btn.classList.toggle('hidden', getMissingMorningHabits().length === 0);
  }
  function updateLockedInButtonVisibility() {
    const btn = document.getElementById('add-lockedin-btn');
    if (!btn) return;
    btn.classList.toggle('hidden', getMissingPackHabits('locked-in').length === 0);
  }

  // Generic pack-confirmation modal opener. Powers both Morning Routine
  // and Locked-In via packId. Re-uses the #mr-overlay DOM, themes per pack.
  let _packModalActiveId = 'morning';

  function openPackConfirmModal(packId) {
    const pack = getPackById(packId);
    if (!pack) return;
    _packModalActiveId = packId;

    const ov     = document.getElementById('mr-overlay');
    const card   = ov && ov.querySelector('.mr-card');
    const list   = document.getElementById('mr-list');
    const count  = document.getElementById('mr-count');
    const btn    = document.getElementById('mr-confirm-btn');
    const iconEl = document.getElementById('mr-icon');
    const titleEl    = document.getElementById('mr-title');
    const subtitleEl = document.getElementById('mr-subtitle');
    if (!ov || !list || !count || !btn) return;

    // Theme (gold for MR, violet for Locked-In)
    if (card) {
      card.classList.remove('mr-card--morning', 'mr-card--lockedin');
      card.classList.add(packId === 'locked-in' ? 'mr-card--lockedin' : 'mr-card--morning');
    }
    // Use the custom pack PNG if we have one for this pack id, else
    // fall back to iconify on the raw pack.emoji.
    if (iconEl) {
      const pkPng = packId === 'morning'   ? packIconHtml('morning',  { size: 44 }) :
                    packId === 'locked-in' ? packIconHtml('lockedin', { size: 44 }) :
                    null;
      iconEl.innerHTML = pkPng || iconify(pack.emoji, { size: 32 });
    }
    if (titleEl)    titleEl.textContent    = 'Add ' + pack.name + '?';
    if (subtitleEl) {
      subtitleEl.textContent = packId === 'locked-in'
        ? '16 habits — the complete discipline cycle.'
        : 'This pack contains 10 habits designed to compound daily.';
    }

    const activeNames = new Set(habits.map(h => h.name));
    const defs        = getPackHabitDefs(packId);
    const missing     = defs.filter(d => !activeNames.has(d.name));

    list.innerHTML = '';
    defs.forEach(def => {
      const have = activeNames.has(def.name);
      const row  = document.createElement('div');
      row.className = 'mr-row' + (have ? ' mr-row--have' : '');
      row.innerHTML =
        '<span class="mr-row-emoji">' + habitIconHtml(def, { size: 20 }) + '</span>' +
        '<span class="mr-row-name">' + esc(def.name) + '</span>' +
        '<span class="mr-row-tag">' + (have ? '✓ Already added' : '+ Will add') + '</span>';
      list.appendChild(row);
    });

    if (missing.length === 0) {
      count.textContent = 'All ' + defs.length + ' habits already in your routine.';
      btn.disabled      = true;
      btn.textContent   = 'All habits already added';
    } else {
      count.textContent = 'Adding ' + missing.length + ' new habit' + (missing.length === 1 ? '' : 's') + ' to your routine';
      btn.disabled      = false;
      btn.textContent   = 'Add ' + missing.length + ' Habit' + (missing.length === 1 ? '' : 's');
    }

    ov.classList.remove('hidden');
  }

  // Backward-compat alias used by existing call sites
  function openMorningPackModal() { openPackConfirmModal('morning'); }
  function openLockedInPackModal() { openPackConfirmModal('locked-in'); }

  // ── CUSTOM HABIT MODAL ─────────────────────────────────────
  // User authors a habit: emoji + name + which stat it builds.
  // Difficulty is FIXED at CUSTOM_HABIT_DIFFICULTY ('medium' / 3 XP) so
  // customs can't game the rank economy. Capped at MAX_CUSTOM_HABITS.
  let _customEmoji   = '⚡';
  let _customStatId  = null;

  function openCustomHabitModal() {
    if (habits.filter(h => h.custom).length >= MAX_CUSTOM_HABITS) return;
    _customEmoji  = '⚡';
    _customStatId = null;
    document.getElementById('custom-emoji-btn').textContent = _customEmoji;
    document.getElementById('custom-name-input').value = '';
    document.getElementById('custom-error').classList.add('hidden');
    renderCustomStatGrid();
    updateCustomSaveBtn();
    document.getElementById('custom-overlay').classList.remove('hidden');
    setTimeout(() => {
      try { document.getElementById('custom-name-input').focus(); } catch (_) {}
    }, 80);
  }

  function closeCustomHabitModal() {
    document.getElementById('custom-overlay').classList.add('hidden');
  }

  function renderCustomStatGrid() {
    const grid = document.getElementById('custom-stat-grid');
    if (!grid) return;
    grid.innerHTML = '';
    STATS.forEach(st => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'custom-stat-btn' + (_customStatId === st.id ? ' selected' : '');
      btn.style.setProperty('--cs-color', st.color);
      btn.style.setProperty('--cs-glow',  colorWithAlpha(st.color, 0.32));
      btn.innerHTML =
        '<span class="custom-stat-icon">' + statIconHtml(st, { size: 22 }) + '</span>' +
        '<span class="custom-stat-name">' + esc(st.label) + '</span>';
      btn.addEventListener('click', () => {
        _customStatId = st.id;
        renderCustomStatGrid();
        updateCustomSaveBtn();
      });
      grid.appendChild(btn);
    });
  }

  function updateCustomSaveBtn() {
    const name = (document.getElementById('custom-name-input').value || '').trim();
    document.getElementById('custom-save-btn').disabled = !(name.length > 0 && _customStatId);
  }

  function saveCustomHabit() {
    const name = (document.getElementById('custom-name-input').value || '').trim();
    const errEl = document.getElementById('custom-error');
    const showErr = (msg) => { errEl.textContent = msg; errEl.classList.remove('hidden'); };

    if (!name)            return showErr('Give your habit a name.');
    if (!_customStatId)   return showErr('Pick the stat this habit trains.');
    if (habits.some(h => h.name.toLowerCase() === name.toLowerCase())) {
      return showErr('You already have a habit with that name.');
    }
    if (habits.filter(h => h.custom).length >= MAX_CUSTOM_HABITS) {
      return showErr('You\'ve reached the ' + MAX_CUSTOM_HABITS + '-custom-habit cap.');
    }

    const newH = {
      id:          uid(),
      emoji:       _customEmoji || '⚡',
      name:        name,
      difficulty:  CUSTOM_HABIT_DIFFICULTY,
      type:        'build',
      primaryStat: _customStatId,
      custom:      true,
    };
    habits.push(newH);
    save();
    renderHabits();
    renderLibrary();
    closeCustomHabitModal();
    // Per-habit reminder offers were removed in v1.1.3 — Awakened sends
    // ONE morning digest by default, no per-habit prompts. Power users
    // can still set per-habit reminders via Edit Habit.
  }

  function setupCustomHabitModal() {
    const overlay = document.getElementById('custom-overlay');
    if (!overlay) return;
    document.getElementById('custom-cancel-btn').addEventListener('click', closeCustomHabitModal);
    document.getElementById('custom-save-btn').addEventListener('click', saveCustomHabit);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeCustomHabitModal();
    });
    document.getElementById('custom-name-input').addEventListener('input', updateCustomSaveBtn);
    document.getElementById('custom-name-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !document.getElementById('custom-save-btn').disabled) {
        e.preventDefault();
        saveCustomHabit();
      }
    });
    document.getElementById('custom-emoji-btn').addEventListener('click', (e) => {
      openEmojiPicker(e.currentTarget, _customEmoji, (em) => {
        _customEmoji = em || '⚡';
        document.getElementById('custom-emoji-btn').textContent = _customEmoji;
      });
    });
  }

  function closeMorningPackModal() {
    document.getElementById('mr-overlay').classList.add('hidden');
  }

  function confirmPackAdd() {
    const packId  = _packModalActiveId;
    const missing = getMissingPackHabits(packId);
    if (missing.length === 0) { closeMorningPackModal(); return; }

    // Add in canonical pack order, preserving each habit's defaults.
    // Dedup: getMissingPackHabits already filtered to absent names.
    // Existing streaks/progress on existing entries remain untouched.
    const _justAdded = [];
    missing.forEach(def => {
      const newH = {
        id:          uid(),
        emoji:       def.emoji,
        name:        def.name,
        difficulty:  def.difficulty,
        type:        def.type || 'build',
        primaryStat: def.primaryStat,
      };
      habits.push(newH);
      _justAdded.push(newH);
      if (def.note) habitNotes[newH.id] = def.note;
    });
    save();

    // Mark the player's path (only on first MR add — Locked-In doesn't override)
    if (packId === 'morning' && !selectedPackId) {
      selectedPackId = 'morning';
      try { localStorage.setItem('hb_path', selectedPackId); } catch (_) {}
    }

    const pack = getPackById(packId);
    closeMorningPackModal();
    closeLibrary();
    renderHabits();
    updateMorningButtonVisibility();
    updateLockedInButtonVisibility();
    updateLockedInButtonVisibility();
    showHabitToast(pack.name + ' added — ' + missing.length + ' habit' + (missing.length === 1 ? '' : 's'));

    // Auto-trigger the notification prompt when a pack is added and the
    // user hasn't been asked yet. Pack-based paths (Morning Routine,
    // Locked-In) are committing to a daily routine — a single morning
    // reminder is the most useful default for them. Fired as a follow-up
    // to the toast (not blocking the pack-add) so the moment feels
    // natural: "you committed → here's what we suggest."
    const isReminderable = (packId === 'morning' || packId === 'locked-in');
    if (isReminderable) {
      try {
        if (Notif && Notif.permAskedBefore && !Notif.permAskedBefore()) {
          setTimeout(() => runOnboardingNotifPrompt(() => {}), 600);
        }
      } catch (_) {}
    }
  }

  // Backward-compat alias for existing wiring
  function confirmMorningPackAdd() { confirmPackAdd(); }

  function openLibrary() {
    renderLibrary();
    document.getElementById('lib-overlay').classList.remove('hidden');
    document.getElementById('lib-sheet').classList.remove('hidden');
  }

  function closeLibrary() {
    document.getElementById('lib-overlay').classList.add('hidden');
    document.getElementById('lib-sheet').classList.add('hidden');
  }

  function renderLibrary() {
    const list = document.getElementById('lib-list');
    list.innerHTML = '';
    const activeNames = new Set(habits.map(h => h.name));

    // Build available-habits map per category
    const catData = OB_CATEGORIES.map(cat => {
      const available = [];
      for (let i = cat.start; i < cat.end; i++) {
        if (!activeNames.has(DEFAULT_HABITS[i].name)) available.push(i);
      }
      return { cat, available };
    }).filter(d => d.available.length > 0);

    // ── Morning Routine pack entry — always shown at the top ──
    // Distinct orange/gold styling marks this as a curated pack
    // (not a regular category) and signals the compound bonus.
    const mrEntry = document.createElement('div');
    mrEntry.className = 'lib-pack-entry';
    const mrMissing = getMissingMorningHabits().length;
    mrEntry.innerHTML =
      '<span class="lib-pack-emoji">' + packIconHtml('morning', { size: 44 }) + '</span>' +
      '<span class="lib-pack-text">' +
        '<span class="lib-pack-title">Morning Routine ' +
          '<span class="lib-pack-bolt" data-bonus-info aria-label="About the Compound Effect Bonus" role="button" tabindex="0">' + xpIconHtml({ size: 14 }) + '</span>' +
        '</span>' +
        '<span class="lib-pack-sub">Complete 10-habit starter pack</span>' +
      '</span>' +
      '<span class="lib-pack-count">' +
        (mrMissing === 0 ? 'All added' : '10 habits') +
      '</span>' +
      '<span class="lib-pack-chevron">›</span>';
    mrEntry.addEventListener('click', openMorningPackModal);

    // ── Locked-In pack entry — sits directly below Morning Routine ──
    // Violet accent distinguishes it from MR's gold; the lock + bolt
    // signal "bigger achievement, second compound bonus."
    const liEntry = document.createElement('div');
    liEntry.className = 'lib-pack-entry lib-pack-entry--lockedin';
    const liMissing = getMissingPackHabits('locked-in').length;
    liEntry.innerHTML =
      '<span class="lib-pack-emoji">' + packIconHtml('lockedin', { size: 44 }) + '</span>' +
      '<span class="lib-pack-text">' +
        '<span class="lib-pack-title">Locked-In ' +
          '<span class="lib-pack-bolt" aria-label="Locked-In Bonus">' + xpIconHtml({ size: 14 }) + '</span>' +
        '</span>' +
        '<span class="lib-pack-sub">Master the full discipline cycle.</span>' +
      '</span>' +
      '<span class="lib-pack-count">' +
        (liMissing === 0 ? 'All added' : '16 habits') +
      '</span>' +
      '<span class="lib-pack-chevron">›</span>';
    liEntry.addEventListener('click', openLockedInPackModal);

    // ── Create your own — purple-accented, dashed border, sits below packs ──
    // Always shown (until cap is reached) so users can author personal habits
    // alongside the curated 49. XP is fixed at Medium so the rank economy
    // can't be gamed.
    const customCount    = habits.filter(h => h.custom).length;
    const customsLeft    = Math.max(0, MAX_CUSTOM_HABITS - customCount);
    const customEntry    = document.createElement('div');
    customEntry.className = 'lib-pack-entry lib-pack-entry--custom';
    customEntry.innerHTML =
      '<span class="lib-pack-emoji">' + packIconHtml('custom', { size: 44 }) + '</span>' +
      '<span class="lib-pack-text">' +
        '<span class="lib-pack-title">Create Your Own</span>' +
        '<span class="lib-pack-sub">' +
          (customsLeft === 0
            ? 'Cap reached (' + MAX_CUSTOM_HABITS + ' custom habits)'
            : 'Your habit, your stat. +3 XP per completion.') +
        '</span>' +
      '</span>' +
      '<span class="lib-pack-count">' +
        (customsLeft === 0 ? 'Full' : customsLeft + ' left') +
      '</span>' +
      '<span class="lib-pack-chevron">›</span>';
    if (customsLeft > 0) {
      customEntry.addEventListener('click', openCustomHabitModal);
    } else {
      customEntry.style.opacity = '0.55';
      customEntry.style.cursor  = 'not-allowed';
    }

    list.appendChild(mrEntry);
    list.appendChild(liEntry);
    list.appendChild(customEntry);

    if (!catData.length) {
      // Pack entry above is shown; the rest of the categories area is empty.
      const empty = document.createElement('p');
      empty.className = 'lib-empty';
      empty.textContent = 'All individual habits are already in your list.';
      list.appendChild(empty);
      return;
    }

    // ── Accordion state ──────────────────────────────────────
    let libOpenIdx = -1; // start with all categories collapsed

    function libSetOpen(idx) {
      list.querySelectorAll('.ob-acc-section').forEach((sec, i) => {
        const body    = sec.querySelector('.ob-acc-body');
        const chevron = sec.querySelector('.ob-acc-chevron');
        const isOpen  = (i === idx);
        sec.classList.toggle('ob-open', isOpen);
        chevron.style.transform = isOpen ? 'rotate(90deg)' : 'rotate(0deg)';
        body.style.maxHeight    = isOpen ? body.scrollHeight + 'px' : '0';
      });
      libOpenIdx = idx;
    }

    catData.forEach(({ cat, available }, catIdx) => {
      const sec = document.createElement('div');
      sec.className = 'ob-acc-section';

      const hdr = document.createElement('div');
      hdr.className = 'ob-acc-header';
      hdr.innerHTML =
        '<span class="ob-acc-label">' + cat.label + '</span>' +
        '<span class="ob-acc-count">' + available.length + ' available</span>' +
        '<span class="ob-acc-chevron">▶</span>';
      hdr.addEventListener('click', () => libSetOpen(libOpenIdx === catIdx ? -1 : catIdx));
      sec.appendChild(hdr);

      const body  = document.createElement('div');
      body.className = 'ob-acc-body';
      body.style.maxHeight = '0';

      const inner = document.createElement('div');
      inner.className = 'ob-acc-inner';

      available.forEach(idx => {
        const h    = DEFAULT_HABITS[idx];
        const card = document.createElement('div');
        card.className = 'lib-card';
        card.innerHTML =
          '<span class="ob-card-emoji">' + habitIconHtml(h, { size: 24 }) + '</span>' +
          '<span class="ob-card-name">' + esc(h.name) + '</span>' +
          '<span class="diff-badge ' + h.difficulty + '">' + DIFFICULTY[h.difficulty].label + '</span>' +
          '<span class="lib-card-add">›</span>';

        card.addEventListener('click', () => openHabitDetail(h, {
          context: 'library',
          onConfirm: cfg => {
            const newH = { id: uid(), emoji: h.emoji, name: h.name, difficulty: cfg.difficulty, type: cfg.type || h.type || 'build' };
            if (cfg.days)                                 newH.days           = cfg.days;
            if (typeof cfg.stepGoal === 'number')         newH.stepGoal       = cfg.stepGoal;
            else if (typeof cfg.sleepGoalHours === 'number') newH.sleepGoalHours = cfg.sleepGoalHours;
            else if (cfg.goal)                            newH.goal           = cfg.goal;
            if (cfg.startDate)                            newH.startDate      = cfg.startDate;
            habits.push(newH);
            // Pre-fill note from DEFAULT_HABITS if present
            if (h.note) habitNotes[newH.id] = h.note;
            save();
            renderHabits();
            renderLibrary();
          },
        }));
        inner.appendChild(card);
      });

      body.appendChild(inner);
      sec.appendChild(body);
      list.appendChild(sec);
    });

    // All categories start collapsed; user expands what they want.
    requestAnimationFrame(() => libSetOpen(-1));
  }

  // ── HABIT DETAIL SCREEN ───────────────────────────────────
  // opts: { context, isSelected, existingConfig, onConfirm, onRemove }
  //   context       'library' (default) | 'onboarding'
  //   isSelected    onboarding only — true if habit already in obSelected
  //   existingConfig previously saved config to pre-populate fields
  //   onConfirm(cfg) called when user taps Add / Update
  //   onRemove()     onboarding only — called when user taps Remove
  function openHabitDetail(h, opts) {
    opts = opts || {};
    const isOnboarding = opts.context === 'onboarding';
    const isSelected   = isOnboarding && (opts.isSelected || false);
    const alreadyAdded = !isOnboarding && habits.some(a => a.name === h.name);
    const measurable   = MEASURABLE_HABITS[h.name] || null;

    // Pre-populate from existing config (re-opening a selected onboarding habit)
    const ec = opts.existingConfig || {};

    // Mutable state for this screen
    let hdType  = ec.type       || h.type || 'build';
    let hdSched = ec.sched      || 'daily';
    let hdDays  = ec.days       ? [...ec.days] : [];
    let hdNdays = ec.ndays      || 3;
    let hdGoal;
    if (ec.goal) {
      hdGoal = ec.goal.value;
    } else if (measurable) {
      if (measurable.bodyweightMin) {
        const bw = parseInt(localStorage.getItem('hb_bodyweight') || '0', 10);
        hdGoal = bw > 0 ? bw : measurable.def;
      } else {
        hdGoal = Math.max(measurable.min, measurable.def);
      }
    } else {
      hdGoal = 0;
    }
    // Step-goal staging — same pattern as hdGoal, mutually exclusive
    // with the time/count stepper for canonical Daily walk.
    const hdIsStepGoal = isStepGoalHabit(h);
    let hdStepGoal;
    if (typeof ec.stepGoal === 'number') hdStepGoal = ec.stepGoal;
    else                                  hdStepGoal = HEALTHKIT_WALK_DEFAULT_THRESHOLD;
    // Sleep-goal staging (canonical "Sleep" only). Mutually exclusive
    // with both the step-goal chips above AND the time/count stepper
    // below — branching is in the render() goal-card section.
    const hdIsSleepGoal = isSleepDurationHabit(h);
    let hdSleepGoal;
    if (typeof ec.sleepGoalHours === 'number') hdSleepGoal = ec.sleepGoalHours;
    else                                        hdSleepGoal = HEALTHKIT_SLEEP_DEFAULT_GOAL_HOURS;
    let hdDiff  = ec.difficulty || h.difficulty;
    let hdStart = ec.startDate  || today;

    function getScheduleDays() {
      if (hdSched === 'daily')    return undefined;
      if (hdSched === 'specific') return hdDays.length ? ALL_DAYS.filter(d => hdDays.includes(d)) : undefined;
      // ndays: evenly distribute across week
      const all = ALL_DAYS, step = 7 / hdNdays, out = [];
      for (let i = 0; i < hdNdays; i++) out.push(all[Math.min(6, Math.round(i * step))]);
      return out;
    }

    function schedLabel() {
      if (hdSched === 'daily') return 'Every Day';
      if (hdSched === 'ndays') return hdNdays + 'x / week';
      if (!hdDays.length)     return 'Pick days…';
      const abbr = ['M','T','W','T','F','S','S'];
      return ALL_DAYS.filter(d => hdDays.includes(d)).map((d, _i) => abbr[ALL_DAYS.indexOf(d)]).join('');
    }

    function render() {
      const content = document.getElementById('hd-content');
      content.innerHTML = '';

      // ── Header ─────────────────────────────────────────────
      const hdr = document.createElement('div');
      hdr.className = 'hd-header';
      hdr.innerHTML =
        '<button class="hd-back-btn" id="hd-back" aria-label="Back">←</button>' +
        '<div class="hd-header-info">' +
          '<span class="hd-header-emoji">' + habitIconHtml(h, { size: 28 }) + '</span>' +
          '<span class="hd-header-name">' + esc(h.name) + '</span>' +
        '</div>';
      content.appendChild(hdr);
      document.getElementById('hd-back').addEventListener('click', closeHabitDetail);

      if (alreadyAdded) {
        const msg = document.createElement('div');
        msg.className = 'hd-already';
        msg.innerHTML = '<span class="hd-already-icon">✓</span><span>Already in your habits list</span>';
        content.appendChild(msg);
        return;
      }

      // ── Scrollable body ────────────────────────────────────
      const body = document.createElement('div');
      body.className = 'hd-body';

      // ── Section 1: Habit Type (read-only) ─────────────────
      const typeCard = hdSection('Habit Type');
      const typeBadge = document.createElement('span');
      typeBadge.className = 'hd-type-badge hd-type-badge--' + hdType;
      typeBadge.textContent = hdType === 'build' ? '⬆ Build' : '⛔ Quit';
      typeCard.appendChild(typeBadge);
      body.appendChild(typeCard);

      // ── Section 2: Schedule ────────────────────────────────
      const schedCard = hdSection('Goal Period');
      const schedOpts = document.createElement('div');
      schedOpts.className = 'hd-sched-opts';

      [['daily','Every Day'],['specific','Specific days'],['ndays','Days per week']].forEach(([id, lbl]) => {
        const row = document.createElement('div');
        row.className = 'hd-sched-opt' + (hdSched === id ? ' hd-sched-opt--active' : '');
        const dot = document.createElement('span');
        dot.className = 'hd-sched-dot';
        const txt = document.createElement('span');
        txt.textContent = lbl;
        row.append(dot, txt);
        row.addEventListener('click', e => {
          e.stopPropagation();
          if (hdSched !== id) { hdSched = id; hdDays = []; render(); }
        });
        schedOpts.appendChild(row);

        // Inline sub-controls for active option
        if (hdSched === id) {
          if (id === 'specific') {
            const daysRow = document.createElement('div');
            daysRow.className = 'hd-days-row';
            ALL_DAYS.forEach((day, di) => {
              const b = document.createElement('button');
              b.className = 'hd-day-btn' + (hdDays.includes(day) ? ' hd-day-btn--on' : '');
              b.textContent = DAY_LABELS[di];
              b.addEventListener('click', e => {
                e.stopPropagation();
                hdDays = hdDays.includes(day) ? hdDays.filter(d => d !== day) : [...hdDays, day];
                // re-render just the day btn states (minor optimisation)
                render();
              });
              daysRow.appendChild(b);
            });
            schedOpts.appendChild(daysRow);
          } else if (id === 'ndays') {
            const stepper = document.createElement('div');
            stepper.className = 'hd-stepper hd-stepper--sub';
            const dec = document.createElement('button');
            dec.className = 'hd-step-btn';
            dec.textContent = '−';
            dec.addEventListener('click', e => { e.stopPropagation(); if (hdNdays > 1) { hdNdays--; render(); } });
            const val = document.createElement('span');
            val.className = 'hd-step-val';
            val.textContent = hdNdays + 'x per week';
            const inc = document.createElement('button');
            inc.className = 'hd-step-btn';
            inc.textContent = '+';
            inc.addEventListener('click', e => { e.stopPropagation(); if (hdNdays < 7) { hdNdays++; render(); } });
            stepper.append(dec, val, inc);
            schedOpts.appendChild(stepper);
          }
        }
      });

      schedCard.appendChild(schedOpts);
      body.appendChild(schedCard);

      // ── Section 3: Goal Value ──────────────────────────────
      // Step-goal habits (canonical Daily walk) get the chip picker
      // here too — matches the post-onboarding Edit Habit modal so
      // there's no jarring difference between the two surfaces.
      if (hdIsStepGoal) {
        const goalCard = hdSection('Goal Value');
        const valueRow = document.createElement('div');
        valueRow.className = 'habit-edit-stepgoal-row';
        const valueLabel = document.createElement('span');
        valueLabel.className = 'habit-edit-stepgoal-label';
        valueLabel.textContent = 'Step goal';
        const valueDisplay = document.createElement('span');
        valueDisplay.className = 'habit-edit-stepgoal-value';
        valueDisplay.textContent = hdStepGoal.toLocaleString() + ' steps';
        valueRow.append(valueLabel, valueDisplay);
        goalCard.appendChild(valueRow);

        const chips = document.createElement('div');
        chips.className = 'habit-edit-stepgoal-chips';
        const chipDefs = HEALTHKIT_WALK_PRESETS.map(n => ({ preset: String(n), label: n.toLocaleString() }))
          .concat([{ preset: 'custom', label: 'Custom' }]);
        chipDefs.forEach(({ preset, label }) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'habit-edit-stepgoal-chip';
          btn.dataset.preset = preset;
          btn.textContent = label;
          chips.appendChild(btn);
        });
        const setActive = () => {
          const isCustom = !HEALTHKIT_WALK_PRESETS.includes(hdStepGoal);
          chips.querySelectorAll('.habit-edit-stepgoal-chip').forEach(chip => {
            const p = chip.dataset.preset;
            const active = (p === 'custom') ? isCustom : (parseInt(p, 10) === hdStepGoal);
            chip.classList.toggle('habit-edit-stepgoal-chip--active', active);
          });
        };
        setActive();

        const customRow = document.createElement('div');
        customRow.className = 'habit-edit-stepgoal-custom hidden';
        const customInput = document.createElement('input');
        customInput.type = 'number';
        customInput.inputMode = 'numeric';
        customInput.min = HEALTHKIT_WALK_THRESHOLD_MIN;
        customInput.max = HEALTHKIT_WALK_THRESHOLD_MAX;
        customInput.placeholder = 'Enter steps (100–50,000)';
        customInput.className = 'habit-edit-stepgoal-input';
        const customSave = document.createElement('button');
        customSave.type = 'button';
        customSave.className = 'habit-edit-stepgoal-save';
        customSave.textContent = 'Save';
        const customCancel = document.createElement('button');
        customCancel.type = 'button';
        customCancel.className = 'habit-edit-stepgoal-cancel';
        customCancel.textContent = 'Cancel';
        customRow.append(customInput, customSave, customCancel);

        chips.addEventListener('click', (e) => {
          const chip = e.target.closest('.habit-edit-stepgoal-chip');
          if (!chip) return;
          const p = chip.dataset.preset;
          if (p === 'custom') {
            customRow.classList.remove('hidden');
            customInput.value = String(hdStepGoal);
            setTimeout(() => customInput.focus(), 50);
            return;
          }
          const n = parseInt(p, 10);
          if (!Number.isFinite(n)) return;
          hdStepGoal = n;
          customRow.classList.add('hidden');
          valueDisplay.textContent = hdStepGoal.toLocaleString() + ' steps';
          setActive();
        });
        const commitCustom = () => {
          const parsed = parseInt(customInput.value, 10);
          const fallback = Number.isFinite(parsed) ? parsed : HEALTHKIT_WALK_DEFAULT_THRESHOLD;
          hdStepGoal = Math.max(HEALTHKIT_WALK_THRESHOLD_MIN, Math.min(HEALTHKIT_WALK_THRESHOLD_MAX, fallback));
          customRow.classList.add('hidden');
          valueDisplay.textContent = hdStepGoal.toLocaleString() + ' steps';
          setActive();
        };
        customSave.addEventListener('click', commitCustom);
        customInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') commitCustom(); });
        customCancel.addEventListener('click', () => { customRow.classList.add('hidden'); });

        goalCard.appendChild(chips);
        goalCard.appendChild(customRow);
        body.appendChild(goalCard);
      } else if (hdIsSleepGoal) {
        // Sleep-goal chips — mirrors the step-goal block above with
        // hours instead of steps. Reuses the same .habit-edit-stepgoal-*
        // CSS classes so the visual treatment matches.
        const goalCard = hdSection('Goal Value');
        const valueRow = document.createElement('div');
        valueRow.className = 'habit-edit-stepgoal-row';
        const valueLabel = document.createElement('span');
        valueLabel.className = 'habit-edit-stepgoal-label';
        valueLabel.textContent = 'Sleep goal';
        const valueDisplay = document.createElement('span');
        valueDisplay.className = 'habit-edit-stepgoal-value';
        const fmtSleep = (n) => n + (n === 1 ? ' hour' : ' hours');
        valueDisplay.textContent = fmtSleep(hdSleepGoal);
        valueRow.append(valueLabel, valueDisplay);
        goalCard.appendChild(valueRow);

        const chips = document.createElement('div');
        chips.className = 'habit-edit-stepgoal-chips';
        const chipDefs = HEALTHKIT_SLEEP_PRESETS.map(n => ({ preset: String(n), label: n + ' hrs' }))
          .concat([{ preset: 'custom', label: 'Custom' }]);
        chipDefs.forEach(({ preset, label }) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'habit-edit-stepgoal-chip';
          btn.dataset.preset = preset;
          btn.textContent = label;
          chips.appendChild(btn);
        });
        const setActive = () => {
          const isCustom = !HEALTHKIT_SLEEP_PRESETS.includes(hdSleepGoal);
          chips.querySelectorAll('.habit-edit-stepgoal-chip').forEach(chip => {
            const p = chip.dataset.preset;
            const active = (p === 'custom') ? isCustom : (parseFloat(p) === hdSleepGoal);
            chip.classList.toggle('habit-edit-stepgoal-chip--active', active);
          });
        };
        setActive();

        const customRow = document.createElement('div');
        customRow.className = 'habit-edit-stepgoal-custom hidden';
        const customInput = document.createElement('input');
        customInput.type = 'number';
        customInput.inputMode = 'decimal';
        customInput.min = HEALTHKIT_SLEEP_GOAL_MIN_HOURS;
        customInput.max = HEALTHKIT_SLEEP_GOAL_MAX_HOURS;
        customInput.step = 0.5;
        customInput.placeholder = 'Enter hours (3–14, 0.5 step)';
        customInput.className = 'habit-edit-stepgoal-input';
        const customSave = document.createElement('button');
        customSave.type = 'button';
        customSave.className = 'habit-edit-stepgoal-save';
        customSave.textContent = 'Save';
        const customCancel = document.createElement('button');
        customCancel.type = 'button';
        customCancel.className = 'habit-edit-stepgoal-cancel';
        customCancel.textContent = 'Cancel';
        customRow.append(customInput, customSave, customCancel);

        chips.addEventListener('click', (e) => {
          const chip = e.target.closest('.habit-edit-stepgoal-chip');
          if (!chip) return;
          const p = chip.dataset.preset;
          if (p === 'custom') {
            customRow.classList.remove('hidden');
            customInput.value = String(hdSleepGoal);
            setTimeout(() => customInput.focus(), 50);
            return;
          }
          const n = parseFloat(p);
          if (!Number.isFinite(n)) return;
          hdSleepGoal = n;
          customRow.classList.add('hidden');
          valueDisplay.textContent = fmtSleep(hdSleepGoal);
          setActive();
        });
        const commitCustom = () => {
          const parsed = parseFloat(customInput.value);
          const fallback = Number.isFinite(parsed) ? parsed : HEALTHKIT_SLEEP_DEFAULT_GOAL_HOURS;
          hdSleepGoal = Math.max(HEALTHKIT_SLEEP_GOAL_MIN_HOURS, Math.min(HEALTHKIT_SLEEP_GOAL_MAX_HOURS, fallback));
          customRow.classList.add('hidden');
          valueDisplay.textContent = fmtSleep(hdSleepGoal);
          setActive();
        };
        customSave.addEventListener('click', commitCustom);
        customInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') commitCustom(); });
        customCancel.addEventListener('click', () => { customRow.classList.add('hidden'); });

        goalCard.appendChild(chips);
        goalCard.appendChild(customRow);
        body.appendChild(goalCard);
      } else if (measurable) {
        const goalCard = hdSection('Goal Value');

        // Special bodyweight input for Protein goal
        if (measurable.bodyweightMin) {
          const bwWrap = document.createElement('div');
          bwWrap.className = 'hd-bw-wrap';
          const bwLabel = document.createElement('label');
          bwLabel.className = 'hd-bw-label';
          bwLabel.textContent = 'Your bodyweight (lbs)';
          const bwInput = document.createElement('input');
          bwInput.type = 'number';
          bwInput.className = 'hd-bw-input';
          bwInput.placeholder = 'Enter your bodyweight in lbs';
          bwInput.min = 50; bwInput.max = 500; bwInput.step = 1;
          const savedBW = localStorage.getItem('hb_bodyweight');
          if (savedBW) bwInput.value = savedBW;
          bwInput.addEventListener('input', () => {
            const bw = parseInt(bwInput.value, 10);
            if (bw > 0) {
              localStorage.setItem('hb_bodyweight', String(bw));
              if (hdGoal < bw) { hdGoal = bw; render(); }
            }
          });
          bwWrap.append(bwLabel, bwInput);
          goalCard.appendChild(bwWrap);
        }

        const stepper = document.createElement('div');
        stepper.className = 'hd-stepper';
        const dec = document.createElement('button');
        dec.className = 'hd-step-btn';
        dec.textContent = '−';
        dec.addEventListener('click', () => {
          const floor = measurable.bodyweightMin
            ? Math.max(measurable.step, parseInt(localStorage.getItem('hb_bodyweight') || '0', 10))
            : measurable.min;
          if (hdGoal - measurable.step >= Math.max(measurable.step, floor)) {
            hdGoal -= measurable.step; render();
          }
        });
        const val = document.createElement('span');
        val.className = 'hd-step-val';
        val.textContent = hdGoal.toLocaleString() + ' ' + measurable.unit + ' / day';
        const inc = document.createElement('button');
        inc.className = 'hd-step-btn';
        inc.textContent = '+';
        inc.addEventListener('click', () => { hdGoal += measurable.step; render(); });
        stepper.append(dec, val, inc);
        goalCard.appendChild(stepper);
        body.appendChild(goalCard);
      }

      // ── Section 4: Difficulty (read-only) ─────────────────
      const diffCard = hdSection('Difficulty');
      const diffRow  = document.createElement('div');
      diffRow.className = 'hd-diff-row';
      const badge = document.createElement('span');
      badge.className = 'diff-badge ' + hdDiff;
      badge.textContent = DIFFICULTY[hdDiff].label;
      const xpNote = document.createElement('div');
      xpNote.className = 'hd-xp-note';
      xpNote.innerHTML = iconify('⚡ +' + DIFFICULTY[hdDiff].pts + ' XP per completion', { size: 14 });
      diffRow.appendChild(badge);
      diffCard.append(diffRow, xpNote);
      body.appendChild(diffCard);

      // ── Section 5: Start Date ──────────────────────────────
      const dateCard = hdSection('Start Date');
      const dateInput = document.createElement('input');
      dateInput.type = 'date';
      dateInput.className = 'hd-date-input';
      dateInput.value = hdStart;
      dateInput.addEventListener('change', () => { hdStart = dateInput.value || today; });
      dateCard.appendChild(dateInput);
      body.appendChild(dateCard);

      content.appendChild(body);

      // ── Footer: Add / Update button ───────────────────────
      const footer = document.createElement('div');
      footer.className = 'hd-footer';
      const addBtn = document.createElement('button');
      addBtn.className = 'hd-add-btn';
      addBtn.textContent = (isOnboarding || !isSelected) ? 'Add to My Habits' : 'Update Habit';
      addBtn.addEventListener('click', () => {
        const days = getScheduleDays();
        const cfg  = {
          type:       hdType,
          sched:      hdSched,
          ndays:      hdNdays,
          difficulty: hdDiff,
          days:       days || undefined,
          // Goal — mutually exclusive between three branches:
          //   step-goal habits carry stepGoal (Daily walk)
          //   sleep-goal habits carry sleepGoalHours (Sleep)
          //   measurable habits carry the legacy goal{value,unit} shape
          goal:           (!hdIsStepGoal && !hdIsSleepGoal && measurable) ? { value: hdGoal, unit: measurable.unit } : undefined,
          stepGoal:       hdIsStepGoal  ? hdStepGoal  : undefined,
          sleepGoalHours: hdIsSleepGoal ? hdSleepGoal : undefined,
          startDate:  hdStart !== today ? hdStart : undefined,
        };
        if (opts.onConfirm) {
          opts.onConfirm(cfg);
        } else {
          // Default (library) behaviour
          const newH = { id: uid(), emoji: h.emoji, name: h.name, difficulty: hdDiff, type: hdType };
          if (days)              newH.days           = days;
          if (hdIsStepGoal)      newH.stepGoal       = hdStepGoal;
          else if (hdIsSleepGoal) newH.sleepGoalHours = hdSleepGoal;
          else if (measurable)   newH.goal           = { value: hdGoal, unit: measurable.unit };
          if (hdStart !== today) newH.startDate      = hdStart;
          habits.push(newH);
          save();
          renderHabits();
          renderLibrary();
        }
        closeHabitDetail();
      });
      footer.appendChild(addBtn);

      // Remove button — shown when re-configuring an already-selected onboarding habit
      if (isSelected && opts.onRemove) {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'hd-remove-btn';
        removeBtn.textContent = 'Remove from list';
        removeBtn.addEventListener('click', () => {
          opts.onRemove();
          closeHabitDetail();
        });
        footer.appendChild(removeBtn);
      }

      content.appendChild(footer);
    }

    render();
    document.getElementById('hd-sheet').classList.remove('hidden');
  }

  function closeHabitDetail() {
    document.getElementById('hd-sheet').classList.add('hidden');
    document.getElementById('hd-content').innerHTML = '';
  }

  function setupHabitDetailGesture() {
    if (typeof attachSheetDismissGesture !== 'function') return;
    const sheet = document.getElementById('hd-sheet');
    if (!sheet) return;
    attachSheetDismissGesture(sheet, null, closeHabitDetail, {
      baseTransform:  'translateX(-50%) ',
      handleSelector: '.hd-drag-handle',
      scrollTarget:   '#hd-content',
    });
  }

  // Creates a labelled section card for the detail screen
  function hdSection(label) {
    const sec = document.createElement('div');
    sec.className = 'hd-section';
    const lbl = document.createElement('div');
    lbl.className = 'hd-section-label';
    lbl.textContent = label;
    sec.appendChild(lbl);
    return sec;
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ── DIFFICULTY SELECTOR HELPER ────────────────────────────
  function setActiveDiff(rowId, diff) {
    document.getElementById(rowId).querySelectorAll('.diff-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.diff === diff);
    });
  }

  function setActiveDays(rowId, days) {
    document.getElementById(rowId).querySelectorAll('.day-btn').forEach(b => {
      b.classList.toggle('active', days.includes(b.dataset.day));
    });
  }

  // ── LONG PRESS ────────────────────────────────────────────
  function bindLongPress(el, id) {
    let timer = null, moved = false, sx, sy;

    el.addEventListener('touchstart', e => {
      if (e.target.closest('[data-drag]')) return;
      moved = false; sx = e.touches[0].clientX; sy = e.touches[0].clientY;
      el.classList.add('pressing');
      timer = setTimeout(() => {
        if (!moved) {
          navigator.vibrate && navigator.vibrate(32);
          document.getElementById('habit-list').classList.add('reorder-mode');
          showCtxMenu(id, el);
        }
      }, 480);
    }, { passive: true });

    el.addEventListener('touchmove', e => {
      if (Math.hypot(e.touches[0].clientX - sx, e.touches[0].clientY - sy) > 8) {
        moved = true; clearTimeout(timer); el.classList.remove('pressing');
      }
    }, { passive: true });

    el.addEventListener('touchend',   () => { clearTimeout(timer); el.classList.remove('pressing'); });
    el.addEventListener('touchcancel',() => { clearTimeout(timer); el.classList.remove('pressing'); });
    el.addEventListener('contextmenu', e => { e.preventDefault(); showCtxMenu(id, el); });
  }

  // ── SCHEDULE PICKER ──────────────────────────────────────
  const SCHED_PRESETS = {
    daily:    [...ALL_DAYS],
    weekdays: ['Mon','Tue','Wed','Thu','Fri'],
    weekends: ['Fri','Sat','Sun'],
    '3x':     ['Mon','Wed','Fri'],
  };

  function openSchedulePicker(id) {
    schedHabitId = id;
    const habit = habits.find(h => h.id === id);
    schedFormDays = habit?.days ? [...habit.days] : [...ALL_DAYS];
    setActiveDays('sched-days-row', schedFormDays);
    syncSchedPresets();
    refreshSchedReminderUI();
    document.getElementById('sched-overlay').classList.remove('hidden');
    document.getElementById('sched-sheet').classList.remove('hidden');
  }

  // Sync the Reminder row in the Schedule sheet to the habit's current
  // per-habit reminder state. Called on open + after change/clear.
  function refreshSchedReminderUI() {
    const btn   = document.getElementById('sched-reminder-btn');
    const clear = document.getElementById('sched-reminder-clear');
    if (!btn || !clear || !schedHabitId) return;
    let time = null;
    try { time = (Notif.reminderFor && Notif.reminderFor(schedHabitId)) || null; } catch (_) {}
    if (time) {
      const [hStr, mStr] = time.split(':');
      const h  = parseInt(hStr, 10) || 0;
      const m  = parseInt(mStr, 10) || 0;
      const pm = h >= 12;
      const h12 = ((h % 12) || 12);
      const label = h12 + ':' + String(m).padStart(2, '0') + ' ' + (pm ? 'PM' : 'AM');
      btn.textContent  = '⏰ ' + label;
      btn.classList.add('sched-reminder-btn--set');
      clear.classList.remove('hidden');
    } else {
      btn.textContent  = '+ Add reminder';
      btn.classList.remove('sched-reminder-btn--set');
      clear.classList.add('hidden');
    }
  }

  function closeSchedulePicker() {
    document.getElementById('sched-overlay').classList.add('hidden');
    document.getElementById('sched-sheet').classList.add('hidden');
    schedHabitId = null;
  }

  function syncSchedPresets() {
    document.querySelectorAll('.sched-preset').forEach(btn => {
      const preset = SCHED_PRESETS[btn.dataset.preset];
      const match  = preset.length === schedFormDays.length && preset.every(d => schedFormDays.includes(d));
      btn.classList.toggle('active', match);
    });
  }

  function setupSchedulePicker() {
    document.getElementById('sched-overlay').addEventListener('click', closeSchedulePicker);
    document.getElementById('sched-cancel-btn').addEventListener('click', closeSchedulePicker);

    // Swipe-down-to-dismiss
    if (typeof attachSheetDismissGesture === 'function') {
      const ss = document.getElementById('sched-sheet');
      const so = document.getElementById('sched-overlay');
      attachSheetDismissGesture(ss, so, closeSchedulePicker, {
        baseTransform:  'translateX(-50%) ',
        handleSelector: '.sched-drag-handle, .sched-header',
      });
    }

    document.getElementById('sched-save-btn').addEventListener('click', () => {
      const habit = habits.find(h => h.id === schedHabitId);
      if (habit) {
        if (schedFormDays.length === 7) delete habit.days;
        else habit.days = [...schedFormDays];
        save();
        renderHabits();
      }
      closeSchedulePicker();
    });

    document.getElementById('sched-days-row').querySelectorAll('.day-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.classList.toggle('active');
        schedFormDays = [...document.getElementById('sched-days-row').querySelectorAll('.day-btn.active')].map(b => b.dataset.day);
        if (schedFormDays.length === 0) { btn.classList.add('active'); schedFormDays = [btn.dataset.day]; }
        syncSchedPresets();
      });
    });

    document.querySelectorAll('.sched-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        schedFormDays = [...SCHED_PRESETS[btn.dataset.preset]];
        setActiveDays('sched-days-row', schedFormDays);
        syncSchedPresets();
      });
    });

    // Per-habit reminder controls. The button opens the same custom
    // hour + 15-min minute picker used by Settings. The Remove button
    // clears the reminder and is hidden when none is set.
    const remBtn   = document.getElementById('sched-reminder-btn');
    const remClear = document.getElementById('sched-reminder-clear');
    if (remBtn) {
      remBtn.addEventListener('click', () => {
        if (!schedHabitId) return;
        const habit = habits.find(h => h.id === schedHabitId);
        const current = (Notif.reminderFor && Notif.reminderFor(schedHabitId))
          || (typeof defaultReminderTimeFor === 'function' ? defaultReminderTimeFor(habit) : '07:00');
        openDigestTimePickerModal(current, async (newT) => {
          try { await Notif.setReminder(schedHabitId, newT); } catch (_) {}
          refreshSchedReminderUI();
          if (typeof refreshRemindersPanel === 'function') refreshRemindersPanel();
        });
      });
    }
    if (remClear) {
      remClear.addEventListener('click', async () => {
        if (!schedHabitId) return;
        try { await Notif.clearReminder(schedHabitId); } catch (_) {}
        refreshSchedReminderUI();
        if (typeof refreshRemindersPanel === 'function') refreshRemindersPanel();
      });
    }
  }

  // ── CONTEXT MENU ─────────────────────────────────────────
  function showCtxMenu(id, el) {
    ctxHabitId = id;
    const menu = document.getElementById('ctx-menu');
    const overlay = document.getElementById('ctx-overlay');
    // View Note is now the full habit detail sheet (stats + editable note),
    // so always show it regardless of whether a note has been written yet.
    const ctxNoteBtn = document.getElementById('ctx-note');
    ctxNoteBtn.classList.remove('hidden');
    document.getElementById('ctx-note-label').textContent = 'View Note';
    menu.classList.remove('hidden');
    overlay.classList.remove('hidden');
    const rect = el.getBoundingClientRect();
    const mw = 210;
    let left = rect.right - mw, top = rect.bottom + 6;
    if (left < 8) left = 8;
    if (top + 160 > window.innerHeight - 20) top = rect.top - 166;
    menu.style.left = Math.max(8, left) + 'px';
    menu.style.top  = Math.max(8, top)  + 'px';
  }

  function hideCtxMenu() {
    document.getElementById('ctx-menu').classList.add('hidden');
    document.getElementById('ctx-overlay').classList.add('hidden');
    ctxHabitId = null;
  }

  function setupCtxMenu() {
    document.getElementById('ctx-overlay').addEventListener('click', hideCtxMenu);
    document.getElementById('ctx-overlay').addEventListener('touchstart', hideCtxMenu, { passive: true });
    document.getElementById('ctx-edit').addEventListener('click', () => { const id = ctxHabitId; hideCtxMenu(); openEditModal(id); });
    document.getElementById('ctx-note').addEventListener('click', () => { const id = ctxHabitId; hideCtxMenu(); openNoteModal(id); });
    document.getElementById('ctx-schedule').addEventListener('click', () => { const id = ctxHabitId; hideCtxMenu(); openSchedulePicker(id); });
    document.getElementById('ctx-delete').addEventListener('click', () => { const id = ctxHabitId; hideCtxMenu(); deleteHabit(id); });
  }

  // ── COMPOUND EFFECT BONUS ─────────────────────────────────
  let compoundPopupTimer = null;

  function getCompoundXP(streak) {
    if (streak >= 366) return 75;
    if (streak >= 181) return 50;
    if (streak >= 91)  return 30;
    if (streak >= 31)  return 20;
    if (streak >= 8)   return 10;
    return 5; // days 1-7
  }

  function getCompoundMotivation(streak) {
    if (streak >= 366) return 'You are the Compound Effect personified.';
    if (streak === 365) return 'One full year. You have fully awakened.';
    if (streak === 180) return 'Six months. You are not the same person who started.';
    if (streak === 90)  return 'Ninety days. Science says this change is now permanent.';
    if (streak === 30)  return 'Thirty days. This is no longer a habit. This is your identity.';
    if (streak === 14)  return 'Two weeks strong. This is becoming who you are.';
    if (streak === 7)   return 'One week of excellence. Your brain is rewiring.';
    return 'The compound effect has begun.';
  }

  function getPackHabitNames(packId) {
    const pack = PACKS.find(p => p.id === packId);
    if (!pack || !pack.habits || !pack.habits.length) return [];
    return pack.habits.map(i => DEFAULT_HABITS[i].name);
  }

  function getPackProgress(packId) {
    const names = getPackHabitNames(packId);
    const owned = names.filter(n => {
      const h = habits.find(hh => hh.name === n);
      return h && isScheduledToday(h);
    });
    const done = owned.filter(n => {
      const h = habits.find(hh => hh.name === n);
      return h && isChecked(h.id);
    });
    return { done: done.length, total: owned.length };
  }

  function getHabitCompoundPackIds(habitName) {
    return BONUS_PACK_IDS.filter(pid =>
      getPackHabitNames(pid).includes(habitName)
    );
  }

  // Backward-compat wrapper used elsewhere (nudge logic, etc.)
  function userHasAllCanonicalMorning() {
    return userHasAllPackHabits('morning');
  }

  // Bonus-popup queue — guarantees Locked-In's modal never overlaps the
  // Compound Effect modal. Items are { packId, newStreak, finalXP, doubled }.
  let _bonusPopupQueue  = [];
  let _bonusPopupActive = false;

  function checkCompoundEffect(habitId) {
    const habit = habits.find(h => h.id === habitId);
    if (!habit) return;
    // Walk every bonus-eligible pack in fire-order. Each is independently
    // gated by composition + completion. Packs both can fire on the same
    // tick — the modal queue sequences their celebration popups.
    BONUS_PACK_IDS.forEach(packId => {
      if (!isHabitInPack(habit, packId)) return;
      if (compoundAwarded[packId] === today) return;
      if (!userHasAllPackHabits(packId)) return;
      const { done, total } = getPackProgress(packId);
      if (total === 0 || done < total) return;
      awardCompoundEffect(packId);
    });
  }

  function awardCompoundEffect(packId) {
    const cs        = compoundStreaks[packId] || { streak: 0, lastDate: null };
    const yesterday = prevDay(today);
    const newStreak = cs.lastDate === yesterday ? cs.streak + 1 : 1;

    compoundStreaks[packId]  = { streak: newStreak, lastDate: today };
    compoundAwarded[packId]  = today;

    const baseXP  = getCompoundXP(newStreak);
    const finalXP = isWeekend() ? baseXP * 2 : baseXP;
    totalPoints  += finalXP;

    save();
    renderRank();
    if (currentTab === 'profile') renderProfile();
    renderCompoundProgress();

    // ── Streak Shield: earn one for every 14-day milestone (max 3) ────
    tryEarnShield(packId, newStreak);

    // ── Personal Records hooks for pack streaks + lifetime XP ─────
    prUpdate('total_xp_lifetime', getPR('total_xp_lifetime').value + finalXP);
    if (packId === 'morning')   prUpdate('longest_mr_streak', newStreak);
    if (packId === 'locked-in') prUpdate('longest_li_streak', newStreak);

    // Queue instead of show-now so multiple packs sequence cleanly.
    _bonusPopupQueue.push({
      packId,
      newStreak,
      finalXP,
      doubled: isWeekend() && finalXP !== baseXP,
    });
    drainBonusPopupQueue();
  }

  function drainBonusPopupQueue() {
    if (_bonusPopupActive || !_bonusPopupQueue.length) return;
    const item = _bonusPopupQueue.shift();
    _bonusPopupActive = true;
    showCompoundPopup(item.packId, item.newStreak, item.finalXP, item.doubled);
  }

  function showCompoundPopup(packId, streak, xp, doubled) {
    const pack = getPackById(packId);
    if (!pack) { _bonusPopupActive = false; return; }
    const isLockedIn = packId === 'locked-in';

    // Pack-specific copy
    const labelEl = document.getElementById('cp-label');
    if (labelEl) labelEl.innerHTML = iconify(pack.bonusLabel || '⚡ COMPOUND EFFECT BONUS', { size: 22 });
    document.getElementById('cp-pack-msg').textContent =
      isLockedIn
        ? 'All 16 habits complete. You owned the day.'
        : 'All ' + pack.name + ' habits complete!';
    document.getElementById('cp-xp').textContent     = '+' + xp + ' XP' + (doubled ? ' 2×' : '');
    document.getElementById('cp-streak').innerHTML = streakify('Day ' + streak + ' in a row 🔥', 18);
    document.getElementById('cp-motivation').textContent = getCompoundMotivation(streak);

    const el = document.getElementById('compound-popup');
    // Theme the popup per pack (gold for MR, violet for Locked-In).
    el.classList.remove('cp--morning', 'cp--lockedin');
    el.classList.add(isLockedIn ? 'cp--lockedin' : 'cp--morning');

    el.classList.remove('hidden', 'cp-hide');
    void el.offsetWidth; // force reflow so animation replays
    el.classList.add('cp-show');
    // Pack-specific fanfare. Locked-In gets an extended flourish
    // because it's the bigger achievement.
    if (isLockedIn && typeof playFanfareLockedIn === 'function') {
      playFanfareLockedIn();
    } else {
      playFanfare();
    }
    if (compoundPopupTimer) clearTimeout(compoundPopupTimer);
    compoundPopupTimer = setTimeout(hideCompoundPopup, 3000);
  }

  function hideCompoundPopup() {
    const el = document.getElementById('compound-popup');
    el.classList.remove('cp-show');
    el.classList.add('cp-hide');
    el.addEventListener('animationend', () => {
      el.classList.remove('cp-hide');
      el.classList.add('hidden');
      // Now drain any queued bonuses (e.g., Locked-In after MR).
      _bonusPopupActive = false;
      // Small delay for breathing room between celebrations
      setTimeout(drainBonusPopupQueue, 320);
    }, { once: true });
    if (compoundPopupTimer) { clearTimeout(compoundPopupTimer); compoundPopupTimer = null; }
  }

  function setupCompoundPopup() {
    document.getElementById('compound-popup').addEventListener('click', hideCompoundPopup);
    // Delegated tap on a pack progress row → opens the Add Pack modal
    // for the matching pack so users can fill in the missing habits.
    // The ⚡ bolt and 🌙/🛡️ chips inside the row stop propagation via
    // their own handlers, so chip-tap doesn't trigger this row click.
    document.addEventListener('click', e => {
      const t = e.target;
      if (!t || !t.closest) return;
      // Honest Day chip
      const honest = t.closest('[data-honest-pack]');
      if (honest) {
        e.preventDefault();
        e.stopPropagation();
        openHonestDayModal(honest.getAttribute('data-honest-pack'));
        return;
      }
      // Shield info chip
      const shield = t.closest('[data-shield-info]');
      if (shield) {
        e.preventDefault();
        e.stopPropagation();
        openShieldInfoModal();
        return;
      }
      // Skip if the bolt was tapped (its handler runs first)
      if (t.closest('[data-bonus-info]')) return;
      const row = t.closest('[data-pack-add]');
      if (!row) return;
      e.preventDefault();
      e.stopPropagation();
      const packId = row.getAttribute('data-pack-add');
      if (packId === 'morning')   openMorningPackModal();
      else if (packId === 'locked-in') openLockedInPackModal();
    });
  }

  // ── ORIGIN STORY popup — renders both chapters ──────────
  function openOriginStorySheet() {
    if (!originBeginning || !originBeginning.text) return;
    const ov    = document.getElementById('origin-overlay');
    const sheet = document.getElementById('origin-sheet');
    if (!ov || !sheet) return;

    // ── Chapter 1: The Beginning ─────────────────────────
    const ch1Label = document.getElementById('origin-ch1-label');
    const ch1Text  = document.getElementById('origin-ch1-text');
    if (ch1Label) ch1Label.textContent = '📜 THE BEGINNING · ' + _shortDate(originBeginning.dateISO);
    if (ch1Text)  ch1Text.textContent  = originBeginning.text;

    // ── Chapter 2: The Awakening (or teaser) ─────────────
    const haveCh2  = !!(originAwakening && originAwakening.text);
    const ch2Label = document.getElementById('origin-ch2-label');
    const ch2Text  = document.getElementById('origin-ch2-text');
    const ch2Since = document.getElementById('origin-since');
    const ch2Badge = document.getElementById('origin-class-badge');
    const ch2Teaser= document.getElementById('origin-ch2-teaser');
    const divider  = document.getElementById('origin-divider');

    if (haveCh2) {
      const cls = CLASSES[originAwakening.classKey] || CLASSES.SAGE;
      if (ch2Label) ch2Label.textContent = '⚔️ THE AWAKENING · ' + _shortDate(originAwakening.dateISO);
      if (ch2Badge) {
        ch2Badge.style.color       = cls.color;
        ch2Badge.style.borderColor = cls.color + '60';
        ch2Badge.style.background  = cls.color + '14';
        // Class emblem + name — Chapter 2 badge in the Origin sheet.
        const _ch2Key = (originAwakening && originAwakening.classKey) || null;
        ch2Badge.innerHTML = classIconHtml(_ch2Key, { size: 18 }) + '<span>' + esc(cls.name) + '</span>';
        ch2Badge.classList.remove('hidden');
      }
      if (ch2Text)  { ch2Text.textContent  = originAwakening.text; ch2Text.classList.remove('hidden'); }
      if (ch2Since) { ch2Since.textContent = cls.name + ' since ' + originAwakening.dateDisplay; ch2Since.classList.remove('hidden'); }
      if (ch2Teaser) ch2Teaser.classList.add('hidden');
      if (divider)   divider.classList.remove('hidden');
      sheet.style.setProperty('--origin-accent', cls.color);
    } else {
      // Civilian — show Chapter 2 placeholder + teaser
      if (ch2Label && ch2Label.textContent !== '⚔️ THE AWAKENING') ch2Label.textContent = '⚔️ THE AWAKENING';
      if (ch2Badge) ch2Badge.classList.add('hidden');
      if (ch2Text)  ch2Text.classList.add('hidden');
      if (ch2Since) ch2Since.classList.add('hidden');
      if (ch2Teaser) ch2Teaser.classList.remove('hidden');
      if (divider)   divider.classList.remove('hidden');
      sheet.style.setProperty('--origin-accent', '#8b5cf6');
    }

    ov.classList.remove('hidden');
    sheet.classList.remove('hidden');
  }
  function closeOriginStorySheet() {
    document.getElementById('origin-overlay').classList.add('hidden');
    document.getElementById('origin-sheet').classList.add('hidden');
  }
  function shareOriginStory() {
    if (!originBeginning || !originBeginning.text) return;
    let text = '📜 My Origin:\n\n' + originBeginning.text;
    if (originAwakening && originAwakening.text) {
      text += '\n\n⚔️\n\n' + originAwakening.text;
    }
    text += '\n\n— Awakened: Habit RPG';
    if (navigator.share) {
      navigator.share({ text }).catch(() => {});
      return;
    }
    try {
      navigator.clipboard.writeText(text).then(() => {
        if (typeof showHabitToast === 'function') showHabitToast('Copied to clipboard');
      });
    } catch (_) {
      if (typeof showHabitToast === 'function') showHabitToast('Sharing not supported on this device');
    }
  }
  function setupOriginStorySheet() {
    const ov    = document.getElementById('origin-overlay');
    const sheet = document.getElementById('origin-sheet');
    const close = document.getElementById('origin-close');
    const share = document.getElementById('origin-share');
    if (!ov || !sheet) return;
    if (close) close.addEventListener('click', closeOriginStorySheet);
    if (ov)    ov.addEventListener('click', closeOriginStorySheet);
    if (share) share.addEventListener('click', shareOriginStory);
    // Delegated click — Status tab "Your Origin" button
    document.addEventListener('click', e => {
      const t = e.target;
      if (!t || !t.closest) return;
      const btn = t.closest('#sc-origin-btn');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      openOriginStorySheet();
    });
    // Swipe-down dismiss
    if (typeof attachSheetDismissGesture === 'function') {
      attachSheetDismissGesture(sheet, ov, () => {
        sheet.classList.add('hidden');
        ov.classList.add('hidden');
      }, {
        baseTransform:  'translateX(-50%) ',
        handleSelector: '.origin-drag-handle, .origin-header',
        scrollTarget:   '.origin-body',
      });
    }
    // ESC dismiss
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !sheet.classList.contains('hidden')) closeOriginStorySheet();
    });
  }

  // ── HONEST DAY modal ─────────────────────────────────────
  let _honestPackPending = null;
  function openHonestDayModal(packId) {
    if (!canMarkHonestDayToday(packId)) return;
    _honestPackPending = packId;
    const pack = getPackById(packId);
    const packName = pack ? pack.name : packId;
    const remainingThisMonth = 1 - getHonestDayUsesThisMonth(packId); // always 1 when canMark is true
    document.getElementById('hm-body').innerHTML =
      "You'll skip <b>" + esc(packName) + "</b> today without breaking your streak. " +
      "Honest about what happened. <b>" + remainingThisMonth + "</b> use" +
      (remainingThisMonth === 1 ? '' : 's') + " left this month.";
    document.getElementById('honest-overlay').classList.remove('hidden');
    document.getElementById('honest-modal').classList.remove('hidden');
  }
  function closeHonestDayModal() {
    document.getElementById('honest-overlay').classList.add('hidden');
    document.getElementById('honest-modal').classList.add('hidden');
    _honestPackPending = null;
  }
  function confirmHonestDay() {
    if (!_honestPackPending) { closeHonestDayModal(); return; }
    const ok = markTodayAsHonestDay(_honestPackPending);
    closeHonestDayModal();
    if (ok && typeof showHabitToast === 'function') {
      showHabitToast('🌙 Honest Rest day marked. Your streak is held.');
    }
    if (currentTab === 'habits')   renderCompoundProgress();
    if (currentTab === 'profile')  renderProfile();
  }
  function setupHonestDayModal() {
    const cancel = document.getElementById('hm-cancel');
    const confirm = document.getElementById('hm-confirm');
    const overlay = document.getElementById('honest-overlay');
    if (cancel)  cancel.addEventListener('click', closeHonestDayModal);
    if (confirm) confirm.addEventListener('click', confirmHonestDay);
    if (overlay) overlay.addEventListener('click', closeHonestDayModal);
  }

  // ── SHIELD INFO modal ────────────────────────────────────
  function openShieldInfoModal() {
    document.getElementById('shield-overlay').classList.remove('hidden');
    document.getElementById('shield-modal').classList.remove('hidden');
  }
  function closeShieldInfoModal() {
    document.getElementById('shield-overlay').classList.add('hidden');
    document.getElementById('shield-modal').classList.add('hidden');
  }
  function setupShieldInfoModal() {
    const close = document.getElementById('sm-close');
    const ok    = document.getElementById('sm-ok');
    const ov    = document.getElementById('shield-overlay');
    if (close) close.addEventListener('click', closeShieldInfoModal);
    if (ok)    ok.addEventListener('click', closeShieldInfoModal);
    if (ov)    ov.addEventListener('click', closeShieldInfoModal);
  }

  // ── BONUS INFO POPUP ─────────────────────────────────────
  // Tapping the ⚡ on any pack progress row opens this popup. It explains
  // the Compound Effect XP tier formula AND the ROI rationale for both
  // Morning Routine and Locked-In packs.
  function openBonusInfoPopup() {
    const ov = document.getElementById('bonus-info-overlay');
    const md = document.getElementById('bonus-info-modal');
    if (!ov || !md) return;
    // Populate live shield + honest-day counts so users see their current state
    const shieldEl = document.getElementById('bi-shield-counts');
    if (shieldEl) {
      const mr = streakShields['morning']   || 0;
      const li = streakShields['locked-in'] || 0;
      shieldEl.innerHTML =
        '<span class="bi-stat-pill">🌅 ' + mr + '/3</span>' +
        '<span class="bi-stat-pill">🔒 ' + li + '/3</span>';
    }
    const honestEl = document.getElementById('bi-honest-counts');
    if (honestEl) {
      const mrUsed = getHonestDayUsesThisMonth('morning');
      const liUsed = getHonestDayUsesThisMonth('locked-in');
      const monthLabel = (function() {
        try { return new Date(today + 'T12:00:00').toLocaleDateString('en-US', { month: 'long' }); }
        catch (_) { return 'this month'; }
      })();
      honestEl.innerHTML =
        '<span class="bi-stat-pill">🌅 ' + (mrUsed ? 'used' : 'available') + '</span>' +
        '<span class="bi-stat-pill">🔒 ' + (liUsed ? 'used' : 'available') + '</span>' +
        '<span class="bi-stat-pill bi-stat-pill--quiet">' + monthLabel + '</span>';
    }
    ov.classList.remove('hidden');
    md.classList.remove('hidden');
  }
  function closeBonusInfoPopup() {
    const ov = document.getElementById('bonus-info-overlay');
    const md = document.getElementById('bonus-info-modal');
    if (!ov || !md) return;
    ov.classList.add('hidden');
    md.classList.add('hidden');
  }
  // ── PERSONAL RECORDS — detail popup, celebrations, queue ───
  function _prMetaSummary(prId, meta) {
    if (!meta) return '';
    if (prId === 'longest_habit_streak' && meta.habitName) return meta.habitName;
    if (prId === 'longest_stat_streak'  && meta.statId)    {
      const stat = STATS.find(s => s.id === meta.statId);
      return stat ? stat.icon + ' ' + stat.name : meta.statId;
    }
    return '';
  }

  function _prBeatHint(prId, value) {
    if (prId === 'highest_rank') {
      const idx = RANKS.findIndex(r => r.id === value);
      const next = (idx >= 0 && idx < RANKS.length - 1) ? RANKS[idx + 1].id : null;
      return next ? 'Reach ' + next + ' rank to break this.' : 'Max rank achieved — nothing left to beat.';
    }
    const v = Number(value) || 0;
    return 'Beat: ' + (v + 1).toLocaleString();
  }

  function openPRDetailSheet(prId) {
    const def = getPRDef(prId);
    if (!def) return;
    const rec   = personalRecords[prId] || { value: 0, meta: null, lastUpdated: null };
    const accent = _prTileAccent(def);
    const sheet = document.getElementById('pr-detail-sheet');
    const ov    = document.getElementById('pr-detail-overlay');
    if (!sheet || !ov) return;

    sheet.style.setProperty('--pr-accent', accent);
    document.getElementById('pr-detail-icon').textContent  = def.icon;
    document.getElementById('pr-detail-title').textContent = def.description;
    document.getElementById('pr-detail-value').textContent = _formatPRValue(prId, rec.value);
    const metaSummary = _prMetaSummary(prId, rec.meta);
    document.getElementById('pr-detail-meta').textContent = metaSummary
      ? metaSummary + (rec.lastUpdated ? '  ·  set ' + rec.lastUpdated : '')
      : (rec.lastUpdated ? 'Set ' + rec.lastUpdated : 'Not yet set');
    document.getElementById('pr-detail-desc').textContent       = '';
    document.getElementById('pr-detail-motivation').textContent = def.motivation;
    document.getElementById('pr-detail-beat').textContent       = _prBeatHint(prId, rec.value);

    ov.classList.remove('hidden');
    sheet.classList.remove('hidden');
  }

  function closePRDetailSheet() {
    document.getElementById('pr-detail-overlay').classList.add('hidden');
    document.getElementById('pr-detail-sheet').classList.add('hidden');
  }

  // ── ALL-PR SHEET — opens from the Status tab button ───────
  function openPRAllSheet() {
    const ov    = document.getElementById('pr-all-overlay');
    const sheet = document.getElementById('pr-all-sheet');
    const grid  = document.getElementById('pr-all-grid');
    if (!ov || !sheet || !grid) return;
    grid.innerHTML = buildAllPRTilesHTML();
    ov.classList.remove('hidden');
    sheet.classList.remove('hidden');
  }
  function closePRAllSheet() {
    document.getElementById('pr-all-overlay').classList.add('hidden');
    document.getElementById('pr-all-sheet').classList.add('hidden');
  }

  function setupPRDetailSheet() {
    const ov     = document.getElementById('pr-detail-overlay');
    const sheet  = document.getElementById('pr-detail-sheet');
    const close  = document.getElementById('pr-detail-close');
    const allOv    = document.getElementById('pr-all-overlay');
    const allSheet = document.getElementById('pr-all-sheet');
    const allClose = document.getElementById('pr-all-close');

    if (ov)    ov.addEventListener('click', closePRDetailSheet);
    if (close) close.addEventListener('click', closePRDetailSheet);
    if (allOv)    allOv.addEventListener('click', closePRAllSheet);
    if (allClose) allClose.addEventListener('click', closePRAllSheet);

    // Delegated taps:
    //   - #pr-open-btn (Status-tab button) → opens the All-PRs grid sheet
    //   - any [data-pr-id] tile → opens the per-PR detail sheet
    document.addEventListener('click', e => {
      const t = e.target;
      if (!t || !t.closest) return;
      const opener = t.closest('#pr-open-btn');
      if (opener) {
        e.stopPropagation();
        e.preventDefault();
        openPRAllSheet();
        return;
      }
      const tile = t.closest('[data-pr-id]');
      if (!tile) return;
      e.stopPropagation();
      e.preventDefault();
      const prId = tile.getAttribute('data-pr-id');
      // STACK the detail sheet on top of the All-PRs sheet (don't close
      // the parent). Closing the detail then leaves the user on the
      // All-PRs grid, which is what they expect when navigating back.
      openPRDetailSheet(prId);
    });

    // Swipe-down dismiss for both sheets
    if (sheet && ov && typeof attachSheetDismissGesture === 'function') {
      attachSheetDismissGesture(sheet, ov, () => {
        sheet.classList.add('hidden');
        ov.classList.add('hidden');
      }, {
        baseTransform:  'translateX(-50%) ',
        handleSelector: '.pr-drag-handle, .pr-detail-header',
        scrollTarget:   '.pr-detail-body',
      });
    }
    if (allSheet && allOv && typeof attachSheetDismissGesture === 'function') {
      attachSheetDismissGesture(allSheet, allOv, () => {
        allSheet.classList.add('hidden');
        allOv.classList.add('hidden');
      }, {
        baseTransform:  'translateX(-50%) ',
        handleSelector: '.pr-drag-handle, .pr-all-header',
        scrollTarget:   '.pr-all-grid',
      });
    }

    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      // Close the topmost sheet only — detail is stacked above All-PRs,
      // so close detail first; only close All-PRs if detail isn't open.
      if (sheet && !sheet.classList.contains('hidden')) {
        closePRDetailSheet();
      } else if (allSheet && !allSheet.classList.contains('hidden')) {
        closePRAllSheet();
      }
    });
  }

  // ── PR celebration sounds (Web Audio, distinct from fanfare) ──
  function playPRChime() {
    if (!soundEnabled) return;
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const t0 = ac.currentTime;
      // E5 → G5 → B5 quick uplift
      const notes = [659.25, 783.99, 987.77];
      notes.forEach((freq, i) => {
        ['sine', 'triangle'].forEach(type => {
          const osc = ac.createOscillator();
          const gain = ac.createGain();
          osc.type = type;
          osc.frequency.setValueAtTime(freq, t0 + i * 0.08);
          osc.connect(gain);
          gain.connect(ac.destination);
          const peak = type === 'sine' ? 0.18 : 0.08;
          gain.gain.setValueAtTime(0.0001, t0 + i * 0.08);
          gain.gain.exponentialRampToValueAtTime(peak, t0 + i * 0.08 + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.08 + 0.30);
          osc.start(t0 + i * 0.08);
          osc.stop(t0 + i * 0.08 + 0.32);
        });
      });
    } catch (_) {}
  }

  function playPRTakeover() {
    if (!soundEnabled) return;
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const t0 = ac.currentTime;
      // Cinematic ascent: D4 → A4 → D5 → A5 sustained
      const notes = [
        { f: 293.66, s: 0.00, d: 0.30, p: 0.22 },
        { f: 440.00, s: 0.20, d: 0.30, p: 0.22 },
        { f: 587.33, s: 0.40, d: 0.50, p: 0.26 },
        { f: 880.00, s: 0.60, d: 1.20, p: 0.28 },
      ];
      notes.forEach(n => {
        ['sine', 'triangle'].forEach(type => {
          const osc = ac.createOscillator();
          const gain = ac.createGain();
          osc.type = type;
          osc.frequency.setValueAtTime(n.f, t0 + n.s);
          osc.connect(gain);
          gain.connect(ac.destination);
          const peak = type === 'sine' ? n.p : n.p * 0.5;
          gain.gain.setValueAtTime(0.0001, t0 + n.s);
          gain.gain.exponentialRampToValueAtTime(peak, t0 + n.s + 0.04);
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.s + n.d);
          osc.start(t0 + n.s);
          osc.stop(t0 + n.s + n.d + 0.05);
        });
      });
    } catch (_) {}
  }

  // ── Celebration display + queue ────────────────────────────
  function showPRTier2Modal(item) {
    const def = getPRDef(item.prId);
    if (!def) { _prCelebrationActive = false; drainPRCelebrationQueue(); return; }
    const accent = _prTileAccent(def);
    const popup  = document.getElementById('pr-popup');
    if (!popup) { _prCelebrationActive = false; drainPRCelebrationQueue(); return; }
    popup.style.setProperty('--pr-accent', accent);
    document.getElementById('pr-popup-icon').textContent  = def.icon;
    document.getElementById('pr-popup-title').textContent = def.description;
    document.getElementById('pr-popup-value').textContent = _formatPRValue(item.prId, item.newValue);
    const prevTxt = (item.prevValue && item.prevValue > 0)
      ? 'Previous: ' + _formatPRValue(item.prId, item.prevValue)
      : 'Your first record. Set the bar.';
    document.getElementById('pr-popup-prev').textContent = prevTxt;
    popup.classList.remove('hidden');
    void popup.offsetWidth;
    popup.classList.add('pr-popup--show');
    playPRChime();

    const dismiss = () => {
      popup.classList.remove('pr-popup--show');
      popup.classList.add('pr-popup--hide');
      popup.addEventListener('animationend', () => {
        popup.classList.remove('pr-popup--hide');
        popup.classList.add('hidden');
        _prCelebrationActive = false;
        setTimeout(drainPRCelebrationQueue, 260);
      }, { once: true });
      popup.removeEventListener('click', dismiss);
    };
    popup.addEventListener('click', dismiss);
    setTimeout(dismiss, 3200);
  }

  function showPRTier3Takeover(item) {
    const def = getPRDef(item.prId);
    if (!def) { _prCelebrationActive = false; drainPRCelebrationQueue(); return; }
    const accent  = _prTileAccent(def);
    const overlay = document.getElementById('pr-takeover');
    if (!overlay) { _prCelebrationActive = false; drainPRCelebrationQueue(); return; }
    overlay.style.setProperty('--pr-accent', accent);

    let headline = '';
    let sub = def.motivation;
    if (item.prId === 'longest_mr_streak')      headline = item.newValue + '-DAY MORNING ROUTINE';
    else if (item.prId === 'longest_li_streak') headline = item.newValue + '-DAY LOCKED-IN';
    else if (item.prId === 'highest_rank')      headline = item.newValue + ' RANK';
    else                                        headline = String(item.newValue) + ' ' + def.label.toUpperCase();

    document.getElementById('pr-takeover-headline').textContent = headline;
    document.getElementById('pr-takeover-sub').textContent      = sub;

    overlay.classList.remove('hidden');
    void overlay.offsetWidth;
    overlay.classList.add('pr-takeover--show');
    playPRTakeover();

    const dismiss = () => {
      overlay.classList.remove('pr-takeover--show');
      overlay.classList.add('pr-takeover--hide');
      overlay.addEventListener('animationend', () => {
        overlay.classList.remove('pr-takeover--hide');
        overlay.classList.add('hidden');
        _prCelebrationActive = false;
        setTimeout(drainPRCelebrationQueue, 320);
      }, { once: true });
      overlay.removeEventListener('click', dismiss);
    };
    overlay.addEventListener('click', dismiss);
    setTimeout(dismiss, 5000);
  }

  function drainPRCelebrationQueue() {
    if (_prCelebrationActive || !_prCelebrationQueue.length) return;
    // Don't fire PR celebrations until any queued bonus popups have finished.
    if (_bonusPopupActive || (_bonusPopupQueue && _bonusPopupQueue.length)) {
      setTimeout(drainPRCelebrationQueue, 400);
      return;
    }
    _prCelebrationActive = true;
    const item = _prCelebrationQueue.shift();
    const def  = getPRDef(item.prId);
    if (item.mode === 'tier1' || (def && def.tier === 1)) {
      // Tier 1 toast
      const valStr = _formatPRValue(item.prId, item.newValue);
      showHabitToast('🏆 ' + valStr + ' ' + def.label);
      setTimeout(() => {
        _prCelebrationActive = false;
        drainPRCelebrationQueue();
      }, 2400);
    } else if (item.mode === 'tier3') {
      showPRTier3Takeover(item);
    } else {
      showPRTier2Modal(item);
    }
  }

  function setupBonusInfoPopup() {
    const ov = document.getElementById('bonus-info-overlay');
    const closeBtn = document.getElementById('bi-close-btn');
    const doneBtn  = document.getElementById('bi-done-btn');
    if (ov)       ov.addEventListener('click', closeBonusInfoPopup);
    if (closeBtn) closeBtn.addEventListener('click', closeBonusInfoPopup);
    if (doneBtn)  doneBtn.addEventListener('click', closeBonusInfoPopup);

    // Delegated click — every ⚡ rendered with [data-bonus-info] is clickable
    // (current pack-progress strip rows, plus any future surfaces that opt in).
    document.addEventListener('click', e => {
      const t = e.target;
      if (!t || !t.closest) return;
      const bolt = t.closest('[data-bonus-info]');
      if (!bolt) return;
      e.stopPropagation();
      e.preventDefault();
      openBonusInfoPopup();
    });

    // ESC dismiss
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      const md = document.getElementById('bonus-info-modal');
      if (md && !md.classList.contains('hidden')) closeBonusInfoPopup();
    });
  }

  // ── DAILY MISSION CARD render ─────────────────────────────
  // Session-only expand/collapse state. Defaults to COLLAPSED so the
  // card sits as a single compact row above the pack headers, matching
  // the visual density of the rest of the Habits tab. Tap to expand.
  let _dailyMissionExpanded = false;

  function renderDailyMissionCard() {
    const wrap = document.getElementById('daily-mission-card');
    if (!wrap) return;
    // The card now lives on the Quests tab. Skip rendering on any other
    // tab — there's nothing to update visually if it's not on screen.
    if (currentTab !== 'quests') { wrap.classList.add('hidden'); return; }

    const mission = getOrPickTodayMission();
    if (!mission) { wrap.classList.add('hidden'); return; }

    const allComplete   = isMissionComplete(mission);
    const tags          = mission.tags || [];
    const tagBadges     = (tags.includes('outdoor') || tags.includes('nature') ? '<span class="dmc-tag">🌲</span>' : '') +
                          (tags.includes('no-phone') ? '<span class="dmc-tag">📵</span>' : '');
    const doneCount = mission.components.filter(c => isMissionComponentDone(c)).length;
    const total     = mission.components.length;
    const xpAmt     = isWeekend() ? 100 : 50;
    const xpStr     = '+' + xpAmt + ' XP';

    if (allComplete) wrap.classList.add('dmc--complete'); else wrap.classList.remove('dmc--complete');
    if (_dailyMissionExpanded) wrap.classList.add('dmc--expanded'); else wrap.classList.remove('dmc--expanded');
    wrap.classList.remove('hidden');

    // ── Compact toggle row (always visible) ────────────────
    const eyebrow = allComplete ? 'DAILY QUEST · COMPLETE' : 'DAILY QUEST';
    const status  = allComplete ? '✓ Complete' : doneCount + '/' + total;
    const chev    = _dailyMissionExpanded ? '▾' : '▸';

    let html =
      '<button class="dmc-toggle" id="dmc-toggle" type="button" aria-expanded="' + _dailyMissionExpanded + '">' +
        '<span class="dmc-toggle-eyebrow">' + eyebrow + '</span>' +
        '<span class="dmc-toggle-name">' + esc(mission.name) + '</span>' +
        tagBadges +
        '<span class="dmc-toggle-progress">' + status + '</span>' +
        '<span class="dmc-toggle-xp">' + xpStr + '</span>' +
        '<span class="dmc-toggle-chev">' + chev + '</span>' +
      '</button>';

    // ── Expanded body (only when user has tapped to expand) ─
    if (_dailyMissionExpanded) {
      const componentsHTML = mission.components.map(c => {
        const done     = isMissionComponentDone(c);
        const tappable = isMissionComponentTappable(c);
        const linkedHabit = c.matchType === 'habit'
          ? habits.find(h => h.name === c.habitName)
          : null;
        const subText = linkedHabit
          ? '<span class="dmc-comp-sub">linked to <b>' + esc(linkedHabit.name) + '</b></span>'
          : (c.matchType === 'pack' ? '<span class="dmc-comp-sub">auto from pack progress</span>' : '');
        return '<div class="dmc-comp' + (done ? ' dmc-comp--done' : '') +
                    (tappable ? ' dmc-comp--tappable' : '') +
                    '" ' + (tappable ? 'data-mission-comp="' + esc(c.id) + '" role="button" tabindex="0"' : '') + '>' +
          '<span class="dmc-comp-check">' + (done ? '✓' : '') + '</span>' +
          '<span class="dmc-comp-text">' + esc(c.text) + subText + '</span>' +
        '</div>';
      }).join('');

      html +=
        '<div class="dmc-body">' +
          '<div class="dmc-bonus">' + xpStr + (isWeekend() ? ' <span class="dmc-2x">2×</span>' : '') +
            '<span class="dmc-difficulty">LEGENDARY</span>' +
          '</div>' +
          '<div class="dmc-desc">' + esc(mission.description) + '</div>' +
          '<div class="dmc-components">' + componentsHTML + '</div>' +
        '</div>';
    }

    wrap.innerHTML = html;
  }

  function setupDailyMissionCard() {
    const wrap = document.getElementById('daily-mission-card');
    if (!wrap) return;
    // Delegated taps for: expand/collapse toggle + per-component manual checks
    wrap.addEventListener('click', e => {
      const t = e.target;
      if (!t || !t.closest) return;
      const comp = t.closest('[data-mission-comp]');
      if (comp) {
        e.preventDefault();
        e.stopPropagation();
        toggleMissionComponent(comp.getAttribute('data-mission-comp'));
        return;
      }
      const toggle = t.closest('#dmc-toggle');
      if (toggle) {
        e.preventDefault();
        _dailyMissionExpanded = !_dailyMissionExpanded;
        renderDailyMissionCard();
        return;
      }
    });
    wrap.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const comp = e.target && e.target.closest && e.target.closest('[data-mission-comp]');
      if (comp) {
        e.preventDefault();
        toggleMissionComponent(comp.getAttribute('data-mission-comp'));
      }
    });
  }

  // ── MISSION COMPLETION CELEBRATION ────────────────────────
  function playMissionFanfare() {
    if (!soundEnabled) return;
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const t0 = ac.currentTime;
      // Heroic ascending sequence — bigger than compound fanfare
      const notes = [
        { f: 392.00, s: 0.00, d: 0.22, p: 0.20 },  // G4
        { f: 523.25, s: 0.14, d: 0.22, p: 0.22 },  // C5
        { f: 659.25, s: 0.28, d: 0.22, p: 0.24 },  // E5
        { f: 783.99, s: 0.42, d: 0.50, p: 0.26 },  // G5
        { f: 1046.50, s: 0.70, d: 1.40, p: 0.30 }, // C6 sustained
        { f: 783.99,  s: 0.70, d: 1.40, p: 0.18 }, // G5 layered for chord
      ];
      notes.forEach(n => {
        ['sine', 'triangle'].forEach(type => {
          const osc = ac.createOscillator();
          const gain = ac.createGain();
          osc.type = type;
          osc.frequency.setValueAtTime(n.f, t0 + n.s);
          osc.connect(gain); gain.connect(ac.destination);
          const peak = type === 'sine' ? n.p : n.p * 0.55;
          gain.gain.setValueAtTime(0.0001, t0 + n.s);
          gain.gain.exponentialRampToValueAtTime(peak, t0 + n.s + 0.04);
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.s + n.d);
          osc.start(t0 + n.s);
          osc.stop(t0 + n.s + n.d + 0.05);
        });
      });
    } catch (_) {}
  }

  // Comeback sound — grounded determination, not triumphant
  function playComebackChime() {
    if (!soundEnabled) return;
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const t0 = ac.currentTime;
      // Simple A3 → D4 → A4 walking up — steady, resolved
      const notes = [
        { f: 220.00, s: 0.00, d: 0.32, p: 0.16 },
        { f: 293.66, s: 0.20, d: 0.32, p: 0.16 },
        { f: 440.00, s: 0.40, d: 0.95, p: 0.18 },
      ];
      notes.forEach(n => {
        ['sine', 'triangle'].forEach(type => {
          const osc = ac.createOscillator();
          const gain = ac.createGain();
          osc.type = type;
          osc.frequency.setValueAtTime(n.f, t0 + n.s);
          osc.connect(gain); gain.connect(ac.destination);
          const peak = type === 'sine' ? n.p : n.p * 0.45;
          gain.gain.setValueAtTime(0.0001, t0 + n.s);
          gain.gain.exponentialRampToValueAtTime(peak, t0 + n.s + 0.04);
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.s + n.d);
          osc.start(t0 + n.s);
          osc.stop(t0 + n.s + n.d + 0.05);
        });
      });
    } catch (_) {}
  }

  function showComebackScreen(item) {
    const overlay = document.getElementById('comeback-screen');
    if (!overlay) { levelUpActive = false; drainLevelUpQueue(); return; }
    document.getElementById('cb-message').textContent = item.msg || 'The hunter who returns is stronger than the one who never fell.';
    document.getElementById('cb-xp').textContent      = '+' + item.xp + ' Resilience XP';

    overlay.classList.remove('hidden');
    void overlay.offsetWidth;
    overlay.classList.add('cb-show');
    playComebackChime();
    navigator.vibrate && navigator.vibrate([40, 30, 80]);

    const dismiss = () => {
      overlay.classList.remove('cb-show');
      overlay.classList.add('cb-hide');
      overlay.addEventListener('animationend', () => {
        overlay.classList.remove('cb-hide');
        overlay.classList.add('hidden');
        levelUpActive = false;
        drainLevelUpQueue();
      }, { once: true });
      overlay.removeEventListener('click', dismiss);
    };
    overlay.addEventListener('click', dismiss);
    setTimeout(dismiss, 5500);
  }

  function showMissionCompleteScreen(item) {
    const overlay = document.getElementById('mission-complete-screen');
    if (!overlay) { levelUpActive = false; drainLevelUpQueue(); return; }
    const xpStr = '+' + item.xp + ' XP' + (item.doubled ? '  2×' : '');
    document.getElementById('mc-name').textContent = item.mission.name;
    document.getElementById('mc-xp').textContent   = xpStr;
    overlay.classList.remove('hidden');
    void overlay.offsetWidth;
    overlay.classList.add('mc-show');
    playMissionFanfare();
    navigator.vibrate && navigator.vibrate([60, 40, 100, 40, 200, 40, 100]);

    const dismiss = () => {
      overlay.classList.remove('mc-show');
      overlay.classList.add('mc-hide');
      overlay.addEventListener('animationend', () => {
        overlay.classList.remove('mc-hide');
        overlay.classList.add('hidden');
        levelUpActive = false;
        drainLevelUpQueue();
      }, { once: true });
      overlay.removeEventListener('click', dismiss);
    };
    overlay.addEventListener('click', dismiss);
    setTimeout(dismiss, 4000);
  }

  function renderCompoundProgress() {
    const wrap = document.getElementById('compound-progress');
    if (!wrap) return;
    // Show a row for every bonus pack the user has at least one habit in.
    // EXCEPT: hide the Morning Routine row when the user has truly committed
    // to the Locked-In path. Since LI's 16 = MR's 10 + 6 extras, any LI
    // habit count > 0 trivially fires (because MR habits also count toward
    // LI). We must check for at least one of the 6 LI-EXCLUSIVE extras
    // before suppressing the MR strip. Pure-MR users keep their MR row.
    const liExclusivelyActive = (function() {
      const liExtraNames = (typeof _LOCKED_IN_EXTRA_INDICES !== 'undefined' &&
                            typeof DEFAULT_HABITS !== 'undefined')
        ? new Set(_LOCKED_IN_EXTRA_INDICES.map(i => DEFAULT_HABITS[i] && DEFAULT_HABITS[i].name).filter(Boolean))
        : new Set();
      if (liExtraNames.size === 0) return false;
      return habits.some(h => liExtraNames.has(h.name));
    })();
    const rows = BONUS_PACK_IDS.map(packId => {
      if (packId === 'morning' && liExclusivelyActive) return '';
      if (packId === 'locked-in' && !liExclusivelyActive) return '';
      const { done, total } = getPackProgress(packId);
      if (total === 0) return '';
      const pack            = getPackById(packId);
      // Display total = canonical pack size (10 / 16) so users see how
      // close they are to the FULL bonus, not just to today's owned subset.
      const canonicalTotal  = getPackHabitDefs(packId).length;
      const awarded         = compoundAwarded[packId] === today;
      const cs              = compoundStreaks[packId];
      const streak          = cs && cs.streak > 0 && cs.lastDate === today ? cs.streak : 0;
      const cls             = packId === 'locked-in' ? ' cp-prog-row--lockedin' : '';
      // "Missing canonical habits" = how many of the pack's 10/16 habits the
      // user doesn't yet have in their active list. Different from "done" which
      // counts today's completions out of canonical total.
      const missingDefs   = (typeof getMissingPackHabits === 'function')
        ? getMissingPackHabits(packId)
        : (packId === 'morning' && typeof getMissingMorningHabits === 'function'
            ? getMissingMorningHabits() : []);
      const missingCount  = missingDefs.length;
      const hasMissing    = missingCount > 0 && !awarded;
      const addPill = hasMissing
        ? '<span class="cp-prog-add">+ ' + missingCount + ' missing</span>'
        : '';
      // Streak Shield indicator — show when ≥1 shield held for this pack
      const shieldCount = streakShields[packId] || 0;
      const shieldChip  = shieldCount > 0
        ? '<span class="cp-prog-shield" data-shield-info="' + esc(packId) + '" role="button" tabindex="0" aria-label="Streak Shields">🛡️ ' + shieldCount + '</span>'
        : '';
      // Honest Day chip — only when streak active, not completed today, all habits in,
      // and an Honest Day is still available this month
      const honestAvailable = streak > 0 && !awarded && !hasMissing &&
                              canMarkHonestDayToday(packId);
      const honestChip = honestAvailable
        ? '<span class="cp-prog-honest" data-honest-pack="' + esc(packId) + '" role="button" tabindex="0" aria-label="Mark today as Honest Rest">🌙 Rest</span>'
        : '';
      return '<div class="cp-prog-row' + cls + (hasMissing ? ' cp-prog-row--addable' : '') +
                  '" data-pack-add="' + esc(packId) + '" role="button" tabindex="0" ' +
                  'aria-label="' + esc(pack.name) + ' progress' + (hasMissing ? ' — tap to add missing habits' : '') + '">' +
        // Map pack id → custom pack-icon key. Falls back to iconify on
        // the raw emoji for any pack id that doesn't have a mapped icon.
        '<span class="cp-prog-name">' +
          (packId === 'morning'    ? packIconHtml('morning',  { size: 18 }) :
           packId === 'locked-in'  ? packIconHtml('lockedin', { size: 18 }) :
           iconify(pack.emoji, { size: 14 })) +
          ' ' + esc(pack.name) +
        '</span>' +
        '<span class="cp-prog-count' + (awarded ? ' cp-prog-done' : '') + '">' +
          (awarded ? '✓ Complete' : done + '/' + canonicalTotal) +
        '</span>' +
        // Tappable bolt → opens the Bonus Info popup explaining the formula + ROI
        '<button class="cp-prog-bolt" data-bonus-info aria-label="About the Compound Effect Bonus">' + xpIconHtml({ size: 22 }) + '</button>' +
        (streak > 0 ? '<span class="cp-prog-streak">Day ' + streak + ' ' + streakIconHtml({ size: 14 }) + '</span>' : '') +
        shieldChip +
        honestChip +
        addPill +
      '</div>';
    }).filter(Boolean).join('');
    if (rows) {
      wrap.innerHTML = rows;
      wrap.classList.remove('hidden');
    } else {
      wrap.classList.add('hidden');
    }
  }

  // ── PR STRIP RENDERING ───────────────────────────────────
  // Horizontal scrollable strip of 10 PR tiles for the Status tab.
  function _formatPRValue(prId, value) {
    if (prId === 'highest_rank') return value || '—';
    if (prId === 'total_xp_lifetime' || prId === 'most_xp_day') return Number(value || 0).toLocaleString();
    if (prId === 'total_habits_lifetime') return Number(value || 0).toLocaleString();
    return String(value || 0);
  }

  function _prTileAccent(def) {
    if (def.accent === 'stat') {
      // Use the stat's color from meta
      const meta = (personalRecords[def.id] || {}).meta || {};
      const stat = STATS.find(s => s.id === meta.statId);
      return stat ? stat.color : '#a78bfa';
    }
    return def.accent || '#a78bfa';
  }

  // Compact button on the Status tab — taps open the "All PRs" sheet.
  // The button shows a small headline plus a 1-line summary of standout PRs
  // (most-habits-day + active-days) so it never feels empty.
  function buildPRStripHTML() {
    // Compact chip — sits inline next to the name and rank.
    // Tap opens the full All-PRs grid sheet.
    return '<button id="pr-open-btn" class="pr-open-chip" aria-label="View Personal Records">' +
      '<span class="pr-open-icon">🏆</span>' +
      '<span class="pr-open-label">PR</span>' +
    '</button>';
  }

  function buildAllPRTilesHTML() {
    return PR_DEFS.map(def => {
      const rec    = personalRecords[def.id] || { value: 0 };
      const accent = _prTileAccent(def);
      const valStr = _formatPRValue(def.id, rec.value);
      return '<button class="pr-tile pr-tile--grid" data-pr-id="' + esc(def.id) + '" ' +
                  'style="--pr-accent:' + accent + '" ' +
                  'aria-label="View ' + esc(def.label) + ' record">' +
        // PR icon dropped — emoji-free pass. Tile reads via accent color + value.
        '<span class="pr-tile-value">' + esc(valStr) + '</span>' +
        '<span class="pr-tile-label">' + esc(def.label) + '</span>' +
      '</button>';
    }).join('');
  }

  function buildCompoundBadgesHTML() {
    return BONUS_PACK_IDS.filter(packId => {
      const cs = compoundStreaks[packId];
      return cs && cs.streak > 0;
    }).map(packId => {
      const pack = getPackById(packId);
      const s    = compoundStreaks[packId].streak;
      const iconHTML = packId === 'morning'   ? packIconHtml('morning',  { size: 14 }) :
                       packId === 'locked-in' ? packIconHtml('lockedin', { size: 14 }) :
                       iconify(packId === 'locked-in' ? '🔒' : '⚡', { size: 14 });
      return '<div class="sc-compound-badge">' + iconHTML + ' ' + esc(pack.name) + ': Day ' + s + '</div>';
    }).join('');
  }

  // ── SHARED HABIT INFO RENDERING ──────────────────────────
  // Populates a stat badge, description text node, and 4-cell stats
  // grid for any popup that displays habit performance info. Both the
  // History info popup (prefix 'hi') and the View Note bottom-sheet
  // (prefix 'vn') call this with the same habit so the data and styling
  // stay perfectly consistent across the two screens.
  function populateHabitInfoBlock(prefix, habit) {
    const statId  = getHabitPrimaryStat(habit);
    const stat    = STATS.find(s => s.id === statId) || STATS[0];

    // Stat badge
    const badge = document.getElementById(prefix + '-stat-badge');
    if (badge) {
      badge.style.background  = colorWithAlpha(stat.color, 0.16);
      badge.style.borderColor = colorWithAlpha(stat.color, 0.55);
      badge.style.color       = stat.color;
      badge.innerHTML =
        '<span class="hi-badge-icon">' + statIconHtml(stat, { size: 18 }) + '</span>' +
        '<span class="hi-badge-label">' + esc(stat.label) + ' · ' + esc(stat.name) + '</span>';
    }

    // Stat description
    const desc = document.getElementById(prefix + '-stat-desc');
    if (desc) desc.textContent = STAT_INFO_BLURB[statId] || STAT_INFO_BLURB.FOCUS;

    // Performance stats — 4 metrics shared across both popups
    const cur = document.getElementById(prefix + '-current');
    if (cur) cur.textContent = (streaks[habit.id] && streaks[habit.id].count) || 0;

    const week  = document.getElementById(prefix + '-week');
    if (week)  week.textContent  = computeWeekCompletionsForHabit(habit);

    const best  = document.getElementById(prefix + '-best');
    if (best)  best.textContent  = computeBestStreakForHabit(habit);

    const total = document.getElementById(prefix + '-total');
    if (total) total.textContent = computeTotalCompletionsForHabit(habit);

    // Reminder state — only the View Note sheet (prefix="vn") has this
    // section in the markup; History info popup (prefix="hi") doesn't.
    const remEl = document.getElementById(prefix + '-reminder-display');
    if (remEl) {
      let time = null;
      try { time = (Notif.reminderFor && Notif.reminderFor(habit.id)) || null; } catch (_) {}
      if (time) {
        const [hStr, mStr] = time.split(':');
        const h  = parseInt(hStr, 10) || 0;
        const m  = parseInt(mStr, 10) || 0;
        const pm = h >= 12;
        const h12 = ((h % 12) || 12);
        const label = h12 + ':' + String(m).padStart(2, '0') + ' ' + (pm ? 'PM' : 'AM');
        remEl.textContent = label;
        remEl.classList.add('vn-reminder-display--set');
        remEl.classList.remove('vn-reminder-display--none');
      } else {
        remEl.textContent = 'No reminder set';
        remEl.classList.add('vn-reminder-display--none');
        remEl.classList.remove('vn-reminder-display--set');
      }
    }
  }

  // ── VIEW NOTE — full habit detail bottom-sheet ───────────
  // Replaces the previous read-only note modal. Shows everything the
  // History info popup shows PLUS the editable personal note.
  let _vnHabitId    = null;
  let _vnPrevFocus  = null;

  function openNoteModal(id) {
    const habit = habits.find(h => h.id === id);
    if (!habit) return;
    _vnHabitId   = id;
    _vnPrevFocus = document.activeElement;

    // Header
    setHabitIcon(document.getElementById('note-modal-emoji'), habit, 56);
    document.getElementById('note-modal-name').textContent  = habitDisplayName(habit);
    const diffKey = habit.difficulty || 'easy';
    const diff    = DIFFICULTY[diffKey] || DIFFICULTY.easy;
    document.getElementById('vn-diff').textContent =
      diff.label + ' · +' + diff.pts + ' XP';
    document.getElementById('vn-diff').className =
      'vn-diff vn-diff--' + diffKey;

    // Shared stats block
    populateHabitInfoBlock('vn', habit);

    // Read-only canonical description from the habit library.
    // (Any user-typed notes from earlier versions remain in habitNotes
    // localStorage but are no longer displayed or editable — orphaned
    // intentionally, not deleted.)
    const noteEl = document.getElementById('vn-note-display');
    const desc   = getHabitDescription(habit);
    if (desc) {
      noteEl.textContent = desc;
      noteEl.classList.remove('vn-note-display--empty');
    } else {
      noteEl.textContent = 'Description coming soon.';
      noteEl.classList.add('vn-note-display--empty');
    }

    // Show
    document.getElementById('note-overlay').classList.remove('hidden');
    document.getElementById('note-modal').classList.remove('hidden');
  }

  function closeNoteModal() {
    document.getElementById('note-overlay').classList.add('hidden');
    document.getElementById('note-modal').classList.add('hidden');
    _vnHabitId = null;
    if (_vnPrevFocus && typeof _vnPrevFocus.focus === 'function') {
      try { _vnPrevFocus.focus(); } catch (_) {}
    }
    _vnPrevFocus = null;
  }

  function setupNoteModal() {
    const overlay = document.getElementById('note-overlay');
    const sheet   = document.getElementById('note-modal');
    const closeBtn = document.getElementById('note-close-btn');
    const editBtn  = document.getElementById('vn-edit-btn');
    if (!overlay || !sheet) return;

    overlay.addEventListener('click', closeNoteModal);
    closeBtn.addEventListener('click', closeNoteModal);

    // Edit pencil → existing Edit Habit flow
    if (editBtn) {
      editBtn.addEventListener('click', () => {
        const id = _vnHabitId;
        closeNoteModal();
        if (id) openEditModal(id);
      });
    }

    // Swipe-down-to-dismiss via the shared utility
    if (typeof attachSheetDismissGesture === 'function') {
      attachSheetDismissGesture(sheet, overlay, () => {
        sheet.classList.add('hidden');
        overlay.classList.add('hidden');
        _vnHabitId = null;
      }, {
        baseTransform:  'translateX(-50%) ',
        handleSelector: '.vn-drag-handle, .vn-header',
        scrollTarget:   '.vn-body',
      });
    }

    // ESC key dismiss
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !sheet.classList.contains('hidden')) {
        closeNoteModal();
      }
    });
  }

  // ── WHAT'S NEW SHEET ─────────────────────────────────────
  // Auto-shows once on first launch after an update. Manually
  // re-openable from Settings → "What's New".
  const WHATS_NEW_SEEN_KEY = 'hb_whats_new_seen';

  function getStoredWhatsNewSeen() {
    try { return localStorage.getItem(WHATS_NEW_SEEN_KEY) || ''; } catch (_) { return ''; }
  }
  function setStoredWhatsNewSeen(version) {
    try { localStorage.setItem(WHATS_NEW_SEEN_KEY, version); } catch (_) {}
  }

  function openWhatsNewSheet(opts) {
    opts = opts || {};
    const overlay = document.getElementById('wn-overlay');
    const sheet   = document.getElementById('wn-sheet');
    if (!overlay || !sheet) return;

    const version = getLatestWhatsNewVersion();
    const data    = WHATS_NEW[version];
    if (!data) return;

    document.getElementById('wn-subtitle').textContent =
      'Version ' + version + ' — ' + data.subtitle;

    const list = document.getElementById('wn-list');
    list.innerHTML = '';
    (data.items || []).forEach(item => {
      const row = document.createElement('div');
      row.className = 'wn-item';
      row.innerHTML =
        '<span class="wn-item-emoji">' + item.emoji + '</span>' +
        '<div class="wn-item-text">' +
          '<div class="wn-item-title">' + esc(item.title) + '</div>' +
          '<div class="wn-item-desc">' + esc(item.description) + '</div>' +
        '</div>';
      list.appendChild(row);
    });

    // Track whether THIS open was an auto-show (counts as "seen")
    sheet.dataset.wnAuto = opts.manual ? '0' : '1';

    overlay.classList.remove('hidden');
    sheet.classList.remove('hidden');
  }

  function closeWhatsNewSheet() {
    const overlay = document.getElementById('wn-overlay');
    const sheet   = document.getElementById('wn-sheet');
    if (!overlay || !sheet) return;
    // Only mark as seen when this was an auto-show (or manually-closed
    // auto-show). Manual opens from Settings don't update the flag.
    if (sheet.dataset.wnAuto === '1') {
      const version = getLatestWhatsNewVersion();
      if (version) setStoredWhatsNewSeen(version);
    }
    overlay.classList.add('hidden');
    sheet.classList.add('hidden');
    sheet.dataset.wnAuto = '0';
  }

  function setupWhatsNewSheet() {
    const overlay  = document.getElementById('wn-overlay');
    const sheet    = document.getElementById('wn-sheet');
    const closeBtn = document.getElementById('wn-close-btn');
    if (!overlay || !sheet || !closeBtn) return;

    closeBtn.addEventListener('click', closeWhatsNewSheet);
    overlay.addEventListener('click', closeWhatsNewSheet);

    // Spec: "Tap anywhere ... to dismiss" — clicking the sheet itself
    // (except interactive children) dismisses too.
    sheet.addEventListener('click', e => {
      if (e.target.closest('.wn-close-btn')) return; // already handled
      closeWhatsNewSheet();
    });

    // Swipe-down dismiss via the shared utility
    if (typeof attachSheetDismissGesture === 'function') {
      attachSheetDismissGesture(sheet, overlay, closeWhatsNewSheet, {
        baseTransform:  'translateX(-50%) ',
        handleSelector: '.wn-drag-handle, .wn-header',
        scrollTarget:   '.wn-list',
      });
    }

    // ESC dismiss on desktop
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !sheet.classList.contains('hidden')) {
        closeWhatsNewSheet();
      }
    });
  }

  // Auto-show the What's New sheet on first launch after an update.
  // Skipped during onboarding (handled by finishOnboarding setting the
  // seen-version directly), and skipped if the user has already seen
  // the latest version.
  function maybeAutoShowWhatsNew() {
    const latest = getLatestWhatsNewVersion();
    if (!latest) return;
    const seen = getStoredWhatsNewSeen();
    if (seen && compareSemver(seen, latest) >= 0) return;
    // Defer slightly so the underlying app render settles first
    setTimeout(() => openWhatsNewSheet({ manual: false }), 480);
  }

  // ── EDIT MODAL ───────────────────────────────────────────
  let editGoalValue = 0;
  // HealthKit step-goal staging for the Edit Habit modal. editStepGoal
  // holds the in-flight value; editStepGoalEnabled gates whether the
  // step-goal control replaces the time/count stepper for this open.
  // Mirrors editGoalValue's pattern — staging, not in-place mutation,
  // so Cancel doesn't need to undo anything.
  let editStepGoal = HEALTHKIT_WALK_DEFAULT_THRESHOLD;
  let editStepGoalEnabled = false;
  // Sleep-goal staging — same pattern, mutually exclusive with both
  // the step-goal control and the time/count stepper.
  let editSleepGoal = HEALTHKIT_SLEEP_DEFAULT_GOAL_HOURS;
  let editSleepGoalEnabled = false;

  function refreshEditGoalDisplay() {
    const habit = habits.find(h => h.id === editingId);
    if (!habit) return;
    const m = MEASURABLE_HABITS[habit.name];
    if (!m) return;
    document.getElementById('edit-goal-val').textContent = editGoalValue.toLocaleString() + ' ' + m.unit;
  }

  // Updates the step-goal display + chip-active state in the Edit Habit
  // modal to match editStepGoal. Called from openEditModal and from
  // every chip / Save handler.
  function refreshEditStepGoalDisplay() {
    const valueEl = document.getElementById('edit-stepgoal-value');
    if (valueEl) valueEl.textContent = editStepGoal.toLocaleString() + ' steps';
    const isCustom = !HEALTHKIT_WALK_PRESETS.includes(editStepGoal);
    document.querySelectorAll('#edit-stepgoal .habit-edit-stepgoal-chip').forEach(chip => {
      const preset = chip.dataset.preset;
      let active;
      if (preset === 'custom') active = isCustom;
      else                     active = parseInt(preset, 10) === editStepGoal;
      chip.classList.toggle('habit-edit-stepgoal-chip--active', active);
    });
  }

  // Sleep-goal display refresh — mirrors refreshEditStepGoalDisplay but
  // for the Sleep habit's chip picker. Hours-formatted ("7 hours" /
  // "8.5 hours"); pluralization handled by `=== 1` check (3–14 range
  // never produces "1 hours" since min is 3, but kept defensively).
  function refreshEditSleepGoalDisplay() {
    const valueEl = document.getElementById('edit-sleepgoal-value');
    if (valueEl) {
      const h = editSleepGoal;
      valueEl.textContent = h + (h === 1 ? ' hour' : ' hours');
    }
    const isCustom = !HEALTHKIT_SLEEP_PRESETS.includes(editSleepGoal);
    document.querySelectorAll('#edit-sleepgoal .habit-edit-stepgoal-chip').forEach(chip => {
      const preset = chip.dataset.preset;
      let active;
      if (preset === 'custom') active = isCustom;
      else                     active = parseFloat(preset) === editSleepGoal;
      chip.classList.toggle('habit-edit-stepgoal-chip--active', active);
    });
  }

  function openEditModal(id) {
    const habit = habits.find(h => h.id === id);
    if (!habit) return;
    editingId     = id;
    editFormEmoji = habit.emoji || '';
    editFormDiff  = habit.difficulty || 'easy';
    document.getElementById('edit-input').value = habit.name;
    setEmojiBtn(document.getElementById('edit-emoji-btn'), editFormEmoji);
    setActiveDiff('edit-diff-row', editFormDiff);

    // Goal control — mutually exclusive between three branches:
    //   (1) step-goal chips     (canonical "Daily walk")
    //   (2) sleep-goal chips    (canonical "Sleep")
    //   (3) time/count stepper  (every other measurable habit)
    // The bedtime habit ("Sleep before midnight") is binary — none of
    // the three render for it (it's not in MEASURABLE_HABITS).
    const stepGoalEl  = document.getElementById('edit-stepgoal');
    const sleepGoalEl = document.getElementById('edit-sleepgoal');
    const goalRow     = document.getElementById('edit-goal-row');
    editStepGoalEnabled  = isStepGoalHabit(habit);
    editSleepGoalEnabled = isSleepDurationHabit(habit);

    if (editStepGoalEnabled) {
      editStepGoal = getHabitStepGoal(habit);
      stepGoalEl.hidden  = false;
      sleepGoalEl.hidden = true;
      goalRow.classList.add('hidden');
      document.getElementById('edit-stepgoal-custom').classList.add('hidden');
      refreshEditStepGoalDisplay();
    } else if (editSleepGoalEnabled) {
      editSleepGoal = getSleepGoalHours(habit);
      stepGoalEl.hidden  = true;
      sleepGoalEl.hidden = false;
      goalRow.classList.add('hidden');
      document.getElementById('edit-sleepgoal-custom').classList.add('hidden');
      refreshEditSleepGoalDisplay();
    } else {
      stepGoalEl.hidden  = true;
      sleepGoalEl.hidden = true;
      // Existing time/count stepper path.
      const m = MEASURABLE_HABITS[habit.name];
      if (m) {
        editGoalValue = habit.goal ? habit.goal.value : m.def;
        document.getElementById('edit-goal-label').textContent = habit.name + ' goal';
        refreshEditGoalDisplay();
        goalRow.classList.remove('hidden');
      } else {
        goalRow.classList.add('hidden');
      }
    }

    // Reminder section — render current state for this habit.
    refreshEditReminderUI(id);

    document.getElementById('edit-modal').classList.remove('hidden');
    document.getElementById('modal-overlay').classList.remove('hidden');
    setTimeout(() => { const i = document.getElementById('edit-input'); i.focus(); i.select(); }, 80);
  }

  // Renders the empty/set state of the Edit-Habit reminder block based
  // on whether this habit has a stored reminder time. Called on open
  // and whenever the user adds/changes/removes a reminder.
  function refreshEditReminderUI(habitId) {
    const time = Notif.reminderFor(habitId);
    const empty = document.getElementById('edit-reminder-empty');
    const setEl = document.getElementById('edit-reminder-set');
    const display = document.getElementById('edit-reminder-time-display');
    if (!empty || !setEl) return;
    if (time) {
      empty.classList.add('hidden');
      setEl.classList.remove('hidden');
      display.textContent = formatTime12(time);
      const inp = document.getElementById('edit-reminder-time-input');
      if (inp) inp.value = time;
    } else {
      empty.classList.remove('hidden');
      setEl.classList.add('hidden');
    }
  }

  // Sensible default reminder time for a habit based on its category.
  // Morning habits → 7:00, Locked-In varies, everything else → 8:00.
  function defaultReminderTimeFor(habit) {
    if (!habit) return '08:00';
    if (isMorningHabit(habit)) return '07:00';
    const evening = ['Read', 'Journal', 'Plan tomorrow the night before',
                     'No screens 1 hour before bed', 'Sleep before midnight',
                     'Review investments or trading journal'];
    if (evening.indexOf(habit.name) >= 0) return '21:00';
    if (habit.primaryStat === 'STR' && /workout|cardio|train|sprint/i.test(habit.name || '')) return '06:00';
    return '08:00';
  }

  function formatTime12(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
    if (!m) return hhmm;
    let h = parseInt(m[1], 10); const mm = m[2];
    const ampm = h >= 12 ? 'PM' : 'AM';
    if (h === 0) h = 12;
    else if (h > 12) h -= 12;
    return h + ':' + mm + ' ' + ampm;
  }

  function closeEditModal() {
    closeEmojiPicker();
    document.getElementById('edit-modal').classList.add('hidden');
    document.getElementById('modal-overlay').classList.add('hidden');
    editingId = null;
  }

  function commitEdit() {
    const name = document.getElementById('edit-input').value.trim();
    if (!name || !editingId) return;
    const habit = habits.find(h => h.id === editingId);
    if (habit) {
      habit.name = name; habit.emoji = editFormEmoji; habit.difficulty = editFormDiff;
      // Persist HealthKit goal if the modal was in step-goal OR
      // sleep-goal mode. Each is staged inline as user taps chips
      // (editStepGoal / editSleepGoal); we commit here so Cancel
      // doesn't accidentally persist a staged value.
      if (editStepGoalEnabled) {
        habit.stepGoal = editStepGoal;
        // Threshold change may immediately auto-check today if user's
        // current step count is past the new goal — clear the cache so
        // renderHabits → autoVerifyWalk re-queries fresh.
        try { Health.clearCache && Health.clearCache(); } catch (_) {}
      } else if (editSleepGoalEnabled) {
        habit.sleepGoalHours = editSleepGoal;
        // Same logic for sleep — if last night's sleep already exceeds
        // the new goal, the next renderHabits will auto-check.
        try { Health.clearSleepCache && Health.clearSleepCache(); } catch (_) {}
      } else {
        // Time/count stepper path (mutually exclusive with both above).
        const m = MEASURABLE_HABITS[habit.name];
        if (m) habit.goal = { value: editGoalValue, unit: m.unit };
      }
      save(); renderHabits();
    }
    closeEditModal();
  }

  function setupEditModal() {
    document.getElementById('modal-overlay').addEventListener('click', closeEditModal);
    document.getElementById('cancel-edit-btn').addEventListener('click', closeEditModal);
    document.getElementById('save-edit-btn').addEventListener('click', commitEdit);
    document.getElementById('edit-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') commitEdit();
      if (e.key === 'Escape') closeEditModal();
    });
    document.getElementById('edit-emoji-btn').addEventListener('click', () => {
      const btn = document.getElementById('edit-emoji-btn');
      openEmojiPicker(btn, editFormEmoji, em => { editFormEmoji = em; setEmojiBtn(btn, em); });
    });
    // Difficulty is intentionally read-only on the Edit Habit screen —
    // a habit's difficulty is a property of the canonical library entry,
    // not user-adjustable. CSS (.diff-row--locked) handles the visual.
    // No click listener attached on purpose.
    document.getElementById('edit-goal-dec').addEventListener('click', () => {
      const habit = habits.find(h => h.id === editingId);
      const m = habit && MEASURABLE_HABITS[habit.name];
      if (m && editGoalValue - m.step >= m.min) { editGoalValue -= m.step; refreshEditGoalDisplay(); }
    });
    document.getElementById('edit-goal-inc').addEventListener('click', () => {
      const habit = habits.find(h => h.id === editingId);
      const m = habit && MEASURABLE_HABITS[habit.name];
      if (m) { editGoalValue += m.step; refreshEditGoalDisplay(); }
    });

    // ── HealthKit step-goal control (Edit Habit modal) ───────
    // Preset chips stage editStepGoal in memory; commitEdit persists it
    // to habit.stepGoal. "Custom" reveals the inline numeric input.
    const stepGoalChips = document.getElementById('edit-stepgoal');
    if (stepGoalChips) {
      stepGoalChips.addEventListener('click', (e) => {
        const chip = e.target.closest('.habit-edit-stepgoal-chip');
        if (!chip) return;
        const preset = chip.dataset.preset;
        if (preset === 'custom') {
          const customRow = document.getElementById('edit-stepgoal-custom');
          customRow.classList.remove('hidden');
          const input = document.getElementById('edit-stepgoal-input');
          input.value = String(editStepGoal);
          setTimeout(() => input.focus(), 50);
          return;
        }
        const n = parseInt(preset, 10);
        if (!Number.isFinite(n)) return;
        editStepGoal = n;
        document.getElementById('edit-stepgoal-custom').classList.add('hidden');
        refreshEditStepGoalDisplay();
      });
    }
    const stepGoalSave   = document.getElementById('edit-stepgoal-save');
    const stepGoalCancel = document.getElementById('edit-stepgoal-cancel');
    const stepGoalInput  = document.getElementById('edit-stepgoal-input');
    const commitStepGoal = () => {
      if (!stepGoalInput) return;
      // Same clamping as setHabitStepGoal but applied to staging only.
      const parsed = parseInt(stepGoalInput.value, 10);
      const fallback = Number.isFinite(parsed) ? parsed : HEALTHKIT_WALK_DEFAULT_THRESHOLD;
      editStepGoal = Math.max(HEALTHKIT_WALK_THRESHOLD_MIN, Math.min(HEALTHKIT_WALK_THRESHOLD_MAX, fallback));
      document.getElementById('edit-stepgoal-custom').classList.add('hidden');
      refreshEditStepGoalDisplay();
    };
    if (stepGoalSave)  stepGoalSave.addEventListener('click', commitStepGoal);
    if (stepGoalInput) stepGoalInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') commitStepGoal(); });
    if (stepGoalCancel) {
      stepGoalCancel.addEventListener('click', () => {
        document.getElementById('edit-stepgoal-custom').classList.add('hidden');
      });
    }

    // ── HealthKit sleep-goal control (Edit Habit modal) ──────
    // Same staging/commit pattern as the step-goal control above. Chip
    // values are HOURS (string-encoded in data-preset for symmetry with
    // the step picker). Custom input accepts 0.5-step floats.
    const sleepGoalChips = document.getElementById('edit-sleepgoal');
    if (sleepGoalChips) {
      sleepGoalChips.addEventListener('click', (e) => {
        const chip = e.target.closest('.habit-edit-stepgoal-chip');
        if (!chip) return;
        const preset = chip.dataset.preset;
        if (preset === 'custom') {
          const customRow = document.getElementById('edit-sleepgoal-custom');
          customRow.classList.remove('hidden');
          const input = document.getElementById('edit-sleepgoal-input');
          input.value = String(editSleepGoal);
          setTimeout(() => input.focus(), 50);
          return;
        }
        const n = parseFloat(preset);
        if (!Number.isFinite(n)) return;
        editSleepGoal = n;
        document.getElementById('edit-sleepgoal-custom').classList.add('hidden');
        refreshEditSleepGoalDisplay();
      });
    }
    const sleepGoalSave   = document.getElementById('edit-sleepgoal-save');
    const sleepGoalCancel = document.getElementById('edit-sleepgoal-cancel');
    const sleepGoalInput  = document.getElementById('edit-sleepgoal-input');
    const commitSleepGoal = () => {
      if (!sleepGoalInput) return;
      // Same clamping logic as setSleepGoalHours, applied to staging only.
      const parsed = parseFloat(sleepGoalInput.value);
      const fallback = Number.isFinite(parsed) ? parsed : HEALTHKIT_SLEEP_DEFAULT_GOAL_HOURS;
      editSleepGoal = Math.max(HEALTHKIT_SLEEP_GOAL_MIN_HOURS, Math.min(HEALTHKIT_SLEEP_GOAL_MAX_HOURS, fallback));
      document.getElementById('edit-sleepgoal-custom').classList.add('hidden');
      refreshEditSleepGoalDisplay();
    };
    if (sleepGoalSave)  sleepGoalSave.addEventListener('click', commitSleepGoal);
    if (sleepGoalInput) sleepGoalInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') commitSleepGoal(); });
    if (sleepGoalCancel) {
      sleepGoalCancel.addEventListener('click', () => {
        document.getElementById('edit-sleepgoal-custom').classList.add('hidden');
      });
    }

    // ── Reminder picker on the Edit Habit modal ──────────────
    const addBtn    = document.getElementById('edit-reminder-add');
    const changeBtn = document.getElementById('edit-reminder-change');
    const removeBtn = document.getElementById('edit-reminder-remove');
    const timeInp   = document.getElementById('edit-reminder-time-input');

    async function ensurePermissionThenSet(time) {
      const habit = habits.find(h => h.id === editingId);
      if (!habit) return;
      const perm = await Notif.checkPermission();
      if (perm === 'granted') {
        await Notif.setReminder(habit.id, time);
        refreshEditReminderUI(habit.id);
        return;
      }
      // First time: show explainer, then request iOS permission.
      if (!Notif.permAskedBefore() || perm === 'prompt' || perm === 'default') {
        showNotifExplainer(async (ok) => {
          if (!ok) return;
          const granted = await Notif.requestPermission();
          await Notif.setReminder(habit.id, time);
          refreshEditReminderUI(habit.id);
          if (granted !== 'granted') {
            // Reminder saved, but iOS won't deliver it. Surface the limitation.
            if (typeof showHabitToast === 'function') {
              showHabitToast('Reminder saved, but notifications are off. Enable in iOS Settings → Awakened.');
            }
          }
        });
      } else {
        // Already denied — store the choice anyway, surface the message.
        await Notif.setReminder(habit.id, time);
        refreshEditReminderUI(habit.id);
        if (typeof showHabitToast === 'function') {
          showHabitToast('Notifications are off. Enable them in iOS Settings → Awakened to receive reminders.');
        }
      }
    }

    function openTimePickerWith(currentTime) {
      const habit = habits.find(h => h.id === editingId);
      const fallback = defaultReminderTimeFor(habit);
      timeInp.value = currentTime || fallback;
      // The time input is hidden but native pickers open on .showPicker()
      // (Safari/iOS) or focus + click. Try showPicker first.
      try {
        if (typeof timeInp.showPicker === 'function') timeInp.showPicker();
        else timeInp.click();
      } catch (_) { timeInp.click(); }
    }

    if (addBtn) addBtn.addEventListener('click', () => {
      const habit = habits.find(h => h.id === editingId);
      openTimePickerWith(Notif.reminderFor(editingId) || defaultReminderTimeFor(habit));
    });
    if (changeBtn) changeBtn.addEventListener('click', () => {
      openTimePickerWith(Notif.reminderFor(editingId));
    });
    if (timeInp) timeInp.addEventListener('change', () => {
      const t = timeInp.value;
      if (t) ensurePermissionThenSet(t);
    });
    if (removeBtn) removeBtn.addEventListener('click', async () => {
      await Notif.clearReminder(editingId);
      refreshEditReminderUI(editingId);
    });
  }

  // Permission explainer modal — shown once before the iOS native prompt.
  function showNotifExplainer(callback, opts) {
    opts = opts || {};
    const ov = document.getElementById('notif-explain-overlay');
    if (!ov) { callback && callback(true); return; }

    // Allow callers to override copy/labels for context (onboarding A vs.
    // in-edit prompt). Defaults are the in-edit copy that already shipped.
    const titleEl = ov.querySelector('.custom-title');
    const subEl   = ov.querySelector('.custom-sub');
    const cancelBtn = document.getElementById('notif-explain-cancel');
    const enableBtn = document.getElementById('notif-explain-enable');
    const _origTitle  = titleEl ? titleEl.innerHTML  : '';
    const _origSub    = subEl   ? subEl.innerHTML    : '';
    const _origCancel = cancelBtn ? cancelBtn.textContent : '';
    const _origEnable = enableBtn ? enableBtn.textContent : '';
    if (opts.title  && titleEl) titleEl.innerHTML = opts.title;
    if (opts.body   && subEl)   subEl.innerHTML   = opts.body;
    if (opts.cancelLabel && cancelBtn) cancelBtn.textContent = opts.cancelLabel;
    if (opts.enableLabel && enableBtn) enableBtn.textContent = opts.enableLabel;

    ov.classList.remove('hidden');
    const finish = (ok) => {
      ov.classList.add('hidden');
      // Restore originals so the next caller (e.g., in-edit) gets default copy.
      if (titleEl)  titleEl.innerHTML  = _origTitle;
      if (subEl)    subEl.innerHTML    = _origSub;
      if (cancelBtn) cancelBtn.textContent = _origCancel;
      if (enableBtn) enableBtn.textContent = _origEnable;
      try { callback && callback(ok); } catch (_) {}
    };
    cancelBtn.onclick = () => finish(false);
    enableBtn.onclick = () => finish(true);
  }

  // ── Onboarding A: ask for notification permission once, before the
  //   user starts adding habits. Skipped if we've already asked. Resolves
  //   when the user taps either button (cb is called, fire-and-forget).
  async function runOnboardingNotifPrompt(cb) {
    try {
      if (Notif.permAskedBefore && Notif.permAskedBefore()) { cb && cb(); return; }
    } catch (_) {}
    showNotifExplainer(async (ok) => {
      if (!ok) {
        // "Maybe Later" → mark BOTH the deferred flag and the
        // perm-asked flag so A never fires a second time. The spec
        // expects A to fire at most once per user.
        try {
          localStorage.setItem('hb_notif_perm_deferred', '1');
          localStorage.setItem('hb_notif_perm_requested', '1');
        } catch (_) {}
        cb && cb();
        return;
      }
      try {
        const granted = await Notif.requestPermission();
        if (granted === 'granted') {
          // Schedule the once-a-day digest at 9:00 AM by default. The
          // confirmation toast lets the user scroll the time chip to
          // change it inline, no Settings trip required.
          try { await Notif.setDailyDigest('09:00'); } catch (_) {}
          if (typeof showReminderConfirmToast === 'function') {
            showReminderConfirmToast('09:00');
          }
        } else {
          if (typeof showHabitToast === 'function') {
            showHabitToast('Reminders are off. Enable in iOS Settings → Awakened anytime.', { sticky: true });
          }
        }
      } catch (_) {}
      cb && cb();
    }, {
      title: 'Stay on Track',
      body:  'One morning reminder.<br>The rest is on you.',
      cancelLabel: 'Maybe Later',
      enableLabel: 'Enable Reminder',
    });
  }

  // ── Onboarding B: per-session offer counter so we don't spam users
  //   who keep skipping. Resets on app reload (NOT persisted). After
  //   3 consecutive skips, B no-ops for the rest of the session.
  let _reminderOfferSkipCount = 0;
  const REMINDER_OFFER_SKIP_LIMIT = 3;

  function _shouldOfferReminder() {
    return _reminderOfferSkipCount < REMINDER_OFFER_SKIP_LIMIT;
  }

  // Single-habit B: open the offer modal for one habit.
  function offerHabitReminder(habit) {
    if (!habit) return;
    if (!_shouldOfferReminder()) return;
    if (!_remOfferEls()) return;
    // If a habit already has a reminder set (e.g., user re-added something),
    // don't re-prompt.
    try { if (Notif.reminderFor && Notif.reminderFor(habit.id)) return; } catch (_) {}

    const els = _remOfferEls();
    els.title.textContent = '📲 Want a reminder for it?';
    els.sub.innerHTML     = '✅ <strong>' + esc(habit.name) + '</strong> added.<br>Pick a time and we\'ll remind you daily.';
    els.timeRow.style.display = '';
    els.timeInput.value = (typeof defaultReminderTimeFor === 'function')
      ? defaultReminderTimeFor(habit)
      : '07:00';
    els.skipBtn.textContent = 'Skip';
    els.saveBtn.textContent = 'Set Reminder';
    els.overlay.classList.remove('hidden');

    els.skipBtn.onclick = () => {
      _reminderOfferSkipCount++;
      els.overlay.classList.add('hidden');
    };
    els.saveBtn.onclick = async () => {
      _reminderOfferSkipCount = 0;
      const t = els.timeInput.value || '07:00';
      els.overlay.classList.add('hidden');
      try { await Notif.setReminder(habit.id, t); } catch (_) {}
      // If permission was denied at A, surface that the reminder won't
      // actually deliver. The reminder is still saved.
      try {
        const perm = await Notif.checkPermission();
        if (perm !== 'granted' && typeof showHabitToast === 'function') {
          showHabitToast('Reminder saved. Enable notifications in iOS Settings to receive it.');
        }
      } catch (_) {}
    };
  }

  // Pack B: ONE offer for an entire pack add. Defaults to 7:00 AM
  //   per the spec; user can adjust each habit later via Edit Habit.
  function offerPackReminders(addedHabits) {
    if (!addedHabits || !addedHabits.length) return;
    if (!_shouldOfferReminder()) return;
    if (!_remOfferEls()) return;

    const els = _remOfferEls();
    const n   = addedHabits.length;
    els.title.textContent = '📲 Set Default Reminders?';
    els.sub.innerHTML     = 'Set <strong>7:00 AM</strong> reminders for these <strong>' + n +
                            '</strong> habit' + (n === 1 ? '' : 's') +
                            '?<br>You can adjust each later in Edit Habit.';
    // Hide the time input — pack mode uses a fixed default of 07:00.
    els.timeRow.style.display = 'none';
    els.skipBtn.textContent = 'No reminders';
    els.saveBtn.textContent = 'Yes, set defaults';
    els.overlay.classList.remove('hidden');

    els.skipBtn.onclick = () => {
      _reminderOfferSkipCount++;
      els.overlay.classList.add('hidden');
    };
    els.saveBtn.onclick = async () => {
      _reminderOfferSkipCount = 0;
      els.overlay.classList.add('hidden');
      try {
        for (const h of addedHabits) {
          // defaultReminderTimeFor handles habit-specific defaults (e.g.,
          // "Sleep before midnight" → 23:00). Pack default 07:00 is used
          // only when nothing more specific applies.
          const t = (typeof defaultReminderTimeFor === 'function' ? defaultReminderTimeFor(h) : '07:00') || '07:00';
          await Notif.setReminder(h.id, t);
        }
      } catch (_) {}
      try {
        const perm = await Notif.checkPermission();
        if (perm !== 'granted' && typeof showHabitToast === 'function') {
          showHabitToast('Reminders saved. Enable notifications in iOS Settings to receive them.');
        } else if (typeof showHabitToast === 'function') {
          showHabitToast('✓ ' + n + ' reminder' + (n === 1 ? '' : 's') + ' set');
        }
      } catch (_) {}
    };
  }

  function _remOfferEls() {
    const overlay  = document.getElementById('reminder-offer-overlay');
    if (!overlay) return null;
    return {
      overlay,
      title:    document.getElementById('reminder-offer-title'),
      sub:      document.getElementById('reminder-offer-sub'),
      timeRow:  document.getElementById('reminder-offer-time-row'),
      timeInput:document.getElementById('reminder-offer-time'),
      skipBtn:  document.getElementById('reminder-offer-skip'),
      saveBtn:  document.getElementById('reminder-offer-save'),
    };
  }

  function setupReminderOfferModal() {
    const overlay = document.getElementById('reminder-offer-overlay');
    if (!overlay) return;
    // Backdrop tap = skip
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        const skip = document.getElementById('reminder-offer-skip');
        if (skip) skip.click();
      }
    });
  }

  // ── DELETE ───────────────────────────────────────────────
  function deleteHabit(id) {
    habits = habits.filter(h => h.id !== id);
    for (const d in completions) completions[d] = completions[d].filter(x => x !== id);
    delete streaks[id];
    save();
    // Permanently cancel this habit's reminder + drop it from storage.
    try { Notif.clearReminder(id); } catch (_) {}
    renderHabits();
  }

  // ── EMOJI PICKER ─────────────────────────────────────────
  function setEmojiBtn(btn, emoji) {
    if (emoji) { btn.textContent = emoji; btn.classList.add('has-emoji'); }
    else       { btn.textContent = '';    btn.classList.remove('has-emoji'); }
  }

  function openEmojiPicker(anchorBtn, currentEmoji, onSelect) {
    pickerCallback = onSelect;
    const grid = document.getElementById('emoji-grid');
    grid.innerHTML = '';
    EMOJIS.forEach(em => {
      const b = document.createElement('button');
      b.className = 'emoji-opt' + (em === currentEmoji ? ' selected' : '');
      b.textContent = em; b.type = 'button';
      b.addEventListener('click', e => { e.stopPropagation(); pickerCallback && pickerCallback(em); closeEmojiPicker(); });
      grid.appendChild(b);
    });
    const picker = document.getElementById('emoji-picker');
    picker.classList.remove('hidden');
    document.getElementById('emoji-overlay').classList.remove('hidden');
    const r = anchorBtn.getBoundingClientRect();
    const pw = 236, ph = 220;
    let left = r.left, top = r.bottom + 6;
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
    if (top + ph > window.innerHeight - 8) top = r.top - ph - 6;
    picker.style.left = Math.max(8, left) + 'px';
    picker.style.top  = Math.max(8, top)  + 'px';
  }

  function closeEmojiPicker() {
    document.getElementById('emoji-picker').classList.add('hidden');
    document.getElementById('emoji-overlay').classList.add('hidden');
    pickerCallback = null;
  }

  function setupEmojiPicker() {
    document.getElementById('emoji-overlay').addEventListener('click', closeEmojiPicker);
    document.getElementById('emoji-overlay').addEventListener('touchstart', closeEmojiPicker, { passive: true });
    document.getElementById('emoji-clear-btn').addEventListener('click', () => { pickerCallback && pickerCallback(''); closeEmojiPicker(); });
  }

  // ── DRAG & DROP — long-press to reorder ────────────────────
  // Existing implementation used a dedicated 6-dot handle. This rewrite
  // adds long-press (400ms hold on the card body) as the primary trigger
  // while keeping the [data-drag] handle as an instant-drag fallback.
  // Order persists via the in-memory `habits` array → save() → hb_habits
  // localStorage. Pack streaks (MR, LI) are pack-membership-based, not
  // list-position-based, so visual reorder doesn't affect them.
  const LONG_PRESS_MS         = 400;
  const LP_MOVE_THRESHOLD     = 10;     // px — finger movement that cancels long-press
  const DRAG_IDLE_TIMEOUT_MS  = 1500;   // exit drag mode if no movement after this
  const AUTOSCROLL_EDGE       = 80;     // px from viewport edge that triggers scroll
  const POST_DROP_GUARD_MS    = 200;    // suppress immediate re-trigger after a drop

  let drag = null;
  let _postDropGuardUntil = 0;

  function bindDrag() {
    const list = document.getElementById('habit-list');
    if (!list) return;
    // Long-press on the entire card body — primary trigger.
    list.querySelectorAll('.habit-item[data-id]').forEach(item => {
      attachLongPressDrag(item);
    });
    // Instant-drag from the dedicated 6-dot handle (preserved as fallback).
    list.querySelectorAll('[data-drag]').forEach(handle => {
      handle.addEventListener('touchstart', onHandleStart, { passive: false });
      handle.addEventListener('mousedown',  onHandleStart);
    });
  }

  function clientPos(e) {
    if (e.touches && e.touches.length)               return { x: e.touches[0].clientX,        y: e.touches[0].clientY };
    if (e.changedTouches && e.changedTouches.length) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    return { x: e.clientX, y: e.clientY };
  }

  function attachLongPressDrag(item) {
    const onStart = (e) => {
      if (Date.now() < _postDropGuardUntil) return;
      // Skip if the press starts on an interactive sub-element. Tapping
      // those should still feel like a tap, not a wait-for-drag.
      if (e.target.closest('[data-drag]')) return;       // dedicated handle owns its own path
      if (e.target.closest('[data-more]')) return;       // "more" menu button
      if (e.target.closest('.habit-cb'))    return;      // checkbox itself

      const isTouch = e.type === 'touchstart';
      if (!isTouch && e.button !== 0) return;

      const start = clientPos(e);
      let canceled  = false;
      let triggered = false;
      item.classList.add('lp-pressing');

      const pressTimer = setTimeout(() => {
        if (canceled) return;
        triggered = true;
        item.classList.remove('lp-pressing');
        // Convert the long-press into an active drag.
        enterDragMode(item, start, isTouch);
      }, LONG_PRESS_MS);

      const onMove = (me) => {
        const mp = clientPos(me);
        if (Math.abs(mp.x - start.x) > LP_MOVE_THRESHOLD ||
            Math.abs(mp.y - start.y) > LP_MOVE_THRESHOLD) {
          canceled = true;
          clearTimeout(pressTimer);
          cleanup();
        }
      };
      const onEnd = () => {
        if (!triggered) {
          // User released before long-press fired — let the click bubble normally.
          canceled = true;
          clearTimeout(pressTimer);
        }
        cleanup();
      };
      function cleanup() {
        item.classList.remove('lp-pressing');
        if (isTouch) {
          document.removeEventListener('touchmove',   onMove);
          document.removeEventListener('touchend',    onEnd);
          document.removeEventListener('touchcancel', onEnd);
        } else {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup',   onEnd);
        }
      }
      if (isTouch) {
        document.addEventListener('touchmove',   onMove, { passive: true });
        document.addEventListener('touchend',    onEnd,  { once: true });
        document.addEventListener('touchcancel', onEnd,  { once: true });
      } else {
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',   onEnd, { once: true });
      }
    };
    item.addEventListener('touchstart', onStart, { passive: true });
    item.addEventListener('mousedown',  onStart);
  }

  // Dedicated-handle path: skip the 400ms long-press, drag immediately.
  function onHandleStart(e) {
    const isTouch = e.type === 'touchstart';
    if (!isTouch && e.button !== 0) return;
    if (isTouch) e.preventDefault();
    const item = e.currentTarget.closest('[data-id]');
    if (!item) return;
    enterDragMode(item, clientPos(e), isTouch);
  }

  function enterDragMode(item, startPos, isTouch) {
    if (drag) return; // already dragging
    const list = document.getElementById('habit-list');
    const rect = item.getBoundingClientRect();
    const ghost = item.cloneNode(true);
    ghost.className = 'habit-item drag-ghost';
    ghost.style.width = rect.width + 'px';
    ghost.style.left  = rect.left  + 'px';
    ghost.style.top   = rect.top   + 'px';
    document.body.appendChild(ghost);
    item.classList.add('drag-placeholder');
    list.classList.add('is-dragging');

    // Prevent body scroll + selection while dragging.
    const bodyOverflow = document.body.style.overflow;
    document.body.style.userSelect       = 'none';
    document.body.style.webkitUserSelect = 'none';
    document.body.style.cursor           = 'grabbing';
    document.body.style.overflow         = 'hidden';

    drag = {
      id:           item.dataset.id,
      item,
      ghost,
      // The grid is 3-column, so the ghost has to follow both axes.
      offsetX:      startPos.x - rect.left,
      offsetY:      startPos.y - rect.top,
      isTouch,
      lastX:        startPos.x,
      lastY:        startPos.y,
      bodyOverflow,
      idleTimer:    null,
      autoScrollRAF: null,
    };
    resetIdleTimer();
    startAutoScrollLoop();

    navigator.vibrate && navigator.vibrate(50);

    if (isTouch) {
      document.addEventListener('touchmove',   onDragMove, { passive: false });
      document.addEventListener('touchend',    onDragEnd,  { once: true });
      document.addEventListener('touchcancel', onDragEnd,  { once: true });
    } else {
      document.addEventListener('mousemove', onDragMove);
      document.addEventListener('mouseup',   onDragEnd, { once: true });
    }
  }

  function onDragMove(e) {
    if (!drag) return;
    if (e.type === 'touchmove') e.preventDefault();
    const { x, y } = clientPos(e);
    drag.lastX = x;
    drag.lastY = y;
    drag.ghost.style.left = (x - drag.offsetX) + 'px';
    drag.ghost.style.top  = (y - drag.offsetY) + 'px';
    resetIdleTimer();
    const items = getOtherItems();
    items.forEach(el => el.classList.remove('drop-target--before', 'drop-target--after'));
    const target = findDropTarget(items, x, y);
    if (target) target.el.classList.add(target.before ? 'drop-target--before' : 'drop-target--after');
  }

  function onDragEnd(e) {
    if (!drag) return;
    const isTouch = drag.isTouch;
    if (isTouch) document.removeEventListener('touchmove', onDragMove);
    else         document.removeEventListener('mousemove', onDragMove);

    // Restore body styles
    document.body.style.userSelect       = '';
    document.body.style.webkitUserSelect = '';
    document.body.style.cursor           = '';
    document.body.style.overflow         = drag.bodyOverflow || '';

    // Stop helpers
    clearTimeout(drag.idleTimer);
    if (drag.autoScrollRAF) cancelAnimationFrame(drag.autoScrollRAF);

    const items = getOtherItems();
    items.forEach(el => el.classList.remove('drop-target--before', 'drop-target--after'));

    const { x, y } = clientPos(e);
    const target = findDropTarget(items, x, y);
    if (target && target.el.dataset.id !== drag.id) {
      const fromIdx = habits.findIndex(h => h.id === drag.id);
      const [moved] = habits.splice(fromIdx, 1);
      const toIdx   = habits.findIndex(h => h.id === target.el.dataset.id);
      habits.splice(target.before ? toIdx : toIdx + 1, 0, moved);
      save();
      navigator.vibrate && navigator.vibrate(15);
    }
    drag.ghost.remove();
    drag.item.classList.remove('drag-placeholder');
    drag = null;
    document.getElementById('habit-list').classList.remove('is-dragging', 'reorder-mode');
    _postDropGuardUntil = Date.now() + POST_DROP_GUARD_MS;
    renderHabits();
  }

  function resetIdleTimer() {
    if (!drag) return;
    if (drag.idleTimer) clearTimeout(drag.idleTimer);
    drag.idleTimer = setTimeout(() => {
      // No movement for too long — exit drag silently, no reorder.
      cancelDragSilently();
    }, DRAG_IDLE_TIMEOUT_MS);
  }

  function cancelDragSilently() {
    if (!drag) return;
    document.removeEventListener('touchmove', onDragMove);
    document.removeEventListener('mousemove', onDragMove);
    document.body.style.userSelect       = '';
    document.body.style.webkitUserSelect = '';
    document.body.style.cursor           = '';
    document.body.style.overflow         = drag.bodyOverflow || '';
    if (drag.autoScrollRAF) cancelAnimationFrame(drag.autoScrollRAF);
    const items = getOtherItems();
    items.forEach(el => el.classList.remove('drop-target--before', 'drop-target--after'));
    drag.ghost.remove();
    drag.item.classList.remove('drag-placeholder');
    drag = null;
    document.getElementById('habit-list').classList.remove('is-dragging', 'reorder-mode');
    _postDropGuardUntil = Date.now() + POST_DROP_GUARD_MS;
  }

  function startAutoScrollLoop() {
    // The Habits panel itself scrolls (#main-scroll). Fall back to
    // window scroll if for some reason that element is unavailable.
    const scroller = document.getElementById('main-scroll') || document.scrollingElement || document.documentElement;
    function tick() {
      if (!drag) return;
      const y    = drag.lastY;
      const top  = AUTOSCROLL_EDGE;
      const bot  = window.innerHeight - AUTOSCROLL_EDGE;
      let dy = 0;
      if (y < top)      dy = -Math.max(2, (top - y) / 6);
      else if (y > bot) dy =  Math.max(2, (y - bot) / 6);
      if (dy !== 0 && scroller && typeof scroller.scrollTop === 'number') {
        scroller.scrollTop += dy;
      }
      drag.autoScrollRAF = requestAnimationFrame(tick);
    }
    drag.autoScrollRAF = requestAnimationFrame(tick);
  }

  function getOtherItems() {
    return [...document.getElementById('habit-list').querySelectorAll('[data-id]')]
      .filter(el => !el.classList.contains('drag-placeholder'));
  }

  // 2D drop targeting for the 3-column grid layout. Pick the cell whose
  // center is closest to the cursor (Euclidean), then split it: cursor
  // on the LEFT half = drop "before" this cell in the linear habit array,
  // RIGHT half = "after". This gives 2N insertion slots for N visible
  // cells and naturally handles drops between rows or off the grid edge.
  function findDropTarget(items, clientX, clientY) {
    if (!items.length) return null;
    let best = null;
    let bestDist = Infinity;
    for (const el of items) {
      const r  = el.getBoundingClientRect();
      const cx = r.left + r.width  / 2;
      const cy = r.top  + r.height / 2;
      const dx = clientX - cx;
      const dy = clientY - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist) {
        bestDist = d2;
        best     = { el, cx };
      }
    }
    if (!best) return null;
    return { el: best.el, before: clientX < best.cx };
  }

  // ── STAT DETAIL SHEET ────────────────────────────────────
  // Build a quick emoji+difficulty lookup from DEFAULT_HABITS
  const _habitMeta = {};
  DEFAULT_HABITS.forEach(h => { _habitMeta[h.name] = { emoji: h.emoji, difficulty: h.difficulty }; });

  function openStatDetail(statId) {
    const st     = STATS.find(s => s.id === statId);
    if (!st) return;
    const stPts  = stats[st.id]?.pts || 0;
    const level  = statLevel(stPts);
    const lvXP   = xpForLevel(level);
    const ptsIn  = stPts - lvXP;
    const needed = xpToNextLevel(level);
    const pct    = level >= 20 ? 100 : Math.min(100, Math.round((ptsIn / needed) * 100));
    const toNext = level >= 20 ? 0 : needed - ptsIn;

    const sheet  = document.getElementById('stat-detail-sheet');
    const glow   = st.color + '20';

    // Track which stat is open so the delegated Add handler knows
    // which stat's habit list to refresh after an add.
    sheet.dataset.statId = st.id;

    // Set CSS colour variables
    sheet.style.setProperty('--sd-color', st.color);
    sheet.style.setProperty('--sd-glow',  glow);

    // Header
    document.getElementById('stat-detail-badge').style.background  = st.color + '18';
    document.getElementById('stat-detail-badge').style.borderColor = st.color;
    setStatIcon(document.getElementById('stat-detail-icon'), st, 56); // Stat Detail sheet header
    document.getElementById('stat-detail-label').textContent = st.label;
    document.getElementById('stat-detail-name').textContent  = st.name;
    document.getElementById('stat-detail-level').textContent =
      'Level ' + level + (level >= 20 ? '  ·  MAX 👑' : '');

    // Progress bar (animate after paint; gold when maxed)
    const bar    = document.getElementById('stat-detail-prog-bar');
    const barClr = level >= 20 ? '#f59e0b' : st.color;
    bar.style.background = barClr;
    bar.style.boxShadow  = '0 0 8px ' + barClr;
    bar.style.width      = '0%';
    document.getElementById('stat-detail-pts').textContent    = ptsIn + ' XP';
    document.getElementById('stat-detail-tonext').textContent =
      level >= 20 ? 'MAX LEVEL' : toNext + ' XP to Level ' + (level + 1);

    // XP summary row
    document.getElementById('stat-detail-cur-xp').textContent   = ptsIn.toLocaleString() + ' XP';
    document.getElementById('stat-detail-total-xp').textContent = stPts.toLocaleString() + ' XP';

    // Description
    document.getElementById('stat-detail-desc').textContent = STAT_DESCRIPTIONS[st.id] || '';

    // Linked habits — each row shows an Add button if the user doesn't
    // have the habit yet, or an "Active" indicator if they do. Tap → add.
    renderStatDetailHabits(st);

    // Show sheet
    document.getElementById('stat-detail-overlay').classList.remove('hidden');
    sheet.classList.remove('hidden');
    requestAnimationFrame(() => {
      sheet.classList.add('sd-open');
      setTimeout(() => { bar.style.width = pct + '%'; }, 80);
    });

    navigator.vibrate && navigator.vibrate(8);
  }

  function closeStatDetail() {
    const sheet   = document.getElementById('stat-detail-sheet');
    const overlay = document.getElementById('stat-detail-overlay');
    sheet.classList.remove('sd-open');
    sheet.addEventListener('transitionend', () => {
      sheet.classList.add('hidden');
      overlay.classList.add('hidden');
    }, { once: true });
  }

  // Render the linked-habits list for a given stat. Each row gets either
  // a "+ Add" tap target (if the user doesn't have the habit) or a muted
  // "✓ Active" badge (if they do). Used both on initial open and after
  // an in-sheet add to refresh state.
  function renderStatDetailHabits(st) {
    const listEl = document.getElementById('stat-detail-habits');
    if (!listEl) return;
    const activeNames = new Set(habits.map(h => h.name));
    listEl.innerHTML = st.habits.map(name => {
      const meta = _habitMeta[name] || { emoji: '', difficulty: 'medium' };
      const have = activeNames.has(name);
      const ctrl = have
        ? '<span class="sdh-active" aria-label="Already in your habits">✓ Active</span>'
        : '<button class="sdh-add-btn" data-add-habit="' + esc(name) + '" aria-label="Add ' + esc(name) + ' to your habits">+ Add</button>';
      // Synthesize a habit-like object for habitIconHtml — _habitMeta
      // only stores { emoji, difficulty }, but the helper just needs
      // .name and .emoji to decide between PNG and emoji fallback.
      const habitLike = { name, emoji: meta.emoji };
      return '<div class="sdh-row' + (have ? ' sdh-row--have' : '') + '">' +
        '<span class="sdh-emoji">' + habitIconHtml(habitLike, { size: 20 }) + '</span>' +
        '<span class="sdh-name">'  + esc(name) + '</span>' +
        '<span class="diff-badge ' + meta.difficulty + '">' + DIFFICULTY[meta.difficulty].label + '</span>' +
        ctrl +
      '</div>';
    }).join('');
  }

  // Adds a canonical habit to the user's active list (idempotent).
  // Called when the user taps "+ Add" on a linked-habit row in the
  // stat detail sheet. Refreshes the row in place.
  function addHabitFromStatSheet(name, statId) {
    if (habits.some(h => h.name === name)) return;
    const def = DEFAULT_HABITS.find(d => d.name === name);
    if (!def) return;
    const newH = {
      id:          uid(),
      emoji:       def.emoji,
      name:        def.name,
      difficulty:  def.difficulty,
      type:        def.type || 'build',
      primaryStat: def.primaryStat,
    };
    habits.push(newH);
    if (def.note) habitNotes[newH.id] = def.note;
    save();
    renderHabits();
    updateMorningButtonVisibility();
    updateLockedInButtonVisibility();
    // Re-render the linked-habits list so the row flips to "Active"
    const st = STATS.find(s => s.id === statId);
    if (st) renderStatDetailHabits(st);
    showHabitToast(name + ' added');
  }

  function setupStatDetail() {
    document.getElementById('stat-detail-close').addEventListener('click',   closeStatDetail);
    document.getElementById('stat-detail-overlay').addEventListener('click', closeStatDetail);

    // Delegated tap on any "+ Add" button inside the linked-habits list.
    // Looks up the current stat from the sheet to refresh the row in place.
    const sheet = document.getElementById('stat-detail-sheet');
    if (sheet) {
      sheet.addEventListener('click', e => {
        const t = e.target;
        if (!t || !t.closest) return;
        const btn = t.closest('[data-add-habit]');
        if (!btn) return;
        e.stopPropagation();
        e.preventDefault();
        const name = btn.getAttribute('data-add-habit');
        // Stat ID is captured from the sheet's currently-rendered context
        // by reading the title's stat label (set by openStatDetail).
        const statId = sheet.dataset.statId || '';
        addHabitFromStatSheet(name, statId);
      });
    }

    // Swipe-down-to-dismiss
    if (typeof attachSheetDismissGesture === 'function') {
      const sd = document.getElementById('stat-detail-sheet');
      const so = document.getElementById('stat-detail-overlay');
      // Direct hide — gesture has already animated the slide-down, so we
      // skip closeStatDetail (which waits for its own transitionend that
      // won't fire because the sheet is already off-screen).
      attachSheetDismissGesture(sd, so, () => {
        sd.classList.add('hidden');
        so.classList.add('hidden');
      }, {
        baseTransform:  'translateX(-50%) ',
        handleSelector: '.stat-detail-drag-handle, .stat-detail-header',
        openClass:      'sd-open',
        scrollTarget:   '.stat-detail-habits-list',
      });
    }
  }

  // ── SETTINGS & RESET ─────────────────────────────────────
  function openSettings() {
    const sheet = document.getElementById('settings-sheet');
    document.getElementById('settings-overlay').classList.remove('hidden');
    sheet.classList.remove('hidden');
    requestAnimationFrame(() => sheet.classList.add('ss-open'));
  }

  function closeSettings() {
    const sheet = document.getElementById('settings-sheet');
    sheet.classList.remove('ss-open');
    sheet.addEventListener('transitionend', () => {
      sheet.classList.add('hidden');
      document.getElementById('settings-overlay').classList.add('hidden');
    }, { once: true });
  }

  // ── BOTTOM-SHEET DISMISS GESTURE (reusable) ──────────────
  // Attaches swipe/drag-down-to-dismiss to a bottom sheet element.
  //   sheet         — the sheet DOM element (must already be styled as bottom sheet)
  //   overlay       — backdrop element to fade (or null)
  //   onDismiss     — callback to fully hide sheet+overlay after slide-out completes
  //   opts:
  //     baseTransform     — base transform string preserved during drag (default 'translateX(-50%) ')
  //     handleSelector    — CSS selector for top "drag-zone" elements (drag works from these even
  //                         when content is scrolled). Anywhere else, we only drag if scrollTop===0.
  //     dismissThreshold  — fraction of sheet height beyond which release dismisses (default 0.30)
  //     flickVelocity     — px/ms downward velocity that counts as a "flick" (default 0.6)
  //     openClass         — class indicating sheet is open (default 'ss-open')
  function attachSheetDismissGesture(sheet, overlay, onDismiss, opts) {
    opts = opts || {};
    const baseTransform    = opts.baseTransform    || 'translateX(-50%) ';
    const handleSelector   = opts.handleSelector   || '.settings-drag-handle, .settings-header';
    const dismissThreshold = opts.dismissThreshold || 0.30;
    const flickVelocity    = opts.flickVelocity    || 0.6;
    const openClass        = opts.openClass        || 'ss-open';
    // Optional inner scrollable child selector. When the sheet has
    // overflow: hidden and a nested scrollable element (e.g., lib-sheet
    // wraps lib-list), point this at that child so we can correctly tell
    // whether the user is at the top vs scrolling content.
    const scrollTargetSel  = opts.scrollTarget     || null;

    let startY = 0, lastY = 0, lastTime = 0, velocity = 0;
    let dragging = false, allowDrag = false, mouseDown = false;

    function getY(e) { return e.touches ? e.touches[0].clientY : e.clientY; }

    function getScrollEl() {
      if (!scrollTargetSel) return sheet;
      return sheet.querySelector(scrollTargetSel) || sheet;
    }

    function onStart(e) {
      if (sheet.classList.contains('hidden')) return;
      startY   = getY(e);
      lastY    = startY;
      lastTime = e.timeStamp || Date.now();
      velocity = 0;
      dragging = false;

      // Allow drag-to-dismiss only if user starts in the header/handle region,
      // OR the sheet's internal scroll is already at the very top.
      // Otherwise this is a regular content scroll — don't hijack it.
      const inHandle = e.target && e.target.closest && e.target.closest(handleSelector);
      const scrollEl = getScrollEl();
      const atTop    = scrollEl.scrollTop <= 0;
      allowDrag = !!inHandle || atTop;
    }

    function onMove(e) {
      if (!allowDrag || sheet.classList.contains('hidden')) return;
      const y  = getY(e);
      const dy = y - startY;

      // Only track downward movement
      if (dy <= 0) {
        if (dragging) {
          // User reversed direction — let it snap back gently
          sheet.style.transition = 'transform 0.18s ease-out';
          sheet.style.transform  = '';
          if (overlay) overlay.style.opacity = '';
          dragging = false;
        }
        return;
      }

      if (!dragging) {
        dragging = true;
        sheet.style.transition = 'none';
        if (overlay) overlay.style.transition = 'none';
      }

      // Suppress native scroll/rubber-band while we drag
      if (e.cancelable) e.preventDefault();

      sheet.style.transform = baseTransform + 'translateY(' + dy + 'px)';

      if (overlay) {
        const sheetH = sheet.offsetHeight || 1;
        const fade   = Math.min(1, dy / sheetH);
        overlay.style.opacity = String(1 - fade * 0.85);
      }

      // Track instantaneous velocity for flick detection
      const now = e.timeStamp || Date.now();
      const dt  = now - lastTime;
      if (dt > 0) velocity = (y - lastY) / dt;
      lastY    = y;
      lastTime = now;
    }

    function onEnd() {
      mouseDown = false;
      if (!dragging) return;
      dragging = false;

      const dy            = lastY - startY;
      const sheetH        = sheet.offsetHeight || 1;
      const overThreshold = dy > sheetH * dismissThreshold;
      const flicked       = velocity > flickVelocity;

      if (overThreshold || flicked) {
        // Slide the rest of the way down, then run dismiss callback
        sheet.style.transition = 'transform 0.22s ease-in';
        sheet.style.transform  = baseTransform + 'translateY(' + sheetH + 'px)';
        if (overlay) {
          overlay.style.transition = 'opacity 0.22s ease-in';
          overlay.style.opacity    = '0';
        }
        sheet.addEventListener('transitionend', function done() {
          // Order matters: call onDismiss first so the sheet is hidden
          // (display:none) BEFORE we clear inline transforms — otherwise
          // sheets without an openClass would briefly snap back to their
          // base on-screen position.
          sheet.classList.remove(openClass);
          if (typeof onDismiss === 'function') onDismiss();
          sheet.style.transition = '';
          sheet.style.transform  = '';
          if (overlay) {
            overlay.style.transition = '';
            overlay.style.opacity    = '';
          }
        }, { once: true });
      } else {
        // Snap back to fully open
        sheet.style.transition = 'transform 0.25s ease-out';
        sheet.style.transform  = '';
        if (overlay) {
          overlay.style.transition = 'opacity 0.25s ease-out';
          overlay.style.opacity    = '';
        }
        sheet.addEventListener('transitionend', function done() {
          sheet.style.transition = '';
          if (overlay) overlay.style.transition = '';
        }, { once: true });
      }
    }

    // Touch
    sheet.addEventListener('touchstart',  onStart, { passive: true  });
    sheet.addEventListener('touchmove',   onMove,  { passive: false }); // need preventDefault
    sheet.addEventListener('touchend',    onEnd,   { passive: true  });
    sheet.addEventListener('touchcancel', onEnd,   { passive: true  });

    // Mouse (desktop PWA)
    sheet.addEventListener('mousedown', e => { mouseDown = true; onStart(e); });
    document.addEventListener('mousemove', e => { if (mouseDown) onMove(e); });
    document.addEventListener('mouseup',   ()   => { if (mouseDown) onEnd();   });
  }

  function showReset1() {
    closeSettings();
    // Small delay so settings sheet closes first
    setTimeout(() => {
      document.getElementById('reset1-overlay').classList.remove('hidden');
      document.getElementById('reset1-modal').classList.remove('hidden');
    }, 180);
  }

  function closeReset1() {
    document.getElementById('reset1-overlay').classList.add('hidden');
    document.getElementById('reset1-modal').classList.add('hidden');
  }

  function showReset2() {
    closeReset1();
    const input = document.getElementById('reset-type-input');
    input.value = '';
    input.classList.remove('valid');
    document.getElementById('reset2-confirm').disabled = true;
    document.getElementById('reset2-overlay').classList.remove('hidden');
    document.getElementById('reset2-modal').classList.remove('hidden');
    setTimeout(() => input.focus(), 120);
  }

  function closeReset2() {
    document.getElementById('reset2-overlay').classList.add('hidden');
    document.getElementById('reset2-modal').classList.add('hidden');
  }

  function performReset() {
    // Clear all hb_ keys from localStorage
    Object.keys(localStorage)
      .filter(k => k.startsWith('hb_'))
      .forEach(k => localStorage.removeItem(k));
    // Hard reload → welcome screen shows for fresh user
    location.href = location.href.split('?')[0] + '?r=' + Date.now();
  }

  // ── CHECK FOR UPDATES ────────────────────────────────────
  // Belt-and-suspenders update detection:
  //   1) Ask the SW to re-check by calling reg.update() and listening for
  //      the standard 'updatefound' / 'statechange' events.
  //   2) IN PARALLEL, fetch sw.js directly with a cache-busting query and
  //      parse out CACHE_VERSION. If it differs from what we have stored
  //      from the last successful registration, treat that as an update —
  //      even if the SW system didn't fire 'updatefound' (race condition,
  //      Safari quirk, byte-compare false-negative).
  //   3) If everything reports stale, treat as up-to-date.
  //
  // When an update IS detected, we wipe ALL caches before reloading so the
  // new SW pre-caches from the network instead of inheriting a stale entry
  // through the cache-first fetch handler.
  const SW_KNOWN_VERSION_KEY = 'hb_sw_known_version';

  function parseSwVersion(text) {
    // Match: const CACHE_VERSION = 'v4.90';
    const m = text.match(/CACHE_VERSION\s*=\s*['"]([^'"]+)['"]/);
    return m ? m[1] : null;
  }

  function checkForUpdates() {
    const btn   = document.getElementById('update-check-btn');
    const label = document.getElementById('update-check-label');
    if (!btn || !label) return;

    btn.disabled = true;
    btn.classList.add('update-btn--checking');
    label.textContent = 'Checking...';

    // No SW support → treat as up to date
    if (!('serviceWorker' in navigator)) {
      setTimeout(resolveUpToDate, 600);
      return;
    }

    let resolved = false;

    // ── Path A: standard SW update check ─────────────────────
    const swPath = navigator.serviceWorker.getRegistration().then(reg => {
      if (!reg) return;
      if (reg.waiting) { resolveUpdateFound(reg.waiting); return; }

      // Listen for a NEW worker entering the installing state
      const onUpdateFound = () => {
        const incoming = reg.installing;
        if (!incoming) return;
        const onStateChange = () => {
          if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
            incoming.removeEventListener('statechange', onStateChange);
            resolveUpdateFound(incoming);
          }
        };
        incoming.addEventListener('statechange', onStateChange);
      };
      reg.addEventListener('updatefound', onUpdateFound);
      // ALSO check if a worker is already installing right now (race-safe)
      if (reg.installing) onUpdateFound();
      return reg.update().catch(() => {});
    }).catch(() => {});

    // ── Path B: direct version-string comparison (fallback) ──
    const versionPath = fetch('sw.js?_=' + Date.now(), { cache: 'no-store' })
      .then(r => r.ok ? r.text() : '')
      .then(parseSwVersion)
      .catch(() => null);

    // Wait for either path to settle, with a 4-second ceiling so the
    // user always gets feedback even on flaky networks.
    Promise.allSettled([swPath, versionPath, wait(2500)]).then(async () => {
      if (resolved) return;
      const liveVersion   = await versionPath;
      const knownVersion  = (() => {
        try { return localStorage.getItem(SW_KNOWN_VERSION_KEY); } catch (_) { return null; }
      })();
      if (liveVersion && knownVersion && liveVersion !== knownVersion) {
        // Version drift detected — force a hard refresh path. This handles
        // the case where the SW is "controlling" us with a stale CACHE_VERSION
        // but we have an even newer sw.js sitting on the server that didn't
        // get registered as an update for whatever reason.
        return forceHardRefresh(liveVersion);
      }
      resolveUpToDate();
    });

    function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

    function resolveUpdateFound(worker) {
      if (resolved) return;
      resolved = true;
      btn.classList.remove('update-btn--checking');
      btn.classList.add('update-btn--found');
      label.textContent = 'Update found! Reloading...';
      setTimeout(() => {
        // Wipe caches first so the new SW activates with a clean slate.
        // controllerchange handler in registerSW() calls location.reload()
        // once the new SW takes over.
        clearAllCaches().finally(() => {
          worker.postMessage({ type: 'SKIP_WAITING' });
        });
      }, 1200);
    }

    async function forceHardRefresh(newVersion) {
      if (resolved) return;
      resolved = true;
      btn.classList.remove('update-btn--checking');
      btn.classList.add('update-btn--found');
      label.textContent = 'Update found! Reloading...';
      try { localStorage.setItem(SW_KNOWN_VERSION_KEY, newVersion); } catch (_) {}
      try {
        await clearAllCaches();
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map(r => r.unregister()));
        }
      } catch (_) {}
      setTimeout(() => location.reload(), 800);
    }

    function clearAllCaches() {
      if (!window.caches) return Promise.resolve();
      return caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
    }

    function resolveUpToDate() {
      if (resolved) return;
      resolved = true;
      btn.classList.remove('update-btn--checking');
      btn.classList.add('update-btn--uptodate');
      label.textContent = "You're up to date ✓";
      btn.disabled = false;
      setTimeout(() => {
        btn.classList.remove('update-btn--uptodate');
        label.textContent = 'Check for Updates';
      }, 2000);
    }
  }

  function setupSettings() {
    // Apply sound state on open
    document.getElementById('settings-btn').addEventListener('click', () => {
      document.getElementById('sound-toggle').setAttribute('aria-checked', soundEnabled ? 'true' : 'false');
      // Refresh the Reminders panel each time Settings opens — the
      // permission state, paused-until timestamp, and active count can
      // all change between opens.
      refreshRemindersPanel();
      // Refresh the Apple Health panel each time Settings opens — the
      // user may have changed permission state in iOS Settings between
      // opens, and the header summary needs to reflect that immediately.
      refreshHealthPanel();
      openSettings();
    });

    // Sound toggle
    document.getElementById('sound-toggle').addEventListener('click', () => {
      soundEnabled = !soundEnabled;
      localStorage.setItem('hb_sound', soundEnabled ? 'on' : 'off');
      document.getElementById('sound-toggle').setAttribute('aria-checked', soundEnabled ? 'true' : 'false');
    });
    // Close settings
    document.getElementById('settings-close').addEventListener('click', closeSettings);
    document.getElementById('settings-overlay').addEventListener('click', closeSettings);

    // Swipe-down-to-dismiss gesture (iOS-style)
    const ssSheet   = document.getElementById('settings-sheet');
    const ssOverlay = document.getElementById('settings-overlay');
    attachSheetDismissGesture(ssSheet, ssOverlay, () => {
      // Same end-state the X button produces — sheet & overlay hidden.
      ssSheet.classList.add('hidden');
      ssOverlay.classList.add('hidden');
    });
    // Check for updates
    document.getElementById('update-check-btn').addEventListener('click', checkForUpdates);
    // Open reset step 1
    document.getElementById('reset-open-btn').addEventListener('click', showReset1);
    // Step 1 buttons
    document.getElementById('reset1-cancel').addEventListener('click', closeReset1);
    document.getElementById('reset1-overlay').addEventListener('click', closeReset1);
    document.getElementById('reset1-continue').addEventListener('click', showReset2);
    // Step 2 buttons
    document.getElementById('reset2-cancel').addEventListener('click', closeReset2);
    document.getElementById('reset2-overlay').addEventListener('click', closeReset2);
    document.getElementById('reset2-confirm').addEventListener('click', performReset);
    // Live validation: only "RESET" (exact, uppercase) enables the button
    document.getElementById('reset-type-input').addEventListener('input', e => {
      const valid = e.target.value === 'RESET';
      e.target.classList.toggle('valid', valid);
      document.getElementById('reset2-confirm').disabled = !valid;
    });

    // ── Settings → Reminders panel wiring ────────────────────
    setupReminderSettings();
    // ── Settings → Apple Health panel wiring (v1.1.6) ────────
    setupHealthSettings();
    // ── Generic collapsible setup (Appearance / Reminders / Health / Coming) ──
    setupCollapsibleSettings();
  }

  // Builds + wires the Settings → Reminders panel. Each control writes
  // to the relevant Notif.* setter, then we re-run rescheduleAll so the
  // change takes effect immediately.
  async function rescheduleNow() {
    try { await Notif.rescheduleAll(habits, today, completions[today] || []); } catch (_) {}
    refreshRemindersPanel();
  }

  function refreshRemindersPanel() {
    if (!document.getElementById('settings-rem-permission')) return;
    Notif.checkPermission().then(perm => {
      const lbl = document.getElementById('settings-rem-permission');
      const enableBtn = document.getElementById('settings-rem-enable');
      const webNote   = document.getElementById('settings-rem-web-note');
      const status = Notif.status();
      // Permission label
      const display = perm === 'granted' ? 'Granted ✓' :
                      perm === 'denied'  ? 'Denied'    :
                      perm === 'unsupported' ? 'Not supported here' :
                      'Not set';
      lbl.textContent = display;
      lbl.className = 'settings-rem-value' +
        (perm === 'granted' ? ' granted' : perm === 'denied' ? ' denied' : '');
      // Enable button visible when not yet granted (and on a native build)
      if (status.isNative && perm !== 'granted' && perm !== 'unsupported') {
        enableBtn.classList.remove('hidden');
      } else {
        enableBtn.classList.add('hidden');
      }
      // Soft message for web (non-iOS) users
      if (!status.isNative) webNote.classList.remove('hidden');
      else                   webNote.classList.add('hidden');

      // Daily morning reminder (the digest) — button shows formatted time
      const digestBtn   = document.getElementById('settings-rem-digest-btn');
      const digestClear = document.getElementById('settings-rem-digest-clear');
      if (digestBtn) {
        const t = status.digestTime || '09:00';
        const [hStr, mStr] = t.split(':');
        const h = parseInt(hStr, 10) || 0;
        const m = parseInt(mStr, 10) || 0;
        const pm = h >= 12;
        const h12 = ((h % 12) || 12);
        digestBtn.textContent = h12 + ':' + String(m).padStart(2, '0') + ' ' + (pm ? 'PM' : 'AM');
      }
      if (digestClear) digestClear.classList.toggle('hidden', !status.digestTime);

      // (Daily limit row removed in v1.1.3 — see Notif.dailyLimit comment.)

      // Quiet hours
      document.getElementById('settings-rem-quiet-toggle').setAttribute('aria-checked', status.quietOn ? 'true' : 'false');
      document.getElementById('settings-rem-quiet-start').value = status.quietStart;
      document.getElementById('settings-rem-quiet-end').value   = status.quietEnd;

      // Pause status
      const pauseStatus  = document.getElementById('settings-rem-pause-status');
      const pauseCancel  = document.getElementById('settings-rem-pause-cancel');
      if (status.paused) {
        const d = new Date(status.pausedUntil);
        pauseStatus.textContent = 'Paused until ' + d.toLocaleString();
        pauseCancel.classList.remove('hidden');
      } else {
        pauseStatus.textContent = 'Currently: Active';
        pauseCancel.classList.add('hidden');
      }

      // Master disable toggle
      document.getElementById('settings-rem-master-toggle').setAttribute('aria-checked', status.disabled ? 'true' : 'false');

      // Active count + collapsed-header summary
      document.getElementById('settings-rem-count').textContent = status.count;
      const sum = document.getElementById('settings-rem-section-summary');
      if (sum) {
        sum.textContent = status.disabled
          ? 'Off'
          : status.paused
            ? 'Paused'
            : status.count + ' active';
      }

      // Refresh the list view if it's currently expanded
      const list = document.getElementById('settings-rem-list');
      if (!list.classList.contains('hidden')) renderRemindersList();
    });
  }

  function renderRemindersList() {
    const list = document.getElementById('settings-rem-list');
    if (!list) return;
    list.innerHTML = '';
    const r = Notif.getReminders();
    const ids = Object.keys(r);
    if (!ids.length) {
      list.innerHTML = '<div class="settings-rem-list-empty">No reminders set yet. Add one from any habit.</div>';
      return;
    }
    ids.forEach(id => {
      const habit = habits.find(h => h.id === id);
      if (!habit) return;
      const row = document.createElement('div');
      row.className = 'settings-rem-list-item';
      // Inline name with either the mapped icon or the habit emoji.
      // Curated habits with PNG art get a small inline image; everything
      // else keeps the emoji prefix.
      const iconHTML = getHabitIcon(habit)
        ? habitIconHtml(habit, { size: 18 })
        : esc(habit.emoji || '');
      row.innerHTML =
        '<span class="settings-rem-list-name">' + iconHTML + ' ' + esc(habit.name) + '</span>' +
        '<span class="settings-rem-list-time">' + formatTime12(r[id]) + '</span>' +
        '<button class="settings-rem-list-remove" type="button">Remove</button>';
      row.querySelector('.settings-rem-list-remove').addEventListener('click', async () => {
        await Notif.clearReminder(id);
        renderRemindersList();
        refreshRemindersPanel();
      });
      list.appendChild(row);
    });
  }

  // Wire up every collapsible Settings section in one pass. Each
  // [data-collapsible] toggle button is paired with a body element via
  // its aria-controls equivalent (here we infer the body id from the
  // toggle id by replacing "-toggle" with "-body"). Default state is
  // collapsed (matching the markup).
  function setupCollapsibleSettings() {
    const toggles = document.querySelectorAll('.settings-collapsible-toggle[data-collapsible]');
    toggles.forEach(toggle => {
      const bodyId = toggle.id.replace('-toggle', '-body');
      const body   = document.getElementById(bodyId);
      if (!body) return;
      toggle.addEventListener('click', () => {
        const expanded = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        body.classList.toggle('settings-collapsible-body--collapsed', expanded);
      });
    });
  }

  function setupReminderSettings() {
    const enable     = document.getElementById('settings-rem-enable');
    // Daily-limit dropdown removed in v1.1.3.
    const quietTog   = document.getElementById('settings-rem-quiet-toggle');
    const quietStart = document.getElementById('settings-rem-quiet-start');
    const quietEnd   = document.getElementById('settings-rem-quiet-end');
    const pause24    = document.getElementById('settings-rem-pause-24');
    const pause7d    = document.getElementById('settings-rem-pause-7d');
    const pauseCancel= document.getElementById('settings-rem-pause-cancel');
    const masterTog  = document.getElementById('settings-rem-master-toggle');
    const viewAll    = document.getElementById('settings-rem-view-all');
    if (!enable) return;

    enable.addEventListener('click', async () => {
      // Show the explainer first if we haven't asked before, otherwise go
      // straight to the iOS native prompt.
      const ask = async () => {
        const granted = await Notif.requestPermission();
        await rescheduleNow();
        if (granted !== 'granted' && typeof showHabitToast === 'function') {
          showHabitToast('Permission denied. Enable in iOS Settings → Awakened.');
        }
      };
      if (!Notif.permAskedBefore()) {
        showNotifExplainer(async (ok) => { if (ok) await ask(); });
      } else {
        await ask();
      }
    });

    // (Daily-limit change handler removed in v1.1.3.)

    // Daily morning reminder — tap the time button to open a custom
    // picker (hour + 15-min minute), then save automatically as the
    // user picks. "Turn off" clears the digest entirely.
    const digestBtn   = document.getElementById('settings-rem-digest-btn');
    const digestClear = document.getElementById('settings-rem-digest-clear');
    if (digestBtn) {
      digestBtn.addEventListener('click', () => {
        const current = (Notif.dailyDigestTime && Notif.dailyDigestTime()) || '09:00';
        openDigestTimePickerModal(current, async (newT) => {
          try { await Notif.setDailyDigest(newT); } catch (_) {}
          // Re-render the panel so the button label + clear-button visibility
          // reflect the new state.
          refreshRemindersPanel();
        });
      });
    }
    if (digestClear) {
      digestClear.addEventListener('click', async () => {
        try { await Notif.clearDailyDigest(); } catch (_) {}
        refreshRemindersPanel();
        if (typeof showHabitToast === 'function') {
          showHabitToast('Morning reminder turned off', { sticky: true });
        }
      });
    }

    quietTog.addEventListener('click', async () => {
      const next = quietTog.getAttribute('aria-checked') !== 'true';
      Notif.setQuietOn(next);
      quietTog.setAttribute('aria-checked', next ? 'true' : 'false');
      await rescheduleNow();
    });
    quietStart.addEventListener('change', async () => {
      if (quietStart.value) Notif.setQuietStart(quietStart.value);
      await rescheduleNow();
    });
    quietEnd.addEventListener('change', async () => {
      if (quietEnd.value) Notif.setQuietEnd(quietEnd.value);
      await rescheduleNow();
    });

    pause24.addEventListener('click',     async () => { Notif.setPausedUntil(Date.now() + 24 * 3600 * 1000);     await rescheduleNow(); });
    pause7d.addEventListener('click',     async () => { Notif.setPausedUntil(Date.now() + 7 * 24 * 3600 * 1000); await rescheduleNow(); });
    pauseCancel.addEventListener('click', async () => { Notif.setPausedUntil(0);                                  await rescheduleNow(); });

    masterTog.addEventListener('click', async () => {
      const next = masterTog.getAttribute('aria-checked') !== 'true';
      Notif.setDisabled(next);
      masterTog.setAttribute('aria-checked', next ? 'true' : 'false');
      await rescheduleNow();
    });

    viewAll.addEventListener('click', () => {
      const list = document.getElementById('settings-rem-list');
      const expanded = !list.classList.contains('hidden');
      if (expanded) {
        list.classList.add('hidden');
        viewAll.classList.remove('expanded');
      } else {
        renderRemindersList();
        list.classList.remove('hidden');
        viewAll.classList.add('expanded');
      }
    });
  }

  // ── Settings → Apple Health panel (v1.1.6) ───────────────
  // Mirrors refreshRemindersPanel: pure read-from-state, no event
  // wiring (that's setupHealthSettings). Computes the panel's state
  // (A/B/C) from Health.* + localStorage and updates the DOM in place.
  //
  // States:
  //   A — HealthKit unavailable (web / non-iOS) → "iOS only"
  //   B — Permission granted → "Connected" (toggle ON) or "Paused" (toggle OFF)
  //   C — Permission unknown / denied → "Not connected"
  function refreshHealthPanel() {
    const summary    = document.getElementById('settings-health-summary');
    const stateA     = document.getElementById('settings-health-state-unavailable');
    const stateB     = document.getElementById('settings-health-state-connected');
    const stateC     = document.getElementById('settings-health-state-disconnected');
    if (!summary || !stateA || !stateB || !stateC) return;

    // Hide all three; the active branch reveals one.
    stateA.classList.add('hidden');
    stateB.classList.add('hidden');
    stateC.classList.add('hidden');

    if (typeof Health === 'undefined' || !Health.isAvailable()) {
      stateA.classList.remove('hidden');
      summary.textContent = 'iOS only';
      return;
    }

    const status   = Health.permissionStatus(); // 'granted' | 'denied' | 'unknown' | 'unavailable'
    const disabled = isAutoVerifyDisabled();

    if (status === 'granted') {
      stateB.classList.remove('hidden');
      const toggle = document.getElementById('settings-health-autoverify-toggle');
      const pausedNote = document.getElementById('settings-health-paused-note');
      if (toggle) toggle.setAttribute('aria-checked', disabled ? 'false' : 'true');
      if (pausedNote) pausedNote.classList.toggle('hidden', !disabled);
      summary.textContent = disabled ? 'Paused' : 'Connected';
    } else {
      // 'unknown' and 'denied' both surface State C — the Connect button's
      // click handler dispatches to the right path based on which one.
      stateC.classList.remove('hidden');
      summary.textContent = 'Not connected';
    }
  }

  // Wires the Apple Health panel's interactive controls. Idempotent —
  // safe to call once during setupSettings.
  function setupHealthSettings() {
    const toggle    = document.getElementById('settings-health-autoverify-toggle');
    const connectBtn= document.getElementById('settings-health-connect-btn');
    const manageLink= document.getElementById('settings-health-manage-link');

    if (toggle) {
      toggle.addEventListener('click', () => {
        // Flip the disabled flag based on current toggle state.
        const next = toggle.getAttribute('aria-checked') !== 'true'; // next = ON?
        setAutoVerifyDisabled(!next);
        if (next) {
          // Clear the in-memory cache so a stale 0-step read doesn't
          // block immediate re-verification of an already-walked day.
          try { Health.clearCache && Health.clearCache(); } catch (_) {}
          // Re-render Habits so any habit already past threshold gets
          // auto-checked right away — no need to switch tabs first.
          try { renderHabits(); } catch (_) {}
        }
        // No undo of prior auto-checks on pause — that's by design.
        refreshHealthPanel();
      });
    }

    if (connectBtn) {
      connectBtn.addEventListener('click', async () => {
        if (typeof Health === 'undefined' || !Health.isAvailable()) return;
        const status = Health.permissionStatus();
        if (status === 'unknown') {
          // First request — fires iOS native sheet.
          await Health.requestPermissions();
        } else {
          // 'denied' — iOS won't allow re-prompting. Deep-link to
          // Settings so the user can flip the Steps toggle manually.
          try { window.location.href = 'app-settings:'; } catch (_) {}
        }
        refreshHealthPanel();
      });
    }

    if (manageLink) {
      manageLink.addEventListener('click', () => {
        try { window.location.href = 'app-settings:'; } catch (_) {}
      });
    }
  }

  // ── WELCOME SCREEN ────────────────────────────────────────
  function playWelcomeSound() {
    try {
      const ac  = new (window.AudioContext || window.webkitAudioContext)();
      // Layer 1: rising whoosh
      const osc1  = ac.createOscillator();
      const gain1 = ac.createGain();
      osc1.connect(gain1); gain1.connect(ac.destination);
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(180, ac.currentTime);
      osc1.frequency.exponentialRampToValueAtTime(920, ac.currentTime + 0.14);
      osc1.frequency.exponentialRampToValueAtTime(460, ac.currentTime + 0.55);
      gain1.gain.setValueAtTime(0, ac.currentTime);
      gain1.gain.linearRampToValueAtTime(0.15, ac.currentTime + 0.06);
      gain1.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.6);
      osc1.start(ac.currentTime); osc1.stop(ac.currentTime + 0.65);
      // Layer 2: high chime ping
      const osc2  = ac.createOscillator();
      const gain2 = ac.createGain();
      osc2.connect(gain2); gain2.connect(ac.destination);
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(1760, ac.currentTime + 0.08);
      osc2.frequency.exponentialRampToValueAtTime(880, ac.currentTime + 0.5);
      gain2.gain.setValueAtTime(0, ac.currentTime + 0.08);
      gain2.gain.linearRampToValueAtTime(0.09, ac.currentTime + 0.12);
      gain2.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.7);
      osc2.start(ac.currentTime + 0.08); osc2.stop(ac.currentTime + 0.75);
      osc2.onended = () => ac.close();
    } catch (_) {}
  }

  function showWelcomeScreen() {
    const screen = document.getElementById('welcome-screen');
    screen.classList.remove('hidden');

    // ── Particle canvas ──────────────────────────────────
    const canvas = document.getElementById('wc-canvas');
    const ctx2d  = canvas.getContext('2d');
    let rafId    = null;

    function resizeCanvas() {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas, { passive: true });

    const particles = [];
    const COUNT = 55;
    for (let i = 0; i < COUNT; i++) {
      particles.push({
        x:       Math.random() * window.innerWidth,
        y:       Math.random() * window.innerHeight,
        size:    0.8 + Math.random() * 2.4,
        speed:   0.18 + Math.random() * 0.42,
        opacity: 0.08 + Math.random() * 0.45,
        color:   Math.random() > 0.55 ? '#8b5cf6' : '#f59e0b',
        drift:   (Math.random() - 0.5) * 0.28,
      });
    }

    function drawFrame() {
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach(p => {
        p.y       -= p.speed;
        p.x       += p.drift;
        p.opacity += (Math.random() - 0.5) * 0.012;
        p.opacity  = Math.max(0.04, Math.min(0.65, p.opacity));
        if (p.y < -6)          { p.y = canvas.height + 6; p.x = Math.random() * canvas.width; }
        if (p.x < -6)          { p.x = canvas.width  + 6; }
        if (p.x > canvas.width + 6) { p.x = -6; }
        ctx2d.beginPath();
        ctx2d.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx2d.fillStyle = p.color;
        ctx2d.globalAlpha = p.opacity;
        ctx2d.fill();
      });
      ctx2d.globalAlpha = 1;
      rafId = requestAnimationFrame(drawFrame);
    }
    rafId = requestAnimationFrame(drawFrame);

    // ── Cinematic sequence ────────────────────────────────
    // 200ms  — opener line fades in
    setTimeout(() => {
      document.getElementById('wc-opener').classList.add('wc-anim');
    }, 200);

    // 750ms  — title SLAMS in + shockwave + sound
    setTimeout(() => {
      document.getElementById('wc-title').classList.add('wc-anim');
      const sw = document.getElementById('wc-shockwave');
      void sw.offsetWidth;
      sw.classList.add('wc-sw-fire');
      playWelcomeSound();
    }, 750);

    // 1350ms — tagline fades up
    setTimeout(() => {
      document.getElementById('wc-tagline').classList.add('wc-anim');
    }, 1350);

    // 1900ms — name input slides up, auto-focus
    setTimeout(() => {
      document.getElementById('wc-input-wrap').classList.add('wc-anim');
      setTimeout(() => document.getElementById('wc-name-input').focus(), 100);
    }, 1900);

    // 2400ms — START button fades up, then switches to glow loop
    setTimeout(() => {
      const btn = document.getElementById('wc-start-btn');
      btn.classList.add('wc-anim');
      btn.addEventListener('animationend', () => {
        btn.classList.remove('wc-anim');
        btn.classList.add('wc-shown');
      }, { once: true });
    }, 2400);

    // 2950ms — motivational quote fades in beneath the button
    setTimeout(() => {
      document.getElementById('wc-quote').classList.add('wc-anim');
    }, 2950);

    // ── Interactivity ─────────────────────────────────────
    const nameInput = document.getElementById('wc-name-input');
    const startBtn  = document.getElementById('wc-start-btn');

    nameInput.addEventListener('input', () => {
      startBtn.disabled = nameInput.value.trim().length === 0;
    });

    nameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !startBtn.disabled) startBtn.click();
    });

    function launchQuest() {
      const name = nameInput.value.trim();
      if (!name) return;

      // Save name & mark as welcomed
      playerName = name;
      localStorage.setItem('hb_name',     playerName);
      localStorage.setItem('hb_welcomed', '1');

      // Stop particle loop
      cancelAnimationFrame(rafId);

      // White flash → transition to path selection
      const flash = document.getElementById('wc-flash');
      flash.classList.add('wc-flash-fire');
      setTimeout(() => {
        screen.classList.add('hidden');
        needsWelcome = false;
        showPathScreen();
      }, 420);
    }

    startBtn.addEventListener('click', launchQuest);
  }

  // ── CHOOSE YOUR PATH ─────────────────────────────────────
  // Morning Routine habit indices (DEFAULT_HABITS order):
  //   2=Sleep before midnight, 23=Wake up consistent, 14=No phone after waking,
  //  16=Morning sunlight, 41=Morning gratitude, 6=Daily walk,
  //  46=Vitamins, 12=Meditate & Breathwork, 4=Strength training, 19=Whole foods
  var MORNING_HABIT_INDICES = [2, 23, 14, 16, 41, 6, 46, 12, 4, 19];

  function showPathScreen() {
    document.getElementById('app').classList.add('hidden');
    document.getElementById('onboarding').classList.add('hidden');

    var screen   = document.getElementById('path-screen');
    var cardsEl  = document.getElementById('path-cards');
    var btn      = document.getElementById('path-continue-btn');

    screen.classList.remove('hidden');
    cardsEl.innerHTML    = '';
    btn.disabled         = true;
    btn.style.background = '';
    btn.onclick          = null;

    var chosen = null; // 'morning' | 'locked-in' | 'custom'

    // ── Card: Morning Routine ──────────────────────────────
    var morningCard = document.createElement('div');
    morningCard.className = 'path-card';
    morningCard.style.setProperty('--pack-color', '#f59e0b');
    morningCard.innerHTML =
      '<div class="path-card-check">✓</div>'                                    +
      '<div class="path-card-emoji">' + packIconHtml('morning', { size: 56 }) + '</div>'                                   +
      '<div class="path-card-name">Morning Routine</div>'                       +
      '<div class="path-card-tagline">Win the morning. Win the day.</div>'      +
      '<div class="path-card-sub">For the intentional starter</div>'            +
      '<div class="path-card-count">10 habits pre-selected</div>';

    // ── Card: Locked-In ────────────────────────────────────
    var lockedInCard = document.createElement('div');
    lockedInCard.className = 'path-card';
    lockedInCard.style.setProperty('--pack-color', '#7c3aed');
    lockedInCard.innerHTML =
      '<div class="path-card-check">✓</div>'                                    +
      '<div class="path-card-emoji">' + packIconHtml('lockedin', { size: 56 }) + '</div>'                                   +
      '<div class="path-card-name">Locked-In</div>'                             +
      '<div class="path-card-tagline">Master the day.</div>'                    +
      '<div class="path-card-sub">For full discipline cycles</div>'             +
      '<div class="path-card-count">16 habits pre-selected</div>';

    // ── Card: Make Your Own ────────────────────────────────
    var customCard = document.createElement('div');
    customCard.className = 'path-card';
    customCard.style.setProperty('--pack-color', '#a855f7');
    customCard.innerHTML =
      '<div class="path-card-check">✓</div>'                       +
      '<div class="path-card-emoji">' + packIconHtml('custom', { size: 56 }) + '</div>'                      +
      '<div class="path-card-name">Make Your Own</div>'            +
      '<div class="path-card-tagline">Your path, your rules</div>' +
      '<div class="path-card-count">Build from scratch</div>';

    // ── Card selection helper ──────────────────────────────
    function selectCard(card, id, color) {
      morningCard.classList.remove('path-selected');
      lockedInCard.classList.remove('path-selected');
      customCard.classList.remove('path-selected');
      card.classList.add('path-selected');
      chosen               = id;
      btn.disabled         = false;
      btn.style.background = color;
    }

    var customWarningShown = false;

    function showCustomWarning() {
      var ov = document.getElementById('custom-warning-overlay');
      if (!ov) return;
      ov.classList.remove('hidden');

      document.getElementById('cw-continue-btn').onclick = function() {
        ov.classList.add('hidden');
        // user keeps custom selection — already applied
      };
      document.getElementById('cw-switch-btn').onclick = function() {
        ov.classList.add('hidden');
        selectCard(morningCard, 'morning', '#f59e0b');
      };
    }

    morningCard.onclick  = function() { selectCard(morningCard,  'morning',   '#f59e0b'); };
    lockedInCard.onclick = function() { selectCard(lockedInCard, 'locked-in', '#7c3aed'); };
    customCard.onclick   = function() {
      selectCard(customCard, 'custom', '#a855f7');
      if (!customWarningShown) {
        customWarningShown = true;
        showCustomWarning();
      }
    };

    cardsEl.appendChild(morningCard);
    cardsEl.appendChild(lockedInCard);
    cardsEl.appendChild(customCard);

    // ── Continue button ────────────────────────────────────
    btn.onclick = function() {
      if (!chosen) return;

      selectedPackId = chosen;
      // Pull the chosen pack's habit indices from the canonical PACKS data —
      // single source of truth, automatically picks up Locked-In's 16 habits.
      var pack = getPackById(chosen);
      var habitsForOb = (pack && pack.habits) ? pack.habits.slice() : [];

      var flash = document.getElementById('path-flash-overlay');
      if (flash) flash.classList.add('active');

      setTimeout(function() {
        if (flash) flash.classList.remove('active');
        screen.classList.add('hidden');
        showOnboarding(habitsForOb);
      }, 340);
    };
  }

  // ── ONBOARDING ────────────────────────────────────────────
  function showOnboarding(preSelectedIndices) {
    document.getElementById('app').classList.add('hidden');
    const screen = document.getElementById('onboarding');
    screen.classList.remove('hidden');

    // Pre-fill name if captured from welcome screen
    const obNameInput = document.getElementById('ob-name-input');
    if (obNameInput && playerName && playerName !== 'Hunter') {
      obNameInput.value = playerName;
    }

    obSelected.clear();
    if (Array.isArray(preSelectedIndices) && preSelectedIndices.length) {
      preSelectedIndices.forEach(i => obSelected.add(i));
    }
    const list = document.getElementById('ob-list');
    list.innerHTML = '';

    let openIdx = -1; // track which accordion section is open

    // Update the count badge in a category header
    function refreshCatCount(catIdx) {
      const cat = OB_CATEGORIES[catIdx];
      const sel = [...obSelected].filter(i => i >= cat.start && i < cat.end).length;
      const total = cat.end - cat.start;
      const countEl = list.querySelectorAll('.ob-acc-header')[catIdx]?.querySelector('.ob-acc-count');
      if (!countEl) return;
      if (sel > 0) {
        countEl.textContent = sel + '/' + total + ' selected';
        countEl.classList.add('ob-acc-count-active');
      } else {
        countEl.textContent = total + ' habits';
        countEl.classList.remove('ob-acc-count-active');
      }
    }

    // Open or close a section by index (-1 = close all)
    function setOpen(idx) {
      list.querySelectorAll('.ob-acc-section').forEach((sec, i) => {
        const body    = sec.querySelector('.ob-acc-body');
        const chevron = sec.querySelector('.ob-acc-chevron');
        const isOpen  = (i === idx);
        sec.classList.toggle('ob-open', isOpen);
        chevron.style.transform = isOpen ? 'rotate(90deg)' : 'rotate(0deg)';
        body.style.maxHeight    = isOpen ? body.scrollHeight + 'px' : '0';
      });
      openIdx = idx;
    }

    OB_CATEGORIES.forEach((cat, catIdx) => {
      const total = cat.end - cat.start;

      const sec = document.createElement('div');
      sec.className = 'ob-acc-section';

      // ── Accordion header ──────────────────────────────────
      const hdr = document.createElement('div');
      hdr.className = 'ob-acc-header';
      hdr.innerHTML =
        '<span class="ob-acc-label">' + cat.label + '</span>' +
        '<span class="ob-acc-count">' + total + ' habits</span>' +
        '<span class="ob-acc-chevron">▶</span>';

      hdr.addEventListener('click', () => {
        setOpen(openIdx === catIdx ? -1 : catIdx);
      });
      sec.appendChild(hdr);

      // ── Accordion body ────────────────────────────────────
      const body  = document.createElement('div');
      body.className = 'ob-acc-body';
      body.style.maxHeight = '0';

      const inner = document.createElement('div');
      inner.className = 'ob-acc-inner';

      for (let i = cat.start; i < cat.end; i++) {
        const h    = DEFAULT_HABITS[i];
        const card = document.createElement('div');
        card.className = 'ob-card';
        card.innerHTML =
          '<div class="ob-card-check"></div>' +
          '<span class="ob-card-emoji">' + habitIconHtml(h, { size: 24 }) + '</span>' +
          '<span class="ob-card-name">' + esc(h.name) + '</span>' +
          '<span class="diff-badge ' + h.difficulty + '">' + DIFFICULTY[h.difficulty].label + '</span>';

        // Apply pre-selection state (from pack)
        if (obSelected.has(i)) {
          card.classList.add('ob-selected');
          card.querySelector('.ob-card-check').textContent = '✓';
        }

        const idx = i;

        const obSelect = cfg => {
          obSelected.add(idx);
          obConfig.set(idx, cfg || {});
          card.classList.add('ob-selected');
          card.querySelector('.ob-card-check').textContent = '✓';
          refreshCatCount(catIdx);
          updateObBtn();
          if (openIdx === catIdx) body.style.maxHeight = inner.scrollHeight + 'px';
        };
        const obDeselect = () => {
          obSelected.delete(idx);
          obConfig.delete(idx);
          card.classList.remove('ob-selected');
          card.querySelector('.ob-card-check').textContent = '';
          refreshCatCount(catIdx);
          updateObBtn();
          if (openIdx === catIdx) body.style.maxHeight = inner.scrollHeight + 'px';
        };

        card.addEventListener('click', () => {
          openHabitDetail(h, {
            context:        'onboarding',
            isSelected:     obSelected.has(idx),
            existingConfig: obConfig.get(idx),
            onConfirm: obSelect,
            onRemove:  obDeselect,
          });
        });
        inner.appendChild(card);
      }

      body.appendChild(inner);
      sec.appendChild(body);
      list.appendChild(sec);
    });

    // Refresh category counts for any pre-selected habits
    if (obSelected.size > 0) {
      OB_CATEGORIES.forEach((_, catIdx) => refreshCatCount(catIdx));
    }

    document.getElementById('ob-start-btn').addEventListener('click', completeOnboarding);
    updateObBtn();
  }

  function updateObBtn() {
    const btn = document.getElementById('ob-start-btn');
    const n   = obSelected.size;
    btn.disabled    = n === 0;
    btn.textContent = n === 0
      ? 'Start My Quest'
      : 'Start My Quest — ' + n + ' selected';
  }

  function completeOnboarding() {
    // Onboarding A: ask for notification permission BEFORE the user lands
    // on the main app. Skipped automatically if we've already asked.
    // The handler is fire-and-forget — _completeOnboardingFinish runs
    // whether the user enabled or deferred. If permission was already
    // requested in a prior install/session, we go straight to finish.
    runOnboardingNotifPrompt(() => _completeOnboardingFinish());
  }

  function _completeOnboardingFinish() {
    const nameInput = document.getElementById('ob-name-input');
    if (nameInput && nameInput.value.trim()) {
      playerName = nameInput.value.trim();
      localStorage.setItem('hb_name', playerName);
    }
    if (selectedPackId) localStorage.setItem('hb_path', selectedPackId);

    // Build habits using per-habit configs stored in obConfig, falling back to defaults
    habits = [...obSelected].sort((a, b) => a - b).map(i => {
      const base = DEFAULT_HABITS[i];
      const cfg  = obConfig.get(i) || {};
      const newH = {
        id:         uid(),
        emoji:      base.emoji,
        name:       base.name,
        difficulty: cfg.difficulty || base.difficulty,
        type:       cfg.type       || base.type || 'build',
      };
      if (cfg.days)      newH.days      = cfg.days;
      if (cfg.startDate) newH.startDate = cfg.startDate;
      // Goal — mutually exclusive across four branches: step-goal
      // habits (canonical Daily walk), sleep-goal habits (canonical
      // Sleep), legacy measurable habits, and binary auto-verify
      // habits (Sleep before midnight — no goal at all). v1.1.5+.
      if (typeof cfg.stepGoal === 'number') {
        newH.stepGoal = cfg.stepGoal;
      } else if (isStepGoalHabit(base)) {
        // User didn't open the detail sheet — persist the default so
        // habit.stepGoal is always set for canonical Daily walk.
        newH.stepGoal = HEALTHKIT_WALK_DEFAULT_THRESHOLD;
      } else if (typeof cfg.sleepGoalHours === 'number') {
        newH.sleepGoalHours = cfg.sleepGoalHours;
      } else if (isSleepDurationHabit(base)) {
        // Same default-fill rationale as Daily walk.
        newH.sleepGoalHours = HEALTHKIT_SLEEP_DEFAULT_GOAL_HOURS;
      } else if (cfg.goal) {
        newH.goal = cfg.goal;
      } else {
        const m = MEASURABLE_HABITS[base.name];
        if (m) {
          const defVal = m.bodyweightMin
            ? Math.max(m.def, parseInt(localStorage.getItem('hb_bodyweight') || '0', 10))
            : Math.max(m.min, m.def);
          newH.goal = { value: defVal, unit: m.unit };
        }
      }
      return newH;
    });

    // Pre-fill coaching notes for Morning Routine pack
    if (selectedPackId === 'morning') {
      const MORNING_NOTES = {
        'Sleep before midnight':              'It all starts the night before. Quality sleep before midnight sets the foundation for everything.',
        'Wake up at consistent time':         'Discipline starts before your feet hit the floor. Same time every day builds the warrior.',
        'No phone or social media after waking': 'Protect your mind in the first 30 minutes. What you consume first shapes your entire day.',
        'Get morning sunlight':               'Get outside. Natural light sets your circadian rhythm and signals your body it is time to conquer.',
        'Morning gratitude practice':         'Three things. Every morning. Rewires your brain toward abundance over time.',
        'Daily walk':                         'Background movement matters. Hit your step goal — anywhere, any pace. Walks while on calls, errands, anywhere it fits in your day.',
        'Vitamins and minerals':              'Your body cannot perform without the right fuel. Non negotiable.',
        'Meditate & Breathwork':              'Stillness is a skill. 10 minutes of presence builds the focus that trading and life demand.',
        'Strength training':                  'The body you build reflects the discipline you practice. Show up for it daily.',
        'Whole foods diet':                   'You are what you eat. Real food builds a real body and a sharp mind.',
      };
      habits.forEach(h => {
        const note = MORNING_NOTES[h.name];
        if (note) habitNotes[h.id] = note;
      });
    }

    // Pre-fill any DEFAULT_HABITS note (e.g. No alcohol weekend challenge)
    habits.forEach(h => {
      if (habitNotes[h.id]) return; // already set (morning notes above take priority)
      const base = DEFAULT_HABITS.find(d => d.name === h.name);
      if (base && base.note) habitNotes[h.id] = base.note;
    });

    // Reset onboarding state
    obConfig.clear();

    save();
    needsOnboarding = false;
    // Brand-new users just saw all the v1.1.0 features for the first time
    // via onboarding — no need to greet them with a "What's New" popup.
    setStoredWhatsNewSeen(APP_VERSION);

    // ── Generate Chapter 1: The Beginning ─────────────────
    saveBeginningIfMissing();

    document.getElementById('onboarding').classList.add('hidden');
    // Show The Beginning reveal BEFORE the main app — it's the
    // user's first real moment with their permanent narrative.
    showBeginningReveal(() => {
      document.getElementById('app').classList.remove('hidden');
      render();
    });
  }

  // ── The Beginning reveal — full-screen typewriter ────────
  function showBeginningReveal(onComplete) {
    const overlay = document.getElementById('beginning-screen');
    if (!overlay || !originBeginning || !originBeginning.text) {
      if (typeof onComplete === 'function') onComplete();
      return;
    }
    const storyEl = document.getElementById('bg-story');
    const hintEl  = document.getElementById('bg-hint');
    if (storyEl) {
      storyEl.textContent = '';
      storyEl.classList.remove('bg-story--done');
    }
    if (hintEl) hintEl.textContent = 'Tap to skip · or wait';

    overlay.classList.remove('hidden');
    void overlay.offsetWidth;
    overlay.classList.add('bg-show');

    const fullText = originBeginning.text;
    let typeIdx = 0;
    let typing = true;
    let typeTimer = null;
    const TYPE_MS = 30;

    function tick() {
      if (!typing || !storyEl) return;
      typeIdx++;
      storyEl.textContent = fullText.slice(0, typeIdx);
      if (typeIdx >= fullText.length) {
        typing = false;
        if (storyEl) storyEl.classList.add('bg-story--done');
        if (hintEl)  hintEl.textContent = 'Tap to continue';
        return;
      }
      typeTimer = setTimeout(tick, TYPE_MS);
    }
    const startTimer = setTimeout(() => { typeTimer = setTimeout(tick, 0); }, 700);

    let autoDismissTimer = null;
    function dismiss() {
      typing = false;
      clearTimeout(typeTimer);
      clearTimeout(startTimer);
      clearTimeout(autoDismissTimer);
      overlay.classList.remove('bg-show');
      overlay.classList.add('bg-hide');
      // Sweep any reminder-confirmation toasts left over from the
      // onboarding-time picker. They live as direct children of <body>
      // (intentionally, so they survive other overlays) but should NOT
      // outlive the Beginning chapter — the user has clearly moved on.
      // Same for the floating hour/minute picker popup it spawns.
      document.querySelectorAll('.habit-toast--reminder, .ht-rem-popup').forEach(el => el.remove());
      overlay.addEventListener('animationend', () => {
        overlay.classList.remove('bg-hide');
        overlay.classList.add('hidden');
        if (typeof onComplete === 'function') onComplete();
      }, { once: true });
      overlay.removeEventListener('click', onTap);
    }
    function onTap() {
      if (typing) {
        typing = false;
        clearTimeout(typeTimer);
        if (storyEl) {
          storyEl.textContent = fullText;
          storyEl.classList.add('bg-story--done');
        }
        if (hintEl) hintEl.textContent = 'Tap to continue';
      } else {
        dismiss();
      }
    }
    overlay.addEventListener('click', onTap);
  }

  // ── SERVICE WORKER ────────────────────────────────────────
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('sw.js').then(reg => {

      // Record the live sw.js CACHE_VERSION so checkForUpdates() can compare
      // against it later. Done in the background — don't block registration.
      fetch('sw.js?_=' + Date.now(), { cache: 'no-store' })
        .then(r => r.ok ? r.text() : '')
        .then(text => {
          const m = text && text.match(/CACHE_VERSION\s*=\s*['"]([^'"]+)['"]/);
          if (m) { try { localStorage.setItem('hb_sw_known_version', m[1]); } catch (_) {} }
        })
        .catch(() => {});

      // Helper: show the banner for a given waiting worker
      function offerUpdate(worker) {
        showUpdateBanner(() => {
          worker.postMessage({ type: 'SKIP_WAITING' });
        });
      }

      // Case 1: a new SW is already waiting on page load (e.g. user
      //         opened a new tab after an update downloaded in another tab)
      if (reg.waiting) {
        offerUpdate(reg.waiting);
      }

      // Case 2: a new SW finishes installing while the page is open
      reg.addEventListener('updatefound', () => {
        const incoming = reg.installing;
        incoming.addEventListener('statechange', () => {
          // 'installed' + existing controller = update waiting to take over
          if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
            offerUpdate(incoming);
          }
        });
      });

    }).catch(() => {});

    // When the SW controller actually changes (after skipWaiting), reload
    // so the page is served fresh by the new service worker.
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) { refreshing = true; window.location.reload(); }
    });
  }

  function showUpdateBanner(onConfirm) {
    // Only show one banner at a time
    if (document.getElementById('sw-update-banner')) return;

    const banner = document.createElement('div');
    banner.id        = 'sw-update-banner';
    banner.className = 'sw-update-banner';
    banner.innerHTML =
      '<span class="sw-update-msg">⬆ Update available</span>' +
      '<button class="sw-update-btn" id="sw-update-btn">Refresh</button>' +
      '<button class="sw-update-dismiss" id="sw-update-dismiss" aria-label="Dismiss">✕</button>';

    document.body.appendChild(banner);

    // Slight delay so the slide-down animation is visible
    requestAnimationFrame(() => banner.classList.add('sw-update-banner--show'));

    document.getElementById('sw-update-btn').addEventListener('click', () => {
      banner.remove();
      onConfirm();
    });

    document.getElementById('sw-update-dismiss').addEventListener('click', () => {
      banner.classList.remove('sw-update-banner--show');
      setTimeout(() => banner.remove(), 320);
    });
  }

  // ─────────────────────────────────────────────────────────
  // ── PUSH NOTIFICATIONS / REMINDERS ────────────────────────
  // ─────────────────────────────────────────────────────────
  // Per-habit local-notification system. One reminder time per habit.
  // Capacitor's @capacitor/local-notifications plugin handles persistence
  // across app restarts on iOS. Falls back to the Web Notifications API
  // (best-effort) for the PWA build, with a soft "use the iOS app"
  // message in Settings.
  //
  // localStorage keys (all hb_*):
  //   hb_reminders                  { habitId: 'HH:MM', ... }
  //   hb_notif_perm_requested       '1' once user has seen the explainer
  //   hb_notif_disabled             '1' if master toggle off
  //   hb_notif_paused_until         ISO timestamp; current time < this = paused
  //   hb_notif_daily_limit          number; 0 = unlimited (default 3)
  //   hb_notif_quiet_enabled        '1'/'0'  (default '1')
  //   hb_notif_quiet_start          'HH:MM'  (default '22:00')
  //   hb_notif_quiet_end            'HH:MM'  (default '07:00')
  //   hb_notif_daily_digest_time    'HH:MM' if user opted into the morning
  //                                 reminder, otherwise unset. The digest
  //                                 is the ONE notification a day Awakened
  //                                 sends by default — a gentle "show up"
  //                                 ping at the user's chosen morning time.

  const Notif = (() => {
    const KEY_REMINDERS    = 'hb_reminders';
    const KEY_PERM_ASKED   = 'hb_notif_perm_requested';
    const KEY_DISABLED     = 'hb_notif_disabled';
    const KEY_PAUSED_UNTIL = 'hb_notif_paused_until';
    const KEY_DAILY_LIMIT  = 'hb_notif_daily_limit';
    const KEY_QUIET_ON     = 'hb_notif_quiet_enabled';
    const KEY_QUIET_START  = 'hb_notif_quiet_start';
    const KEY_QUIET_END    = 'hb_notif_quiet_end';
    const KEY_DIGEST_TIME  = 'hb_notif_daily_digest_time';
    // Stable plugin notification ID for the once-a-day digest. Picked from
    // a numeric range that won't collide with notifIdFor() habit hashes.
    const DIGEST_NOTIF_ID  = 1;

    // Voice-coded copy keyed by primary stat. Used as a fallback for
    // habits that don't have a dedicated entry in HABIT_NOTIF_COPY (and
    // for user-authored custom habits).
    const COPY = {
      STR:    { title: 'Time to train. {n} awaits.',   body: "The path doesn't walk itself." },
      FOCUS:  { title: 'Stillness now. {n}.',          body: 'Five minutes of focus changes the day.' },
      INT:    { title: '{n} is ready.',                body: 'The unlearned version of you is no longer enough.' },
      WILL:   { title: '{n}. Get in the cold.',        body: 'Comfort is the enemy.' },
      VIT:    { title: '{n}.',                         body: 'The body keeps the score.' },
      WLT:    { title: '{n} awaits.',                  body: 'Compound the small wins.' },
      CUSTOM: { title: '{n} awaits.',                  body: 'Today, you choose.' },
    };

    // Per-habit unique notification copy. Each curated library habit
    // gets its own title + body so the user doesn't see "Hydrate." with
    // identical body text on five different VIT habits. Keyed by the
    // habit's exact name (the foreign key used everywhere). Custom
    // user-authored habits fall through to the per-stat COPY above.
    const HABIT_NOTIF_COPY = {
      // Physical Performance
      'Hydrate':                            { title: 'Hydrate.',          body: 'Water the temple.' },
      'Sleep':                              { title: 'Sleep.',            body: 'Repair begins when you let it.' },
      'Sleep before midnight':              { title: 'Bed by midnight.',  body: 'Tomorrow is built tonight.' },
      'Cardio workout':                     { title: 'Cardio.',           body: 'Move before the day moves you.' },
      'Strength training':                  { title: 'Train, Hunter.',    body: "The path doesn't walk itself." },
      'Sprint session':                     { title: 'Sprint.',           body: 'Speed is forged in the burn.' },
      'Daily walk':                         { title: 'Walk.',             body: 'Movement clears the static.' },
      'Ice bath or cold plunge':            { title: 'Plunge.',           body: 'Comfort is the enemy.' },
      'Cold shower':                        { title: 'Cold shower.',      body: 'Choose discomfort once. Win the day.' },
      'Mobility & Stretching':              { title: 'Stretch.',          body: 'Tight muscles, tight mind.' },
      'Protein goal':                       { title: 'Protein.',          body: "You can't build with empty hands." },

      // Mental & Focus
      'Read':                               { title: 'Read.',             body: 'The unlearned version of you is no longer enough.' },
      'Meditate & Breathwork':              { title: 'Sit. Breathe.',     body: 'Stillness is a skill.' },
      'Journal':                            { title: 'Journal.',          body: 'What stays in the head stays the same.' },
      'No phone or social media after waking': { title: 'Phone down.',    body: 'Protect the first 30 minutes.' },
      'Review daily goals/intentions':      { title: "Set today's intent.", body: 'Direction beats motion.' },
      'Get morning sunlight':               { title: 'Morning sun.',      body: "Tell your body it's time." },
      'No social media before noon':        { title: 'No feed before noon.', body: 'Build before you scroll.' },
      'No screens 1 hour before bed':       { title: 'Screens off.',      body: 'The body remembers blue light.' },

      // Nutrition
      'Whole foods diet':                   { title: 'Whole foods.',      body: 'Real food. Real body.' },
      'No sugar/junk food':                 { title: 'No junk.',          body: "Cravings lie. Discipline doesn't." },
      'No alcohol':                         { title: 'Stay clear.',       body: 'Tomorrow is sharper sober.' },
      'No caffeine':                        { title: 'No caffeine.',      body: 'Earned energy lasts.' },

      // Discipline & Productivity
      'Wake up at consistent time':         { title: 'Wake up.',          body: 'Discipline starts before your feet hit the floor.' },
      'Complete your #1 priority task':     { title: 'Top priority.',     body: 'One thing well beats five things half.' },
      'Plan tomorrow the night before':     { title: 'Plan tomorrow.',    body: 'The day is won the night before.' },
      'Tidy/clean space':                   { title: 'Tidy.',             body: 'Outer order, inner calm.' },
      'Under 1 hour screen time':           { title: 'Cap the scroll.',   body: 'Your attention is the asset.' },
      'Digital declutter':                  { title: 'Declutter.',        body: "Delete what doesn't serve you." },
      'No doomscrolling until after 5PM':   { title: 'No doomscroll.',    body: 'Your mind belongs to you until 5.' },
      'Review your long term goals':        { title: 'Goals check.',      body: 'Aim before you fire.' },

      // Financial & Growth
      'Track finances & net worth':         { title: 'Track the numbers.', body: 'What you measure, you master.' },
      'Work on a side project or business': { title: 'Build something.',  body: 'The future is built in stolen hours.' },
      'Review investments or trading journal': { title: 'Review the trade.', body: 'The market rewards the patient.' },
      'Generate one new business or content idea': { title: 'One new idea.', body: 'Quantity breeds quality.' },

      // Learning & Skills
      'Educational podcast':                { title: 'Podcast.',          body: 'Learn while you move.' },
      'Practice a skill':                   { title: 'Practice.',         body: "Reps over time. There's no other path." },
      'Flashcard review':                   { title: 'Flashcards.',       body: 'Memory is built brick by brick.' },
      'Write down lessons learned':         { title: "Capture today's lesson.", body: "What's not written is forgotten." },
      'Learn something new':                { title: 'Learn.',            body: 'Curiosity is the cheapest edge.' },
      'Language learning':                  { title: 'Practice the tongue.', body: 'Consistency beats intensity.' },

      // Wellbeing & Relationships
      'Morning gratitude practice':         { title: 'Three gratitudes.', body: "Notice what's already enough." },
      'Pray or set intentions':             { title: 'Set intent.',       body: 'Speak it. Mean it. Move.' },
      'Call or text a family member':       { title: 'Reach out.',        body: 'Bonds rust without touch.' },
      'Do something kind for someone':      { title: 'Be kind.',          body: 'The smallest gesture compounds.' },
      'Barefoot grounding outside':         { title: 'Earth the body.',   body: 'Bare feet on real ground.' },
      'Vitamins and minerals':              { title: 'Vitamins.',         body: "The body can't perform without fuel." },
      'Visualization practice':             { title: 'Visualize.',        body: 'See it before you live it.' },
      'Sleep early before 11PM':            { title: 'Bed by 11.',        body: 'Recovery is part of the work.' },
    };

    function plugin() {
      try { return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications; }
      catch (_) { return null; }
    }
    function isNative() { return !!(plugin() && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); }
    function hasWebNotif() { return typeof window.Notification !== 'undefined'; }

    // Hash a habit-uid string into a positive 31-bit int for plugin notification IDs.
    function notifIdFor(habitId) {
      let h = 5381;
      for (let i = 0; i < habitId.length; i++) h = ((h << 5) + h + habitId.charCodeAt(i)) | 0;
      return Math.abs(h) || 1;
    }

    // ── Storage helpers ──
    function reminders() { try { return JSON.parse(localStorage.getItem(KEY_REMINDERS) || '{}'); } catch (_) { return {}; } }
    function setReminders(o) { localStorage.setItem(KEY_REMINDERS, JSON.stringify(o)); }

    function isDisabled()    { return localStorage.getItem(KEY_DISABLED) === '1'; }
    function setDisabled(d)  { d ? localStorage.setItem(KEY_DISABLED, '1') : localStorage.removeItem(KEY_DISABLED); }

    function pausedUntil()   { const v = localStorage.getItem(KEY_PAUSED_UNTIL); return v ? parseInt(v, 10) : 0; }
    function isPaused()      { return Date.now() < pausedUntil(); }
    function setPausedUntil(ts) { ts ? localStorage.setItem(KEY_PAUSED_UNTIL, String(ts)) : localStorage.removeItem(KEY_PAUSED_UNTIL); }

    // Daily limit removed from the Settings UI in v1.1.3 — the user
    // self-regulates cadence by choosing whether to add per-habit
    // reminders. We still honor a stored value if a previous version
    // wrote one (backward compat), but new users default to 0 (no cap).
    function dailyLimit()    { const n = parseInt(localStorage.getItem(KEY_DAILY_LIMIT), 10); return isFinite(n) ? n : 0; }
    function setDailyLimit(n){ localStorage.setItem(KEY_DAILY_LIMIT, String(n)); }

    function quietOn()       { return (localStorage.getItem(KEY_QUIET_ON) || '1') === '1'; }
    function setQuietOn(b)   { localStorage.setItem(KEY_QUIET_ON, b ? '1' : '0'); }
    function quietStart()    { return localStorage.getItem(KEY_QUIET_START) || '22:00'; }
    function quietEnd()      { return localStorage.getItem(KEY_QUIET_END)   || '07:00'; }
    function setQuietStart(t){ localStorage.setItem(KEY_QUIET_START, t); }
    function setQuietEnd(t)  { localStorage.setItem(KEY_QUIET_END, t); }

    // ── Permission ──
    async function checkPermission() {
      const p = plugin();
      if (p && isNative()) {
        try {
          const r = await p.checkPermissions();
          return r.display || 'prompt';
        } catch (_) { return 'prompt'; }
      }
      if (hasWebNotif()) return Notification.permission || 'default'; // 'granted'|'denied'|'default'
      return 'unsupported';
    }
    async function requestPermission() {
      localStorage.setItem(KEY_PERM_ASKED, '1');
      const p = plugin();
      if (p && isNative()) {
        try { const r = await p.requestPermissions(); return r.display || 'denied'; }
        catch (_) { return 'denied'; }
      }
      if (hasWebNotif()) {
        try { return await Notification.requestPermission(); } catch (_) { return 'denied'; }
      }
      return 'unsupported';
    }
    function permAskedBefore() { return localStorage.getItem(KEY_PERM_ASKED) === '1'; }

    // ── Voice-coded copy ──
    function copyFor(habit) {
      if (!habit) return COPY.CUSTOM;
      // Per-habit unique copy takes priority for curated library habits.
      // Each entry in HABIT_NOTIF_COPY is fully formed (no {n} placeholder)
      // so a user with both Hydrate and Sleep gets distinctly different
      // notification text instead of the same per-stat fallback.
      if (!habit.custom && habit.name && HABIT_NOTIF_COPY[habit.name]) {
        const tpl = HABIT_NOTIF_COPY[habit.name];
        return { title: tpl.title, body: tpl.body };
      }
      // Fallback — per-stat copy for any curated habit not yet in the
      // per-habit map, plus all user-authored custom habits.
      const key = habit.custom ? 'CUSTOM' : (habit.primaryStat || 'CUSTOM');
      const tpl = COPY[key] || COPY.CUSTOM;
      return {
        title: tpl.title.replace('{n}', habit.name || 'your habit'),
        body:  tpl.body,
      };
    }

    // ── Time helpers ──
    function parseHM(s)    { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? { h: +m[1], m: +m[2] } : null; }
    function minutesOf(hm) { return hm.h * 60 + hm.m; }
    // Returns true if a given HH:MM falls inside the quiet window. Quiet
    // hours wrap midnight (e.g., 22:00–07:00) so we handle that case.
    function isInQuietHours(hm) {
      if (!quietOn()) return false;
      const start = parseHM(quietStart()); const end = parseHM(quietEnd());
      if (!start || !end) return false;
      const t = minutesOf(hm), s = minutesOf(start), e = minutesOf(end);
      return s <= e ? (t >= s && t < e) : (t >= s || t < e);
    }

    // Was this reminder time chosen explicitly by the user (i.e., already
    // stored)? If so, the spec says quiet hours should NOT block it.
    function isUserExplicitlyChosenTime(habitId, hm) {
      const r = reminders()[habitId];
      if (!r) return false;
      const stored = parseHM(r);
      return !!stored && stored.h === hm.h && stored.m === hm.m;
    }

    // ── Schedule a single habit ──
    async function scheduleOne(habit, hm) {
      const p = plugin();
      if (!p || !isNative()) return false;     // no-op on web; still saved to storage
      if (isDisabled() || isPaused()) return false;
      // Quiet-hours skip ONLY if this isn't the user's explicitly-chosen time.
      if (isInQuietHours(hm) && !isUserExplicitlyChosenTime(habit.id, hm)) return false;
      const id = notifIdFor(habit.id);
      const c  = copyFor(habit);
      try {
        await p.cancel({ notifications: [{ id }] });
        await p.schedule({
          notifications: [{
            id,
            title: c.title,
            body:  c.body,
            schedule: { on: { hour: hm.h, minute: hm.m }, allowWhileIdle: true },
            extra: { habitId: habit.id },
          }],
        });
        return true;
      } catch (e) {
        console.warn('schedule failed', e);
        return false;
      }
    }

    async function cancelOne(habitId) {
      const p = plugin();
      if (!p || !isNative()) return;
      try { await p.cancel({ notifications: [{ id: notifIdFor(habitId) }] }); } catch (_) {}
    }

    async function cancelAll() {
      const p = plugin();
      if (!p || !isNative()) return;
      try {
        const pending = await p.getPending();
        const ids = (pending && pending.notifications || []).map(n => ({ id: n.id }));
        if (ids.length) await p.cancel({ notifications: ids });
      } catch (_) {}
    }

    // Apply daily-limit: keep the EARLIEST N reminders (by clock time today).
    function applyDailyLimit(entries) {
      const limit = dailyLimit();
      if (limit <= 0) return entries;          // 0 = unlimited
      return entries.slice().sort((a, b) => {
        return minutesOf(parseHM(a.time)) - minutesOf(parseHM(b.time));
      }).slice(0, limit);
    }

    // ── Public: set / change a habit's reminder ──
    async function setReminder(habitId, time) {
      const r = reminders();
      r[habitId] = time;
      setReminders(r);
      // habits is the closure-scoped array — accessible because Notif lives
      // inside the same IIFE. Fall back to a stub if the habit was just
      // deleted in the same tick (rare).
      const habit = habits.find(h => h.id === habitId) ||
                    { id: habitId, name: 'Habit', primaryStat: null };
      const hm = parseHM(time);
      if (!hm) return;
      await scheduleOne(habit, hm);
    }
    async function clearReminder(habitId) {
      const r = reminders();
      delete r[habitId];
      setReminders(r);
      await cancelOne(habitId);
    }

    // Reschedule everything from scratch (called on app open + daily reset
    // + Settings changes). Honors disabled, paused, daily-limit, and quiet
    // hours. Habits that have already been completed today have today's
    // notification skipped (it would auto-fire tomorrow anyway via repeat).
    async function rescheduleAll(habitsList, todayStr, completionsToday) {
      await cancelAll();
      if (isDisabled() || isPaused()) return;
      const r = reminders();
      const entries = [];
      Object.keys(r).forEach(habitId => {
        const habit = habitsList.find(h => h.id === habitId);
        if (!habit) return;     // habit deleted; skip
        entries.push({ habit, time: r[habitId] });
      });
      const after = applyDailyLimit(entries);
      for (const e of after) {
        // If today is done, the daily-repeat schedule will still fire tomorrow.
        // (Capacitor's `every: 'day'` would enable that, but iOS doesn't support
        //  precise repeat with a specific HH:MM — we use the daily fixed
        //  schedule pattern which does repeat.)
        const hm = parseHM(e.time);
        if (!hm) continue;
        await scheduleOne(e.habit, hm);
      }
      // Re-arm the daily 6 PM check-in alongside per-habit reminders so
      // every caller of rescheduleAll keeps the check-in fresh.
      try { await scheduleDailyCheckin(); } catch (_) {}
    }

    // Called from toggleHabit when a user marks a habit complete TODAY.
    // We cancel just today's pending fire — tomorrow's will be re-scheduled
    // by rescheduleAll() at next daily reset.
    async function onHabitCompleted(habitId) {
      // The simple way: cancel the entire pending notification for this id.
      // It will be re-scheduled by rescheduleAll on next daily reset.
      await cancelOne(habitId);
      // Progress just changed — re-arm the daily check-in so its body
      // reflects the new completion state.
      try { await scheduleDailyCheckin(); } catch (_) {}
    }

    function status() {
      const r = reminders();
      return {
        count:           Object.keys(r).length,
        disabled:        isDisabled(),
        paused:          isPaused(),
        pausedUntil:     pausedUntil(),
        dailyLimit:      dailyLimit(),
        quietOn:         quietOn(),
        quietStart:      quietStart(),
        quietEnd:        quietEnd(),
        permRequested:   permAskedBefore(),
        isNative:        isNative(),
        digestTime:      dailyDigestTime(),
      };
    }

    // ── Daily digest — the once-a-day morning reminder ──
    // The default notification Awakened sends. One ping. Brief copy.
    // Repeats daily at the chosen time, persists across reboots via
    // Capacitor's repeating notification schedule.
    function dailyDigestTime() { return localStorage.getItem(KEY_DIGEST_TIME) || null; }

    // ── Digest copy composers ──
    // Title: "Awakened" by default, "Awakened — {Class}" once the user
    // has earned a class. Civilian users keep the bare title because the
    // word "Civilian" pairs awkwardly with "Awakened — " (they're literally
    // not awakened yet).
    function composeDigestTitle() {
      let cls = null;
      try { cls = (typeof currentClass === 'string') ? currentClass : null; } catch (_) {}
      if (!cls || cls === 'CIVILIAN') return 'Awakened';
      let name = '';
      try { name = (typeof CLASSES === 'object' && CLASSES[cls] && CLASSES[cls].name) || ''; } catch (_) {}
      return name ? ('Awakened — ' + name) : 'Awakened';
    }

    // Body: combines player name + today's habit count + day-of-week
    // flavor + class voice + special triggers (perfect day, weekend 2x).
    // Format always leads with the user's name and a comma:
    //   "Richie, 6 await today."
    //   "Marcus, the path doesn't walk itself."
    const DIGEST_FLAVOR = {
      CIVILIAN: ['the path begins.', 'show up.', 'discipline is a daily promise.', 'you are forging the next version of you.'],
      STR:      ['strength is built daily.', "the path doesn't walk itself.", 'the body reflects the work.', "what the strong do, others won't."],
      INT:      ['the unlearned version grows stale.', 'knowledge compounds daily.', 'the mind is the long game.', 'read. reflect. repeat.'],
      VIT:      ['movement is medicine.', 'the body keeps score.', 'recovery is part of the work.', 'endurance is earned in mornings.'],
      FOCUS:    ['sharpen the blade.', 'focus is a discipline.', 'distractions are the enemy.', 'strike before doubt does.'],
      WILL:     ["what others won't, you will.", 'comfort is the enemy.', 'resolve is forged at dawn.', 'the cold makes the warrior.'],
      WLT:      ['compound the small wins.', 'wealth is built in routine.', "today's habit is tomorrow's leverage.", 'the market rewards patience.'],
      SAGE:     ['all paths lead through today.', 'balance is the rarest discipline.', 'show up everywhere.', 'the complete hunter trains all six.'],
    };

    function composeDigestBody() {
      // Pull all the signals defensively — composer must never crash the
      // schedule call even if data is missing.
      let name = 'Hunter';
      try { if (typeof playerName === 'string' && playerName.trim()) name = playerName.trim(); } catch (_) {}

      let cls = 'CIVILIAN';
      try { if (typeof currentClass === 'string' && currentClass) cls = currentClass; } catch (_) {}

      let count = 0;
      try {
        if (Array.isArray(habits) && typeof isScheduledToday === 'function') {
          count = habits.filter(isScheduledToday).length;
        }
      } catch (_) {}

      let weekend = false;
      try { weekend = (typeof isWeekend === 'function') && isWeekend(); } catch (_) {}

      // Day-of-week index in PT (matches the rest of the app's date math).
      // Mon/Wed/Fri/Sat/Sun = "count" days. Tue/Thu = "flavor" days.
      // (Civilian + Sage Tuesday/Thursday still get class-flavored lines.)
      let dow = new Date().getDay(); // 0=Sun
      try {
        if (typeof getTodayDayName === 'function') {
          const map = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
          const n = getTodayDayName();
          if (n in map) dow = map[n];
        }
      } catch (_) {}

      // Edge: zero habits scheduled today → permission to rest.
      if (count === 0) {
        return name + ', today is yours. Take a clean rest.';
      }

      // Special trigger: yesterday was a perfect day. Honors any day-of-week.
      // Detected by checking the perfect-streak count > 0 (it increments on
      // perfect-day completion and survives until the next non-perfect day).
      let perfectStreakCount = 0;
      try {
        if (typeof perfectStreak === 'object' && perfectStreak && typeof perfectStreak.count === 'number') {
          perfectStreakCount = perfectStreak.count;
        }
      } catch (_) {}
      if (perfectStreakCount >= 1 && (dow === 1 || dow === 0)) {
        // Trigger Sun/Mon morning so the user wakes up to acknowledgment.
        return name + ', ' + count + ' await. Yesterday was perfect.';
      }

      // Tuesday + Thursday → flavor line (no count).
      if (dow === 2 || dow === 4) {
        const lines = DIGEST_FLAVOR[cls] || DIGEST_FLAVOR.CIVILIAN;
        const line  = lines[(dow + new Date().getDate()) % lines.length];
        return name + ', ' + line;
      }

      // Saturday + Sunday during a double-XP weekend → suffix the count.
      if (weekend) {
        return name + ', ' + count + ' await. ⚡ 2x XP.';
      }

      // Mon/Wed/Fri → straight count, with class label if awakened.
      if (cls && cls !== 'CIVILIAN') {
        const cn = (typeof CLASSES === 'object' && CLASSES[cls] && CLASSES[cls].name) || null;
        if (cn) return name + ', ' + count + ' await, ' + cn + '.';
      }
      return name + ', ' + count + ' await today.';
    }

    async function setDailyDigest(time) {
      // Persist the choice regardless of platform — web users still see
      // it reflected in Settings even if the actual schedule is iOS-only.
      localStorage.setItem(KEY_DIGEST_TIME, time);
      const hm = parseHM(time);
      if (!hm) return false;
      const p = plugin();
      if (!p || !isNative()) return false;
      if (isDisabled() || isPaused()) return false;
      try {
        await p.cancel({ notifications: [{ id: DIGEST_NOTIF_ID }] });
        // TIMEZONE: Capacitor's schedule.on.{hour,minute} is interpreted
        // by iOS as DEVICE-LOCAL time, not UTC and not the app's PT
        // anchor. That's the right behavior — a user in NYC who picks
        // 9:00 AM gets the notification at 9 AM Eastern, not 9 AM PT.
        // (Streak math elsewhere in the app DOES use PT — see getPTDate.
        //  These two are intentionally different concerns.)
        await p.schedule({
          notifications: [{
            id:    DIGEST_NOTIF_ID,
            title: composeDigestTitle(),
            body:  composeDigestBody(),
            schedule: { on: { hour: hm.h, minute: hm.m }, allowWhileIdle: true },
            extra: { kind: 'digest' },
          }],
        });
        return true;
      } catch (e) {
        console.warn('digest schedule failed', e);
        return false;
      }
    }

    async function clearDailyDigest() {
      localStorage.removeItem(KEY_DIGEST_TIME);
      const p = plugin();
      if (!p || !isNative()) return;
      try { await p.cancel({ notifications: [{ id: DIGEST_NOTIF_ID }] }); } catch (_) {}
    }

    // ── Daily Check-In (6 PM local) ──
    // Re-scheduled every time progress changes so the body reflects the
    // user's actual completion state at fire time. Fires once per
    // schedule (repeats: false). Re-armed by every relevant event (app
    // open, habit toggle, add/delete, daily reset, etc.).
    async function cancelDailyCheckin() {
      const p = plugin();
      if (!p || !isNative()) return;
      try { await p.cancel({ notifications: [{ id: CHECKIN_NOTIF_ID }] }); } catch (_) {}
    }
    async function scheduleDailyCheckin() {
      // Always cancel the previous schedule first — if we're allowed to
      // re-arm, we'll do it below; if not (disabled/paused/etc.), the
      // cancel ensures no stale ping fires.
      await cancelDailyCheckin();
      const p = plugin();
      if (!p || !isNative()) return false;
      if (isDisabled() || isPaused()) return false;

      // Day-1 suppression — be quiet on a brand-new user's first day.
      if (isDayOne()) return false;

      // Compute progress + copy at SCHEDULE time. (We re-schedule on
      // every meaningful change, so this is always fresh for the next
      // fire.)
      const { completed, total } = getTodaysHabitProgress();
      const state = getCheckinProgressState(completed, total);
      if (!state) return false;     // no scheduled habits today
      const body = pickCheckinCopy(state, completed, total);
      if (!body) return false;

      // Quiet hours — skip if 18:00 falls inside the user's quiet window.
      // (User can't manually pick the check-in time, so quiet hours
      // ALWAYS apply to it — unlike per-habit reminders where an
      // explicitly-chosen time wins.)
      const checkinHM = parseHM(CHECKIN_TIME);
      if (checkinHM && isInQuietHours(checkinHM)) return false;

      try {
        const fireAt = computeNextCheckinDate();
        await p.schedule({
          notifications: [{
            id:       CHECKIN_NOTIF_ID,
            title:    'Awakened',
            body:     body,
            schedule: { at: fireAt, allowWhileIdle: true },
            extra:    { kind: 'checkin' },
          }],
        });
        return true;
      } catch (e) {
        console.warn('checkin schedule failed', e);
        return false;
      }
    }
    async function reapplyCheckin() {
      // Convenience alias — match the reapplyDigest pattern. Wraps
      // scheduleDailyCheckin which itself is idempotent.
      return scheduleDailyCheckin();
    }

    // Re-arm the digest after pause/disable changes or app restart.
    async function reapplyDigest() {
      const t = dailyDigestTime();
      if (!t) return;
      if (isDisabled() || isPaused()) {
        const p = plugin();
        if (p && isNative()) {
          try { await p.cancel({ notifications: [{ id: DIGEST_NOTIF_ID }] }); } catch (_) {}
        }
        return;
      }
      await setDailyDigest(t);
    }

    return {
      // queries
      getReminders: reminders,
      reminderFor:  (id) => reminders()[id] || null,
      status,
      checkPermission, requestPermission, permAskedBefore,
      // mutators
      setReminder, clearReminder, rescheduleAll, onHabitCompleted, cancelAll,
      setDisabled, setPausedUntil, setDailyLimit,
      setQuietOn, setQuietStart, setQuietEnd,
      // daily digest — the default once-a-day reminder
      dailyDigestTime, setDailyDigest, clearDailyDigest, reapplyDigest,
      // daily check-in (6 PM local — progress-aware copy)
      scheduleDailyCheckin, cancelDailyCheckin, reapplyCheckin,
      composeDigestTitle, composeDigestBody,
      // internals exposed for the UI
      copyFor, parseHM, isPaused, isDisabled,
    };
  })();

  // Expose Notif on window for dev / testing access (so the in-page
  // console can fire a sample digest notification, inspect the digest
  // copy composers, etc.). Production app code uses the closure-scoped
  // Notif directly — this is purely for inspectability.
  try { window.Notif = Notif; } catch (_) {}

  // ── HealthKit module ──────────────────────────────────────
  // Plugin:    @perfood/capacitor-healthkit (Cap 6-compatible, 15mo stale at adoption)
  // Adopted:   v1.1.4 (May 2026)
  // Why this:  fresh alternatives (@capgo/capacitor-health, others) all require
  //            Capacitor 8+. Awakened is on Capacitor 6. @perfood works, has
  //            4.3k weekly downloads, and a small read-only API surface that's
  //            unlikely to break.
  //
  // Migration target:
  //   - When we upgrade to Capacitor 8 (likely v1.2 or v2.0): swap to
  //     @capgo/capacitor-health. It's the actively-maintained successor.
  //     Repo: github.com/Cap-go/capacitor-health
  //   - If v2.x bosses need data this plugin can't expose (HRV, VO2 max, raw
  //     workout segments), self-roll a Swift shim instead. Don't chase forks.
  //
  // Wrapper pattern:
  //   Everything HealthKit-related is funneled through the Health.* surface
  //   below. Swap cost = rewrite this module. Don't import the plugin elsewhere.
  // ─────────────────────────────────────────────────────────
  const Health = (() => {
    // ── Capabilities ─────────────────────────────────────
    function isAvailable() {
      // Capacitor only injects window.Capacitor on native iOS / Android.
      // Web / PWA users get a no-op surface — every read returns null,
      // permissionStatus returns 'unavailable'.
      try {
        return !!(
          window.Capacitor &&
          window.Capacitor.isNativePlatform &&
          window.Capacitor.isNativePlatform() &&
          window.Capacitor.getPlatform &&
          window.Capacitor.getPlatform() === 'ios'
        );
      } catch (_) {
        return false;
      }
    }

    function plugin() {
      // Lazy resolution — the plugin object only exists in the native
      // bundle. On web this returns undefined and every method below
      // short-circuits via isAvailable().
      try {
        return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHealthkit;
      } catch (_) {
        return null;
      }
    }

    // ── In-memory caches (5 min TTL) ─────────────────────
    // We never persist HealthKit data — Apple Health is the source of
    // truth; these caches just avoid hammering it on every render.
    // Step + sleep have separate caches with separate clear methods so
    // each habit's auto-verify can refresh independently.
    const STEP_CACHE_TTL_MS  = 5 * 60 * 1000;
    const SLEEP_CACHE_TTL_MS = 5 * 60 * 1000;
    let stepCache  = null; // { steps, fetchedAt }
    let sleepCache = null; // { totalAsleepHours, earliestSleepStart, samples, fetchedAt }

    function isCacheFresh() {
      return stepCache && (Date.now() - stepCache.fetchedAt) < STEP_CACHE_TTL_MS;
    }
    function isSleepCacheFresh() {
      return sleepCache && (Date.now() - sleepCache.fetchedAt) < SLEEP_CACHE_TTL_MS;
    }

    function clearCache() {
      stepCache = null;
    }
    function clearSleepCache() {
      sleepCache = null;
    }

    // ── Permission status (locally tracked) ──────────────
    // The plugin has no "is authorized?" introspection method that
    // works reliably for read-only scopes (Apple intentionally hides
    // this so apps can't fingerprint denial). We track our last-known
    // status in localStorage instead.
    //   'granted'  — request returned without throwing AND a subsequent
    //                read succeeded (or hasn't been attempted yet)
    //   'denied'   — read attempt threw a permission-shaped error
    //   'unknown'  — never requested
    function permissionStatus() {
      if (!isAvailable()) return 'unavailable';
      const s = localStorage.getItem('hb_healthkit_status');
      return s === 'granted' || s === 'denied' ? s : 'unknown';
    }

    function setStatus(s) {
      try { localStorage.setItem('hb_healthkit_status', s); } catch (_) {}
    }

    // ── Authorization request ────────────────────────────
    // v1.1.5 requests stepCount + sleepAnalysis in a single call. iOS
    // bundles them into one permission sheet on the FIRST grant. For
    // existing v1.1.5 step-only users (granted before sleep was added
    // to the read array), see requestSleepPermissionIfNeeded() — iOS
    // doesn't auto-prompt for new categories on subsequent queries; we
    // have to explicitly re-call requestAuthorization with the new type.
    //
    // Permissions are independent: a user can grant steps and deny
    // sleep. Both code paths handle null returns gracefully — if sleep
    // is denied, getSleepLastNight returns null and sleep auto-verify
    // silently no-ops. Steps continue to work.
    async function requestPermissions() {
      if (!isAvailable()) return 'unavailable';
      const p = plugin();
      if (!p) {
        console.warn('[Health] plugin not registered on native bridge');
        return 'unavailable';
      }
      try {
        // Plugin uses friendly-alias strings for auth (different namespace
        // than query). 'steps' maps to stepCount, 'activity' maps to
        // sleepAnalysis + workoutType. Sleep-only is not supported by this
        // plugin's auth API; 'activity' is the only path to sleep
        // authorization. Workout permission is requested as a side effect
        // — used for v1.2.0+ workout-type habits.
        await p.requestAuthorization({
          read: ['steps', 'activity'],
          write: [''],
          all: [''],
        });
        // Apple's HealthKit doesn't report grant/deny back to the app
        // for read scopes. We optimistically mark 'granted' here; if a
        // subsequent read throws or returns no data when we expect some,
        // the read path can downgrade us to 'denied'.
        setStatus('granted');
        try { localStorage.setItem('hb_healthkit_prompted', '1'); } catch (_) {}
        // Sleep was bundled in this request — flag it as already-asked
        // so the upgrade-path helper below no-ops for fresh installs.
        try { localStorage.setItem('hb_healthkit_sleep_requested', '1'); } catch (_) {}
        console.log('[Health] permission request completed');
        return 'granted';
      } catch (e) {
        console.warn('[Health] permission request failed', e);
        setStatus('denied');
        try { localStorage.setItem('hb_healthkit_prompted', '1'); } catch (_) {}
        return 'denied';
      }
    }

    // ── Upgrade-path sleep authorization ─────────────────
    // Idempotent. Existing v1.1.5 step-grant users granted Steps before
    // sleep was added to the auth read array. iOS doesn't auto-prompt
    // on the first sleep query — we have to explicitly re-call
    // requestAuthorization with the new type. iOS shows the permission
    // sheet for ONLY the new category (sleep); the existing Steps
    // grant stays untouched.
    //
    // Flagged via hb_healthkit_sleep_requested. Set to '1' ONLY on
    // successful resolve of p.requestAuthorization() — never in the
    // catch block. iOS resolves silently for already-decided categories
    // (granted OR denied), so a real throw is a real failure and
    // should be retried on the next launch. Defensive flag-setting in
    // catch was the bug that landed users in a "flag=1, but iOS sheet
    // never fired" state.
    async function requestSleepPermissionIfNeeded() {
      if (!isAvailable()) return 'unavailable';
      if (localStorage.getItem('hb_healthkit_sleep_requested') === '1') return 'already-requested';
      const p = plugin();
      if (!p) return 'unavailable';
      try {
        // 'activity' is the plugin's friendly alias for sleep+workout.
        // See requestPermissions() above for the full explanation of
        // why 'sleepAnalysis' alone doesn't work in the auth API.
        // Re-pass 'steps' so iOS sees a coherent set; the existing Steps
        // grant stays untouched, and the new sheet shows ONLY the new
        // categories (sleep + workout).
        await p.requestAuthorization({
          read: ['steps', 'activity'],
          write: [''],
          all: [''],
        });
        // ONLY set the flag here — post-resolve. Never in catch.
        try { localStorage.setItem('hb_healthkit_sleep_requested', '1'); } catch (_) {}
        console.log('[Health] sleep permission request completed (upgrade path)');
        return 'requested';
      } catch (e) {
        console.warn('[Health] sleep permission request failed', e);
        // Do NOT set the flag here. A throw is a real failure —
        // retry next cold launch. (Previously flagged defensively
        // here, which left users stuck with flag=1 and no sheet.)
        return 'failed';
      }
    }

    // ── Step query ───────────────────────────────────────
    // Returns total steps for today (PT date). Sums all sample values
    // returned by HealthKit in the [00:00 PT, now] window.
    //
    // Returns null on:
    //   - non-native platform
    //   - missing plugin
    //   - permission denied / never requested
    //   - HealthKit query throws
    //
    // Never throws. Auto-verify must be a silent enhancement.
    async function getStepsToday() {
      if (!isAvailable()) return null;
      if (isCacheFresh()) return stepCache.steps;

      const p = plugin();
      if (!p) return null;

      const status = permissionStatus();
      if (status === 'denied' || status === 'unknown') {
        // 'unknown' = never requested. Caller should call
        // requestPermissions() first. We don't auto-prompt here so reads
        // never trigger an unexpected iOS sheet.
        return null;
      }

      try {
        // PT-anchored "start of today." getPTDate() returns "YYYY-MM-DD"
        // in America/Los_Angeles. Construct an ISO at midnight PT, which
        // HealthKit interprets as a wall-clock timestamp.
        const todayPT = (typeof getPTDate === 'function') ? getPTDate() : new Date().toISOString().slice(0, 10);
        const start = new Date(todayPT + 'T00:00:00');
        const end = new Date();

        // sampleName MUST be 'stepCount' (camelCase, maps to
        // HKQuantityTypeIdentifierStepCount). The @perfood README
        // ambiguously suggests 'steps' as an alternative — that string
        // is accepted only by requestAuthorization, not by the query
        // API. Passing 'steps' here throws "Error in sample name."
        const result = await p.queryHKitSampleType({
          sampleName: 'stepCount',
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          limit: 0, // 0 = unlimited per @perfood README
        });

        // result shape: { countReturn, resultData: [{ value, ...}, ...] }
        const samples = (result && result.resultData) || [];
        const total = samples.reduce((sum, s) => sum + (Number(s.value) || 0), 0);

        stepCache = { steps: total, fetchedAt: Date.now() };
        // First successful read confirms 'granted' — if iOS had silently
        // denied, the query would have thrown or returned empty. We
        // accept zero-step days as legitimate (user just hasn't moved).
        setStatus('granted');
        console.log('[Health] steps today:', total, '(samples:', samples.length, ')');
        return total;
      } catch (e) {
        console.warn('[Health] step query failed', e);
        // Don't flip to 'denied' on a single failure — could be transient.
        // Only requestPermissions explicitly setting 'denied' on throw.
        return null;
      }
    }

    // ── Sleep query ──────────────────────────────────────
    // Returns last night's main sleep block summary, or null. Window:
    // [now − 18h, now]. Caller decides what to do with the return.
    //
    // Shape:
    //   {
    //     totalAsleepHours:   <number>,           // sum of 'Asleep' sample durations
    //     earliestSleepStart: <Date>,             // earliest qualifying asleep sample.startDate
    //     samples:            [{startDate, endDate, duration, sleepState}, ...]
    //   }
    //
    // Returns null on:
    //   - non-native platform / missing plugin
    //   - permission denied / never requested
    //   - HealthKit query throws OR resultData is empty
    //
    // Caveats:
    //   - The plugin collapses Apple's HKCategoryValueSleepAnalysis enum
    //     into 2 strings: 'InBed' and 'Asleep'. The 'Asleep' bucket
    //     incorrectly includes `awake` rawValue=2 samples (not just
    //     asleepCore/Deep/REM). For total-asleep computation this
    //     overcounts by however long mid-night awake periods are —
    //     typically <15 min/night. Acceptable v1 error margin.
    //   - earliestSleepStart uses the EARLIEST 'Asleep' sample whose
    //     duration ≥ HEALTHKIT_SLEEP_NAP_MIN_MINUTES. The 30-min filter
    //     skips brief naps. Edge case: a 1-hour evening nap will produce
    //     a false-positive "before midnight" verdict. Rare; user can
    //     manually un-check.
    //   - Window is 18h backwards from now. Device-local clock — sleep
    //     crosses midnight, PT-anchoring is wrong (CLAUDE.md notif rule).
    //   - Sleep data lands in HealthKit on wake (Apple Watch) or backfill
    //     (iPhone alarm). Auto-verify won't fire AT midnight; it fires
    //     when user opens app in the morning.
    //
    // Never throws.
    async function getSleepLastNight() {
      if (!isAvailable()) return null;
      if (isSleepCacheFresh()) return sleepCache;

      const p = plugin();
      if (!p) return null;

      const status = permissionStatus();
      if (status === 'denied' || status === 'unknown') return null;

      try {
        const now = new Date();
        const start = new Date(now.getTime() - HEALTHKIT_SLEEP_LOOKBACK_HOURS * 3600 * 1000);

        const result = await p.queryHKitSampleType({
          sampleName: 'sleepAnalysis',
          startDate: start.toISOString(),
          endDate: now.toISOString(),
          limit: 0,
        });

        const samples = (result && result.resultData) || [];
        if (samples.length === 0) {
          // Empty result = no signal (iPhone-only with no data, or genuinely
          // no sleep). Return null — auto-verify treats this as silent skip,
          // not a failed habit.
          console.log('[Health] sleep: no samples in last', HEALTHKIT_SLEEP_LOOKBACK_HOURS, 'h');
          return null;
        }

        // Filter to 'Asleep' samples (excluded: 'InBed' wrappers).
        const asleepSamples = samples.filter(s => s && s.sleepState === 'Asleep');

        // Total — sum durations (already in hours from plugin).
        const totalAsleepHours = asleepSamples.reduce((sum, s) => sum + (Number(s.duration) || 0), 0);

        // Earliest qualifying asleep sample = first sample whose duration
        // exceeds the nap floor. Sort by startDate ascending.
        const napFloorHours = HEALTHKIT_SLEEP_NAP_MIN_MINUTES / 60;
        const qualifying = asleepSamples
          .filter(s => Number(s.duration) >= napFloorHours)
          .map(s => ({ ...s, _start: new Date(s.startDate) }))
          .sort((a, b) => a._start - b._start);
        const earliestSleepStart = qualifying.length ? qualifying[0]._start : null;

        sleepCache = {
          totalAsleepHours,
          earliestSleepStart,
          samples: asleepSamples,
          fetchedAt: Date.now(),
        };
        setStatus('granted');
        console.log('[Health] sleep last night:', totalAsleepHours.toFixed(2), 'h asleep,',
          'earliest:', earliestSleepStart && earliestSleepStart.toISOString(),
          '(samples:', samples.length, 'asleep:', asleepSamples.length, ')');
        return sleepCache;
      } catch (e) {
        console.warn('[Health] sleep query failed', e);
        return null;
      }
    }

    // Public surface
    return {
      isAvailable,
      requestPermissions,
      requestSleepPermissionIfNeeded,
      getStepsToday,
      getSleepLastNight,
      permissionStatus,
      clearCache,       // step cache
      clearSleepCache,  // sleep cache
    };
  })();

  // Expose for dev / testing — same pattern as Notif.
  try { window.Health = Health; } catch (_) {}

  // ── AUTO_VERIFY metadata storage ─────────────────────────
  // Persists which completions were auto-verified (vs. manually tapped)
  // and which auto-verified completions the user explicitly un-checked
  // (so we don't re-check them on next refresh).
  //
  // localStorage shape:
  //   hb_completions_auto      { 'YYYY-MM-DD': { habitId: { source, value } } }
  //   hb_av_unchecked_dates    { habitName: ['YYYY-MM-DD', ...] }  (per-habit, auto-pruned to 14 days)
  //
  // The unchecked-dates map is keyed by habit NAME (canonical foreign
  // key, stable across reinstalls — see CLAUDE.md "habit identity is
  // the name string"). v1.1.5 migrates the old walk-only flat array
  // (hb_walk_unchecked_dates) into 'Daily walk' under the new key.
  const AUTO_VERIFY = (() => {
    function load() {
      try { return JSON.parse(localStorage.getItem('hb_completions_auto') || '{}'); }
      catch (_) { return {}; }
    }
    function persist(map) {
      try { localStorage.setItem('hb_completions_auto', JSON.stringify(map)); } catch (_) {}
    }
    function loadUncheckedMap() {
      // One-time migration: fold legacy 'hb_walk_unchecked_dates' (flat
      // array) into the new per-habit-name map under 'Daily walk'.
      try {
        const legacy = localStorage.getItem('hb_walk_unchecked_dates');
        if (legacy !== null) {
          const arr = JSON.parse(legacy) || [];
          const cur = JSON.parse(localStorage.getItem('hb_av_unchecked_dates') || '{}');
          const merged = Array.from(new Set([...(cur['Daily walk'] || []), ...arr]));
          cur['Daily walk'] = merged;
          localStorage.setItem('hb_av_unchecked_dates', JSON.stringify(cur));
          localStorage.removeItem('hb_walk_unchecked_dates');
        }
      } catch (_) {}
      try { return JSON.parse(localStorage.getItem('hb_av_unchecked_dates') || '{}'); }
      catch (_) { return {}; }
    }
    function persistUncheckedMap(map) {
      try { localStorage.setItem('hb_av_unchecked_dates', JSON.stringify(map)); } catch (_) {}
    }
    function recordAutoVerify(id, meta) {
      if (!today) return;
      const map = load();
      if (!map[today]) map[today] = {};
      map[today][id] = meta || { source: 'unknown' };
      persist(map);
    }
    function clearAutoVerify(id) {
      const map = load();
      if (map[today] && map[today][id]) {
        delete map[today][id];
        if (!Object.keys(map[today]).length) delete map[today];
        persist(map);
      }
    }
    function isAutoVerifiedToday(id) {
      const map = load();
      return !!(map[today] && map[today][id]);
    }
    function isAutoVerifiedOnDate(id, dateStr) {
      const map = load();
      return !!(map[dateStr] && map[dateStr][id]);
    }
    // Mark today as "user explicitly un-checked auto-verified completion
    // of habitName" — auto-verify will not re-check until tomorrow.
    function markUnchecked(habitName) {
      if (!habitName || !today) return;
      const map = loadUncheckedMap();
      const arr = map[habitName] || [];
      if (!arr.includes(today)) arr.push(today);
      // Prune entries older than 14 days per habit. Cheap; runs on
      // each write so per-habit arrays stay bounded.
      const cutoff = new Date(today + 'T00:00:00');
      cutoff.setDate(cutoff.getDate() - 14);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      map[habitName] = arr.filter(d => d >= cutoffStr);
      persistUncheckedMap(map);
    }
    function wasUncheckedToday(habitName) {
      if (!habitName || !today) return false;
      const map = loadUncheckedMap();
      return Array.isArray(map[habitName]) && map[habitName].includes(today);
    }
    // Backward-compat aliases — referenced by existing toggleHabit code.
    // Thin wrappers so we don't have to touch the call site immediately.
    const markWalkUnchecked       = () => markUnchecked('Daily walk');
    const wasWalkUncheckedToday   = () => wasUncheckedToday('Daily walk');
    return {
      recordAutoVerify, clearAutoVerify,
      isAutoVerifiedToday, isAutoVerifiedOnDate,
      markUnchecked, wasUncheckedToday,
      markWalkUnchecked, wasWalkUncheckedToday, // legacy
    };
  })();
  try { window.AutoVerify = AUTO_VERIFY; } catch (_) {}

  // ── Walk auto-verify orchestration ───────────────────────
  // Locates the canonical "Daily walk" habit (strict equality on name +
  // not custom — see CLAUDE.md "Habit identity is the name string"
  // convention). Returns null if missing.
  function findWalkHabit() {
    return habits.find(h => h.name === 'Daily walk' && !h.custom) || null;
  }

  // First-encounter pre-prompt explainer. Shown ONCE per device, before
  // iOS's native HealthKit permission sheet. The native sheet is opaque
  // about what permissions an app is asking for and why — this modal
  // gives users the context to make an informed grant.
  //
  // Triggered from autoVerifyWalk() the first time we see the walk habit
  // on a native iOS build with permissionStatus === 'unknown'.
  function showHealthKitPreprompt() {
    if (document.getElementById('hk-preprompt-overlay')) return;

    // Read the user's current goal so the copy reflects reality. Fresh
    // installs see the default 3,000; users who've already configured
    // a different value (via Edit Habit during onboarding or after) see
    // their own number.
    const walk = (typeof findWalkHabit === 'function') ? findWalkHabit() : null;
    const initialGoal = walk ? getHabitStepGoal(walk) : HEALTHKIT_WALK_DEFAULT_THRESHOLD;

    // v1.1.5 sleep extension: detect if the user also has either sleep
    // habit. If so, append a sentence acknowledging that sleep
    // auto-verifies too. Single permission grant covers both data types
    // — no separate explainer or chip picker for sleep here (configured
    // via Edit Habit modal).
    const hasSleepHabit   = !!(typeof findSleepHabit === 'function' && findSleepHabit());
    const hasBedtimeHabit = !!(typeof findSleepBeforeMidnightHabit === 'function' && findSleepBeforeMidnightHabit());
    const hasAnySleep     = hasSleepHabit || hasBedtimeHabit;
    let sleepLine = '';
    if (hasSleepHabit && hasBedtimeHabit) {
      sleepLine = 'Your sleep habits — Sleep and Sleep before midnight — auto-verify too, based on last night’s Apple Health data.';
    } else if (hasSleepHabit) {
      sleepLine = 'Your Sleep habit auto-verifies too, based on last night’s Apple Health data.';
    } else if (hasBedtimeHabit) {
      sleepLine = 'Your Sleep before midnight habit auto-verifies too, based on last night’s Apple Health data.';
    }
    const dataLabel = hasAnySleep ? 'Your steps and sleep' : 'Your steps';

    const overlay = document.createElement('div');
    overlay.id = 'hk-preprompt-overlay';
    overlay.className = 'modal-overlay';
    overlay.innerHTML =
      '<div class="modal-card hk-preprompt-card">' +
        '<h2 class="hk-preprompt-title">Auto-verify your ' + (hasAnySleep ? 'Habits' : 'Walk') + '</h2>' +
        '<p class="hk-preprompt-body">' +
          'Awakened can use Apple Health to mark the Daily walk habit complete ' +
          'when you reach <button type="button" id="hk-preprompt-goal-btn" class="hk-preprompt-goal-btn">' +
            initialGoal.toLocaleString() + '+ steps' +
          '</button> &mdash; no tap needed.' +
        '</p>' +
        // Inline chip picker — collapsed by default, opens when the
        // step-goal value above is tapped. Reuses .habit-edit-stepgoal-*
        // styles for visual consistency with the Edit Habit modal.
        '<div id="hk-preprompt-stepgoal" class="habit-edit-stepgoal hk-preprompt-stepgoal" hidden>' +
          '<div class="habit-edit-stepgoal-chips">' +
            '<button class="habit-edit-stepgoal-chip" data-preset="1000"  type="button">1,000</button>' +
            '<button class="habit-edit-stepgoal-chip" data-preset="3000"  type="button">3,000</button>' +
            '<button class="habit-edit-stepgoal-chip" data-preset="5000"  type="button">5,000</button>' +
            '<button class="habit-edit-stepgoal-chip" data-preset="8000"  type="button">8,000</button>' +
            '<button class="habit-edit-stepgoal-chip" data-preset="10000" type="button">10,000</button>' +
            '<button class="habit-edit-stepgoal-chip" data-preset="custom" type="button">Custom</button>' +
          '</div>' +
          '<div id="hk-preprompt-stepgoal-custom" class="habit-edit-stepgoal-custom hidden">' +
            '<input id="hk-preprompt-stepgoal-input" class="habit-edit-stepgoal-input" type="number" inputmode="numeric" min="100" max="50000" placeholder="Enter steps (100–50,000)">' +
            '<button id="hk-preprompt-stepgoal-save"   class="habit-edit-stepgoal-save"   type="button">Save</button>' +
            '<button id="hk-preprompt-stepgoal-cancel" class="habit-edit-stepgoal-cancel" type="button">Cancel</button>' +
          '</div>' +
        '</div>' +
        (sleepLine ? '<p class="hk-preprompt-body">' + sleepLine + '</p>' : '') +
        '<p class="hk-preprompt-body hk-preprompt-privacy">' +
          dataLabel + ' stay on your device. Awakened never sees them leave your phone.' +
        '</p>' +
        '<div class="hk-preprompt-actions">' +
          '<button class="hk-preprompt-secondary" id="hk-preprompt-skip">Not Now</button>' +
          '<button class="hk-preprompt-primary"   id="hk-preprompt-enable">Enable</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    const close = () => {
      try { localStorage.setItem('hb_healthkit_prompted', '1'); } catch (_) {}
      overlay.remove();
    };

    // ── Step-goal picker wiring ──────────────────────────────
    // Tapping the inline number toggles the chip picker. Tapping a
    // preset writes via setHabitStepGoal (immediately persists, since
    // the modal has no Save button — just Enable / Not Now). The
    // displayed number updates live so the user sees their choice
    // reflected before they grant permission.
    const goalBtn  = document.getElementById('hk-preprompt-goal-btn');
    const picker   = document.getElementById('hk-preprompt-stepgoal');
    const chipGrp  = picker.querySelector('.habit-edit-stepgoal-chips');
    const customRow= document.getElementById('hk-preprompt-stepgoal-custom');
    const customIn = document.getElementById('hk-preprompt-stepgoal-input');
    const customSave = document.getElementById('hk-preprompt-stepgoal-save');
    const customCancel = document.getElementById('hk-preprompt-stepgoal-cancel');

    const refreshChipState = () => {
      const cur = walk ? getHabitStepGoal(walk) : initialGoal;
      const isCustom = !HEALTHKIT_WALK_PRESETS.includes(cur);
      picker.querySelectorAll('.habit-edit-stepgoal-chip').forEach(chip => {
        const p = chip.dataset.preset;
        const active = (p === 'custom') ? isCustom : (parseInt(p, 10) === cur);
        chip.classList.toggle('habit-edit-stepgoal-chip--active', active);
      });
      goalBtn.textContent = cur.toLocaleString() + '+ steps';
    };
    refreshChipState();

    goalBtn.addEventListener('click', () => {
      picker.hidden = !picker.hidden;
    });

    chipGrp.addEventListener('click', (e) => {
      const chip = e.target.closest('.habit-edit-stepgoal-chip');
      if (!chip) return;
      const p = chip.dataset.preset;
      if (p === 'custom') {
        customRow.classList.remove('hidden');
        customIn.value = walk ? String(getHabitStepGoal(walk)) : String(initialGoal);
        setTimeout(() => customIn.focus(), 50);
        return;
      }
      const n = parseInt(p, 10);
      if (!Number.isFinite(n)) return;
      // Persist only if the user actually has the walk habit (they
      // should — the pre-prompt is gated on findWalkHabit() returning
      // truthy in autoVerifyWalk, but be defensive).
      if (walk) setHabitStepGoal(walk, n);
      customRow.classList.add('hidden');
      refreshChipState();
    });

    const commitCustom = () => {
      const parsed = parseInt(customIn.value, 10);
      const fallback = Number.isFinite(parsed) ? parsed : HEALTHKIT_WALK_DEFAULT_THRESHOLD;
      const n = Math.max(HEALTHKIT_WALK_THRESHOLD_MIN, Math.min(HEALTHKIT_WALK_THRESHOLD_MAX, fallback));
      if (walk) setHabitStepGoal(walk, n);
      customRow.classList.add('hidden');
      refreshChipState();
    };
    customSave.addEventListener('click', commitCustom);
    customIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') commitCustom(); });
    customCancel.addEventListener('click', () => { customRow.classList.add('hidden'); });

    // ── Skip / Enable wiring ─────────────────────────────────
    document.getElementById('hk-preprompt-skip').addEventListener('click', () => {
      console.log('[Health] user declined pre-prompt — proceeding without HealthKit');
      close();
    });
    document.getElementById('hk-preprompt-enable').addEventListener('click', async () => {
      close();
      const result = await Health.requestPermissions();
      console.log('[Health] permission result:', result);
      if (result === 'granted') {
        // Try to verify immediately — if user has already walked today
        // OR slept past their goal last night, they get instant
        // gratification on both habits.
        autoVerifyWalk();
        autoVerifySleep();
      }
    });
  }

  // Auto-verify entry point. Called from renderHabits() on each render.
  // Async: returns a promise that resolves after the HealthKit query
  // completes (or short-circuits). Never throws — auto-verify is a
  // silent enhancement.
  async function autoVerifyWalk() {
    if (!Health.isAvailable()) return;          // web / non-iOS
    // User has paused auto-verify in Settings → Apple Health. Manual
    // completion path is unaffected. (v1.1.5)
    if (isAutoVerifyDisabled()) return;
    const walk = findWalkHabit();
    if (!walk) return;                           // user doesn't have the habit
    if (isChecked(walk.id)) return;              // already done (manual or auto)
    if (AUTO_VERIFY.wasUncheckedToday('Daily walk')) return;  // user opted out for today

    const status = Health.permissionStatus();

    // First-encounter path: show pre-prompt, don't query HealthKit yet.
    if (status === 'unknown') {
      if (localStorage.getItem('hb_healthkit_prompted') !== '1') {
        showHealthKitPreprompt();
      }
      return;
    }
    if (status !== 'granted') return;

    const steps = await Health.getStepsToday();
    if (steps == null) return;
    const threshold = getHabitStepGoal(walk);
    if (steps < threshold) return;

    // Re-check completion state — Health.getStepsToday is async, the
    // user may have manually tapped during the await.
    if (isChecked(walk.id)) return;

    AUTO_VERIFY.recordAutoVerify(walk.id, {
      source: 'healthkit-steps',
      value: steps,
      threshold: threshold,
    });

    // If the LI is currently in the DOM, animate via the standard
    // toggleHabit path (silent mode skips the burst). Otherwise mutate
    // state silently — UI catches up on next renderHabits().
    const li = document.querySelector('.habit-item[data-id="' + walk.id + '"]');
    toggleHabit(walk.id, li, { silent: true });
    console.log('[Health] auto-verified Daily walk:', steps, 'steps');

    // Re-render so buildItem() can paint the auto-verify pill into the
    // card. The next autoVerifyWalk() call from that render no-ops via
    // the isChecked() guard, so no loop.
    if (currentTab === 'habits') renderHabits();
  }
  try { window.autoVerifyWalk = autoVerifyWalk; } catch (_) {}

  // ── Sleep auto-verify orchestration (v1.1.5) ─────────────
  // Two parallel paths, both feeding from the same Health.getSleepLastNight()
  // query (single HealthKit roundtrip per render thanks to the sleep cache):
  //   - Sleep duration habit  → totalAsleepHours ≥ habit.sleepGoalHours
  //   - Sleep before midnight → earliestSleepStart < device-local midnight
  //
  // Triggered from renderHabits() and visibilitychange — same hooks as
  // autoVerifyWalk. Sleep data lands in HealthKit on user wake (Apple Watch)
  // or backfill (iPhone alarm), so neither auto-verify fires AT midnight;
  // they fire when the user opens the app in the morning.
  function findSleepHabit() {
    return habits.find(h => h.name === 'Sleep' && !h.custom) || null;
  }
  function findSleepBeforeMidnightHabit() {
    return habits.find(h => h.name === 'Sleep before midnight' && !h.custom) || null;
  }

  async function autoVerifySleep() {
    if (!Health.isAvailable()) return;
    if (isAutoVerifyDisabled()) return;
    const sleep = findSleepHabit();
    const bedtime = findSleepBeforeMidnightHabit();
    if (!sleep && !bedtime) return; // user has neither; skip query entirely

    const status = Health.permissionStatus();
    // Don't trigger the pre-prompt from the sleep path — autoVerifyWalk
    // already handles that. If status is 'unknown', let walk handle it.
    if (status !== 'granted') return;

    // Upgrade-path: existing v1.1.5 step-grant users granted Steps
    // before sleep was added to the auth array. iOS doesn't auto-prompt
    // on the first sleep query — we have to explicitly re-call
    // requestAuthorization with the new type. Idempotent + flagged in
    // localStorage so it only fires once per device. Fresh installs
    // pass through immediately (flag set during the bundled request).
    await Health.requestSleepPermissionIfNeeded();

    const data = await Health.getSleepLastNight();
    if (!data) return;

    // ── Path A: Sleep duration ──────────────────────────────
    if (sleep && !isChecked(sleep.id) && !AUTO_VERIFY.wasUncheckedToday('Sleep')) {
      const goalHours = getSleepGoalHours(sleep);
      if (data.totalAsleepHours >= goalHours) {
        // Re-check completion (async race with manual tap).
        if (!isChecked(sleep.id)) {
          AUTO_VERIFY.recordAutoVerify(sleep.id, {
            source: 'healthkit-sleep-duration',
            value: data.totalAsleepHours,
            threshold: goalHours,
          });
          const li = document.querySelector('.habit-item[data-id="' + sleep.id + '"]');
          toggleHabit(sleep.id, li, { silent: true });
          console.log('[Health] auto-verified Sleep:', data.totalAsleepHours.toFixed(2), 'h');
        }
      }
    }

    // ── Path B: Sleep before midnight ────────────────────────
    if (bedtime && !isChecked(bedtime.id) && !AUTO_VERIFY.wasUncheckedToday('Sleep before midnight')) {
      const earliest = data.earliestSleepStart;
      if (earliest) {
        // Device-local midnight at the START of today. If the user fell
        // asleep before this timestamp, "before midnight" verifies.
        // (CLAUDE.md: notifications + sleep windows use device-local time,
        // not PT — sleep crosses midnight, PT-anchoring is wrong.)
        const localMidnight = new Date();
        localMidnight.setHours(0, 0, 0, 0);
        if (earliest < localMidnight) {
          if (!isChecked(bedtime.id)) {
            AUTO_VERIFY.recordAutoVerify(bedtime.id, {
              source: 'healthkit-sleep-bedtime',
              value: earliest.toISOString(),
            });
            const li = document.querySelector('.habit-item[data-id="' + bedtime.id + '"]');
            toggleHabit(bedtime.id, li, { silent: true });
            console.log('[Health] auto-verified Sleep before midnight:', earliest.toISOString());
          }
        }
      }
    }

    // Single re-render after both paths — buildItem() picks up new pills,
    // next render's autoVerifySleep() no-ops via isChecked() guards.
    if (currentTab === 'habits') renderHabits();
  }
  try { window.autoVerifySleep = autoVerifySleep; } catch (_) {}

  // ── INIT ─────────────────────────────────────────────────
  function init() {
    load();
    today = getPTDate();
    histViewYear  = parseInt(today.slice(0, 4), 10);
    histViewMonth = parseInt(today.slice(5, 7), 10) - 1;
    if (currentClass === null) {
      // First run — set class silently, no popup
      currentClass = determineClass();
      localStorage.setItem('hb_class', currentClass);
    }
    // ── v1.2 migration: re-classify under new Lv5 rules ────────
    // Existing users currently classified under the old rules (e.g.,
    // Sage at all-Lv2) get silently re-evaluated. Most early users
    // will end up Civilian until they earn Lv5 in at least one stat.
    if (!localStorage.getItem('hb_class_v2_migrated')) {
      const r = evaluateClass(currentClass);
      // For migration we never fire popups — even if multi-stat choice
      // would apply, leave them as their current class (or Civilian if
      // they don't qualify) and the choice will trigger naturally on
      // their next level-up after upgrading.
      const target = r.choice ? 'CIVILIAN' : r.class;
      if (target !== currentClass) {
        currentClass = target;
        localStorage.setItem('hb_class', currentClass);
      }
      // Pre-flag awakening as already-seen if user was already in a class
      // before migration — they shouldn't get the first-time celebration
      // for a class they were already running.
      if (currentClass !== 'CIVILIAN') {
        localStorage.setItem('hb_awakened_once', '1');
      }
      localStorage.setItem('hb_class_v2_migrated', '1');
    }
    // ── v1.1.5 migration: rename canonical 'Cardio' → 'Cardio workout'.
    // The original name read as redundant with 'Daily walk' in the
    // habit grid; the rename signals "dedicated training session" to
    // distinguish it from ambient steps. Habit identity is the name
    // string (CLAUDE.md), so we rewrite habit.name in-place. Streaks,
    // completions, and PRs continue to work because they're keyed by
    // habit.id, not name.
    if (!localStorage.getItem('hb_cardio_renamed')) {
      let didRename = false;
      habits.forEach(h => {
        if (h && h.name === 'Cardio' && !h.custom) {
          h.name = 'Cardio workout';
          didRename = true;
        }
      });
      if (didRename) save();
      localStorage.setItem('hb_cardio_renamed', '1');
    }
    // ── HealthKit auth-version migration ─────────────────────
    // Whenever HEALTHKIT_AUTH_VERSION is bumped (i.e., a new HealthKit
    // category was added to the requestAuthorization() read array),
    // existing users with status='granted' need to re-fire the auth
    // call so iOS shows a sheet for the newly-added categories. We
    // can't detect "category not yet authorized" via the plugin API
    // — Apple intentionally hides denial state for read scopes. So we
    // version the auth surface and let the upgrade-gate re-fire when
    // the stored version is older than current.
    //
    // This pattern obsoletes the v1.1.5-only hb_sleep_recovery_v1
    // flag (which only addressed the specific dev-build bug) and
    // generalizes it for every future category addition.
    try {
      const stored = parseInt(localStorage.getItem('hb_healthkit_authversion') || '0', 10);
      if (!Number.isFinite(stored) || stored < HEALTHKIT_AUTH_VERSION) {
        HEALTHKIT_AUTH_FLAGS_TO_CLEAR.forEach(k => {
          try { localStorage.removeItem(k); } catch (_) {}
        });
        localStorage.setItem('hb_healthkit_authversion', String(HEALTHKIT_AUTH_VERSION));
      }
    } catch (_) {}
    // ── v1.1.5 sleep auth upgrade-path ───────────────────────
    // Existing v1.1.5 step-grant users granted Steps before sleep was
    // added to the auth array. Fire once per cold launch (idempotent
    // via hb_healthkit_sleep_requested flag inside the helper). Not
    // gated on having a sleep habit — future-proofs against users
    // adding Sleep / Sleep before midnight later.
    //
    // Slight delay so the WebView is fully ready before iOS draws the
    // permission sheet — avoids races during app cold launch.
    try {
      if (Health.isAvailable() && Health.permissionStatus() === 'granted') {
        if (localStorage.getItem('hb_healthkit_sleep_requested') !== '1') {
          setTimeout(() => {
            try { Health.requestSleepPermissionIfNeeded(); } catch (_) {}
          }, 1500);
        }
      }
    } catch (_) {}
    setupTabs();
    setupLibrary();
    setupSchedulePicker();
    setupCtxMenu();
    setupEditModal();
    setupNoteModal();
    setupCompoundPopup();
    setupBonusInfoPopup();
    setupPRDetailSheet();
    setupDailyMissionCard();
    setupHonestDayModal();
    setupShieldInfoModal();
    setupOriginStorySheet();
    migrateOriginStoriesIfNeeded();
    // v3: rewrite story text using the new tightened templates while
    // preserving original dates/classes. Idempotent via hb_origin_v3_migrated.
    migrateOriginTextV3IfNeeded();
    // v4: strip leading date from story body so the date only appears in
    // the chapter header. Idempotent via hb_origin_v4_migrated.
    migrateOriginTextV4IfNeeded();
    // Streak forgiveness: on app open, process missed days (use shields /
    // absorb honest days / break streaks), then surface any queued shield
    // notices as toasts, then check for comeback opportunity if the user
    // has a pending break flag.
    processStreakRollover();
    setTimeout(() => flushPendingShieldNotices(), 800);
    migratePRsIfNeeded();
    setupEmojiPicker();
    setupCustomHabitModal();
    setupReminderOfferModal();
    setupStreaksSheet();
    setupClassDetail();
    setupNotifTapRouting();
    setupStatDetail();
    setupSettings();
    setupStreakDanger();
    setupMorningNudge();
    setupDoubleXpBanner();
    setupHabitInfoSheet();
    setupHabitDetailGesture();
    setupWhatsNewSheet();
    setupRankPopup();

    // Reflect canonical APP_VERSION in the Settings header
    const verEl = document.getElementById('settings-app-ver');
    if (verEl) verEl.textContent = 'Version ' + APP_VERSION;

    // Settings → "What's New" button (manual open — does NOT update flag)
    const wnBtn = document.getElementById('settings-whats-new-btn');
    if (wnBtn) {
      wnBtn.addEventListener('click', () => {
        // Close settings first so the new sheet has a clean stage
        if (typeof closeSettings === 'function') closeSettings();
        setTimeout(() => openWhatsNewSheet({ manual: true }), 320);
      });
    }

    document.getElementById('day-popup-overlay').addEventListener('click', closeDayPopup);
    document.getElementById('day-popup').addEventListener('click', closeDayPopup);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      checkDayChange();
      // App resume → invalidate both HealthKit caches and re-attempt
      // both auto-verifies. User may have walked or finished sleeping
      // while we were backgrounded; sleep data in particular only
      // appears in HealthKit on wake (Apple Watch) or alarm-time
      // backfill (iPhone), so resume is a high-yield moment.
      try { Health.clearCache       && Health.clearCache();       } catch (_) {}
      try { Health.clearSleepCache  && Health.clearSleepCache();  } catch (_) {}
      try { autoVerifyWalk();  } catch (_) {}
      try { autoVerifySleep(); } catch (_) {}
    });
    setInterval(() => { checkDayChange(); checkStreakDanger(); checkMorningRoutineNudge(); }, 60_000);
    registerSW();

    // Reschedule habit reminders on app open. Picks up pause-expirations,
    // any habits/reminders the user added on another device, and re-arms
    // notifications so iOS has them ready while the app is closed.
    setTimeout(() => {
      try { Notif.rescheduleAll(habits, today, completions[today] || []); } catch (_) {}
      // Also re-arm the daily morning digest (the default reminder).
      try { Notif.reapplyDigest(); } catch (_) {}
      // Re-arm the 6 PM check-in (rescheduleAll above already does this
      // internally, but call explicitly for resilience if the per-habit
      // path is ever short-circuited).
      try { Notif.reapplyCheckin(); } catch (_) {}
    }, 1200);

    if (needsWelcome) {
      showWelcomeScreen();
    } else if (needsOnboarding) {
      showPathScreen();
    } else {
      render();
      setupFridayBanner();
      // Auto-show What's New for users who already finished onboarding
      // and have either never seen this version or last saw an older one.
      maybeAutoShowWhatsNew();
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
