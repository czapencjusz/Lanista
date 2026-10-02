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

test('renders every tab under its group heading and starts on the Overview', () => {
  const { view, $ } = mount({ enabled: true, expedition: { enabled: true }, arena: { enabled: false } });
  const tabs = [...view.element.querySelectorAll('.gb-tab')].map((t) => t.dataset.tab);
  assert.deepEqual(tabs, GBot.ui.TABS.map((t) => t.id));
  const nav = [...view.element.querySelector('.gb-tabs').children].map((el) => (el.classList.contains('gb-tab-group') ? `# ${el.textContent}` : el.dataset.tab));
  assert.deepEqual(nav.slice(0, 5), ['overview', 'general', '# Fights', 'expedition', 'dungeon']);
  assert.deepEqual(nav.filter((n) => n.startsWith('#')), ['# Fights', '# Character', '# Items', '# Lanista']);
  assert.equal($('.gb-tab.active').dataset.tab, 'overview');
  assert.equal($('[data-path="enabled"]').checked, true);
  assert.equal($('[data-tab="heal"] .gb-dot').classList.contains('on'), true, 'Health shows whether eating is on');
  assert.equal($('[data-tab="expedition"] .gb-dot').classList.contains('on'), true);
  assert.equal($('[data-tab="arena"] .gb-dot').classList.contains('on'), false);
});

test('the Log tab has a "Report a problem" link to a new GitHub issue', () => {
  const { view, $ } = mount();
  view.showTab('log');
  const link = $('a.gb-report');
  assert.equal(link.textContent, 'Report a problem');
  assert.equal(link.getAttribute('target'), '_blank');
  const url = new URL(link.getAttribute('href'));
  assert.equal(url.origin + url.pathname, 'https://github.com/czapencjusz/gbot/issues/new');
  const body = url.searchParams.get('body');
  assert.match(body, /What happened\?/);
  assert.match(body, /Lanista/);
  assert.equal(url.searchParams.has('title'), false, 'nothing else is filled in');
  assert.equal(GBot.ui.reportLink({ iconOnly: true }).textContent, '', 'icon-only version for headers');
});

test('the report link takes the last log lines along when it is followed', () => {
  const t = new Date(2026, 9, 2, 17, 29, 30).getTime();
  const log = Array.from({ length: 40 }, (_, i) => ({ t: t + i * 1000, level: i === 39 ? 'warn' : 'info', message: `line ${i}` }));
  const { view, $ } = mount({}, { memory: { log, stats: null } });
  view.showTab('log');
  const link = $('a.gb-report');
  link.addEventListener('click', (e) => e.preventDefault());
  link.click();
  const body = new URL(link.getAttribute('href')).searchParams.get('body');
  assert.match(body, /\*\*Log\*\* \(the last lines; remove anything you would rather not share\)/);
  assert.match(body, /2026-10-02 17:30:09 warn  line 39\n```/);
  assert.ok(body.includes('line 10\n'), 'the last 30 lines');
  assert.ok(!body.includes('line 9\n'));

  const long = Array.from({ length: 30 }, (_, i) => ({ t, level: 'info', message: `${'x'.repeat(300)} ${i} sh=0123abcd&mod=overview` }));
  const url = GBot.ui.reportUrl(long);
  assert.ok(url.length <= 7000, 'older lines dropped to keep the link short enough for GitHub');
  const capped = new URL(url).searchParams.get('body');
  assert.ok(capped.includes(' 29 sh=…&mod=overview'), 'session codes are blanked');
  assert.ok(!capped.includes('0123abcd'));
  assert.ok(!capped.includes(' 0 sh='));
});

test('"Copy log" copies the shown lines, oldest first', async () => {
  const t = new Date(2026, 9, 2, 17, 29, 30).getTime();
  const log = [
    { t, level: 'info', message: 'Arena is ready' },
    { t: t + 1000, level: 'warn', message: 'Quests: giving up the failed quest' },
  ];
  const { view, $ } = mount({}, { memory: { log, stats: null } });
  view.showTab('log');
  let copied = null;
  Object.defineProperty(dom.window.navigator, 'clipboard', { value: { writeText: async (text) => (copied = text) }, configurable: true });
  const globalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  try {
    const button = [...view.element.querySelectorAll('button')].find((b) => b.textContent === 'Copy log');
    button.click();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(copied, '2026-10-02 17:29:30 info  Arena is ready\n2026-10-02 17:29:31 warn  Quests: giving up the failed quest');
    assert.equal($('.gb-copy-status').textContent, 'Copied 2 lines.');
  } finally {
    if (globalNavigator) Object.defineProperty(globalThis, 'navigator', globalNavigator);
  }
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
  const { view, saved, $ } = mount();
  view.showTab('general');
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

test('phone alerts: the address is saved as typed, and "Send a test" sends to it', async () => {
  const sent = [];
  const { view, saved, $, change } = mount({}, { onTestPush: async (url) => (sent.push(url), { ok: true }) });
  view.showTab('notifications');
  const input = $('[data-path="notifications.pushUrl"]');
  change(input, ' https://ntfy.sh/Lanista-Ab12 ');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(saved.at(-1).notifications.pushUrl, 'https://ntfy.sh/Lanista-Ab12');
  const button = [...view.element.querySelectorAll('button')].find((b) => b.textContent === 'Send a test');
  button.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(sent, ['https://ntfy.sh/Lanista-Ab12']);
  assert.match($('.gb-push-status').textContent, /^Sent\./);

  input.value = 'ntfy.sh/x';
  button.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(sent.length, 1, 'not sent without https://');
  assert.equal($('.gb-push-status').textContent, 'Enter an https:// address first.');
});

test('statistics: a row per day with fights, wins, gold in and out', () => {
  const t = Date.now();
  const today = GBot.brain.dayKey(t);
  const stats = { ...GBot.brain.createMemory(t).stats, expedition: 4, arena: 2, results: { expedition: { won: 3, lost: 1 }, arena: { won: 2, lost: 0 } }, loot: { gold: 10000, xp: 40, honour: 900, fame: 0 }, soldGold: 500, goldSpent: 1424 };
  const base = { ...GBot.brain.createMemory(t).stats, loot: { gold: 0, xp: 0, honour: 0, fame: 0 } };
  const memory = { stats, log: [], today: { day: today, base }, history: [{ day: '2026-09-28', dungeon: 5, results: { dungeon: { won: 5 } }, loot: { gold: 7000, fame: 300 } }] };
  const { view, $ } = mount({}, { memory });
  view.showTab('stats');
  const rows = [...view.element.querySelectorAll('.gb-days tbody tr')].map((r) => [...r.children].map((c) => c.textContent));
  const n = (v) => Number(v).toLocaleString();
  assert.deepEqual(rows[0], ['Today', '6', '83%', n(10500), '40', '900', '0', n(1424)]);
  assert.equal(rows[1][1], '5');
  assert.equal(rows[1][2], '100%');
  assert.equal(rows[1][3], n(7000));
  assert.ok($('.gb-card') && [...view.element.querySelectorAll('.gb-card-label')].some((l) => l.textContent === 'Food bought'));
});

test('the Overview: a switch and a line per feature, the name opens its tab', async () => {
  const memory = GBot.brain.createMemory(Date.now());
  memory.gameInfo.locations = [{ id: '7', name: 'Koman Mountain' }];
  const { view, saved, $, change } = mount(
    {
      enabled: false,
      expedition: { enabled: true, location: '7', enemy: 4, bonusesFirst: true, mobilisationsPerDay: 1 },
      dungeon: { enabled: true, difficulty: 'advanced', skipBoss: true },
      arena: { enabled: true, where: 'local', target: 'lowest' },
      heal: { bags: { b1: true, b2: false, b3: false, b4: false, b5: false, b6: false, b7: false, b8: false } },
      repair: { enabled: false },
      notifications: { pushUrl: 'https://ntfy.sh/x' },
    },
    { memory }
  );
  const card = (id) => $(`[data-card="${id}"]`);
  const sum = (id) => card(id).querySelector('.gb-overview-sum').textContent;
  assert.equal($('.gb-overview-state').textContent, 'Paused');
  assert.equal(sum('expedition'), 'Koman Mountain · the boss (bonuses first) · 1 Mobilisation a day');
  assert.equal(sum('dungeon'), 'the last visited dungeon · Advanced · skips the boss');
  assert.equal(sum('arena'), 'on this server · weakest first');
  assert.equal(sum('heal'), 'eats below 30% · stops fighting below 20% · bag I · plain food only');
  assert.equal(sum('notifications'), '4 kinds of alert on · desktop and phone');
  assert.ok(card('repair').classList.contains('off'));
  assert.equal(card('notifications').querySelector('input'), null, 'no switch where there is no single one');
  assert.deepEqual([...view.element.querySelectorAll('.gb-pane h3')].map((h3) => h3.textContent), ['Fights', 'Character', 'Items', 'Lanista']);

  change(card('repair').querySelector('input'), true);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(saved.at(-1).repair.enabled, true);
  assert.ok(!card('repair').classList.contains('off'));

  card('dungeon').querySelector('.gb-overview-open').click();
  assert.equal(view.getTab(), 'dungeon');
});
