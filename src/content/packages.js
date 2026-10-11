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
  // A safety limit only: s303 had 51 pages (2026-10-07), the oldest
  // packages, about to expire, on the last ones.
  const MAX_PAGES = 100;
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

  // The number of the last page. The game's page links repeat the current
  // page before the one they go to ("...&page=1&page=51"): every page number
  // in them counts.
  function lastPage(doc) {
    let last = 1;
    for (const a of doc.querySelectorAll(SEL.packages.pages)) {
      for (const m of (a.getAttribute('href') || '').matchAll(/[?&](?:amp;)?page=(\d+)/g)) last = Math.max(last, Number(m[1]));
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

  // Pages of packages in their current order, until stop(page's items)
  // says enough.
  async function readUntil(sh, stop) {
    const items = [];
    let last = 1;
    for (let page = 1; page <= last; page++) {
      const { doc } = await GBot.forge.getDoc(sh, { mod: 'packages', f: 0, fq: -1, qry: '', page });
      if (!doc.querySelector(SEL.packages.list)) throw new ActionError('Could not read the packages');
      if (page === 1) last = lastPage(doc);
      const found = readPackageItems(doc);
      items.push(...found);
      if (!found.length || stop(found)) break;
    }
    return items;
  }

  // ---------------------------------------------------- the packages' order
  //
  // The game sorts the packages for the whole account (the game settings
  // page shows the choice): del_asc puts the soonest to expire first,
  // in_desc the newest first. A pass sorts them its own way to read only the
  // first pages, and puts the player's choice back at the end (restoreSort).
  const SORT = /selected="selected"\s+value="((?:del|in)_(?:asc|desc))"|value="((?:del|in)_(?:asc|desc))"\s+selected/;

  async function useSort(ctx, order) {
    if (ctx.playerSort === undefined) {
      const { html } = await GBot.forge.getDoc(ctx.state.sh, { mod: 'settings', submod: 'gameSettings' });
      const m = SORT.exec(html);
      ctx.playerSort = ctx.packageSort = m ? m[1] || m[2] : null;
    }
    // Without knowing the player's choice it could not be put back.
    if (!ctx.playerSort) return false;
    if (ctx.packageSort !== order) await setSort(ctx, order);
    return true;
  }

  async function setSort(ctx, order) {
    const url = new URL(`index.php?mod=packages&submod=sort&page=1&sh=${encodeURIComponent(ctx.state.sh)}`, location.href).href;
    await GBot.forge.post(url, new URLSearchParams({ packageSorting: order }).toString());
    ctx.packageSort = order;
  }

  async function restoreSort(ctx) {
    if (ctx.playerSort && ctx.packageSort !== ctx.playerSort) await setSort(ctx, ctx.playerSort);
  }

  // ------------------------------------------------- which packages to read
  //
  // Every package every 6 hours and after the rules change; in between
  // only the ones about to expire (sorted soonest first, up to the first
  // one outside the window) and the new ones (sorted newest first, up to a
  // page of packages seen before). memory.packagesKnown holds the packages
  // seen and dealt with; one left for later stays unknown, so it is read
  // again.
  const FULL_SCAN_MS = 6 * 3600 * 1000;
  const KNOWN_MAX = 3000;
  const rulesKey = (settings) => JSON.stringify([settings.packages, settings.smelting]);

  async function scanPackages(ctx) {
    const { memory, settings } = ctx;
    const sh = ctx.state.sh;
    const known = Array.isArray(memory.packagesKnown) ? new Set(memory.packagesKnown) : null;
    const due = !known || ctx.now() - (memory.packagesFullAt || 0) > FULL_SCAN_MS || memory.packagesRules !== rulesKey(settings);
    const p = settings.packages;
    const expiring = p.enabled && p.expiring !== 'off';
    if (due || !(await useSort(ctx, expiring ? 'del_asc' : 'in_desc'))) return { items: await listPackages(sh), full: true };
    const items = [];
    if (expiring) {
      const window = p.expiringHours * 3600000;
      items.push(...(await readUntil(sh, (page) => page.some((i) => i.expiresInMs !== null && i.expiresInMs > window))));
      await useSort(ctx, 'in_desc');
    }
    items.push(...(await readUntil(sh, (page) => page.every((i) => known.has(i.cn)))));
    const seen = new Set();
    return { items: items.filter((i) => !seen.has(i.cn) && seen.add(i.cn)), full: false };
  }

  function remember(ctx, scan, skipped) {
    const { memory, settings } = ctx;
    const done = scan.items.filter((i) => !skipped.has(i.cn)).map((i) => i.cn);
    if (scan.full) {
      memory.packagesKnown = done.slice(-KNOWN_MAX);
      memory.packagesRules = rulesKey(settings);
      // Left over for a reason other than expiring (a selling rule's
      // backlog, deep in the list): only reading everything finds them.
      const backlog = scan.items.some((i) => skipped.has(i.cn) && brain.packageAction({ ...i, expiresInMs: null }, settings));
      memory.packagesFullAt = backlog ? 0 : ctx.now();
    } else {
      memory.packagesKnown = Array.from(new Set([...(memory.packagesKnown || []), ...done])).slice(-KNOWN_MAX);
    }
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
    const spot = await GBot.forge.takeSpot(ctx, item.w, item.h);
    await ctx.humanDelay();
    await GBot.forge.moveItem(sh, { from: item.cn, fromX: 1, fromY: 1, to: spot.bag, toX: spot.x, toY: spot.y, amount: item.amount });
    return spot;
  }

  // A package about to expire, renewed: out into a bag, listed in the guild
  // market for 1 gold for 2 hours and the listing cancelled at once, which
  // sends the item back as a new package with a new expiry. A guildmate
  // could buy it for 1 gold in between, so a listing that cannot be
  // cancelled stops renewing for a day and tells the player.
  const RENEW_PRICE = 1;
  const RENEW_DURATION = '1'; // 2 hours
  const RENEW_BLOCK_MS = 24 * 3600 * 1000;

  // Can expiring packages be renewed in this run? A guild market with a
  // Sell form whose Offer button works (it does not while the market is
  // full), and a little gold for its fee (a share of the price, at least
  // 1). Otherwise they are moved into the bags. Said once.
  async function marketReady(ctx) {
    if (ctx.marketReady !== undefined) return ctx.marketReady;
    const form = await GBot.gold.sellForm(ctx);
    const gold = ctx.state.gold;
    const why = !form ? 'there is no guild market (are you in a guild?)' : !form.open ? 'the guild market is full' : typeof gold === 'number' && gold < 2 ? 'there is no gold for the market fee' : null;
    if (why && ctx.memory.renewNote !== why) ctx.log('info', `Packages: ${why}, so packages about to expire are moved into your bags instead of renewed`);
    ctx.memory.renewNote = why;
    ctx.marketReady = !why;
    return ctx.marketReady;
  }

  async function renew(ctx, item) {
    const entry = ctx.memory.smeltQueue.find((e) => e.cn === item.cn);
    if (entry) entry.renewingAt = ctx.now();
    const spot = await intoBag(ctx, item, true);
    const listing = await GBot.gold.listItem(ctx, spot.itemId, RENEW_PRICE, RENEW_DURATION);
    if (!listing) {
      ctx.memory.renewBlockedUntil = ctx.now() + RENEW_BLOCK_MS;
      if (entry) bagged(entry, spot.itemId);
      throw new ActionError(`Could not list ${item.name} in the guild market to renew it; it is in your bag. Renewing is paused for a day`);
    }
    if (await GBot.gold.cancelListing(ctx, listing, RENEW_PRICE)) {
      if (entry) await requeue(ctx, entry, item);
      return;
    }
    ctx.memory.renewBlockedUntil = ctx.now() + RENEW_BLOCK_MS;
    const message = `${item.name} is listed in the guild market for ${RENEW_PRICE} gold and Lanista could not cancel it. Cancel it yourself before a guildmate buys it; renewing is paused for a day.`;
    if (ctx.notify) ctx.notify('activityPaused', `Lanista: ${message}`);
    throw new ActionError(message);
  }

  // A renewed item ticked for smelting: its new package (the newest with
  // its name and kind, packages sorted newest first) takes its place in the
  // queue; not found, it is unticked.
  async function requeue(ctx, entry, item) {
    const { memory } = ctx;
    const sorted = await useSort(ctx, 'in_desc');
    const { doc } = await GBot.forge.getDoc(ctx.state.sh, { mod: 'packages', f: 0, fq: -1, qry: '', page: 1 });
    const taken = new Set(memory.smeltQueue.map((q) => q.cn));
    const fresh = sorted ? readPackageItems(doc).find((i) => i.name === item.name && i.basis === item.basis && !taken.has(i.cn)) : null;
    delete entry.renewingAt;
    if (fresh) {
      entry.cn = fresh.cn;
      if (fresh.expiresInMs > 0) entry.expires = ctx.now() + fresh.expiresInMs;
      return;
    }
    memory.smeltQueue = memory.smeltQueue.filter((q) => q !== entry);
    ctx.log('warn', `Smelting: ${item.name} was renewed, but its new package was not found; it is no longer ticked`);
  }

  // A ticked item now in a bag: the smelter takes it from there.
  function bagged(entry, itemId) {
    delete entry.renewingAt;
    delete entry.cn;
    entry.iid = String(itemId);
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

  // A free bag spot outside the food bags. Only an item used right away (a
  // scroll) may borrow room in a food bag when the others are full.
  async function spotOutsideFood(ctx, w, h, borrowFood) {
    const food = brain.foodBags(ctx.settings);
    const others = [512, 513, 514, 515, 516, 517, 518, 519].filter((b) => !food.includes(b));
    if (!others.length) return GBot.forge.takeSpot(ctx, w, h);
    try {
      return await GBot.forge.takeSpot(ctx, w, h, others);
    } catch (e) {
      if (!/^No room/.test(e.message)) throw e;
      if (!borrowFood) throw new ActionError(`No room in the bags outside your food bags for a ${w}x${h} item`);
    }
    return GBot.forge.takeSpot(ctx, w, h);
  }

  async function intoBag(ctx, item, borrowFood = false) {
    const spot = await spotOutsideFood(ctx, item.w, item.h, borrowFood);
    await ctx.humanDelay();
    const moved = await GBot.forge.moveItem(ctx.state.sh, { from: item.cn, fromX: 1, fromY: 1, to: spot.bag, toX: spot.x, toY: spot.y, amount: item.amount });
    const itemId = moved && moved.to && moved.to.data && moved.to.data.itemId;
    // The game answers a move it did not make without an error, but also
    // without the item's new id.
    if (!itemId) {
      GBot.forge.forgetBags(ctx);
      throw new ActionError(`The game did not take ${item.name} into bag ${spot.bag - 511}`);
    }
    return { ...spot, itemId };
  }

  // The chosen item types go from the packages into the bags.
  async function pickTypes(ctx, room) {
    const picks = settingsPicks(ctx.settings);
    let moved = 0;
    for (const [kind, filter] of picks) {
      const items = await listPackages(ctx.state.sh, { f: filter });
      let count = 0;
      const said = () => count && ctx.log('info', `Took ${count} ${PICK_LABELS[kind]}${count === 1 ? '' : 's'} out of the packages into your bags`);
      for (const item of items) {
        if (moved >= room) {
          said();
          return { moved, more: true };
        }
        try {
          await intoBag(ctx, item);
        } catch (e) {
          said();
          throw e;
        }
        moved += 1;
        count += 1;
        await ctx.persist();
      }
      said();
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
      const spot = await intoBag(ctx, scroll, true);
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
      const scan = await scanPackages(ctx);
      let items = scan.items;

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
      const skipped = new Set();
      let toSmelt = 0;
      let moves = 0;
      let more = false;
      let stopped = false;
      for (const item of items) {
        let action = brain.packageAction({ ...item, queued: queued.has(item.cn) }, settings);
        if (!action) continue;
        if (stopped) {
          skipped.add(item.cn);
          continue;
        }
        // Renewing failed lately, or the market cannot take it: rescue
        // into a bag instead.
        if (action === 'renew' && ((memory.renewBlockedUntil || 0) > ctx.now() || !(await marketReady(ctx)))) action = 'bag';
        if (action === 'smelt') {
          memory.smeltQueue.push(GBot.smelter.queueEntry(item.el, ctx.now()));
          queued.add(item.cn);
          toSmelt += 1;
          continue;
        }
        if (moves >= MAX_MOVES) {
          more = true;
          skipped.add(item.cn);
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
          } else if (action === 'renew') {
            await renew(ctx, item);
            memory.stats.renewed = (memory.stats.renewed || 0) + 1;
            ctx.log('info', `Renewed ${item.name}: listed for 1 gold in the guild market and cancelled, so it is a new package again`);
          } else {
            // Never into a food bag (when some bags are not food bags):
            // food and healing need the room there.
            const spot = await intoBag(ctx, item);
            const entry = memory.smeltQueue.find((e) => e.cn === item.cn);
            if (entry) bagged(entry, spot.itemId);
            ctx.log('info', `Moved ${item.name} into your bags; its package was about to expire`);
          }
        } catch (e) {
          // Full bags or merchants: try again at the next check.
          if (!/^(No (room|merchant)|The game did not take)/.test(e.message)) throw e;
          ctx.log('warn', `Packages: ${e.message}; trying again later`);
          skipped.add(item.cn);
          stopped = true;
        }
        await ctx.persist();
      }
      remember(ctx, scan, skipped);
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
          if (!/^(No room|The game did not take)/.test(e.message)) throw e;
          ctx.log('warn', `Packages: ${e.message}; taking items out later`);
        }
      }
      memory.nextPackagesCheck = ctx.now() + (more ? MORE_MS : CHECK_MS);
    } catch (e) {
      memory.nextPackagesCheck = ctx.now() + RETRY_MS;
      throw e;
    } finally {
      await restoreSort(ctx).catch((e) => ctx.log('warn', `Packages: could not put your package order back (${e.message})`));
    }
    return { retick: true };
  }

  GBot.actions = GBot.actions || {};
  GBot.actions.packages = packagesAction;
  GBot.packages = { readPackageItems, qualityOf, lastPage, listAll: listPackages, scrollKnown, intoBag };

  if (typeof module !== 'undefined' && module.exports) module.exports = GBot.packages;
})(typeof globalThis !== 'undefined' ? globalThis : this);
