// Keeps spare gold out of raiders' reach with guild market "gold packs":
// cheap items guildmates list far above their worth (3 resources for
// 300,000). Buying one moves the spare gold to that guildmate; listing the
// pack again at the same price lets the next guildmate do the same, and
// when one buys it the gold comes back in a gold package, which stays safe
// in the packages until it is taken out. Like the workbench it only sends
// the game's own requests (the market's Buy and Sell forms).
(function (root) {
  'use strict';
  const GBot = (root.GBot = root.GBot || {});
  const { parseNumber, ActionError } = GBot.util;
  const { SEL } = GBot.selectors;
  const brain = GBot.brain;

  const CHECK_MS = 15 * 60 * 1000;
  const AGAIN_MS = 60 * 1000;
  // Listings run 24 hours; one not seen after that came back or sold.
  const LISTING_MS = 24 * 3600 * 1000;
  const DURATION_24H = '3';
  const MAX_PAGES = 5;

  const fmt = (n) => Number(n).toLocaleString('en-US');

  // The listings on a guild market (or public market) page: [{ buyid,
  // seller, price, value, amount, basis, type, level, canBuy, buyLabel,
  // el }]. The listing id is its item's id.
  function readMarket(doc) {
    const table = doc.querySelector(SEL.market.table);
    if (!table) return null;
    return Array.from(table.rows)
      .map((row) => {
        const item = row.querySelector('[data-content-type]');
        if (!item) return null;
        const buy = row.querySelector(SEL.market.buy);
        return {
          buyid: item.getAttribute('data-item-id'),
          seller: (row.cells[SEL.market.sellerCell] || {}).textContent.trim(),
          price: parseNumber((row.cells[SEL.market.priceCell] || {}).textContent),
          value: Number(item.getAttribute('data-price-gold')) || 0,
          amount: Number(item.getAttribute('data-amount')) || 1,
          basis: item.getAttribute('data-basis'),
          type: Number(item.getAttribute('data-content-type')) || 0,
          level: Number(item.getAttribute('data-level')) || 0,
          canBuy: !!buy,
          buyLabel: buy ? buy.value : null,
          el: item,
        };
      })
      .filter(Boolean);
  }

  async function marketPages(sh) {
    const offers = [];
    let doc = null;
    for (let p = 1; p <= MAX_PAGES; p++) {
      ({ doc } = await GBot.forge.getDoc(sh, { mod: 'guildMarket', s: 'p', p }));
      const page = readMarket(doc);
      if (!page) throw new ActionError('Could not read the guild market (are you in a guild?)');
      offers.push(...page);
      const more = Array.from(doc.querySelectorAll('#content a')).some((a) => new RegExp(`[?&]p=${p + 1}(&|$)`).test(a.getAttribute('href') || ''));
      if (!more) break;
    }
    return { offers, doc };
  }

  async function playerName(ctx) {
    const info = ctx.memory.gameInfo;
    if (info.playerName) return info.playerName;
    const { doc } = await GBot.forge.getDoc(ctx.state.sh, { mod: 'overview' });
    const el = doc.querySelector(SEL.playerName);
    info.playerName = el ? el.textContent.trim() : null;
    return info.playerName;
  }

  const goldOf = (html) => parseNumber((new DOMParser().parseFromString(html, 'text/html').querySelector(SEL.gold) || {}).textContent);

  const marketUrl = (sh, mod = 'guildMarket') => new URL(`index.php?mod=${mod}&sh=${encodeURIComponent(sh)}`, location.href).href;

  // Buys a listing (a pack, or food on the public market with mod
  // 'market'): 'bought', 'refused', or 'unknown' when the gold could not be
  // read afterwards (then a pack counts as bought, so it gets listed and is
  // not stored in the Horreum with the other resources).
  async function buy(ctx, pack, goldBefore, mod = 'guildMarket') {
    const body = new URLSearchParams({ buyid: pack.buyid, qry: '', seller: '', buy: pack.buyLabel || 'Buy' }).toString();
    await ctx.humanDelay();
    const html = await GBot.forge.post(marketUrl(ctx.state.sh, mod), body);
    let after = goldOf(html);
    if (after === null) after = await goldNow(ctx.state.sh);
    if (after === null) return 'unknown';
    return goldBefore - after >= pack.price ? 'bought' : 'refused';
  }

  async function goldNow(sh) {
    const { doc } = await GBot.forge.getDoc(sh, { mod: 'overview' });
    return parseNumber((doc.querySelector(SEL.gold) || {}).textContent);
  }

  // Where a pack is now: in the packages, or already in a bag.
  async function findPack(sh, pack) {
    const items = await GBot.packages.listAll(sh);
    const matches = (i) => i.type === pack.type && i.amount === pack.amount && i.basis === pack.basis;
    const inPackages = items.find(matches);
    if (inPackages) return { packaged: inPackages };
    const { html } = await GBot.forge.getDoc(sh, { mod: 'overview' });
    const inBag = GBot.forge
      .readBagItems(html)
      .find((el) => Number(el.dataset.contentType) === pack.type && Number(el.dataset.amount || 1) === pack.amount && el.dataset.basis === pack.basis);
    return inBag ? { bagged: inBag } : null;
  }

  // Lists a pack at its price for 24 hours (the market's Sell form, with the
  // pack taken from the packages into a bag first).
  async function list(ctx, pack) {
    const sh = ctx.state.sh;
    const where = await findPack(sh, pack);
    if (!where) return false;
    let itemId;
    if (where.packaged) {
      const item = where.packaged;
      const spot = await GBot.forge.freeBagSpot(sh, item.w, item.h);
      await ctx.humanDelay();
      const moved = await GBot.forge.moveItem(sh, { from: item.cn, fromX: 1, fromY: 1, to: spot.bag, toX: spot.x, toY: spot.y, amount: item.amount });
      itemId = moved && moved.to && moved.to.data && moved.to.data.itemId;
    } else {
      itemId = where.bagged.dataset.itemId;
    }
    if (!itemId) throw new ActionError('Could not tell the pack’s item id after moving it into a bag');
    const { doc } = await GBot.forge.getDoc(sh, { mod: 'guildMarket' });
    const form = doc.querySelector(SEL.market.sellForm);
    if (!form) throw new ActionError('The guild market has no Sell form');
    const submit = form.querySelector(SEL.market.sellButton);
    const body = new URLSearchParams({ sellid: String(itemId), preis: String(pack.price), dauer: DURATION_24H });
    if (submit && submit.name) body.set(submit.name, submit.value || '');
    await ctx.humanDelay();
    const html = await GBot.forge.post(marketUrl(sh), body.toString());
    const listed = readMarket(new DOMParser().parseFromString(html, 'text/html')) || [];
    const me = await playerName(ctx);
    if (!listed.some((o) => o.price === pack.price && (!me || o.seller.toLowerCase() === me.toLowerCase()))) {
      throw new ActionError(`Listing the pack for ${fmt(pack.price)} gold did not show up in the guild market`);
    }
    return true;
  }

  // Packs bought (or listed more than a day ago) go up for sale again; a
  // listed one nowhere to be found was bought, and its gold is on its way.
  async function relist(ctx) {
    const { memory } = ctx;
    const now = ctx.now();
    const packs = memory.goldPacks.slice();
    const kept = [];
    for (let i = 0; i < packs.length; i++) {
      const pack = packs[i];
      const due = pack.state === 'bought' || now - pack.at > LISTING_MS;
      let next = pack;
      if (due) {
        if (await list(ctx, pack)) {
          ctx.log('info', `Gold: listed a pack for ${fmt(pack.price)} gold in the guild market (24 h)`);
          next = { ...pack, state: 'listed', at: now };
        } else if (pack.state === 'bought' && now - pack.at < LISTING_MS) {
          ctx.log('warn', `Gold: the pack bought for ${fmt(pack.price)} gold is neither in the packages nor in the bags; looking again later`);
        } else if (pack.state === 'bought') {
          ctx.log('warn', `Gold: giving up on the pack bought for ${fmt(pack.price)} gold a day ago; it never turned up`);
          next = null;
        } else {
          ctx.log('info', `Gold: a guildmate bought the pack listed for ${fmt(pack.price)} gold; the gold comes back as a gold package`);
          next = null;
        }
      }
      if (next) kept.push(next);
      memory.goldPacks = kept.concat(packs.slice(i + 1));
      if (due) await ctx.persist();
    }
  }

  async function goldAction(ctx) {
    const { settings, memory } = ctx;
    const cfg = settings.gold;
    const sh = ctx.state.sh;
    try {
      await relist(ctx);
      const gold = await goldNow(sh);
      const spare = gold === null ? 0 : gold - cfg.keep;
      let bought = false;
      if (cfg.hide && spare >= cfg.minPack) {
        const me = await playerName(ctx);
        const { offers } = await marketPages(sh);
        const pack = brain.pickGoldPack(offers, { spare, minPack: cfg.minPack, me });
        if (pack) {
          const outcome = await buy(ctx, pack, gold);
          if (outcome === 'refused') throw new ActionError(`Buying ${pack.seller}'s pack for ${fmt(pack.price)} gold did not go through (someone may have bought it first)`);
          if (outcome === 'unknown') ctx.log('warn', 'Gold: could not read the gold after buying; treating the pack as bought');
          bought = true;
          memory.goldPacks.push({ type: pack.type, amount: pack.amount, basis: pack.basis, price: pack.price, state: 'bought', at: ctx.now() });
          memory.stats.goldHidden = (memory.stats.goldHidden || 0) + pack.price;
          ctx.log('info', `Gold: hid ${fmt(pack.price)} gold in ${pack.seller}'s pack in the guild market`);
          await ctx.persist();
          await relist(ctx);
        } else {
          ctx.log('info', `Gold: ${fmt(spare)} gold above what you keep, but no gold pack in the guild market fits`);
        }
      }
      memory.nextGoldCheck = ctx.now() + (bought ? AGAIN_MS : CHECK_MS);
    } catch (e) {
      memory.nextGoldCheck = ctx.now() + CHECK_MS;
      throw e;
    }
    return { retick: true };
  }

  GBot.actions = GBot.actions || {};
  GBot.actions.gold = goldAction;
  GBot.gold = { readMarket, findPack, buy, playerName };

  if (typeof module !== 'undefined' && module.exports) module.exports = GBot.gold;
})(typeof globalThis !== 'undefined' ? globalThis : this);
