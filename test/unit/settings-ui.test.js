'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

// The UI modules use the global document, like they do in the browser.
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test/' });
global.window = dom.window;
global.document = dom.window.document;
global.Event = dom.window.Event;

const GBot = require('./load');
require('../../src/ui/dom.js');
require('../../src/ui/styles.js');
require('../../src/ui/schema.js');
require('../../src/ui/settings-ui.js');

const S = GBot.settings;

function mount(overrides = {}, extra = {}) {
  const saved = [];
  const view = GBot.ui.createSettingsUI({
    settings: S.sanitizeSettings(overrides),
    memory: null,
    onChange: async (s) => {
      saved.push(s);
      return s;
    },
    ...extra,
  });
  document.body.replaceChildren(view.element);
  const $ = (sel) => view.element.querySelector(sel);
  const change = (el, value) => {
    if (el.type === 'checkbox') el.checked = value;
    else el.value = value;
    el.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  };
  return { view, saved, $, change };
}

test('renders every tab and starts on General', () => {
  const { view, $ } = mount({ enabled: true, expedition: { enabled: true }, arena: { enabled: false } });
  const tabs = [...view.element.querySelectorAll('.gb-tab')].map((t) => t.dataset.tab);
  assert.deepEqual(tabs, GBot.ui.TABS.map((t) => t.id));
  assert.equal($('.gb-tab.active').dataset.tab, 'general');
  assert.equal($('[data-path="enabled"]').checked, true);
  assert.equal($('[data-tab="expedition"] .gb-dot').classList.contains('on'), true);
  assert.equal($('[data-tab="arena"] .gb-dot').classList.contains('on'), false);
});

test('number fields are clamped before saving', async () => {
  const { view, saved, $, change } = mount();
  view.showTab('heal');
  change($('[data-path="heal.eatBelowPercent"]'), '150');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(saved.at(-1).heal.eatBelowPercent, 100);
  assert.equal($('[data-path="heal.eatBelowPercent"]').value, '100');
});

test('dependent fields are disabled until their switch is on', async () => {
  const { view, $, change } = mount();
  view.showTab('arena');
  assert.equal($('[data-path="arena.maxAbove"]').disabled, true);
  assert.ok($('[data-field="arena.maxAbove"]').classList.contains('disabled'));
  change($('[data-path="arena.limitLevels"]'), true);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal($('[data-path="arena.maxAbove"]').disabled, false);
});

test('job number is shown 1-based and saved 0-based', async () => {
  const { view, saved, $, change } = mount({ work: { job: 0 } });
  view.showTab('work');
  assert.equal($('[data-path="work.job"]').value, '1');
  change($('[data-path="work.job"]'), '3');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(saved.at(-1).work.job, 2);
});

test('priority list moves items', async () => {
  const { saved, $ } = mount();
  $('[data-item="expedition"] button[title="Move Expedition up"]').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(saved.at(-1).general.order.slice(0, 2), ['expedition', 'quests']);
  assert.equal($('.gb-order li').dataset.item, 'expedition');
});

test('location select lists known locations and accepts custom ids', async () => {
  const memory = GBot.brain.createMemory(Date.now());
  memory.gameInfo.locations = [{ id: '1', name: 'Grimwood' }, { id: '2', name: 'Pirate Harbour' }];
  const { view, saved, $, change } = mount({ dungeon: { location: '2' } }, { memory });
  view.showTab('dungeon');
  const select = $('[data-path="dungeon.location"]');
  assert.deepEqual([...select.options].map((o) => o.value), ['auto', '1', '2', 'custom']);
  assert.equal(select.value, '2');
  change(select, 'custom');
  const custom = $('[data-path="dungeon.location#custom"]');
  assert.equal(custom.hidden, false);
  change(custom, '14');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(saved.at(-1).dungeon.location, '14');
});

test('external updates do not overwrite the field being edited', () => {
  const { view, $ } = mount();
  view.showTab('work');
  const hours = $('[data-path="work.hours"]');
  hours.focus();
  hours.value = '7';
  view.update({ settings: S.sanitizeSettings({ work: { hours: 3 } }) });
  assert.equal(hours.value, '7');
  hours.blur();
  view.update({ settings: S.sanitizeSettings({ work: { hours: 3 } }) });
  assert.equal(hours.value, '3');
});

test('log and statistics tabs render memory', () => {
  const memory = GBot.brain.createMemory(Date.now() - 3600000);
  memory.stats.expedition = 12;
  memory.log.push({ t: Date.now(), level: 'warn', message: 'arena: attack refused' });
  const { view, $ } = mount({}, { memory });
  view.showTab('stats');
  assert.equal($('.gb-card-value').textContent, '12');
  view.showTab('log');
  assert.match($('.gb-log-line.warn').textContent, /attack refused/);
});

test('Premium tab shows the free tier and refuses a bad key', async () => {
  const T = GBot.tier;
  const now = Date.now();
  const tier = await T.status({ usage: { day: T.dayOf(now), ms: 30 * 60000 } }, now);
  const { view, $ } = mount({}, { tier });
  view.showTab('premium');
  assert.equal($('.gb-plan-name').textContent, 'Free');
  assert.match($('.gb-plan-text').textContent, new RegExp(T.allowanceText()));
  assert.match($('.gb-plan-usage').textContent, /Used today: 30 min/);
  const input = $('textarea[aria-label="Premium key"]');
  input.value = 'not a key';
  [...view.element.querySelectorAll('.gb-btn')].find((b) => b.textContent === 'Activate').click();
  await new Promise((r) => setTimeout(r, 10));
  assert.match($('.gb-import-status').textContent, /not a Lanista Premium key/);
  assert.equal($('.gb-import-status').classList.contains('error'), true);

  view.update({ tier: { ...tier, usedMs: tier.limitMs, leftMs: 0, exhausted: true } });
  assert.match($('.gb-plan-usage').textContent, /Used up for today/);
  assert.equal($('.gb-plan').classList.contains('out'), true);
});

test('Premium tab shows who the key belongs to', () => {
  const tier = { premium: true, license: { id: 'a', to: 'Marcus', issued: 0, expires: null }, keyError: null, usedMs: 3 * 3600000, limitMs: null, leftMs: null, exhausted: false, resetsAt: 0 };
  const { view, $ } = mount({}, { tier });
  view.showTab('premium');
  assert.equal($('.gb-plan-name').textContent, 'Premium');
  assert.match($('.gb-plan-text').textContent, /Licensed to Marcus\. Never expires\./);
  assert.equal($('textarea[aria-label="Premium key"]').closest('div').hidden, true);
});
