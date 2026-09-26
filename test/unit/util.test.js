'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { util, settings } = require('./load');

test('parseDuration handles h:mm:ss and mm:ss', () => {
  assert.equal(util.parseDuration('0:05:23'), 323000);
  assert.equal(util.parseDuration('1:00:00'), 3600000);
  assert.equal(util.parseDuration('Time left 12:03'), 723000);
  assert.equal(util.parseDuration('Go to expedition'), null);
  assert.equal(util.parseDuration(null), null);
});

test('parseNumber strips thousands separators', () => {
  assert.equal(util.parseNumber('12.345'), 12345);
  assert.equal(util.parseNumber(' 1,234,567 '), 1234567);
  assert.equal(util.parseNumber('85%'), 85);
  assert.equal(util.parseNumber('abc'), null);
  assert.equal(util.parseNumber(undefined), null);
});

test('formatDuration', () => {
  assert.equal(util.formatDuration(323000), '5:23');
  assert.equal(util.formatDuration(3723000), '1:02:03');
  assert.equal(util.formatDuration(-5), '0:00');
});

test('mergeSettings keeps defaults for missing or mistyped values', () => {
  const { DEFAULT_SETTINGS, mergeSettings } = settings;
  const merged = mergeSettings(DEFAULT_SETTINGS, {
    enabled: true,
    expedition: { enemy: 'three', location: 4, unknown: 1 },
    heal: { minHpPercent: NaN },
    bogus: { a: 1 },
  });
  assert.equal(merged.enabled, true);
  assert.equal(merged.expedition.enemy, DEFAULT_SETTINGS.expedition.enemy);
  assert.equal(merged.expedition.location, '4');
  assert.equal('unknown' in merged.expedition, false);
  assert.equal(merged.heal.minHpPercent, DEFAULT_SETTINGS.heal.minHpPercent);
  assert.equal('bogus' in merged, false);
  // Defaults are not mutated.
  assert.equal(DEFAULT_SETTINGS.enabled, false);
});
