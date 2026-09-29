// Declarative description of the settings window: one entry per tab, one
// field per setting. The renderer (settings-ui.js) turns this into forms, and
// number limits come from GBot.settings.CONSTRAINTS so validation and UI agree.
//
// Field types: toggle, number, select, location, text, textarea, time, order,
// checks. Optional field keys: help, unit, step, base (display offset, e.g. 1
// to show a 0-based index as 1-based), dependsOn (path of a toggle that must
// be on for the field to be editable), placeholder.
(function (root) {
  'use strict';
  const GBot = (root.GBot = root.GBot || {});
  const ui = (GBot.ui = GBot.ui || {});

  const TARGETS = [
    { value: 'lowest', label: 'Lowest level first' },
    { value: 'highest', label: 'Highest level first' },
    { value: 'random', label: 'Random' },
  ];

  const opponentFields = (type) => [
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
  ];

  const TABS = [
    {
      id: 'general',
      title: 'General',
      icon: 'general',
      description: 'Master switch, and which activity goes first when several are ready at once.',
      fields: [
        { path: 'enabled', type: 'toggle', label: 'Bot is running' },
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
      ],
    },
    {
      id: 'dungeon',
      title: 'Dungeon',
      icon: 'dungeon',
      enable: 'dungeon.enabled',
      description: 'Start a dungeon when none is running and fight its enemies one after another.',
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
        },
        { path: 'dungeon.keepPoints', type: 'number', label: 'Keep points in reserve', help: 'Stop when this many dungeon points are left.' },
      ],
    },
    {
      id: 'arena',
      title: 'Arena',
      icon: 'arena',
      enable: 'arena.enabled',
      description: 'Arena Provinciarum: fight players from other servers.',
      fields: opponentFields('arena'),
    },
    {
      id: 'circus',
      title: 'Circus Turma',
      icon: 'circus',
      enable: 'circus.enabled',
      description: 'Circus Turma Provinciarum: team fights. Your own HP is not used.',
      fields: opponentFields('circus'),
    },
    {
      id: 'heal',
      title: 'Health',
      icon: 'heal',
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
          options: [
            { value: -1, label: 'Standard (white) only' },
            { value: 0, label: 'Up to Ceres (green)' },
            { value: 1, label: 'Up to Neptun (blue)' },
            { value: 2, label: 'Up to Mars (purple)' },
            { value: 3, label: 'Up to Jupiter (orange)' },
            { value: 4, label: 'Up to Olymp (red)' },
          ],
          help: 'The lowest quality in stock is used first. Fights wait while an item is off your character.',
        },
      ],
    },
    {
      id: 'smelting',
      title: 'Smelting',
      icon: 'smelting',
      enable: 'smelting.enabled',
      description: 'Tick items on the packages page to smelt them. While the bot runs it fills free smelter slots from that queue and collects finished smelts. Rent is paid in gold, never rubies.',
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
      ],
    },
    {
      id: 'auction',
      title: 'Auction house',
      icon: 'auction',
      enable: 'auction.enabled',
      description: 'Bid on healing items (food and potions) in the auction house. Careful: the game keeps your gold if someone outbids you, so the bot bids late, once per lot, and only at a price you accept. Buyout costs rubies and is never used. Won items arrive as packages; healing takes food from there when the bags are empty.',
      fields: [
        { path: 'auction.minHpPerGold', type: 'number', label: 'Only lots that heal at least', unit: 'HP per gold', step: 0.1, help: 'Heal amount divided by the bid. 4 means a 2,000 HP bread may cost up to 500 gold.' },
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
        { path: 'auction.maxFood', type: 'number', label: 'Stop at', unit: 'healing items owned', help: 'Food and potions in your bags and packages.' },
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
      description: 'Desktop notifications for things that need your attention.',
      fields: [
        { path: 'notifications.loggedOut', type: 'toggle', label: 'Logged out / game tab left the game' },
        { path: 'notifications.activityPaused', type: 'toggle', label: 'An activity was paused after repeated failures' },
        { path: 'notifications.noFood', type: 'toggle', label: 'HP is low and there is no food left' },
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
    { id: 'stats', title: 'Statistics', icon: 'stats', custom: 'stats', description: 'What the bot has done on this server.' },
    { id: 'log', title: 'Log', icon: 'log', custom: 'log', description: 'Recent bot activity on this server.' },
    { id: 'profile', title: 'Backup', icon: 'profile', custom: 'profile', description: 'Every server keeps its own settings. Copy them from another server, export them to a file, import them on another browser, or reset them.' },
  ];

  // Labels/icons for the priority list and the control bar tiles.
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
