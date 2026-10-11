'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { settings: S } = require('./load');
const { fighter, characterPage } = require('./profiles');

const window = new JSDOM('<table id="own2"></table>', { url: 'https://s303-en.gladiatus.gameforge.com/game/index.php?mod=arena&submod=serverArena&aType=2&sh=abc' }).window;
Object.assign(globalThis, { DOMParser: window.DOMParser, location: window.location, document: window.document });
require('../../src/content/sim.js');
require('../../src/content/workbench.js');
require('../../src/content/scout.js');
const GBot = globalThis.GBot;

const HOUR = 3600 * 1000;
const NOW = 1_700_000_000_000;

// An opponent row as Arena Provinciarum shows it: the name links to the
// player's profile on their own server.
function opponent(name, p, { href = `https://s55-en.gladiatus.gameforge.com/game/index.php?mod=player&p=${p}&language=us`, level = 106 } = {}) {
  const row = window.document.createElement('tr');
  row.innerHTML = `<td><a target="_blank" href="${href}">${name}</a></td><td>${level}</td><td>55</td><td><div class="attack"></div></td>`;
  return { name, level, row, attack: row.querySelector('.attack') };
}

// Profiles by player id ({ doll: fighter }), served as the game's pages.
function world(players, { dolls } = {}) {
  const asked = [];
  const fetchProfile = async (url) => {
    asked.push(url);
    const q = new URL(url).searchParams;
    const team = players[q.get('p')];
    if (!team) return { ok: true, error: 'Error: HTTP 503' };
    const doll = Number(q.get('doll') || 1);
    return { ok: true, html: characterPage(team[doll] || team[1], { doll, dolls }) };
  };
  return { asked, fetchProfile };
}

function context(w, arena = {}, circus = {}) {
  const logs = [];
  const store = {};
  let now = NOW;
  const ctx = {
    state: { sh: 'abc', hp: { value: 20060, max: 20060 } },
    settings: S.sanitizeSettings({ arena: { enabled: true, ...arena }, circus: { enabled: true, ...circus } }),
    memory: {},
    log: (l, m) => logs.push(`${l}: ${m}`),
    now: () => now,
    fetchProfile: w.fetchProfile,
    storeGet: async (k) => store[k],
    storeSet: async (k, v) => (store[k] = JSON.parse(JSON.stringify(v))),
  };
  return { ctx, logs, store, tick: (ms) => (now += ms), fresh: () => ({ ...ctx, simCache: undefined }) };
}

// Your own pages: the overview, one per doll.
async function withOwnPages(team, fn) {
  const real = GBot.forge.getDoc;
  const read = [];
  GBot.forge.getDoc = async (sh, params) => {
    read.push(params.doll || 1);
    return { doc: new DOMParser().parseFromString(characterPage(team[params.doll || 1], { doll: params.doll || 1 }), 'text/html') };
  };
  try {
    return await fn(read);
  } finally {
    GBot.forge.getDoc = real;
  }
}

const me = { 1: fighter({ name: 'DaddyCzapo' }) };
const weak = { 1: fighter({ name: 'Weak', dmg: [100, 120], hp: 3000, hpMax: 3000 }) };
const even = { 1: fighter({ name: 'Even' }) };
const strong = { 1: fighter({ name: 'Strong', dmg: [3000, 3200], abs: [600, 700], hp: 60000, hpMax: 60000 }) };

test('arena: likely wins first, in your order; then the rest, best chance first', async () => {
  const w = world({ 1: strong, 2: even, 3: weak });
  const run = context(w, { minChance: 60 });
  const list = [opponent('Strong', 1), opponent('Even', 2), opponent('Weak', 3)];
  const ranked = await withOwnPages(me, () => GBot.scout.rank(run.ctx, 'arena', list));
  assert.deepEqual(ranked.order.map((o) => o.name), ['Weak', 'Even', 'Strong']);
  assert.ok(ranked.chances.get(list[2]) > 0.95);
  assert.ok(ranked.chances.get(list[1]) > 0.3 && ranked.chances.get(list[1]) < 0.7);
  assert.ok(ranked.chances.get(list[0]) < 0.05);
  assert.deepEqual(w.asked, [1, 2, 3].map((p) => `https://s55-en.gladiatus.gameforge.com/game/index.php?mod=player&p=${p}&language=us`));
  assert.match(run.logs.find((l) => /chances to win/.test(l)), /^debug: arena: chances to win: Strong \d+%, Even \d+%, Weak \d+%$/);

  // Two likely wins: your "Opponent choice" order between them stays.
  const run2 = context(world({ 3: weak, 4: { 1: fighter({ name: 'Weak too', dmg: [100, 120] }) } }), { minChance: 60 });
  const two = [opponent('Weak too', 4), opponent('Weak', 3)];
  assert.deepEqual((await withOwnPages(me, () => GBot.scout.rank(run2.ctx, 'arena', two))).order.map((o) => o.name), ['Weak too', 'Weak']);
});

test('arena: with "wait", nobody good enough means no attack', async () => {
  const run = context(world({ 1: strong, 2: even }), { minChance: 80, ifNone: 'wait' });
  const list = [opponent('Strong', 1), opponent('Even', 2)];
  const ranked = await withOwnPages(me, () => GBot.scout.rank(run.ctx, 'arena', list));
  assert.equal(ranked.wait, true);
  assert.ok(ranked.best > 0.3 && ranked.best < 0.8, `the best chance is told: ${ranked.best}`);

  const run2 = context(world({ 1: strong, 3: weak }), { minChance: 80, ifNone: 'wait' });
  const ranked2 = await withOwnPages(me, () => GBot.scout.rank(run2.ctx, 'arena', [opponent('Strong', 1), opponent('Weak', 3)]));
  assert.deepEqual(ranked2.order.map((o) => o.name), ['Weak'], 'the unlikely ones are left out');
});

test('arena: your HP now counts; profiles are kept 6 hours, your own stats 30 minutes', async () => {
  const w = world({ 2: even });
  const run = context(w);
  const list = [opponent('Even', 2)];
  const full = await withOwnPages(me, async (read) => {
    const r = await GBot.scout.rank(run.ctx, 'arena', list);
    assert.deepEqual(read, [1]);
    return r.chances.get(list[0]);
  });
  run.ctx.state.hp = { value: 2000, max: 20060 };
  await withOwnPages(me, async (read) => {
    const low = (await GBot.scout.rank(run.fresh(), 'arena', list)).chances.get(list[0]);
    assert.ok(low < full, `${low} < ${full}`);
    assert.deepEqual(read, [], 'your stats came from the cache');
  });
  assert.equal(w.asked.length, 1, 'the profile too');

  run.tick(31 * 60 * 1000);
  await withOwnPages(me, async (read) => {
    await GBot.scout.rank(run.fresh(), 'arena', list);
    assert.deepEqual(read, [1], 'your stats are read again after 30 minutes');
  });
  assert.equal(w.asked.length, 1);
  run.tick(6 * HOUR);
  await withOwnPages(me, () => GBot.scout.rank(run.fresh(), 'arena', list));
  assert.equal(w.asked.length, 2, 'the profile is read again after 6 hours');
  assert.deepEqual(Object.keys(run.store['simCache:s303-en.gladiatus.gameforge.com']).sort(), ['arena:s55-en.gladiatus.gameforge.com:2', 'ours:arena']);
});

test('arena: a profile that cannot be read comes after the likely wins; none read means your order as before', async () => {
  const run = context(world({ 3: weak, 1: strong }), { minChance: 60 });
  const list = [opponent('Strong', 1), opponent('Gone', 9), opponent('Weak', 3)];
  const ranked = await withOwnPages(me, () => GBot.scout.rank(run.ctx, 'arena', list));
  assert.deepEqual(ranked.order.map((o) => o.name), ['Weak', 'Gone', 'Strong']);
  assert.ok(run.logs.some((l) => /^debug: arena: no simulation against Gone \(Error: HTTP 503\)$/.test(l)), run.logs.join(' | '));

  const run2 = context(world({}));
  const list2 = [opponent('A', 7), opponent('B', 8)];
  const ranked2 = await withOwnPages(me, () => GBot.scout.rank(run2.ctx, 'arena', list2));
  assert.deepEqual(ranked2.order, list2);
});

test('local arena: the profile link on this server is opened without the session', async () => {
  const w = world({ 5: weak });
  const run = context(w);
  const local = opponent('Neighbour', 5, { href: 'index.php?mod=player&p=5&sh=abc' });
  await withOwnPages(me, () => GBot.scout.rank(run.ctx, 'arena', [local]));
  assert.deepEqual(w.asked, ['https://s303-en.gladiatus.gameforge.com/game/index.php?mod=player&p=5']);
});

test('circus: both teams are read doll by doll, only the dolls there are', async () => {
  const team = (name, over = {}) => Object.fromEntries([2, 3, 4, 5, 6].map((d) => [d, fighter({ name: `${name} ${d}`, threat: d === 2 ? 600 : 200, ...over })]));
  const mine = { 1: fighter(), ...team('Mine') };
  const w = world({ 1: team('Theirs', { dmg: [100, 120] }) }, { dolls: { 1: null, 2: 'tank', 3: 'attacker', 4: 'healer' } });
  const run = context(w, {}, { minChance: 60 });
  const list = [opponent('Theirs', 1)];
  const ranked = await withOwnPages(mine, async (read) => {
    const r = await GBot.scout.rank(run.ctx, 'circus', list);
    assert.deepEqual(read, [2, 3, 4, 5, 6], 'your team: dolls 2 to 6');
    return r;
  });
  assert.deepEqual(
    w.asked.map((u) => new URL(u).searchParams.get('doll')),
    ['2', '3', '4'],
    'their profile shows three dolls besides the gladiator: only those are read'
  );
  assert.ok(ranked.chances.get(list[0]) > 0.9);
  const cached = run.store['simCache:s303-en.gladiatus.gameforge.com']['circus:s55-en.gladiatus.gameforge.com:1'];
  assert.deepEqual(cached.team.map((f) => f.role), ['tank', 'attacker', 'healer']);
});
