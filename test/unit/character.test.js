'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { brain, settings: S } = require('./load');

const window = new JSDOM('<meta name="csrf-token" content="tok">', { url: 'https://s303-en.gladiatus.gameforge.com/game/index.php' }).window;
globalThis.DOMParser = window.DOMParser;
require('../../src/content/actions.js');
require('../../src/content/workbench.js');
require('../../src/content/packages.js');
require('../../src/content/gold.js');
require('../../src/content/auction.js');
const character = require('../../src/content/character.js');

const NOW = new Date(2026, 9, 4, 18, 0).getTime();
const attr = (v) => JSON.stringify(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
// Tooltips as the game writes them: one line per row, [text, colour], or
// [[label, value], [colours]] for the stat boxes.
const tip = (lines) => attr([lines.map((l) => [l, 'white'])]);
const statTip = (pairs) => attr([pairs.map((p) => [p, ['#fff', '#fff']])]);
const hpBar = (value, max = 11550) => `<div id="header_values_hp_bar" data-value="${value}" data-max-value="${max}"></div>`;
const bagLoader = (bags) => {
  const literal = JSON.stringify(bags.map((b) => [b])).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `<script>new BagLoader(jQuery('#inv'), jQuery('#inventory_nav'), JSON.parse('${literal}'));</script>`;
};
const reply = (text) => ({ ok: true, text: async () => text });

async function withFetch(fetch, fn) {
  const saved = { document: globalThis.document, location: globalThis.location, fetch: globalThis.fetch };
  Object.assign(globalThis, { document: window.document, location: window.location, fetch });
  try {
    return await fn();
  } finally {
    Object.assign(globalThis, saved);
  }
}

function context(settings, extra = {}) {
  const logs = [];
  const alerts = [];
  const memory = brain.createMemory(NOW);
  return {
    logs,
    alerts,
    ctx: {
      state: { sh: 'abc', gold: 1000000, level: 110, underworld: false, hp: { percent: 25 } },
      settings: S.sanitizeSettings(settings),
      memory,
      log: (l, m) => logs.push(`${l}: ${m}`),
      notify: (kind, m) => alerts.push(`${kind}: ${m}`),
      humanDelay: async () => {},
      persist: async () => {},
      now: () => NOW,
      ...extra,
    },
  };
}

const gameState = (extra = {}) => ({
  inGame: true,
  gold: 100000,
  level: 110,
  hp: { value: 2900, max: 11550, percent: 25 },
  dialogs: {},
  expedition: { available: true, ready: false, remainingMs: 60000, points: 10 },
  dungeon: {},
  arena: {},
  circus: {},
  page: {},
  ...extra,
});

// ----------------------------------------------------------- Villa Medici

// The Villa Medici as on s303-en (2026-10-04): a row per doctor, "Heal
// now!" or the time he rests.
const medicPage = (hp, doctors) =>
  `<div id="header_game"></div>${hpBar(hp)}<div id="content"><div id="guild_medicus_heal"><h2 class="section-header">Villa Medici</h2><section><table width="100%">${doctors
    .map(
      (d, i) =>
        `<tr><td>Doctor ${i + 1}</td><td>${d === 'free' ? `<a href="index.php?mod=guild_medic&amp;s=${i + 1}&amp;sh=abc">Heal now!</a>` : `<span data-ticker-time-left="${d}" data-ticker-type="countdown" class="ticker"></span>`}</td></tr>`
    )
    .join('')}</table></section></div></div>`;

test('Villa Medici: off by default; in the Underworld below its fighting limit, or before food', () => {
  const memory = brain.createMemory(NOW);
  const decide = (s, extra) => brain.decide(gameState(extra), S.sanitizeSettings({ enabled: true, expedition: { enabled: true }, ...s }), memory, NOW);
  assert.equal(decide({}).type, 'heal', 'off: food as before');
  assert.equal(decide({ heal: { medic: 'underworld' } }).type, 'heal', 'only in the Underworld');
  assert.equal(decide({ heal: { medic: 'always' } }).type, 'medic');
  const under = { underworld: true, hp: { value: 5000, max: 11550, percent: 43 } };
  assert.equal(decide({ heal: { medic: 'underworld' }, underworld: { enabled: true } }, under).type, 'medic', 'in the Underworld: below its 60% limit');
  assert.notEqual(decide({ underworld: { enabled: true } }, under).type, 'medic');

  memory.medicNext = NOW + 60000;
  assert.equal(decide({ heal: { medic: 'always' } }).type, 'heal', 'every doctor resting: food');
  memory.medicNext = 0;
  memory.medicToday = { day: new Date(NOW).toDateString(), used: 2 };
  assert.equal(decide({ heal: { medic: 'always', medicMax: 2 } }).type, 'heal', 'the daily limit is reached');
  assert.equal(decide({ heal: { medic: 'always', medicMax: 3 } }).type, 'medic');
});

test('Villa Medici: the first free doctor is seen and the HP gained is logged', async () => {
  const calls = [];
  let hp = 2987;
  const doctors = [7194000, 'free', 'free'];
  const fetch = async (url) => {
    const q = Object.fromEntries(new URL(url).searchParams);
    calls.push(`${q.mod}${q.s ? ` s=${q.s}` : ''}`);
    if (q.s) {
      doctors[Number(q.s) - 1] = 7200000;
      hp += 4158;
    }
    return reply(medicPage(hp, doctors));
  };
  const { ctx, logs } = context({ heal: { medic: 'always' } });
  assert.deepEqual(await withFetch(fetch, () => GBot.actions.medic(ctx)), { refresh: true });
  assert.deepEqual(calls, ['guild_medic', 'guild_medic s=2']);
  assert.deepEqual(logs, ['info: Villa Medici: a doctor healed you from 26% to 62% HP (+4,158)']);
  assert.equal(ctx.memory.medicNext, 0, 'doctor 3 is still free');
  assert.equal(ctx.memory.stats.medic, 1);
  assert.equal(brain.medicUsed({ underworld: false }, ctx.memory, NOW), 1);

  // The last one: wait for the first to be free again.
  await withFetch(fetch, () => GBot.actions.medic(ctx));
  assert.equal(ctx.memory.medicNext, NOW + 7194000 + 30000);
  logs.length = 0;
  await withFetch(fetch, () => GBot.actions.medic(ctx));
  assert.match(logs[0], /^info: Villa Medici: every doctor is resting; the next is free in/);
});

test('Villa Medici: no building, no doctors; looked at again hours later', async () => {
  const { ctx, logs } = context({ heal: { medic: 'always' } });
  await withFetch(async () => reply('<div id="header_game"></div><div id="content">You are not in a guild.</div>'), () => GBot.actions.medic(ctx));
  assert.equal(ctx.memory.medicNext, NOW + 6 * 3600 * 1000);
  assert.match(logs[0], /no doctors/);
});

// ------------------------------------------------------------------- gods

// The gods page as on s303-en: favour per god, a map area per rank; only
// the ranks that can be bought have an onclick.
const area = (god, rank, name, cost, can) =>
  `<area shape="poly" coords="1,72" href="javascript:void(0);"${
    can ? ` onclick="blackoutDialogFlex('document.location.href=\\'index.php?mod=gods&amp;submod=activateBlessing&amp;god=${god}&amp;rank=${rank}&amp;sh=abc\\'', 'Are you sure?', true, 'activateBlessing', 350); return false;"` : ''
  } data-tooltip="${tip([name, `Cost: ${cost} Favor`, 'Cooldown time: 6 Hours'])}">`;
const COSTS = [20, 60, 150];
function godsGame(points) {
  const cooldown = {};
  const page = () =>
    `<div id="header_game"></div><div id="content"><div id="gods"><div id="daily_points">30 / 240</div>${Object.entries(points)
      .map(([god, p], i) => {
        const ranks = COSTS.map((cost, r) => area(i + 1, r + 1, `${god} rank ${r + 1}`, cost, p >= cost && !cooldown[`${i + 1}-${r + 1}`]));
        return `<div id="${god}" class="god_box"><map name="${god}">${ranks.join('')}</map><div class="god_nameplate"><div class="god_name">${god}</div><div class="god_points">${p} / 736</div></div></div>`;
      })
      .join('')}</div></div>`;
  const calls = [];
  const fetch = async (url) => {
    const q = Object.fromEntries(new URL(url).searchParams);
    calls.push(q.submod ? `${q.submod} ${q.god}/${q.rank}` : q.mod);
    if (q.submod === 'activateBlessing') {
      const god = Object.keys(points)[Number(q.god) - 1];
      points[god] -= COSTS[Number(q.rank) - 1];
      cooldown[`${q.god}-${q.rank}`] = true;
    }
    return reply(page());
  };
  return { fetch, calls, page };
}

test('gods: the page is read; only a plain favour purchase is ever sent', () => {
  const { page } = godsGame({ minerva: 164, diana: 35 });
  const gods = character.readGods(new window.DOMParser().parseFromString(page(), 'text/html'));
  assert.deepEqual(
    gods.map((g) => [g.god, g.points, g.max, g.ranks.map((r) => `${r.rank}:${r.cost}:${r.params ? 'y' : 'n'}`).join(' ')]),
    [
      ['minerva', 164, 736, '1:20:y 2:60:y 3:150:y'],
      ['diana', 35, 736, '1:20:y 2:60:n 3:150:n'],
    ]
  );
  assert.deepEqual(character.blessingParams("x('document.location.href=\\'index.php?mod=gods&submod=activateBlessing&god=3&rank=2&sh=1\\'')"), { mod: 'gods', submod: 'activateBlessing', god: '3', rank: '2' });
  assert.equal(character.blessingParams("x('index.php?mod=gods&submod=buyWithRubies&god=3&rank=2')"), null);
  assert.equal(character.blessingParams("x('index.php?mod=gods&submod=activateBlessing&god=3&rank=2&rubies=1')"), null, 'nothing else in the request');
});

test('gods: ticked ranks the god has favour for, dearest first; the favour floor', () => {
  const { page } = godsGame({ minerva: 164, diana: 35, mars: 736 });
  const gods = character.readGods(new window.DOMParser().parseFromString(page(), 'text/html'));
  const pick = (g) => brain.pickBlessings(gods, S.sanitizeSettings({ gods: { enabled: true, ...g } })).map((p) => `${p.god}:${p.rank}`);
  assert.deepEqual(pick({}), [], 'nothing ticked');
  const all = { minerva: true, diana: true, mars: true };
  assert.deepEqual(pick({ blessings: all, oils: all, rank3: all }), ['minerva:3', 'diana:1', 'mars:3', 'mars:2', 'mars:1'], 'Minerva: 150 leaves 14, too little for the rest');
  assert.deepEqual(pick({ blessings: all, minPercent: 90 }), ['mars:1'], 'only Mars is 90% full');
});

test('gods: buys the picks and checks the favour went down', async () => {
  const game = godsGame({ minerva: 164, mars: 736 });
  const { ctx, logs } = context({ gods: { enabled: true, blessings: { mars: true }, oils: { minerva: true } } });
  await withFetch(game.fetch, () => GBot.actions.gods(ctx));
  assert.deepEqual(game.calls, ['gods', 'activateBlessing 1/2', 'activateBlessing 2/1']);
  assert.deepEqual(logs, ['info: Gods: minerva rank 2 for 60 favour (104 left)', 'info: Gods: mars rank 1 for 20 favour (716 left)']);
  assert.equal(ctx.memory.stats.blessings, 2);
  assert.equal(ctx.memory.nextGodsCheck, NOW + 30 * 60 * 1000);

  const settings = S.sanitizeSettings({ enabled: true, gods: { enabled: true, blessings: { mars: true } } });
  assert.equal(brain.decide(gameState({ hp: { value: 9000, max: 11550, percent: 78 } }), settings, ctx.memory, NOW).type !== 'gods', true, 'not before the next look');
  assert.equal(brain.decide(gameState({ hp: { value: 9000, max: 11550, percent: 78 } }), settings, brain.createMemory(NOW), NOW).type, 'gods');
});

// ----------------------------------------------------------------- boosts

const boost = (pos, name, using, duration, basis) =>
  `<div data-content-type="64" data-basis="${basis}" data-item-id="9${pos}" data-position-x="${pos}" data-position-y="1" data-measurement-x="1" data-measurement-y="1" data-tooltip="${tip([name, 'Soul bound to: DaddyCzapo', `Using: ${using}`, `Duration: ${duration} h`, 'Level 115'])}"></div>`;

test('boosts: what a potion does, from its tooltip', () => {
  assert.deepEqual(brain.boostOf(['Bottle of agility', 'Using: +16 Agility', 'Duration: 02:00 h']), { stat: 'agility', amount: 16, durationMs: 2 * 3600 * 1000 });
  assert.deepEqual(brain.boostOf(['Hawthorn', 'Using: +1.388 Health', 'Duration: 00:30 h']), { stat: 'health', amount: 1388, durationMs: 30 * 60000 });
  assert.equal(brain.boostOf(['Bread', 'Using: Heals 300 of life']), null, 'food is not a boost');
});

test('boosts: the longest-lasting one, while the stat has room below its maximum', () => {
  const item = (stat, amount, minutes, from = 'packages') => ({ from, name: `${stat} ${minutes}`, boost: { stat, amount, durationMs: minutes * 60000 } });
  const items = [item('agility', 14, 15), item('agility', 14, 120), item('agility', 14, 120, 'bag'), item('strength', 17, 120), item('health', 1388, 30)];
  const plan = brain.pickBoosts(items, { agility: 68, strength: 1 }, ['agility', 'strength', 'health', 'intelligence']);
  assert.deepEqual(
    plan.use.map((u) => `${u.stat}: ${u.item.name} (${u.item.from})`),
    ['agility: agility 120 (bag)', 'health: health 30 (packages)']
  );
  assert.deepEqual(plan.wait, { strength: 'only 1 below its maximum', intelligence: 'none left' });
});

test('boosts: a bag potion is dropped on the character; the stat going up is checked', async () => {
  let agility = 1112;
  const moves = [];
  const fetch = async (url, init = {}) => {
    const q = Object.fromEntries(new URL(url).searchParams);
    if (q.submod === 'move') {
      moves.push(`${q.from}:${q.fromX},${q.fromY} -> ${q.to}`);
      if (q.to === '8') agility += 16;
      return reply(JSON.stringify({ to: { data: { itemId: 1 } } }));
    }
    if (q.mod === 'packages') return reply('<div id="packages"></div>');
    const stats = ['Strength', 'Dexterity', 'Agility', 'Constitution', 'Charisma', 'Intelligence'].map(
      (name, i) =>
        `<div id="char_f${i}_tt" data-tooltip="${statTip([[`${name}:`, String(i === 2 ? agility : 200)], ['Basic:', '100'], ['Maximum:', i === 2 ? '1180' : '200']])}"></div>`
    );
    return reply(`<div id="header_game"></div>${hpBar(9000)}${stats.join('')}${bagLoader(['', boost(3, 'Bottle of agility', '+16 Agility', '02:00', '11-12') + boost(4, 'Flask of Strength', '+14 Strength', '00:15', '11-1'), '', '', '', '', '', ''])}`);
  };
  const { ctx, logs } = context({ boosts: { enabled: true, stats: { agility: true, strength: true } } });
  await withFetch(fetch, () => GBot.actions.boosts(ctx));
  assert.deepEqual(moves, ['513:3,1 -> 8'], 'strength is at its maximum');
  assert.deepEqual(logs, ['info: Boosts: none used for strength (at its maximum)', 'info: Boosts: used Bottle of agility, agility 1,112 → 1,128 for 2 h']);
  assert.equal(ctx.memory.boostNext.agility, NOW + 2 * 3600 * 1000);
  assert.equal(ctx.memory.boostNext.strength, NOW + 3600 * 1000);
  assert.equal(ctx.memory.stats.boosts, 1);

  logs.length = 0;
  ctx.memory.boostNext.strength = 0;
  await withFetch(fetch, () => GBot.actions.boosts(ctx));
  assert.deepEqual(logs, [], 'the same reason is not logged again');
  assert.deepEqual(brain.boostsDue(ctx.settings, ctx.memory, NOW), []);
});

// --------------------------------------------------------------- costumes

// The costumes page as on s303-en (2026-10-04): Dīs Pater's Armour
// (normal) worn on both characters, the hard one held, everything else on
// the costume cooldown.
const costumeBox = (name, lines, buttons) =>
  `<div class="costumes_box"><div data-tooltip="${tip([name, ...lines])}"><div id="avatar" class="player_picture"></div></div>${buttons}</div>`;
const disabled = (ms) => `<div id="costumes_button_left"><input type="button" class="awesome-button disabled"><br><div class="costumes_button_ticker"><span class="ticker" data-ticker-time-left="${ms}"></span></div></div>`;
const button = (value, doll, setId, dialog) =>
  `<div id="costumes_button_left"><input type="button" class="awesome-button" value="${value}" onclick="blackoutDialogFlex(&quot;document.location.href='index.php?mod=costumes&amp;submod=changeCostume&amp;doll=${doll}&amp;setId=${setId}&amp;sh=abc'&quot;, &quot;&quot;, true, &quot;${dialog}&quot;, 350); return false;"></div>`;
function costumesPage({ normal = 'worn', hard = 'held', juno = 'cooldown' } = {}) {
  const armour = (level, how) =>
    costumeBox(`Dīs Pater\`s Armour (${how === 'none' ? 0 : 1}/1)`, [`after victory on ${level}`, '+100% expedition points'], how === 'worn' ? button('I + II', 1, 0, 'dropCostume') : how === 'held' ? button('I + II', 1, 20 + level.length, 'changeCostume') : disabled(2280000));
  return `<div id="header_game"></div><div id="content"><h1>Everywear Costumes</h1><h2>These costumes can be worn by both of your characters</h2>
    ${costumeBox('Vulcanus Forge (5/5)', ['(1) Reduces the waiting time'], disabled(2280000) + disabled(2280000))}
    ${costumeBox('Juno`s Breath of Life (5/5)', ['(5) Reduces cooldown for new expeditions by 20%.'], juno === 'cooldown' ? disabled(2280000) : juno === 'worn' ? button('I', 1, 0, 'dropCostume') : button('I', 1, 6, 'changeCostume'))}
    <h1>Underworld Costumes</h1><h2>These costumes can be worn once after defeating Dīs Pater.</h2>
    ${armour('normal', normal)}${armour('medium', 'none')}${armour('hard', hard)}
    <h1>Can only be worn during the costume festival</h1>${costumeBox('Ra`s Light Robe (5/5)', [], disabled(2280000))}</div>
    <div id="buffbar"><div class="buff-container"><div class="buff buff-clickable" data-link="index.php?mod=costumes&amp;sh=abc" data-effect-end="23797"></div></div></div>`;
}
const parse = (html) => new window.DOMParser().parseFromString(html, 'text/html');

test('costumes: the page is read by section; worn = it offers to take it off', () => {
  const costumes = character.readCostumes(parse(costumesPage()));
  assert.deepEqual(
    costumes.map((c) => [c.name, c.kind, c.level, c.owned, c.worn, c.wear ? c.wear.setId : null, c.waitMs]),
    [
      ['Vulcanus Forge', 'everywear', null, true, false, null, 2280000],
      ["Juno's Breath of Life", 'everywear', null, true, false, null, 2280000],
      ["Dīs Pater's Armour", 'underworld', 'normal', true, true, null, null],
      ["Dīs Pater's Armour", 'underworld', 'medium', false, false, null, 2280000],
      ["Dīs Pater's Armour", 'underworld', 'hard', true, false, '24', null],
      ["Ra's Light Robe", 'festival', null, true, false, null, 2280000],
    ],
    "the game's backticks (Juno`s) read as apostrophes"
  );
  assert.equal(character.costumeEndsIn(parse(costumesPage())), 23797000);
});

test('costumes: never anything else while an armour is on; then the armour held, then the everyday one', () => {
  const plan = (page, c, enter = 'off') => brain.costumePlan(character.readCostumes(parse(costumesPage(page))), S.sanitizeSettings({ costumes: { enabled: true, ...c }, underworld: { enter } }));
  const all = { normal: true, medium: true, hard: true };
  assert.deepEqual(plan({}, { armour: all, everyday: "Juno's Breath of Life" }), { wait: "Dīs Pater's Armour is on" });
  const next = plan({ normal: 'none', juno: 'free' }, { armour: all, everyday: "Juno's Breath of Life" });
  assert.equal(next.wear.level, 'hard');
  assert.equal(plan({ normal: 'none', juno: 'free' }, { armour: { normal: true }, everyday: "Juno's Breath of Life" }).wear.name, "Juno's Breath of Life", 'the hard one is not ticked');
  assert.deepEqual(plan({ normal: 'none', hard: 'none', juno: 'worn' }, { everyday: "Juno's Breath of Life" }), { wait: "Juno's Breath of Life is on" });
  assert.deepEqual(plan({ normal: 'none', hard: 'none' }, { everyday: "Juno's Breath of Life" }), { wait: "Juno's Breath of Life cannot be put on yet" });
  assert.deepEqual(plan({ normal: 'none', hard: 'none' }, {}), { wait: 'nothing to put on' });
});

test('costumes: puts on the armour held once the worn one ran out, and says so', async () => {
  let page = { normal: 'worn' };
  const calls = [];
  const fetch = async (url) => {
    const q = Object.fromEntries(new URL(url).searchParams);
    calls.push(q.submod ? `${q.submod} ${q.doll}/${q.setId}` : q.mod);
    if (q.submod === 'changeCostume') page = { normal: 'none', hard: 'worn' };
    return reply(costumesPage(page));
  };
  const { ctx, logs, alerts } = context({ costumes: { enabled: true, armour: { hard: true } } });
  await withFetch(fetch, () => GBot.actions.costume(ctx));
  assert.deepEqual(calls, ['costumes'], 'the normal one is still on');
  assert.equal(ctx.memory.nextCostumeCheck, NOW + 23797000 + 30000, 'looked at again when it ends');
  assert.deepEqual(logs, ["info: Costumes: Dīs Pater's Armour is on; looking again in 6:37:07"]);

  page = { normal: 'none' };
  logs.length = 0;
  await withFetch(fetch, () => GBot.actions.costume(ctx));
  assert.deepEqual(calls, ['costumes', 'costumes', 'changeCostume 1/24']);
  assert.deepEqual(logs, ["info: Costumes: Dīs Pater's Armour (normal) has run out", "info: Costumes: put on Dīs Pater's Armour (hard) (Dīs Pater's Armour (hard) can be worn)"]);
  assert.deepEqual(alerts, ["costume: Lanista: Dīs Pater's Armour (normal) has run out.", "costume: Lanista: put on Dīs Pater's Armour (hard)."]);
});

// ------------------------------------------------------------ market food

const marketRow = ({ id, seller, price, heal, level = 98, buy = true }) =>
  `<tr><td><div data-content-type="64" data-item-id="${id}" data-level="${level}" data-basis="7-6" data-price-gold="300" data-tooltip="${tip(['Health potion', `Using: Heals ${heal} of life`, 'From intelligence: +1550 vitality points'])}"></div></td>
     <td><a href="index.php?mod=player&p=1">${seller}</a></td><td>${price}</td><td>00:08 h</td><td>${level}</td><td>${buy ? '<input type="submit" value="Buy" name="buy">' : ''}</td></tr>`;

test('market food: best HP per gold from others, at least the set ratio, within the food budget', async () => {
  const rows = [
    { id: 1, seller: 'MasterFestus', price: '9.938', heal: 8900 },
    { id: 2, seller: 'Cheap', price: '2.000', heal: 6000 },
    { id: 3, seller: 'Greedy', price: '50.000', heal: 6000 },
    { id: 4, seller: 'DaddyCzapo', price: '100', heal: 6000, buy: false },
    { id: 5, seller: 'High', price: '1.000', heal: 6000, level: 130 },
  ];
  let gold = 1000000;
  const bought = [];
  const fetch = async (url, init = {}) => {
    const q = Object.fromEntries(new URL(url).searchParams);
    if (init.method === 'POST') {
      const body = Object.fromEntries(new URLSearchParams(init.body));
      bought.push(`${q.mod} ${body.buyid}`);
      gold -= { 1: 9938, 2: 2000 }[body.buyid];
    }
    if (q.mod === 'overview') return reply('<span class="playername_achievement">DaddyCzapo</span>');
    return reply(`<div id="header_game"></div><div id="sstat_gold_val">${gold.toLocaleString('de-DE')}</div><div id="content"><table id="market_item_table"><tr><th>Item</th></tr>${rows.map(marketRow).join('')}</table></div>`);
  };
  const { ctx } = context({ heal: { market: true, marketMinHpPerGold: 0.8, buyAtOnce: 3, buyMaxGoldPerDay: 50000 } });
  ctx.memory.gameInfo = { locations: [] };
  const result = await withFetch(fetch, () => GBot.auction.buyMarketFood(ctx));
  assert.deepEqual(bought, ['market 2', 'market 1']);
  assert.deepEqual(result.bought, ['Health potion (6,000 HP, 2,000 gold, from Cheap)', 'Health potion (8,900 HP, 9,938 gold, from MasterFestus)']);
  assert.equal(result.gold, 11938);
  assert.equal(ctx.memory.foodBought.gold, 11938);

  const strict = context({ heal: { market: true, marketMinHpPerGold: 5 } });
  strict.ctx.memory.gameInfo = { locations: [] };
  assert.deepEqual(await withFetch(fetch, () => GBot.auction.buyMarketFood(strict.ctx)), { bought: [], reason: 'nothing on the market heals 5 HP per gold or more' });
});

// ----------------------------------------------------------------- alerts

test('alerts from every page: a new level, more unread messages', () => {
  const memory = brain.createMemory(NOW);
  const alerts = (s) => brain.pageAlerts({ inGame: true, ...s }, memory).map((a) => `${a.kind}: ${a.message}`);
  assert.deepEqual(alerts({ level: 110, messages: 0 }), [], 'the first level seen is just noted');
  assert.deepEqual(alerts({ level: 111, messages: 0 }), ['levelUp: Lanista: you reached level 111!']);
  assert.deepEqual(alerts({ level: 111, messages: 2 }), ['messages: Lanista: 2 unread messages in the game']);
  assert.deepEqual(alerts({ level: 111, messages: 2 }), [], 'said once');
  assert.deepEqual(alerts({ level: 111, messages: 0 }), []);
  assert.deepEqual(alerts({ level: 111, messages: 1 }), ['messages: Lanista: an unread message in the game']);
});

test('the daily summary: the day that just ended, in one line', () => {
  const memory = brain.createMemory(NOW);
  assert.equal(brain.rollStatsDay(memory, NOW), null, 'the first day starts');
  memory.stats.expedition += 30;
  memory.stats.arena += 10;
  memory.stats.results = { expedition: { won: 29, lost: 1 }, arena: { won: 6, lost: 4 } };
  memory.stats.loot = { gold: 150000, xp: 900, honour: 2000, fame: 0 };
  memory.stats.goldSpent = 40000;
  const finished = brain.rollStatsDay(memory, NOW + 24 * 3600 * 1000);
  assert.equal(finished.day, brain.dayKey(NOW));
  assert.equal(brain.daySummary(finished), `Lanista, ${brain.dayKey(NOW)}: 40 fights (88% won), +150,000 gold, +900 XP, +2,000 honour, 40,000 gold spent`);
  assert.equal(brain.rollStatsDay(memory, NOW + 24 * 3600 * 1000 + 60000), null);
});
