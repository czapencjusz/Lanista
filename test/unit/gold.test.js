'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { brain, settings: S } = require('./load');

const window = new JSDOM('<meta name="csrf-token" content="tok">', { url: 'https://s303-en.gladiatus.gameforge.com/game/index.php' }).window;
globalThis.DOMParser = window.DOMParser;
require('../../src/content/actions.js');
require('../../src/content/workbench.js');
require('../../src/content/packages.js');
const gold = require('../../src/content/gold.js');

const NOW = new Date(2026, 9, 4, 15, 0).getTime();
const ME = 'DaddyCzapo';

// The guild market on s303-en (2026-10-04): gold packs are stacks of
// resources (worth 525 each) listed at 100,000 gold per resource.
const row = ({ id, seller, price, amount = 3, value = 525, type = 32768, buy = true }) =>
  `<tr><td><div data-content-type="${type}" data-item-id="${id}" data-price-gold="${value}" data-amount="${amount}" data-basis="18-27"></div></td>
     <td><div><span><a href="index.php?mod=player&p=1">${seller}</a></span></div></td><td>${price}</td><td>03:34 h</td><td>2</td>
     <td align="center">${buy ? '<input type="submit" value="Buy" name="buy" class="awesome-button">' : '<input type="submit" value="Cancel" name="cancel" class="awesome-button">'}</td></tr>`;
const marketPage = (rows) =>
  `<div id="header_game"></div><div id="content">
     <form method="post" id="sellForm"><input type="hidden" name="sellid" value=""><input type="text" name="preis"><select name="dauer"></select><input type="submit" name="anbieten" value="Offer"></form>
     <table id="market_item_table"><tr><th>Item</th><th>Seller</th><th>Market Price</th><th>Duration</th><th>Level</th><th></th></tr>${rows.map(row).join('')}</table></div>`;
const OFFERS = [
  { id: 1, seller: 'WHINTERS', price: '300.000' },
  { id: 2, seller: 'Blackstealer', price: '500.000', amount: 5 },
  { id: 3, seller: 'AurigaPalma', price: '1.000.000', amount: 10 },
  { id: 4, seller: 'Trader', price: '2.000', amount: 1, value: 1500, type: 2 },
  { id: 5, seller: ME, price: '400.000', amount: 4, buy: false },
];

test('the guild market is read row by row; the listing id is the item id', () => {
  const offers = gold.readMarket(new window.DOMParser().parseFromString(marketPage(OFFERS), 'text/html'));
  const { el, ...first } = offers[0];
  assert.deepEqual(first, { buyid: '1', seller: 'WHINTERS', price: 300000, value: 525, amount: 3, basis: '18-27', type: 32768, level: 0, canBuy: true, buyLabel: 'Buy', cancel: null });
  assert.equal(el.getAttribute('data-item-id'), '1', 'the item itself comes along');
  assert.equal(offers[4].canBuy, false, 'no Buy on your own listing');
  assert.deepEqual(offers[4].cancel, { name: 'cancel', value: 'Cancel' }, 'but its Cancel button');
});

test('the pack to buy: the dearest the spare gold pays for, never a real item or your own', () => {
  const offers = gold.readMarket(new window.DOMParser().parseFromString(marketPage(OFFERS), 'text/html'));
  const pick = (spare, minPack = 50000) => (brain.pickGoldPack(offers, { spare, minPack, me: ME }) || {}).buyid;
  assert.equal(pick(600000), '2', '500,000 fits, 1,000,000 does not');
  assert.equal(pick(2000000), '3');
  assert.equal(pick(299999), undefined);
  assert.equal(pick(600000, 600000), undefined, 'nothing at least as dear as the smallest pack setting');
  const realItem = [{ ...offers[3], value: 5000, price: 60000 }];
  assert.equal(brain.pickGoldPack(realItem, { spare: 1e9, minPack: 50000, me: ME }), null, 'a 5,000 gold item for 60,000 is a sale, not a pack (needs 20x its worth)');
  const own = [{ ...offers[0], seller: 'daddyczapo', canBuy: true }];
  assert.equal(brain.pickGoldPack(own, { spare: 1e9, minPack: 50000, me: ME }), null, 'your own listing is never bought');
});

test('when to look: spare gold above a pack, or packs to list again', () => {
  const settings = S.sanitizeSettings({ enabled: true, gold: { hide: true, keep: 100000, minPack: 50000 } });
  const m = brain.createMemory(NOW);
  const state = (g) => ({ gold: g });
  assert.equal(brain.wantsGold(state(140000), settings, m, NOW), false, '40,000 spare is less than a pack');
  assert.equal(brain.wantsGold(state(160000), settings, m, NOW), true);
  m.goldPacks = [{ state: 'listed', at: NOW - 3600 * 1000, price: 300000 }];
  assert.equal(brain.wantsGold(state(0), settings, m, NOW), false, 'listed an hour ago: nothing to do');
  m.goldPacks = [{ state: 'bought', at: NOW, price: 300000 }];
  assert.equal(brain.wantsGold(state(0), settings, m, NOW), true, 'a bought pack waits to be listed');
  const off = S.sanitizeSettings({});
  assert.equal(brain.wantsGold(state(0), off, m, NOW), true, 'packs bought earlier are still listed with hiding off');
  m.goldPacks = [{ state: 'listed', at: NOW - 25 * 3600 * 1000, price: 300000 }];
  assert.equal(brain.wantsGold(state(0), off, m, NOW), true, 'and listed again once their 24 hours are up');
  m.nextGoldCheck = NOW + 1000;
  assert.equal(brain.wantsGold(state(1e6), settings, m, NOW), false, 'not before the next look');
  assert.equal(brain.wantsGold(state(1e6), off, brain.createMemory(NOW), NOW), false, 'no new packs with hiding off (the default)');
});

// A fake game for the whole round: market, buying, packages, moving and
// listing. Requests are recorded.
function fakeGame({ goldOnHand = 820000 } = {}) {
  const s = { gold: goldOnHand, listings: OFFERS.slice(), packaged: [], requests: [] };
  const header = () => `<div id="header_game"></div><div id="sstat_gold_val">${s.gold.toLocaleString('de-DE')}</div>`;
  const page = (body) => `<html><body>${header()}${body}</body></html>`;
  const bags = JSON.stringify([[], [], [], [], [], [], [], []]);
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const q = Object.fromEntries(u.searchParams);
    const body = new URLSearchParams(init.body || '');
    const reply = (text) => ({ ok: true, text: async () => text });
    if (u.pathname.endsWith('ajax.php') && q.submod === 'move') {
      s.requests.push(`move ${q.from} -> ${q.to} x${q.amount}`);
      s.packaged = s.packaged.filter((p) => String(p.cn) !== q.from);
      return reply(JSON.stringify({ to: { data: { itemId: 777 } } }));
    }
    if (q.mod === 'guildMarket' && init.method === 'POST' && body.get('buyid')) {
      const listing = s.listings.find((l) => String(l.id) === body.get('buyid'));
      s.requests.push(`buy ${body.get('buyid')}`);
      const price = Number(listing.price.replace(/\./g, ''));
      s.gold -= price;
      s.listings = s.listings.filter((l) => l !== listing);
      s.packaged.push({ cn: -9, amount: listing.amount || 3 });
      return reply(page(marketPage(s.listings)));
    }
    if (q.mod === 'guildMarket' && init.method === 'POST' && body.get('sellid')) {
      s.requests.push(`sell ${body.get('sellid')} for ${body.get('preis')} (${body.get('dauer')}) ${body.get('anbieten')}`);
      s.listings.push({ id: 900, seller: ME, price: Number(body.get('preis')).toLocaleString('de-DE'), amount: 5, buy: false });
      return reply(page(marketPage(s.listings)));
    }
    if (q.mod === 'guildMarket') return reply(page(marketPage(s.listings)));
    if (q.mod === 'packages') {
      if (q.f === '14') return reply(page('<div id="packages"></div>')); // the gold filter: no gold packages here
      const items = s.packaged
        .map((p) => `<div class="packageItem"><div data-container-number="${p.cn}"><div data-content-type="32768" data-amount="${p.amount}" data-basis="18-27" data-price-gold="525" data-tooltip="[[[&quot;Resource&quot;,&quot;white&quot;]]]"></div></div></div>`)
        .join('');
      return reply(page(`<div id="packages">${items}</div>`));
    }
    if (q.mod === 'overview') {
      return reply(page(`<div class="playername_achievement">${ME}</div><script>new BagLoader(a, b, JSON.parse('${bags}'));</script>`));
    }
    throw new Error(`unexpected ${init.method || 'GET'} ${url}`);
  };
  return { s, fetch };
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

test('hiding gold: buys the dearest pack that fits, then lists it again at the same price for 24 h', async () => {
  const game = fakeGame({ goldOnHand: 820000 });
  const memory = brain.createMemory(NOW);
  const logs = [];
  const ctx = {
    state: { sh: 'abc', gold: 820000 },
    settings: S.sanitizeSettings({ enabled: true, gold: { hide: true, keep: 100000, minPack: 50000 } }),
    memory,
    log: (l, m) => logs.push(`${l}: ${m}`),
    humanDelay: async () => {},
    persist: async () => {},
    now: () => NOW,
  };
  await withGame(game, () => GBot.actions.gold(ctx));
  assert.deepEqual(game.s.requests, ['buy 2', 'move -9 -> 512 x5', 'sell 777 for 500000 (3) Offer'], '720,000 spare: the 500,000 pack');
  assert.equal(game.s.gold, 320000);
  assert.deepEqual(memory.goldPacks, [{ type: 32768, amount: 5, basis: '18-27', price: 500000, state: 'listed', at: NOW }]);
  assert.equal(memory.stats.goldHidden, 500000);
  assert.equal(memory.nextGoldCheck, NOW + 60 * 1000, 'look again soon: more gold may be spare');
  assert.ok(logs.includes("info: Gold: hid 500,000 gold in Blackstealer's pack in the guild market"));
  assert.ok(logs.includes('info: Gold: listed a pack for 500,000 gold in the guild market (24 h)'));

  // A day later the listing is gone and so is the pack: a guildmate bought it.
  const later = NOW + 25 * 3600 * 1000;
  game.s.gold = 100000;
  await withGame(game, () => GBot.actions.gold({ ...ctx, now: () => later }));
  assert.deepEqual(memory.goldPacks, []);
  assert.ok(logs.includes('info: Gold: a guildmate bought the pack listed for 500,000 gold; the gold comes back as a gold package'));
  assert.equal(memory.nextGoldCheck, later + 15 * 60 * 1000);
});

test('a pack waiting to be listed keeps the resources out of the Horreum, hiding on or off', async () => {
  const settings = S.sanitizeSettings({ gold: { hide: false }, packages: { enabled: true, storeResources: true } });
  const memory = brain.createMemory(NOW);
  memory.goldPacks = [{ type: 32768, amount: 3, basis: '18-27', price: 300000, state: 'bought', at: NOW }];
  const game = fakeGame();
  game.s.packaged = [{ cn: -9, amount: 3 }];
  const logs = [];
  const ctx = { state: { sh: 'abc' }, settings, memory, log: (l, m) => logs.push(`${l}: ${m}`), humanDelay: async () => {}, persist: async () => {}, now: () => NOW };
  await withGame(game, () => GBot.actions.packages(ctx));
  assert.ok(logs.includes('debug: Packages: not storing resources while a gold pack waits to be listed'));
  assert.deepEqual(game.s.requests, [], 'nothing stored or moved');
});

test('with hiding off, a pack back from an expired listing is listed again, and nothing is bought', async () => {
  const game = fakeGame({ goldOnHand: 5000000 });
  game.s.packaged = [{ cn: -9, amount: 3 }];
  const memory = brain.createMemory(NOW);
  memory.goldPacks = [{ type: 32768, amount: 3, basis: '18-27', price: 300000, state: 'listed', at: NOW - 25 * 3600 * 1000 }];
  const ctx = {
    state: { sh: 'abc', gold: 5000000 },
    settings: S.sanitizeSettings({ enabled: true, gold: { hide: false } }),
    memory,
    log: () => {},
    humanDelay: async () => {},
    persist: async () => {},
    now: () => NOW,
  };
  await withGame(game, () => GBot.actions.gold(ctx));
  assert.deepEqual(game.s.requests, ['move -9 -> 512 x3', 'sell 777 for 300000 (3) Offer']);
  assert.equal(game.s.gold, 5000000, 'no new pack bought');
  assert.deepEqual(memory.goldPacks, [{ type: 32768, amount: 3, basis: '18-27', price: 300000, state: 'listed', at: NOW }]);
});
