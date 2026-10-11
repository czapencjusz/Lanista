// Fight simulator: plays an arena duel or a Circus Turma team fight a few
// hundred times with the game's rules, to tell how likely a win is before
// attacking. Pure functions (a page is only read by readFighter), so it is
// unit-testable in Node.
//
// The rules, as the game's combat reports show them:
//   - The arena lasts up to 15 rounds, the Circus Turma up to 50. In a
//     round every fighter acts once, in random order (higher agility does
//     not go first). A fighter at 0 HP is out; a side with nobody left
//     loses, otherwise the side that dealt more damage wins (healing does
//     not count).
//   - An attack hits with dexterity / (dexterity + the target's agility).
//     A double hit (two attacks in the round) comes with
//     charisma x dexterity / (the target's intelligence x agility) x 10 %.
//   - A hit is critical with the attacker's chance for critical damage,
//     less the target's chance for avoiding critical hits (crit x (1 -
//     avoid)). The target blocks with its chance to block a hit: a blocked
//     hit does half damage, so a blocked critical hit does normal damage.
//   - Damage is a roll in the attacker's damage range (twice that for a
//     critical hit) less a roll in the target's absorption range, at least 0.
//   - Circus Turma: healers heal the most hurt team mate (their healing
//     value, 1.5 times that on an improved heal, no more than is missing),
//     and attack when nobody is hurt. Attackers pick their target weighted
//     by its threat.
//
// A fighter: { name, level, hp, hpMax, str, dex, agi, con, cha, int,
// dmg: [min, max], abs: [min, max], crit, block, avoid (percent),
// threat, heal, critHeal (percent), role: 'attacker' | 'tank' | 'healer' }.
(function (root) {
  'use strict';
  const GBot = (root.GBot = root.GBot || {});

  const ARENA_ROUNDS = 15;
  const CIRCUS_ROUNDS = 50;
  // Even a fighter with no threat draws some attacks.
  const THREAT_FLOOR = 100;
  const IMPROVED_HEAL = 1.5;

  // ------------------------------------------------------------ the rules

  const clampPct = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0);
  const hitChance = (a, b) => (a.dex + b.agi > 0 ? Math.floor((a.dex / (a.dex + b.agi)) * 100) : 50);
  const doubleChance = (a, b) => clampPct(Math.round(((a.cha * a.dex) / Math.max(1, b.int * b.agi)) * 10));
  const roll = ([min, max], rng) => min + Math.floor(rng() * (max - min + 1));

  // What one fighter does to another, worked out once per pair.
  function matchup(a, b) {
    return {
      hit: hitChance(a, b),
      double: doubleChance(a, b),
      crit: clampPct(a.crit) * (1 - clampPct(b.avoid) / 100),
      block: clampPct(b.block),
      dmg: a.dmg,
      abs: b.abs,
    };
  }

  // The damage of one attack (0 for a miss).
  function strike(m, rng) {
    if (rng() * 100 >= m.hit) return 0;
    let dmg = roll(m.dmg, rng);
    if (rng() * 100 < m.crit) dmg *= 2;
    if (rng() * 100 < m.block) dmg = Math.floor(dmg / 2);
    return Math.max(0, dmg - roll(m.abs, rng));
  }

  // ---------------------------------------------------------------- arena

  // One duel: true when `a` wins.
  function duel(a, b, ab, ba, rng, rounds = ARENA_ROUNDS) {
    const hp = [a.hp, b.hp];
    const dealt = [0, 0];
    const sides = [ab, ba];
    for (let r = 0; r < rounds; r++) {
      const first = rng() < 0.5 ? 0 : 1;
      for (const who of [first, 1 - first]) {
        const m = sides[who];
        const times = rng() * 100 < m.double ? 2 : 1;
        for (let i = 0; i < times; i++) {
          const d = Math.min(strike(m, rng), hp[1 - who]);
          hp[1 - who] -= d;
          dealt[who] += d;
          if (hp[1 - who] <= 0) return who === 0;
        }
      }
    }
    return dealt[0] > dealt[1];
  }

  // Share of `runs` duels `a` wins against `b` (0..1).
  function arenaChance(a, b, { runs = 500, rng = Math.random } = {}) {
    const ab = matchup(a, b);
    const ba = matchup(b, a);
    let wins = 0;
    for (let i = 0; i < runs; i++) if (duel(a, b, ab, ba, rng)) wins++;
    return wins / runs;
  }

  // --------------------------------------------------------- circus turma

  function pickWeighted(list, weight, rng) {
    const total = list.reduce((s, x) => s + weight(x), 0);
    let left = rng() * total;
    for (const x of list) {
      left -= weight(x);
      if (left <= 0) return x;
    }
    return list[list.length - 1];
  }

  // One team fight: true when team A wins.
  function teamFight(A, B, pairs, rng, rounds = CIRCUS_ROUNDS) {
    const all = A.map((f, i) => ({ f, side: 0, i, hp: f.hp })).concat(B.map((f, i) => ({ f, side: 1, i, hp: f.hp })));
    const team = [all.filter((x) => x.side === 0), all.filter((x) => x.side === 1)];
    const dealt = [0, 0];
    const weight = (x) => Math.max(0, x.f.threat || 0) + THREAT_FLOOR;
    for (let r = 0; r < rounds; r++) {
      const order = all.filter((x) => x.hp > 0);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      for (const x of order) {
        if (x.hp <= 0) continue;
        if (x.f.role === 'healer' && x.f.heal > 0) {
          const hurt = team[x.side].filter((y) => y.hp > 0 && y.hp < y.f.hpMax);
          if (hurt.length) {
            const y = hurt.reduce((m, y) => (y.hp / y.f.hpMax < m.hp / m.f.hpMax ? y : m));
            const amount = Math.round(x.f.heal * (rng() * 100 < (x.f.critHeal || 0) ? IMPROVED_HEAL : 1));
            y.hp = Math.min(y.f.hpMax, y.hp + amount);
            continue;
          }
        }
        const foes = team[1 - x.side].filter((y) => y.hp > 0);
        const target = pickWeighted(foes, weight, rng);
        const m = pairs[x.side][x.i][target.i];
        const times = rng() * 100 < m.double ? 2 : 1;
        for (let k = 0; k < times && target.hp > 0; k++) {
          const d = Math.min(strike(m, rng), target.hp);
          target.hp -= d;
          dealt[x.side] += d;
        }
        if (target.hp <= 0 && !team[1 - x.side].some((y) => y.hp > 0)) return x.side === 0;
      }
    }
    return dealt[0] > dealt[1];
  }

  // Share of `runs` fights team A wins against team B (0..1). Everyone
  // starts with full HP, as in the game.
  function circusChance(A, B, { runs = 200, rng = Math.random } = {}) {
    const full = (t) => t.map((f) => ({ ...f, hp: f.hpMax || f.hp }));
    const a = full(A);
    const b = full(B);
    const pairs = [a.map((x) => b.map((y) => matchup(x, y))), b.map((x) => a.map((y) => matchup(x, y)))];
    let wins = 0;
    for (let i = 0; i < runs; i++) if (teamFight(a, b, pairs, rng)) wins++;
    return wins / runs;
  }

  // ------------------------------------------------------------ the pages
  //
  // A character page (the overview, or a player's profile, one per doll:
  // the gladiator, his dungeon / Circus Turma self, the mercenaries) shows
  // the stats as #char_* elements, and the game's own derived values in
  // their tooltips: hit points (current / max), the armour's absorption
  // range, the chances for avoiding critical hits, blocking, critical
  // damage and improved healing. These are read by their form ("a - b",
  // "n %"), not their labels, so any language works.

  const toNumber = (text) => {
    const n = parseInt(String(text == null ? '' : text).replace(/[^\d-]/g, ''), 10);
    return Number.isFinite(n) ? n : null;
  };

  function tooltipValues(doc, id) {
    const el = doc.getElementById(id);
    if (!el) return [];
    try {
      const rows = JSON.parse(el.getAttribute('data-tooltip'))[0];
      return rows.map((row) => String(Array.isArray(row) && Array.isArray(row[0]) ? row[0][1] : ''));
    } catch (e) {
      return [];
    }
  }

  const percents = (values) => values.filter((v) => /^\s*-?\d+\s*%\s*$/.test(v)).map(toNumber);
  const range = (text) => {
    const m = /(\d[\d.,]*)\s*-\s*(\d[\d.,]*)/.exec(text || '');
    return m ? [toNumber(m[1]), toNumber(m[2])] : null;
  };

  // The role written on the doll's tab ("Task: Heal group members", ...).
  // Without it (another language), a fighter with healing and next to no
  // threat is taken for a healer. The gladiator's arena self (doll 1) fights
  // alone and has none.
  function readRole(doc, doll, threat, heal) {
    if (doll === 1) return 'attacker';
    const tab = doc.querySelector(`.charmercpic.doll${doll}`);
    const tip = tab ? tab.getAttribute('data-tooltip') || '' : '';
    if (/heal group/i.test(tip)) return 'healer';
    if (/attention to oneself/i.test(tip)) return 'tank';
    if (/dish out damage/i.test(tip)) return 'attacker';
    return heal > 0 && threat <= 25 ? 'healer' : 'attacker';
  }

  // The fighter on a character page, or null when the page has no stats.
  function readFighter(doc, doll = 1) {
    const text = (id) => {
      const el = doc.getElementById(id);
      return el ? el.textContent.trim() : null;
    };
    const level = toNumber(text('char_level'));
    const dmg = range(text('char_schaden'));
    if (level === null || !dmg) return null;
    const life = range(tooltipValues(doc, 'char_leben_tt')[0] && tooltipValues(doc, 'char_leben_tt')[0].replace('/', '-'));
    const armour = tooltipValues(doc, 'char_panzer_tt');
    const [avoid, block] = percents(armour);
    const [crit] = percents(tooltipValues(doc, 'char_schaden_tt'));
    const [critHeal] = percents(tooltipValues(doc, 'char_healing_tt'));
    const threat = toNumber(text('char_threat')) || 0;
    const heal = toNumber(text('char_healing')) || 0;
    const name = (doc.querySelector('.playername, .playername_achievement') || { textContent: '' }).textContent.trim();
    return {
      name,
      level,
      hp: life ? life[0] : null,
      hpMax: life ? life[1] : null,
      str: toNumber(text('char_f0')) || 0,
      dex: toNumber(text('char_f1')) || 0,
      agi: toNumber(text('char_f2')) || 0,
      con: toNumber(text('char_f3')) || 0,
      cha: toNumber(text('char_f4')) || 0,
      int: toNumber(text('char_f5')) || 0,
      dmg,
      abs: armour.map(range).find(Boolean) || [0, 0],
      crit: crit || 0,
      block: block || 0,
      avoid: avoid || 0,
      threat,
      heal,
      critHeal: critHeal || 0,
      role: readRole(doc, doll, threat, heal),
    };
  }

  // The dolls a character page offers (1 = the gladiator, 2 = his dungeon
  // and Circus Turma self, 3-6 = mercenaries).
  function dollsOn(doc) {
    const found = [...doc.querySelectorAll('.charmercpic')].map((el) => toNumber((/doll(\d)/.exec(el.className) || [])[1])).filter((n) => n);
    return [...new Set(found)].sort((a, b) => a - b);
  }

  GBot.sim = { ARENA_ROUNDS, CIRCUS_ROUNDS, hitChance, doubleChance, matchup, strike, arenaChance, circusChance, readFighter, dollsOn };

  if (typeof module !== 'undefined' && module.exports) module.exports = GBot.sim;
})(typeof globalThis !== 'undefined' ? globalThis : this);
