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
  const APP_VERSION = '1.1.0';

  // ── WHAT'S NEW ───────────────────────────────────────────
  // Version-keyed announcements. The What's New sheet always displays
  // the highest version's content; future releases just add a new key.
  const WHATS_NEW = {
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
    'Cardio':                             { unit: 'min',     def: 30,  step: 5,   min: 20 },
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

  // Returns { base, goal } — goal is null if no goal explicitly set by user
  function habitDisplayParts(habit) {
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
  ];

  const ACHIEVEMENTS = [
    { id: 'first_step',        icon: '👣', name: 'First Step',        desc: 'Complete your first habit ever' },
    { id: 'week_warrior',      icon: '🗓️', name: 'Week Warrior',       desc: 'Maintain a 7-day streak on any habit' },
    { id: 'streak_hunter',     icon: '🔥', name: 'Streak Hunter',      desc: 'Reach a 30-day streak on any habit' },
    { id: 'iron_will',         icon: '⚔️', name: 'Iron Will',          desc: 'Reach a 100-day streak on any habit' },
    { id: 'centurion',         icon: '🛡️', name: 'Centurion',          desc: 'Earn 500 total points' },
    { id: 'the_grind',         icon: '⚡', name: 'The Grind',          desc: 'Earn 2,000 total points' },
    { id: 'legendary_hunter',  icon: '👑', name: 'Legendary Hunter',   desc: 'Complete a Legendary habit 30 days in a row' },
    { id: 'awakened',          icon: '💎', name: 'Awakened',           desc: 'Reach A Rank (7,000 pts)' },
    { id: 'shadow_monarch',    icon: '🌑', name: 'Shadow Monarch',     desc: 'Reach S Rank (14,000 pts)' },
    { id: 'the_one',           icon: '⭐', name: 'The One',            desc: 'Reach S+ Rank (28,000 pts)' },
    { id: 'fully_awakened',    icon: '👑', name: 'Fully Awakened',     desc: 'Max all 6 stats — Total Level 120 (+2,000 bonus XP)' },
  ];

  const STATS = [
    { id: 'STR',   icon: '⚔️',  label: 'STR',   name: 'Strength',     color: '#ef4444',
      habits: [
        'Strength training', 'Cardio', 'Sprint session', 'Daily walk', 'Protein goal',
      ] },
    { id: 'VIT',   icon: '❤️',  label: 'VIT',   name: 'Vitality',     color: '#ec4899',
      habits: [
        'Hydrate', 'Sleep', 'Sleep before midnight', 'Cardio', 'Daily walk',
        'Ice bath or cold plunge', 'Mobility & Stretching', 'Get morning sunlight',
        'Whole foods diet', 'No sugar/junk food', 'Barefoot grounding outside',
        'Vitamins and minerals', 'Sleep early before 11PM',
      ] },
    { id: 'INT',   icon: '🧠',  label: 'INT',   name: 'Intelligence', color: '#3b82f6',
      habits: [
        'Read', 'Journal', 'Educational podcast', 'Practice a skill',
        'Flashcard review', 'Write down lessons learned', 'Learn something new',
        'Language learning', 'Visualization practice',
        'Review your long term goals', 'Generate one new business or content idea',
      ] },
    { id: 'FOCUS', icon: '🎯',  label: 'FOCUS', name: 'Focus',        color: '#eab308',
      habits: [
        'Meditate & Breathwork', 'No phone or social media after waking',
        'Review daily goals/intentions', 'No social media before noon',
        'Complete your #1 priority task', 'Plan tomorrow the night before',
        'Under 1 hour screen time', 'Digital declutter',
        'No doomscrolling until after 5PM', 'Review your long term goals',
        'Review investments or trading journal', 'Visualization practice',
      ] },
    { id: 'WILL',  icon: '🔥',  label: 'WILL',  name: 'Willpower',    color: '#f97316',
      habits: [
        'Ice bath or cold plunge', 'Cold shower', 'Meditate & Breathwork',
        'No screens 1 hour before bed', 'No sugar/junk food', 'No alcohol', 'No caffeine',
        'Wake up at consistent time', 'Complete your #1 priority task', 'Tidy/clean space',
        'Morning gratitude practice', 'Pray or set intentions',
        'Call or text a family member', 'Do something kind for someone',
      ] },
    { id: 'WLT',   icon: '💰',  label: 'WLT',   name: 'Wealth',       color: '#f59e0b',
      habits: [
        'Track finances & net worth', 'Work on a side project or business',
        'Review investments or trading journal', 'Generate one new business or content idea',
      ] },
  ];

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

  const CLASSES = {
    STR:   { emoji: '⚔️',  name: 'Warrior',  color: '#ef4444', desc: 'You build your body like a fortress. Discipline is your weapon.' },
    VIT:   { emoji: '🏹',  name: 'Ranger',   color: '#ec4899', desc: 'Your body is your temple. Recovery and endurance are your edge.' },
    INT:   { emoji: '🧙',  name: 'Mage',     color: '#3b82f6', desc: 'Your mind is your greatest asset. Knowledge compounds like interest.' },
    FOCUS: { emoji: '🥷',  name: 'Assassin', color: '#eab308', desc: 'Precise, locked in, distraction-proof. You operate in silence.' },
    WILL:  { emoji: '🛡️', name: 'Paladin',  color: '#f97316', desc: "Unbreakable. You do what others won't on the days they can't." },
    WLT:   { emoji: '👑',  name: 'Merchant', color: '#f59e0b', desc: 'Every day is an investment. You play the long financial game.' },
    SAGE:  { emoji: '🌟',  name: 'Sage',     color: '#8b5cf6', desc: 'No single path defines you. You are building a complete human.' },
  };

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
      return { text: 'Weekend Challenge Starts 🏆', cls: 'na-badge-start' };
    }
    if (day === 'Sat') {
      return noAlcoholDoneOn(weekend.fri)
        ? { text: 'Day 2 of 3 🔥', cls: 'na-badge-progress' }
        : { text: 'Challenge Failed ❌', cls: 'na-badge-fail' };
    }
    if (day === 'Sun') {
      const friOk = noAlcoholDoneOn(weekend.fri);
      const satOk = noAlcoholDoneOn(weekend.sat);
      if (friOk && satOk) return { text: 'Final Day — Complete for 30 XP 💰', cls: 'na-badge-final' };
      return { text: 'Challenge Failed ❌', cls: 'na-badge-fail' };
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
      desc:  '+30 XP Bonus Awarded 🏆',
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
      return '<div class="ww-reward ww-reward--earned">🏆 +30 XP earned — Weekend Warrior unlocked</div>';
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
      titleEl.textContent = '⚔️ Weekend Warrior Challenge';
      bodyEl.innerHTML =
        '<p class="ww-rules">Complete <b>No alcohol</b> all three nights — Friday, Saturday, and Sunday — to earn <b>+30 bonus XP</b> on Sunday.</p>' +
        '<p class="ww-rules">Plus: every habit completed Fri-Sun earns <b>Double XP</b>.</p>' +
        '<button id="ww-add-btn" class="ww-add-btn">+ Add No Alcohol to my habits</button>';

      const addBtn = document.getElementById('ww-add-btn');
      if (addBtn) addBtn.addEventListener('click', addNoAlcoholFromWWBanner);
      return;
    }

    // ── State B: live Fri/Sat/Sun progress ─────────────────
    titleEl.textContent = '⚔️ Weekend Warrior Active';
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
    if (userHasNoAlcohol()) {
      el.classList.add('dxb--active');
      el.textContent = '⚡ Weekend Warrior active — +30 XP if you finish all 3 nights 🔥';
    } else {
      el.classList.remove('dxb--active');
      el.textContent = '⚡ DOUBLE XP WEEKEND 🔥';
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
      ? '✅ Day 1 complete. Come back Saturday to continue your Weekend Challenge.'
      : '⚔️ The Weekend Challenge has begun, Hunter. No alcohol Friday, Saturday, and Sunday earns you 30 bonus XP. Your discipline this weekend defines your rank. Will you claim the reward?';

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
    { emoji: '🏃', name: 'Cardio',                                    difficulty: 'medium'              },  // 3
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
    { label: '💪 Physical Performance',      start: 0,  end: 11 },
    { label: '🧠 Mental & Focus',            start: 11, end: 19 },
    { label: '🥗 Nutrition',                 start: 19, end: 23 },
    { label: '⚡ Discipline & Productivity', start: 23, end: 31 },
    { label: '💰 Financial & Growth',        start: 31, end: 35 },
    { label: '🎯 Learning & Skills',         start: 35, end: 41 },
    { label: '🌱 Wellbeing & Relationships', start: 41, end: 49 },
  ];

  // ── PRIMARY STAT MAP ─────────────────────────────────────
  // Single source of truth for each habit's primary stat (drives the
  // History view's cell colors). The History tab is the only place this
  // map is read for visuals — every habit's `primaryStat` field is
  // derived from this map at startup.
  const HABIT_PRIMARY_STAT = {
    // STR (red)
    'Strength training': 'STR', 'Sprint session': 'STR', 'Mobility & Stretching': 'STR',
    'Cardio': 'STR', 'Cold shower': 'STR', 'Ice bath or cold plunge': 'STR',
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

  // ── HABIT DESCRIPTIONS ───────────────────────────────────
  // One curated paragraph per habit, displayed on the View Note /
  // habit-detail sheet's "About this habit" section. Read-only —
  // single source of truth for the canonical description.
  const HABIT_DESCRIPTIONS = {
    // 💪 Physical Performance
    'Hydrate':                  'Water is the most underrated performance tool. Your brain, muscles, and recovery all depend on it.',
    'Sleep':                    'Recovery happens here. Skipping sleep is borrowing energy from tomorrow with high interest.',
    'Sleep before midnight':    'It all starts the night before. Quality sleep before midnight sets the foundation for everything.',
    'Cardio':                   'Build the engine. Cardiovascular fitness is the base layer everything else stacks on.',
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
    return st ? st.color : '#eab308'; // FOCUS yellow as ultimate fallback
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
      localStorage.setItem('hb_stats',           JSON.stringify(stats));
      localStorage.setItem('hb_stat_bonuses',    JSON.stringify([...statBonuses]));
      localStorage.setItem('hb_perfect_streak',  JSON.stringify(perfectStreak));
      localStorage.setItem('hb_ps_awarded',      JSON.stringify([...psAwarded]));
      localStorage.setItem('hb_notes',             JSON.stringify(habitNotes));
      localStorage.setItem('hb_compound',          JSON.stringify(compoundStreaks));
      localStorage.setItem('hb_compound_awarded',  JSON.stringify(compoundAwarded));
      localStorage.setItem('hb_prs',               JSON.stringify(personalRecords));
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
    applyStatPts(habit ? habit.name : null, pts, 1);
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
    applyStatPts(habit ? habit.name : null, pts, -1);
    save();
  }

  // ── ACHIEVEMENTS ──────────────────────────────────────────
  function checkAchievements() {
    const allStreaks = Object.values(streaks).map(s => s.count || 0);
    const maxStreak = allStreaks.length ? Math.max(...allStreaks) : 0;

    const legStreaks = habits
      .filter(h => h.difficulty === 'legendary')
      .map(h => (streaks[h.id] && streaks[h.id].count) || 0);
    const maxLegStreak = legStreaks.length ? Math.max(...legStreaks) : 0;

    const totalCompletions = Object.values(completions).reduce((n, arr) => n + arr.length, 0);
    const rank = getRank(totalPoints);

    const totalStatLevel = STATS.reduce((sum, st) => sum + statLevel(stats[st.id]?.pts || 0), 0);

    const conditions = {
      first_step:       totalCompletions >= 1,
      week_warrior:     maxStreak >= 7,
      streak_hunter:    maxStreak >= 30,
      iron_will:        maxStreak >= 100,
      centurion:        totalPoints >= 500,
      the_grind:        totalPoints >= 2000,
      legendary_hunter: maxLegStreak >= 30,
      awakened:         totalPoints >= 7000,
      shadow_monarch:   totalPoints >= 14000,
      the_one:          totalPoints >= 28000,
      fully_awakened:   totalStatLevel >= 120,
    };

    const newlyUnlocked = [];
    for (const [id, met] of Object.entries(conditions)) {
      if (met && !unlockedAchievements.has(id)) {
        unlockedAchievements.add(id);
        newlyUnlocked.push(ACHIEVEMENTS.find(a => a.id === id));
      }
    }

    if (newlyUnlocked.length) {
      // FULLY AWAKENED grants a one-time +2,000 rank XP bonus
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

  function applyStatPts(habitName, pts, direction) {
    if (!habitName) return;
    const MAX_STAT_XP = 6650; // total XP to reach Level 20 (hard cap) — sum of all 19 level thresholds
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
  function determineClass() {
    const levels = STATS.map(st => ({ id: st.id, lv: statLevel(stats[st.id]?.pts || 0) }));
    levels.sort((a, b) => b.lv - a.lv);
    const topLv    = levels[0].lv;
    const secondLv = levels[1].lv;
    if (topLv <= 1) return 'SAGE';
    if (secondLv === 0 || topLv / secondLv >= 1.4) return levels[0].id;
    return 'SAGE';
  }

  function isClassShifting() {
    const levels = STATS.map(st => ({ id: st.id, lv: statLevel(stats[st.id]?.pts || 0) }));
    levels.sort((a, b) => b.lv - a.lv);
    const topLv = levels[0].lv, secondLv = levels[1].lv;
    if (topLv <= 1 || secondLv === 0) return false;
    const ratio = topLv / secondLv;
    return ratio >= 1.2 && ratio < 1.4; // transition zone
  }

  function checkClassChange(silent) {
    const newKey = determineClass();
    if (newKey !== currentClass) {
      currentClass = newKey;
      localStorage.setItem('hb_class', currentClass);
      if (!silent) {
        levelUpQueue.push({ type: 'class', classData: CLASSES[newKey] });
        if (!levelUpActive) drainLevelUpQueue();
      }
      if (currentTab === 'profile') renderProfile();
      if (currentTab === 'stats')   renderStats();
    }
  }

  function showClassChangePopup(cls) {
    const popup = document.getElementById('class-popup');
    const card  = document.getElementById('class-popup-card');
    card.style.borderColor = cls.color + '60';
    card.style.boxShadow   = '0 0 48px ' + cls.color + '30';
    card.style.setProperty('--cp-color', cls.color);
    document.getElementById('class-popup-emoji').textContent = cls.emoji;
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
    popup.onclick = dismiss;
    timer = setTimeout(dismiss, 3500);
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
      document.querySelector('.statlvl-label-top').textContent = '★  STAT MASTERED  ★';
    } else {
      card.classList.remove('sl-maxed');
      card.style.boxShadow = '0 0 36px ' + stat.color + '40, 0 -6px 36px rgba(0,0,0,0.55)';
      document.querySelector('.statlvl-label-top').textContent = 'LEVEL UP';
    }

    document.getElementById('statlvl-icon').textContent   = stat.icon;
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
      bonusEl.textContent = isMax ? '👑  MAX BONUS +' + bonusPts + ' XP AWARDED' : '★  BONUS +' + bonusPts + ' XP AWARDED';
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
    popup.onclick = dismiss;
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
    if      (item.type === 'rank')       showRankUpScreen(item.rank);
    else if (item.type === 'class')      showClassChangePopup(item.classData);
    else if (item.type === 'perfectday') showPerfectDayScreen(item);
    else                                 showStatLevelUp(item);
  }

  function drainAchQueue() {
    if (!achQueue.length) { achPopupTimer = null; return; }
    const ach = achQueue.shift();
    showAchievementPopup(ach);
  }

  function showAchievementPopup(ach) {
    const popup = document.getElementById('ach-popup');
    document.querySelector('.ach-popup-label').textContent = ach.label || 'ACHIEVEMENT UNLOCKED';
    document.getElementById('ach-popup-icon').textContent = ach.icon;
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
        '<div class="hg-ach-icon">' + (unlocked ? ach.icon : '🔒') + '</div>' +
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
          (h.emoji ? '<span class="day-popup-habit-emoji">' + h.emoji + '</span>' : '') +
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
      checkClassChange();
      render();
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
    el.innerHTML = '<span class="ps-fire">🔥</span><span class="ps-count">' + displayCount + '</span>';
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

    emojiEl.textContent = ms.emoji;
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
    renderDailyQuote();
    checkStreakDanger();
    checkMorningRoutineNudge();
    if (currentTab === 'profile')      renderProfile();
    if (currentTab === 'stats')        renderStats();
    if (currentTab === 'history')      renderHistory();
  }

  function renderHabits() {
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

  function renderAchievements() {
    const grid = document.getElementById('achievements-grid');
    grid.innerHTML = '';
    ACHIEVEMENTS.forEach(ach => {
      const unlocked = unlockedAchievements.has(ach.id);
      const card = document.createElement('div');
      card.className = 'ach-card ' + (unlocked ? 'unlocked' : 'locked');
      card.innerHTML =
        '<div class="ach-icon-wrap">' + ach.icon + '</div>' +
        '<div class="ach-text">' +
          '<div class="ach-name">' + esc(ach.name) + '</div>' +
          '<div class="ach-desc">' + esc(ach.desc) + '</div>' +
        '</div>' +
        '<div class="ach-status">' + (unlocked ? '✓' : '🔒') + '</div>';
      grid.appendChild(card);
    });
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

      // Icon
      const icon = document.createElement('div');
      icon.className = 'osrs-cell-icon';
      icon.textContent = st.icon;

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
            '<span class="nb-icon">' + nx.st.icon + '</span>' +
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
    if (totalPoints === 0) return 'avatar-base.png';
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
            '</div>' +
            '<div class="sc-hero-rank' + (isSPlus ? ' sc-gold' : '') + '">' +
              rank.label + ' · ' + totalPoints.toLocaleString() + ' pts' +
            '</div>' +
            '<div class="sc-hero-class" style="color:' + cls.color + '">' +
              cls.emoji + ' ' + cls.name +
            '</div>' +
            '<div class="sc-hero-class-desc">' + esc(cls.desc) + '</div>' +
            (shifting ? '<div class="sc-shifting" style="margin-top:4px">⚠️ Your class is shifting...</div>' : '') +
            (selectedPackId && PACKS.find(p => p.id === selectedPackId) ? '<div class="sc-hero-path"><span class="sc-path-dot" style="background:' + PACKS.find(p => p.id === selectedPackId).color + '"></span>Path: ' + esc(PACKS.find(p => p.id === selectedPackId).name) + '</div>' : '') +
            buildCompoundBadgesHTML() +
          '</div>' +
        '</div>' +
        // Personal Records strip — horizontally scrollable tiles
        buildPRStripHTML() +
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
      svg += '<text x="' + lx.toFixed(2) + '" y="' + (ly - 8).toFixed(2) + '" '
           + 'class="sc-radar-lbl" fill="' + st.color + '" text-anchor="middle">'
           + st.label + '</text>';
      svg += '<text x="' + lx.toFixed(2) + '" y="' + (ly + 14).toFixed(2) + '" '
           + 'class="sc-radar-sublbl" fill="' + (lv >= MAX_LV ? '#f59e0b' : 'rgba(255,255,255,0.45)') + '" text-anchor="middle">'
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

    // Tapping an axis hit-zone opens the stat detail sheet
    wrap.querySelectorAll('.sc-radar-hit[data-statid]').forEach(el => {
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
    const naBadgeHTML   = naBadge
      ? '<div class="na-challenge-badge ' + naBadge.cls + '">' + naBadge.text + '</div>'
      : '';

    // XP badge — ⚡+N XP (gold), ⚡+N XP 2× on weekends
    const xpBadge = wknd
      ? '<span class="habit-xp weekend">⚡+' + xpVal + ' XP <span class="xp-2x">2×</span></span>'
      : '<span class="habit-xp">⚡+' + xpVal + ' XP</span>';

    const li = document.createElement('li');
    li.className = 'habit-item' + (done ? ' completed' : '');
    li.dataset.id = habit.id;
    // Set difficulty colour variable for left-border glow and checkbox ring
    li.style.setProperty('--diff-color', DIFF_COLORS[diff] || DIFF_COLORS.easy);

    li.innerHTML =
      // Top row: streak badge (left) + check circle (right)
      '<div class="hg-top">' +
        '<div class="streak-badge' + (count > 0 ? ' active' : '') + '">' +
          (count > 0 ? '<span class="streak-fire">🔥</span>' + count : '') +
        '</div>' +
        '<div class="habit-cb' + (done ? ' checked' : '') + '">' +
          '<span class="check-mark">✓</span>' +
        '</div>' +
      '</div>' +
      // Emoji centered
      '<div class="hg-emoji-wrap">' +
        (habit.emoji ? '<span class="habit-emoji">' + habit.emoji + '</span>' : '') +
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
    li.addEventListener('click', e => { if (!e.target.closest('[data-drag]') && !e.target.closest('[data-more]')) toggleHabit(habit.id, li); });
    li.querySelector('[data-more]').addEventListener('click', e => { e.stopPropagation(); showCtxMenu(habit.id, li); });
    return li;
  }

  // Returns true if a measurable habit's goal meets the minimum threshold.
  function meetsMinimum(habit) {
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
  function showHabitToast(msg) {
    document.querySelectorAll('.habit-toast').forEach(t => t.remove());
    const toast = document.createElement('div');
    toast.className = 'habit-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('habit-toast--visible')));
    setTimeout(() => {
      toast.classList.remove('habit-toast--visible');
      setTimeout(() => toast.remove(), 300);
    }, 2200);
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
    const fullBtn = document.getElementById('hi-full-details-btn');
    if (fullBtn) {
      fullBtn.addEventListener('click', () => {
        const id = _hiHabitId;
        closeHabitInfoSheet();
        // Brief delay so the close transition finishes cleanly before opening
        setTimeout(() => { if (id) openNoteModal(id); }, 320);
      });
    }

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
    xpEl.textContent = '+' + todayXP + ' XP earned today ⚡';

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

  function toggleHabit(id, li) {
    const wasDone = isChecked(id);
    const oldRank       = wasDone ? null : getRank(totalPoints);
    const oldStatLevels = wasDone ? null : captureStatLevels();

    if (wasDone) {
      uncheck(id);
      li.classList.remove('completed');
      li.querySelector('.habit-cb').classList.remove('checked');
    } else {
      // Minimum enforcement for measurable habits
      const habit = habits.find(h => h.id === id);
      if (habit && !meetsMinimum(habit)) {
        showHabitToast('Set your goal value to check off this habit');
        return;
      }
      // Snapshot compound state so we can detect if THIS tap fires the bonus.
      // If it does, the fanfare in showCompoundPopup() replaces the regular chime.
      const compoundBefore = JSON.stringify(compoundAwarded);
      check(id);
      const compoundFiredNow = JSON.stringify(compoundAwarded) !== compoundBefore;

      li.classList.add('completed');
      const cb = li.querySelector('.habit-cb');
      cb.classList.add('checked');
      const r = document.createElement('span');
      r.className = 'cb-ripple';
      cb.appendChild(r);
      r.addEventListener('animationend', () => r.remove(), { once: true });

      // Feature 1: sound + particles + card flash
      // Suppress regular chime if compound fanfare is taking over this moment.
      if (!compoundFiredNow) playCheckSound();
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
      xpFloat.textContent = '⚡+' + xpAmt + ' XP' + (isWeekend() ? ' 2×' : '');
      li.appendChild(xpFloat);
      xpFloat.addEventListener('animationend', () => xpFloat.remove(), { once: true });

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

      // Class change: check on any stat level-up
      if (STATS.some(st => statLevel(stats[st.id]?.pts || 0) > (oldStatLevels[st.id] || 0))) {
        const newClassKey = determineClass();
        if (newClassKey !== currentClass) {
          currentClass = newClassKey;
          localStorage.setItem('hb_class', currentClass);
          levelUpQueue.push({ type: 'class', classData: CLASSES[newClassKey] });
        }
      }

      if (levelUpQueue.length && !levelUpActive) drainLevelUpQueue();
      else if (!levelUpActive && achQueue.length && !achPopupTimer) drainAchQueue();
    }

    const count = getStreak(id);
    const badge = li.querySelector('.streak-badge');
    badge.className = 'streak-badge' + (count > 0 ? ' active' : '');
    badge.innerHTML = count > 0 ? '<span class="streak-fire">🔥</span>' + count : '—';
    if (!wasDone && count > 0) {
      void badge.offsetWidth;
      badge.classList.add('pop');
      badge.addEventListener('animationend', () => badge.classList.remove('pop'), { once: true });
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

    // Morning Routine + Locked-In quick-action buttons share one confirmation modal
    document.getElementById('add-morning-btn').addEventListener('click',  openMorningPackModal);
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
    if (iconEl)     iconEl.textContent     = pack.emoji;
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
        '<span class="mr-row-emoji">' + def.emoji + '</span>' +
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
      '<span class="lib-pack-emoji">🌅</span>' +
      '<span class="lib-pack-text">' +
        '<span class="lib-pack-title">Morning Routine ' +
          '<span class="lib-pack-bolt" data-bonus-info aria-label="About the Compound Effect Bonus" role="button" tabindex="0">⚡</span>' +
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
      '<span class="lib-pack-emoji">🔒</span>' +
      '<span class="lib-pack-text">' +
        '<span class="lib-pack-title">Locked-In ' +
          '<span class="lib-pack-bolt" aria-label="Locked-In Bonus">⚡</span>' +
        '</span>' +
        '<span class="lib-pack-sub">Master the full discipline cycle.</span>' +
      '</span>' +
      '<span class="lib-pack-count">' +
        (liMissing === 0 ? 'All added' : '16 habits') +
      '</span>' +
      '<span class="lib-pack-chevron">›</span>';
    liEntry.addEventListener('click', openLockedInPackModal);
    list.appendChild(mrEntry);
    list.appendChild(liEntry);

    if (!catData.length) {
      // Pack entry above is shown; the rest of the categories area is empty.
      const empty = document.createElement('p');
      empty.className = 'lib-empty';
      empty.textContent = 'All individual habits are already in your list.';
      list.appendChild(empty);
      return;
    }

    // ── Accordion state ──────────────────────────────────────
    let libOpenIdx = 0; // open first available category by default

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
          '<span class="ob-card-emoji">' + h.emoji + '</span>' +
          '<span class="ob-card-name">' + esc(h.name) + '</span>' +
          '<span class="diff-badge ' + h.difficulty + '">' + DIFFICULTY[h.difficulty].label + '</span>' +
          '<span class="lib-card-add">›</span>';

        card.addEventListener('click', () => openHabitDetail(h, {
          context: 'library',
          onConfirm: cfg => {
            const newH = { id: uid(), emoji: h.emoji, name: h.name, difficulty: cfg.difficulty, type: cfg.type || h.type || 'build' };
            if (cfg.days)      newH.days      = cfg.days;
            if (cfg.goal)      newH.goal      = cfg.goal;
            if (cfg.startDate) newH.startDate = cfg.startDate;
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

    // Open first category after paint
    requestAnimationFrame(() => libSetOpen(0));
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
          '<span class="hd-header-emoji">' + h.emoji + '</span>' +
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

      // ── Section 3: Goal Value (measurable habits only) ─────
      if (measurable) {
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
      xpNote.textContent = '⚡ +' + DIFFICULTY[hdDiff].pts + ' XP per completion';
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
          goal:       measurable ? { value: hdGoal, unit: measurable.unit } : undefined,
          startDate:  hdStart !== today ? hdStart : undefined,
        };
        if (opts.onConfirm) {
          opts.onConfirm(cfg);
        } else {
          // Default (library) behaviour
          const newH = { id: uid(), emoji: h.emoji, name: h.name, difficulty: hdDiff, type: hdType };
          if (days)              newH.days      = days;
          if (measurable)        newH.goal      = { value: hdGoal, unit: measurable.unit };
          if (hdStart !== today) newH.startDate = hdStart;
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
    document.getElementById('sched-overlay').classList.remove('hidden');
    document.getElementById('sched-sheet').classList.remove('hidden');
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
    if (labelEl) labelEl.textContent = pack.bonusLabel || '⚡ COMPOUND EFFECT BONUS';
    document.getElementById('cp-pack-msg').textContent =
      isLockedIn
        ? 'All 16 habits complete. You owned the day.'
        : 'All ' + pack.name + ' habits complete!';
    document.getElementById('cp-xp').textContent     = '+' + xp + ' XP' + (doubled ? ' 2×' : '');
    document.getElementById('cp-streak').textContent = 'Day ' + streak + ' in a row 🔥';
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
  }

  // ── BONUS INFO POPUP ─────────────────────────────────────
  // Tapping the ⚡ on any pack progress row opens this popup. It explains
  // the Compound Effect XP tier formula AND the ROI rationale for both
  // Morning Routine and Locked-In packs.
  function openBonusInfoPopup() {
    const ov = document.getElementById('bonus-info-overlay');
    const md = document.getElementById('bonus-info-modal');
    if (!ov || !md) return;
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
      // If clicking a tile inside the All-PRs sheet, close that sheet first
      // so the detail sheet replaces it cleanly.
      if (allSheet && !allSheet.classList.contains('hidden')) {
        closePRAllSheet();
        setTimeout(() => openPRDetailSheet(prId), 220);
      } else {
        openPRDetailSheet(prId);
      }
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
      if (sheet    && !sheet.classList.contains('hidden'))    closePRDetailSheet();
      if (allSheet && !allSheet.classList.contains('hidden')) closePRAllSheet();
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

  function renderCompoundProgress() {
    const wrap = document.getElementById('compound-progress');
    if (!wrap) return;
    // Show a row for every bonus pack the user has at least one habit in.
    // Locked-In is a superset of Morning Routine, so when a user is on the
    // Locked-In path both rows appear; pure MR users see only the MR row.
    const rows = BONUS_PACK_IDS.map(packId => {
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
      return '<div class="cp-prog-row' + cls + '">' +
        '<span class="cp-prog-name">' + esc(pack.emoji + ' ' + pack.name) + '</span>' +
        '<span class="cp-prog-count' + (awarded ? ' cp-prog-done' : '') + '">' +
          (awarded ? '✓ Complete' : done + '/' + canonicalTotal) +
        '</span>' +
        // Tappable bolt → opens the Bonus Info popup explaining the formula + ROI
        '<button class="cp-prog-bolt" data-bonus-info aria-label="About the Compound Effect Bonus">⚡</button>' +
        (streak > 0 ? '<span class="cp-prog-streak">Day ' + streak + ' 🔥</span>' : '') +
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
    const habitsLifetime = (personalRecords['total_habits_lifetime'] || {}).value || 0;
    const activeDays     = (personalRecords['total_active_days']     || {}).value || 0;
    const summary = habitsLifetime.toLocaleString() + ' habits · ' + activeDays.toLocaleString() + ' active days';
    return '<button id="pr-open-btn" class="pr-open-btn" aria-label="View Personal Records">' +
      '<span class="pr-open-icon">🏆</span>' +
      '<span class="pr-open-text">' +
        '<span class="pr-open-title">PERSONAL RECORDS</span>' +
        '<span class="pr-open-sub">' + esc(summary) + '</span>' +
      '</span>' +
      '<span class="pr-open-chev">›</span>' +
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
        '<span class="pr-tile-icon">' + def.icon + '</span>' +
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
      const icon = packId === 'locked-in' ? '🔒' : '⚡';
      return '<div class="sc-compound-badge">' + icon + ' ' + esc(pack.name) + ': Day ' + s + '</div>';
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
        '<span class="hi-badge-icon">' + stat.icon + '</span>' +
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
    document.getElementById('note-modal-emoji').textContent = habit.emoji || '';
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

  function refreshEditGoalDisplay() {
    const habit = habits.find(h => h.id === editingId);
    if (!habit) return;
    const m = MEASURABLE_HABITS[habit.name];
    if (!m) return;
    document.getElementById('edit-goal-val').textContent = editGoalValue.toLocaleString() + ' ' + m.unit;
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

    // Show / hide goal stepper for measurable habits
    const m        = MEASURABLE_HABITS[habit.name];
    const goalRow  = document.getElementById('edit-goal-row');
    if (m) {
      editGoalValue = habit.goal ? habit.goal.value : m.def;
      document.getElementById('edit-goal-label').textContent = habit.name + ' goal';
      refreshEditGoalDisplay();
      goalRow.classList.remove('hidden');
    } else {
      goalRow.classList.add('hidden');
    }

    document.getElementById('edit-modal').classList.remove('hidden');
    document.getElementById('modal-overlay').classList.remove('hidden');
    setTimeout(() => { const i = document.getElementById('edit-input'); i.focus(); i.select(); }, 80);
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
      // Persist goal if this is a measurable habit
      const m = MEASURABLE_HABITS[habit.name];
      if (m) habit.goal = { value: editGoalValue, unit: m.unit };
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
  }

  // ── DELETE ───────────────────────────────────────────────
  function deleteHabit(id) {
    habits = habits.filter(h => h.id !== id);
    for (const d in completions) completions[d] = completions[d].filter(x => x !== id);
    delete streaks[id];
    save();
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

  // ── DRAG & DROP (touch + mouse) ──────────────────────────
  let drag = null;

  function bindDrag() {
    document.getElementById('habit-list').querySelectorAll('[data-drag]').forEach(handle => {
      handle.addEventListener('touchstart', onDragStart, { passive: false });
      handle.addEventListener('mousedown',  onDragStart);
    });
  }

  function clientPos(e) {
    if (e.touches)        return { x: e.touches[0].clientX,        y: e.touches[0].clientY };
    if (e.changedTouches) return { x: e.changedTouches[0].clientX,  y: e.changedTouches[0].clientY };
    return { x: e.clientX, y: e.clientY };
  }

  function onDragStart(e) {
    const isTouch = e.type === 'touchstart';
    if (!isTouch && e.button !== 0) return;
    if (isTouch) e.preventDefault();
    const item = e.currentTarget.closest('[data-id]');
    if (!item) return;
    const { x, y } = clientPos(e);
    const rect = item.getBoundingClientRect();
    const ghost = item.cloneNode(true);
    ghost.className = 'habit-item drag-ghost';
    ghost.style.width = rect.width + 'px';
    ghost.style.left  = rect.left  + 'px';
    ghost.style.top   = rect.top   + 'px';
    document.body.appendChild(ghost);
    item.classList.add('drag-placeholder');
    document.body.style.userSelect = 'none';
    document.body.style.webkitUserSelect = 'none';
    document.body.style.cursor = 'grabbing';
    drag = { id: item.dataset.id, item, ghost, offsetY: y - rect.top, isTouch };
    navigator.vibrate && navigator.vibrate(12);
    if (isTouch) {
      document.addEventListener('touchmove', onDragMove, { passive: false });
      document.addEventListener('touchend',   onDragEnd, { once: true });
      document.addEventListener('touchcancel',onDragEnd, { once: true });
    } else {
      document.addEventListener('mousemove', onDragMove);
      document.addEventListener('mouseup',   onDragEnd, { once: true });
    }
  }

  function onDragMove(e) {
    if (!drag) return;
    if (e.type === 'touchmove') e.preventDefault();
    const { y } = clientPos(e);
    drag.ghost.style.top = (y - drag.offsetY) + 'px';
    const items = getOtherItems();
    items.forEach(el => el.classList.remove('drop-target-above', 'drop-target-below'));
    const target = findDropTarget(items, y);
    if (target) target.el.classList.add(target.before ? 'drop-target-above' : 'drop-target-below');
  }

  function onDragEnd(e) {
    if (!drag) return;
    if (drag.isTouch) document.removeEventListener('touchmove', onDragMove);
    else              document.removeEventListener('mousemove', onDragMove);
    document.body.style.userSelect = '';
    document.body.style.webkitUserSelect = '';
    document.body.style.cursor = '';
    const items = getOtherItems();
    items.forEach(el => el.classList.remove('drop-target-above', 'drop-target-below'));
    const { y } = clientPos(e);
    const target = findDropTarget(items, y);
    if (target && target.el.dataset.id !== drag.id) {
      const fromIdx = habits.findIndex(h => h.id === drag.id);
      const [moved] = habits.splice(fromIdx, 1);
      const toIdx = habits.findIndex(h => h.id === target.el.dataset.id);
      habits.splice(target.before ? toIdx : toIdx + 1, 0, moved);
      save();
    }
    drag.ghost.remove();
    drag.item.classList.remove('drag-placeholder');
    drag = null;
    renderHabits();
    document.getElementById('habit-list').classList.remove('reorder-mode');
  }

  function getOtherItems() {
    return [...document.getElementById('habit-list').querySelectorAll('[data-id]')]
      .filter(el => !el.classList.contains('drag-placeholder'));
  }

  function findDropTarget(items, clientY) {
    for (const el of items) {
      const r = el.getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return { el, before: true };
    }
    return items.length ? { el: items[items.length - 1], before: false } : null;
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

    // Set CSS colour variables
    sheet.style.setProperty('--sd-color', st.color);
    sheet.style.setProperty('--sd-glow',  glow);

    // Header
    document.getElementById('stat-detail-badge').style.background  = st.color + '18';
    document.getElementById('stat-detail-badge').style.borderColor = st.color;
    document.getElementById('stat-detail-icon').textContent  = st.icon;
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

    // Linked habits
    const listEl = document.getElementById('stat-detail-habits');
    listEl.innerHTML = st.habits.map(name => {
      const meta = _habitMeta[name] || { emoji: '', difficulty: 'medium' };
      return '<div class="sdh-row">' +
        '<span class="sdh-emoji">' + (meta.emoji || '') + '</span>' +
        '<span class="sdh-name">'  + esc(name) + '</span>' +
        '<span class="diff-badge ' + meta.difficulty + '">' + DIFFICULTY[meta.difficulty].label + '</span>' +
      '</div>';
    }).join('');

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

  function setupStatDetail() {
    document.getElementById('stat-detail-close').addEventListener('click',   closeStatDetail);
    document.getElementById('stat-detail-overlay').addEventListener('click', closeStatDetail);

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

  // ── THEME ─────────────────────────────────────────────────
  function applyTheme(theme, animate) {
    if (animate) {
      document.body.classList.add('theme-transitioning');
      setTimeout(() => document.body.classList.remove('theme-transitioning'), 380);
    }
    document.body.classList.toggle('theme-light', theme === 'light');
    localStorage.setItem('hb_theme', theme);
    // Update active state on both cards
    document.querySelectorAll('.settings-theme-card').forEach(btn => {
      btn.classList.toggle('settings-theme-card--active', btn.dataset.theme === theme);
    });
  }

  // ── CHECK FOR UPDATES ────────────────────────────────────
  function checkForUpdates() {
    const btn   = document.getElementById('update-check-btn');
    const label = document.getElementById('update-check-label');
    if (!btn || !label) return;

    // Loading state
    btn.disabled = true;
    btn.classList.add('update-btn--checking');
    label.textContent = 'Checking...';

    // No SW support → treat as up to date
    if (!('serviceWorker' in navigator)) {
      setTimeout(resolveUpToDate, 900);
      return;
    }

    navigator.serviceWorker.getRegistration().then(reg => {
      if (!reg) { setTimeout(resolveUpToDate, 900); return; }

      // Already a waiting worker → activate it now
      if (reg.waiting) {
        resolveUpdateFound(reg.waiting);
        return;
      }

      let updateDetected = false;

      // Listen for a new SW installing during this check
      reg.addEventListener('updatefound', () => {
        const incoming = reg.installing;
        if (!incoming) return;
        updateDetected = true;
        incoming.addEventListener('statechange', () => {
          if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
            resolveUpdateFound(incoming);
          }
        });
      }, { once: true });

      // Force the browser to re-fetch sw.js and compare
      reg.update().then(() => {
        // Allow a short window for statechange to propagate
        setTimeout(() => {
          if (!updateDetected) resolveUpToDate();
        }, 600);
      }).catch(() => resolveUpToDate());

    }).catch(() => resolveUpToDate());

    function resolveUpdateFound(worker) {
      btn.classList.remove('update-btn--checking');
      btn.classList.add('update-btn--found');
      label.textContent = 'Update found! Reloading...';
      // Give user 1.5 s to read the message, then swap in the new SW
      // (controllerchange handler in registerSW() will call location.reload())
      setTimeout(() => worker.postMessage({ type: 'SKIP_WAITING' }), 1500);
    }

    function resolveUpToDate() {
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
    // Apply saved theme + sound state on open
    document.getElementById('settings-btn').addEventListener('click', () => {
      const saved = localStorage.getItem('hb_theme') || 'dark';
      document.querySelectorAll('.settings-theme-card').forEach(btn => {
        btn.classList.toggle('settings-theme-card--active', btn.dataset.theme === saved);
      });
      document.getElementById('sound-toggle').setAttribute('aria-checked', soundEnabled ? 'true' : 'false');
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
    // Theme toggle
    document.getElementById('theme-dark-btn').addEventListener('click', () => applyTheme('dark', true));
    document.getElementById('theme-light-btn').addEventListener('click', () => applyTheme('light', true));
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
      '<div class="path-card-emoji">🌅</div>'                                   +
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
      '<div class="path-card-emoji">🔒</div>'                                   +
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
      '<div class="path-card-emoji">⚡</div>'                      +
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
          '<span class="ob-card-emoji">' + h.emoji + '</span>' +
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
      // If user configured a goal, use it; otherwise set a sensible default for measurable habits
      if (cfg.goal) {
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
        'Daily walk':                         'Movement is medicine. A 20-30 minute walk clears the mind and activates the body.',
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
    document.getElementById('onboarding').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    render();
  }

  // ── SERVICE WORKER ────────────────────────────────────────
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('sw.js').then(reg => {

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

  // ── INIT ─────────────────────────────────────────────────
  function init() {
    // Apply saved theme immediately so there's no flash
    const savedTheme = localStorage.getItem('hb_theme') || 'dark';
    document.body.classList.toggle('theme-light', savedTheme === 'light');

    load();
    today = getPTDate();
    histViewYear  = parseInt(today.slice(0, 4), 10);
    histViewMonth = parseInt(today.slice(5, 7), 10) - 1;
    if (currentClass === null) {
      // First run — set class silently, no popup
      currentClass = determineClass();
      localStorage.setItem('hb_class', currentClass);
    }
    setupTabs();
    setupLibrary();
    setupSchedulePicker();
    setupCtxMenu();
    setupEditModal();
    setupNoteModal();
    setupCompoundPopup();
    setupBonusInfoPopup();
    setupPRDetailSheet();
    migratePRsIfNeeded();
    setupEmojiPicker();
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

    document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDayChange(); });
    setInterval(() => { checkDayChange(); checkStreakDanger(); checkMorningRoutineNudge(); }, 60_000);
    registerSW();

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
