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
      // 'normal' | 'advanced' (Normal where Advanced is not unlocked yet).
      difficulty: 'normal',
      keepPoints: 0,
      // Never fight the boss: once only the boss is left, cancel the dungeon
      // and start a new one.
      skipBoss: false,
      // Cancel and restart the dungeon after this many lost fights in a row
      // (0 = never).
      restartAfterLosses: 0,
    },

    arena: opponentDefaults(),
    circus: opponentDefaults(),

    underworld: {
      // Fight the Underworld's enemies (with its own expedition points)
      // while the character is there.
      enabled: false,
      // Food cannot be eaten there and falling to 0 HP offers only to leave
      // (re-entry takes days), so fights wait for HP to regenerate to this.
      minHpPercent: 60,
      // Enter automatically when allowed: 'off' | 'normal' | 'medium' |
      // 'hard'. Costs 8,000 gold; the travel is never shortened with rubies.
      enter: 'off',
    },

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
      // Also queue package items by quality and kind, without ticking them.
      auto: false,
      // Best quality smelted automatically: -1 Standard, 0 Ceres (green),
      // 1 Neptun (blue), 2 Mars, 3 Jupiter, 4 Olymp.
      autoUpTo: 0,
      autoTypes: { weapons: true, armour: true, jewellery: false },
    },

    packages: {
      // Tidy the packages while the bot runs.
      enabled: false,
      // Take the gold out of gold packages.
      collectGold: true,
      // Move resources into the Horreum.
      storeResources: false,
      // Sell gear to a merchant, up to this quality (as smelting.autoUpTo).
      sell: false,
      sellUpTo: -1,
      sellTypes: { weapons: true, armour: true, jewellery: true },
      // Packages about to expire: 'off' | 'bag' (move into the bags) | 'sell'.
      expiring: 'bag',
      expiringHours: 24,
    },

    auction: {
      // Bid on healing items in the auction house.
      enabled: false,
      // Only lots that heal at least this many HP per gold of the bid.
      minHpPerGold: 4,
      // 'short' (short or very short) | 'medium' (medium or shorter) |
      // 'any': how late in the round to bid. A losing bid keeps the gold.
      bidWhen: 'short',
      // Most gold to bid in one auction round.
      maxPerRound: 10000,
      // Never let gold drop below this.
      keepGold: 100000,
      // Stop bidding while the bags and packages hold this many healing items.
      maxFood: 50,
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
    'dungeon.restartAfterLosses': { int: true, min: 0, max: 20 },
    'underworld.minHpPercent': { int: true, min: 10, max: 100 },
    'underworld.enter': { enum: ['off', 'normal', 'medium', 'hard'] },
    'heal.eatBelowPercent': { int: true, min: 0, max: 100 },
    'heal.minHpPercent': { int: true, min: 0, max: 100 },
    'work.job': { int: true, min: 0, max: 19 },
    'work.hours': { int: true, min: 1, max: 24 },
    'training.keepGold': { int: true, min: 0, max: 2000000000 },
    'repair.belowPercent': { int: true, min: 1, max: 99 },
    'repair.allUpToPercent': { int: true, min: 1, max: 99 },
    'smelting.storeIn': { enum: ['horreum', 'packages'] },
    'smelting.autoUpTo': { int: true, min: -1, max: 4 },
    'packages.sellUpTo': { int: true, min: -1, max: 4 },
    'packages.expiring': { enum: ['off', 'bag', 'sell'] },
    'packages.expiringHours': { int: true, min: 1, max: 168 },
    'auction.minHpPerGold': { min: 0.1, max: 1000 },
    'auction.bidWhen': { enum: ['short', 'medium', 'any'] },
    'auction.maxPerRound': { int: true, min: 0, max: 2000000000 },
    'auction.keepGold': { int: true, min: 0, max: 2000000000 },
    'auction.maxFood': { int: true, min: 1, max: 500 },
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

  // Every game server keeps its own settings under "settings:<host>". The
  // plain "settings" key holds the settings saved last (with the bot stopped):
  // a server the bot has not seen yet starts from those.
  const STORAGE_KEY = 'settings';
  const SERVER_PREFIX = 'settings:';
  const SPLIT_FLAG = 'settingsPerServer';
  const settingsKey = (host) => (host ? SERVER_PREFIX + host : STORAGE_KEY);

  function storageArea() {
    const api = root.browser || root.chrome;
    return api && api.storage && api.storage.local;
  }

  // Picks a server's settings out of a storage snapshot.
  const pickSettings = (data, host) => normalize(data[settingsKey(host)] !== undefined ? data[settingsKey(host)] : data[STORAGE_KEY]);

  async function loadSettings(host) {
    const area = storageArea();
    if (!area) return normalize({});
    return pickSettings(await area.get([settingsKey(host), STORAGE_KEY]), host);
  }

  async function saveSettings(settings, host) {
    const clean = sanitizeSettings(settings);
    const template = { ...clean, enabled: false };
    await storageArea().set(host ? { [settingsKey(host)]: clean, [STORAGE_KEY]: template } : { [STORAGE_KEY]: template });
    return host ? clean : template;
  }

  // Older versions shared one settings object between all servers: give every
  // server the bot has played on its own copy, once.
  async function splitSettings() {
    const area = storageArea();
    const all = await area.get(null);
    if (all[SPLIT_FLAG]) return false;
    const writes = { [SPLIT_FLAG]: true };
    const shared = all[STORAGE_KEY];
    if (shared !== undefined) {
      for (const host of serversIn(all)) {
        if (all[settingsKey(host)] === undefined) writes[settingsKey(host)] = shared;
      }
      writes[STORAGE_KEY] = { ...shared, enabled: false };
    }
    await area.set(writes);
    return true;
  }

  // Hosts with stored memory or settings, most recently played first.
  function serversIn(all) {
    const hosts = new Set();
    for (const key of Object.keys(all)) {
      if (key.startsWith('memory:')) hosts.add(key.slice(7));
      else if (key.startsWith(SERVER_PREFIX)) hosts.add(key.slice(SERVER_PREFIX.length));
    }
    const playedAt = (host) => {
      const m = all[`memory:${host}`];
      return (m && m.gameInfo && m.gameInfo.updatedAt) || 0;
    };
    return Array.from(hosts).sort((a, b) => playedAt(b) - playedAt(a));
  }

  async function listServers() {
    const area = storageArea();
    return area ? serversIn(await area.get(null)) : [];
  }

  // "s303-en.gladiatus.gameforge.com" -> "Server 303 (EN)".
  const serverName = (host) => {
    const m = String(host).match(/^s(\d+)-(\w+)\./);
    return m ? `Server ${m[1]} (${m[2].toUpperCase()})` : host;
  };

  GBot.settings = {
    SETTINGS_VERSION,
    DEFAULT_SETTINGS,
    CONSTRAINTS,
    ORDERABLE,
    QUEST_TYPES,
    TRAINING_STATS,
    STORAGE_KEY,
    SERVER_PREFIX,
    settingsKey,
    pickSettings,
    splitSettings,
    serversIn,
    listServers,
    serverName,
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
