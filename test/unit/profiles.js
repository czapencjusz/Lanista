// Character pages (a player's profile, or your overview) as the game shows
// them on s55-en / s303-en (2026-10-11): #char_* values, and the derived
// values in the tooltips, one row per line: [[label, value], [colours]].
'use strict';

const attr = (value) => JSON.stringify(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const tip = (rows) => attr([rows.map((r) => [r, ['#BA9700', '#DDDDDD']])]);

const ROLES = { tank: 'Direct attention to oneself', attacker: 'Dish out damage', healer: 'Heal group members' };

// A fighter as sim.js reads it, with RAMBO's (s55, level 106) numbers by
// default.
function fighter(over = {}) {
  return {
    name: 'RAMBO',
    level: 106,
    hp: 20060,
    hpMax: 20060,
    str: 450,
    dex: 682,
    agi: 797,
    con: 641,
    cha: 440,
    int: 368,
    dmg: [467, 528],
    abs: [239, 292],
    crit: 39,
    block: 49,
    avoid: 25,
    threat: 0,
    heal: 392,
    critHeal: 5,
    role: 'attacker',
    ...over,
  };
}

// The page for one doll. `dolls` lists the doll tabs shown ({ n: role }).
function characterPage(f, { doll = 1, dolls = { 1: null, 2: 'tank', 3: 'attacker', 4: 'attacker', 5: 'healer', 6: 'attacker' }, roleText = true } = {}) {
  const tabs = Object.entries(dolls)
    .map(([n, role]) => {
      const text = Number(n) === 1 ? 'Standard Battle' : `Mercenary<br /><font>Task: ${roleText && role ? ROLES[role] : 'Aufgabe'}</font>`;
      return `<div class="charmercpic doll${n}" data-tooltip="${attr([[[text, 'white']]])}"></div>`;
    })
    .join('');
  return `<!doctype html><html><body>
    <div class="playername">${f.name}</div>
    ${tabs}
    <div id="charstats">
      <span id="char_level">${f.level}</span>
      <div id="char_leben_tt" data-tooltip="${tip([['Hit Points:', `${f.hp} / ${f.hpMax}`], ['Life on level:', 2650], ['Through items:', '+1435']])}"></div>
      ${['str', 'dex', 'agi', 'con', 'cha', 'int'].map((k, i) => `<span id="char_f${i}">${f[k]}</span>`).join('')}
      <span id="char_panzer">17567</span>
      <div id="char_panzer_tt" data-tooltip="${tip([
        ['Armor:', 17567],
        ['Absorbs damage:', `${f.abs[0]} - ${f.abs[1]}`],
        ['Resilience:', 236],
        ['Through items:', '+157'],
        ['Through agility:', '+79'],
        ['Chance for avoiding critical hits:', `${f.avoid} %`],
        ['Blocking value:', 555],
        ['Through items:', '+510'],
        ['Through strength:', '+45'],
        ['Chance to block a hit:', `${f.block} %`],
      ])}"></div>
      <span id="char_schaden">${f.dmg[0]} - ${f.dmg[1]}</span>
      <div id="char_schaden_tt" data-tooltip="${tip([
        ['Damage:', `${f.dmg[0]} - ${f.dmg[1]}`],
        ['Basic:', '283 - 344'],
        ['Through items:', '+139'],
        ['Critical damage:', 370],
        ['Chance for critical damage:', `${f.crit} %`],
      ])}"></div>
      <span id="char_healing">${f.heal}</span>
      <div id="char_healing_tt" data-tooltip="${tip([
        ['Healing:', f.heal],
        ['critical healing value:', 73],
        ['Chance for improved healing:', `${f.critHeal} %`],
      ])}"></div>
      ${doll > 1 ? `<span id="char_threat">${f.threat}</span>` : ''}
    </div>
  </body></html>`;
}

// A seeded random source, so simulated chances are the same every run.
function seeded(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = { fighter, characterPage, seeded };
