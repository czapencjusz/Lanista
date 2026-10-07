'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { brain, settings: settingsModule } = require('./load');

const window = new JSDOM('<meta name="csrf-token" content="tok">', { url: 'https://s1-en.gladiatus.gameforge.com/game/index.php' }).window;
globalThis.DOMParser = window.DOMParser;
require('../../src/content/workbench.js');
require('../../src/content/packages.js');
const smelter = require('../../src/content/smelter.js');

const NOW = 1_700_000_000_000;
const CN = -306687977;
const ITEM_ID = 275696479;
const entry = { cn: CN, name: 'Táliths Sandals', basis: '8-1', w: 2, h: 2 };

// Page shapes from s60-en (2026-09), trimmed to what the bot reads.
const tip = (name) => JSON.stringify([[[name, 'lime']]]).replace(/"/g, '&quot;');
const packageHtml = (cn, name) =>
  `<div class="packageItem"><div data-container-number="${cn}"><div data-content-type="512" data-basis="8-1" data-measurement-x="2" data-measurement-y="2" data-tooltip="${tip(name)}"></div></div></div>`;
const packagesPage = (present, extra) =>
  present ? packageHtml(CN, 'Táliths Sandals') + extra.map((e) => packageHtml(e.cn, e.name)).join('') : '<div id="packages_wrapper"></div>';
const bagLiteral = JSON.stringify([[], [], [], [], [], [], [], []]).replace(/"/g, '\\"');
const overviewPage = `<script>new BagLoader(jQuery('#inv'), jQuery('#inventory_nav'), JSON.parse('${bagLiteral}'));</script>`;
const smelteryPage = (slots) => `<script>var slotsData = ${JSON.stringify(slots)};\nvar x = 1;</script>`;
const RELOAD = 'document.location.href=document.location.href;';

// A mock game: answers the smelter's requests and records them. As on the
// live server, renting a smelter slot starts smelting at once and a separate
// "start" is refused with HTTP 400 (rentStarts: false mimics the workbench,
// where the slot waits for "start").
// Packages may run to many pages; `page` puts the ticked one on that page
// (the others are filled with other packages), and the page links repeat
// the current page before the one they go to, as the game's do.
// `ignoreMove`: the game answers the move without doing it.
function mockGame({ slots, present = true, rentStarts = true, extra = [], page = 1, pages = 1, ignoreMove = false }) {
  const calls = [];
  let smelterSlots = slots;
  const setSlot = (body, value) => {
    const n = Number(/slot=(\d+)/.exec(body)[1]);
    smelterSlots = smelterSlots.map((s, i) => (i === n ? value : s));
  };
  const crafting = { 'forge_slots.state': 'crafting', 'forge_slots.finishedIn': 3382 };
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body || '';
    const q = u.searchParams;
    const detail = q.get('submod') === 'move' ? `from=${q.get('from')} to=${q.get('to')} at=${q.get('toX')},${q.get('toY')}` : body.replace(/&a=\d+&sh=abc$/, '');
    calls.push(`${q.get('mod')}/${q.get('submod') || ''} ${detail}`.trim());
    const reply = (text) => ({ ok: true, text: async () => text });
    if (u.pathname.endsWith('index.php')) {
      if (u.searchParams.get('mod') === 'packages') {
        const n = Number(u.searchParams.get('page') || 1);
        const links = Array.from({ length: pages }, (_, i) => `<a href="index.php?mod=packages&amp;f=0&amp;fq=-1&amp;qry=&amp;page=${n}&amp;sh=abc&amp;page=${i + 1}">${i + 1}</a>`).join('');
        const items = n === page ? packagesPage(present, extra) : packageHtml(-1000 - n, 'Someone else');
        return reply(`<div class="pagination">${links}</div>${items}`);
      }
      if (u.searchParams.get('mod') === 'overview') return reply(overviewPage);
      return reply(smelteryPage(smelterSlots));
    }
    const submod = u.searchParams.get('submod');
    if (submod === 'move') {
      const from = Number(q.get('from'));
      const there = (present && from === CN) || extra.some((e) => e.cn === from);
      if (!there) return reply(JSON.stringify({ error: 'This item does not exist.' }));
      return reply(JSON.stringify(ignoreMove ? {} : { to: { data: { itemId: ITEM_ID } } }));
    }
    if (submod === 'getSmeltingPreview') {
      // All six slots, with the preview in the one asked about.
      const n = Number(/slot=(\d+)/.exec(body)[1]);
      const preview = { 'forge_slots.state': 'closed', formula: { rent: { 2: 902, 3: 1 }, duration: 3382 } };
      return reply(JSON.stringify({ slots: smelterSlots.map((s, i) => (i === n ? preview : s)) }));
    }
    if (submod === 'rent') setSlot(body, rentStarts ? crafting : { 'forge_slots.state': 'opened' });
    if (submod === 'start') {
      const n = Number(/slot=(\d+)/.exec(body)[1]);
      if (smelterSlots[n]['forge_slots.state'] !== 'opened') return { ok: false, status: 400, text: async () => '' };
      setSlot(body, crafting);
    }
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
    'overview/',
    `inventory/move from=${CN} to=512 at=1,1`,
    `forge/getSmeltingPreview mod=forge&submod=getSmeltingPreview&mode=smelting&slot=0&iid=${ITEM_ID}&amount=1`,
    `forge/rent mod=forge&submod=rent&mode=smelting&slot=0&rent=2&item=${ITEM_ID}`,
    'forge/smeltery',
    'forge/smeltery',
  ]);
  assert.ok(!game.calls.some((c) => c.startsWith('forge/start')), 'renting already starts the smelt');
  assert.deepEqual(ctx.memory.smeltQueue, []);
  assert.equal(ctx.memory.stats.goldSpent, 902);
  assert.equal(ctx.memory.smeltNext, NOW + 3382 * 1000 + 5000, 'back when the smelt is done');
  assert.deepEqual(logs, ['info: Smelting Táliths Sandals (56:22, 902 gold)']);
});

test('one run fills every free slot from the queue (the 4-of-6 slots bug)', async () => {
  const more = [
    { cn: -11, name: 'Bilgs Sugilith pendant of Blocking', basis: '8-1', w: 2, h: 2 },
    { cn: -12, name: 'Frientas Gold symbol of Calling', basis: '8-1', w: 2, h: 2 },
  ];
  const slots = closed();
  slots[0] = { 'forge_slots.state': 'crafting', 'forge_slots.finishedIn': 1432 };
  slots[1] = { 'forge_slots.state': 'crafting', 'forge_slots.finishedIn': 4251 };
  slots[2] = { 'forge_slots.state': 'crafting', 'forge_slots.finishedIn': 2352 };
  slots[3] = { 'forge_slots.state': 'crafting', 'forge_slots.finishedIn': 5748 };
  const game = mockGame({ slots, extra: more });
  const { ctx } = context(1_000_000, [entry, ...more]);
  await withGame(game, () => GBot.actions.smelt(ctx));
  const rented = game.calls.filter((c) => c.startsWith('forge/rent')).map((c) => /slot=(\d)/.exec(c)[1]);
  assert.deepEqual(rented, ['4', '5'], 'slots 5 and 6 filled in the same run');
  assert.equal(ctx.memory.smeltQueue.length, 1, 'the third item waits for a free slot');
  assert.equal(ctx.memory.smeltNext, NOW + 1432 * 1000 + 5000, 'back when the first slot is free');
});

test('if the smelter ever waits for "start" after renting, the bot sends it', async () => {
  const game = mockGame({ slots: closed(), rentStarts: false });
  const { ctx } = context();
  await withGame(game, () => GBot.actions.smelt(ctx));
  assert.ok(game.calls.includes('forge/start mod=forge&submod=start&mode=smelting&slot=0'));
  assert.deepEqual(ctx.memory.smeltQueue, []);
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
  assert.ok(gone.calls.indexOf('packages/') > gone.calls.findIndex((c) => c.startsWith('inventory/move')), 'looked for only after the move was refused');

  const poor = mockGame({ slots: closed() });
  const second = context(500);
  await assert.rejects(withGame(poor, () => GBot.actions.smelt(second.ctx)), /Not enough gold to smelt Táliths Sandals \(902\); it stays in your bag/);
  assert.ok(!poor.calls.some((c) => c.startsWith('forge/rent')), 'never rented');
  assert.deepEqual(second.ctx.memory.smeltQueue, [], 'moved to the bag, so out of the queue');
  assert.equal(second.ctx.memory.smeltNext, NOW + 10 * 60 * 1000);
});

test('a ticked item far back in the packages stays queued (s303 had 51 pages)', async () => {
  // The move goes straight to the package: no paging at all.
  const far = mockGame({ slots: closed(), page: 37, pages: 51 });
  const first = context();
  await withGame(far, () => GBot.actions.smelt(first.ctx));
  assert.ok(!far.calls.includes('packages/'));
  assert.match(first.logs[0], /^info: Smelting Táliths Sandals/);

  // The game ignores the move: the package is still there (on page 37),
  // so it stays queued and the failure counts against it.
  const stuck = mockGame({ slots: closed(), page: 37, pages: 51, ignoreMove: true });
  const second = context();
  await assert.rejects(withGame(stuck, () => GBot.actions.smelt(second.ctx)), /did not move Táliths Sandals out of its package/);
  assert.equal(stuck.calls.filter((c) => c === 'packages/').length, 37, 'every page up to the one with it');
  assert.deepEqual(second.ctx.memory.smeltQueue, [entry], 'still ticked');
  assert.equal(second.ctx.memory.smeltFailures, 1);
});

test('the last page is read from page links that repeat the current page first', () => {
  const doc = new window.DOMParser().parseFromString(
    '<div class="pagination"><a href="index.php?mod=packages&amp;f=0&amp;qry=&amp;page=1&amp;sh=x&amp;page=2">2</a><a href="index.php?mod=packages&amp;page=1&amp;sh=x&amp;page=51">51</a></div>',
    'text/html'
  );
  assert.equal(GBot.packages.lastPage(doc), 51);
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

test('the queue: the item smelted leaves it, even when the list changed meanwhile', async () => {
  // While the first item is being moved, the player unticks it and ticks
  // another on the packages page.
  const other = { cn: -12, name: 'Bilgs Sugilith pendant', basis: '8-1', w: 1, h: 1 };
  const game = mockGame({ slots: [{ 'forge_slots.state': 'closed' }] });
  const { ctx } = context(1_000_000, [entry, other]);
  const fetch = game.fetch;
  game.fetch = async (url, init) => {
    if (/submod=move/.test(url)) ctx.memory.smeltQueue.splice(1, 1); // `other` unticked meanwhile
    return fetch(url, init);
  };
  await withGame(game, () => GBot.actions.smelt(ctx));
  assert.deepEqual(ctx.memory.smeltQueue, [], 'the smelted one left; the unticked one is gone too, nothing else');

  const game2 = mockGame({ slots: [{ 'forge_slots.state': 'closed' }] });
  const { ctx: ctx2 } = context(1_000_000, [entry, other]);
  const fetch2 = game2.fetch;
  game2.fetch = async (url, init) => {
    if (/submod=move/.test(url) && ctx2.memory.smeltQueue[0] === entry) ctx2.memory.smeltQueue.unshift({ cn: -99, name: 'New tick', w: 1, h: 1 });
    return fetch2(url, init);
  };
  await withGame(game2, () => GBot.actions.smelt(ctx2));
  assert.deepEqual(ctx2.memory.smeltQueue.map((e) => e.cn), [-99, -12], 'only the smelted item left the queue (it used to drop the first one)');
});

test('the queue is merged with changes another tab saved meanwhile', () => {
  const a = { cn: -1 };
  const b = { cn: -2 };
  const c = { cn: -3 };
  const bin = { iid: '77' };
  // This tab read [a, b]; it smelted a and queued the bin item. Another tab
  // meanwhile unticked b and ticked c.
  const merged = brain.mergeSmeltQueue(brain.smeltKeys([a, b]), [b, bin], [a, c]);
  assert.deepEqual(brain.smeltKeys(merged), ['cn:-3', 'iid:77']);
  // Nobody else changed it: this tab's queue as it is.
  const mine = [b, bin];
  assert.equal(brain.mergeSmeltQueue(brain.smeltKeys([a, b]), mine, [a, b]), mine);
});
