// Smelts the items the user ticked on the packages page. Like the workbench
// repair it only sends the game's own AJAX requests, so no page is opened:
//
//   collect   finished smelts -> Horreum ("Store resources") or a package
//   fill      for each free smelter slot and queued item:
//             package -> free bag spot -> preview -> rent (gold), which
//             starts the smelt
//
// The queue (memory.smeltQueue) holds packages by their container number,
// which stays the same until the package is opened. Smelting takes a while
// (about an hour on a speed x2 server), so the bot comes back when the
// first slot is due (memory.smeltNext).
(function (root) {
  'use strict';
  const GBot = (root.GBot = root.GBot || {});
  const { parseNumber, ActionError, formatDuration } = GBot.util;
  const brain = GBot.brain;

  // Item types the smelter takes (its drop box's data-content-type-accept).
  const SMELTABLE = 1855;
  const MAX_FAILURES = 3;
  const RETRY_MS = 10 * 60 * 1000;

  const state = (slot) => slot && slot['forge_slots.state'];
  const smelt = (sh, submod, slot, params = '') =>
    GBot.forge.ajax(sh, `mod=forge&submod=${submod}`, `mod=forge&submod=${submod}&mode=smelting&slot=${slot}${params ? `&${params}` : ''}`);

  // A queue entry from a package item element on the packages page.
  function queueEntry(el) {
    const lines = GBot.forge.tooltipLines(el);
    return {
      cn: parseNumber(el.parentElement.getAttribute('data-container-number')),
      name: lines[0] || 'item',
      basis: el.dataset.basis || '',
      w: Number(el.dataset.measurementX) || 1,
      h: Number(el.dataset.measurementY) || 1,
    };
  }

  const isSmeltable = (el) => (Number(el.dataset.contentType) & SMELTABLE) > 0;

  async function readSmelter(sh) {
    return GBot.forge.readSlots((await GBot.forge.getDoc(sh, { mod: 'forge', submod: 'smeltery' })).html);
  }

  // Finds a queued package (by name, then container number) among the
  // packages. Returns the item element or null.
  async function findPackage(sh, entry) {
    const { doc } = await GBot.forge.getDoc(sh, { mod: 'packages', qry: entry.name, f: 0, fq: -1 });
    return (
      Array.from(doc.querySelectorAll('.packageItem [data-content-type]')).find(
        (el) => parseNumber(el.parentElement.getAttribute('data-container-number')) === entry.cn
      ) || null
    );
  }

  async function collect(ctx, slots) {
    const { memory, settings } = ctx;
    const sh = ctx.state.sh;
    const toHorreum = settings.smelting.storeIn !== 'packages';
    for (let slot = 0; slot < slots.length; slot++) {
      if (state(slots[slot]) !== 'finished-succeeded') continue;
      const name = (slots[slot].item && slots[slot].item.name) || 'an item';
      await ctx.humanDelay();
      await smelt(sh, toHorreum ? 'storeSmelted' : 'lootbox', slot);
      memory.stats.smelted = (memory.stats.smelted || 0) + 1;
      ctx.log('info', `Smelted ${name}; resources ${toHorreum ? 'stored in the Horreum' : 'sent as a package'}`);
      slots[slot] = { 'forge_slots.state': 'closed' };
    }
  }

  // Puts the first queued item into `slot`. Returns the rent paid, or 0 when
  // the entry was dropped.
  async function start(ctx, slot, gold) {
    const { memory } = ctx;
    const sh = ctx.state.sh;
    const entry = memory.smeltQueue[0];

    const pkg = await findPackage(sh, entry);
    if (!pkg) {
      memory.smeltQueue.shift();
      ctx.log('warn', `Smelting: ${entry.name} is no longer in the packages, removed from the queue`);
      return 0;
    }
    const spot = await GBot.forge.freeBagSpot(sh, entry.w, entry.h);
    await ctx.humanDelay();
    const moved = await GBot.forge.moveItem(sh, { from: entry.cn, fromX: 1, fromY: 1, to: spot.bag, toX: spot.x, toY: spot.y, amount: 1 });
    const iid = moved.to && moved.to.data && moved.to.data.itemId;
    // From here on the item is in the bag: leave the queue either way.
    memory.smeltQueue.shift();
    await ctx.persist();
    if (!iid) throw new ActionError(`Smelting: moved ${entry.name} to the bag but could not read its id; it stays in the bag`);

    const preview = JSON.parse(await smelt(sh, 'getSmeltingPreview', slot, `iid=${iid}&amount=1`)).slots[slot];
    const formula = (preview && preview.formula) || {};
    const rent = formula.rent ? Number(formula.rent[GBot.forge.RENT_GOLD]) : NaN;
    if (!(rent > 0)) throw new ActionError(`The smelter does not take ${entry.name}; it stays in your bag`);
    if (!(gold >= rent)) {
      throw new ActionError(`Not enough gold to smelt ${entry.name} (${rent.toLocaleString('en-US')}); it stays in your bag`);
    }

    await ctx.humanDelay();
    // In the smelter renting the slot starts smelting at once (the rent
    // buttons are the "Smelt" button); a separate "start" is refused (400).
    // Only send it if the game ever leaves the slot waiting, as the
    // workbench does.
    await smelt(sh, 'rent', slot, `rent=${GBot.forge.RENT_GOLD}&item=${iid}`);
    let started = (await readSmelter(sh))[slot];
    if (state(started) === 'opened') {
      await smelt(sh, 'start', slot);
      started = (await readSmelter(sh))[slot];
    }
    if (state(started) !== 'crafting' && state(started) !== 'finished-succeeded') {
      throw new ActionError(`Smelting ${entry.name} did not start (slot ${slot + 1} is ${state(started) || 'unknown'})`);
    }
    const left = Math.max(0, Number(started['forge_slots.finishedIn']) || 0);
    ctx.log('info', `Smelting ${entry.name} (${formatDuration(left * 1000)}, ${rent.toLocaleString('en-US')} gold)`);
    return rent;
  }

  async function smeltAction(ctx) {
    const { memory } = ctx;
    const sh = ctx.state.sh;
    try {
      const slots = await readSmelter(sh);
      await collect(ctx, slots);
      let gold = ctx.state.gold;
      for (let slot = 0; slot < slots.length && memory.smeltQueue.length; slot++) {
        if (state(slots[slot]) !== 'closed') continue;
        const rent = await start(ctx, slot, gold);
        if (rent) {
          gold -= rent;
          memory.stats.goldSpent = (memory.stats.goldSpent || 0) + rent;
          slots[slot] = { 'forge_slots.state': 'crafting' };
        } else {
          slot -= 1; // entry dropped: try the next one in the same slot
        }
        await ctx.persist();
      }
      // Come back when the first smelt is due (or the queue can move on).
      const after = await readSmelter(sh);
      memory.smeltNext = brain.nextSmeltCheck(after, memory.smeltQueue.length, ctx.now());
    } catch (e) {
      // Count failures against the item at the head of the queue, and give
      // up on it after a few. Full bags are not the item's fault.
      const head = memory.smeltQueue[0];
      if (head && e instanceof ActionError && !/^No room/.test(e.message)) {
        memory.smeltFailures = memory.smeltFailingCn === head.cn ? (memory.smeltFailures || 0) + 1 : 1;
        memory.smeltFailingCn = head.cn;
        if (memory.smeltFailures >= MAX_FAILURES) {
          memory.smeltQueue.shift();
          memory.smeltFailures = 0;
          ctx.log('warn', `Smelting: gave up on ${head.name} after ${MAX_FAILURES} failed attempts`);
        }
      }
      memory.smeltNext = ctx.now() + RETRY_MS;
      throw e;
    }
    return { retick: true };
  }

  GBot.actions = GBot.actions || {};
  GBot.actions.smelt = smeltAction;
  GBot.smelter = { SMELTABLE, isSmeltable, queueEntry };

  if (typeof module !== 'undefined' && module.exports) module.exports = GBot.smelter;
})(typeof globalThis !== 'undefined' ? globalThis : this);
