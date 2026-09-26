// Settings shared by the content scripts and the popup.
// Loaded as a classic script (content scripts cannot use ES modules), so
// everything hangs off the global GBot namespace. Also require()-able from
// Node for unit tests.
(function (root) {
  'use strict';
  const GBot = (root.GBot = root.GBot || {});

  const DEFAULT_SETTINGS = {
    enabled: false,

    expedition: {
      enabled: true,
      // 'auto' = the location the game's expedition cooldown bar points at
      // (your last visited expedition), otherwise a numeric location id.
      location: 'auto',
      enemy: 1, // 1..4 (4 is the location boss)
    },

    dungeon: {
      enabled: true,
      location: 'auto',
      difficulty: 'normal', // 'normal' | 'advanced'
    },

    arena: {
      enabled: false,
      target: 'lowest', // 'lowest' | 'highest' | 'random'
    },

    circus: {
      enabled: false,
      target: 'lowest',
    },

    heal: {
      enabled: true,
      // Expeditions, dungeons and arena are skipped below this HP percentage.
      minHpPercent: 25,
      // Eat food from the inventory when HP drops below minHpPercent.
      useFood: true,
    },

    work: {
      enabled: false,
      // Index of the job in the stable list (0 = first job).
      job: 0,
      hours: 1,
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
      },
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
  };

  const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

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
      else if (typeof b === typeof o && !(typeof o === 'number' && Number.isNaN(o))) out[key] = o;
      else if (typeof b === 'string' && typeof o === 'number') out[key] = String(o);
    }
    return out;
  }

  const STORAGE_KEY = 'settings';

  function storageArea() {
    const api = root.chrome || root.browser;
    return api && api.storage && api.storage.local;
  }

  async function loadSettings() {
    const area = storageArea();
    if (!area) return mergeSettings(DEFAULT_SETTINGS, {});
    const data = await area.get(STORAGE_KEY);
    return mergeSettings(DEFAULT_SETTINGS, data[STORAGE_KEY]);
  }

  async function saveSettings(settings) {
    const clean = mergeSettings(DEFAULT_SETTINGS, settings);
    await storageArea().set({ [STORAGE_KEY]: clean });
    return clean;
  }

  GBot.settings = {
    DEFAULT_SETTINGS,
    STORAGE_KEY,
    mergeSettings,
    loadSettings,
    saveSettings,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = GBot.settings;
})(typeof globalThis !== 'undefined' ? globalThis : this);
