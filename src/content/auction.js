// Bids on healing items in the auction house, and takes food from the
// packages when the bags run out (auction wins arrive as packages).
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
      const owned = await countFood(sh, ctx.settings);
      if (owned >= cfg.maxFood) {
        note('food', `Auction: you own ${owned} healing items (limit ${cfg.maxFood}), not bidding`);
        return { retick: true };
      }

      let gold = ctx.state.gold;
      // Food the bot would not eat (eggs and the like) is not bid on either.
      const wanted = ctx.settings.heal.plainOnly ? lots.filter((l) => l.plain) : lots;
      const plan = brain.planAuctionBids(wanted, cfg, { gold, spent: round.spent, bids: round.bids, owned });
      if (!plan.length) {
        note('none', `Auction: no new lot heals at least ${cfg.minHpPerGold} HP per gold within your gold limits`);
        return { retick: true };
      }
      memory.auctionNote = null;
      for (const lot of plan) {
        await ctx.humanDelay();
        const action = new URL(lot.form.getAttribute('action'), location.href).href;
        const html = await GBot.forge.post(action, bidBody(lot.form, lot.minBid));
        // The answer is the auction page again: the bid went through if the
        // gold in the header dropped by the bid.
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
        const ratio = (lot.heal / lot.minBid).toFixed(1);
        ctx.log('info', `Auction (${label}): bid ${lot.minBid.toLocaleString('en-US')} gold on ${lot.name} (+${lot.heal.toLocaleString('en-US')} HP, ${ratio} HP/gold)`);
        await ctx.persist();
      }
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

  GBot.actions = GBot.actions || {};
  GBot.actions.auction = auction;
  GBot.auction = { readAuction, timeRank, bidBody, takeFoodFromPackages, countFood, FOOD_TYPE };

  if (typeof module !== 'undefined' && module.exports) module.exports = GBot.auction;
})(typeof globalThis !== 'undefined' ? globalThis : this);
