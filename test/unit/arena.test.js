'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { brain, settings: S, state: stateModule } = require('./load');
require('../../src/content/actions.js');

const NOW = 1_700_000_000_000;
const URL_BASE = 'https://s303-en.gladiatus.gameforge.com/game/index.php';

// Arena Provinciarum as on s303-en (2026-10-11): name (a link to the
// player's profile on their server), level, server, attack button.
const players = [
  ['RAMBO', 101438, 106],
  ['IngenuiNonianus', 421334, 101],
  ['Makicious', 52011, 109],
];
const arenaPage = `<div id="header_game"></div><div id="header_values_hp_bar" data-value="9000" data-max-value="11600"></div>
  <div id="content"><table id="own2"><tr><th>Name</th><th>Level</th><th>Province</th><th></th></tr>
  ${players
    .map(
      ([name, p, level]) => `<tr><td><span class="floatEnd"></span><a target="_blank" href="https://s55-en.gladiatus.gameforge.com/game/index.php?mod=player&amp;p=${p}&amp;language=us">${name}</a></td>
      <td>${level}</td><td>55</td><td><div class="attack" onclick="startProvinciarumFight(this, 2, ${p}, 55, 'en');"></div></td></tr>`
    )
    .join('')}</table></div>`;

async function attack(arena, ranked) {
  const dom = new JSDOM(arenaPage, { url: `${URL_BASE}?mod=arena&submod=serverArena&aType=2&sh=x` });
  const st = stateModule.readState(dom.window.document, dom.window.location, NOW);
  const saved = { document: globalThis.document, location: globalThis.location, scout: GBot.scout };
  Object.assign(globalThis, { document: dom.window.document, location: dom.window.location });
  const asked = [];
  GBot.scout = {
    rank: async (ctx, type, opponents) => {
      asked.push(opponents.map((o) => o.name));
      return ranked(opponents);
    },
  };
  const clicked = [];
  const logs = [];
  let unloading = false;
  dom.window.document.querySelectorAll('.attack').forEach((el) =>
    el.addEventListener('click', () => {
      clicked.push(el.closest('tr').querySelector('a').textContent);
      unloading = true;
    })
  );
  const memory = brain.createMemory(NOW);
  memory.pending = { type: 'arena', at: NOW, attempts: 1, firstAt: NOW };
  const ctx = {
    state: st,
    settings: S.sanitizeSettings({ enabled: true, arena: { enabled: true, target: 'lowest', ...arena } }),
    memory,
    log: (l, m) => logs.push(`${l}: ${m}`),
    humanDelay: async () => {},
    persist: async () => {},
    isUnloading: () => unloading,
    navigate: async (url, what) => ({ navigated: true, url, what }),
    url: (p) => `${URL_BASE}?${new URLSearchParams(p)}`,
    now: () => NOW,
  };
  try {
    const result = await GBot.actions.arena(ctx, { type: 'arena' });
    return { result, clicked, logs, memory, asked };
  } finally {
    Object.assign(globalThis, saved);
    GBot.scout = saved.scout;
  }
}

test('arena: the simulated order is followed, and the chance is in the log', async () => {
  const run = await attack({}, (list) => {
    const by = Object.fromEntries(list.map((o) => [o.name, o]));
    return { order: [by.Makicious, by.RAMBO, by.IngenuiNonianus], chances: new Map([[by.Makicious, 0.84], [by.RAMBO, 0.4]]) };
  });
  assert.deepEqual(run.asked, [['IngenuiNonianus', 'RAMBO', 'Makicious']], 'handed over in your order (weakest first)');
  assert.deepEqual(run.clicked, ['Makicious']);
  assert.ok(run.logs.includes('debug: Click: attack arena provinciarum opponent Makicious (level 109, 84% to win)'), run.logs.join(' | '));
  assert.equal(run.result.navigated, true);
  assert.equal(run.memory.pending.chance, 84, 'kept for the result line');
});

test('arena: nobody likely enough to be beaten, with "wait": no attack for 30 minutes', async () => {
  const run = await attack({ minChance: 75, ifNone: 'wait' }, () => ({ wait: true, best: 0.52, chances: new Map() }));
  assert.deepEqual(run.clicked, []);
  assert.deepEqual(run.result, { retick: true });
  assert.equal(run.memory.blockedUntil.arena, NOW + 30 * 60 * 1000);
  assert.equal(run.memory.pending, null);
  assert.ok(run.logs.includes('info: arena provinciarum: no opponent with at least 75% chance to win (the best has 52%); looking again in 30 minutes'), run.logs.join(' | '));
});

test('arena: without the simulation the opponents are not sized up', async () => {
  const run = await attack({ simulate: false }, () => assert.fail('not asked'));
  assert.deepEqual(run.asked, []);
  assert.deepEqual(run.clicked, ['IngenuiNonianus'], 'the weakest by level, as before');
});
