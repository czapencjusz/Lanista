'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { brain, settings: S, state: stateModule } = require('./load');
require('../../src/content/actions.js');

const NOW = 1_700_000_000_000;
const URL_BASE = 'https://s303-en.gladiatus.gameforge.com/game/index.php';

// Page shapes from s303-en during the "Desert of Nightmare" event
// (2026-10-11): the location menu gains a place whose loc is a word, and its
// page is an expedition page with free event points and its own cooldown.
const menu = `<div id="submenu2">
    <a class="menuitem" href="index.php?mod=hermit&sh=x">Hermit</a>
    ${['Cave Temple', 'The green forest', 'Cursed Village', 'Death Hill', 'Vandal Village', 'Mine', 'Teuton Camp', 'Koman Mountain'].map((n, i) => `<a class="menuitem" href="index.php?mod=location&loc=${i}&sh=x">${n}</a>`).join('')}
    <a class="menuitem glow eyecatcher" href="index.php?mod=location&loc=desert&sh=x">Desert of Nightmare</a>
  </div>`;
const header = ({ hp = 9000, expeditionReady = false } = {}) =>
  `<div id="header_game"></div><span id="expeditionpoints_value_point">31</span><span id="expeditionpoints_value_pointmax">72</span>
   <div id="header_values_hp_bar" data-value="${hp}" data-max-value="10000"></div>
   <div id="cooldown_bar_expedition"><a class="cooldown_bar_link" href="index.php?mod=location&loc=7&sh=x"></a></div>
   <div id="cooldown_bar_fill_expedition" class="cooldown_bar_fill${expeditionReady ? ' cooldown_bar_fill_ready' : ''}"></div><div id="cooldown_bar_text_expedition">${expeditionReady ? 'Go to expedition' : '0:07:59'}</div>`;
const enemies = (disabled) =>
  ['Cactus of Horror', 'Meerkat of Dreams', 'Fennec of the Underworld', 'Vulture of the Dunes']
    .map(
      (name, i) => `<div class="expedition_box"><div id="expedition_info${i + 1}"><div class="expedition_name">${name}</div></div>
        <div><button id="b${i + 1}" class="expedition_button awesome-button${disabled ? ' disabled' : ''}"${disabled ? ' disabled' : ''} onclick="attack(null, 'desert', ${i + 1}, 1, '')">Attack</button>
        <div class="expedition_cooldown_reduce"><img src="ruby.png"></div></div></div>`
    )
    .join('');
const eventPage = ({ points = 15, cooldownMs = 0, text } = {}) =>
  `${header()}${menu}<div id="content"><div>
     <div class="section-header"><p>You are currently in the event area "Desert of Nightmare". Event areas can be explored independently of your regular expeditions. ${text !== undefined ? text : `Your free event points: ${points}`}</p>
       <p><span class="headervalue_smaller">Tip: The free event points will be refilled at 00:00.</span></p></div>
     <div class="section-header">${cooldownMs ? `<span class="ticker" data-ticker-time-left="${cooldownMs}" data-ticker-type="countdown">Time remaining until your next expedition:</span>` : ''}</div>
     <div id="expedition_list">${enemies(cooldownMs > 0)}</div></div></div>`;

function page(body, query) {
  const dom = new JSDOM(body, { url: `${URL_BASE}?${query}&sh=x` });
  return { dom, st: stateModule.readState(dom.window.document, dom.window.location, NOW) };
}

const on = (extra = {}) => S.sanitizeSettings({ enabled: true, expedition: { enabled: true }, dungeon: { enabled: false }, arena: { enabled: false }, circus: { enabled: false }, quests: { enabled: false }, event: { enabled: true, ...extra } });

async function run(action, body, query, settings = on(), memory = brain.createMemory(NOW)) {
  const { dom, st } = page(body, query);
  const saved = { document: globalThis.document, location: globalThis.location };
  Object.assign(globalThis, { document: dom.window.document, location: dom.window.location });
  const clicked = [];
  const logs = [];
  let unloading = false;
  for (const b of dom.window.document.querySelectorAll('.expedition_button')) b.addEventListener('click', () => { clicked.push(b.id); unloading = true; });
  memory.pending = { type: action, at: NOW, attempts: 1, firstAt: NOW };
  const ctx = {
    state: st,
    settings,
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
    const decision = action === 'event' ? brain.decide(st, settings, memory, NOW) : null;
    const result = await GBot.actions[action](ctx, decision && decision.type === 'event' ? decision : { area: { id: 'desert', name: 'Desert of Nightmare' } });
    return { result, clicked, logs, memory, st };
  } finally {
    Object.assign(globalThis, saved);
  }
}

test('an event area is told apart from the expedition locations', () => {
  const { st } = page(eventPage(), 'mod=overview');
  assert.deepEqual(st.eventAreas, [{ id: 'desert', name: 'Desert of Nightmare' }]);
  assert.equal(st.locations.length, 8, 'the numbered locations only');
  assert.ok(st.locations.every((l) => /^\d+$/.test(l.id)));
});

test('the event is fought when on, with HP, between the other fights; its cooldown is waited for', () => {
  const { st } = page(eventPage(), 'mod=overview');
  const memory = brain.createMemory(NOW);
  assert.notEqual(brain.decide(st, S.sanitizeSettings({ enabled: true }), memory, NOW).type, 'event', 'off by default');
  const decision = brain.decide(st, on(), memory, NOW);
  assert.deepEqual([decision.type, decision.area.id, decision.reason], ['event', 'desert', 'Event: Desert of Nightmare']);

  memory.eventNext = NOW + 120000;
  const wait = brain.decide(st, on(), memory, NOW);
  assert.equal(wait.type, 'wait');
  assert.equal(wait.next.label, 'Event');
  const low = page(eventPage().replace('data-value="9000"', 'data-value="1000"'), 'mod=overview').st;
  assert.notEqual(brain.decide(low, on(), brain.createMemory(NOW), NOW).type, 'event', 'not with low HP');
});

test('attacks the chosen enemy in the event area while free event points last', async () => {
  const away = await run('event', eventPage(), 'mod=overview');
  assert.match(away.result.url, /mod=location&loc=desert/, 'goes there first');

  const there = await run('event', eventPage({ points: 15 }), 'mod=location&loc=desert', on({ enemy: 2 }));
  assert.deepEqual(there.clicked, ['b2']);
  assert.deepEqual(there.result, { navigated: true });
  assert.deepEqual(there.memory.pending.area, { key: 'event:desert', name: 'Event: Desert of Nightmare' });
});

test('no free event points left, unreadable points, or the cooldown: nothing is attacked', async () => {
  const empty = await run('event', eventPage({ points: 0 }), 'mod=location&loc=desert');
  assert.deepEqual(empty.clicked, []);
  assert.equal(empty.memory.eventNext, NOW + 3600 * 1000);
  assert.equal(empty.memory.pending, null);
  assert.match(empty.logs[0], /no free event points left in Desert of Nightmare/);

  await assert.rejects(run('event', eventPage({ text: 'Your event points: 3 (Rubies)' }), 'mod=location&loc=desert'), /could not read the free event points/);

  const cooling = await run('event', eventPage({ cooldownMs: 155000 }), 'mod=location&loc=desert');
  assert.deepEqual(cooling.clicked, []);
  assert.equal(cooling.memory.eventNext, NOW + 157000);
});

test('a regular expedition never fights in the event area', async () => {
  const { result, clicked } = await run('expedition', eventPage(), 'mod=location&loc=desert', on());
  assert.deepEqual(clicked, [], 'not even with the location set to "last visited"');
  assert.match(result.url, /loc=7/, 'goes to the location the expedition bar points at');
});

test('an event fight counts, and for the event area by place; a new event area is announced', () => {
  const memory = brain.createMemory(NOW);
  memory.pending = { type: 'event', at: NOW, attempts: 2, firstAt: NOW, area: { key: 'event:desert', name: 'Event: Desert of Nightmare' } };
  const report = { win: true, gold: 1200, xp: 9, renown: 40 };
  const events = brain.resolvePending({ report, hp: {} }, memory, NOW);
  assert.match(events[0].message, /^Event: won, \+1,200 gold/);
  assert.equal(memory.stats.event, 1);
  assert.deepEqual(memory.stats.results.event, { won: 1, lost: 0 });
  assert.equal(brain.areaStats(memory)[0].name, 'Event: Desert of Nightmare');

  const seen = brain.createMemory(NOW);
  const { st } = page(eventPage(), 'mod=overview');
  brain.pageAlerts({ ...st, eventAreas: [] }, seen);
  assert.deepEqual(brain.pageAlerts(st, seen).map((a) => a.message), ['Lanista: a new place in the location menu: Desert of Nightmare. An event, or a newly opened area?']);
});
