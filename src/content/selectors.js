// Every piece of knowledge about Gladiatus' HTML lives in this file, so when
// Gameforge changes the game only this file should need updating.
(function (root) {
  'use strict';
  const GBot = (root.GBot = root.GBot || {});

  const SEL = {
    // Present on every in-game page; used to tell game pages from the lobby.
    gameHeader: '#header_game',

    hpBar: '#header_values_hp_bar', // data-value, data-max-value, data-regen-per-hour
    hpPercent: '#header_values_hp_percent',
    level: '#header_values_level',
    gold: '#sstat_gold_val',

    points: {
      expedition: {
        value: '#expeditionpoints_value_point',
        max: '#expeditionpoints_value_pointmax',
        box: '#expeditionpoints_value',
      },
      dungeon: {
        value: '#dungeonpoints_value_point',
        max: '#dungeonpoints_value_pointmax',
        box: '#dungeonpoints_value',
      },
    },

    // Cooldown bars in the header. `ct` is the circus turma bar.
    cooldowns: {
      expedition: { bar: '#cooldown_bar_expedition', fill: '#cooldown_bar_fill_expedition', text: '#cooldown_bar_text_expedition' },
      dungeon: { bar: '#cooldown_bar_dungeon', fill: '#cooldown_bar_fill_dungeon', text: '#cooldown_bar_text_dungeon' },
      arena: { bar: '#cooldown_bar_arena', fill: '#cooldown_bar_fill_arena', text: '#cooldown_bar_text_arena' },
      circus: { bar: '#cooldown_bar_ct', fill: '#cooldown_bar_fill_ct', text: '#cooldown_bar_text_ct' },
    },
    cooldownLink: 'a.cooldown_bar_link',
    cooldownReadyClass: 'cooldown_bar_fill_ready',

    // Expedition locations submenu (last entry = highest unlocked location).
    locationMenuLinks: '#submenu2 a[href*="mod=location"]',

    dialogs: {
      loginBonus: '#blackoutDialogLoginBonus',
      loginBonusButton: '#blackoutDialogLoginBonus input, #blackoutDialogLoginBonus button',
      notification: '#blackoutDialognotification',
      notificationButton: '#blackoutDialognotification input, #blackoutDialognotification button',
      // Confirmation popups that can appear after clicking an arena attack.
      confirm: '#blackoutDialogbod, #blackoutDialog',
      confirmButton: 'input[type="button"], input[type="submit"], button',
    },

    expedition: {
      attackButtons: '.expedition_button',
      disabledClass: 'disabled',
    },

    dungeon: {
      // Enemies on the dungeon map (image-map areas / images with startFight()).
      enemies: ['#content [onclick*="startFight"]', '#content area[onclick]', '#content img[onclick]'],
      startNormal: '#content input[name="dif1"]',
      startAdvanced: '#content input[name="dif2"]',
      startFallback: '#content .button1',
    },

    arena: {
      tables: { arena: '#own2', circus: '#own3' },
      attack: '.attack',
      nameCellIndex: 0,
      levelCellIndex: 1,
      error: '#errorRow',
      errorText: '#errorText',
    },

    inventory: {
      grid: '#inv',
      loadingClass: 'unavailable',
      bagTabs: '#inventory_nav .awesome-tabs',
      currentBagTab: '#inventory_nav .awesome-tabs.current',
      food: '#inv div[data-content-type="64"]',
      avatar: '#avatar',
    },

    work: {
      job: (index) => `#job_row_${index}`,
      hours: '#workTime',
      submit: '#doWork',
      ticker: '#ticker1',
    },

    quests: {
      finish: '#content .contentboard_slot a.quest_slot_button_finish',
      openSlots: '#content .contentboard_slot_inactive',
      acceptInSlot: '.quest_slot_button_accept',
      icon: '.quest_slot_icon',
      cooldown: '#quest_header_cooldown [data-ticker-time-left]',
    },

    // Fragments of the quest icon image URLs, per quest type.
    questIcons: {
      combat: '8aada67d4c5601e009b9d2a88f478c',
      arena: '00f1a594723515a77dcd6d66c918fb',
      circus: '586768e942030301c484347698bc5e',
      expedition: '4e41ab43222200aa024ee177efef8f',
      dungeon: 'dc366909fdfe69897d583583f6e446',
      items: '5a358e0a030d8551a5a65d284c8730',
    },
  };

  // Game URLs, relative to /game/index.php. `sh` is the session hash every
  // in-game link carries.
  const PAGES = {
    overview: () => ({ mod: 'overview' }),
    location: (loc) => ({ mod: 'location', loc }),
    dungeon: (loc) => ({ mod: 'dungeon', loc }),
    arena: () => ({ mod: 'arena', submod: 'serverArena', aType: 2 }),
    circus: () => ({ mod: 'arena', submod: 'serverArena', aType: 3 }),
    work: () => ({ mod: 'work' }),
    quests: () => ({ mod: 'quests' }),
  };

  function buildUrl(baseHref, sh, params) {
    const url = new URL('index.php', baseHref);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    if (sh) url.searchParams.set('sh', sh);
    return url.href;
  }

  GBot.selectors = { SEL, PAGES, buildUrl };

  if (typeof module !== 'undefined' && module.exports) module.exports = GBot.selectors;
})(typeof globalThis !== 'undefined' ? globalThis : this);
