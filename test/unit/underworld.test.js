'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { brain, settings: S, state: stateModule } = require('./load');
require('../../src/content/actions.js');

const NOW = 1_700_000_000_000;
const URL_BASE = 'https://s303-en.gladiatus.gameforge.com/game/index.php';

// Page shapes from s303-en in the Underworld (Middle, 2026-09): the location
// menu gains "Leave the Underworld" and "Pray", and an area lists its enemies
// in #underwold_enemies (the game's spelling). Enemies unlock in order.
const menu = (areas = 1) =>
  `<div id="submenu2">
     <a href="index.php?mod=underworld&submod=leave&sh=x">Leave the Underworld</a>
     <a href="index.php?mod=underworld&submod=pray&sh=x">Pray</a>
     ${Array.from({ length: areas }, (_, i) => `<a href="index.php?mod=location&loc=${i}&sh=x">Area ${i}</a>`).join('')}
   </div>`;
// As the live page leaves them after its script ran: every Attack button
// enabled, locked enemies too. Whose turn it is only shows in the script.
const box = (n, name, points, cost = '<span>1</span><div class="icon_expeditionpoints small"></div>') =>
  `<div class="expedition_box" data-can-enable="true" data-costs="1" data-points="${points}" data-rubies="14" data-stage="${n}">
     <div id="expedition_info${n}"><div class="expedition_name ellipsis">${name}</div></div>
     <div id="slider${n}" class="slider"></div>
     <button id="expedition_button${n}" class="expedition_button awesome-button" type="button">Attack</button>
     <table class="expedition_cooldown_reduce"><tr id="cost${n}"><th>Cost:</th><td>${cost}</td></tr></table></div>`;
const header = (points) =>
  `<div id="header_game"></div><span id="expeditionpoints_value_point">${points}</span><span id="expeditionpoints_value_pointmax">18</span>
   <div id="header_values_hp_bar" data-value="9000" data-max-value="10000"></div>
   <div id="cooldown_bar_expedition"><a class="cooldown_bar_link" href="index.php?mod=location&loc=0&sh=x"></a></div>
   <div id="cooldown_bar_fill_expedition" class="cooldown_bar_fill cooldown_bar_fill_ready"></div><div id="cooldown_bar_text_expedition">Go to expedition</div>
   <div id="cooldown_bar_dungeon"><a class="cooldown_bar_link" href="index.php?mod=dungeon&loc=0&sh=x"></a></div>
   <div id="cooldown_bar_fill_dungeon" class="cooldown_bar_fill cooldown_bar_fill_ready"></div><div id="cooldown_bar_text_dungeon">Go to dungeon</div>
   <span id="dungeonpoints_value_point">8</span><span id="dungeonpoints_value_pointmax">12</span>`;
const areaPage = ({ points = 18, next = 2, cost } = {}) =>
  `${header(points)}${menu(1)}<div id="content">
     <script>(function($) { var initialEnemy = ${next}; var currentEnemy = initialEnemy; })</script>
     <div id="underwold_enemies">
     ${['Your shadow', 'Mercury', 'Dead Souls', 'Ferryman Charon'].map((name, i) => box(i + 1, name, points, cost)).join('')}
   </div></div>`;

function page(body, query) {
  const dom = new JSDOM(body, { url: `${URL_BASE}?${query}&sh=x` });
  return { dom, st: stateModule.readState(dom.window.document, dom.window.location, NOW) };
}

const on = (extra = {}) => S.sanitizeSettings({ enabled: true, expedition: { enabled: false, enemy: 4 }, dungeon: { enabled: true }, underworld: { enabled: true, ...extra } });

test('the Underworld is recognised by its menu, not by the Hermit\'s links', () => {
  assert.equal(page(areaPage(), 'mod=location&loc=0').st.underworld, true);
  const hermit = page(`${header(17)}<div id="content"><a href="index.php?mod=hermit&submod=underworld&sh=x">Enter</a></div>`, 'mod=hermit');
  assert.equal(hermit.st.underworld, false);
});

test('inside, expeditions follow the Underworld settings; no dungeon, no food, more HP', () => {
  const { st } = page(areaPage(), 'mod=overview');
  const memory = brain.createMemory(NOW);
  assert.equal(brain.decide(st, on(), memory, NOW).type, 'expedition', 'even with normal expeditions off');
  assert.equal(brain.decide(st, on(), memory, NOW).reason, 'Underworld expedition is ready');

  const off = brain.decide(st, S.sanitizeSettings({ enabled: true, dungeon: { enabled: true } }), memory, NOW);
  assert.notEqual(off.type, 'dungeon', 'there are no dungeons down there');
  assert.notEqual(off.type, 'expedition');

  const hurt = { ...st, hp: { value: 5500, max: 10000, percent: 55, regenPerHour: 12000 } };
  const wait = brain.decide(hurt, on({ minHpPercent: 60 }), memory, NOW);
  assert.equal(wait.type, 'wait', 'no food: waits for HP instead of eating');
  assert.match(wait.next.label, /HP 60%/);
  assert.equal(brain.decide({ ...hurt, hp: { ...hurt.hp, percent: 25 } }, on(), memory, NOW).type, 'wait', 'never "heal" with food');
});

test('inside, no points (or unknown points) means no attack: it would cost rubies', () => {
  const memory = brain.createMemory(NOW);
  assert.equal(brain.decide(page(areaPage({ points: 0 }), 'mod=overview').st, on(), memory, NOW).type, 'wait');
  const unknown = page(areaPage(), 'mod=overview').st;
  unknown.expedition = { ...unknown.expedition, points: null };
  assert.equal(brain.decide(unknown, on(), memory, NOW).type, 'wait');
  const status = brain.activityStatus(page(areaPage({ points: 0 }), 'mod=overview').st, on(), memory, NOW);
  assert.equal(status.expedition.text, 'no points');
});

test('entering: only when switched on, from level 100, with 8,000 gold, when due', () => {
  const outside = page(`${header(17)}<div id="header_values_level">110</div><div id="sstat_gold_val">262.214</div>`, 'mod=overview').st;
  const memory = brain.createMemory(NOW);
  const enter = (extra, st = outside) => brain.decide(st, S.sanitizeSettings({ enabled: true, expedition: { enabled: false }, dungeon: { enabled: false }, underworld: extra }), memory, NOW);
  assert.notEqual(enter({ enter: 'off' }).type, 'underworld');
  assert.deepEqual([enter({ enter: 'medium' }).type, enter({ enter: 'medium' }).reason], ['underworld', 'Enter the Underworld (medium)']);
  assert.notEqual(enter({ enter: 'medium' }, { ...outside, gold: 7999 }).type, 'underworld');
  assert.notEqual(enter({ enter: 'medium' }, { ...outside, level: 99 }).type, 'underworld');
  assert.notEqual(enter({ enter: 'medium' }, page(areaPage(), 'mod=overview').st).type, 'underworld', 'not while inside');
  memory.nextUnderworldCheck = NOW + 1000;
  assert.notEqual(enter({ enter: 'medium' }).type, 'underworld');
});

async function runExpedition(body) {
  const { dom, st } = page(body, 'mod=location&loc=0');
  const saved = { document: globalThis.document, location: globalThis.location };
  Object.assign(globalThis, { document: dom.window.document, location: dom.window.location });
  const clicked = [];
  let unloading = false;
  for (const b of dom.window.document.querySelectorAll('.expedition_button')) b.addEventListener('click', () => { clicked.push(b.id); unloading = true; });
  const ctx = {
    state: st,
    settings: on(),
    memory: brain.createMemory(NOW),
    log: () => {},
    humanDelay: async () => {},
    persist: async () => {},
    isUnloading: () => unloading,
    navigate: async (url, what) => ({ navigated: true, url, what }),
    url: (p) => `${URL_BASE}?${new URLSearchParams(p)}`,
    now: () => NOW,
  };
  try {
    const result = await GBot.actions.expedition(ctx);
    return { result, clicked };
  } finally {
    Object.assign(globalThis, saved);
  }
}

test('attacks the enemy whose turn it is in the newest area, only for expedition points', async () => {
  const { result, clicked } = await runExpedition(areaPage({ next: 2 }));
  assert.deepEqual(clicked, ['expedition_button2'], 'not the last enabled button: locked enemies look enabled too');
  assert.deepEqual(result, { navigated: true });
  await assert.rejects(runExpedition(areaPage().replace(/var initialEnemy = \d+;/, '')), /Cannot tell which Underworld enemy is next/);

  await assert.rejects(runExpedition(areaPage({ points: 0 })), /Out of Underworld expedition points \(attacks would cost rubies\)/);
  const rubies = areaPage({ cost: '<span>1</span><div class="icon_rubies small"></div>' });
  await assert.rejects(runExpedition(rubies), /would cost rubies/, 'a ruby price is never paid');

  const moveOn = await runExpedition(areaPage().replace('<div id="submenu2">', '<div id="submenu2"><!-- -->').replace('Area 0</a>', 'Area 0</a><a href="index.php?mod=location&loc=1&sh=x">Area 1</a>'));
  assert.equal(moveOn.clicked.length, 0);
  assert.match(moveOn.result.url, /loc=1/, 'goes to the newest area first');
});
