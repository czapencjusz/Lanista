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
