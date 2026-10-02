'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { brain, settings: S } = require('./load');

const window = new JSDOM('<meta name="csrf-token" content="tok">', { url: 'https://s303-en.gladiatus.gameforge.com/game/index.php' }).window;
globalThis.DOMParser = window.DOMParser;
require('../../src/content/actions.js');
require('../../src/content/workbench.js');
const auction = require('../../src/content/auction.js');
const { foodHealAmount, isPlainFood, edible } = GBot.actions._internal;

// Tooltips of usables in the bags on s303-en (2026-09).
const TIPS = {
  bread: ['Quintus Bread rolls of Martial Arts', 'Using: Heals 4635 of life', 'From intelligence: +2325 vitality point(s)', 'Combined with: Steak, Bananas, Cheese, Fish', 'Max. level of the item: 110'],
  rubyEgg: ['Belesarius Egg (red) of Martial Arts', 'Soul bound to: DaddyCzapo', 'Using: Heals 4020 of life', 'From intelligence: +2325 vitality point(s)', 'Using: You will receive 1 Ruby (Rubies).'],
  cervisia: ['Vergilius Cervisia of honor', 'Soul bound to: DaddyCzapo', 'Using: Heals 5988 of life', 'From intelligence: +2325 vitality point(s)', 'Using: Centurio will be activated for 24 hour(s).'],
  scroll: ['Lucius Scroll', 'Damage +5', 'Armor +550', 'Constitution +12', 'Charisma +15'],
  ginkgo: ['Ginkgo leaves', 'Using: +1624 Health', 'Duration: 02:00 h', 'Level 113', 'Value 14.164'],
};
const attr = (lines) => JSON.stringify([lines.map((l) => [l, '#DDD'])]).replace(/"/g, '&quot;');
const item = (lines, extra = '') => `<div data-content-type="64" data-measurement-x="1" data-measurement-y="1" data-tooltip="${attr(lines)}"${extra}></div>`;
const el = (lines) => new JSDOM(item(lines)).window.document.querySelector('div');

test('food is what heals; eggs and Cervisia heal too but do more, scrolls and buffs do not heal', () => {
  assert.equal(foodHealAmount(el(TIPS.bread)), 4635);
  assert.equal(foodHealAmount(el(TIPS.rubyEgg)), 4020);
  assert.equal(foodHealAmount(el(TIPS.scroll)), 0, 'not "heals 5" from "Damage +5"');
  assert.equal(foodHealAmount(el(TIPS.ginkgo)), 0, 'a +Health buff is not a heal');
  assert.deepEqual([TIPS.bread, TIPS.rubyEgg, TIPS.cervisia].map((t) => isPlainFood(el(t))), [true, false, false]);

  const plain = S.sanitizeSettings({});
  assert.equal(plain.heal.plainOnly, true, 'on by default');
  assert.deepEqual(Object.values(TIPS).map((t) => edible(el(t), plain)), [true, false, false, false, false]);
  const any = S.sanitizeSettings({ heal: { plainOnly: false } });
  assert.deepEqual(Object.values(TIPS).map((t) => edible(el(t), any)), [true, true, true, false, false]);
});

test('food bags: the ticked inventory tabs, all of them when none is ticked', () => {
  assert.deepEqual(brain.foodBags(S.sanitizeSettings({})), [512, 513, 514, 515, 516, 517, 518, 519]);
  const only = { b1: true, b2: false, b3: false, b4: false, b5: false, b6: false, b7: false, b8: false };
  assert.deepEqual(brain.foodBags(S.sanitizeSettings({ heal: { bags: only } })), [512]);
  const none = Object.fromEntries(Object.keys(only).map((k) => [k, false]));
  assert.equal(brain.foodBags(S.sanitizeSettings({ heal: { bags: none } })).length, 8);
});

// A mock game: bags (bag I full), and packages with an egg and a cheese.
function mockGame() {
  const moves = [];
  const full = '<div data-content-type="2" data-position-x="1" data-position-y="1" data-measurement-x="8" data-measurement-y="5"></div>';
  const bags = [[full, item(TIPS.bread)], [item(TIPS.rubyEgg, ' data-position-x="1" data-position-y="1"')], [], [], [], [], [], []];
  const literal = JSON.stringify(bags).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const cheese = ['Ciallans Cheese of the Dragon', 'Using: Heals 3801 of life', 'From intelligence: +2325 vitality point(s)'];
  const packages = [
    `<div class="packageItem"><div data-container-number="-1">${item(TIPS.rubyEgg)}</div></div>`,
    `<div class="packageItem"><div data-container-number="-2">${item(cheese)}</div></div>`,
  ].join('');
  const fetch = async (url) => {
    const u = new URL(url);
    const reply = (text) => ({ ok: true, text: async () => text });
    const mod = u.searchParams.get('mod');
    if (u.searchParams.get('submod') === 'move') {
      moves.push(`${u.searchParams.get('from')} -> ${u.searchParams.get('to')} at ${u.searchParams.get('toX')},${u.searchParams.get('toY')}`);
      return reply('{}');
    }
    if (mod === 'overview') return reply(`<script>new BagLoader(a, b, JSON.parse('${literal}'));</script>`);
    if (mod === 'packages') return reply(`<div id="packages">${packages}</div>`);
    throw new Error(`unexpected ${url}`);
  };
  return { moves, fetch };
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

test('food from the packages goes into a food bag, and eggs stay in the packages', async () => {
  const game = mockGame();
  const settings = S.sanitizeSettings({ heal: { bags: { b1: true, b2: false, b3: true, b4: false, b5: false, b6: false, b7: false, b8: false } } });
  const ctx = { state: { sh: 'abc' }, settings };
  const taken = await withGame(game, () => auction.takeFoodFromPackages(ctx, 5000));
  assert.equal(taken, 'Ciallans Cheese of the Dragon', 'not the ruby egg');
  assert.deepEqual(game.moves, ['-2 -> 514 at 1,1'], 'bag I is full and bag II is not a food bag: bag III');

  // For the auction's food limit: the bread in bag I and the cheese count,
  // the egg in bag II (not a food bag, and not plain food) does not.
  assert.equal(await withGame(mockGame(), () => auction.countFood('abc', settings)), 2);
});

// The General goods merchant's food tab on s303-en (2026-10): container
// 305, items with data-price-gold and data-level; tooltips as in the bags.
const APPLE = ['Heudois Apple of Love', 'Using: Heals 3860 of life', 'From intelligence: +2325 vitality point(s)', 'Level 95', 'Merchant Price 1.424'];
const MEAT = ['Sentarions Meat haunch of Martial Arts', 'Using: Heals 6030 of life', 'From intelligence: +2325 vitality point(s)', 'Level 95', 'Merchant Price 5.130'];
const HIGH = ['Heavy Bread', 'Using: Heals 9000 of life', 'From intelligence: +2325 vitality point(s)', 'Level 120', 'Merchant Price 900'];
const shopItem = (lines, x, price, level = 95, extra = '') =>
  item(lines, ` data-position-x="${x}" data-position-y="1" data-price-gold="${price}" data-level="${level}"${extra}`);
const SHOP = `<div id="shop" class="ui-droppable-grid" data-container-number="305" style="width:192px;height:256px;">
  ${shopItem(APPLE, 1, 1424)}${shopItem(MEAT, 2, 5130)}${shopItem(TIPS.ginkgo, 3, 17865)}${shopItem(TIPS.rubyEgg, 4, 100)}
  ${shopItem(HIGH, 5, 900, 120)}${shopItem(APPLE, 6, 50, 95, ' data-price-rubies="2"')}</div>`;

test('merchant food: plain healing food for gold, up to the character level', () => {
  const doc = new window.DOMParser().parseFromString(SHOP, 'text/html');
  const offers = auction.readShopFood(doc, S.sanitizeSettings({}), 110);
  assert.deepEqual(
    offers.map((o) => [o.name, o.heal, o.price, o.cn, o.x, o.y]),
    [
      ['Heudois Apple of Love', 3860, 1424, 305, 1, 1],
      ['Sentarions Meat haunch of Martial Arts', 6030, 5130, 305, 2, 1],
    ],
    'no buff, no egg, nothing above level 110, nothing with a ruby price'
  );
});

test('buying food: best HP per gold, within the day\'s budget and the reserve, into a food bag', async () => {
  const moves = [];
  const empty = '<div id="shop" data-container-number="304" style="width:192px;height:256px;"></div>';
  const fetch = async (url) => {
    const u = new URL(url);
    const reply = (text) => ({ ok: true, text: async () => text });
    if (u.searchParams.get('submod') === 'move') {
      const p = Object.fromEntries(u.searchParams);
      moves.push(`${p.from} ${p.fromX},${p.fromY} -> ${p.to} at ${p.toX},${p.toY}`);
      return reply('{}');
    }
    const mod = u.searchParams.get('mod');
    if (mod === 'overview') return reply(`<script>new BagLoader(a, b, JSON.parse('${JSON.stringify([[], [], [], [], [], [], [], []])}'));</script>`);
    if (mod === 'inventory') return reply(u.searchParams.get('sub') === '3' && u.searchParams.get('subsub') === '1' ? SHOP : empty);
    throw new Error(`unexpected ${url}`);
  };
  const NOW = new Date(2026, 9, 2, 18, 0).getTime();
  const settings = S.sanitizeSettings({ heal: { buy: true, buyAtOnce: 3, buyMaxGoldPerDay: 7000, buyKeepGold: 100000, bags: { b1: false, b2: true } } });
  const memory = brain.createMemory(NOW);
  const ctx = { settings, memory, state: { sh: 'abc', gold: 200000, level: 110 }, now: () => NOW, humanDelay: async () => {}, persist: async () => {} };

  const result = await withGame({ fetch }, () => auction.buyFood(ctx));
  assert.deepEqual(moves, ['305 1,1 -> 513 at 1,1', '305 2,1 -> 513 at 1,1'], 'apple first (2.7 HP/gold), then the meat; bag II is the food bag');
  assert.equal(result.gold, 1424 + 5130);
  assert.deepEqual(memory.foodShop, { sub: 3, subsub: 1 }, 'remembered for next time');
  assert.deepEqual(memory.foodBought, { day: new Date(NOW).toDateString(), gold: 6554, items: 2 });
  assert.equal(memory.stats.foodBought, 2);
  assert.equal(memory.stats.goldSpent, 6554);

  moves.length = 0;
  const again = await withGame({ fetch }, () => auction.buyFood(ctx));
  assert.deepEqual(moves, [], 'only 446 of the 7,000 a day are left, and the cheapest food costs 1,424');
  assert.equal(again.reason, "the merchant's food costs more than the 446 gold left to spend");

  memory.foodBought.gold = 7000;
  assert.equal((await withGame({ fetch }, () => auction.buyFood(ctx))).reason, 'the daily food budget is spent');
  const poor = { ...ctx, memory: brain.createMemory(NOW), state: { ...ctx.state, gold: 100500 } };
  assert.equal((await withGame({ fetch }, () => auction.buyFood(poor))).reason, "the merchant's food costs more than the 500 gold left to spend", 'the reserve counts too');
  const broke = { ...ctx, memory: brain.createMemory(NOW), state: { ...ctx.state, gold: 90000 } };
  assert.equal((await withGame({ fetch }, () => auction.buyFood(broke))).reason, 'gold is at the reserve you set');
  assert.deepEqual(moves, []);
});
