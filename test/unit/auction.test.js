'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { brain, settings: settingsModule } = require('./load');

const window = new JSDOM('<meta name="csrf-token" content="tok">', { url: 'https://s1-en.gladiatus.gameforge.com/game/index.php' }).window;
globalThis.DOMParser = window.DOMParser;
require('../../src/content/actions.js');
require('../../src/content/workbench.js');
const auction = require('../../src/content/auction.js');

const NOW = 1_700_000_000_000;

// Markup of the live auction house on s60-en (2026-09), with the price
// hints Gladiatus Crazy Addon adds ("+2770 (4.58)", "Hide your gold here").
const food = (name, heal) =>
  JSON.stringify([[[name, 'lime'], [`Using: Heals ${heal} of life`, '#DDD'], ['From intelligence: +1300 vitality point', '#DDD']]]).replace(/"/g, '&quot;');
const lot = (id, name, heal, bid, type = 64) => `
  <form action="index.php?mod=auction&amp;submod=placeBid&amp;ttype=2&amp;rubyAmount=5&amp;sh=abc" method="post">
    <input type="hidden" name="auctionid" value="${id}"><input type="hidden" name="qry" value="">
    <input type="hidden" name="itemType" value="7"><input type="hidden" name="itemLevel" value="48">
    <input type="hidden" name="itemQuality" value="-1"><input type="hidden" id="buyout${id}" name="buyouthd" value="0">
    <div class="auction_item_div"><div title="+Hit Points (Hit Points/Gold)">+${heal} (${(heal / bid).toFixed(2)})</div>
      <div><div class="item-i-7-6" data-content-type="${type}" data-tooltip="${food(name, heal)}"></div></div></div>
    <div class="auction_bid_div"><div>No bids<br><span class="gca-auction-good-price">Hide your gold here</span></div>
      <div>Lowest price : ${bid}<img title="Gold" src="res2.gif"></div>
      <input type="text" name="bid_amount" value="${bid}"><input class="awesome-button" type="submit" name="bid" value="Bid"><hr>
      <input class="awesome-button" type="submit" name="buyout" value="Buyout">1.206<img title="Gold" src="res2.gif">4<a><img title="Rubies" src="res3.gif"></a></div>
    <input type="hidden" name="csrf_token" value="tok">
  </form>`;
const auctionPage = (time, lots) => `<p><span class="description_span_left">Remaining time of auction:</span><span class="description_span_right"><b>${time}</b></span></p>${lots}`;
const LOTS = lot(1, 'Bilgs Apple of Fire', 2460, 290) + lot(2, 'Nariths Bread of Sacrifice', 2770, 605) + lot(3, 'Zeindras Health potion of diligence', 5275, 2862) + lot(4, 'Flacon of charisma', 0, 100, 4096);

test('reads auction lots and the round time from the game markup only', () => {
  const doc = new JSDOM(auctionPage('Short', LOTS)).window.document;
  const read = auction.readAuction(doc);
  assert.equal(read.rank, 2);
  assert.deepEqual(
    read.lots.map(({ id, name, heal, minBid }) => ({ id, name, heal, minBid })),
    [
      { id: '1', name: 'Bilgs Apple of Fire', heal: 2460, minBid: 290 },
      { id: '2', name: 'Nariths Bread of Sacrifice', heal: 2770, minBid: 605 },
      { id: '3', name: 'Zeindras Health potion of diligence', heal: 5275, minBid: 2862 },
      { id: '4', name: 'Flacon of charisma', heal: 0, minBid: 100 },
    ]
  );
  assert.deepEqual(['Very short', 'short', 'MEDIUM', 'Long', 'Very long', 'Długo'].map(auction.timeRank), [1, 2, 3, 4, 5, null]);
});

test('bids go in only late in the round, at the accepted price, within the limits', () => {
  const cfg = settingsModule.sanitizeSettings({ auction: { enabled: true } }).auction;
  assert.equal(cfg.minHpPerGold, 4);
  const lots = [
    { id: 'a', heal: 2460, minBid: 290 }, // 8.5 HP/gold
    { id: 'b', heal: 2770, minBid: 605 }, // 4.6
    { id: 'c', heal: 5275, minBid: 2862 }, // 1.8: too dear
    { id: 'd', heal: 0, minBid: 100 }, // not food
  ];
  const plan = (extra) => brain.planAuctionBids(lots, { ...cfg, ...extra.cfg }, { gold: 1_000_000, spent: 0, bids: {}, owned: 0, ...extra.state }).map((l) => l.id);
  assert.deepEqual(plan({}), ['a', 'b'], 'best HP per gold first');
  assert.deepEqual(plan({ state: { bids: { a: 290 } } }), ['b'], 'one bid per lot per round');
  assert.deepEqual(plan({ state: { gold: 100_500 } }), ['a'], 'keeps the reserve');
  assert.deepEqual(plan({ state: { spent: 9_500 } }), ['a'], 'round budget');
  assert.deepEqual(plan({ state: { owned: 49 } }), ['a'], 'stops at the food limit');
  assert.deepEqual(plan({ cfg: { minHpPerGold: 1 } }), ['a', 'b', 'c']);

  assert.equal(brain.auctionTimeOk(4, 'short'), false);
  assert.equal(brain.auctionTimeOk(2, 'short'), true);
  assert.equal(brain.auctionTimeOk(3, 'medium'), true);
  assert.equal(brain.auctionTimeOk(null, 'short'), false, 'unknown label: wait');
  assert.equal(brain.auctionTimeOk(null, 'any'), true);
  assert.equal(brain.auctionRecheckMs(4), 30 * 60 * 1000);
  assert.equal(brain.auctionRecheckMs(1), 2 * 60 * 1000);
});

// A mock game for the auction action.
function mockGame({ time, lots = LOTS, gold = 1_000_000, taken = true, bagFood = 2, packagedFood = 0 }) {
  const posts = [];
  let current = gold;
  const bagLiteral = JSON.stringify([Array.from({ length: bagFood }, (_, i) => `<div data-content-type="64" data-tooltip="${food(`Bread ${i}`, 1000)}"></div>`), [], [], [], [], [], [], []])
    .replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const reply = (text) => ({ ok: true, text: async () => text });
    if (init.method === 'POST') {
      posts.push({ url: u.searchParams.get('submod'), body: Object.fromEntries(new URLSearchParams(init.body)) });
      if (taken) current -= Number(new URLSearchParams(init.body).get('bid_amount'));
      return reply(`<div id="sstat_gold_val">${current.toLocaleString('de-DE')}</div>${auctionPage(time, lots)}`);
    }
    const mod = u.searchParams.get('mod');
    if (mod === 'auction') return reply(auctionPage(time, lots));
    if (mod === 'overview') return reply(`<script>new BagLoader(a, b, JSON.parse('${bagLiteral}'));</script>`);
    if (mod === 'packages') return reply(Array.from({ length: packagedFood }, (_, i) => `<div class="packageItem"><div data-container-number="-${i + 1}"><div data-content-type="64" data-tooltip="${food(`Cheese ${i}`, 2000)}"></div></div></div>`).join(''));
    throw new Error(`unexpected ${url}`);
  };
  return { posts, fetch };
}

function context(settings = {}, memory = brain.createMemory(NOW)) {
  const logs = [];
  return {
    logs,
    ctx: {
      state: { sh: 'abc', gold: 1_000_000 },
      settings: settingsModule.sanitizeSettings({ auction: { enabled: true, ...settings } }),
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

test('in a short round the bot bids the minimum on good lots, as the Bid button does', async () => {
  const game = mockGame({ time: 'Short' });
  const { ctx, logs } = context();
  await withGame(game, () => GBot.actions.auction(ctx));
  assert.deepEqual(game.posts.map((p) => p.body.auctionid), ['1', '2']);
  assert.deepEqual(game.posts[0], {
    url: 'placeBid',
    body: { auctionid: '1', qry: '', itemType: '7', itemLevel: '48', itemQuality: '-1', buyouthd: '0', bid_amount: '290', csrf_token: 'tok', bid: 'Bid' },
  });
  assert.ok(game.posts.every((p) => !('buyout' in p.body)), 'never the ruby buyout');
  assert.deepEqual(ctx.memory.auctionRound, { rank: 2, spent: 895, bids: { 1: 290, 2: 605 } });
  assert.equal(ctx.memory.stats.auctionBids, 2);
  assert.equal(ctx.memory.nextAuctionCheck, NOW + 4 * 60 * 1000);
  assert.deepEqual(logs, [
    'info: Auction (Short): bid 290 gold on Bilgs Apple of Fire (+2,460 HP, 8.5 HP/gold)',
    'info: Auction (Short): bid 605 gold on Nariths Bread of Sacrifice (+2,770 HP, 4.6 HP/gold)',
  ]);
});

test('no bids in a long round, when enough food is owned, or twice on a lot', async () => {
  const long = mockGame({ time: 'Long' });
  const first = context();
  await withGame(long, () => GBot.actions.auction(first.ctx));
  assert.deepEqual(long.posts, []);
  assert.equal(first.ctx.memory.nextAuctionCheck, NOW + 30 * 60 * 1000);

  assert.deepEqual(first.logs, ['info: Auction: the round time is "Long", waiting to bid until it is later']);
  await withGame(long, () => GBot.actions.auction(first.ctx));
  assert.equal(first.logs.length, 1, 'said once');

  const stocked = mockGame({ time: 'Very short', bagFood: 30, packagedFood: 6 });
  const second = context();
  assert.equal(second.ctx.settings.auction.maxFood, 50);
  await withGame(stocked, () => GBot.actions.auction(second.ctx));
  assert.equal(stocked.posts.length, 2, '36 healing items owned is under the default limit of 50');
  const full = mockGame({ time: 'Very short', bagFood: 30, packagedFood: 6 });
  const third0 = context({ maxFood: 20 });
  await withGame(full, () => GBot.actions.auction(third0.ctx));
  assert.deepEqual(full.posts, []);
  assert.deepEqual(third0.logs, ['info: Auction: you own 36 healing items (limit 20), not bidding']);

  // Same round, later look: lot 1 already has our bid; a new round resets.
  const again = mockGame({ time: 'Very short' });
  const memory = brain.createMemory(NOW);
  memory.auctionRound = { rank: 2, spent: 290, bids: { 1: 290 } };
  const third = context({}, memory);
  await withGame(again, () => GBot.actions.auction(third.ctx));
  assert.deepEqual(again.posts.map((p) => p.body.auctionid), ['2']);

  const next = mockGame({ time: 'Very long' });
  await withGame(next, () => GBot.actions.auction(third.ctx));
  assert.deepEqual(third.ctx.memory.auctionRound, { rank: 5, spent: 0, bids: {} }, 'new round');
});

test('when no lot fits the limits the bot says so, once', async () => {
  // As in the live test: the 290 apple had been bid up to 305 and the test
  // budget was 300, so nothing fitted and nothing was said.
  const game = mockGame({ time: 'Short' });
  const { ctx, logs } = context({ maxPerRound: 250 });
  await withGame(game, () => GBot.actions.auction(ctx));
  await withGame(game, () => GBot.actions.auction(ctx));
  assert.deepEqual(game.posts, []);
  assert.deepEqual(logs, ['info: Auction: no new lot heals at least 4 HP per gold within your gold limits']);
});

test('a bid the game did not take is reported, not counted', async () => {
  const game = mockGame({ time: 'Short', taken: false });
  const { ctx, logs } = context();
  await withGame(game, () => GBot.actions.auction(ctx));
  assert.equal(ctx.memory.stats.auctionBids, 0);
  assert.equal(ctx.memory.auctionRound.spent, 0);
  assert.match(logs[0], /^warn: Auction: the bid on Bilgs Apple of Fire \(290 gold\) was not taken/);
});

test('the bot looks at the auction house when due, and only when switched on', () => {
  const st = { inGame: true, hp: { percent: 100 }, dialogs: {}, expedition: { available: true, ready: true, points: 5 }, dungeon: {}, arena: {}, circus: {}, gold: 0 };
  const m = brain.createMemory(NOW);
  m.nextRepairCheck = NOW + 60000;
  const on = settingsModule.sanitizeSettings({ enabled: true, auction: { enabled: true } });
  assert.equal(brain.decide(st, on, m, NOW).type, 'auction');
  assert.equal(brain.decide(st, settingsModule.sanitizeSettings({ enabled: true }), m, NOW).type, 'expedition', 'off by default');
  m.nextAuctionCheck = NOW + 60000;
  assert.equal(brain.decide(st, on, m, NOW).type, 'expedition');
});
