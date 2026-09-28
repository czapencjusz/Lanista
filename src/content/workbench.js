// Repairs worn gear at the workbench. Everything happens through the same
// AJAX requests the game's own pages send, so no page has to be opened:
//
//   pick      worst item on the character below the threshold
//   unequip   character -> free bag spot
//   rent      workbench slot, paid in gold, after checking the Horreum stock
//   fill      materials from the Horreum, lowest quality first
//   start     ... wait (fights are held, see brain.decide) ...
//   collect   workbench -> package -> bag -> character
//
// memory.repair holds the step reached, so a reload in between resumes it.
// If anything goes wrong while the item is off the character, it is put back.
(function (root) {
  'use strict';
  const GBot = (root.GBot = root.GBot || {});
  const { parseNumber, ActionError } = GBot.util;
  const brain = GBot.brain;

  const DOLL_SLOTS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const FIRST_BAG = 512;
  const RENT_GOLD = 2; // rent option 3 is rubies: never used
  const MAX_FAILURES = 3;
  const RECHECK_MS = 20 * 60 * 1000;
  const SKIP_MS = 6 * 60 * 60 * 1000;

  // Leave an item out of the current "Repair all" run.
  function skipInRun(memory, r) {
    const all = memory.repairAll;
    if (!all) return;
    if (!all.done.includes(r.slot)) all.done.push(r.slot);
    all.skipped.push(r.name);
  }

  // ------------------------------------------------------------ requests

  function pageFetch() {
    // Firefox: content.fetch sends the request as the page would.
    return typeof content !== 'undefined' && content && content.fetch ? content.fetch.bind(content) : fetch;
  }

  async function getDoc(sh, params) {
    const url = new URL('index.php', location.href);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    url.searchParams.set('sh', sh);
    const response = await pageFetch()(url.href, { credentials: 'include' });
    if (!response.ok) throw new ActionError(`Loading ${params.mod} failed (${response.status})`);
    const html = await response.text();
    return { html, doc: new DOMParser().parseFromString(html, 'text/html') };
  }

  // POST to ajax.php like the game's sendAjax(): query in the URL, form data
  // in the body, plus the timestamp, session hash and CSRF token.
  async function ajax(sh, query, body = '') {
    const csrf = document.querySelector('meta[name="csrf-token"]');
    const response = await pageFetch()(new URL(`ajax.php?${query}`, location.href).href, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        ...(csrf ? { 'X-CSRF-Token': csrf.getAttribute('content') } : {}),
      },
      body: `${body}&a=${Date.now()}&sh=${encodeURIComponent(sh)}`,
    });
    if (!response.ok) throw new ActionError(`Request ${query.split('&')[1] || query} failed (${response.status})`);
    return response.text();
  }

  // POST a game form (not AJAX), e.g. an auction bid; returns the page.
  async function post(url, body) {
    const csrf = document.querySelector('meta[name="csrf-token"]');
    const response = await pageFetch()(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        ...(csrf ? { 'X-CSRF-Token': csrf.getAttribute('content') } : {}),
      },
      body,
    });
    if (!response.ok) throw new ActionError(`Sending the form failed (${response.status})`);
    return response.text();
  }

  const forge = (sh, submod, slot, params = '') =>
    ajax(sh, `mod=forge&submod=${submod}`, `mod=forge&submod=${submod}&mode=workbench&slot=${slot}${params ? `&${params}` : ''}`);

  async function moveItem(sh, move) {
    const text = await ajax(sh, `mod=inventory&submod=move&${new URLSearchParams(move)}`);
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new ActionError('Unexpected answer when moving an item');
    }
    if (data.error) throw new ActionError(`Moving the item was refused: ${data.error}`);
    return data;
  }

  // ------------------------------------------------------------- parsing

  function tooltipLines(el) {
    try {
      return JSON.parse(el.getAttribute('data-tooltip'))[0].map((l) => String(Array.isArray(l) ? l[0] : l));
    } catch (e) {
      return [];
    }
  }

  const size = (el) => ({ w: Number(el.dataset.measurementX) || 1, h: Number(el.dataset.measurementY) || 1 });

  function readDoll(doc) {
    const items = [];
    for (const slot of DOLL_SLOTS) {
      const el = doc.querySelector(`#char [data-container-number="${slot}"] [data-content-type], #char [data-content-type][data-container-number="${slot}"]`);
      if (!el || !el.getAttribute('data-item-id')) continue;
      const lines = tooltipLines(el);
      items.push({ slot, id: el.getAttribute('data-item-id'), name: lines[0] || `item in slot ${slot}`, basis: el.dataset.basis, ...size(el), condition: brain.conditionOf(lines) });
    }
    return items;
  }

  // All eight bags come with every page that shows the inventory, as
  // new BagLoader(..., JSON.parse('[["<div ...>", ...], ...]')).
  function bagDocs(html) {
    const m = html.match(/new BagLoader\([\s\S]*?JSON\.parse\('((?:[^'\\]|\\.)*)'\)/);
    if (!m) throw new ActionError('Could not read the inventory bags');
    const literal = m[1].replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_, e) =>
      e[0] === 'u' || e[0] === 'x' ? String.fromCharCode(parseInt(e.slice(1), 16)) : { n: '\n', r: '\r', t: '\t' }[e] || e
    );
    return JSON.parse(literal).map((bag) => new DOMParser().parseFromString(bag.join(''), 'text/html'));
  }

  // Every item element in the bags.
  const readBagItems = (html) => bagDocs(html).flatMap((doc) => Array.from(doc.querySelectorAll('[data-content-type]')));

  function readBags(html) {
    return bagDocs(html).map((doc, i) => {
      const cells = Array.from(doc.querySelectorAll('[data-content-type]')).map((el) => ({
        x: Number(el.dataset.positionX),
        y: Number(el.dataset.positionY),
        ...size(el),
      }));
      return { bag: FIRST_BAG + i, cells };
    });
  }

  function readSlots(html) {
    const m = html.match(/var slotsData\s*=\s*(\[[\s\S]*?\]);\s*\n/);
    if (!m) throw new ActionError('Could not read the workbench');
    return JSON.parse(m[1]);
  }

  function readStock(doc) {
    const el = doc.querySelector('#remove-resource-amount[data-max]');
    try {
      return el ? JSON.parse(el.getAttribute('data-max')) : {};
    } catch (e) {
      return {};
    }
  }

  const state = (slot) => slot && slot['forge_slots.state'];

  // ---------------------------------------------------------------- steps

  async function freeBagSpot(sh, w, h) {
    const { html } = await getDoc(sh, { mod: 'overview' });
    const spot = brain.freeSpot(readBags(html), w, h);
    if (!spot) throw new ActionError(`No room in the bags for a ${w}x${h} item`);
    return spot;
  }

  async function putBack(ctx, r) {
    const sh = ctx.state.sh;
    await moveItem(sh, { from: r.bag, fromX: r.x, fromY: r.y, to: r.slot, toX: 1, toY: 1, amount: 1, doll: 1 });
    ctx.log('info', `Repair: put ${r.name} back on`);
  }

  async function pick(ctx) {
    const { settings, memory } = ctx;
    const sh = ctx.state.sh;
    const now = ctx.now();
    const all = memory.repairAll;
    const { doc } = await getDoc(sh, { mod: 'overview', doll: 1 });
    // "Repair all" takes every item at or below its cutoff, once each; the
    // automatic repair only items below the threshold.
    const worn = readDoll(doc).filter((i) => !all || (!all.done.includes(i.slot) && brain.inRepairAll(i, settings)));
    const item = all ? brain.pickRepair(worn, 101, {}, now) : brain.pickRepair(worn, settings.repair.belowPercent, memory.repairSkip, now);
    if (!item) {
      memory.nextRepairCheck = now + RECHECK_MS;
      if (all) {
        memory.repairAll = null;
        const skipped = all.skipped.length ? `, skipped ${all.skipped.join(', ')}` : '';
        ctx.log('info', `Repair all: ${all.repaired} item${all.repaired === 1 ? '' : 's'} repaired${skipped}`);
        return { refresh: true };
      }
      return { retick: true };
    }
    let spot;
    try {
      spot = await freeBagSpot(sh, item.w, item.h);
    } catch (e) {
      // Nothing was moved yet: stop instead of retrying straight away.
      memory.nextRepairCheck = now + RECHECK_MS;
      memory.repairAll = null;
      ctx.log('warn', `Repair: ${e.message}`);
      return { retick: true };
    }
    await ctx.humanDelay();
    await moveItem(sh, { from: item.slot, fromX: 1, fromY: 1, to: spot.bag, toX: spot.x, toY: spot.y, amount: 1, doll: 1 });
    memory.repair = {
      stage: 'unequipped',
      id: item.id,
      name: item.name,
      basis: item.basis,
      slot: item.slot,
      w: item.w,
      h: item.h,
      ...spot,
      before: item.condition.percent,
      until: 0,
      failures: 0,
    };
    ctx.log('info', `Repair: taking off ${item.name} (conditioning ${item.condition.percent}%)`);
    return { retick: true };
  }

  async function rentAndStart(ctx) {
    const { settings, memory } = ctx;
    const r = memory.repair;
    const sh = ctx.state.sh;

    const bench = readSlots((await getDoc(sh, { mod: 'forge', submod: 'workbench' })).html);
    // Leftovers from an earlier run go to the packages first.
    const done = bench.findIndex((s) => state(s) === 'finished-succeeded');
    if (done >= 0) await forge(sh, 'lootbox', done);
    const slot = bench.findIndex((s) => state(s) === 'closed');
    if (slot < 0) throw new ActionError('All workbench slots are busy');

    const preview = JSON.parse(await forge(sh, 'getWorkbenchPreview', slot, `iid=${r.id}&amount=1`)).slots[slot];
    const formula = (preview && preview.formula) || {};
    if (!formula.needed || !formula.rent) throw new ActionError(`The workbench does not accept ${r.name}`);
    const rent = Number(formula.rent[RENT_GOLD]);
    if (!(ctx.state.gold >= rent)) throw new ActionError(`Not enough gold for the workbench (${rent})`);

    const { doc: storage } = await getDoc(sh, { mod: 'forge', submod: 'storage' });
    const available = brain.materialsAvailable(formula.needed, readStock(storage), settings.repair.maxQuality);
    if (available === 'none') {
      memory.repairSkip[r.id] = ctx.now() + SKIP_MS;
      skipInRun(memory, r);
      await putBack(ctx, r);
      memory.repair = null;
      ctx.log('warn', `Repair: no materials for ${r.name} in the Horreum, trying again in 6 hours`);
      return { retick: true };
    }

    await ctx.humanDelay();
    await forge(sh, 'rent', slot, `rent=${RENT_GOLD}&item=${r.id}`);
    Object.assign(r, { stage: 'rented', bench: slot, rent });
    await ctx.persist();

    // Lowest quality first, then better ones until the requirements are met.
    let current = null;
    for (let q = -1; q <= settings.repair.maxQuality; q++) {
      await forge(sh, 'storageToWarehouse', slot, `quality=${q}`);
      current = readSlots((await getDoc(sh, { mod: 'forge', submod: 'workbench' })).html)[slot];
      const needed = (current.formula && current.formula.needed) || {};
      const stock = current.inStock || {};
      if (Object.entries(needed).every(([key, n]) => !n.amount || (stock[key] || 0) >= n.amount)) break;
    }
    if (!current || !current.inStock || !Object.keys(current.inStock).length) {
      throw new ActionError(`No materials went into the workbench for ${r.name}`);
    }

    await forge(sh, 'start', slot);
    const started = readSlots((await getDoc(sh, { mod: 'forge', submod: 'workbench' })).html)[slot];
    if (state(started) !== 'crafting' && state(started) !== 'finished-succeeded') throw new ActionError('The repair did not start');
    const left = Math.max(0, Number(started['forge_slots.finishedIn']) || 0);
    Object.assign(r, { stage: 'repairing', until: ctx.now() + left * 1000 + 3000 });
    ctx.log('info', `Repair: ${r.name} is on the workbench (${GBot.util.formatDuration(left * 1000)}, ${rent.toLocaleString('en-US')} gold)`);
    return { retick: true };
  }

  async function collect(ctx) {
    const { memory } = ctx;
    const r = memory.repair;
    const sh = ctx.state.sh;

    if (r.stage === 'repairing') {
      const slot = readSlots((await getDoc(sh, { mod: 'forge', submod: 'workbench' })).html)[r.bench];
      if (state(slot) === 'crafting') {
        r.until = ctx.now() + Math.max(5, Number(slot['forge_slots.finishedIn']) || 0) * 1000 + 3000;
        return { retick: true };
      }
      if (state(slot) === 'finished-succeeded') await forge(sh, 'lootbox', r.bench);
      r.stage = 'packaged';
      await ctx.persist();
    }

    // Find the repaired item among the packages (its id changes on repair).
    const { doc } = await getDoc(sh, { mod: 'packages', qry: r.name, f: 0, fq: -1 });
    const match = Array.from(doc.querySelectorAll('.packageItem [data-content-type]')).find(
      (el) => tooltipLines(el)[0] === r.name && (!r.basis || el.dataset.basis === r.basis)
    );
    if (!match) throw new ActionError(`The repaired ${r.name} is not in the packages`);
    const from = parseNumber(match.parentElement.getAttribute('data-container-number'));
    const after = brain.conditionOf(tooltipLines(match));

    const spot = await freeBagSpot(sh, r.w, r.h);
    await ctx.humanDelay();
    await moveItem(sh, { from, fromX: 1, fromY: 1, to: spot.bag, toX: spot.x, toY: spot.y, amount: 1 });
    Object.assign(r, spot, { stage: 'inBag' });
    await ctx.persist();
    await moveItem(sh, { from: r.bag, fromX: r.x, fromY: r.y, to: r.slot, toX: 1, toY: 1, amount: 1, doll: 1 });

    memory.stats.repairs = (memory.stats.repairs || 0) + 1;
    if (memory.repairAll) {
      memory.repairAll.repaired += 1;
      // Once per run, even when the materials only allowed a partial repair.
      if (!memory.repairAll.done.includes(r.slot)) memory.repairAll.done.push(r.slot);
    }
    memory.stats.goldSpent = (memory.stats.goldSpent || 0) + (r.rent || 0);
    memory.repair = null;
    memory.nextRepairCheck = ctx.now() + 60 * 1000;
    ctx.log('info', `Repaired ${r.name}: ${r.before}% -> ${after ? after.percent : '?'}%`);
    return { refresh: true };
  }

  async function repair(ctx) {
    const { memory } = ctx;
    const r = memory.repair;
    try {
      if (!r) return await pick(ctx);
      if (r.stage === 'unequipped') return await rentAndStart(ctx);
      if (r.stage === 'inBag') {
        await putBack(ctx, r);
        memory.repair = null;
        return { refresh: true };
      }
      return await collect(ctx);
    } catch (e) {
      if (!memory.repair) {
        // Failed before anything was taken off: do not retry in a loop.
        const all = memory.repairAll;
        if (all) {
          all.failures = (all.failures || 0) + 1;
          if (all.failures >= MAX_FAILURES) {
            memory.repairAll = null;
            ctx.log('warn', `Repair all stopped: ${e.message}`);
          }
        } else {
          memory.nextRepairCheck = ctx.now() + RECHECK_MS;
        }
        throw e;
      }
      const cur = memory.repair;
      cur.failures = (cur.failures || 0) + 1;
      if (cur.failures < MAX_FAILURES) throw e;
      // Give up, but never leave the character without the item.
      if (cur.stage === 'unequipped' || cur.stage === 'inBag') {
        try {
          await putBack(ctx, cur);
        } catch (err) {
          ctx.log('error', `Repair: could not put ${cur.name} back on (${err.message}); please do it by hand`);
        }
      } else {
        ctx.log('error', `Repair: gave up on ${cur.name} (${cur.stage}); it is on the workbench or in the packages`);
      }
      memory.repairSkip[cur.id] = ctx.now() + SKIP_MS;
      skipInRun(memory, cur);
      memory.repair = null;
      memory.nextRepairCheck = ctx.now() + RECHECK_MS;
      throw e;
    }
  }

  GBot.actions = GBot.actions || {};
  // ------------------------------------------------------------- horreum

  // Total number of resources in a Horreum stock ({ type: { quality: n } }).
  const stockTotal = (stock) =>
    Object.values(stock || {}).reduce((sum, byQuality) => sum + Object.values(byQuality || {}).reduce((n, v) => n + (Number(v) || 0), 0), 0);

  // Moves every resource in the packages into the Horreum, like the
  // Horreum's own "Store resources" form with only "Packages" ticked.
  // Surplus above the Horreum's limit (99,999 per type and quality) is sold,
  // the game's default. Returns how many resources were stored.
  async function storePackagedResources(sh) {
    const before = readStock((await getDoc(sh, { mod: 'forge', submod: 'storage' })).doc);
    const text = await ajax(sh, 'mod=forge&submod=storageIn', 'inventory=0&packages=1&sell=1');
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new ActionError('Unexpected answer from the Horreum');
    }
    if (data.error) throw new ActionError(String(data.error));
    const after = data.amounts || readStock((await getDoc(sh, { mod: 'forge', submod: 'storage' })).doc);
    return stockTotal(after) - stockTotal(before);
  }

  GBot.actions.repair = repair;
  GBot.workbench = { readDoll, readBags, readSlots, readStock, stockTotal, storePackagedResources };
  // Request helpers shared with the smelter (smelter.js).
  GBot.forge = { getDoc, ajax, post, moveItem, tooltipLines, readBags, readBagItems, readSlots, freeBagSpot, RENT_GOLD };

  if (typeof module !== 'undefined' && module.exports) module.exports = GBot.workbench;
})(typeof globalThis !== 'undefined' ? globalThis : this);
