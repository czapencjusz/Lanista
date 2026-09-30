'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { brain, settings: S, selectors, state: stateModule } = require('./load');

const { SEL } = selectors;
const NOW = 1_700_000_000_000;

test('dungeon targets: the boss is skipped, and cancelled when it is all that is left', () => {
  const memory = brain.createMemory(NOW);
  const cfg = (extra) => S.sanitizeSettings({ dungeon: extra }).dungeon;
  // Page order on s303-en: the boss's area came first.
  const map = [{ position: 7, boss: true }, { position: 2, boss: false }, { position: 3, boss: false }];
  assert.deepEqual(brain.dungeonChoice(map, cfg({}), memory), { position: 7 }, 'by default the first enemy, as before');
  assert.deepEqual(brain.dungeonChoice(map, cfg({ skipBoss: true }), memory), { position: 2 });
  assert.deepEqual(brain.dungeonChoice([{ position: 7, boss: true }], cfg({ skipBoss: true }), memory), { cancel: 'only the boss is left' });
  assert.equal(brain.dungeonChoice([], cfg({ skipBoss: true }), memory), null);
});

test('dungeon: restart after a number of lost fights in a row', () => {
  const memory = brain.createMemory(NOW);
  const lost = { win: false, gold: 0, xp: 0, renown: 0 };
  brain.recordFight(memory, 'dungeon', lost, null, NOW);
  brain.recordFight(memory, 'expedition', lost, null, NOW);
  brain.recordFight(memory, 'dungeon', lost, null, NOW);
  assert.equal(memory.dungeonLosses, 2, 'only dungeon fights count');
  const map = [{ position: 2, boss: false }];
  const cfg = S.sanitizeSettings({ dungeon: { restartAfterLosses: 2 } }).dungeon;
  assert.deepEqual(brain.dungeonChoice(map, cfg, memory), { cancel: '2 lost fights in a row' });
  brain.recordFight(memory, 'dungeon', { ...lost, win: true }, null, NOW);
  assert.equal(memory.dungeonLosses, 0, 'a win resets the count');
  assert.deepEqual(brain.dungeonChoice(map, cfg, memory), { position: 2 });
});

test('the ruby cooldown skip and "Cancel dungeon" are never taken for a start button', () => {
  // The dungeon page during the cooldown, as on s303-en (2026-09).
  const doc = new JSDOM(`<div id="content">
    <form method="post" action="index.php?mod=dungeon&loc=1&dungeon=1&sh=x"><input type="submit" class="button1" name="skip" value="Enter Dungeon"></form>
    <form method="post" action="index.php?mod=dungeon&loc=1&action=cancelDungeon&sh=x"><input type="hidden" name="dungeonId" value="1407805"><input type="submit" class="button1" value="Cancel dungeon"></form>
  </div>`).window.document;
  assert.equal(doc.querySelectorAll(SEL.dungeon.startFallback).length, 0);
  assert.ok(doc.querySelector(SEL.dungeon.skipCooldown), 'recognised as "cooldown not over"');
  assert.equal(doc.querySelector(SEL.dungeon.cancel).value, 'Cancel dungeon');

  const start = new JSDOM(`<div id="content"><form method="post" action="index.php?mod=dungeon&loc=3"><input type="submit" class="button1" value="Normal"><input type="submit" class="button1" value="Advanced"></form></div>`).window.document;
  assert.equal(start.querySelectorAll(SEL.dungeon.startFallback).length, 2, 'unnamed Normal/Advanced still found');
});

test('on the way to the Underworld the bot only waits', () => {
  const doc = new JSDOM(`<div id="header_game"></div><div id="mainmenu">
    <a class="menuitem active" href="index.php?mod=hermit&submod=travel&sh=x">Journey time: <span class="ticker" data-ticker-time-left="450000" data-ticker-type="countdown">0:07:30</span></a></div>`, { url: 'https://s303-en.gladiatus.gameforge.com/game/index.php?mod=overview&sh=x' }).window;
  const st = stateModule.readState(doc.document, doc.location, NOW);
  assert.deepEqual(st.travel, { remainingMs: 450000 });
  const decision = brain.decide(st, S.sanitizeSettings({ enabled: true }), brain.createMemory(NOW), NOW);
  assert.equal(decision.type, 'wait');
  assert.equal(decision.until, NOW + 453000);
  assert.equal(decision.reason, 'Travelling to the Underworld');
});
