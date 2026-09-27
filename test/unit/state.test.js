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

test('reads combat reports and the running dungeon name', () => {
  // Markup as on s60-en (2026-09); player names may contain digits.
  const report = (cls) => html.page({
    content: `<div id="reportHeader" class="${cls}">Winner: durky45</div>
      <div class="report_reward"><table><tr><td>
        <p><a>durky45</a> has raided: 1.513<img src="//x/img/res2.gif" title="Gold"></p>
        <p>durky45 received 7 experience point(s)</p>
        <p>durky45 has received 152 fame.</p>
      </td></tr></table></div>`,
  });
  const win = read(report('reportWin'), `${BASE}?mod=reports&submod=showCombatReport&sh=abc`);
  assert.deepEqual(win.report, { win: true, gold: 1513, xp: 7, renown: 152 });
  assert.equal(read(report('reportLose'), `${BASE}?mod=reports&sh=abc`).report.win, false);

  // Arena win: the raided amount, not the winner's reward after it.
  const arena = read(
    html.page({
      content: `<div id="reportHeader" class="reportWin">Winner: Virgl</div><div class="report_reward">
        <p><a>Virgl</a> has raided: 780<img src="//x/res2.gif"><br>From winner\`s reward: 252<img src="//x/res2.gif"></p>
        <p><a>Virgl</a> received 3 experience point(s)</p><p><a>Virgl</a> has received 53 honor</p></div>`,
    }),
    `${BASE}?mod=reports&sh=abc`
  );
  assert.deepEqual(arena.report, { win: true, gold: 780, xp: 3, renown: 53 });
  assert.equal(read(report('reportWin')).report, null, 'only on report pages');

  const dungeon = read(
    html.page({ content: '<h3>Viking Camp<span>open until 30.09.2026</span></h3><img onclick="startFight(1)">' }),
    `${BASE}?mod=dungeon&loc=2&sh=abc`
  );
  assert.equal(dungeon.dungeonName, 'Viking Camp');
});

test('reads which expedition bonuses can still be learned', () => {
  // Tooltip shapes from s60-en (2026-09): learned bonuses are .active, an
  // unlearned one has a ["Learning chance after a win:", "25%"] pair, the
  // boss's are granted automatically.
  const tip = (lines) => JSON.stringify([lines]).replace(/"/g, '&quot;');
  const learned = `<div class="expedition_bonus active buyable" data-tooltip="${tip([['Disembowler', 'lime'], ['+30% gold', '#DDD'], ['Click to deactivate the bonus', '#DDD']])}"></div>`;
  const open = `<div class="expedition_bonus buyable" data-tooltip="${tip([['Storyteller', 'lime'], ['+20% honour', '#DDD'], [['Learning chance after a win:', '25%'], ['#DDD', '#DDD']], ['Click to learn', '#DDD']])}"></div>`;
  const boss = `<div class="expedition_bonus" data-tooltip="${tip([['Storyteller', 'lime'], ['+20% honour', '#DDD'], ['Note: Will automatically be activated', '#DDD']])}"></div>`;
  const box = (i, name, bonuses) => `<div class="expedition_box"><div id="expedition_info${i}" data-tooltip="${tip([[name, 'white'], [['Level', '65 - 66'], ['white', 'white']]])}"></div>
    <div class="expedition_name">${name.slice(0, 14)}…</div><button class="expedition_button">Attack</button><div class="expedition_bonus_box">${bonuses}</div></div>`;
  const page = html.page({
    content:
      box(1, 'Skeleton Warrior', learned.repeat(4)) +
      box(2, 'Skeleton Berserker', learned + open.repeat(3)) +
      box(3, 'Lich', open.repeat(4)) +
      box(4, 'Necromancer Prince', boss.repeat(4)),
  });
  assert.deepEqual(stateModule.readExpeditionEnemies(new JSDOM(page).window.document), [
    { name: 'Skeleton Warrior', learnable: 0 },
    { name: 'Skeleton Berserker', learnable: 3 },
    { name: 'Lich', learnable: 4 },
    { name: 'Necromancer Prince', learnable: 0 },
  ]);
});
