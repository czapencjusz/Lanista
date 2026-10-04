// Looking after the character with the game's own requests only, like the
// workbench (no page is opened):
//
//   medic     the guild's Villa Medici: a doctor heals a share of the HP
//   gods      favour spent on blessings and holy oils
//   boosts    boost potions from the bags or packages, used on the character
//   costume   Dīs Pater's Armour once it can be worn, else an everyday costume
(function (root) {
  'use strict';
  const GBot = (root.GBot = root.GBot || {});
  const { parseNumber, ActionError, formatDuration } = GBot.util;
  const { SEL } = GBot.selectors;
  const brain = GBot.brain;

  const RETRY_MS = 15 * 60 * 1000;
  const NO_MEDIC_MS = 6 * 3600 * 1000;
  const COSTUME_CHECK_MS = 30 * 60 * 1000;
  const fmt = (n) => Number(n).toLocaleString('en-US');
  // A potion's duration: "2 h", "30 min".
  const lasts = (ms) => (ms >= 3600000 && ms % 3600000 === 0 ? `${ms / 3600000} h` : `${Math.round(ms / 60000)} min`);

  // A tooltip as text lines; a line may be a [label, value] pair
  // ("Maximum:", "215"), joined with a space.
  function tipLines(el) {
    try {
      return JSON.parse(el.getAttribute('data-tooltip'))[0].map((line) => {
        const first = Array.isArray(line) ? line[0] : line;
        return String(Array.isArray(first) ? first.join(' ') : first)
          .replace(/<[^>]*>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      });
    } catch (e) {
      return [];
    }
  }

  // The query of the index.php request in a link or an onclick, or null.
  function requestOf(text) {
    const m = String(text || '').match(/index\.php\?([^'"\s\\]+)/);
    return m ? new URLSearchParams(m[1].replace(/&amp;/g, '&')) : null;
  }

  // ----------------------------------------------------------- Villa Medici

  // The doctors on the Villa Medici page: [{ s, restMs }], s being the
  // doctor to ask (null while he rests). Null without the building.
  function readDoctors(doc) {
    const doctors = Array.from(doc.querySelectorAll(SEL.medic.rows))
      .map((row) => {
        const link = row.querySelector(SEL.medic.heal);
        const ticker = row.querySelector(SEL.medic.resting);
        if (!link && !ticker) return null;
        const q = link ? requestOf(link.getAttribute('href')) : null;
        return { s: q && q.get('s'), restMs: ticker ? parseNumber(ticker.getAttribute('data-ticker-time-left')) : null };
      })
      .filter(Boolean);
    return doctors.length ? doctors : null;
  }

  // When the first resting doctor is free again.
  const nextFree = (doctors, now) => {
    const rests = doctors.map((d) => d.restMs).filter((ms) => ms > 0);
    return rests.length ? now + Math.min(...rests) + 30000 : now + RETRY_MS;
  };

  async function medic(ctx) {
    const { memory, state } = ctx;
    const sh = state.sh;
    const now = ctx.now();
    const page = await GBot.forge.getDoc(sh, { mod: 'guild_medic' });
    const doctors = readDoctors(page.doc);
    if (!doctors) {
      memory.medicNext = now + NO_MEDIC_MS;
      ctx.log('warn', 'Villa Medici: no doctors on the page (is your guild without the building?); looking again in 6 hours');
      return { retick: true };
    }
    const free = doctors.filter((d) => d.s);
    if (!free.length) {
      memory.medicNext = nextFree(doctors, now);
      ctx.log('info', `Villa Medici: every doctor is resting; the next is free in ${formatDuration(memory.medicNext - now)}`);
      return { retick: true };
    }
    const before = GBot.state.readHp(page.doc);
    await ctx.humanDelay();
    const answer = await GBot.forge.getDoc(sh, { mod: 'guild_medic', s: free[0].s });
    const after = GBot.state.readHp(answer.doc);
    const left = readDoctors(answer.doc) || [];
    memory.medicNext = left.some((d) => d.s) ? 0 : nextFree(left, ctx.now());
    if (before.value !== null && after.value !== null && after.value > before.value) {
      brain.countMedic(state, memory, ctx.now());
      memory.stats.medic = (memory.stats.medic || 0) + 1;
      ctx.log('info', `Villa Medici: a doctor healed you from ${before.percent}% to ${after.percent}% HP (+${fmt(after.value - before.value)})`);
    } else {
      memory.medicNext = Math.max(memory.medicNext, ctx.now() + RETRY_MS);
      ctx.log('warn', 'Villa Medici: asked a doctor, but HP did not go up; trying again later');
    }
    return { refresh: true };
  }

  // ------------------------------------------------------------------- gods

  // The request behind a rank's onclick, when it is the plain favour
  // purchase (submod=activateBlessing&god&rank and nothing else); anything
  // else is never sent.
  function blessingParams(onclick) {
    const q = requestOf(onclick);
    if (!q || q.get('mod') !== 'gods' || q.get('submod') !== 'activateBlessing') return null;
    const god = q.get('god');
    const rank = q.get('rank');
    if (!/^\d+$/.test(god || '') || !/^\d+$/.test(rank || '')) return null;
    if (Array.from(q.keys()).some((k) => !['mod', 'submod', 'god', 'rank', 'sh'].includes(k))) return null;
    return { mod: 'gods', submod: 'activateBlessing', god, rank };
  }

  // The gods page: [{ god, points, max, ranks: [{ rank, name, cost, params }] }].
  // A cost is only read in favour; params are null while a rank cannot be
  // bought (on cooldown, or not enough favour).
  function readGods(doc) {
    return Array.from(doc.querySelectorAll(SEL.gods.box)).map((box) => {
      const nums = ((box.querySelector(SEL.gods.points) || {}).textContent || '').match(/\d[\d.,]*/g) || [];
      const ranks = Array.from(box.querySelectorAll(SEL.gods.ranks)).map((area, i) => {
        const lines = tipLines(area);
        const text = lines.join(' | ');
        const cost = /rub(y|ies)/i.test(text) ? null : parseNumber((text.match(/Cost:\s*([\d.,]+)\s*Favou?r/i) || [])[1]);
        const params = blessingParams(area.getAttribute('onclick'));
        return { rank: params ? Number(params.rank) : i + 1, name: lines[0] || `rank ${i + 1}`, cost, params };
      });
      return { god: box.id, points: parseNumber(nums[0]), max: parseNumber(nums[1]), ranks };
    });
  }

  async function gods(ctx) {
    const { memory, settings } = ctx;
    const sh = ctx.state.sh;
    try {
      let list = readGods((await GBot.forge.getDoc(sh, { mod: 'gods' })).doc);
      if (!list.length) throw new ActionError('Could not read the gods page');
      for (const pick of brain.pickBlessings(list, settings)) {
        await ctx.humanDelay();
        let after = readGods((await GBot.forge.getDoc(sh, pick.params)).doc);
        if (!after.length) after = readGods((await GBot.forge.getDoc(sh, { mod: 'gods' })).doc);
        const was = list.find((g) => g.god === pick.god);
        const now = after.find((g) => g.god === pick.god);
        if (was && now && was.points !== null && now.points !== null && was.points - now.points >= pick.cost) {
          memory.stats.blessings = (memory.stats.blessings || 0) + 1;
          ctx.log('info', `Gods: ${pick.name} for ${pick.cost} favour (${now.points} left)`);
        } else {
          ctx.log('warn', `Gods: asked for ${pick.name}, but the favour did not go down`);
        }
        if (after.length) list = after;
        await ctx.persist();
      }
      memory.nextGodsCheck = ctx.now() + brain.GODS_CHECK_MS;
    } catch (e) {
      memory.nextGodsCheck = ctx.now() + RETRY_MS;
      throw e;
    }
    return { retick: true };
  }

  // ----------------------------------------------------------------- boosts

  // The overview's stat tooltips, in this order (#char_f0_tt...).
  const STATS = ['strength', 'dexterity', 'agility', 'constitution', 'charisma', 'intelligence'];

  // A stat's value and maximum ("Agility: 1112 | Basic: 535 | Maximum:
  // 1180 | ..."); health is the HP maximum, which has none.
  function statOf(doc, stat) {
    if (stat === 'health') return { value: GBot.state.readHp(doc).max, max: null };
    const el = doc.querySelector(SEL.statTooltip(STATS.indexOf(stat)));
    if (!el) return { value: null, max: null };
    const text = tipLines(el).join(' | ');
    return {
      value: parseNumber((text.match(/^[^:|]+:\s*([\d.,]+)/) || [])[1]),
      max: parseNumber((text.match(/Maximum:\s*([\d.,]+)/i) || [])[1]),
    };
  }

  // Room below each stat's maximum: { stat: maximum - value }.
  function statRoom(doc) {
    const room = {};
    for (const stat of STATS) {
      const { value, max } = statOf(doc, stat);
      if (value !== null && max !== null) room[stat] = max - value;
    }
    return room;
  }

  const isBoost = (basis) => /^11-/.test(basis || '');

  // Boost potions in the bags ({ from: 'bag', bag, x, y }) and the packages
  // ({ from: 'packages', cn, ... }), each with its effect.
  async function boostItems(ctx, html) {
    const items = [];
    for (let bag = 512; bag <= 519; bag++) {
      for (const el of GBot.forge.readBagItems(html, [bag])) {
        if (!isBoost(el.dataset.basis)) continue;
        const lines = tipLines(el);
        const boost = brain.boostOf(lines);
        if (boost) items.push({ from: 'bag', bag, x: Number(el.dataset.positionX), y: Number(el.dataset.positionY), name: lines[0] || 'boost', boost });
      }
    }
    for (const item of await GBot.packages.listAll(ctx.state.sh, { f: brain.PICK_FILTERS.boosts })) {
      if (!isBoost(item.basis)) continue;
      const boost = brain.boostOf(tipLines(item.el));
      if (boost) items.push({ ...item, from: 'packages', boost });
    }
    return items;
  }

  // Using a potion is dropping it on the character: the "move" request to
  // container 8. From the packages it goes into a bag first.
  async function useBoost(ctx, item) {
    const spot = item.from === 'bag' ? item : await GBot.packages.intoBag(ctx, item, true);
    await ctx.humanDelay();
    await GBot.forge.moveItem(ctx.state.sh, { from: spot.bag, fromX: spot.x, fromY: spot.y, to: 8, toX: 1, toY: 1, amount: 1 });
  }

  async function boosts(ctx) {
    const { memory, settings } = ctx;
    const sh = ctx.state.sh;
    const due = brain.boostsDue(settings, memory, ctx.now());
    memory.boostNote = memory.boostNote || {};
    try {
      const { html, doc } = await GBot.forge.getDoc(sh, { mod: 'overview' });
      const plan = brain.pickBoosts(await boostItems(ctx, html), statRoom(doc), due);
      for (const [stat, why] of Object.entries(plan.wait)) {
        memory.boostNext[stat] = ctx.now() + brain.BOOST_RECHECK_MS;
        // Said once, not every hour.
        if (memory.boostNote[stat] !== why) ctx.log('info', `Boosts: none used for ${stat} (${why})`);
        memory.boostNote[stat] = why;
      }
      for (const { stat, item } of plan.use) {
        const before = statOf(doc, stat).value;
        await useBoost(ctx, item);
        const after = statOf((await GBot.forge.getDoc(sh, { mod: 'overview' })).doc, stat).value;
        memory.boostNext[stat] = ctx.now() + (item.boost.durationMs || brain.BOOST_RECHECK_MS);
        memory.boostNote[stat] = null;
        if (before !== null && after !== null && after > before) {
          memory.stats.boosts = (memory.stats.boosts || 0) + 1;
          ctx.log('info', `Boosts: used ${item.name}, ${stat} ${fmt(before)} → ${fmt(after)} for ${lasts(item.boost.durationMs)}`);
        } else {
          ctx.log('warn', `Boosts: used ${item.name}, but ${stat} did not go up`);
        }
        await ctx.persist();
      }
    } catch (e) {
      for (const stat of due) memory.boostNext[stat] = Math.max(memory.boostNext[stat] || 0, ctx.now() + RETRY_MS);
      throw e;
    }
    return { retick: true };
  }

  // --------------------------------------------------------------- costumes

  // The costumes page (see costumePlan in brain.js for the shape). Sections
  // are told apart by their headings; a costume's buttons ask to confirm a
  // changeCostume request: setId 0 takes it off (so it is worn), any other
  // puts it on.
  function costumeKind(heading) {
    const t = String(heading || '').toLowerCase();
    if (t.includes('underworld')) return 'underworld';
    if (t.includes('festival')) return 'festival';
    if (t.includes('temporary')) return 'temporary';
    return 'everywear';
  }

  function readCostumes(doc) {
    const out = [];
    let kind = 'everywear';
    for (const el of doc.querySelectorAll(`${SEL.costumes.heading}, ${SEL.costumes.box}`)) {
      if (el.matches(SEL.costumes.heading)) {
        kind = costumeKind(el.textContent);
        continue;
      }
      const tip = el.querySelector(SEL.costumes.tooltip);
      const lines = tip ? tipLines(tip) : [];
      const pieces = (lines[0] || '').match(/\((\d+)\/(\d+)\)\s*$/);
      const level = kind === 'underworld' ? ((lines.join(' ').match(/victory on (normal|medium|hard)/i) || [])[1] || '').toLowerCase() || null : null;
      let worn = false;
      let wear = null;
      for (const button of el.querySelectorAll(SEL.costumes.buttons)) {
        const q = requestOf(button.getAttribute('onclick'));
        if (!q || q.get('mod') !== 'costumes' || q.get('submod') !== 'changeCostume') continue;
        if (q.get('setId') === '0') worn = true;
        else if (!wear && /^\d+$/.test(q.get('setId') || '') && /^\d+$/.test(q.get('doll') || '')) wear = { mod: 'costumes', submod: 'changeCostume', doll: q.get('doll'), setId: q.get('setId') };
      }
      const waits = Array.from(el.querySelectorAll(SEL.costumes.ticker))
        .map((t) => parseNumber(t.getAttribute('data-ticker-time-left')))
        .filter((ms) => ms > 0);
      out.push({
        name: (lines[0] || 'costume').replace(/\s*\(\d+\/\d+\)\s*$/, ''),
        kind,
        level,
        owned: pieces ? Number(pieces[1]) > 0 : false,
        worn,
        wear,
        waitMs: waits.length ? Math.min(...waits) : null,
      });
    }
    return out;
  }

  // When the costume on now runs out: the header's costume buff (seconds).
  function costumeEndsIn(doc) {
    const buff = doc.querySelector(SEL.costumeBuff);
    const s = buff ? Number(buff.getAttribute('data-effect-end')) : NaN;
    return Number.isFinite(s) && s > 0 ? s * 1000 : null;
  }

  const wornOf = (costumes) => {
    const c = costumes.find((x) => x.worn);
    return c ? { name: c.name, kind: c.kind, level: c.level } : null;
  };
  const armourName = (c) => `Dīs Pater's Armour${c.level ? ` (${c.level})` : ''}`;

  async function costume(ctx) {
    const { memory, settings } = ctx;
    const sh = ctx.state.sh;
    try {
      const { doc } = await GBot.forge.getDoc(sh, { mod: 'costumes' });
      const costumes = readCostumes(doc);
      if (!costumes.length) throw new ActionError('Could not read the costumes page');
      const was = memory.costumeWorn;
      const worn = wornOf(costumes);
      memory.costumeWorn = worn;
      if (was && was.kind === 'underworld' && (!worn || worn.name !== was.name || worn.level !== was.level)) {
        ctx.log('info', `Costumes: ${armourName(was)} has run out`);
        if (ctx.notify) ctx.notify('costume', `Lanista: ${armourName(was)} has run out.`);
      }
      const plan = brain.costumePlan(costumes, settings);
      const now = ctx.now();
      if (plan.wait) {
        const ends = worn && worn.kind === 'underworld' ? costumeEndsIn(doc) : null;
        const target = settings.costumes.everyday && costumes.find((c) => brain.costumeName(c.name) === brain.costumeName(settings.costumes.everyday));
        const waitMs = ends || (target && !target.worn && target.waitMs) || COSTUME_CHECK_MS;
        memory.nextCostumeCheck = now + Math.min(Math.max(waitMs + 30000, 60000), 12 * 3600 * 1000);
        if (memory.costumeNote !== plan.wait) ctx.log('info', `Costumes: ${plan.wait}; looking again in ${formatDuration(memory.nextCostumeCheck - now)}`);
        memory.costumeNote = plan.wait;
        return { retick: true };
      }
      await ctx.humanDelay();
      let after = readCostumes((await GBot.forge.getDoc(sh, plan.wear.wear)).doc);
      if (!after.length) after = readCostumes((await GBot.forge.getDoc(sh, { mod: 'costumes' })).doc);
      const on = after.find((c) => c.worn && c.name === plan.wear.name && c.level === plan.wear.level);
      memory.costumeNote = null;
      if (on) {
        memory.costumeWorn = wornOf(after);
        memory.nextCostumeCheck = ctx.now() + COSTUME_CHECK_MS;
        const name = on.kind === 'underworld' ? armourName(on) : on.name;
        ctx.log('info', `Costumes: put on ${name} (${plan.why})`);
        if (ctx.notify) ctx.notify('costume', `Lanista: put on ${name}.`);
      } else {
        memory.nextCostumeCheck = ctx.now() + RETRY_MS;
        ctx.log('warn', `Costumes: asked to put on ${plan.wear.name}, but it does not show as worn`);
      }
    } catch (e) {
      memory.nextCostumeCheck = ctx.now() + RETRY_MS;
      throw e;
    }
    return { retick: true };
  }

  GBot.actions = GBot.actions || {};
  Object.assign(GBot.actions, { medic, gods, boosts, costume });
  GBot.character = { tipLines, readDoctors, readGods, blessingParams, statOf, statRoom, readCostumes, costumeEndsIn };

  if (typeof module !== 'undefined' && module.exports) module.exports = GBot.character;
})(typeof globalThis !== 'undefined' ? globalThis : this);
