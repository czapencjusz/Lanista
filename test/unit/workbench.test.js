'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { brain, settings: settingsModule } = require('./load');

// workbench.js parses fetched pages with DOMParser, as in the browser.
globalThis.DOMParser = new JSDOM('').window.DOMParser;
const workbench = require('../../src/content/workbench.js');

const NOW = 1_700_000_000_000;

test('conditioning is the second "a/b (p%)" tooltip line', () => {
  // Tooltip lines as on s60-en (2026-09).
  const lines = ['Kerrannas Leather sandals of harmony', 'Armour +340', 'Durability 244734/244734 (100%)', 'Conditioning 20081/61184 (33%)'];
  assert.deepEqual(brain.conditionOf(lines), { value: 20081, max: 61184, percent: 33 });
  assert.equal(brain.conditionOf(['Food', 'Heals 400']), null);
});

test('pickRepair takes the worst item below the threshold, skipping paused ones', () => {
  const items = [
    { id: 'a', condition: { percent: 80 } },
    { id: 'b', condition: { percent: 33 } },
    { id: 'c', condition: { percent: 40 } },
    { id: 'd', condition: null },
  ];
  assert.equal(brain.pickRepair(items, 50, {}, NOW).id, 'b');
  assert.equal(brain.pickRepair(items, 50, { b: NOW + 1000 }, NOW).id, 'c');
  assert.equal(brain.pickRepair(items, 30, {}, NOW), null);
});

test('freeSpot finds room for multi-cell items across bags', () => {
  const full = { bag: 512, cells: [{ x: 1, y: 1, w: 8, h: 5 }] };
  const bag = { bag: 513, cells: [{ x: 1, y: 1, w: 1, h: 1 }, { x: 2, y: 1, w: 1, h: 2 }, { x: 8, y: 4, w: 1, h: 1 }] };
  assert.deepEqual(brain.freeSpot([full, bag], 2, 2), { bag: 513, x: 3, y: 1 });
  assert.deepEqual(brain.freeSpot([full, bag], 1, 1), { bag: 513, x: 3, y: 1 });
  assert.equal(brain.freeSpot([full], 1, 1), null);
});

test('materialsAvailable counts only qualities up to the limit', () => {
  const needed = { 18024: { amount: 5 }, 18001: { amount: 0 } };
  assert.equal(brain.materialsAvailable(needed, { 24: { '-1': 11, 0: 207 } }, 1), 'full');
  assert.equal(brain.materialsAvailable(needed, { 24: { '-1': 2, 2: 50 } }, 1), 'partial', 'purple is above Neptun');
  assert.equal(brain.materialsAvailable(needed, { 24: { 2: 50 } }, 1), 'none');
  assert.equal(brain.materialsAvailable(needed, {}, 4), 'none');
});

test('repairs hold fights while gear is off, and run when due', () => {
  const s = settingsModule.sanitizeSettings({ enabled: true, repair: { enabled: true } });
  const st = { inGame: true, hp: { percent: 100 }, dialogs: {}, expedition: { available: true, ready: true, points: 5 }, dungeon: {}, arena: {}, circus: {}, gold: 0 };
  const m = brain.createMemory(NOW);
  assert.equal(brain.decide(st, s, m, NOW).type, 'repair', 'first check');
  m.nextRepairCheck = NOW + 60000;
  assert.equal(brain.decide(st, s, m, NOW).type, 'expedition');
  m.repair = { stage: 'repairing', name: 'Sandals', until: NOW + 15000 };
  const wait = brain.decide(st, s, m, NOW);
  assert.deepEqual([wait.type, wait.reason], ['wait', 'Repairing Sandals']);
  assert.equal(brain.decide(st, s, m, NOW + 16000).type, 'repair', 'collect when done');
  const off = settingsModule.sanitizeSettings({ enabled: true });
  assert.equal(brain.decide(st, off, m, NOW + 16000).type, 'repair', 'a started repair finishes even if switched off');
});

test('reads bags, doll, workbench slots and Horreum stock from game pages', () => {
  // Shapes copied from s60-en pages (2026-09), trimmed.
  const bagItem = (x, y, w, h) => `<div style="left:${(x - 1) * 32}px;top:${(y - 1) * 32}px" data-content-type="64" data-position-x="${x}" data-position-y="${y}" data-measurement-x="${w}" data-measurement-y="${h}"></div>`;
  const bags = [[bagItem(1, 1, 1, 1)], [bagItem(8, 4, 1, 1)], [], [], [], [], [], []];
  // The page embeds the JSON inside a single-quoted JS string literal.
  const literal = JSON.stringify(bags).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, "\\'");
  const overview = `<script>new BagLoader(\n jQuery('#inv'),\n jQuery('#inventory_nav'),\n JSON.parse('${literal}'));</script>`;
  const parsed = workbench.readBags(overview);
  assert.equal(parsed.length, 8);
  assert.deepEqual(parsed[0], { bag: 512, cells: [{ x: 1, y: 1, w: 1, h: 1 }] });
  assert.deepEqual(parsed[1], { bag: 513, cells: [{ x: 8, y: 4, w: 1, h: 1 }] });

  const tooltip = JSON.stringify([[['Kerrannas Leather sandals of harmony', '#E303E0'], ['Durability 244734/244734 (100%)', '#DDD'], ['Conditioning 20081/61184 (33%)', '#DDD']]]).replace(/"/g, '&quot;');
  const doc = new JSDOM(`<div id="char"><div data-container-number="10" class="ui-droppable">
      <div data-container-number="10" data-content-type="512" data-item-id="257564915" data-basis="8-2" data-measurement-x="2" data-measurement-y="2" data-tooltip="${tooltip}"></div>
    </div></div>`).window.document;
  assert.deepEqual(workbench.readDoll(doc), [
    { slot: 10, id: '257564915', name: 'Kerrannas Leather sandals of harmony', basis: '8-2', w: 2, h: 2, condition: { value: 20081, max: 61184, percent: 33 } },
  ]);

  const slots = workbench.readSlots('<script>var slotsData = [{"forge_slots.state":"closed"},{"forge_slots.state":"crafting","forge_slots.finishedIn":14}];\nvar x = 1;</script>');
  assert.equal(slots[1]['forge_slots.finishedIn'], 14);

  const stockDoc = new JSDOM(`<input id="remove-resource-amount" data-max='{"24":{"-1":11,"0":207,"1":54}}'>`).window.document;
  assert.deepEqual(workbench.readStock(stockDoc), { 24: { '-1': 11, 0: 207, 1: 54 } });
});

test('"Repair all" runs even while the bot is paused, and only then', () => {
  const st = { inGame: true, hp: { percent: 100 }, dialogs: {}, expedition: { available: true, ready: true, points: 5 }, dungeon: {}, arena: {}, circus: {}, gold: 0 };
  const paused = settingsModule.sanitizeSettings({ enabled: false });
  const m = brain.createMemory(NOW);
  assert.equal(brain.decide(st, paused, m, NOW).type, 'idle');
  m.repairAll = { done: [], skipped: [], repaired: 0, failures: 0 };
  assert.deepEqual([brain.decide(st, paused, m, NOW).type, brain.decide(st, paused, m, NOW).reason], ['repair', 'Repair all gear']);
  m.repair = { stage: 'repairing', name: 'Sandals', until: NOW + 15000 };
  assert.equal(brain.decide(st, paused, m, NOW).type, 'wait', 'paused, but the item is on the workbench');
  assert.equal(brain.decide({ ...st, inGame: false }, paused, m, NOW).type, 'idle');

  const running = settingsModule.sanitizeSettings({ enabled: true });
  m.repair = null;
  m.nextRepairCheck = NOW + 60000;
  assert.equal(brain.decide(st, running, m, NOW).type, 'repair', 'before fights, even with automatic repair off');
  m.repairAll = null;
  assert.equal(brain.decide(st, running, m, NOW).type, 'expedition');
});

test('"Repair all" skips items above its cutoff (60% by default, changeable)', () => {
  const s = settingsModule.sanitizeSettings({});
  assert.equal(s.repair.allUpToPercent, 60);
  const item = (percent) => ({ condition: { percent } });
  assert.equal(brain.inRepairAll(item(60), s), true, 'at the cutoff is repaired');
  assert.equal(brain.inRepairAll(item(61), s), false);
  assert.equal(brain.inRepairAll({ condition: null }, s), false);
  const custom = settingsModule.sanitizeSettings({ repair: { allUpToPercent: 90 } });
  assert.equal(brain.inRepairAll(item(84), custom), true);
  assert.equal(settingsModule.sanitizeSettings({ repair: { allUpToPercent: 100 } }).repair.allUpToPercent, 99, 'full items are never repaired');
});

test('"Store all resources" sends only the packages to the Horreum and counts what arrived', async () => {
  // Request shape of the Horreum's own form (forgeStorage.js, s60-en 2026-09).
  const page = new JSDOM('<meta name="csrf-token" content="tok">', { url: 'https://s1-en.gladiatus.gameforge.com/game/index.php' }).window;
  const saved = { document: globalThis.document, location: globalThis.location, fetch: globalThis.fetch };
  const calls = [];
  Object.assign(globalThis, {
    document: page.document,
    location: page.location,
    fetch: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('submod=storageIn')) {
        return { ok: true, text: async () => JSON.stringify({ amounts: { 24: { '-1': 16, 0: 207 }, 3: { 0: 320 } } }) };
      }
      return { ok: true, text: async () => `<input id="remove-resource-amount" data-max='{"24":{"-1":11,"0":207},"3":{"0":314}}'>` };
    },
  });
  try {
    assert.equal(workbench.stockTotal({ 24: { '-1': 11, 0: 207 }, 3: { 0: 314 } }), 532);
    assert.equal(await workbench.storePackagedResources('abc'), 11, '5 aquamarine + 6 leather');
    const store = calls.find((c) => c.url.includes('submod=storageIn'));
    assert.equal(store.init.method, 'POST');
    assert.match(store.init.body, /^inventory=0&packages=1&sell=1&a=\d+&sh=abc$/);
    assert.equal(store.init.headers['X-CSRF-Token'], 'tok');
  } finally {
    Object.assign(globalThis, saved);
  }
});
