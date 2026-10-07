// Declarative description of the settings window: one entry per tab, one
// field per setting. The renderer (settings-ui.js) turns this into forms, and
// number limits come from GBot.settings.CONSTRAINTS so validation and UI agree.
//
// Tabs: id, title, icon, description, group (sidebar heading, from LAYOUT
// below), enable (path of the tab's main switch, shown in its header),
// toggle (an on/off path for the sidebar dot and the Overview without a
// header switch), summary(settings, info) (one line for the Overview),
// custom (a pane drawn by settings-ui.js) or fields.
//
// Field types: toggle, number, select, location, text, textarea, time, order,
// checks, push. Optional field keys: help, unit, step, base (display offset, e.g. 1
// to show a 0-based index as 1-based), wide (a text field across the pane),
// dependsOn (path of a toggle that must
// be on for the field to be editable, or a list of paths of which one must
// be on), placeholder.
(function (root) {
  'use strict';
  const GBot = (root.GBot = root.GBot || {});
  const ui = (GBot.ui = GBot.ui || {});

  const TARGETS = [
    { value: 'lowest', label: 'Weakest first' },
    { value: 'highest', label: 'Strongest first' },
    { value: 'random', label: 'Random' },
  ];

  // Item and material qualities, as the game's "Minimum quality" filter.
  const QUALITIES = ['Standard (white)', 'Ceres (green)', 'Neptun (blue)', 'Mars (purple)', 'Jupiter (orange)', 'Olymp (red)'];
  const qualityOptions = (lowest) => QUALITIES.map((q, i) => ({ value: i - 1, label: i === 0 ? lowest : `Up to ${q}` }));

  const GOD_NAMES = [
    ['minerva', 'Minerva'],
    ['diana', 'Diana'],
    ['mars', 'Mars'],
    ['merkur', 'Mercury'],
    ['apollo', 'Apollo'],
    ['vulcanus', 'Vulcan'],
  ];
  const godChecks = (key) => GOD_NAMES.map(([id, label]) => ({ path: `gods.${key}.${id}`, label }));

  const BOOST_NAMES = [
    ['strength', 'Strength'],
    ['dexterity', 'Dexterity'],
    ['agility', 'Agility'],
    ['constitution', 'Constitution'],
    ['charisma', 'Charisma'],
    ['intelligence', 'Intelligence'],
    ['health', 'Health (max HP)'],
  ];

  // Costumes that can be worn outside the Underworld, as the game names
  // them (festival ones only during the festival).
  const COSTUMES = [
    'Vulcanus Forge',
    "Feronia's Earthen Shield",
    "Neptune's Fluid Might",
    "Aeolus' Aerial Freedom",
    "Pluto's Deadly Mist",
    "Juno's Breath of Life",
    "Wrath Mountain's Scale Armour",
    'Eagle Eyes',
    "Saturn's Winter Garment",
    "Bubona's Bull Armour",
    "Mercurius' Robber's Garments",
    "Ra's Light Robe",
    'Defender of the Empire',
  ];

  const GEAR_KINDS = [
    ['weapons', 'Weapons'],
    ['armour', 'Armour'],
    ['jewellery', 'Rings and amulets'],
  ];
  const KINDS_HELP = 'Armour means helmets, shields, chest armour, gloves and shoes.';

  const opponentFields = (type) => [
    {
      path: `${type}.where`,
      type: 'select',
      label: 'Where',
      options: [
        { value: 'provinciarum', label: type === 'arena' ? 'Arena Provinciarum (other servers)' : 'Circus Provinciarum (other servers)' },
        { value: 'local', label: type === 'arena' ? 'Local arena (this server)' : 'Local Circus Turma (this server)' },
      ],
      help:
        (type === 'arena'
          ? 'Locally you fight the players ranked just above you on your own server, for a share of their gold, and they can hit back. '
          : 'Locally you fight the teams ranked just above you on your own server. It needs your participation status set to Active on the Circus Turma page (which lets others attack you too); Lanista never changes it. ') +
        'No levels are shown there, so the level range is ignored and the weakest is the one ranked just above you. Players on your buddy list are never attacked.',
    },
    { path: `${type}.target`, type: 'select', label: 'Opponent choice', options: TARGETS },
    {
      path: `${type}.limitLevels`,
      type: 'toggle',
      label: 'Only attack opponents near my level',
    },
    { path: `${type}.maxAbove`, type: 'number', label: 'At most … levels above me', dependsOn: `${type}.limitLevels` },
    { path: `${type}.maxBelow`, type: 'number', label: 'At most … levels below me', dependsOn: `${type}.limitLevels` },
    {
      path: `${type}.ignorePlayers`,
      type: 'textarea',
      label: 'Never attack',
      placeholder: 'One player name per line',
      help: 'Guild mates, friends, or players who always beat you.',
    },
    {
      path: `${type}.avoidLostHours`,
      type: 'number',
      label: 'Skip opponents who beat me for',
      unit: 'h',
      help: 'After a lost fight that player is skipped for this long. 0 turns it off.',
    },
    {
      path: `${type}.preferBeaten`,
      type: 'toggle',
      label: 'Prefer opponents I have beaten',
      help: 'Opponents beaten in the last two weeks are tried first, most wins first, before the choice above.',
    },
    {
      path: `${type}.perPlayerPerDay`,
      type: 'number',
      label: 'At most … attacks on one player a day',
      help: 'Then that player is left alone until tomorrow. 0 = no limit.',
    },
    {
      path: `${type}.perDay`,
      type: 'number',
      label: 'At most … attacks a day',
      help: 'Then this waits for tomorrow (midnight, your time). 0 = no limit.',
    },
  ];

  const ALL_TABS = [
    {
      id: 'overview',
      title: 'Overview',
      icon: 'overview',
      custom: 'overview',
      description: 'Everything at a glance: switch features on and off here, or click a name for its settings.',
    },
    {
      id: 'general',
      title: 'General',
      icon: 'general',
      description: 'Master switch, and which activity goes first when several are ready at once.',
      fields: [
        { path: 'enabled', type: 'toggle', label: 'Lanista is running' },
        {
          path: 'general.order',
          type: 'order',
          label: 'Priority',
          help: 'Top of the list goes first. Healing always comes before fights, and stable work only starts when you are out of points.',
        },
        {
          path: 'general.nestSearch',
          type: 'select',
          label: 'Enemy nest search',
          options: [
            { value: 'quick', label: 'Quick search' },
            { value: 'thorough', label: 'Thorough search' },
            { value: 'return', label: 'Return to safety' },
            { value: 'off', label: 'Leave it to me' },
          ],
          help: 'After some wins the game offers to search the enemy nest for extra loot.',
        },
        {
          path: 'general.rejoin',
          type: 'toggle',
          label: 'Log back in through the lobby when the game logs you out',
          help: "Lanista opens the Gladiatus lobby in the game tab and presses Play for this server's account; it never types a password, so you must still be logged in to the lobby. Play opens a new window, so allow pop-ups for lobby.gladiatus.gameforge.com in your browser. At most 3 tries in 6 hours, never after you press Logout yourself, and only while Lanista is running. Gameforge can see that the login was automatic.",
        },
      ],
    },
    {
      id: 'expedition',
      title: 'Expedition',
      icon: 'expedition',
      enable: 'expedition.enabled',
      description: 'Fight monsters at an expedition location every time the cooldown ends.',
      fields: [
        { path: 'expedition.location', type: 'location', label: 'Location' },
        {
          path: 'expedition.enemy',
          type: 'select',
          label: 'Enemy',
          options: [
            { value: 1, label: '1st enemy' },
            { value: 2, label: '2nd enemy' },
            { value: 3, label: '3rd enemy' },
            { value: 4, label: '4th enemy (boss)' },
          ],
        },
        {
          path: 'expedition.bonusesFirst',
          type: 'toggle',
          label: 'Before the boss, learn the other enemies\' bonuses',
          help: 'Only with the boss selected. Fights enemies 1-3 in turn until all their bonuses are learned (each win has a chance to learn one; the chance, shown in the bonus tooltip, depends on your character and the enemy). The boss then gets those bonuses automatically and the bot fights the boss. Bonuses are never bought with rubies.',
        },
        { path: 'expedition.keepPoints', type: 'number', label: 'Keep points in reserve', help: 'Stop when this many expedition points are left.' },
        {
          path: 'expedition.easierAfterLosses',
          type: 'number',
          label: 'Fight an easier enemy after',
          unit: 'lost fights in a row',
          help: 'A loss still costs a point and HP. After that many in a row against one enemy, the next easier one is fought for an hour, then the chosen one gets another try. 0 turns it off.',
        },
        {
          path: 'expedition.mobilisationsPerDay',
          type: 'number',
          label: 'Mobilisations to use per day',
          help: 'From your premium inventory, one at a time once the points run out (+3 points each). Only ones you own; nothing is bought. 0 = never.',
        },
      ],
    },
    {
      id: 'dungeon',
      title: 'Dungeon',
      icon: 'dungeon',
      enable: 'dungeon.enabled',
      description: 'Start a dungeon when none is running and fight its enemies one after another. The ruby button that skips the cooldown is never used.',
      fields: [
        { path: 'dungeon.location', type: 'location', label: 'Location' },
        {
          path: 'dungeon.difficulty',
          type: 'select',
          label: 'Difficulty',
          options: [
            { value: 'normal', label: 'Normal' },
            { value: 'advanced', label: 'Advanced' },
          ],
          help: 'Where Advanced is not unlocked yet, Normal is started instead.',
        },
        { path: 'dungeon.keepPoints', type: 'number', label: 'Keep points in reserve', help: 'Stop when this many dungeon points are left.' },
        {
          path: 'dungeon.skipBoss',
          type: 'toggle',
          label: 'Never fight the boss',
          help: 'The other enemies go first; once only the boss is left, the dungeon is cancelled and a new one started. Its tasks and the boss loot are given up.',
        },
        {
          path: 'dungeon.restartAfterLosses',
          type: 'number',
          label: 'Start a new dungeon after',
          unit: 'lost fights in a row',
          help: 'Cancels a dungeon that is too hard and starts a fresh one. 0 turns it off.',
        },
        {
          path: 'dungeon.gateKeysPerDay',
          type: 'number',
          label: 'Gate Keys to use per day',
          help: 'From your premium inventory, one at a time once the dungeon points run out (+3 points each). Only ones you own; nothing is bought. 0 = never.',
        },
      ],
    },
    {
      id: 'underworld',
      title: 'Underworld',
      icon: 'underworld',
      enable: 'underworld.enabled',
      description: 'From level 100, the Hermit sends you to the Underworld: four areas of three enemies and a boss each, with their own 18 expedition points. The bot fights the newest area and enemy, never spends rubies (without points an attack would cost them), never shortens or turns back the journey, and never leaves: leaving, or falling to 0 HP, locks the Underworld for days.',
      fields: [
        {
          path: 'underworld.minHpPercent',
          type: 'number',
          label: 'Only fight above',
          unit: '% HP',
          help: 'Food cannot be eaten in the Underworld, so the bot waits for HP to regenerate. Dungeons are not available there.',
        },
        {
          path: 'underworld.enter',
          type: 'select',
          label: 'Enter automatically',
          options: [
            { value: 'off', label: 'No, I enter myself' },
            { value: 'normal', label: 'Yes, on Normal' },
            { value: 'medium', label: 'Yes, on Middle' },
            { value: 'hard', label: 'Yes, on Hard' },
          ],
          help: 'Whenever the Underworld can be entered again. Costs 8,000 gold and about 30 minutes of travel (less on speed servers). On Hard, dying costs a skill point. Not while you still hold Dīs Pater\'s Armor from that level: beating him again would not give another, so you get a notification instead.',
        },
        {
          path: 'underworld.mobilisations',
          type: 'number',
          label: 'Mobilisations to use per visit',
          help: 'From your premium inventory, one at a time when the Underworld points run out (+3 points each). Only ones you own; nothing is bought. 0 = never.',
        },
        {
          path: 'underworld.potions',
          type: 'number',
          label: '100% Healing Potions to use per visit',
          help: 'From your premium inventory, when HP drops below the value below. 0 = never.',
        },
        { path: 'underworld.potionBelowPercent', type: 'number', label: 'Use a healing potion below', unit: '% HP' },
      ],
    },
    {
      id: 'arena',
      title: 'Arena',
      icon: 'arena',
      enable: 'arena.enabled',
      description: "Fight other players: in the Arena Provinciarum (other servers) or your own server's arena.",
      fields: opponentFields('arena'),
    },
    {
      id: 'circus',
      title: 'Circus Turma',
      icon: 'circus',
      enable: 'circus.enabled',
      description: "Team fights, in the Circus Provinciarum or your own server's Circus Turma. Your own HP is not used.",
      fields: opponentFields('circus'),
    },
    {
      id: 'heal',
      title: 'Health',
      icon: 'heal',
      toggle: 'heal.enabled',
      description: 'Eat food from your bags when HP gets low, and stop fighting before it gets dangerous.',
      fields: [
        { path: 'heal.enabled', type: 'toggle', label: 'Eat food when HP is low' },
        { path: 'heal.eatBelowPercent', type: 'number', label: 'Eat when HP is below', unit: '%', dependsOn: 'heal.enabled' },
        {
          path: 'heal.minHpPercent',
          type: 'number',
          label: 'Stop fighting below',
          unit: '%',
          help: 'Expeditions, dungeons and the arena wait for HP to regenerate below this value. The circus does not use your HP.',
        },
        {
          path: 'heal.bags',
          type: 'checks',
          label: 'Eat food from bags',
          dependsOn: 'heal.enabled',
          help: 'Inventory tabs I-VIII. Keep usables you want to save in the others. When these bags hold no food, food is taken from the packages into one of them. None ticked = all bags.',
          items: ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'].map((label, i) => ({ path: `heal.bags.b${i + 1}`, label })),
        },
        {
          path: 'heal.plainOnly',
          type: 'toggle',
          label: 'Only plain food',
          dependsOn: 'heal.enabled',
          help: 'Skip food that does something besides healing: eggs that give rubies, points or cooldown skips, Cervisia that activates Centurio, and the like. The auction house does not bid on those either.',
        },
        {
          path: 'heal.market',
          type: 'toggle',
          label: 'Buy food on the market when none is left',
          dependsOn: 'heal.enabled',
          help: "Only when the food bags and the packages hold no food: other players' food on the public market, best HP per gold first and never your own listings. It arrives as a package, which the next meal takes out. Gold only.",
        },
        { path: 'heal.marketMinHpPerGold', type: 'number', label: 'Only market food that heals at least', unit: 'HP per gold', step: 0.1, dependsOn: 'heal.market', help: 'Heal amount divided by the price. 1 means a 9,000 HP cake may cost up to 9,000 gold.' },
        {
          path: 'heal.buy',
          type: 'toggle',
          label: 'Buy food from the merchants when none is left',
          dependsOn: 'heal.enabled',
          help: "Only when the food bags and the packages hold no food (and the market had none, if that is on). The merchants' food (General goods sells it) costs more than the auction house, so the best HP per gold goes first. It goes into a food bag. Gold only, never rubies.",
        },
        { path: 'heal.buyAtOnce', type: 'number', label: 'Items to buy per trip', dependsOn: ['heal.buy', 'heal.market'] },
        { path: 'heal.buyMaxGoldPerDay', type: 'number', label: 'Spend at most', unit: 'gold a day', dependsOn: ['heal.buy', 'heal.market'], help: 'Market and merchants together.' },
        { path: 'heal.buyKeepGold', type: 'number', label: 'Never let gold drop below', dependsOn: ['heal.buy', 'heal.market'] },
        {
          path: 'heal.medic',
          type: 'select',
          label: "The guild's doctors (Villa Medici)",
          options: [
            { value: 'off', label: 'Not used' },
            { value: 'underworld', label: 'In the Underworld' },
            { value: 'always', label: 'Always, before food' },
          ],
          help: "Free: each doctor heals a share of your HP (the page says how much; it grows with the building), then rests for about 2 hours. In the Underworld, where food cannot be eaten, a doctor is seen when HP is below the Underworld's fighting limit, instead of waiting for HP to come back; elsewhere when it is below the eating limit above. Needs a guild with the Villa Medici.",
        },
        { path: 'heal.medicMax', type: 'number', label: 'See at most', unit: 'doctors a day (a visit, in the Underworld)', help: '0 = no limit.' },
      ],
    },
    {
      id: 'gods',
      title: 'Gods',
      icon: 'gods',
      enable: 'gods.enabled',
      description:
        "Spend the gods' favour (from quests with a god reward and the daily login bonus) instead of letting it pile up: each ticked blessing or oil is bought whenever it is off its cooldown and its god has the favour. Favour only; rubies are never spent. Lanista looks every 30 minutes.",
      fields: [
        {
          path: 'gods.blessings',
          type: 'checks',
          label: 'Blessings (rank 1, 20 favour, every 6 h)',
          help: 'An hour of: Minerva +25 intelligence, Diana +840 armour, Mars +12 damage per hit, Mercury +25 charisma, Apollo +25 agility, Vulcan +25 dexterity (stats only up to their maximum for your level).',
          items: godChecks('blessings'),
        },
        {
          path: 'gods.oils',
          type: 'checks',
          label: 'Holy oils (rank 2, 60 favour, every 18 h)',
          help: 'An oil to put on an item, raising one of its stats to the most possible for your level: Minerva charisma, Diana dexterity, Mars agility, Mercury intelligence, Apollo damage, Vulcan armour. It needs a free spot in your bags.',
          items: godChecks('oils'),
        },
        {
          path: 'gods.rank3',
          type: 'checks',
          label: 'Great blessings (rank 3, 150 favour, every 42 h)',
          help: "Half an hour of: Minerva no double hits (either side), Diana +15% hit chance, Mars no critical hits (either side), Mercury weaker enemy healing, Apollo more blocking, Vulcan +15% armour (you and your mercenaries).",
          items: godChecks('rank3'),
        },
        { path: 'gods.minPercent', type: 'number', label: 'Only once a god has at least', unit: '% of its maximum favour', help: '0 = whenever there is enough. A god at its maximum gains nothing more, so 90 only spends what would go to waste.' },
      ],
    },
    {
      id: 'boosts',
      title: 'Boosts',
      icon: 'boosts',
      enable: 'boosts.enabled',
      description:
        "Use boost potions (Flask of Strength, Bottle of agility, Hawthorn and the like) from your bags or packages, one at a time per stat: the longest-lasting first, the next once it runs out. A stat already at its maximum for your level gains nothing from a boost, so none is used while it has less room than half the boost.",
      fields: [
        {
          path: 'boosts.stats',
          type: 'checks',
          label: 'Keep boosted',
          help: 'Health boosts raise your maximum HP. Lanista looks again every hour for stats it could not boost.',
          items: BOOST_NAMES.map(([id, label]) => ({ path: `boosts.stats.${id}`, label })),
        },
      ],
    },
    {
      id: 'costumes',
      title: 'Costumes',
      icon: 'costumes',
      enable: 'costumes.enabled',
      description:
        "Beating Dīs Pater in the Underworld gives Dīs Pater's Armour for that level, a costume with big bonuses that lasts a while once put on. Lanista can put it on as soon as it may, which also lets you enter the Underworld on that level again. Taking it off early destroys it, so nothing else is put on while it lasts. The rest of the time it can wear a costume of your choice. Changing costumes has a cooldown; Lanista waits for it.",
      fields: [
        {
          path: 'costumes.armour',
          type: 'checks',
          label: "Put on Dīs Pater's Armour from",
          help: 'Normal: expedition points, gold and items. Medium: the same for dungeons. Hard: arena and Circus Turma cooldowns and prize money. When you hold several, the one from the level set under Underworld goes first.',
          items: [
            { path: 'costumes.armour.normal', label: 'Normal' },
            { path: 'costumes.armour.medium', label: 'Medium' },
            { path: 'costumes.armour.hard', label: 'Hard' },
          ],
        },
        {
          path: 'costumes.everyday',
          type: 'select',
          label: 'Otherwise wear',
          options: [{ value: '', label: 'Leave the costume as it is' }, ...COSTUMES.map((name) => ({ value: name, label: name }))],
          help: 'Only a costume you have at least one piece of. Its bonuses come with the number of pieces you have.',
        },
      ],
    },
    {
      id: 'work',
      title: 'Stable work',
      icon: 'work',
      enable: 'work.enabled',
      description: 'Take a job in the stable once you are out of expedition and dungeon points.',
      fields: [
        { path: 'work.job', type: 'number', label: 'Job #', base: 1, help: 'Position of the job in the stable list (1 = first).' },
        { path: 'work.hours', type: 'number', label: 'Hours', unit: 'h', help: 'The longest duration offered that is not above this value is used.' },
      ],
    },
    {
      id: 'training',
      title: 'Training',
      icon: 'training',
      enable: 'training.enabled',
      description: 'Spend spare gold on stat points. Gold you spend cannot be stolen by arena attackers.',
      fields: [
        { path: 'training.keepGold', type: 'number', label: 'Always keep', unit: 'gold', step: 10000, help: 'Training stops before gold drops below this.' },
        {
          path: 'training.stats',
          type: 'checks',
          label: 'Stats to train',
          help: 'The cheapest selected stat is trained first, which keeps them balanced.',
          items: [
            { path: 'training.stats.strength', label: 'Strength' },
            { path: 'training.stats.dexterity', label: 'Dexterity' },
            { path: 'training.stats.agility', label: 'Agility' },
            { path: 'training.stats.constitution', label: 'Constitution' },
            { path: 'training.stats.charisma', label: 'Charisma' },
            { path: 'training.stats.intelligence', label: 'Intelligence' },
          ],
        },
      ],
    },
    {
      id: 'repair',
      title: 'Repair',
      icon: 'repair',
      enable: 'repair.enabled',
      description: 'Repair worn gear at the workbench with materials from the Horreum. Rent is always paid in gold, never rubies.',
      fields: [
        { path: 'repair.belowPercent', type: 'number', label: 'Repair below', unit: '% conditioning', help: 'Items on your character are repaired once their conditioning drops below this.' },
        {
          path: 'repair.allUpToPercent',
          type: 'number',
          label: '"Repair all" button: skip items above',
          unit: '% conditioning',
          help: 'The button on the overview page repairs items at or below this. Rent costs the same for a nearly new item as for a worn one.',
        },
        {
          path: 'repair.maxQuality',
          type: 'select',
          label: 'Best materials to use',
          options: qualityOptions('Standard (white) only'),
          help: 'The lowest quality in stock is used first. Fights wait while an item is off your character.',
        },
        {
          path: 'repair.dolls',
          type: 'checks',
          label: 'Look after the gear of',
          help: 'The tabs on the overview page. Every repair costs workbench rent in gold and materials. The "Repair all" button works on whichever tab is open.',
          items: [
            { path: 'repair.dolls.d1', label: 'My character' },
            { path: 'repair.dolls.d2', label: 'Tab X' },
            { path: 'repair.dolls.d3', label: 'Mercenary I' },
            { path: 'repair.dolls.d4', label: 'Mercenary II' },
            { path: 'repair.dolls.d5', label: 'Mercenary III' },
            { path: 'repair.dolls.d6', label: 'Mercenary IV' },
          ],
        },
      ],
    },
    {
      id: 'smelting',
      title: 'Smelting',
      icon: 'smelting',
      enable: 'smelting.enabled',
      description: 'Tick items on the packages page to smelt them, or let the rules below pick them. While the bot runs it fills free smelter slots from that queue and collects finished smelts. Rent is paid in gold, never rubies.',
      fields: [
        {
          path: 'smelting.storeIn',
          type: 'select',
          label: 'Put the resources',
          options: [
            { value: 'horreum', label: 'In the Horreum' },
            { value: 'packages', label: 'In a package' },
          ],
        },
        {
          path: 'smelting.auto',
          type: 'toggle',
          label: 'Also smelt package items automatically',
          help: 'Every 30 minutes the bot looks through your packages and queues the items that match the rules below, as if you had ticked them.',
        },
        { path: 'smelting.autoUpTo', type: 'select', label: 'Items of quality', options: qualityOptions('Standard (white) only'), dependsOn: 'smelting.auto' },
        {
          path: 'smelting.autoTypes',
          type: 'checks',
          label: 'Kinds',
          dependsOn: 'smelting.auto',
          help: KINDS_HELP,
          items: GEAR_KINDS.map(([kind, label]) => ({ path: `smelting.autoTypes.${kind}`, label })),
        },
        {
          path: 'smelting.bins',
          type: 'checks',
          label: 'Smelt everything in bags',
          help: 'Inventory tabs I-VIII used as smelt bins: drop items in and anything the smelter takes gets smelted. Keep them free of things you want to keep. None ticked = off.',
          items: ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'].map((label, i) => ({ path: `smelting.bins.b${i + 1}`, label })),
        },
      ],
    },
    {
      id: 'packages',
      title: 'Packages',
      icon: 'packages',
      enable: 'packages.enabled',
      description: 'Tidy the packages every 30 minutes while the bot runs: take out gold, store resources, sell gear you do not want, and save packages before they expire. Items ticked for smelting are left for the smelter.',
      fields: [
        { path: 'packages.collectGold', type: 'toggle', label: 'Take the gold out of gold packages' },
        {
          path: 'packages.storeResources',
          type: 'toggle',
          label: 'Store resources in the Horreum',
          help: 'Like the "Store all resources in the Horreum" button on the packages page. Surplus above 99,999 per type and quality is sold.',
        },
        {
          path: 'packages.sell',
          type: 'toggle',
          label: 'Sell gear to a merchant',
          help: 'Weapons, armour and jewellery that match the rules below are sold for their value, one at a time through a free spot in your bags. Smelting rules go first.',
        },
        { path: 'packages.sellUpTo', type: 'select', label: 'Items of quality', options: qualityOptions('Standard (white) only'), dependsOn: 'packages.sell' },
        {
          path: 'packages.sellTypes',
          type: 'checks',
          label: 'Kinds',
          dependsOn: 'packages.sell',
          help: KINDS_HELP,
          items: GEAR_KINDS.map(([kind, label]) => ({ path: `packages.sellTypes.${kind}`, label })),
        },
        {
          path: 'packages.expiring',
          type: 'select',
          label: 'Packages about to expire',
          options: [
            { value: 'renew', label: 'Renew them in the guild market' },
            { value: 'bag', label: 'Move them into my bags' },
            { value: 'sell', label: 'Sell them' },
            { value: 'off', label: 'Leave them' },
          ],
          help: "Any package, not only gear. Renewing lists the item in your guild's market for 1 gold and cancels the listing at once, so it comes back as a new package with a fresh expiry. It needs a guild and, for a moment, room in your bags. Moving needs free room in your bags outside the food bags.",
        },
        { path: 'packages.expiringHours', type: 'number', label: 'About to expire means less than', unit: 'h left' },
        {
          path: 'packages.keepNames',
          type: 'textarea',
          label: 'Never sell or smelt',
          placeholder: 'One name or part of a name per line',
          help: 'Items whose name contains one of these are left alone by the selling and smelting rules (still rescued before their package expires).',
        },
        {
          path: 'packages.pick',
          type: 'checks',
          label: 'Take these out into my bags',
          help: 'From the packages into a free spot in your bags, never into the food bags you chose under Health. When the other bags are full it waits until there is room.',
          items: [
            { path: 'packages.pick.upgrades', label: 'Upgrades (grindstones, powders)' },
            { path: 'packages.pick.boosts', label: 'Boosts' },
            { path: 'packages.pick.scrolls', label: 'Scrolls' },
            { path: 'packages.pick.recipes', label: 'Recipes' },
            { path: 'packages.pick.tools', label: 'Tools' },
            { path: 'packages.pick.mercenary', label: 'Mercenary items' },
          ],
        },
        {
          path: 'packages.learnScrolls',
          type: 'toggle',
          label: 'Learn new scrolls',
          help: "A scroll in the packages whose prefix or suffix the forge does not list yet is used, which learns it. Scrolls you already know are left alone.",
        },
      ],
    },
    {
      id: 'gold',
      title: 'Gold',
      icon: 'gold',
      enable: 'gold.hide',
      description:
        "Gold on hand can be stolen by anyone who beats you in the arena. Lanista keeps what's above your limit in your guild's market as \"gold packs\": it buys the dearest pack a guildmate listed that your spare gold pays for, and lists it again at the same price for 24 hours. When a guildmate buys it, your gold comes back as a gold package, safe in the packages (leave Packages > Gold packages off to keep it there). Only listings far above the item's worth count as packs; your own are never bought. Packs Lanista holds are listed again until they sell, even with this switched off.",
      fields: [
        { path: 'gold.keep', type: 'number', label: 'Keep on hand', unit: 'gold', help: 'Training, repairs and food are paid from this.' },
        { path: 'gold.minPack', type: 'number', label: 'Smallest pack', unit: 'gold', help: 'Listings cheaper than this are left alone.' },
      ],
    },
    {
      id: 'auction',
      title: 'Auction house',
      icon: 'auction',
      enable: 'auction.enabled',
      description: 'Bid on healing items (food and potions) and, if you like, gear in the auction house. Careful: the game keeps your gold if someone outbids you, so the bot bids late, once per lot, and only at a price you accept. Buyout costs rubies and is never used. Won items arrive as packages; healing takes food from there when the bags are empty.',
      fields: [
        { path: 'auction.food', type: 'toggle', label: 'Bid on food' },
        { path: 'auction.minHpPerGold', type: 'number', label: 'Only lots that heal at least', unit: 'HP per gold', step: 0.1, dependsOn: 'auction.food', help: 'Heal amount divided by the bid. 4 means a 2,000 HP bread may cost up to 500 gold.' },
        {
          path: 'auction.bidWhen',
          type: 'select',
          label: 'Bid when the auction time is',
          options: [
            { value: 'short', label: 'Short or very short (safest)' },
            { value: 'medium', label: 'Medium or shorter' },
            { value: 'any', label: 'Any time' },
          ],
          help: 'The later the bid, the fewer players can still outbid you.',
        },
        { path: 'auction.maxPerRound', type: 'number', label: 'Spend at most', unit: 'gold per auction round', step: 1000 },
        { path: 'auction.keepGold', type: 'number', label: 'Always keep', unit: 'gold', step: 10000 },
        { path: 'auction.maxFood', type: 'number', label: 'Stop at', unit: 'healing items owned', dependsOn: 'auction.food', help: 'Food and potions in your bags and packages.' },
        { path: 'auction.gear', type: 'toggle', label: 'Bid on gear', help: 'Within the same round budget and gold reserve as food.' },
        {
          path: 'auction.gearTypes',
          type: 'checks',
          label: 'Kinds',
          dependsOn: 'auction.gear',
          help: KINDS_HELP,
          items: GEAR_KINDS.map(([kind, label]) => ({ path: `auction.gearTypes.${kind}`, label })),
        },
        {
          path: 'auction.gearMinQuality',
          type: 'select',
          label: 'At least',
          dependsOn: 'auction.gear',
          options: QUALITIES.map((q, i) => ({ value: i - 1, label: q })),
        },
        { path: 'auction.gearMaxPrice', type: 'number', label: 'At most', unit: 'gold per lot', step: 1000, dependsOn: 'auction.gear' },
      ],
    },
    {
      id: 'quests',
      title: 'Quests',
      icon: 'quests',
      enable: 'quests.enabled',
      description: 'Collect finished pantheon quests and accept new ones of the types you choose.',
      fields: [
        {
          path: 'quests.types',
          type: 'checks',
          label: 'Accept quest types',
          items: [
            { path: 'quests.types.combat', label: 'Combat' },
            { path: 'quests.types.arena', label: 'Arena' },
            { path: 'quests.types.circus', label: 'Circus' },
            { path: 'quests.types.expedition', label: 'Expedition' },
            { path: 'quests.types.dungeon', label: 'Dungeon' },
            { path: 'quests.types.items', label: 'Items' },
            { path: 'quests.types.work', label: 'Work' },
          ],
        },
        {
          path: 'quests.matchLocation',
          type: 'toggle',
          label: 'Only quests for my location and dungeon',
          help: 'Skip expedition and dungeon quests for places the bot does not fight at.',
        },
        {
          path: 'quests.onlyActive',
          type: 'toggle',
          label: 'Only quests for activities that are on',
          help: 'For example, skip arena quests while the arena is off.',
        },
        {
          path: 'quests.skipTimed',
          type: 'toggle',
          label: 'Skip quests with a time limit',
          help: 'They fail when the time runs out, which can happen while waiting for cooldowns.',
        },
        { path: 'quests.skipFoodReward', type: 'toggle', label: 'Skip quests that reward food' },
        {
          path: 'quests.rankBy',
          type: 'select',
          label: 'Of the rest, take the one with the most',
          options: [
            { value: 'gold', label: 'Gold' },
            { value: 'honour', label: 'Honour' },
            { value: 'xp', label: 'Experience' },
          ],
        },
      ],
    },
    {
      id: 'schedule',
      title: 'Schedule',
      icon: 'schedule',
      description: 'Play only at certain hours and take random breaks, like a person would.',
      fields: [
        { path: 'schedule.activeHours', type: 'toggle', label: 'Only play during active hours' },
        { path: 'schedule.start', type: 'time', label: 'From', dependsOn: 'schedule.activeHours' },
        { path: 'schedule.end', type: 'time', label: 'Until', dependsOn: 'schedule.activeHours', help: 'May wrap past midnight, e.g. 22:00 → 06:00.' },
        { path: 'schedule.breaks', type: 'toggle', label: 'Take random breaks' },
        { path: 'schedule.breakEvery', type: 'number', label: 'About every', unit: 'min', dependsOn: 'schedule.breaks' },
        { path: 'schedule.breakLength', type: 'number', label: 'For about', unit: 'min', dependsOn: 'schedule.breaks', help: 'Both values vary by ±30%.' },
      ],
    },
    {
      id: 'safety',
      title: 'Timing & safety',
      icon: 'safety',
      description: 'How fast the bot clicks, and what it does when something keeps failing.',
      fields: [
        { path: 'timing.minClickDelay', type: 'number', label: 'Click delay from', unit: 's', step: 0.1 },
        { path: 'timing.maxClickDelay', type: 'number', label: 'Click delay up to', unit: 's', step: 0.1 },
        { path: 'timing.maxIdle', type: 'number', label: 'Re-check at least every', unit: 's' },
        { path: 'safety.maxAttempts', type: 'number', label: 'Failed attempts before pausing an activity' },
        { path: 'safety.backoffMinutes', type: 'number', label: 'Pause a failing activity for', unit: 'min' },
      ],
    },
    {
      id: 'notifications',
      title: 'Notifications',
      icon: 'notifications',
      description: 'Desktop notifications for things that need your attention, and on your phone if you like.',
      fields: [
        { path: 'notifications.loggedOut', type: 'toggle', label: 'Logged out / game tab left the game' },
        { path: 'notifications.activityPaused', type: 'toggle', label: 'An activity was paused after repeated failures' },
        { path: 'notifications.noFood', type: 'toggle', label: 'HP is low and there is no food left' },
        { path: 'notifications.underworld', type: 'toggle', label: 'The Underworld was not entered: Dīs Pater\'s Armor from that level is still unused' },
        { path: 'notifications.levelUp', type: 'toggle', label: 'You reached a new level' },
        { path: 'notifications.messages', type: 'toggle', label: 'Unread messages in the game', help: 'From players, your guild and the game (auction wins and the like). Lanista does not open them.' },
        { path: 'notifications.costume', type: 'toggle', label: "A costume was put on, or Dīs Pater's Armour ran out", help: 'Needs Costumes switched on.' },
        { path: 'notifications.dailySummary', type: 'toggle', label: "Yesterday's statistics, once a day", help: 'Fights, gold, experience, honour and fame, sent after midnight.' },
        { path: 'notifications.newLocation', type: 'toggle', label: 'A new place in the location menu', help: "Events add their own place to the menu, and new areas open as you level up. The Underworld's menu does not count." },
        { path: 'notifications.desktop', type: 'toggle', label: 'Show them on this computer' },
        {
          path: 'notifications.pushUrl',
          type: 'push',
          label: 'Also send them to your phone',
          placeholder: 'One address per line',
          help: 'Any of these, one per line:\n• ntfy: install the free ntfy app, subscribe to a long, hard-to-guess topic name, paste https://ntfy.sh/that-name\n• Discord: channel settings > Integrations > Webhooks > Copy Webhook URL\n• Slack: an incoming webhook (https://hooks.slack.com/services/...)\n• Telegram: make a bot with @BotFather, send it a message, then paste https://api.telegram.org/bot<token>/sendMessage?chat_id=<your chat id>\n• Pushover: https://api.pushover.net/1/messages.json?token=<app token>&user=<user key>\n• Gotify: https://<your server>/message?token=<app token>\nAnyone with an address can post to it (and read an ntfy topic), so keep them to yourself; exported settings include them.',
        },
        { path: 'notifications.quiet', type: 'toggle', label: 'Quiet hours for the phone', help: 'Phone alerts wait until the quiet hours end, then come together in one message. Desktop alerts still show.' },
        { path: 'notifications.quietStart', type: 'time', label: 'Quiet from', dependsOn: 'notifications.quiet' },
        { path: 'notifications.quietEnd', type: 'time', label: 'Quiet until', dependsOn: 'notifications.quiet' },
      ],
    },
    {
      id: 'remote',
      title: 'Remote control',
      icon: 'remote',
      enable: 'remote.enabled',
      description:
        'Send commands from your phone and get the answer back: status, stop, start, check (look at the game now), stats (today\'s numbers), log (the last 10 lines) and help. Add a server number to pick one server, like "stop 303"; without one, every server listening there does it. Lanista reads commands once a minute while the browser is open.\n\nTelegram: the bot you added under Notifications as a phone address. Only messages from that chat count. Don\'t use the bot with another program at the same time, or the two will take each other\'s messages.',
      fields: [
        {
          path: 'remote.ntfyTopic',
          type: 'text',
          wide: true,
          label: 'Commands from the ntfy topic',
          placeholder: 'https://ntfy.sh/your-command-topic',
          help: 'Publish a command to this topic in the ntfy app; the answer appears in the same topic. Anyone who knows the name can send commands, so make it long and hard to guess. Leave it empty to use only Telegram.',
        },
      ],
    },
    {
      id: 'interface',
      title: 'Interface',
      icon: 'interface',
      description: 'The control bar shown on game pages.',
      fields: [
        { path: 'ui.panel', type: 'toggle', label: 'Show the control bar on game pages' },
        {
          path: 'ui.layout',
          type: 'select',
          label: 'Layout',
          dependsOn: 'ui.panel',
          options: [
            { value: 'floating', label: 'Floating window (drag to move)' },
            { value: 'bar', label: 'Bar docked to the top of the page' },
          ],
        },
      ],
    },
    { id: 'stats', title: 'Statistics', icon: 'stats', custom: 'stats', description: 'What Lanista has done on this server.' },
    { id: 'log', title: 'Log', icon: 'log', custom: 'log', description: 'What Lanista has been up to on this server. Something off? Report it with the button below; a few log lines help a lot.' },
    { id: 'profile', title: 'Backup', icon: 'profile', custom: 'profile', description: 'Every server keeps its own settings. Copy them from another server, export them to a file, import them on another browser, or reset them.' },
  ];

  // Labels/icons for the priority list and the control bar tiles.
  // ---------------------------------------------------------------- overview

  const fmt = (n) => Number(n).toLocaleString();
  const QUALITY_NAMES = ['Standard', 'Ceres', 'Neptun', 'Mars', 'Jupiter', 'Olymp'];
  const quality = (q) => QUALITY_NAMES[q + 1] || String(q);
  const line = (parts) => parts.filter(Boolean).join(' · ');
  const times = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const ENEMIES = ['1st enemy', '2nd enemy', '3rd enemy', 'the boss'];
  const TARGET_WORDS = { lowest: 'weakest first', highest: 'strongest first', random: 'random opponents' };
  const ENTER_LEVELS = { normal: 'Normal', medium: 'Middle', hard: 'Hard' };
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

  // A location id as its name, when the game menu has been seen.
  function placeName(id, info, fallback) {
    if (id === 'auto') return fallback;
    const known = ((info && info.locations) || []).find((l) => String(l.id) === String(id));
    return known ? known.name : `location #${id}`;
  }

  function opponentSummary(c) {
    const ignored = String(c.ignorePlayers || '')
      .split(/[\n,;]+/)
      .filter((n) => n.trim()).length;
    return line([
      c.where === 'local' ? 'on this server' : 'Provinciarum',
      TARGET_WORDS[c.target],
      c.where !== 'local' && c.limitLevels && `levels −${c.maxBelow} to +${c.maxAbove}`,
      c.preferBeaten && 'beaten ones first',
      ignored && `${times(ignored, 'name', 'names')} never attacked`,
      c.perDay && `at most ${c.perDay} a day`,
    ]);
  }

  // One line per feature for the Overview tab.
  const SUMMARIES = {
    expedition: (s, info) => {
      const e = s.expedition;
      return line([
        placeName(e.location, info, 'the last visited location'),
        ENEMIES[e.enemy - 1] + (e.enemy === 4 && e.bonusesFirst ? ' (bonuses first)' : ''),
        e.keepPoints && `keeps ${times(e.keepPoints, 'point', 'points')}`,
        e.easierAfterLosses && `easier enemy after ${times(e.easierAfterLosses, 'loss', 'losses')}`,
        e.mobilisationsPerDay && `${times(e.mobilisationsPerDay, 'Mobilisation', 'Mobilisations')} a day`,
      ]);
    },
    dungeon: (s, info) => {
      const d = s.dungeon;
      return line([
        placeName(d.location, info, 'the last visited dungeon'),
        d.difficulty === 'advanced' ? 'Advanced' : 'Normal',
        d.skipBoss && 'skips the boss',
        d.restartAfterLosses && `starts over after ${times(d.restartAfterLosses, 'loss', 'losses')}`,
        d.keepPoints && `keeps ${times(d.keepPoints, 'point', 'points')}`,
        d.gateKeysPerDay && `${times(d.gateKeysPerDay, 'Gate Key', 'Gate Keys')} a day`,
      ]);
    },
    underworld: (s) => {
      const u = s.underworld;
      return line([
        `fights above ${u.minHpPercent}% HP`,
        u.enter === 'off' ? 'you go in yourself' : `goes in on ${ENTER_LEVELS[u.enter]}`,
        u.mobilisations && `${times(u.mobilisations, 'Mobilisation', 'Mobilisations')} a visit`,
        u.potions && `${times(u.potions, 'healing potion', 'healing potions')} a visit`,
      ]);
    },
    arena: (s) => opponentSummary(s.arena),
    circus: (s) => opponentSummary(s.circus),
    heal: (s) => {
      const h = s.heal;
      const bags = ROMAN.filter((_, i) => h.bags[`b${i + 1}`]);
      return line([
        `eats below ${h.eatBelowPercent}%`,
        `stops fighting below ${h.minHpPercent}%`,
        bags.length && bags.length < 8 ? `${bags.length === 1 ? 'bag' : 'bags'} ${bags.join(', ')}` : 'all bags',
        h.plainOnly && 'plain food only',
        h.medic !== 'off' && (h.medic === 'always' ? 'sees the guild doctors first' : 'sees the guild doctors in the Underworld'),
        h.market && 'buys food on the market',
        h.buy && `buys food (up to ${fmt(h.buyMaxGoldPerDay)} gold a day)`,
      ]);
    },
    quests: (s) => {
      const on = ['combat', 'arena', 'circus', 'expedition', 'dungeon', 'items', 'work'].filter((k) => s.quests.types[k]);
      const q = s.quests;
      return line([
        on.length ? on.join(', ') : 'no quest types ticked',
        q.matchLocation && 'only where it fights',
        q.skipTimed && 'no time limits',
        q.skipFoodReward && 'no food rewards',
        q.rankBy !== 'gold' && `most ${q.rankBy === 'xp' ? 'experience' : 'honour'} first`,
      ]);
    },
    work: (s) => line([`job ${s.work.job + 1}`, times(s.work.hours, 'hour', 'hours'), 'once the points run out']),
    training: (s) => {
      const stats = Object.keys(s.training.stats).filter((k) => s.training.stats[k]);
      return line([`keeps ${fmt(s.training.keepGold)} gold`, stats.length ? stats.join(', ') : 'no stats ticked']);
    },
    repair: (s) => {
      const r = s.repair;
      const whose = ['you', 'tab X', 'mercenary I', 'mercenary II', 'mercenary III', 'mercenary IV'].filter((_, i) => r.dolls[`d${i + 1}`]);
      return line([`below ${r.belowPercent}%`, `materials up to ${quality(r.maxQuality)}`, whose.length ? whose.join(', ') : 'you']);
    },
    smelting: (s) => {
      const m = s.smelting;
      const bins = ROMAN.filter((_, i) => m.bins && m.bins[`b${i + 1}`]);
      return line([
        `resources to the ${m.storeIn === 'horreum' ? 'Horreum' : 'packages'}`,
        m.auto ? `picks items up to ${quality(m.autoUpTo)}` : 'only what you tick',
        bins.length && `everything in ${bins.length === 1 ? 'bag' : 'bags'} ${bins.join(', ')}`,
      ]);
    },
    packages: (s) => {
      const p = s.packages;
      return (
        line([
          p.collectGold && 'opens gold',
          p.storeResources && 'stores resources',
          p.sell && `sells up to ${quality(p.sellUpTo)}`,
          p.expiring === 'renew' ? 'renews expiring ones' : p.expiring === 'bag' ? 'rescues expiring ones' : p.expiring === 'sell' ? 'sells expiring ones' : null,
          Object.values(p.pick || {}).some(Boolean) && 'takes chosen items out',
          p.learnScrolls && 'learns scrolls',
        ]) || 'no rules switched on'
      );
    },
    gold: (s) => line([`keeps ${fmt(s.gold.keep)} on hand`, 'the rest in guild market packs']),
    auction: (s) => {
      const a = s.auction;
      return line([
        a.food && `food at ${a.minHpPerGold}+ HP per gold`,
        a.gear && `${QUALITY_NAMES[a.gearMinQuality + 1]}+ gear up to ${fmt(a.gearMaxPrice)}`,
        `up to ${fmt(a.maxPerRound)} gold a round`,
        `keeps ${fmt(a.keepGold)} gold`,
      ]);
    },
  };

  // Not features with a switch, but worth seeing on the Overview.
  SUMMARIES.schedule = (s) => {
    const c = s.schedule;
    return line([c.activeHours ? `plays ${c.start}–${c.end}` : 'plays around the clock', c.breaks && `a break of about ${c.breakLength} min every ${c.breakEvery} min`]);
  };
  SUMMARIES.notifications = (s) => {
    const n = s.notifications;
    const kinds = ['loggedOut', 'activityPaused', 'noFood', 'underworld', 'levelUp', 'messages', 'costume', 'dailySummary', 'newLocation'].filter((k) => n[k]).length;
    const phones = GBot.settings.pushUrls(n).length;
    const where = [n.desktop && 'desktop', phones && (phones === 1 ? 'phone' : `${phones} phone addresses`)].filter(Boolean).join(' and ') || 'shown nowhere';
    return kinds ? line([`${times(kinds, 'kind of alert', 'kinds of alert')} on`, where, phones && n.quiet && `phone quiet ${n.quietStart}–${n.quietEnd}`]) : 'all alerts off';
  };
  SUMMARIES.remote = (s) => {
    const r = s.remote;
    const telegram = GBot.settings.pushUrls(s.notifications).some((u) => /^https:\/\/api\.telegram\.org\/bot/i.test(u));
    const from = [telegram && 'Telegram', r.ntfyTopic && 'ntfy'].filter(Boolean);
    return from.length ? `commands from ${from.join(' and ')}` : 'no Telegram bot or ntfy topic set up';
  };
  SUMMARIES.gods = (s) => {
    const g = s.gods;
    const count = (key) => Object.values(g[key]).filter(Boolean).length;
    return line([
      count('blessings') && times(count('blessings'), 'blessing', 'blessings'),
      count('oils') && times(count('oils'), 'holy oil', 'holy oils'),
      count('rank3') && times(count('rank3'), 'great blessing', 'great blessings'),
      g.minPercent && `once favour is ${g.minPercent}% full`,
    ]) || 'nothing ticked';
  };
  SUMMARIES.boosts = (s) => {
    const on = BOOST_NAMES.filter(([id]) => s.boosts.stats[id]).map(([, label]) => label.replace(/ \(.*\)$/, '').toLowerCase());
    return on.length ? `keeps ${on.join(', ')} boosted` : 'nothing ticked';
  };
  SUMMARIES.costumes = (s) => {
    const c = s.costumes;
    const levels = ['normal', 'medium', 'hard'].filter((l) => c.armour[l]);
    return line([levels.length && `Dīs Pater's Armour (${levels.join(', ')})`, c.everyday ? `otherwise ${c.everyday}` : 'otherwise leaves it']);
  };

  // Sidebar order, under group headings.
  const LAYOUT = [
    [null, ['overview', 'general']],
    ['Fights', ['expedition', 'dungeon', 'underworld', 'arena', 'circus']],
    ['Character', ['heal', 'quests', 'work', 'training', 'gods', 'boosts', 'costumes']],
    ['Items', ['gold', 'repair', 'smelting', 'packages', 'auction']],
    ['Lanista', ['schedule', 'safety', 'notifications', 'remote', 'interface', 'stats', 'log', 'profile']],
  ];
  const byId = Object.fromEntries(ALL_TABS.map((t) => [t.id, t]));
  const TABS = LAYOUT.flatMap(([group, ids]) => ids.map((id) => ({ ...byId[id], group, summary: SUMMARIES[id] || null })));
  if (TABS.length !== ALL_TABS.length || TABS.some((t) => !t.id)) throw new Error('schema.js: LAYOUT and the tabs do not match');

  const ACTIVITIES = {
    expedition: { label: 'Expedition', icon: 'expedition', tab: 'expedition', path: 'expedition.enabled' },
    dungeon: { label: 'Dungeon', icon: 'dungeon', tab: 'dungeon', path: 'dungeon.enabled' },
    arena: { label: 'Arena', icon: 'arena', tab: 'arena', path: 'arena.enabled' },
    circus: { label: 'Circus', icon: 'circus', tab: 'circus', path: 'circus.enabled' },
    heal: { label: 'Heal', icon: 'heal', tab: 'heal', path: 'heal.enabled' },
    work: { label: 'Work', icon: 'work', tab: 'work', path: 'work.enabled' },
    quests: { label: 'Quests', icon: 'quests', tab: 'quests', path: 'quests.enabled' },
  };

  Object.assign(ui, { TABS, ACTIVITIES });
})(typeof globalThis !== 'undefined' ? globalThis : this);
