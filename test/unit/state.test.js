'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { state: stateModule } = require('./load');
const html = require('../fixtures/game-html');

const BASE = 'https://s1-en.gladiatus.gameforge.com/game/index.php';

function read(markup, url = `${BASE}?mod=overview&sh=abc123`) {
  const dom = new JSDOM(markup, { url });
  return stateModule.readState(dom.window.document, dom.window.location, 1000);
}

test('reads header values', () => {
  const s = read(html.page({ headerOpts: { hp: 250, hpMax: 1000, gold: 1234567, expPoints: 7, dunPoints: 0 } }));
  assert.equal(s.inGame, true);
  assert.equal(s.sh, 'abc123');
  assert.equal(s.page.mod, 'overview');
  assert.deepEqual(s.hp, { value: 250, max: 1000, percent: 25, regenPerHour: 600 });
  assert.equal(s.level, 25);
  assert.equal(s.gold, 1234567);
  assert.equal(s.expedition.points, 7);
  assert.equal(s.expedition.maxPoints, 24);
  assert.equal(s.dungeon.points, 0);
});

test('reads cooldown bars', () => {
  const s = read(html.page({ headerOpts: { cooldowns: { expedition: 0, dungeon: 323, arena: 3723, circus: 0 } } }));
  assert.equal(s.expedition.ready, true);
  assert.equal(s.expedition.remainingMs, 0);
  assert.equal(s.expedition.link, `${BASE}?mod=location&loc=3&sh=abc123`);
  assert.equal(s.dungeon.ready, false);
  assert.equal(s.dungeon.remainingMs, 323000);
  assert.equal(s.arena.remainingMs, 3723000);
  assert.equal(s.circus.ready, true);
});

test('missing cooldown bar means the activity is unavailable', () => {
  const markup = html.page().replace(/<div id="cooldown_bar_ct"[\s\S]*?Go to circus turma<\/div>\s*<\/div>/, '');
  const s = read(markup);
  assert.equal(s.circus.available, false);
  assert.equal(s.arena.available, true);
});

test('falls back to the HP tooltip and points text', () => {
  const markup = html
    .page()
    .replace(/data-max-value="\d+" data-value="\d+"/, '')
    .replace(/<span id="expeditionpoints_value_point">\d+<\/span> \/ <span id="expeditionpoints_value_pointmax">\d+<\/span>/, '3 / 20');
  const s = read(markup);
  assert.equal(s.hp.value, 800);
  assert.equal(s.hp.max, 1000);
  assert.equal(s.expedition.points, 3);
  assert.equal(s.expedition.maxPoints, 20);
});

test('non-game pages are detected', () => {
  const s = read('<html><body><h1>Lobby</h1></body></html>', `${BASE}`);
  assert.equal(s.inGame, false);
});

test('page info and session hash from links', () => {
  const s = read(html.page({ bodyId: 'arenaPage' }), `${BASE}?mod=arena&submod=serverArena&aType=3`);
  assert.equal(s.page.mod, 'arena');
  assert.equal(s.page.submod, 'serverArena');
  assert.equal(s.page.aType, '3');
  assert.equal(s.page.bodyId, 'arenaPage');
  assert.equal(s.sh, 'abc123');
});

test('dialog visibility', () => {
  const extra = `<div id="blackoutDialogLoginBonus"><input type="button" value="Collect"></div>
                 <div id="blackoutDialognotification" style="display:none"><input type="button" value="OK"></div>`;
  const s = read(html.page({ extra }));
  assert.equal(s.dialogs.loginBonus, true);
  assert.equal(s.dialogs.notification, false);
});

test('reads expedition location names from the menu', () => {
  const s = read(html.page());
  assert.deepEqual(s.locations, [
    { id: '1', name: 'Grimwood' },
    { id: '2', name: 'Pirate Harbour' },
    { id: '3', name: 'Misty Mountains' },
  ]);
});
