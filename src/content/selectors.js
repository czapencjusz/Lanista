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
      // "Search <enemy>'s nest" after a win: Return to Safety, Quick Search,
      // Thorough Search (in that order).
      nest: '#blackoutDialog.loot-modal',
      nestButtons: '#blackoutDialog.loot-modal .loot-button',
      // Confirmation popups that can appear after clicking an arena attack.
      confirm: '#blackoutDialogbod, #blackoutDialog',
      confirmButton: 'input[type="button"], input[type="submit"], button',
    },

    expedition: {
      attackButtons: '.expedition_button',
      disabledClass: 'disabled',
      // One box per enemy (same order as the attack buttons), each with an
      // info tooltip and four bonuses (gold, experience, items, honour).
      box: '.expedition_box',
      info: '[id^="expedition_info"]',
      bonus: '.expedition_bonus',
      bonusActiveClass: 'active',
    },

    dungeon: {
      // Enemies on the dungeon map (image-map areas / images with startFight()).
      enemies: ['#content [onclick*="startFight"]', '#content area[onclick]', '#content img[onclick]'],
      startNormal: '#content input[name="dif1"]',
      startAdvanced: '#content input[name="dif2"]',
      // Only used when the named buttons are missing. A running dungeon also
      // has a ".button1" (Cancel dungeon), so the fallback needs two buttons.
      startFallback: '#content form input.button1',
      disabledClass: 'disabled',
      // First heading of a running dungeon: "Viking Camp open until ...".
      title: '#content h3',
    },

    // Combat report shown after every fight.
    report: {
      header: '#reportHeader',
      winClass: 'reportWin',
      rewardLines: '.report_reward p',
      goldIcon: 'img[src*="res2."]',
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

    // Packages page: one .packageItem per package; resources (forging
    // goods) are item class 18, i.e. data-basis "18-<type>".
    packages: {
      item: '.packageItem [data-content-type]',
      resource: '.packageItem [data-basis^="18-"]',
      // The "Send resources to the Horreum" button goes at the top of this.
      container: '#content',
    },

    // Horreum (forge storage): the game's own "Store resources" form. Its
    // overflow choice is two radios, sell first and delete second.
    horreum: {
      fromPackages: '#from-packages',
      fromInventory: '#from-inventory',
      excess: 'input[name="sell-excess"]',
      store: '#store',
      stock: '#resource-list',
      dialog: '#blackoutDialog, #blackoutDialogbod',
    },

    // Training ground: one button and one cost per stat, in stat order.
    training: {
      buttons: '#training_box .training_button',
      costs: '#training_box .training_costs',
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
      title: '.quest_slot_title',
      reward: '.quest_slot_reward',
      cooldown: '#quest_header_cooldown [data-ticker-time-left]',
      // "Accepted quests: 2 / 5"
      accepted: '#quest_header_accepted',
    },

    // Fragments of the quest icon image URLs, per quest type. Current servers
    // name the files (icon_combat_inactive.jpg, ...); older ones used hashes.
    questIcons: {
      combat: ['icon_combat', '8aada67d4c5601e009b9d2a88f478c'],
      arena: ['icon_arena', '00f1a594723515a77dcd6d66c918fb'],
      circus: ['icon_grouparena', '586768e942030301c484347698bc5e'],
      expedition: ['icon_expedition', '4e41ab43222200aa024ee177efef8f'],
      dungeon: ['icon_dungeon', 'dc366909fdfe69897d583583f6e446'],
      items: ['icon_items', '5a358e0a030d8551a5a65d284c8730'],
      work: ['icon_work'],
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
    training: () => ({ mod: 'training' }),
    horreum: () => ({ mod: 'forge', submod: 'storage' }),
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
