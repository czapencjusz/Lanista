// Every piece of knowledge about Gladiatus' HTML lives in this file, so when
// Gameforge changes the game only this file should need updating.
(function (root) {
  'use strict';
  const GBot = (root.GBot = root.GBot || {});

  const SEL = {
    // Present on every in-game page; used to tell game pages from the lobby.
    gameHeader: '#header_game',

    // On the way to the Underworld: the main menu shows "Journey time" with
    // a countdown (ms), cooldown bars show "-" and nothing can be done. The
    // travel page's "Reduce journey time" (rubies) and "Turn back" buttons
    // must never be clicked.
    travel: '#mainmenu a[href*="submod=travel"] [data-ticker-time-left]',

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
      // Only used when the named buttons are missing, and never matching the
      // two other ".button1" buttons: "Cancel dungeon" and, during the
      // cooldown, "Enter Dungeon" (name="skip"), which costs a ruby.
      startFallback: '#content form:not([action*="cancelDungeon"]) input.button1:not([name="skip"])',
      // Ruby button to skip the cooldown: its presence means "not ready yet".
      skipCooldown: '#content input[name="skip"]',
      // "Cancel dungeon" form (hidden dungeonId + submit).
      cancel: '#content form[action*="cancelDungeon"] input[type="submit"]',
      // Map labels over some positions: "1/3" for a group of enemies, and
      // a word ("Boss") over the boss once it can be attacked.
      label: '.map_label',
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

    // Auction house: one form per lot. Add-ons (e.g. Gladiatus Crazy Addon)
    // put their own price hints next to these; only the game's are read.
    auction: {
      time: '.description_span_right b', // "Remaining time of auction: Long"
      lotId: 'input[name="auctionid"]',
      item: '.auction_item_div [data-content-type]',
      bidAmount: 'input[name="bid_amount"]',
      bidButton: 'input[name="bid"]',
    },

    // Inside the Underworld the location menu has "Pray" and "Leave the
    // Underworld" (index.php?mod=underworld...). Leaving starts a re-entry
    // cooldown of days: nothing under mod=underworld is clicked or loaded.
    underworld: {
      marker: 'a[href*="?mod=underworld"]',
      // Enemies of an Underworld area (the game's own spelling).
      enemies: '#underwold_enemies',
      // The enemy whose turn it is (1-based), from the page's script. The
      // Attack buttons cannot tell: the page enables every one that points
      // (or rubies) would pay for, locked enemies too, and the game sends a
      // locked one's attack straight back to the area page.
      nextEnemy: /var\s+initialEnemy\s*=\s*(\d+)/,
      // What an attack costs: expedition points, or rubies once they are gone.
      pointsCost: '.icon_expeditionpoints',
      // Close ("Cancel") button of the game's notification dialog.
      closeDialog: '#linkcancelnotification',
      // Entry buttons on the Hermit's page (mod=hermit&submod=underworld).
      enter: {
        normal: '#content input[name="difficulty_normal"]',
        medium: '#content input[name="difficulty_medium"]',
        hard: '#content input[name="difficulty_hard"]',
      },
    },

    // Premium inventory (mod=premium&submod=inventory): items already owned,
    // each with a count and an "Activate" button that loads
    // ...submod=inventoryActivate&feature=<id>. Using one never costs
    // rubies; the ruby shop is a different page and is never opened.
    premium: {
      box: '.premiumfeature_content',
      count: '.premiumfeature_tokencount',
      activate: '.premium_activate_button',
      feature: /[?&]feature=(\d+)/,
      mobilisation: 5, // +3 expedition points (Underworld points inside)
      healingPotion: 18, // 100% Healing Potion
    },

    // Packages page (the Crazy Addon renames the section around #packages,
    // so only #packages itself is relied on). Each package holds one item
    // in a [data-container-number] element and an expiry countdown in ms.
    packages: {
      list: '#packages',
      package: '#packages .packageItem',
      expiry: '[data-ticker-time-left]',
      pages: '.pagination a[href*="page="]',
    },
    // Packages filter "Type of object" value for gold.
    goldFilter: 14,

    // Merchant shop grid (mod=inventory&sub=1..6); selling is a move into it.
    shop: '#shop[data-container-number]',

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
    underworldEntry: () => ({ mod: 'hermit', submod: 'underworld' }),
    premiumInventory: () => ({ mod: 'premium', submod: 'inventory' }),
    arena: () => ({ mod: 'arena', submod: 'serverArena', aType: 2 }),
    circus: () => ({ mod: 'arena', submod: 'serverArena', aType: 3 }),
    work: () => ({ mod: 'work' }),
    training: () => ({ mod: 'training' }),
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
