'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
require('./load');
const sim = require('../../src/content/sim.js');
const { fighter, characterPage, seeded } = require('./profiles');

const page = (html) => new JSDOM(html).window.document;

// DaddyCzapo (s303, level 111) in the arena reports of 2026-10-11.
const daddy = (over = {}) => fighter({ name: 'DaddyCzapo', level: 111, hp: 11600, hpMax: 11600, str: 214, dex: 1019, agi: 1112, con: 276, cha: 201, int: 459, dmg: [552, 624], abs: [311, 380], crit: 48, block: 50, avoid: 25, ...over });

test('the chances the combat reports show: hit and double hit', () => {
  const rambo = fighter();
  assert.equal(sim.hitChance(daddy(), rambo), 56);
  assert.equal(sim.hitChance(rambo, daddy()), 38);
  assert.equal(sim.doubleChance(daddy(), rambo), 7);
  assert.equal(sim.doubleChance(rambo, daddy()), 6);
});

test('one attack: miss, hit, critical, blocked (half), blocked critical (normal), absorbed', () => {
  const m = { hit: 50, double: 0, crit: 30, block: 40, dmg: [500, 500], abs: [300, 300] };
  // rng() calls: hit?, damage roll, critical?, blocked?, absorption roll.
  const run = (...values) => sim.strike(m, () => values.shift());
  assert.equal(run(0.6), 0, 'missed');
  assert.equal(run(0.1, 0, 0.9, 0.9, 0), 200, '500 less 300 absorbed');
  assert.equal(run(0.1, 0, 0.1, 0.9, 0), 700, 'critical: twice the damage, then absorbed');
  assert.equal(run(0.1, 0, 0.9, 0.1, 0), 0, 'blocked: half (250), all absorbed ("blocked" in the report)');
  assert.equal(run(0.1, 0, 0.1, 0.1, 0), 200, 'a blocked critical hit does normal damage');
  const matchup = sim.matchup(daddy(), fighter());
  assert.equal(matchup.crit, 48 * 0.75, 'the target avoids a quarter of the critical hits');
  assert.equal(matchup.block, 49);
});

test('arena: even fighters win half the time; a much stronger one nearly always', () => {
  const rng = seeded(7);
  const even = sim.arenaChance(fighter(), fighter(), { runs: 2000, rng });
  assert.ok(even > 0.4 && even < 0.6, `even: ${even}`);
  assert.ok(sim.arenaChance(daddy(), fighter(), { runs: 1000, rng }) > 0.9, 'DaddyCzapo against RAMBO');
  assert.ok(sim.arenaChance(fighter(), daddy(), { runs: 1000, rng }) < 0.1);
});

test('arena: the HP you start with counts (a knock-out ends it early)', () => {
  const rng = seeded(3);
  const strong = fighter({ dmg: [3000, 3200] });
  const full = sim.arenaChance(fighter(), strong, { runs: 1000, rng });
  const low = sim.arenaChance(fighter({ hp: 900 }), strong, { runs: 1000, rng });
  assert.ok(low < full, `${low} < ${full}`);
  assert.equal(sim.arenaChance(fighter({ dmg: [30000, 30000] }), fighter({ hp: 1 }), { runs: 200, rng }), 1, 'one hit is enough');
});

test('circus: the stronger team wins', () => {
  const rng = seeded(11);
  const team = (over = {}) => [1, 2, 3, 4, 5].map((i) => fighter({ name: `F${i}`, hp: 8000, hpMax: 8000, threat: 300, ...over }));
  assert.ok(sim.circusChance(team({ dmg: [700, 800] }), team(), { runs: 300, rng }) > 0.9);
  assert.ok(sim.circusChance(team(), team({ dmg: [700, 800] }), { runs: 300, rng }) < 0.1);
});

test('circus: a healer keeps a fighter standing, and a standing fighter keeps dealing damage', () => {
  const rng = seeded(13);
  const fighterX = fighter({ name: 'X', hp: 6000, hpMax: 6000, dmg: [900, 1000], threat: 500, heal: 0 });
  const druid = fighter({ name: 'Druid', hp: 6000, hpMax: 6000, dmg: [0, 0], threat: 0, heal: 2500, critHeal: 10, role: 'healer' });
  const them = [{ ...fighterX, name: 'Y' }, { ...druid, name: 'Dummy', heal: 0 }];
  const healed = sim.circusChance([fighterX, druid], them, { runs: 400, rng });
  const plain = sim.circusChance([fighterX, { ...druid, heal: 0 }], them, { runs: 400, rng });
  assert.ok(healed > plain + 0.2, `${healed} > ${plain}`);
});

test('circus: everyone starts with full HP', () => {
  const rng = seeded(5);
  const a = [fighter({ hp: 10, hpMax: 20060 })];
  const b = [fighter()];
  const chance = sim.circusChance(a, b, { runs: 1000, rng });
  assert.ok(chance > 0.4 && chance < 0.6, `${chance}`);
});

test('a character page: stats, and the derived values from the tooltips', () => {
  const f = sim.readFighter(page(characterPage(fighter({ hp: 15000 }))));
  assert.deepEqual(f, { ...fighter({ hp: 15000 }), threat: 0, role: 'attacker' });
  const tank = sim.readFighter(page(characterPage(fighter({ threat: 613 }), { doll: 2 })), 2);
  assert.equal(tank.threat, 613);
  assert.equal(tank.role, 'tank');
  assert.equal(sim.readFighter(page(characterPage(fighter({ threat: 0, heal: 1731 }), { doll: 5 })), 5).role, 'healer');
  assert.equal(sim.readFighter(page('<html><body>Not logged in</body></html>')), null);
});

test('in another language the healer is told by healing and no threat', () => {
  const doc = page(characterPage(fighter({ threat: 0, heal: 1731 }), { doll: 5, roleText: false }));
  assert.equal(sim.readFighter(doc, 5).role, 'healer');
  const doc2 = page(characterPage(fighter({ threat: 400, heal: 300 }), { doll: 3, roleText: false }));
  assert.equal(sim.readFighter(doc2, 3).role, 'attacker');
});

test('the dolls a page offers', () => {
  assert.deepEqual(sim.dollsOn(page(characterPage(fighter()))), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(sim.dollsOn(page(characterPage(fighter(), { dolls: { 1: null, 2: 'tank', 3: 'healer' } }))), [1, 2, 3]);
});
