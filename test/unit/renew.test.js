'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { brain, settings: S } = require('./load');

const window = new JSDOM('<meta name="csrf-token" content="tok">', { url: 'https://s303-en.gladiatus.gameforge.com/game/index.php' }).window;
globalThis.DOMParser = window.DOMParser;
require('../../src/content/workbench.js');
require('../../src/content/smelter.js');
require('../../src/content/packages.js');
require('../../src/content/gold.js');

const NOW = 1_700_000_000_000;
const HOUR = 3600 * 1000;
const ME = 'DaddyCzapo';
const tip = (lines) => JSON.stringify([lines.map((l) => [l, 'white'])]).replace(/"/g, '&quot;');

// A small game: packages, bags, and the guild market with its Sell form.
// Listing takes the item out of the bag; cancelling your listing (its row's
// Cancel button) sends it back as a new package with 7 days to go.
function renewGame({ cancelWorks = true } = {}) {
  const state = {
    packages: [
      { cn: -10, name: 'Old ring', type: 48, left: 3 * HOUR },
      { cn: -11, name: 'Flask of Strength', type: 64, left: 2 * HOUR, bound: true },
      { cn: -12, name: 'Fresh helmet', type: 1, left: 160 * HOUR },
    ],
    bag: [],
    listings: [],
    calls: [],
  };
  const pkg = (p) =>
    `<div class="packageItem"><div data-container-number="${p.cn}"><div data-content-type="${p.type}" data-quality="1" data-price-gold="100" data-amount="1" data-level="100" data-measurement-x="1" data-measurement-y="1" data-tooltip="${tip(p.bound ? [p.name, `Soul bound to: ${ME}`] : [p.name])}"></div></div><span class="ticker" data-ticker-time-left="${p.left}"></span></div>`;
  const row = (l) =>
    `<tr><td><div data-content-type="${l.type}" data-item-id="${l.buyid}" data-price-gold="100" data-amount="1"></div></td><td><a href="#">${l.seller}</a></td><td>${l.price}</td><td>02:00 h</td><td>100</td><td><input type="submit" ${l.seller === ME ? 'name="cancel" value="Cancel"' : 'name="buy" value="Buy"'}></td></tr>`;
  const reply = (text) => ({ ok: true, text: async () => text });
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const q = Object.fromEntries(u.searchParams);
    const body = Object.fromEntries(new URLSearchParams(init.body || ''));
    if (q.submod === 'move') {
      const p = state.packages.find((x) => x.cn === Number(q.from));
      state.calls.push(`move ${q.from} -> ${q.to}`);
      state.packages = state.packages.filter((x) => x !== p);
      state.bag.push({ ...p, id: 700 - p.cn });
      return reply(JSON.stringify({ to: { data: { itemId: 700 - p.cn } } }));
    }
    if (q.mod === 'packages') {
      // f=14: gold packages only (none here).
      const list = q.f === '14' ? [] : state.packages;
      return reply(`<div id="packages">${list.map(pkg).join('')}</div><div class="pagination"></div>`);
    }
    if (q.mod === 'overview') return reply(`<span class="playername_achievement">${ME}</span><script>new BagLoader(jQuery('#inv'), jQuery('#inventory_nav'), JSON.parse('[[],[],[],[],[],[],[],[]]'));</script>`);
    if (q.mod === 'guildMarket') {
      if (init.method === 'POST' && body.sellid) {
        state.calls.push(`list ${body.sellid} for ${body.preis} (${body.dauer})`);
        const item = state.bag.find((b) => String(b.id) === body.sellid);
        state.bag = state.bag.filter((b) => b !== item);
        state.listings.push({ ...item, buyid: item.id, seller: ME, price: Number(body.preis) });
      } else if (init.method === 'POST' && body.cancel) {
        state.calls.push(`cancel ${body.buyid}`);
        if (cancelWorks) {
          const l = state.listings.find((x) => String(x.buyid) === body.buyid);
          state.listings = state.listings.filter((x) => x !== l);
          state.packages.unshift({ ...l, cn: -99, left: 168 * HOUR });
        }
      }
      const table = state.listings.length ? `<table id="market_item_table"><tr><th>Item</th></tr>${state.listings.map(row).join('')}</table>` : '';
      return reply(`<div id="content"><form id="sellForm" method="post"><input name="sellid"><input name="preis"><select name="dauer"></select><input type="submit" name="anbieten" value="Offer"></form>${table}</div>`);
    }
    throw new Error(`unexpected request ${url}`);
  };
  return { state, fetch };
}

function context() {
  const logs = [];
  const alerts = [];
  const memory = brain.createMemory(NOW);
  const settings = S.sanitizeSettings({
    enabled: true,
    smelting: { auto: false },
    heal: { bags: { b1: true, b2: false, b3: false, b4: false, b5: false, b6: false, b7: false, b8: false } },
    packages: { enabled: true, storeResources: false, expiring: 'renew', expiringHours: 24 },
  });
  return {
    logs,
    alerts,
    ctx: { state: { sh: 'abc', gold: 100000 }, settings, memory, log: (l, m) => logs.push(`${l}: ${m}`), notify: (k, m) => alerts.push(m), humanDelay: async () => {}, persist: async () => {}, now: () => NOW },
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

test('renewing: listed for 1 gold for 2 hours, cancelled, back as a new package; soul-bound items go to a bag', async () => {
  const game = renewGame();
  const { ctx, logs } = context();
  await withGame(game, () => GBot.actions.packages(ctx));
  assert.deepEqual(game.state.calls, ['move -10 -> 513', 'list 710 for 1 (1)', 'cancel 710', 'move -11 -> 513']);
  assert.deepEqual(logs, [
    'info: Renewed Old ring: listed for 1 gold in the guild market and cancelled, so it is a new package again',
    'info: Moved Flask of Strength into your bags; its package was about to expire',
  ]);
  assert.deepEqual(game.state.listings, [], 'nothing left for sale');
  assert.equal(game.state.packages.find((p) => p.name === 'Old ring').left, 168 * HOUR, 'a fresh package');
  assert.equal(ctx.memory.stats.renewed, 1);
});

test('renewing: a listing that cannot be cancelled is reported and renewing pauses for a day', async () => {
  const game = renewGame({ cancelWorks: false });
  const { ctx, logs, alerts } = context();
  await assert.rejects(withGame(game, () => GBot.actions.packages(ctx)), /listed in the guild market for 1 gold and Lanista could not cancel it/);
  assert.equal(alerts.length, 1);
  assert.equal(ctx.memory.renewBlockedUntil, NOW + 24 * HOUR);
  assert.deepEqual(logs, []);

  // Meanwhile packages about to expire are moved into a bag instead.
  game.state.packages.push({ cn: -13, name: 'Old amulet', type: 1024, left: HOUR });
  ctx.memory.nextPackagesCheck = 0;
  await withGame(game, () => GBot.actions.packages(ctx));
  assert.ok(game.state.calls.includes('move -13 -> 513'));
  assert.ok(!game.state.calls.includes('list 713 for 1 (1)'), 'not listed');
});
