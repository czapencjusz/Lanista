// Goes through the packages by the rules under Settings > Packages and
// Settings > Smelting. Like the workbench and the smelter it only sends the
// game's own requests, so no page is opened:
//
//   gold       gold packages -> a bag, which pays the gold out
//   resources  -> the Horreum (its own "Store resources" request)
//   smelt      gear by quality and kind -> the smelting queue (smelter.js)
//   sell       gear by quality and kind -> a bag -> a merchant's shop grid
//   expiring   packages about to expire -> a bag, or sold
//   pick       chosen item types (upgrades, boosts, scrolls...) -> a bag
//   scrolls    scrolls with a prefix or suffix the forge does not know
//              yet -> a bag -> used (learned)
//
// Selling is what a player does by dragging an item onto a merchant: the
// same "move" request, into the shop grid's container.
(function (root) {
  'use strict';
  const GBot = (root.GBot = root.GBot || {});
  const { parseNumber, ActionError } = GBot.util;
  const { SEL } = GBot.selectors;
  const brain = GBot.brain;

  const CHECK_MS = 30 * 60 * 1000;
  const MORE_MS = 60 * 1000;
  const RETRY_MS = 15 * 60 * 1000;
  // Items sold or moved per run; the rest follow a minute later.
  const MAX_MOVES = 10;
  const MAX_PAGES = 20;
  const RESOURCE_TYPE = 32768;
  // Six merchants (sub), three shop tabs each (subsub).
  const SHOPS = [1, 2, 3, 4, 5, 6].flatMap((sub) => [0, 1, 2].map((subsub) => ({ sub, subsub })));
  const COLOURS = { white: -1, green: 0, blue: 1, purple: 2, orange: 3, red: 4 };

  // The game leaves data-quality out for Ceres (green) items; the colour
  // class says the same.
  function qualityOf(el) {
    const q = el.getAttribute('data-quality');
    if (q !== null && q !== '' && !Number.isNaN(Number(q))) return Number(q);
    for (const c of el.classList) {
      const m = /^item-i-(white|green|blue|purple|orange|red)$/.exec(c);
      if (m) return COLOURS[m[1]];
    }
    return 0;
  }

  // The items on a packages page.
  function readPackageItems(doc) {
    const items = [];
    for (const pkg of doc.querySelectorAll(SEL.packages.package)) {
      const el = pkg.querySelector('[data-content-type]');
      const holder = el && el.closest('[data-container-number]');
      if (!el || !holder) continue;
      const ticker = pkg.querySelector(SEL.packages.expiry);
      const amount = Number(el.dataset.amount) || 1;
      items.push({
        el,
        cn: parseNumber(holder.getAttribute('data-container-number')),
        name: GBot.forge.tooltipLines(el)[0] || 'item',
        type: Number(el.dataset.contentType) || 0,
        quality: qualityOf(el),
        level: Number(el.dataset.level) || 0,
        basis: el.dataset.basis || null,
        amount,
        value: (Number(el.dataset.priceGold) || 0) * amount,
        w: Number(el.dataset.measurementX) || 1,
        h: Number(el.dataset.measurementY) || 1,
        expiresInMs: ticker ? Number(ticker.getAttribute('data-ticker-time-left')) : null,
      });
    }
    return items;
  }

  function lastPage(doc) {
    let last = 1;
    for (const a of doc.querySelectorAll(SEL.packages.pages)) {
      const m = (a.getAttribute('href') || '').match(/[?&]page=(\d+)/);
      if (m) last = Math.max(last, Number(m[1]));
    }
    return Math.min(last, MAX_PAGES);
  }

  // Every package (all pages), optionally filtered like the page's own
  // "Type of object" filter.
  async function listPackages(sh, filter = {}) {
    const items = [];
    let last = 1;
    for (let page = 1; page <= last; page++) {
      const { doc } = await GBot.forge.getDoc(sh, { mod: 'packages', f: 0, fq: -1, qry: '', page, ...filter });
      if (!doc.querySelector(SEL.packages.list)) throw new ActionError('Could not read the packages');
      if (page === 1) last = lastPage(doc);
      items.push(...readPackageItems(doc));
    }
    return items;
  }

  // A free spot in a merchant's shop grid ({ bag: container, x, y }).
  // Starts at the merchant used last.
  async function shopSpot(ctx, w, h) {
    const start = ctx.memory.shopIndex || 0;
    for (let i = 0; i < SHOPS.length; i++) {
      const k = (start + i) % SHOPS.length;
      const { doc } = await GBot.forge.getDoc(ctx.state.sh, { mod: 'inventory', ...SHOPS[k] });
      const shop = doc.querySelector(SEL.shop);
      if (!shop) continue;
      const size = (name, fallback) => {
        const m = (shop.getAttribute('style') || '').match(new RegExp(`${name}\\s*:\\s*(\\d+)px`));
        return m ? Math.round(Number(m[1]) / 32) : fallback;
      };
      const cells = Array.from(shop.querySelectorAll('[data-content-type]')).map((el) => ({
        x: Number(el.dataset.positionX),
        y: Number(el.dataset.positionY),
        w: Number(el.dataset.measurementX) || 1,
        h: Number(el.dataset.measurementY) || 1,
      }));
      const container = parseNumber(shop.getAttribute('data-container-number'));
      const spot = brain.freeSpot([{ bag: container, cells }], w, h, size('width', 6), size('height', 8));
      if (spot) {
        ctx.memory.shopIndex = k;
        return spot;
      }
    }
    throw new ActionError(`No merchant has room for a ${w}x${h} item`);
  }

  async function toBag(ctx, item) {
    const sh = ctx.state.sh;
    const spot = await GBot.forge.freeBagSpot(sh, item.w, item.h);
    await ctx.humanDelay();
    await GBot.forge.moveItem(sh, { from: item.cn, fromX: 1, fromY: 1, to: spot.bag, toX: spot.x, toY: spot.y, amount: item.amount });
    return spot;
  }

  async function sell(ctx, item) {
    const shop = await shopSpot(ctx, item.w, item.h);
    const spot = await toBag(ctx, item);
    await ctx.humanDelay();
    try {
      await GBot.forge.moveItem(ctx.state.sh, { from: spot.bag, fromX: spot.x, fromY: spot.y, to: shop.bag, toX: shop.x, toY: shop.y, amount: item.amount });
    } catch (e) {
      throw new ActionError(`Could not sell ${item.name} (${e.message}); it is in your bag`);
    }
  }

  // A free bag spot, outside the food bags when there is room elsewhere.
  async function spotOutsideFood(ctx, w, h) {
    const food = brain.foodBags(ctx.settings);
    const others = [512, 513, 514, 515, 516, 517, 518, 519].filter((b) => !food.includes(b));
    if (others.length) {
      try {
        return await GBot.forge.freeBagSpot(ctx.state.sh, w, h, others);
      } catch (e) {
        if (!/^No room/.test(e.message)) throw e;
      }
    }
    return GBot.forge.freeBagSpot(ctx.state.sh, w, h);
  }

  async function intoBag(ctx, item) {
    const spot = await spotOutsideFood(ctx, item.w, item.h);
    await ctx.humanDelay();
    const moved = await GBot.forge.moveItem(ctx.state.sh, { from: item.cn, fromX: 1, fromY: 1, to: spot.bag, toX: spot.x, toY: spot.y, amount: item.amount });
    return { ...spot, itemId: moved && moved.to && moved.to.data && moved.to.data.itemId };
  }

  // The chosen item types go from the packages into the bags.
  async function pickTypes(ctx, room) {
    const picks = settingsPicks(ctx.settings);
    let moved = 0;
    for (const [kind, filter] of picks) {
      const items = await listPackages(ctx.state.sh, { f: filter });
      let count = 0;
      for (const item of items) {
        if (moved >= room) return { moved, more: true };
        await intoBag(ctx, item);
        moved += 1;
        count += 1;
        await ctx.persist();
      }
      if (count) ctx.log('info', `Took ${count} ${PICK_LABELS[kind]}${count === 1 ? '' : 's'} out of the packages into your bags`);
    }
    return { moved, more: false };
  }

  const PICK_LABELS = { upgrades: 'upgrade', boosts: 'boost', scrolls: 'scroll', recipes: 'recipe', tools: 'tool', mercenary: 'mercenary item' };
  const settingsPicks = (settings) => Object.entries(brain.PICK_FILTERS).filter(([kind]) => settings.packages.pick && settings.packages.pick[kind]);

  // The prefixes and suffixes the forge knows (its selects' option names).
  async function knownAffixes(sh) {
    const { doc } = await GBot.forge.getDoc(sh, { mod: 'forge', submod: 'forge' });
    const names = Array.from(doc.querySelectorAll(SEL.forgeAffixes))
      .map((o) => o.textContent.trim())
      .filter((n) => n && n !== '-');
    if (!names.length) throw new ActionError('Could not read the known prefixes and suffixes from the forge');
    return names;
  }

  // A scroll teaches the prefix or suffix in its name ("Lepidus Scroll",
  // "Scroll of hell"): unknown while no known name is part of it.
  const scrollKnown = (name, known) => known.some((k) => name.toLowerCase().includes(k.toLowerCase()));

  async function learnScrolls(ctx) {
    const sh = ctx.state.sh;
    const scrolls = await listPackages(sh, { f: brain.PICK_FILTERS.scrolls });
    if (!scrolls.length) return;
    let known = await knownAffixes(sh);
    for (const scroll of scrolls) {
      if (scrollKnown(scroll.name, known)) continue;
      const spot = await intoBag(ctx, scroll);
      await ctx.humanDelay();
      await GBot.forge.moveItem(sh, { from: spot.bag, fromX: spot.x, fromY: spot.y, to: 8, toX: 1, toY: 1, amount: 1 });
      const before = known.length;
      known = await knownAffixes(sh);
      if (known.length > before) ctx.log('info', `Learned ${scroll.name}`);
      else ctx.log('warn', `Used ${scroll.name}, but the forge lists nothing new`);
      await ctx.persist();
    }
  }

  async function goldNow(sh) {
    const { doc } = await GBot.forge.getDoc(sh, { mod: 'overview' });
    return parseNumber((doc.querySelector(SEL.gold) || {}).textContent);
  }

  const fmt = (n) => Number(n).toLocaleString('en-US');

  async function collectGold(ctx) {
    const sh = ctx.state.sh;
    const packages = await listPackages(sh, { f: SEL.goldFilter });
    if (!packages.length) return;
    const before = await goldNow(sh);
    for (const item of packages) await toBag(ctx, item);
    const gained = (await goldNow(sh)) - before;
    if (gained > 0) ctx.memory.stats.goldCollected = (ctx.memory.stats.goldCollected || 0) + gained;
    ctx.log('info', `Took ${gained > 0 ? `${fmt(gained)} gold` : 'the gold'} out of ${packages.length} gold package${packages.length === 1 ? '' : 's'}`);
    await ctx.persist();
  }

  async function packagesAction(ctx) {
    const { memory, settings } = ctx;
    const sh = ctx.state.sh;
    const p = settings.packages;
    try {
      if (p.enabled && p.collectGold) await collectGold(ctx);
      let items = await listPackages(sh);

      // Gold packs are resources too: never store one before it is listed
      // (again).
      const packsWaiting = brain.goldPacksDue(memory, ctx.now());
      if (packsWaiting && p.storeResources) ctx.log('debug', 'Packages: not storing resources while a gold pack waits to be listed');
      if (p.enabled && p.storeResources && !packsWaiting && items.some((i) => i.type === RESOURCE_TYPE)) {
        await ctx.humanDelay();
        const stored = await GBot.workbench.storePackagedResources(sh);
        if (stored > 0) ctx.log('info', `Stored ${fmt(stored)} resources from the packages in the Horreum`);
        items = items.filter((i) => i.type !== RESOURCE_TYPE);
      }

      const queued = new Set(memory.smeltQueue.map((q) => q.cn));
      let toSmelt = 0;
      let moves = 0;
      let more = false;
      for (const item of items) {
        const action = brain.packageAction({ ...item, queued: queued.has(item.cn) }, settings);
        if (!action) continue;
        if (action === 'smelt') {
          memory.smeltQueue.push(GBot.smelter.queueEntry(item.el));
          queued.add(item.cn);
          toSmelt += 1;
          continue;
        }
        if (moves >= MAX_MOVES) {
          more = true;
          continue;
        }
        moves += 1;
        // Sold by the sell rule, or only because the package expires soon?
        const expiring = brain.packageAction({ ...item, expiresInMs: null }, settings) !== action;
        try {
          if (action === 'sell') {
            await sell(ctx, item);
            memory.stats.sold = (memory.stats.sold || 0) + 1;
            memory.stats.soldGold = (memory.stats.soldGold || 0) + item.value;
            ctx.log('info', `Sold ${item.name}${item.amount > 1 ? ` x${item.amount}` : ''} for ${fmt(item.value)} gold${expiring ? ' (its package was about to expire)' : ''}`);
          } else {
            await toBag(ctx, item);
            ctx.log('info', `Moved ${item.name} into your bags; its package was about to expire`);
          }
        } catch (e) {
          // Full bags or merchants: try again at the next check.
          if (!/^No (room|merchant)/.test(e.message)) throw e;
          ctx.log('warn', `Packages: ${e.message}; trying again later`);
          break;
        }
        await ctx.persist();
      }
      if (toSmelt) {
        ctx.log('info', `Queued ${toSmelt} item${toSmelt === 1 ? '' : 's'} from the packages for smelting`);
        memory.smeltNext = Math.min(memory.smeltNext || Infinity, ctx.now());
      }
      if (p.enabled && p.learnScrolls) {
        try {
          await learnScrolls(ctx);
        } catch (e) {
          if (!/^No room/.test(e.message)) throw e;
          ctx.log('warn', `Packages: ${e.message}; learning scrolls later`);
        }
      }
      if (p.enabled && !more && settingsPicks(settings).length) {
        try {
          more = (await pickTypes(ctx, MAX_MOVES - moves)).more;
        } catch (e) {
          if (!/^No room/.test(e.message)) throw e;
          ctx.log('warn', `Packages: ${e.message}; taking items out later`);
        }
      }
      memory.nextPackagesCheck = ctx.now() + (more ? MORE_MS : CHECK_MS);
    } catch (e) {
      memory.nextPackagesCheck = ctx.now() + RETRY_MS;
      throw e;
    }
    return { retick: true };
  }

  GBot.actions = GBot.actions || {};
  GBot.actions.packages = packagesAction;
  GBot.packages = { readPackageItems, qualityOf, lastPage, listAll: listPackages, scrollKnown };

  if (typeof module !== 'undefined' && module.exports) module.exports = GBot.packages;
})(typeof globalThis !== 'undefined' ? globalThis : this);
