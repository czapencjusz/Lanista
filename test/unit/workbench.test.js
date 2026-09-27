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
