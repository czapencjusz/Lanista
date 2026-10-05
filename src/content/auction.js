// Bids on healing items in the auction house, takes food from the
// packages when the bags run out (auction wins arrive as packages), and
// buys food from the merchants when both are empty.
//
// The game warns: "If someone overbids you you do NOT get your gold back."
// So the bot bids late in the round (when few players can still outbid
// it), only at a price the user accepts per HP, at most once per lot, never
// below a gold reserve and never above a budget per round. Buyout costs
// rubies and is never used. Like the workbench it only sends requests.
(function (root) {
  'use strict';
  const GBot = (root.GBot = root.GBot || {});
  const { parseNumber, ActionError } = GBot.util;
  const { SEL } = GBot.selectors;
  const brain = GBot.brain;

  const FOOD_TYPE = 64; // data-content-type of food and healing potions
  const QUALITY_NAMES = ['Standard', 'Ceres', 'Neptun', 'Mars', 'Jupiter', 'Olymp'];
  const USABLES = 7; // "Usables" in the auction and packages filters
  const RETRY_MS = 10 * 60 * 1000;

  const healOf = (el) => GBot.actions._internal.foodHealAmount(el);
  const edible = (el, settings) => GBot.actions._internal.edible(el, settings);

  // Auction round state from its localised label ("Remaining time of
  // auction: Long"): 1 = very short ... 5 = very long, null when unknown.
  const TIME_RANKS = { 'very short': 1, short: 2, medium: 3, long: 4, 'very long': 5 };
  const timeRank = (label) => TIME_RANKS[String(label || '').trim().toLowerCase()] || null;

  // Lots on an auction page: [{ id, name, heal, minBid, form }]. Only the
  // game's own markup is read (add-ons add their own price hints).
  function readAuction(doc) {
    const time = doc.querySelector(SEL.auction.time);
    const lots = Array.from(doc.querySelectorAll('form'))
      .filter((f) => f.querySelector(SEL.auction.lotId))
      .map((form) => {
        const item = form.querySelector(SEL.auction.item);
        const bid = form.querySelector(SEL.auction.bidAmount);
        const lines = item ? GBot.forge.tooltipLines(item) : [];
        return {
          id: form.querySelector(SEL.auction.lotId).value,
          name: lines[0] || '',
          type: item ? Number(item.dataset.contentType) : null,
          quality: item && GBot.packages ? GBot.packages.qualityOf(item) : null,
          heal: item && Number(item.dataset.contentType) === FOOD_TYPE ? healOf(item) : 0,
          plain: item ? GBot.actions._internal.isPlainFood(item) : false,
          minBid: bid ? parseNumber(bid.value) : null,
          form,
        };
      });
    return { label: time ? time.textContent.trim() : '', rank: timeRank(time && time.textContent), lots };
  }

  // Everything the game's bid form sends, as it would on a click on "Bid".
  function bidBody(form, amount) {
    const body = new URLSearchParams();
    for (const el of form.querySelectorAll('input')) {
      if (!el.name || el.type === 'submit') continue;
      body.set(el.name, el.name === 'bid_amount' ? String(amount) : el.value);
    }
    const bid = form.querySelector(SEL.auction.bidButton);
    body.set(bid ? bid.name : 'bid', bid ? bid.value : 'Bid');
    return body.toString();
  }

  // Food the bot may eat: in the food bags (Settings > Health) and in the
  // packages. Eggs and other usables the user keeps do not count.
  async function countFood(sh, settings) {
    const { html } = await GBot.forge.getDoc(sh, { mod: 'overview' });
    const inBags = GBot.forge.readBagItems(html, brain.foodBags(settings)).filter((el) => edible(el, settings));
    const { doc } = await GBot.forge.getDoc(sh, { mod: 'packages', f: USABLES, fq: -1, qry: '' });
    const packaged = Array.from(doc.querySelectorAll('.packageItem [data-content-type]')).filter((el) => edible(el, settings));
    return inBags.length + packaged.length;
  }

  async function auction(ctx) {
    const { settings, memory } = ctx;
    const cfg = settings.auction;
    const sh = ctx.state.sh;
    const now = ctx.now();
    try {
      const page = await GBot.forge.getDoc(sh, { mod: 'auction', itemType: USABLES, itemQuality: -1, qry: '' });
      const { rank, label, lots } = readAuction(page.doc);

      // A new round starts when the remaining time goes up again.
      const round = memory.auctionRound || { rank: null, spent: 0, bids: {} };
      if (rank !== null && round.rank !== null && rank > round.rank) Object.assign(round, { spent: 0, bids: {} });
      round.rank = rank;
      memory.auctionRound = round;
      memory.nextAuctionCheck = now + brain.auctionRecheckMs(rank);

      // Say why no bids go in, once each time the reason changes.
      const note = (key, message) => {
        if (memory.auctionNote !== key) ctx.log('info', message);
        memory.auctionNote = key;
      };
      if (!brain.auctionTimeOk(rank, cfg.bidWhen)) {
        note(`time:${rank}`, `Auction: the round time is "${label || '?'}", waiting to bid until it is later`);
        return { retick: true };
      }

      let gold = ctx.state.gold;
      // Bids as the game's form sends them; the answer is the auction page
      // again, and the bid went through if the gold in its header dropped.
      const place = async (plan, describe) => {
        for (const lot of plan) {
          await ctx.humanDelay();
          const action = new URL(lot.form.getAttribute('action'), location.href).href;
          const html = await GBot.forge.post(action, bidBody(lot.form, lot.minBid));
          const after = parseNumber((new DOMParser().parseFromString(html, 'text/html').querySelector(SEL.gold) || {}).textContent);
          round.bids[lot.id] = lot.minBid;
          if (after === null || gold - after < lot.minBid) {
            ctx.log('warn', `Auction: the bid on ${lot.name} (${lot.minBid.toLocaleString('en-US')} gold) was not taken; someone may have bid first`);
            continue;
          }
          gold = after;
          round.spent += lot.minBid;
          memory.stats.auctionBids = (memory.stats.auctionBids || 0) + 1;
          memory.stats.goldSpent = (memory.stats.goldSpent || 0) + lot.minBid;
          ctx.log('info', `Auction (${label}): bid ${lot.minBid.toLocaleString('en-US')} gold on ${lot.name} (${describe(lot)})`);
          await ctx.persist();
        }
      };

      let bid = false;
      if (cfg.food) {
        const owned = await countFood(sh, ctx.settings);
        // Food the bot would not eat (eggs and the like) is not bid on either.
        const wanted = ctx.settings.heal.plainOnly ? lots.filter((l) => l.plain) : lots;
        const plan = owned >= cfg.maxFood ? [] : brain.planAuctionBids(wanted, cfg, { gold, spent: round.spent, bids: round.bids, owned });
        if (owned >= cfg.maxFood) note('food', `Auction: you own ${owned} healing items (limit ${cfg.maxFood}), not bidding on food`);
        else if (!plan.length) note('none', `Auction: no new lot heals at least ${cfg.minHpPerGold} HP per gold within your gold limits`);
        await place(plan, (l) => `+${l.heal.toLocaleString('en-US')} HP, ${(l.heal / l.minBid).toFixed(1)} HP/gold`);
        bid = bid || plan.length > 0;
      }
      if (cfg.gear) {
        const gearPage = await GBot.forge.getDoc(sh, { mod: 'auction', itemType: 0, itemQuality: cfg.gearMinQuality, qry: '' });
        const plan = brain.planGearBids(readAuction(gearPage.doc).lots, cfg, { gold, spent: round.spent, bids: round.bids });
        await place(plan, (l) => `${QUALITY_NAMES[l.quality + 1] || 'gear'}, ${brain.gearKind(l.type)}`);
        bid = bid || plan.length > 0;
      }
      if (bid) memory.auctionNote = null;
    } catch (e) {
      memory.nextAuctionCheck = now + RETRY_MS;
      throw e;
    }
    return { retick: true };
  }

  // When the food bags hold no food: move the best-fitting food the bot may
  // eat from the packages into a free spot in a food bag. Returns its name,
  // or null if none.
  async function takeFoodFromPackages(ctx, missingHp) {
    const sh = ctx.state.sh;
    const { doc } = await GBot.forge.getDoc(sh, { mod: 'packages', f: USABLES, fq: -1, qry: '' });
    const foods = Array.from(doc.querySelectorAll('.packageItem [data-content-type]'))
      .filter((el) => edible(el, ctx.settings))
      .map((el) => ({ el, heal: healOf(el) }));
    const food = brain.pickFood(foods, missingHp);
    if (!food) return null;
    const el = food.el;
    const size = [Number(el.dataset.measurementX) || 1, Number(el.dataset.measurementY) || 1];
    const spot = await GBot.forge.freeBagSpot(sh, ...size, brain.foodBags(ctx.settings));
    const from = parseNumber(el.parentElement.getAttribute('data-container-number'));
    await GBot.forge.moveItem(sh, { from, fromX: 1, fromY: 1, to: spot.bag, toX: spot.x, toY: spot.y, amount: 1 });
    return GBot.forge.tooltipLines(el)[0] || 'food';
  }

  // The merchants' shop tabs (sub = merchant, subsub = tab). General goods
  // (3) sells food on the servers seen so far, so it is looked at first,
  // after the tab that had food last time.
  const SHOP_TABS = [3, 1, 2, 4, 5, 6].flatMap((sub) => [0, 1, 2].map((subsub) => ({ sub, subsub })));

  // Food on a merchant's shop page the bot may eat and buy: plain food (as
  // set) for gold, never anything with a ruby price, at most the
  // character's level.
  function readShopFood(doc, settings, level) {
    const shop = doc.querySelector(SEL.shop);
    if (!shop) return [];
    const cn = parseNumber(shop.getAttribute('data-container-number'));
    return Array.from(shop.querySelectorAll(`[data-content-type="${FOOD_TYPE}"]`))
      .filter((el) => edible(el, settings))
      .filter((el) => !Array.from(el.attributes).some((a) => /rub(y|ies)/i.test(a.name)) && !/rub(y|ies)/i.test(el.getAttribute('data-tooltip') || ''))
      .filter((el) => !level || !Number(el.dataset.level) || Number(el.dataset.level) <= level)
      .map((el) => ({
        name: GBot.forge.tooltipLines(el)[0] || 'food',
        heal: healOf(el),
        price: Number(el.dataset.priceGold) || 0,
        cn,
        x: Number(el.dataset.positionX),
        y: Number(el.dataset.positionY),
        w: Number(el.dataset.measurementX) || 1,
        h: Number(el.dataset.measurementY) || 1,
      }))
      .filter((o) => o.price > 0 && o.heal > 0 && o.x && o.y);
  }

  // Buys food from a merchant into a food bag: what a player does by
  // dragging it out of the shop (the same "move" request). Returns
  // { bought: [names], gold } or { bought: [], reason }.
  async function buyFood(ctx) {
    const { settings, memory, state } = ctx;
    const sh = state.sh;
    const { today, budget, byDay } = brain.foodBudget(settings, memory, state.gold, ctx.now());
    if (budget <= 0) return { bought: [], reason: byDay ? 'the daily food budget is spent' : 'gold is at the reserve you set' };

    const last = memory.foodShop;
    const tabs = last ? [last, ...SHOP_TABS.filter((t) => t.sub !== last.sub || t.subsub !== last.subsub)] : SHOP_TABS;
    for (const tab of tabs) {
      const { doc } = await GBot.forge.getDoc(sh, { mod: 'inventory', ...tab });
      const offers = readShopFood(doc, settings, state.level);
      if (!offers.length) continue;
      const plan = brain.planFoodPurchase(offers, settings.heal.buyAtOnce, budget);
      if (!plan.length) return { bought: [], reason: `the merchant's food costs more than the ${fmt(budget)} gold left to spend` };
      memory.foodShop = tab;
      const bought = [];
      let gold = 0;
      for (const item of plan) {
        const spot = await GBot.forge.freeBagSpot(sh, item.w, item.h, brain.foodBags(settings));
        await ctx.humanDelay();
        await GBot.forge.moveItem(sh, { from: item.cn, fromX: item.x, fromY: item.y, to: spot.bag, toX: spot.x, toY: spot.y, amount: 1 });
        bought.push(`${item.name} (${fmt(item.heal)} HP, ${fmt(item.price)} gold)`);
        gold += item.price;
        today.gold += item.price;
        today.items += 1;
        memory.foodBought = today;
        memory.stats.foodBought = (memory.stats.foodBought || 0) + 1;
        memory.stats.goldSpent = (memory.stats.goldSpent || 0) + item.price;
        await ctx.persist();
      }
      return { bought, gold };
    }
    return { bought: [], reason: 'no merchant has food right now' };
  }

  // Food other players sell on the public market, for food the bags and
  // packages no longer have: plain food (as set) at most the character's
  // level, healing at least heal.marketMinHpPerGold HP per gold, within the
  // same daily food budget as the merchants. It arrives as a package.
  // Returns { bought: [names], gold } or { bought: [], reason }.
  const MARKET_PAGES = 5;

  async function buyMarketFood(ctx) {
    const { settings, memory, state } = ctx;
    const sh = state.sh;
    const { today, budget, byDay } = brain.foodBudget(settings, memory, state.gold, ctx.now());
    if (budget <= 0) return { bought: [], reason: byDay ? 'the daily food budget is spent' : 'gold is at the reserve you set' };
    const me = String((await GBot.gold.playerName(ctx)) || '').toLowerCase();
    const listings = [];
    for (let p = 1; p <= MARKET_PAGES; p++) {
      const { doc } = await GBot.forge.getDoc(sh, { mod: 'market', f: USABLES, fl: 0, fq: -1, qry: '', seller: '', s: 'p', p });
      const page = GBot.gold.readMarket(doc);
      // No table: nothing listed (in this category).
      if (!page) break;
      listings.push(...page);
      const more = Array.from(doc.querySelectorAll('#content a')).some((a) => new RegExp(`[?&]p=${p + 1}(&|$)`).test(a.getAttribute('href') || ''));
      if (!more) break;
    }
    const min = settings.heal.marketMinHpPerGold;
    const food = listings
      .filter((o) => o.type === FOOD_TYPE && o.canBuy && o.price > 0 && o.seller.toLowerCase() !== me && edible(o.el, settings))
      .filter((o) => !state.level || !o.level || o.level <= state.level)
      .map((o) => ({ ...o, name: GBot.forge.tooltipLines(o.el)[0] || 'food', heal: healOf(o.el) }))
      .filter((o) => o.heal > 0 && o.heal / o.price >= min);
    if (!food.length) return { bought: [], reason: `nothing on the market heals ${min} HP per gold or more` };
    const plan = brain.planFoodPurchase(food, settings.heal.buyAtOnce, budget);
    if (!plan.length) return { bought: [], reason: `the market's food costs more than the ${fmt(budget)} gold left to spend` };
    const bought = [];
    let gold = 0;
    let goldNow = state.gold;
    for (const item of plan) {
      const outcome = await GBot.gold.buy(ctx, item, goldNow, 'market');
      if (outcome === 'refused') {
        ctx.log('warn', `Market: ${item.seller}'s ${item.name} for ${fmt(item.price)} gold was not sold to you (gone already?)`);
        continue;
      }
      goldNow -= item.price;
      bought.push(`${item.name} (${fmt(item.heal)} HP, ${fmt(item.price)} gold, from ${item.seller})`);
      gold += item.price;
      today.gold += item.price;
      today.items += 1;
      memory.foodBought = today;
      memory.stats.foodBought = (memory.stats.foodBought || 0) + 1;
      memory.stats.goldSpent = (memory.stats.goldSpent || 0) + item.price;
      await ctx.persist();
    }
    return bought.length ? { bought, gold } : { bought, reason: 'the market did not sell the food picked' };
  }

  const fmt = (n) => Number(n).toLocaleString('en-US');

  GBot.actions = GBot.actions || {};
  GBot.actions.auction = auction;
  GBot.auction = { readAuction, timeRank, bidBody, takeFoodFromPackages, countFood, readShopFood, buyFood, buyMarketFood, FOOD_TYPE };

  if (typeof module !== 'undefined' && module.exports) module.exports = GBot.auction;
})(typeof globalThis !== 'undefined' ? globalThis : this);
