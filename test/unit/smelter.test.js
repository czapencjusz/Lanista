'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { brain, settings: settingsModule } = require('./load');

const window = new JSDOM('<meta name="csrf-token" content="tok">', { url: 'https://s1-en.gladiatus.gameforge.com/game/index.php' }).window;
globalThis.DOMParser = window.DOMParser;
require('../../src/content/workbench.js');
const smelter = require('../../src/content/smelter.js');

const NOW = 1_700_000_000_000;
const CN = -306687977;
const ITEM_ID = 275696479;
const entry = { cn: CN, name: 'Táliths Sandals', basis: '8-1', w: 2, h: 2 };

// Page shapes from s60-en (2026-09), trimmed to what the bot reads.
const tip = (name) => JSON.stringify([[[name, 'lime']]]).replace(/"/g, '&quot;');
const packagesPage = (present) =>
  present
    ? `<div class="packageItem"><div data-container-number="${CN}"><div data-content-type="512" data-basis="8-1" data-measurement-x="2" data-measurement-y="2" data-tooltip="${tip('Táliths Sandals')}"></div></div></div>`
    : '<div id="packages_wrapper"></div>';
const bagLiteral = JSON.stringify([[], [], [], [], [], [], [], []]).replace(/"/g, '\\"');
const overviewPage = `<script>new BagLoader(jQuery('#inv'), jQuery('#inventory_nav'), JSON.parse('${bagLiteral}'));</script>`;
const smelteryPage = (slots) => `<script>var slotsData = ${JSON.stringify(slots)};\nvar x = 1;</script>`;
const RELOAD = 'document.location.href=document.location.href;';

// A mock game: answers the smelter's requests and records them.
function mockGame({ slots, present = true }) {
  const calls = [];
  let smelterSlots = slots;
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body || '';
    const q = u.searchParams;
    const detail = q.get('submod') === 'move' ? `from=${q.get('from')} to=${q.get('to')} at=${q.get('toX')},${q.get('toY')}` : body.replace(/&a=\d+&sh=abc$/, '');
    calls.push(`${q.get('mod')}/${q.get('submod') || ''} ${detail}`.trim());
    const reply = (text) => ({ ok: true, text: async () => text });
    if (u.pathname.endsWith('index.php')) {
      if (u.searchParams.get('mod') === 'packages') return reply(packagesPage(present));
      if (u.searchParams.get('mod') === 'overview') return reply(overviewPage);
      return reply(smelteryPage(smelterSlots));
    }
    const submod = u.searchParams.get('submod');
    if (submod === 'move') return reply(JSON.stringify({ to: { data: { itemId: ITEM_ID } } }));
    if (submod === 'getSmeltingPreview') return reply(JSON.stringify({ slots: [{ 'forge_slots.state': 'closed', formula: { rent: { 2: 902, 3: 1 }, duration: 3382 } }] }));
    if (submod === 'start') smelterSlots = smelterSlots.map((s, i) => (i === 0 ? { 'forge_slots.state': 'crafting', 'forge_slots.finishedIn': 3382 } : s));
    if (submod === 'storeSmelted' || submod === 'lootbox') smelterSlots = smelterSlots.map((s) => (s['forge_slots.state'] === 'finished-succeeded' ? { 'forge_slots.state': 'closed' } : s));
    return reply(RELOAD);
  };
  return { calls, fetch };
}

function context(gold = 1_000_000, queue = [entry]) {
  const memory = brain.createMemory(NOW);
  memory.smeltQueue = queue.slice();
  const logs = [];
  return {
    logs,
    ctx: {
      state: { sh: 'abc', gold },
      settings: settingsModule.sanitizeSettings({}),
      memory,
      log: (level, message) => logs.push(`${level}: ${message}`),
      humanDelay: async () => {},
      persist: async () => {},
      now: () => NOW,
    },
  };
}

async function withGame(game, fn) {
  const saved = { document: globalThis.document, location: globalThis.location, fetch: globalThis.fetch };
  Object.assign(globalThis, { document: window.document, location: window.location, fetch: game.fetch });
  try {
    return await fn();
  } finally {
    Object.assign(globalThis, saved);
  }
}

const closed = () => Array.from({ length: 6 }, () => ({ 'forge_slots.state': 'closed' }));

test('a ticked package goes to the bag, then into a smelter slot rented for gold', async () => {
  const game = mockGame({ slots: closed() });
  const { ctx, logs } = context();
  await withGame(game, () => GBot.actions.smelt(ctx));
  assert.deepEqual(game.calls, [
    'forge/smeltery',
    'packages/',
    'overview/',
    `inventory/move from=${CN} to=512 at=1,1`,
    `forge/getSmeltingPreview mod=forge&submod=getSmeltingPreview&mode=smelting&slot=0&iid=${ITEM_ID}&amount=1`,
    `forge/rent mod=forge&submod=rent&mode=smelting&slot=0&rent=2&item=${ITEM_ID}`,
    'forge/start mod=forge&submod=start&mode=smelting&slot=0',
    'forge/smeltery',
    'forge/smeltery',
  ]);
  assert.deepEqual(ctx.memory.smeltQueue, []);
  assert.equal(ctx.memory.stats.goldSpent, 902);
  assert.equal(ctx.memory.smeltNext, NOW + 3382 * 1000 + 5000, 'back when the smelt is done');
  assert.deepEqual(logs, ['info: Smelting Táliths Sandals (56:22, 902 gold)']);
});

test('finished smelts go to the Horreum (or a package) before new ones start', async () => {
  const slots = closed();
  slots[2] = { 'forge_slots.state': 'finished-succeeded', item: { name: 'Old axe' } };
  const game = mockGame({ slots });
  const { ctx, logs } = context(1_000_000, []);
  await withGame(game, () => GBot.actions.smelt(ctx));
  assert.ok(game.calls.includes('forge/storeSmelted mod=forge&submod=storeSmelted&mode=smelting&slot=2'));
  assert.equal(ctx.memory.stats.smelted, 1);
  assert.equal(ctx.memory.smeltNext, 0, 'nothing left to do');
  assert.deepEqual(logs, ['info: Smelted Old axe; resources stored in the Horreum']);

  const packaged = mockGame({ slots: slots.map((s) => ({ ...s })) });
  const second = context(1_000_000, []);
  second.ctx.settings = settingsModule.sanitizeSettings({ smelting: { storeIn: 'packages' } });
  await withGame(packaged, () => GBot.actions.smelt(second.ctx));
  assert.ok(packaged.calls.includes('forge/lootbox mod=forge&submod=lootbox&mode=smelting&slot=2'));
});

test('a package that is gone leaves the queue; without enough gold the item stays in the bag', async () => {
  const gone = mockGame({ slots: closed(), present: false });
  const first = context();
  await withGame(gone, () => GBot.actions.smelt(first.ctx));
  assert.deepEqual(first.ctx.memory.smeltQueue, []);
  assert.match(first.logs[0], /no longer in the packages/);
  assert.ok(!gone.calls.some((c) => c.startsWith('forge/rent')));

  const poor = mockGame({ slots: closed() });
  const second = context(500);
  await assert.rejects(withGame(poor, () => GBot.actions.smelt(second.ctx)), /Not enough gold to smelt Táliths Sandals \(902\); it stays in your bag/);
  assert.ok(!poor.calls.some((c) => c.startsWith('forge/rent')), 'never rented');
  assert.deepEqual(second.ctx.memory.smeltQueue, [], 'moved to the bag, so out of the queue');
  assert.equal(second.ctx.memory.smeltNext, NOW + 10 * 60 * 1000);
});

test('the bot looks at the smelter when something is due, and only with smelting on', () => {
  const crafting = (left) => ({ 'forge_slots.state': 'crafting', 'forge_slots.finishedIn': left });
  assert.equal(brain.nextSmeltCheck([crafting(100), crafting(50), { 'forge_slots.state': 'closed' }], 0, NOW), NOW + 55000);
  assert.equal(brain.nextSmeltCheck([crafting(100), { 'forge_slots.state': 'finished-succeeded' }], 0, NOW), NOW);
  assert.equal(brain.nextSmeltCheck([crafting(100), { 'forge_slots.state': 'closed' }], 2, NOW), NOW + 60000, 'free slot and a queue');
  assert.equal(brain.nextSmeltCheck(closed(), 0, NOW), 0);

  const st = { inGame: true, hp: { percent: 100 }, dialogs: {}, expedition: { available: true, ready: true, points: 5 }, dungeon: {}, arena: {}, circus: {}, gold: 0 };
  const on = settingsModule.sanitizeSettings({ enabled: true });
  const m = brain.createMemory(NOW);
  m.nextRepairCheck = NOW + 60000;
  m.smeltNext = NOW - 1;
  assert.equal(brain.decide(st, on, m, NOW).type, 'smelt');
  assert.equal(brain.decide(st, settingsModule.sanitizeSettings({ enabled: true, smelting: { enabled: false } }), m, NOW).type, 'expedition');
  m.smeltNext = NOW + 5000;
  const idle = { ...st, expedition: { available: true, ready: false, remainingMs: 600000, points: 5 } };
  const wait = brain.decide(idle, on, m, NOW);
  assert.deepEqual([wait.type, wait.next.label], ['wait', 'Smelting']);
});

test('only weapons, armour and jewellery can be ticked for smelting', () => {
  const doc = new JSDOM(`<div class="packageItem"><div data-container-number="${CN}"><div data-content-type="512" data-basis="8-1" data-measurement-x="2" data-measurement-y="2" data-tooltip="${tip('Táliths Sandals')}"></div></div></div>
    <div class="packageItem"><div data-container-number="-5"><div data-content-type="64" data-basis="7-6" data-tooltip="${tip('Health potion')}"></div></div></div>
    <div class="packageItem"><div data-container-number="-6"><div data-content-type="32768" data-basis="18-1" data-tooltip="${tip('Wood')}"></div></div></div>`).window.document;
  const items = Array.from(doc.querySelectorAll('.packageItem [data-content-type]'));
  assert.deepEqual(items.map(smelter.isSmeltable), [true, false, false]);
  assert.deepEqual(smelter.queueEntry(items[0]), entry);
});
