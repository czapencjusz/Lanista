'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { settings: S } = require('./load');

test('sanitizeSettings clamps numbers and rejects bad enums/patterns', () => {
  const out = S.sanitizeSettings({
    expedition: { enemy: 9, keepPoints: -3, location: 'nowhere' },
    dungeon: { difficulty: 'nightmare', location: ' 12 ' },
    heal: { eatBelowPercent: 150, minHpPercent: 33.6 },
    arena: { target: 'weakest', maxAbove: 5000 },
    schedule: { start: '25:00', end: '06:30' },
    timing: { minClickDelay: 4, maxClickDelay: 1, maxIdle: 5 },
    ui: { layout: 'sideways' },
  });
  assert.equal(out.expedition.enemy, 4);
  assert.equal(out.expedition.keepPoints, 0);
  assert.equal(out.expedition.location, 'auto');
  assert.equal(out.dungeon.difficulty, 'normal');
  assert.equal(out.dungeon.location, '12');
  assert.equal(out.heal.eatBelowPercent, 100);
  assert.equal(out.heal.minHpPercent, 34);
  assert.equal(out.arena.target, 'lowest');
  assert.equal(out.arena.maxAbove, 500);
  assert.equal(out.schedule.start, S.DEFAULT_SETTINGS.schedule.start);
  assert.equal(out.schedule.end, '06:30');
  assert.equal(out.timing.maxClickDelay, 4, 'max delay is never below min delay');
  assert.equal(out.timing.maxIdle, 30);
  assert.equal(out.ui.layout, 'floating');
});

test('sanitizeSettings repairs the priority order', () => {
  const out = S.sanitizeSettings({ general: { order: ['arena', 'bogus', 'arena', 'expedition'] } });
  assert.deepEqual(out.general.order, ['arena', 'expedition', 'quests', 'dungeon', 'circus']);
  assert.deepEqual(S.sanitizeSettings({ general: { order: 'nope' } }).general.order, S.ORDERABLE);
});

test('numeric strings from forms/imports are accepted', () => {
  const out = S.sanitizeSettings({ work: { hours: '4' }, expedition: { enemy: '2' } });
  assert.equal(out.work.hours, 4);
  assert.equal(out.expedition.enemy, 2);
});

test('v1 settings are migrated', () => {
  const v1 = { enabled: true, heal: { enabled: true, minHpPercent: 45, useFood: false } };
  const out = S.normalize(v1);
  assert.equal(out.version, 2);
  assert.equal(out.enabled, true);
  assert.equal(out.heal.enabled, false, 'useFood=false disables eating');
  assert.equal(out.heal.eatBelowPercent, 45);
  assert.equal(out.heal.minHpPercent, 45);
  assert.equal('useFood' in out.heal, false);
});

test('normalize of nothing gives the defaults', () => {
  assert.deepEqual(S.normalize(undefined), S.DEFAULT_SETTINGS);
});
