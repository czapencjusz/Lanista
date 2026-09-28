// Settings shared by the content scripts, the popup and the options page.
// Loaded as a classic script (content scripts cannot use ES modules), so
// everything hangs off the global GBot namespace. Also require()-able from
// Node for unit tests.
(function (root) {
  'use strict';
  const GBot = (root.GBot = root.GBot || {});

  const SETTINGS_VERSION = 2;

  // Activities whose order the user can change ("priority").
  const ORDERABLE = ['quests', 'expedition', 'dungeon', 'arena', 'circus'];

  // Training ground order (skillToTrain = index + 1).
  const TRAINING_STATS = ['strength', 'dexterity', 'agility', 'constitution', 'charisma', 'intelligence'];

  const QUEST_TYPES = ['combat', 'arena', 'circus', 'expedition', 'dungeon', 'items', 'work'];

  const opponentDefaults = () => ({
    enabled: false,
    target: 'lowest', // 'lowest' | 'highest' | 'random'
    // Only attack opponents within [myLevel - maxBelow, myLevel + maxAbove].
    limitLevels: false,
    maxAbove: 5,
    maxBelow: 20,
    // Player names never to attack (one per line or comma separated).
    ignorePlayers: '',
    // Skip an opponent for this many hours after losing to them (0 = off).
    avoidLostHours: 24,
  });

  const DEFAULT_SETTINGS = {
    version: SETTINGS_VERSION,
    enabled: false,

    general: {
      // Order in which ready activities are done when several are ready.
      order: ORDERABLE.slice(),
      // After some wins the game offers to search the enemy's nest:
      // 'off' (leave the dialog alone) | 'return' | 'quick' | 'thorough'.
      nestSearch: 'quick',
    },

    expedition: {
      enabled: true,
      // 'auto' = the location the game's expedition cooldown bar points at
      // (your last visited expedition), otherwise a numeric location id.
      location: 'auto',
      enemy: 1, // 1..4 (4 is the location boss)
      // With the boss selected: first fight the other enemies until their
      // bonuses are learned (the boss then gets them automatically).
      bonusesFirst: false,
      // Stop attacking when this many points are left (saved for later).
      keepPoints: 0,
    },

    dungeon: {
      enabled: true,
      location: 'auto',
      difficulty: 'normal', // 'normal' | 'advanced'
      keepPoints: 0,
    },

    arena: opponentDefaults(),
    circus: opponentDefaults(),

    heal: {
      // Eat food from the inventory when HP drops below eatBelowPercent.
      enabled: true,
      eatBelowPercent: 30,
      // Expeditions, dungeons and the arena are skipped below this HP.
      minHpPercent: 20,
    },

    work: {
      enabled: false,
      // Index of the job in the stable list (0 = first job).
      job: 0,
      hours: 1,
    },

    training: {
      // Spend gold on character stats at the training ground.
      enabled: false,
      // Never let gold drop below this.
      keepGold: 100000,
      // Stats that may be trained; the cheapest of them goes first, which
      // keeps them balanced because every point makes a stat dearer.
      stats: {
        strength: true,
        dexterity: true,
        agility: true,
        constitution: true,
        charisma: false,
        intelligence: false,
      },
    },

    repair: {
      // Repair worn gear at the workbench.
      enabled: false,
      // Repair an item once its conditioning drops below this.
      belowPercent: 50,
      // The "Repair all" button skips items above this conditioning (a
      // nearly new item costs the same rent as a worn one).
      allUpToPercent: 60,
      // Best material quality to use: -1 Standard, 0 Ceres (green),
      // 1 Neptun (blue), 2 Mars, 3 Jupiter, 4 Olymp. Lower ones go first.
      maxQuality: 1,
    },

    smelting: {
      // Smelt the items ticked on the packages page.
      enabled: true,
      // Where the resources go: 'horreum' | 'packages'.
      storeIn: 'horreum',
    },

    quests: {
      enabled: false,
      types: {
        combat: true,
        arena: true,
        circus: true,
        expedition: true,
        dungeon: true,
        items: false,
        work: false,
      },
      // Skip expedition quests for a location other than the one the bot
      // fights at ("The green forest: ..." while farming Death Hill).
      matchLocation: true,
      // Skip quests for activities the bot is not doing (arena quests while
      // the arena is off, ...).
      onlyActive: true,
    },

    schedule: {
      // Only play between start and end (local time; may wrap midnight).
      activeHours: false,
      start: '08:00',
      end: '23:00',
      // Take a random break of ~breakLength minutes every ~breakEvery minutes.
      breaks: false,
      breakEvery: 120,
      breakLength: 15,
    },

    timing: {
      // Random human-like pause before every click (seconds).
      minClickDelay: 1.2,
      maxClickDelay: 3.5,
      // Longest the bot sleeps before re-checking the game state (seconds).
      maxIdle: 300,
    },

    safety: {
      // Consecutive failed attempts at one activity before it is paused.
      maxAttempts: 3,
      // Minutes an activity is paused after maxAttempts failures.
      backoffMinutes: 10,
    },

    notifications: {
      loggedOut: true,
      activityPaused: true,
      noFood: true,
    },

    ui: {
      // Show the control bar on game pages.
      panel: true,
      layout: 'floating', // 'floating' | 'bar'
    },
  };

  const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
  const LOCATION = /^(auto|\d{1,4})$/;

  // Validation rules per setting path. Used by sanitizeSettings() and by the
  // settings UI for input limits.
  const CONSTRAINTS = {
    'general.nestSearch': { enum: ['off', 'return', 'quick', 'thorough'] },
    'expedition.location': { pattern: LOCATION },
    'expedition.enemy': { int: true, min: 1, max: 4 },
    'expedition.keepPoints': { int: true, min: 0, max: 500 },
    'dungeon.location': { pattern: LOCATION },
    'dungeon.difficulty': { enum: ['normal', 'advanced'] },
    'dungeon.keepPoints': { int: true, min: 0, max: 500 },
    'heal.eatBelowPercent': { int: true, min: 0, max: 100 },
    'heal.minHpPercent': { int: true, min: 0, max: 100 },
    'work.job': { int: true, min: 0, max: 19 },
    'work.hours': { int: true, min: 1, max: 24 },
    'training.keepGold': { int: true, min: 0, max: 2000000000 },
    'repair.belowPercent': { int: true, min: 1, max: 99 },
    'repair.allUpToPercent': { int: true, min: 1, max: 99 },
    'smelting.storeIn': { enum: ['horreum', 'packages'] },
    'repair.maxQuality': { int: true, min: -1, max: 4 },
    'schedule.start': { pattern: TIME },
    'schedule.end': { pattern: TIME },
    'schedule.breakEvery': { int: true, min: 10, max: 1440 },
    'schedule.breakLength': { int: true, min: 1, max: 600 },
    'timing.minClickDelay': { min: 0, max: 60 },
    'timing.maxClickDelay': { min: 0, max: 60 },
    'timing.maxIdle': { int: true, min: 30, max: 3600 },
    'safety.maxAttempts': { int: true, min: 1, max: 20 },
    'safety.backoffMinutes': { int: true, min: 1, max: 1440 },
    'ui.layout': { enum: ['floating', 'bar'] },
  };
  for (const type of ['arena', 'circus']) {
    CONSTRAINTS[`${type}.target`] = { enum: ['lowest', 'highest', 'random'] };
    CONSTRAINTS[`${type}.maxAbove`] = { int: true, min: 0, max: 500 };
    CONSTRAINTS[`${type}.maxBelow`] = { int: true, min: 0, max: 500 };
    CONSTRAINTS[`${type}.ignorePlayers`] = { maxLength: 4000 };
    CONSTRAINTS[`${type}.avoidLostHours`] = { int: true, min: 0, max: 720 };
  }

  const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const clone = (v) => JSON.parse(JSON.stringify(v));

  function getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }

  function setPath(obj, path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    const target = keys.reduce((o, k) => (isPlainObject(o[k]) ? o[k] : (o[k] = {})), obj);
    target[last] = value;
    return obj;
  }

  // Deep-merge `override` onto a copy of `base`. Only keys that exist in
  // `base` are kept, and values must match the type of the default, so stale
  // or malformed stored settings can never break the bot.
  function mergeSettings(base, override) {
    const out = Array.isArray(base) ? base.slice() : { ...base };
    if (!isPlainObject(override)) return out;
    for (const key of Object.keys(base)) {
      if (!(key in override)) continue;
      const b = base[key];
      const o = override[key];
      if (isPlainObject(b)) out[key] = mergeSettings(b, o);
      else if (Array.isArray(b)) out[key] = Array.isArray(o) ? o.slice() : b.slice();
      else if (typeof b === typeof o && !(typeof o === 'number' && Number.isNaN(o))) out[key] = o;
      else if (typeof b === 'string' && typeof o === 'number') out[key] = String(o);
      else if (typeof b === 'number' && typeof o === 'string' && o.trim() !== '' && !Number.isNaN(Number(o))) out[key] = Number(o);
    }
    return out;
  }

  // Upgrades settings stored by older versions of the extension.
  function migrateSettings(raw) {
    if (!isPlainObject(raw)) return raw;
    const out = clone(raw);
    if (!out.version || out.version < 2) {
      // v1 had one HP threshold used both for eating and for fighting, and a
      // separate "useFood" switch.
      if (isPlainObject(out.heal)) {
        if (typeof out.heal.minHpPercent === 'number') out.heal.eatBelowPercent = out.heal.minHpPercent;
        if (out.heal.useFood === false) out.heal.enabled = false;
        delete out.heal.useFood;
      }
      out.version = 2;
    }
    return out;
  }

  // Clamps numbers, rejects invalid enum/pattern values and repairs the
  // priority list. Always returns a complete, valid settings object.
  function sanitizeSettings(settings) {
    const out = mergeSettings(DEFAULT_SETTINGS, settings);
    out.version = SETTINGS_VERSION;
    for (const [path, rule] of Object.entries(CONSTRAINTS)) {
      let value = getPath(out, path);
      const fallback = getPath(DEFAULT_SETTINGS, path);
      if (rule.enum && !rule.enum.includes(value)) value = fallback;
      if (rule.pattern) {
        value = String(value).trim().toLowerCase();
        if (!rule.pattern.test(value)) value = fallback;
      }
      if (typeof fallback === 'number') {
        if (typeof value !== 'number' || !Number.isFinite(value)) value = fallback;
        if (rule.int) value = Math.round(value);
        if (rule.min !== undefined) value = Math.max(rule.min, value);
        if (rule.max !== undefined) value = Math.min(rule.max, value);
      }
      if (rule.maxLength && typeof value === 'string') value = value.slice(0, rule.maxLength);
      setPath(out, path, value);
    }
    const order = (out.general.order || []).filter((a, i, list) => ORDERABLE.includes(a) && list.indexOf(a) === i);
    out.general.order = order.concat(ORDERABLE.filter((a) => !order.includes(a)));
    if (out.timing.maxClickDelay < out.timing.minClickDelay) out.timing.maxClickDelay = out.timing.minClickDelay;
    return out;
  }

  const normalize = (raw) => sanitizeSettings(migrateSettings(raw) || {});

  const STORAGE_KEY = 'settings';

  function storageArea() {
    const api = root.browser || root.chrome;
    return api && api.storage && api.storage.local;
  }

  async function loadSettings() {
    const area = storageArea();
    if (!area) return normalize({});
    const data = await area.get(STORAGE_KEY);
    return normalize(data[STORAGE_KEY]);
  }

  async function saveSettings(settings) {
    const clean = sanitizeSettings(settings);
    await storageArea().set({ [STORAGE_KEY]: clean });
    return clean;
  }

  GBot.settings = {
    SETTINGS_VERSION,
    DEFAULT_SETTINGS,
    CONSTRAINTS,
    ORDERABLE,
    QUEST_TYPES,
    TRAINING_STATS,
    STORAGE_KEY,
    getPath,
    setPath,
    mergeSettings,
    migrateSettings,
    sanitizeSettings,
    normalize,
    loadSettings,
    saveSettings,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = GBot.settings;
})(typeof globalThis !== 'undefined' ? globalThis : this);
