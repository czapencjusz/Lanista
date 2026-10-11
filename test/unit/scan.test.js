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
const tip = (name) => JSON.stringify([[[name, 'white']]]).replace(/"/g, '&quot;');

// The packages as the game lists them: 15 a page, in the account's order
// (del_asc = soonest to expire first, in_desc = newest first), which the
// game settings page shows and a POST to packages/sort changes.
function sortedGame({ count = 60, sort = 'del_desc' } = {}) {
  const state = {
    sort,
    calls: [],
    gold: 0,
    // cn -1 is the newest, expiring last; -60 the oldest, expiring first.
    packages: Array.from({ length: count }, (_, i) => ({ cn: -(i + 1), name: `Junk ${i + 1}`, left: (168 - i * 3) * HOUR, born: count - i })),
  };
  const order = () => {
    const list = state.packages.slice();
    if (state.sort.startsWith('del')) list.sort((a, b) => a.left - b.left);
    else list.sort((a, b) => a.born - b.born);
    return state.sort.endsWith('desc') ? list.reverse() : list;
  };
  const pkg = (p) =>
    `<div class="packageItem"><div data-container-number="${p.cn}"><div data-content-type="${p.gold ? 0 : p.type || 64}" data-tooltip="${tip(p.name)}" data-price-gold="10"></div></div><span data-ticker-time-left="${p.left}"></span></div>`;
  const reply = (text) => ({ ok: true, text: async () => text });
  const fetch = async (url, init = {}) => {
    const q = Object.fromEntries(new URL(url).searchParams);
    if (q.submod === 'move') {
      const p = state.packages.find((x) => x.cn === Number(q.from));
      state.packages = state.packages.filter((x) => x !== p);
      state.calls.push(`move ${q.from}`);
      if (p && p.gold) state.gold += p.gold;
      return reply(JSON.stringify(p && p.gold ? {} : { to: { data: { itemId: 500 - Number(q.from) } } }));
    }
    if (q.mod === 'overview') {
      state.calls.push('overview');
      return reply(`<div id="sstat_gold_val">${state.gold}</div><script>new BagLoader(a, b, JSON.parse('[[],[],[],[],[],[],[],[]]'));</script>`);
    }
    if (q.submod === 'sort') {
      state.sort = new URLSearchParams(init.body).get('packageSorting');
      state.calls.push(`sort ${state.sort}`);
      return reply('');
    }
    if (q.mod === 'settings') {
      state.calls.push('settings');
      const options = ['del_asc', 'del_desc', 'in_asc', 'in_desc'].map((v) => `<option ${v === state.sort ? 'selected="selected" ' : ''}value="${v}">${v}</option>`).join('');
      return reply(`<select name="packageSorting">${options}</select>`);
    }
    if (q.mod === 'packages') {
      const page = Number(q.page || 1);
      const list = order();
      const pages = Math.max(1, Math.ceil(list.length / 15));
      state.calls.push(`page ${page}`);
      const links = Array.from({ length: pages }, (_, i) => `<a href="index.php?mod=packages&amp;page=${page}&amp;sh=abc&amp;page=${i + 1}">${i + 1}</a>`).join('');
      return reply(`<div id="packages">${list.slice((page - 1) * 15, page * 15).map(pkg).join('')}</div><div class="pagination">${links}</div>`);
    }
    throw new Error(`unexpected ${url}`);
  };
  return { state, fetch };
}

function context(settings) {
  const logs = [];
  const memory = brain.createMemory(NOW);
  let now = NOW;
  return {
    logs,
    memory,
    tick: (ms) => (now += ms),
    ctx: () => ({ state: { sh: 'abc', gold: 100000 }, settings: S.sanitizeSettings(settings), memory, log: (l, m) => logs.push(`${l}: ${m}`), humanDelay: async () => {}, persist: async () => {}, now: () => now }),
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

const rules = { enabled: true, packages: { enabled: true, storeResources: false, collectGold: false, expiring: 'off' }, smelting: { auto: false } };

test('packages: everything is read once; then only the new ones, sorted newest first, and the order is put back', async () => {
  const game = sortedGame();
  const run = context(rules);
  await withGame(game, () => GBot.actions.packages(run.ctx()));
  assert.deepEqual(game.state.calls, ['page 1', 'page 2', 'page 3', 'page 4'], 'the first pass reads all four pages, in your order');
  assert.equal(run.memory.packagesKnown.length, 60);

  game.state.calls = [];
  run.tick(30 * 60 * 1000);
  await withGame(game, () => GBot.actions.packages(run.ctx()));
  assert.deepEqual(game.state.calls, ['settings', 'sort in_desc', 'page 1', 'sort del_desc'], 'one page: all of it seen before');
  assert.equal(game.state.sort, 'del_desc', 'your order is back');

  // Two new packages: the first page has something new, the second not.
  game.state.packages.push({ cn: -100, name: 'New ring', left: 168 * HOUR, born: 100, type: 48 }, { cn: -101, name: 'New sword', left: 168 * HOUR, born: 101, type: 2 });
  game.state.calls = [];
  run.tick(30 * 60 * 1000);
  const smelty = context({ ...rules, smelting: { enabled: true, auto: true, autoUpTo: 4, autoTypes: { weapons: true, armour: false, jewellery: false } } });
  smelty.memory.packagesKnown = run.memory.packagesKnown;
  smelty.memory.packagesFullAt = run.memory.packagesFullAt;
  smelty.memory.packagesRules = JSON.stringify([smelty.ctx().settings.packages, smelty.ctx().settings.smelting]);
  smelty.tick(30 * 60 * 1000);
  await withGame(game, () => GBot.actions.packages(smelty.ctx()));
  assert.deepEqual(game.state.calls, ['settings', 'sort in_desc', 'page 1', 'page 2', 'sort del_desc']);
  assert.deepEqual(smelty.memory.smeltQueue.map((e) => e.name), ['New sword'], 'the new sword matched the smelting rule');
});

test('packages: those about to expire are read sorted soonest first, up to the first one outside the window', async () => {
  const game = sortedGame({ sort: 'in_desc' });
  const run = context({ ...rules, packages: { ...rules.packages, expiring: 'bag', expiringHours: 24 } });
  run.memory.packagesKnown = game.state.packages.map((p) => p.cn);
  run.memory.packagesFullAt = NOW;
  run.memory.packagesRules = JSON.stringify([run.ctx().settings.packages, run.ctx().settings.smelting]);
  game.state.packages = game.state.packages.filter((p) => p.left > 24 * HOUR);
  await withGame(game, () => GBot.actions.packages(run.ctx()));
  assert.deepEqual(game.state.calls, ['settings', 'sort del_asc', 'page 1', 'sort in_desc', 'page 1'], 'nothing expires: one page each, and in_desc was yours already');
  assert.equal(game.state.sort, 'in_desc');
});

test('packages: a settings change, 6 hours, or an unreadable order mean reading everything', async () => {
  const game = sortedGame();
  const run = context(rules);
  await withGame(game, () => GBot.actions.packages(run.ctx()));
  game.state.calls = [];
  run.tick(7 * HOUR);
  await withGame(game, () => GBot.actions.packages(run.ctx()));
  assert.deepEqual(game.state.calls, ['page 1', 'page 2', 'page 3', 'page 4'], 'after 6 hours');

  game.state.calls = [];
  run.tick(10 * 60 * 1000);
  const changed = context({ ...rules, packages: { ...rules.packages, keepNames: 'Junk 7' } });
  Object.assign(changed.memory, { packagesKnown: run.memory.packagesKnown, packagesFullAt: run.memory.packagesFullAt, packagesRules: run.memory.packagesRules });
  await withGame(game, () => GBot.actions.packages(changed.ctx()));
  assert.equal(game.state.calls.length, 4, 'after the rules changed');

  game.state.calls = [];
  game.state.sort = 'mystery';
  run.tick(10 * 60 * 1000);
  await withGame(game, () => GBot.actions.packages(run.ctx()));
  assert.deepEqual(game.state.calls, ['settings', 'page 1', 'page 2', 'page 3', 'page 4'], 'an order it cannot put back is left alone');
});

test('packages: queued gear left over at the move limit does not make the next pass read everything again', async () => {
  // 12 swords ticked for smelting expire soon; renewing is paused, so they
  // go into the bags, 10 a pass.
  const game = sortedGame({ count: 12, sort: 'in_desc' });
  game.state.packages.forEach((p) => Object.assign(p, { type: 2, left: 5 * HOUR }));
  const run = context({ ...rules, packages: { ...rules.packages, expiring: 'renew', expiringHours: 24 }, smelting: { enabled: true, auto: true, autoUpTo: 4, autoTypes: { weapons: true, armour: false, jewellery: false } } });
  run.memory.smeltQueue = game.state.packages.map((p) => ({ cn: p.cn, name: p.name, basis: '', w: 1, h: 1 }));
  run.memory.renewBlockedUntil = NOW + 24 * HOUR;
  await withGame(game, () => GBot.actions.packages(run.ctx()));
  assert.equal(game.state.calls.filter((c) => c.startsWith('move')).length, 10);
  assert.ok(run.memory.packagesFullAt > 0, 'only expiring ones were left: no full read needed');
  assert.equal(run.memory.smeltQueue.filter((e) => e.iid).length, 10, 'the ones in the bags are smelted from there');

  game.state.calls = [];
  run.tick(60 * 1000);
  await withGame(game, () => GBot.actions.packages(run.ctx()));
  assert.equal(game.state.calls[0], 'settings', 'the next pass sorts instead of reading everything');
  assert.equal(game.state.calls.filter((c) => c.startsWith('move')).length, 2);
});

test('packages: gold in a package about to expire is taken out before it is lost', async () => {
  const game = sortedGame({ count: 3 });
  game.state.packages.push({ cn: -50, name: '300.000 Gold', left: 3 * HOUR, born: 0, gold: 300000 });
  const run = context({ ...rules, packages: { ...rules.packages, expiring: 'renew', expiringHours: 24 } });
  await withGame(game, () => GBot.actions.packages(run.ctx()));
  assert.ok(game.state.calls.includes('move -50'));
  assert.equal(game.state.gold, 300000);
  assert.ok(run.logs.includes('info: Took 300,000 gold out of a gold package about to expire (the gold would be lost with it)'), run.logs.join(' | '));
  assert.equal(run.memory.stats.goldCollected, 300000);
  assert.ok(!run.logs.some((l) => /did not take/.test(l)));
});

test('packages: an order left switched by a pass cut short is put back by the next one', async () => {
  // A pass was stopped (extension reloaded) while the packages were sorted
  // soonest to expire first; the player's order was newest first.
  const game = sortedGame({ sort: 'del_asc' });
  const run = context({ ...rules, packages: { ...rules.packages, expiring: 'bag', expiringHours: 24 } });
  run.memory.packagesKnown = game.state.packages.map((p) => p.cn);
  run.memory.packagesFullAt = NOW;
  run.memory.packagesRules = JSON.stringify([run.ctx().settings.packages, run.ctx().settings.smelting]);
  run.memory.packageSortWas = 'in_desc';
  game.state.packages = game.state.packages.filter((p) => p.left > 24 * HOUR);
  await withGame(game, () => GBot.actions.packages(run.ctx()));
  assert.deepEqual(game.state.calls, ['settings', 'page 1', 'sort in_desc', 'page 1'], 'del_asc is taken as the pass\'s own order, not the player\'s');
  assert.equal(game.state.sort, 'in_desc');
  assert.equal(run.memory.packageSortWas, null);

  // Cut short again, and this time everything is due to be read: the order
  // is still put back.
  game.state.sort = 'del_asc';
  run.memory.packageSortWas = 'in_desc';
  game.state.calls = [];
  run.tick(7 * HOUR);
  await withGame(game, () => GBot.actions.packages(run.ctx()));
  assert.deepEqual(game.state.calls.filter((c) => !c.startsWith('page')), ['settings', 'sort in_desc']);
  assert.equal(game.state.sort, 'in_desc');
  assert.equal(run.memory.packageSortWas, null);
});

test('packages: the player\'s order is saved before it is changed', async () => {
  const game = sortedGame({ sort: 'in_desc' });
  const run = context({ ...rules, packages: { ...rules.packages, expiring: 'bag', expiringHours: 24 } });
  run.memory.packagesKnown = game.state.packages.map((p) => p.cn);
  run.memory.packagesFullAt = NOW;
  run.memory.packagesRules = JSON.stringify([run.ctx().settings.packages, run.ctx().settings.smelting]);
  game.state.packages = game.state.packages.filter((p) => p.left > 24 * HOUR);
  const saved = [];
  const ctx = { ...run.ctx(), persist: async () => saved.push([run.memory.packageSortWas, game.state.sort]) };
  await withGame(game, () => GBot.actions.packages(ctx));
  assert.deepEqual(saved[0], ['in_desc', 'in_desc'], 'saved while the order was still the player\'s');
  assert.equal(game.state.sort, 'in_desc');
  assert.equal(run.memory.packageSortWas, null);
});
