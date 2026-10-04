'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { brain, settings: S } = require('./load');

const window = new JSDOM('<meta name="csrf-token" content="tok">', { url: 'https://s303-en.gladiatus.gameforge.com/game/index.php' }).window;
globalThis.DOMParser = window.DOMParser;
require('../../src/content/actions.js');
require('../../src/content/workbench.js');
require('../../src/content/smelter.js');
const packages = require('../../src/content/packages.js');
const auction = require('../../src/content/auction.js');

const NOW = new Date(2026, 9, 4, 16, 0).getTime();
const tip = (lines) => JSON.stringify([lines.map((l) => [l, 'white'])]).replace(/"/g, '&quot;');
const bagLoader = (bags) => {
  const literal = JSON.stringify(bags.map((b) => [b])).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `<script>new BagLoader(jQuery('#inv'), jQuery('#inventory_nav'), JSON.parse('${literal}'));</script>`;
};

async function withFetch(fetch, fn) {
  const saved = { document: globalThis.document, location: globalThis.location, fetch: globalThis.fetch };
  Object.assign(globalThis, { document: window.document, location: window.location, fetch });
  try {
    return await fn();
  } finally {
    Object.assign(globalThis, saved);
  }
}

function context(settings, extra = {}) {
  const logs = [];
  const memory = brain.createMemory(NOW);
  return {
    logs,
    ctx: { state: { sh: 'abc', gold: 1000000 }, settings: S.sanitizeSettings(settings), memory, log: (l, m) => logs.push(`${l}: ${m}`), humanDelay: async () => {}, persist: async () => {}, now: () => NOW, ...extra },
  };
}

// ---------------------------------------------------------------- smelt bins

test('smelt bins: what the smelter takes in the chosen bags is smelted straight from the bag', async () => {
  const sword = `<div data-content-type="2" data-item-id="999" data-basis="1-5" data-position-x="1" data-position-y="1" data-measurement-x="1" data-measurement-y="3" data-tooltip="${tip(['Rusty sword'])}"></div>`;
  const bread = `<div data-content-type="64" data-item-id="998" data-position-x="2" data-position-y="1" data-tooltip="${tip(['Bread', 'Using: Heals 300 of life', '+5'])}"></div>`;
  const calls = [];
  const slots = Array.from({ length: 6 }, () => ({ 'forge_slots.state': 'closed' }));
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const q = Object.fromEntries(u.searchParams);
    const body = init.body || '';
    const reply = (text) => ({ ok: true, text: async () => text });
    calls.push(`${q.mod}/${q.submod || ''}${/iid=\d+/.test(body) ? ` ${/iid=\d+/.exec(body)[0]}` : ''}${/item=\d+/.test(body) ? ` ${/item=\d+/.exec(body)[0]}` : ''}`);
    if (q.mod === 'overview') return reply(bagLoader(['', '', '', '', '', '', '', sword + bread]));
    if (q.submod === 'getSmeltingPreview') return reply(JSON.stringify({ slots: slots.map((s, i) => (i === 0 ? { ...s, formula: { rent: { 2: 500 } } } : s)) }));
    if (q.submod === 'rent') {
      slots[0] = { 'forge_slots.state': 'crafting', 'forge_slots.finishedIn': 600 };
      return reply('ok');
    }
    return reply(`<script>var slotsData = ${JSON.stringify(slots)};\nvar x = 1;</script>`);
  };
  const { ctx, logs } = context({ smelting: { enabled: true, bins: { b8: true } } });
  await withFetch(fetch, () => GBot.actions.smelt(ctx));
  assert.deepEqual(calls, ['overview/', 'forge/smeltery', 'forge/getSmeltingPreview iid=999', 'forge/rent item=999', 'forge/smeltery', 'forge/smeltery'], 'no packages, no moves; the bread is not smeltable');
  assert.deepEqual(logs, ['info: Queued 1 item from the smelt bin', 'info: Smelting Rusty sword (10:00, 500 gold)']);
  assert.equal(ctx.memory.smeltNext, NOW + 600 * 1000 + 5000);

  // With a bin set, the smelter is looked at even with nothing queued.
  const settings = S.sanitizeSettings({ enabled: true, smelting: { enabled: true, bins: { b8: true } } });
  const state = { inGame: true, gold: 1000, hp: {}, dialogs: {}, expedition: {}, dungeon: {}, arena: {}, circus: {}, page: {} };
  assert.equal(brain.decide(state, settings, brain.createMemory(NOW), NOW).type, 'smelt');
  assert.deepEqual(brain.smeltBins(settings), [519]);
  assert.deepEqual(brain.smeltBins(S.sanitizeSettings({})), [], 'off by default');
});

// --------------------------------------------------------- packages: pick, scrolls

// The forge's known prefixes and suffixes, and the packages by filter.
function itemsGame({ knownAfter = false } = {}) {
  const s = { moves: [], known: ['Táliths', 'Ichorus', 'of hell'] };
  const pkg = (cn, type, name) => `<div class="packageItem"><div data-container-number="${cn}"><div data-content-type="${type}" data-tooltip="${tip([name])}"></div></div></div>`;
  const byFilter = {
    20: pkg(-1, 64, 'Lepidus Scroll') + pkg(-2, 64, 'Scroll of hell'),
    12: pkg(-3, 4096, 'Small grindstone'),
  };
  const fetch = async (url) => {
    const u = new URL(url);
    const q = Object.fromEntries(u.searchParams);
    const reply = (text) => ({ ok: true, text: async () => text });
    if (q.submod === 'move') {
      s.moves.push(`${q.from} -> ${q.to}`);
      if (q.to === '8' && knownAfter) s.known.push('Lepidus');
      return reply(JSON.stringify({ to: { data: { itemId: 5 } } }));
    }
    if (q.mod === 'forge') {
      const opts = (names) => ['<option value="0">-</option>', ...names.map((n, i) => `<option value="${i + 1}">${n}</option>`)].join('');
      return reply(`<div id="content"><select name="prefix0">${opts(s.known.filter((n) => !n.startsWith('of ')))}</select><select name="suffix0">${opts(s.known.filter((n) => n.startsWith('of ')))}</select></div>`);
    }
    if (q.mod === 'packages') return reply(`<div id="packages">${byFilter[q.f] || ''}</div>`);
    if (q.mod === 'overview') return reply(bagLoader(['', '', '', '', '', '', '', '']));
    throw new Error(`unexpected ${url}`);
  };
  return { s, fetch };
}

test('scrolls: a new prefix is learned (used from a bag), a known suffix is left alone', async () => {
  const game = itemsGame({ knownAfter: true });
  const { ctx, logs } = context({ heal: { bags: { b1: true, b2: false, b3: false, b4: false, b5: false, b6: false, b7: false, b8: false } }, packages: { enabled: true, collectGold: false, learnScrolls: true } });
  await withFetch(game.fetch, () => GBot.actions.packages(ctx));
  assert.deepEqual(game.s.moves, ['-1 -> 513', '513 -> 8'], 'into bag II (bag I holds food), then used');
  assert.ok(logs.includes('info: Learned Lepidus Scroll'), logs.join(' / '));
  assert.equal(packages.scrollKnown('Scroll of hell', game.s.known), true);
  assert.equal(packages.scrollKnown('Lepidus Scroll', ['Táliths']), false);
});

test('picking: chosen item types go from the packages into a bag', async () => {
  const game = itemsGame();
  const { ctx, logs } = context({ packages: { enabled: true, collectGold: false, pick: { upgrades: true } } });
  await withFetch(game.fetch, () => GBot.actions.packages(ctx));
  assert.deepEqual(game.s.moves, ['-3 -> 512'], 'every bag is a food bag by default: the first free spot');
  assert.ok(logs.includes('info: Took 1 upgrade out of the packages into your bags'), logs.join(' / '));
});

// ------------------------------------------------------------ keep by name

test('names on the keep list are never sold or smelted, only rescued before expiring', () => {
  const settings = S.sanitizeSettings({
    smelting: { enabled: true, auto: true, autoUpTo: 4 },
    packages: { enabled: true, sell: true, sellUpTo: 4, keepNames: 'Sugilith\nof Blocking' },
  });
  const item = (name, expiresInMs = null) => ({ name, type: 2, quality: 0, expiresInMs });
  assert.equal(brain.packageAction(item('Rusty sword'), settings), 'smelt');
  assert.equal(brain.packageAction(item('Bilgs Sugilith pendant'), settings), null);
  assert.equal(brain.packageAction(item('Sword of Blocking'), settings), null, 'case-insensitive parts of names');
  assert.equal(brain.packageAction(item('Sword of Blocking', 3600 * 1000), settings), 'bag', 'still rescued');
});

// ---------------------------------------------------------------- auction gear

test('auction gear: kinds, minimum quality and price per lot, best quality first, within the gold limits', () => {
  const cfg = { ...S.sanitizeSettings({}).auction, gear: true, gearMinQuality: 2, gearMaxPrice: 50000, keepGold: 100000, maxPerRound: 80000 };
  const lots = [
    { id: 'a', name: 'Purple sword', type: 2, quality: 2, minBid: 30000 },
    { id: 'b', name: 'Orange ring', type: 16, quality: 3, minBid: 45000 },
    { id: 'c', name: 'Blue helmet', type: 1, quality: 1, minBid: 1000 },
    { id: 'd', name: 'Red shield', type: 4, quality: 4, minBid: 60000 },
    { id: 'e', name: 'Purple boots', type: 512, quality: 2, minBid: 20000 },
  ];
  const plan = (c, opts = {}) => brain.planGearBids(lots, c, { gold: 1000000, spent: 0, bids: {}, ...opts }).map((l) => l.id);
  assert.deepEqual(plan(cfg), ['b', 'e'], 'orange first, then the cheapest purple that fits the 80,000 round');
  assert.deepEqual(plan({ ...cfg, gearTypes: { weapons: true, armour: false, jewellery: false } }), ['a']);
  assert.deepEqual(plan(cfg, { bids: { b: 45000 } }), ['e', 'a'], 'never twice on a lot');
  assert.deepEqual(plan(cfg, { gold: 130000 }), ['e'], 'never below the gold reserve');
});

test('auction lots carry their quality', () => {
  const lot = (cls, extra = '') =>
    `<form action="index.php?mod=auction&submod=placeBid"><input name="auctionid" value="7"><input name="bid_amount" value="1200"><input type="submit" name="bid" value="Bid">
       <div class="auction_item_div"><div class="${cls}" data-content-type="2"${extra} data-tooltip="${tip(['Sword'])}"></div></div></form>`;
  const doc = new window.DOMParser().parseFromString(`<div>${lot('item-i-purple', ' data-quality="2"')}${lot('item-i-green')}</div>`, 'text/html');
  assert.deepEqual(auction.readAuction(doc).lots.map((l) => [l.quality, l.minBid]), [[2, 1200], [0, 1200]]);
});

// s303 on 2026-10-04: bag I holds food, II-IV are full, and V-VIII are not
// bought (their tabs say data-available="false") though the page lists them.
function lockedBagsGame({ upgrades = 1, moveAnswer = (q) => ({ to: { data: { itemId: 5 } } }) } = {}) {
  const s = { moves: [] };
  const full = Array.from({ length: 40 }, (_, i) => `<div data-content-type="4096" data-position-x="${(i % 8) + 1}" data-position-y="${Math.floor(i / 8) + 1}"></div>`).join('');
  const nav = [512, 513, 514, 515, 516, 517, 518, 519]
    .map((n) => `<a class="awesome-tabs" data-bag-number="${n}" data-available="${n < 516}" data-extend-message="">x</a>`)
    .join('');
  const pkg = (cn, name) => `<div class="packageItem"><div data-container-number="${cn}"><div data-content-type="4096" data-tooltip="${tip([name])}"></div></div></div>`;
  const fetch = async (url) => {
    const u = new URL(url);
    const q = Object.fromEntries(u.searchParams);
    const reply = (text) => ({ ok: true, text: async () => text });
    if (q.submod === 'move') {
      s.moves.push(`${q.from} -> ${q.to}`);
      return reply(JSON.stringify(moveAnswer(q)));
    }
    if (q.mod === 'overview') return reply(`<div id="inventory_nav">${nav}</div>${bagLoader(['', full, full, full, '', '', '', ''])}`);
    if (q.mod === 'packages') {
      const items = q.f === '12' ? Array.from({ length: upgrades }, (_, i) => pkg(-(i + 1), 'Small grindstone')).join('') : '';
      return reply(`<div id="packages">${items}</div>`);
    }
    throw new Error(`unexpected ${url}`);
  };
  return { s, fetch };
}

const onlyBagOne = { b1: true, b2: false, b3: false, b4: false, b5: false, b6: false, b7: false, b8: false };

test('locked bags are never used, and picked items stay out of the food bags', async () => {
  const game = lockedBagsGame();
  const { ctx, logs } = context({ heal: { bags: onlyBagOne }, packages: { enabled: true, collectGold: false, pick: { upgrades: true } } });
  await withFetch(game.fetch, () => GBot.actions.packages(ctx));
  assert.deepEqual(game.s.moves, [], 'not bag V (516), which the account does not have, and not the food bag I');
  assert.ok(logs.includes('warn: Packages: No room in the bags outside your food bags for a 1x1 item; taking items out later'), logs.join(' / '));

  // With every bag a food bag (the default), the first free spot is fine.
  const open = lockedBagsGame();
  const all = context({ packages: { enabled: true, collectGold: false, pick: { upgrades: true } } });
  await withFetch(open.fetch, () => GBot.actions.packages(all.ctx));
  assert.deepEqual(open.s.moves, ['-1 -> 512']);
  assert.ok(all.logs.includes('info: Took 1 upgrade out of the packages into your bags'));
});

test('picking says how many it moved, also when it stops at 10 for this round', async () => {
  const game = lockedBagsGame({ upgrades: 12 });
  const { ctx, logs } = context({ packages: { enabled: true, collectGold: false, pick: { upgrades: true } } });
  await withFetch(game.fetch, () => GBot.actions.packages(ctx));
  assert.equal(game.s.moves.length, 10);
  assert.ok(logs.includes('info: Took 10 upgrades out of the packages into your bags'), logs.join(' / '));
  assert.equal(ctx.memory.nextPackagesCheck, NOW + 60 * 1000, 'the rest a minute later');
});

test('a move the game did not make stops the picking with a warning', async () => {
  const game = lockedBagsGame({ upgrades: 3, moveAnswer: () => ({}) });
  const { ctx, logs } = context({ packages: { enabled: true, collectGold: false, pick: { upgrades: true } } });
  await withFetch(game.fetch, () => GBot.actions.packages(ctx));
  assert.deepEqual(game.s.moves, ['-1 -> 512'], 'stops after the first');
  assert.ok(logs.includes('warn: Packages: The game did not take Small grindstone into bag 1; taking items out later'), logs.join(' / '));
});
