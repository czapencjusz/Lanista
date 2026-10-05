'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { brain, settings: settingsModule } = require('./load');

const NOW = 1_700_000_000_000;

function makeSettings(overrides = {}) {
  const base = settingsModule.mergeSettings(settingsModule.DEFAULT_SETTINGS, {});
  base.enabled = true;
  for (const [key, value] of Object.entries(overrides)) {
    base[key] = typeof value === 'object' && !Array.isArray(value) ? { ...base[key], ...value } : value;
  }
  return base;
}

function cd(ready, remainingMs = ready ? 0 : 60000, extra = {}) {
  return { available: true, ready, remainingMs, link: null, ...extra };
}

function makeState(overrides = {}) {
  return {
    now: NOW,
    inGame: true,
    host: 's1-en.gladiatus.gameforge.com',
    sh: 'abc',
    page: { mod: 'overview' },
    hp: { value: 800, max: 1000, percent: 80, regenPerHour: 600 },
    expedition: cd(false, 120000, { points: 10, maxPoints: 24 }),
    dungeon: cd(false, 300000, { points: 5, maxPoints: 12 }),
    arena: cd(false, 600000),
    circus: cd(false, 900000),
    dialogs: { loginBonus: false, notification: false },
    ...overrides,
  };
}

const memory = () => brain.createMemory(NOW);

test('paused bot and non-game pages are idle', () => {
  assert.equal(brain.decide(makeState(), makeSettings({ enabled: false }), memory(), NOW).type, 'idle');
  assert.equal(brain.decide(makeState({ inGame: false }), makeSettings(), memory(), NOW).type, 'idle');
});

test('dialogs are handled first', () => {
  const state = makeState({ dialogs: { loginBonus: true, notification: false }, expedition: cd(true, 0, { points: 5 }) });
  const d = brain.decide(state, makeSettings(), memory(), NOW);
  assert.equal(d.type, 'dialog');
  assert.equal(d.dialog, 'loginBonus');
});

test('ready expedition is attacked; then dungeon', () => {
  let state = makeState({ expedition: cd(true, 0, { points: 3 }), dungeon: cd(true, 0, { points: 2 }) });
  assert.equal(brain.decide(state, makeSettings(), memory(), NOW).type, 'expedition');
  state = makeState({ dungeon: cd(true, 0, { points: 2 }) });
  assert.equal(brain.decide(state, makeSettings(), memory(), NOW).type, 'dungeon');
});

test('activities without points or disabled are skipped', () => {
  const state = makeState({ expedition: cd(true, 0, { points: 0 }), dungeon: cd(true, 0, { points: 2 }) });
  assert.equal(brain.decide(state, makeSettings(), memory(), NOW).type, 'dungeon');
  const s = makeSettings({ dungeon: { enabled: false } });
  assert.equal(brain.decide(state, s, memory(), NOW).type, 'wait');
});

test('waits until the earliest cooldown ends', () => {
  const d = brain.decide(makeState(), makeSettings(), memory(), NOW);
  assert.equal(d.type, 'wait');
  // Expedition cooldown (120 s) is the earliest; 2-10 s of slack is added.
  assert.ok(d.until >= NOW + 122000 && d.until <= NOW + 130000, `until=${d.until - NOW}`);
});

test('wait is capped by maxIdle', () => {
  const state = makeState({ expedition: cd(false, 3600000, { points: 1 }), dungeon: cd(false, 3600000, { points: 1 }) });
  const d = brain.decide(state, makeSettings({ timing: { maxIdle: 60 } }), memory(), NOW);
  assert.ok(d.until <= NOW + 70000);
});

test('low HP triggers healing and blocks HP-based fights', () => {
  const lowHp = { value: 100, max: 1000, percent: 10, regenPerHour: 600 };
  const state = makeState({ hp: lowHp, expedition: cd(true, 0, { points: 5 }), circus: cd(true) });
  const s = makeSettings({ circus: { enabled: true } });
  assert.equal(brain.decide(state, s, memory(), NOW).type, 'heal');

  // Without food, expeditions wait for regeneration but circus (no HP) still runs.
  const m = memory();
  brain.markNoFood(m, NOW);
  assert.equal(brain.decide(state, s, m, NOW).type, 'circus');

  const s2 = makeSettings();
  const d = brain.decide(state, s2, m, NOW);
  assert.equal(d.type, 'wait');
});

test('hpRegenEta', () => {
  assert.equal(brain.hpRegenEta({ value: 100, max: 1000, regenPerHour: 600 }, 25), 15 * 60 * 1000);
  assert.equal(brain.hpRegenEta({ value: 300, max: 1000, regenPerHour: 600 }, 25), 0);
  assert.equal(brain.hpRegenEta({ value: 100, max: 1000, regenPerHour: null }, 25), null);
});

test('working blocks everything until done', () => {
  const m = memory();
  m.workUntil = NOW + 3600000;
  const d = brain.decide(makeState({ expedition: cd(true, 0, { points: 5 }) }), makeSettings(), m, NOW);
  assert.equal(d.type, 'wait');
  assert.equal(d.until, m.workUntil);
});

test('work starts when out of expedition and dungeon points', () => {
  const s = makeSettings({ work: { enabled: true } });
  const out = makeState({ expedition: cd(true, 0, { points: 0 }), dungeon: cd(true, 0, { points: 0 }) });
  assert.equal(brain.decide(out, s, memory(), NOW).type, 'work');
  const some = makeState({ expedition: cd(false, 1000, { points: 3 }), dungeon: cd(true, 0, { points: 0 }) });
  assert.equal(brain.decide(some, s, memory(), NOW).type, 'wait');
});

test('quests are checked when due', () => {
  const s = makeSettings({ quests: { enabled: true } });
  const m = memory();
  assert.equal(brain.decide(makeState(), s, m, NOW).type, 'quests');
  m.nextQuestCheck = NOW + 60000;
  assert.equal(brain.decide(makeState(), s, m, NOW).type, 'wait');
});

test('attempt budget pauses a failing activity', () => {
  const s = makeSettings({ safety: { maxAttempts: 2, backoffMinutes: 10 } });
  const m = memory();
  const state = makeState();
  for (let i = 1; i <= 4; i++) assert.equal(brain.beginAttempt(m, 'expedition', NOW + i, s, state).ok, true);
  const r = brain.beginAttempt(m, 'expedition', NOW + 5, s, state);
  assert.equal(r.ok, false);
  assert.equal(m.blockedUntil.expedition, NOW + 5 + 10 * 60 * 1000);

  const ready = makeState({ expedition: cd(true, 0, { points: 5 }) });
  assert.equal(brain.decide(ready, s, m, NOW + 10).type, 'wait');
  assert.equal(brain.decide(ready, s, m, NOW + 11 * 60 * 1000).type, 'expedition');
});

test('a different activity resets the attempt counter', () => {
  const s = makeSettings();
  const m = memory();
  brain.beginAttempt(m, 'expedition', NOW, s, makeState());
  brain.beginAttempt(m, 'expedition', NOW, s, makeState());
  assert.equal(brain.beginAttempt(m, 'dungeon', NOW, s, makeState()).attempts, 1);
});

test('resolvePending detects a started cooldown as success', () => {
  const s = makeSettings();
  const m = memory();
  brain.beginAttempt(m, 'expedition', NOW, s, makeState());
  // Still ready: not resolved.
  assert.deepEqual(brain.resolvePending(makeState({ expedition: cd(true, 0, { points: 5 }) }), m, NOW + 1000), []);
  assert.ok(m.pending);
  const events = brain.resolvePending(makeState(), m, NOW + 2000);
  assert.equal(events.length, 1);
  assert.equal(m.pending, null);
  assert.equal(m.stats.expedition, 1);
});

test('resolvePending for heal ignores small regeneration', () => {
  const s = makeSettings();
  const m = memory();
  brain.beginAttempt(m, 'heal', NOW, s, makeState({ hp: { value: 100, max: 1000, percent: 10 } }));
  brain.resolvePending(makeState({ hp: { value: 105, max: 1000, percent: 10 } }), m, NOW + 1000);
  assert.ok(m.pending, 'regen alone is not a heal');
  brain.resolvePending(makeState({ hp: { value: 400, max: 1000, percent: 40 } }), m, NOW + 2000);
  assert.equal(m.pending, null);
  assert.equal(m.stats.heal, 1);
});

test('pickOpponents strategies', () => {
  const opps = [{ level: 30 }, { level: 12 }, { level: null }, { level: 50 }];
  assert.deepEqual(brain.pickOpponents(opps, 'lowest').map((o) => o.level), [12, 30, 50, null]);
  assert.deepEqual(brain.pickOpponents(opps, 'highest').map((o) => o.level), [50, 30, 12, null]);
  assert.equal(brain.pickOpponents(opps, 'random', () => 0).length, 4);
});

test('pickFood avoids overhealing', () => {
  const foods = [{ heal: 500 }, { heal: 120 }, { heal: 250 }];
  assert.equal(brain.pickFood(foods, 300).heal, 250);
  assert.equal(brain.pickFood(foods, 100).heal, 120);
  const unknown = [{ heal: 0 }, { heal: 0 }];
  assert.equal(brain.pickFood(unknown, 300), unknown[0]);
  assert.equal(brain.pickFood([], 100), null);
});

test('normalizeMemory repairs partial stored memory', () => {
  const m = brain.normalizeMemory({ stats: { expedition: 4 }, log: 'bad' }, NOW);
  assert.equal(m.stats.expedition, 4);
  assert.equal(m.stats.dungeon, 0);
  assert.deepEqual(m.log, []);
  assert.deepEqual(m.blockedUntil, {});
});

// ---------------------------------------------------------------- v2 options

test('priority order decides between several ready activities', () => {
  const state = makeState({ expedition: cd(true, 0, { points: 3 }), arena: cd(true) });
  const s = makeSettings({ arena: { enabled: true } });
  assert.equal(brain.decide(state, s, memory(), NOW).type, 'expedition');
  s.general = { order: ['arena', 'quests', 'expedition', 'dungeon', 'circus'] };
  assert.equal(brain.decide(state, s, memory(), NOW).type, 'arena');
});

test('keepPoints saves points for later', () => {
  const state = makeState({ expedition: cd(true, 0, { points: 3 }) });
  assert.equal(brain.decide(state, makeSettings({ expedition: { keepPoints: 3 } }), memory(), NOW).type, 'wait');
  assert.equal(brain.decide(state, makeSettings({ expedition: { keepPoints: 2 } }), memory(), NOW).type, 'expedition');
  // Work counts reserved points as "out of points".
  const s = makeSettings({ work: { enabled: true }, expedition: { keepPoints: 3 }, dungeon: { keepPoints: 5 } });
  assert.equal(brain.decide(state, s, memory(), NOW).type, 'work');
});

test('eating and fighting use separate HP thresholds', () => {
  const at = (percent) => makeState({ hp: { value: percent * 10, max: 1000, percent, regenPerHour: 600 }, expedition: cd(true, 0, { points: 3 }) });
  const s = makeSettings({ heal: { enabled: true, eatBelowPercent: 50, minHpPercent: 20 } });
  assert.equal(brain.decide(at(40), s, memory(), NOW).type, 'heal', 'eats below 50%');
  const noFood = memory();
  brain.markNoFood(noFood, NOW);
  assert.equal(brain.decide(at(40), s, noFood, NOW).type, 'expedition', 'still fights above 20% without food');
  assert.equal(brain.decide(at(10), s, noFood, NOW).type, 'wait', 'stops fighting below 20%');
  s.heal.enabled = false;
  assert.equal(brain.decide(at(40), s, memory(), NOW).type, 'expedition', 'eating disabled');
});

test('scheduleWindow handles same-day and overnight hours', () => {
  const at = (h, m) => new Date(2026, 0, 15, h, m, 0).getTime();
  const day = { activeHours: true, start: '08:00', end: '22:30' };
  assert.equal(brain.scheduleWindow(day, at(12, 0)).active, true);
  assert.equal(brain.scheduleWindow(day, at(22, 30)).active, false);
  const early = brain.scheduleWindow(day, at(6, 15));
  assert.equal(early.active, false);
  assert.equal(early.until, at(8, 0));
  assert.equal(brain.scheduleWindow(day, at(23, 0)).until, new Date(2026, 0, 16, 8, 0).getTime());

  const night = { activeHours: true, start: '22:00', end: '06:00' };
  assert.equal(brain.scheduleWindow(night, at(23, 30)).active, true);
  assert.equal(brain.scheduleWindow(night, at(3, 0)).active, true);
  assert.equal(brain.scheduleWindow(night, at(12, 0)).until, at(22, 0));
  assert.equal(brain.scheduleWindow({ ...night, activeHours: false }, at(12, 0)).active, true);
});

test('bot waits outside active hours', () => {
  const s = makeSettings({ schedule: { activeHours: true, start: '00:00', end: '00:01' } });
  const now = new Date(2026, 0, 15, 12, 0).getTime();
  const d = brain.decide(makeState({ expedition: cd(true, 0, { points: 3 }) }), s, memory(), now);
  assert.equal(d.type, 'wait');
  assert.equal(d.until, new Date(2026, 0, 16, 0, 0).getTime());
});

test('random breaks', () => {
  const schedule = { breaks: true, breakEvery: 60, breakLength: 10 };
  const m = memory();
  const half = () => 0.5; // jitter factor 1.0
  brain.updateBreaks(schedule, m, NOW, half);
  assert.equal(m.nextBreakAt, NOW + 60 * 60000);
  assert.equal(m.breakUntil, 0);
  brain.updateBreaks(schedule, m, NOW + 60 * 60000, half);
  assert.equal(m.breakUntil, NOW + 70 * 60000);
  assert.equal(m.nextBreakAt, NOW + 130 * 60000);
  const d = brain.decide(makeState({ expedition: cd(true, 0, { points: 3 }) }), makeSettings(), m, NOW + 61 * 60000);
  assert.equal(d.type, 'wait');
  assert.equal(d.until, m.breakUntil);
  brain.updateBreaks({ ...schedule, breaks: false }, m, NOW, half);
  assert.equal(m.breakUntil, 0);
});

test('filterOpponents applies ignore list and level range', () => {
  const opps = [
    { name: 'Maximus', level: 30 },
    { name: 'Spartacus', level: 50 },
    { name: 'Crixus', level: 12 },
    { name: 'Gannicus', level: 26 },
  ];
  const cfg = { ignorePlayers: 'maximus,\n  CRIXUS ', limitLevels: false, maxAbove: 5, maxBelow: 10 };
  assert.deepEqual(brain.filterOpponents(opps, cfg, 25).map((o) => o.name), ['Spartacus', 'Gannicus']);
  cfg.limitLevels = true;
  assert.deepEqual(brain.filterOpponents(opps, cfg, 25).map((o) => o.name), ['Gannicus']);
  cfg.ignorePlayers = '';
  assert.deepEqual(brain.filterOpponents(opps, cfg, 25).map((o) => o.name), ['Maximus', 'Gannicus']);
  assert.equal(brain.filterOpponents(opps, cfg, null).length, 4, 'unknown own level: no level filter');
});

test('activityStatus summarises every tile', () => {
  const m = memory();
  m.blockedUntil.arena = NOW + 60000;
  const s = makeSettings({ arena: { enabled: true }, quests: { enabled: true } });
  m.nextQuestCheck = NOW + 5000;
  const st = brain.activityStatus(
    makeState({ expedition: cd(true, 0, { points: 3, maxPoints: 24 }), dungeon: cd(true, 0, { points: 0, maxPoints: 12 }) }),
    s,
    m,
    NOW
  );
  assert.deepEqual(st.expedition, { enabled: true, points: '3/24', text: 'ready', ready: true });
  assert.equal(st.dungeon.text, 'no points');
  assert.equal(st.arena.text, 'paused');
  assert.equal(st.arena.until, NOW + 60000);
  assert.equal(st.circus.text, 'off');
  assert.equal(st.heal.text, '80%');
  assert.equal(st.work.text, 'off');
  assert.equal(st.quests.until, NOW + 5000);
});

test('wait decisions name what they wait for', () => {
  const d = brain.decide(makeState(), makeSettings(), memory(), NOW);
  assert.equal(d.next.label, 'Expedition');
  assert.ok(d.next.at > NOW);
});

test('chooseQuest picks the best-paying quest for my places and activities', () => {
  const s = makeSettings();
  // Offers as seen on s60-en.
  const offers = [
    { type: 'work', title: 'Work 2 hours', reward: 541 },
    { type: 'combat', title: 'Defeat 5 opponents at expeditions, in dungeons or in the arenas', reward: 1801 },
    { type: 'expedition', title: 'Cursed Village: Defeat 5 x Ancient', reward: 4176 },
    { type: 'expedition', title: 'The green forest: Defeat 4 opponents of your choice', reward: 4669 },
    { type: 'arena', title: 'Arena: Win 3 upgrade battles', reward: 2683 },
    { type: 'dungeon', title: 'Viking Camp: Defeat the boss in this dungeon', reward: 1081 },
  ];
  const pick = (settings, places) => brain.chooseQuest(offers, settings, places);
  assert.equal(pick(s, { location: 'Cursed Village' }).reward, 4176);
  assert.equal(pick(s, { location: 'Death Hill' }).type, 'combat', 'arena is off, other locations skipped');
  assert.equal(pick(s, {}).reward, 4669, 'unknown location: no filtering');
  assert.equal(pick({ ...s, quests: { ...s.quests, matchLocation: false } }, { location: 'Death Hill' }).reward, 4669);
  assert.equal(pick({ ...s, arena: { ...s.arena, enabled: true } }, { location: 'Death Hill' }).type, 'arena');
  assert.equal(pick({ ...s, quests: { ...s.quests, onlyActive: false } }, { location: 'Death Hill' }).type, 'arena');
  const dungeonOnly = offers.filter((o) => o.type === 'dungeon');
  assert.equal(brain.chooseQuest(dungeonOnly, s, { dungeon: 'Viking Camp' }).reward, 1081);
  assert.equal(brain.chooseQuest(dungeonOnly, s, { dungeon: 'Bandit Camp' }), null);
  const work = offers.slice(0, 1);
  assert.equal(brain.chooseQuest(work, s, {}), null, 'work quests are off by default');
  const withWork = { ...s, work: { ...s.work, enabled: true }, quests: { ...s.quests, types: { ...s.quests.types, work: true } } };
  assert.equal(brain.chooseQuest(work, withWork, {}).type, 'work');
});

test('failed quests are started again twice a day, then given up', () => {
  const s = makeSettings();
  const m = memory();
  const quest = { type: 'expedition', title: 'Cursed Village: Defeat 5 x Ancient' };
  const step = (q, now = NOW) => brain.failedQuestStep(q, s, { location: 'Cursed Village' }, m, now);
  assert.deepEqual(step(quest), { step: 'restart' });
  assert.deepEqual(step(quest), { step: 'restart' });
  assert.deepEqual(step(quest), { step: 'drop', why: 'failed 3 times today' });
  assert.deepEqual(step(quest, NOW + 24 * 3600 * 1000), { step: 'restart' }, 'a new day');
  assert.deepEqual(step({ type: 'arena', title: 'Arena: Win 3 attacks in succession' }), { step: 'drop', why: 'not one Lanista takes on' }, 'the arena is off');
  assert.deepEqual(step({ type: 'expedition', title: 'Death Hill: Defeat 3 x Harpy' }), { step: 'drop', why: 'not one Lanista takes on' }, 'another location');
});

test('combat reports are counted and losing opponents avoided', () => {
  const m = memory();
  m.pending = { type: 'arena', at: NOW, attempts: 1, opponent: 'Kaczuszek', avoidHours: 24 };
  const events = brain.resolvePending(makeState({ report: { win: false, gold: 0, xp: 2, renown: 51 } }), m, NOW + 1000);
  assert.match(events[0].message, /Arena vs Kaczuszek: lost/);
  assert.deepEqual(m.stats.results.arena, { won: 0, lost: 1 });
  assert.equal(m.stats.arena, 1);
  assert.deepEqual(brain.avoidedNames(m, 'arena', NOW + 2000), ['kaczuszek']);
  assert.deepEqual(brain.avoidedNames(m, 'arena', NOW + 25 * 3600 * 1000), [], 'expires');

  m.pending = { type: 'dungeon', at: NOW, attempts: 1 };
  const won = brain.resolvePending(makeState({ report: { win: true, gold: 1513, xp: 7, renown: 152 } }), m, NOW + 1000);
  assert.equal(won[0].message, 'Dungeon: won, +1,513 gold, +7 XP, +152 fame');
  assert.deepEqual(m.stats.loot, { gold: 1513, xp: 9, honour: 51, fame: 152 }, 'arena renown is honour, dungeon renown is fame');

  const opponents = [{ name: 'Kaczuszek', level: 82 }, { name: 'Orbyte', level: 87 }];
  assert.deepEqual(brain.filterOpponents(opponents, makeSettings().arena, 64, ['kaczuszek']).map((o) => o.name), ['Orbyte']);
});

test('opponents beaten before can go first, most wins first, for two weeks', () => {
  const m = memory();
  const win = (name, at) => {
    m.pending = { type: 'circus', at, attempts: 1, opponent: name, avoidHours: 24 };
    brain.resolvePending(makeState({ report: { win: true, gold: 0, xp: 1, renown: 10 } }), m, at + 1000);
  };
  win('Orbyte', NOW);
  win('Borbo', NOW);
  win('Borbo', NOW + 5000);
  assert.deepEqual(m.beaten.circus.borbo, { wins: 2, at: NOW + 6000 });

  const list = [{ name: 'Alba', level: 10 }, { name: 'Orbyte', level: 20 }, { name: 'Borbo', level: 30 }];
  assert.deepEqual(brain.preferBeaten(list, m.beaten.circus, NOW + 10000).map((o) => o.name), ['Borbo', 'Orbyte', 'Alba']);
  assert.deepEqual(brain.preferBeaten(list, m.beaten.circus, NOW + 15 * 24 * 3600 * 1000).map((o) => o.name), ['Alba', 'Orbyte', 'Borbo'], 'forgotten after two weeks');
  assert.deepEqual(m.beaten.circus, {});
});

test('enemy nest dialog is handled per the setting', () => {
  const st = makeState({ dialogs: { loginBonus: false, notification: false, nest: true } });
  const s = makeSettings();
  assert.deepEqual([brain.decide(st, s, memory(), NOW).type, brain.decide(st, s, memory(), NOW).mode], ['nest', 'quick']);
  s.general = { ...s.general, nestSearch: 'off' };
  assert.notEqual(brain.decide(st, s, memory(), NOW).type, 'nest');
  const m = memory();
  m.pending = { type: 'nest', at: NOW, attempts: 1 };
  brain.resolvePending(makeState(), m, NOW + 1000);
  assert.equal(m.stats.nest, 1);
});

test('training picks the cheapest selected stat and respects the gold reserve', () => {
  // Costs as seen on s60-en.
  const options = [
    { stat: 'strength', cost: 720346 },
    { stat: 'dexterity', cost: 853956 },
    { stat: 'agility', cost: 279549 },
    { stat: 'constitution', cost: 155283 },
    { stat: 'charisma', cost: 423859 },
    { stat: 'intelligence', cost: 445664 },
  ];
  const s = makeSettings({ training: { enabled: true } });
  assert.equal(brain.pickTraining(options, s.training.stats).stat, 'constitution');
  assert.equal(brain.pickTraining(options, { ...s.training.stats, constitution: false }).stat, 'agility');
  assert.equal(brain.pickTraining(options, {}), null);

  const m = memory();
  assert.equal(brain.decide(makeState({ gold: 1620290 }), s, m, NOW).type, 'training', 'unknown cost: go and look');
  m.trainCost = 155283;
  assert.equal(brain.decide(makeState({ gold: 200000 }), s, m, NOW).type, 'wait', 'would dip below the 100k reserve');
  assert.equal(brain.decide(makeState({ gold: 255283 }), s, m, NOW).type, 'training');
  assert.notEqual(brain.decide(makeState({ gold: 9e6 }), makeSettings(), m, NOW).type, 'training', 'off by default');

  m.trainCost = null;
  m.pending = { type: 'training', at: NOW, attempts: 1, goldBefore: 1620290, stat: 'constitution' };
  const ev = brain.resolvePending(makeState({ gold: 1465007 }), m, NOW + 1000);
  assert.equal(ev[0].message, 'Trained constitution for 155,283 gold');
  assert.equal(m.stats.training, 1);
  assert.equal(m.stats.goldSpent, 155283);
});

test('with the boss selected, earlier enemies with bonuses to learn go first', () => {
  const enemies = [{ learnable: 0 }, { learnable: 3 }, { learnable: 4 }, { learnable: 0 }];
  const cfg = { enemy: 4, bonusesFirst: true };
  assert.equal(brain.expeditionTarget(enemies, cfg), 1, 'Skeleton Berserker first');
  assert.equal(brain.expeditionTarget([{ learnable: 0 }, { learnable: 0 }, { learnable: 1 }, { learnable: 0 }], cfg), 2);
  assert.equal(brain.expeditionTarget([{ learnable: 0 }, { learnable: 0 }, { learnable: 0 }, { learnable: 0 }], cfg), 3, 'all learned: the boss');
  assert.equal(brain.expeditionTarget(enemies, { enemy: 4, bonusesFirst: false }), 3, 'option off');
  assert.equal(brain.expeditionTarget(enemies, { enemy: 2, bonusesFirst: true }), 1, 'only applies to the boss');
  assert.equal(brain.expeditionTarget([], cfg), 3, 'page not understood: keep the chosen enemy');
  assert.equal(makeSettings().expedition.bonusesFirst, false, 'off by default');
});

test('expedition: an easier enemy for an hour after losses in a row', () => {
  const m = memory();
  const fight = (win, enemy = 3, at = NOW) => {
    m.pending = { type: 'expedition', at, attempts: 1, enemy, loc: '7', easierAfter: 3 };
    return brain.resolvePending(makeState({ report: { win, gold: 0, xp: 1, renown: 0 } }), m, at + 1000).map((e) => e.message);
  };
  fight(false);
  fight(false);
  fight(true);
  assert.equal(brain.easierEnemy(m, '7', NOW), null, 'a win starts the count again');
  fight(false);
  fight(false, 2);
  fight(false);
  assert.equal(brain.easierEnemy(m, '7', NOW), null, 'losses against different enemies do not add up');
  fight(false);
  const events = fight(false);
  assert.ok(events.includes('Expedition: 3 lost fights in a row against enemy #4, fighting enemy #3 for an hour'), events.join(' / '));
  assert.equal(brain.easierEnemy(m, '7', NOW + 1000), 2);
  assert.equal(brain.easierEnemy(m, '8', NOW + 1000), null, 'only at that location');
  assert.equal(brain.easierEnemy(m, '7', NOW + 3601 * 1000), null, 'back to the chosen enemy after an hour');

  fight(false, 0);
  fight(false, 0);
  assert.ok(fight(false, 0).includes('Expedition: 3 lost fights in a row, and enemy #1 is already the easiest here'));
  const off = memory();
  for (let i = 0; i < 5; i++) {
    off.pending = { type: 'expedition', at: NOW, attempts: 1, enemy: 3, loc: '7', easierAfter: 0 };
    brain.resolvePending(makeState({ report: { win: false, gold: 0, xp: 1, renown: 0 } }), off, NOW + 1000);
  }
  assert.equal(off.easierEnemy, null, '0 = off');
  assert.equal(makeSettings().expedition.easierAfterLosses, 0, 'off by default');
});

test('statistics per day: today so far, finished days kept for 30 days', () => {
  const m = memory();
  const at = (d, h = 12) => new Date(2026, 9, d, h).getTime();
  brain.rollStatsDay(m, at(1, 9));
  m.stats.expedition += 3;
  m.stats.loot.gold += 1500;
  m.stats.results.expedition = { won: 2, lost: 1 };
  brain.rollStatsDay(m, at(1, 23));
  assert.deepEqual(brain.statsDays(m), [{ day: '2026-10-01', expedition: 3, loot: { gold: 1500 }, results: { expedition: { won: 2, lost: 1 } } }]);

  brain.rollStatsDay(m, at(2, 0));
  m.stats.arena += 1;
  m.stats.results.arena = { won: 1, lost: 0 };
  m.stats.goldNow = 999999;
  const days = brain.statsDays(m);
  assert.deepEqual(days.map((d) => d.day), ['2026-10-02', '2026-10-01']);
  assert.deepEqual(days[0], { day: '2026-10-02', arena: 1, results: { arena: { won: 1 } } }, 'only what changed today; gold on hand is not a counter');
  assert.equal(days[1].expedition, 3);

  // A day without a page load is skipped; the bot's next day starts fresh.
  brain.rollStatsDay(m, at(5));
  assert.deepEqual(m.history.map((d) => d.day), ['2026-10-02', '2026-10-01']);
  assert.deepEqual(brain.statsDays(m)[0], { day: '2026-10-05' });
  for (let d = 6; d < 45; d++) {
    m.stats.heal += 1;
    brain.rollStatsDay(m, new Date(2026, 9, d).getTime());
  }
  assert.equal(m.history.length, 30);
});

test('the local arena has no levels: weakest is the next rank up, strongest the best rank', () => {
  const local = [{ name: 'A', rank: 6, level: null }, { name: 'B', rank: 7, level: null }, { name: 'C', rank: 9, level: null }];
  assert.deepEqual(brain.pickOpponents(local, 'lowest').map((o) => o.name), ['C', 'B', 'A']);
  assert.deepEqual(brain.pickOpponents(local, 'highest').map((o) => o.name), ['A', 'B', 'C']);
  const s = makeSettings();
  assert.equal(brain.filterOpponents(local, { ...s.arena, limitLevels: true }, 110).length, 3, 'the level range does not apply');
  assert.equal(s.arena.where, 'provinciarum', 'Provinciarum by default');
});

test('arena limits: per player and per day, counted from the fights, reset at midnight', () => {
  const m = memory();
  const fight = (type, opponent, at = NOW) => {
    m.pending = { type, at, attempts: 1, opponent };
    brain.resolvePending(makeState({ report: { win: true, gold: 552, xp: 1, renown: 8 } }), m, at + 1000);
  };
  const cfg = { ...makeSettings().arena, perPlayerPerDay: 2, perDay: 3 };
  fight('arena', 'Akesak');
  fight('arena', 'akesak');
  assert.deepEqual(brain.cappedNames(m, 'arena', cfg, NOW), ['akesak'], 'twice today: left alone');
  assert.deepEqual(brain.cappedNames(m, 'circus', cfg, NOW), [], 'the circus counts separately');
  assert.deepEqual(brain.cappedNames(m, 'arena', { ...cfg, perPlayerPerDay: 0 }, NOW), [], '0 = no limit');

  const s = makeSettings({ expedition: { enabled: false }, arena: { enabled: true, perDay: 3 } });
  const ready = makeState({ expedition: cd(false, 600000, { points: 0 }), arena: cd(true) });
  assert.equal(brain.decide(ready, s, m, NOW).type, 'arena');
  fight('arena', 'Sargeras');
  assert.equal(brain.decide(ready, s, m, NOW).type, 'wait', '3 attacks today: no more');
  const tile = brain.activityStatus(ready, s, m, NOW).arena;
  assert.equal(tile.text, 'daily limit');
  assert.equal(new Date(tile.until).getHours(), 0, 'until midnight');

  const tomorrow = NOW + 24 * 3600 * 1000;
  assert.equal(brain.decide(ready, s, m, tomorrow).type, 'arena', 'a new day');
  assert.deepEqual(brain.cappedNames(m, 'arena', cfg, tomorrow), []);
  assert.equal(makeSettings().arena.perPlayerPerDay, 5);
  assert.equal(makeSettings().arena.perDay, 0);
});
