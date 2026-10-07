'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { brain, settings: S } = require('./load');

const window = new JSDOM('<meta name="csrf-token" content="tok">', { url: 'https://s303-en.gladiatus.gameforge.com/game/index.php' }).window;
globalThis.DOMParser = window.DOMParser;
require('../../src/content/workbench.js');
require('../../src/content/smelter.js');
const packages = require('../../src/content/packages.js');

const NOW = 1_700_000_000_000;
const DAY = 24 * 3600 * 1000;

// Page shapes from s303-en (2026-09), trimmed to what the bot reads. The
// game leaves data-quality out for Ceres (green) items.
const tip = (name) => JSON.stringify([[[name, 'white']]]).replace(/"/g, '&quot;');
const pkg = ({ cn, name, type, quality, colour = '', w = 1, h = 1, price = 100, amount = 1, left = 6 * DAY }) =>
  `<div class="packageItem"><input type="checkbox"><div class="sender ellipsis">Dungeon</div>` +
  `<div data-no-combine="true" data-container-number="${cn}"><div class="item-i-2-11 ${colour}" data-content-type="${type}"` +
  `${quality === undefined ? '' : ` data-quality="${quality}"`} data-price-gold="${price}" data-amount="${amount}" data-level="110"` +
  ` data-measurement-x="${w}" data-measurement-y="${h}" data-tooltip="${tip(name)}"></div></div>` +
  `<div><span class="ticker" data-ticker-time-left="${left}" data-ticker-type="countdown"></span></div></div>`;
const packagesPage = (items) =>
  `<h2 class="section-header">Content</h2><section><div id="packages">${items.map(pkg).join('')}</div></section><div class="pagination"></div>`;

const SHIELD = { cn: -1, name: 'Sugos Viking Shield', type: 4, quality: 1, colour: 'item-i-blue', w: 2, h: 2, price: 18721 };
const BOOTS = { cn: -2, name: 'Stoybaers Hunting boots', type: 512, colour: 'item-i-green', w: 2, h: 2, price: 13566 };
const BONES = { cn: -3, name: 'Bone Splinter', type: 32768, quality: -1, colour: 'item-i-white', price: 36, amount: 3 };
const RING = { cn: -4, name: 'Marcus Blue ring', type: 48, quality: 1, colour: 'item-i-blue', price: 25889 };
const SWORD = { cn: -5, name: 'Rusty sword', type: 2, quality: -1, colour: 'item-i-white', w: 1, h: 3, price: 900 };
const BREAD = { cn: -6, name: 'Bread', type: 64, price: 20, left: 3 * 3600 * 1000 };
const GOLD = { cn: -7, name: '5.000 Gold', type: 0, price: 0, amount: 5000 };

// A mock game: packages, bags, merchants and the Horreum, recording the
// requests the bot sends. Selling moves an item from a bag into a shop grid.
function mockGame({ items, gold = [], bagsFull = false, firstShopFull = true }) {
  const calls = [];
  const state = { items: items.slice(), gold: gold.slice(), money: 100000, bag: new Map() };
  const fullGrid = '<div data-content-type="2" data-position-x="1" data-position-y="1" data-measurement-x="6" data-measurement-y="8"></div>';
  const bagCells = bagsFull ? '<div data-content-type="2" data-position-x="1" data-position-y="1" data-measurement-x="8" data-measurement-y="5"></div>' : '';
  const bagLiteral = () => JSON.stringify(Array.from({ length: 8 }, () => (bagCells ? [bagCells] : []))).replace(/"/g, '\\"');
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const q = u.searchParams;
    const mod = q.get('mod');
    const reply = (text) => ({ ok: true, text: async () => text });
    if (u.pathname.endsWith('index.php')) {
      if (mod === 'packages') {
        calls.push(`packages f=${q.get('f')}`);
        return reply(packagesPage(q.get('f') === '14' ? state.gold : state.items));
      }
      if (mod === 'overview') {
        calls.push('overview');
        return reply(`<div id="sstat_gold_val">${state.money.toLocaleString('de-DE')}</div><script>new BagLoader(jQuery('#inv'), jQuery('#inventory_nav'), JSON.parse('${bagLiteral()}'));</script>`);
      }
      if (mod === 'inventory') {
        const sub = Number(q.get('sub'));
        const subsub = Number(q.get('subsub'));
        calls.push(`merchant ${sub}/${subsub}`);
        const full = firstShopFull && sub === 1 && subsub === 0;
        return reply(`<div class="background_trader"><div id="shop" style="width:192px;height:256px;" data-container-number="${256 + sub * 16 + subsub}">${full ? fullGrid : ''}</div></div>`);
      }
      if (mod === 'forge') return reply('<input id="remove-resource-amount" data-max="{}">');
    }
    const submod = q.get('submod');
    if (submod === 'move') {
      const from = Number(q.get('from'));
      const to = Number(q.get('to'));
      calls.push(`move ${from} -> ${to} at ${q.get('toX')},${q.get('toY')} x${q.get('amount')}`);
      if (from < 0) {
        const item = [...state.items, ...state.gold].find((i) => i.cn === from);
        state.items = state.items.filter((i) => i.cn !== from);
        state.gold = state.gold.filter((i) => i.cn !== from);
        if (item.name.endsWith('Gold')) state.money += item.amount;
        else state.bag.set(`${to}:${q.get('toX')},${q.get('toY')}`, item);
      } else {
        const key = `${from}:${q.get('fromX')},${q.get('fromY')}`;
        const item = state.bag.get(key);
        state.bag.delete(key);
        state.money += item.price * (item.amount || 1);
      }
      // As the game: the moved item with its new id.
      return reply(JSON.stringify({ to: { data: { itemId: 9000 - from } } }));
    }
    if (submod === 'storageIn') {
      calls.push(`horreum ${init.body.replace(/&a=\d+&sh=abc$/, '')}`);
      state.items = state.items.filter((i) => i.type !== 32768);
      return reply(JSON.stringify({ amounts: { 1: { '-1': 3 } } }));
    }
    throw new Error(`unexpected request ${url}`);
  };
  return { calls, fetch, state };
}

function context(overrides = {}) {
  const memory = brain.createMemory(NOW);
  const logs = [];
  return {
    logs,
    ctx: {
      state: { sh: 'abc', gold: 100000 },
      settings: S.sanitizeSettings(overrides),
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

test('reads packages: quality (missing = green), kind, size, value and expiry', () => {
  const doc = new JSDOM(packagesPage([SHIELD, BOOTS, BONES])).window.document;
  const items = packages.readPackageItems(doc).map(({ el, ...rest }) => rest);
  assert.deepEqual(items[0], { cn: -1, name: 'Sugos Viking Shield', type: 4, quality: 1, level: 110, basis: null, bound: false, amount: 1, value: 18721, w: 2, h: 2, expiresInMs: 6 * DAY });
  assert.equal(items[1].quality, 0, 'no data-quality: Ceres (green)');
  assert.equal(items[2].quality, -1);
  assert.equal(items[2].value, 108, 'value of the whole stack');
  assert.equal(brain.gearKind(4), 'armour');
  assert.equal(brain.gearKind(48), 'jewellery');
  assert.equal(brain.gearKind(2), 'weapons');
  assert.equal(brain.gearKind(32768), null);
});

test('package rules: smelting first, then selling, then packages about to expire', () => {
  const rules = S.sanitizeSettings({
    smelting: { enabled: true, auto: true, autoUpTo: 1, autoTypes: { weapons: false, armour: true, jewellery: false } },
    packages: { enabled: true, sell: true, sellUpTo: 0, expiring: 'bag', expiringHours: 24 },
  });
  const act = (item) => brain.packageAction({ expiresInMs: 6 * DAY, ...item }, rules);
  assert.equal(act({ type: 4, quality: 1 }), 'smelt', 'blue shield: armour up to blue is smelted');
  assert.equal(act({ type: 4, quality: 2 }), null, 'purple is kept');
  assert.equal(act({ type: 2, quality: 0 }), 'sell', 'green weapon: not smelted, sold');
  assert.equal(act({ type: 2, quality: 1 }), null, 'blue weapon is kept');
  assert.equal(act({ type: 48, quality: 1 }), null);
  assert.equal(act({ type: 4, quality: 0, queued: true }), null, 'ticked items are the smelter\'s');
  assert.equal(act({ type: 64, quality: 0, expiresInMs: 3 * 3600 * 1000 }), 'bag', 'food about to expire goes to the bags');
  assert.equal(act({ type: 64, quality: 0 }), null);

  const off = S.sanitizeSettings({ smelting: { auto: true, autoUpTo: 4 }, packages: { enabled: false, sell: true, sellUpTo: 4 } });
  assert.equal(brain.packageAction({ type: 2, quality: 0 }, off), 'smelt', 'smelting rules work without the Packages tab');
  assert.equal(brain.packageAction({ type: 64, quality: 0, expiresInMs: 1 }, off), null, 'selling and expiry need the Packages tab');
  assert.equal(brain.packageAction({ type: 2, quality: 0 }, S.sanitizeSettings({})), null, 'everything is off by default');
});

test('a run takes gold out, stores resources, queues, sells and rescues packages', async () => {
  const game = mockGame({ items: [SHIELD, BOOTS, BONES, RING, SWORD, BREAD], gold: [GOLD] });
  const { ctx, logs } = context({
    enabled: true,
    smelting: { enabled: true, auto: true, autoUpTo: 1, autoTypes: { weapons: false, armour: true, jewellery: false } },
    packages: { enabled: true, collectGold: true, storeResources: true, sell: true, sellUpTo: 0, sellTypes: { weapons: true }, expiring: 'bag' },
  });
  await withGame(game, () => GBot.actions.packages(ctx));

  assert.deepEqual(game.calls, [
    'packages f=14',
    'overview',
    'overview',
    'move -7 -> 512 at 1,1 x5000',
    'overview',
    'packages f=0',
    'horreum inventory=0&packages=1&sell=1',
    'merchant 1/0',
    'merchant 1/1',
    'overview',
    'move -5 -> 512 at 1,1 x1',
    'move 512 -> 273 at 1,1 x1',
    'overview',
    'move -6 -> 512 at 1,1 x1',
  ]);
  assert.deepEqual(ctx.memory.smeltQueue.map((q) => q.name), ['Sugos Viking Shield', 'Stoybaers Hunting boots'], 'armour up to blue queued');
  assert.equal(ctx.memory.smeltNext, NOW);
  assert.equal(ctx.memory.stats.sold, 1);
  assert.equal(ctx.memory.stats.soldGold, 900);
  assert.equal(ctx.memory.stats.goldCollected, 5000);
  assert.equal(ctx.memory.shopIndex, 1, 'next time starts at the merchant with room');
  assert.equal(ctx.memory.nextPackagesCheck, NOW + 30 * 60 * 1000);
  assert.deepEqual(game.state.items.map((i) => i.name), ['Sugos Viking Shield', 'Stoybaers Hunting boots', 'Marcus Blue ring'], 'the blue ring stays');
  assert.deepEqual(logs, [
    'info: Took 5,000 gold out of 1 gold package',
    'info: Stored 3 resources from the packages in the Horreum',
    'info: Sold Rusty sword for 900 gold',
    'info: Moved Bread into your bags; its package was about to expire',
    'info: Queued 2 items from the packages for smelting',
  ]);
});

test('a package about to expire is rescued outside the food bags, never into one', async () => {
  const game = mockGame({ items: [BREAD] });
  const { ctx, logs } = context({ enabled: true, heal: { bags: { b1: true, b2: false, b3: false, b4: false, b5: false, b6: false, b7: false, b8: false } }, packages: { enabled: true, expiring: 'bag' } });
  await withGame(game, () => GBot.actions.packages(ctx));
  assert.ok(game.calls.includes('move -6 -> 513 at 1,1 x1'), 'bag II, not the food bag I');
  assert.deepEqual(logs, ['info: Moved Bread into your bags; its package was about to expire']);
});

test('with full bags nothing is sold or moved, and the bot tries again later', async () => {
  const game = mockGame({ items: [SWORD, BREAD], bagsFull: true });
  const { ctx, logs } = context({ enabled: true, packages: { enabled: true, sell: true, sellUpTo: 0, expiring: 'sell' } });
  await withGame(game, () => GBot.actions.packages(ctx));
  assert.ok(!game.calls.some((c) => c.startsWith('move')), 'nothing moved');
  assert.deepEqual(game.state.items.map((i) => i.name), ['Rusty sword', 'Bread']);
  assert.deepEqual(logs, ['warn: Packages: No room in the bags for a 1x3 item; trying again later']);
  assert.equal(ctx.memory.nextPackagesCheck, NOW + 30 * 60 * 1000);
});

test('the bot goes through the packages when due, only with a rule on', () => {
  const st = { inGame: true, hp: { percent: 100 }, dialogs: {}, expedition: { available: true, ready: true, points: 5 }, dungeon: {}, arena: {}, circus: {}, gold: 0 };
  const m = brain.createMemory(NOW);
  m.nextRepairCheck = NOW + 60000;
  const on = S.sanitizeSettings({ enabled: true, packages: { enabled: true } });
  assert.equal(brain.decide(st, on, m, NOW).type, 'packages');
  assert.equal(brain.decide(st, S.sanitizeSettings({ enabled: true }), m, NOW).type, 'expedition', 'off by default');
  assert.equal(brain.decide(st, S.sanitizeSettings({ enabled: true, smelting: { auto: true } }), m, NOW).type, 'packages', 'smelting rules alone');
  m.nextPackagesCheck = NOW + 60000;
  assert.equal(brain.decide(st, on, m, NOW).type, 'expedition');
});
