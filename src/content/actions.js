// Executes the decisions made by brain.js on the live game page.
//
// Every action receives a context object (built in main.js) and either:
//   - starts a page navigation and returns { navigated: true },
//   - returns { refresh: true } to have the runner reload the game state,
//   - returns { retick: true } to re-run the decision on the current page,
//   - or throws ActionError when the page does not look as expected.
(function (root) {
  'use strict';
  const GBot = (root.GBot = root.GBot || {});
  const { SEL, PAGES } = GBot.selectors;
  const { sleep, waitFor, isVisible, parseNumber, parseDuration, ActionError } = GBot.util;
  const brain = GBot.brain;

  const $ = (sel, scope = document) => scope.querySelector(sel);
  const $$ = (sel, scope = document) => Array.from(scope.querySelectorAll(sel));

  async function click(ctx, el, what) {
    await ctx.humanDelay();
    ctx.log('debug', `Click: ${what}`);
    el.click();
  }

  // Waits for the page to start unloading after a click that should load a
  // new page (attack -> combat report, form submit, ...).
  async function expectNavigation(ctx, timeoutMs = 12000) {
    return !!(await waitFor(() => ctx.isUnloading(), timeoutMs, 100));
  }

  const numericLocation = (value) => {
    const n = parseInt(value, 10);
    return Number.isNaN(n) ? null : n;
  };

  function lastLocationLink() {
    const links = $$(SEL.locationMenuLinks);
    return links.length ? links[links.length - 1].href : null;
  }

  // ---------------------------------------------------------------- dialogs

  async function dialog(ctx, decision) {
    const selector = decision.dialog === 'loginBonus' ? SEL.dialogs.loginBonusButton : SEL.dialogs.notificationButton;
    const button = $$(selector).find(isVisible);
    if (!button) throw new ActionError(`No button found in the ${decision.dialog} dialog`);
    await click(ctx, button, decision.dialog === 'loginBonus' ? 'collect login bonus' : 'close notification');
    if (await expectNavigation(ctx, 5000)) return { navigated: true };
    return { refresh: true };
  }

  // ------------------------------------------------------------- expedition

  async function expedition(ctx) {
    const { state, settings } = ctx;
    const wanted = numericLocation(settings.expedition.location);
    const onPage = state.page.mod === 'location' && (wanted === null || numericLocation(state.page.loc) === wanted);
    if (!onPage) {
      const target = wanted !== null ? ctx.url(PAGES.location(wanted)) : state.expedition.link || lastLocationLink();
      if (!target) throw new ActionError('Cannot find the expedition location link');
      return ctx.navigate(target, 'expedition location');
    }

    const buttons = $$(SEL.expedition.attackButtons);
    if (!buttons.length) throw new ActionError('No expedition attack buttons on this page');
    const index = Math.min(Math.max(settings.expedition.enemy - 1, 0), buttons.length - 1);
    const button = buttons[index];
    if (button.disabled || button.classList.contains(SEL.expedition.disabledClass)) {
      throw new ActionError(`Expedition enemy #${index + 1} cannot be attacked right now`);
    }
    await click(ctx, button, `attack expedition enemy #${index + 1}`);
    if (await expectNavigation(ctx)) return { navigated: true };
    throw new ActionError('Expedition attack did not open a combat report');
  }

  // ---------------------------------------------------------------- dungeon

  function dungeonEnemies() {
    for (const sel of SEL.dungeon.enemies) {
      const found = $$(sel);
      if (found.length) return found;
    }
    return [];
  }

  async function dungeon(ctx) {
    const { state, settings } = ctx;
    const wanted = numericLocation(settings.dungeon.location);
    const onPage = state.page.mod === 'dungeon' && (wanted === null || numericLocation(state.page.loc) === wanted);
    if (!onPage) {
      let target = wanted !== null ? ctx.url(PAGES.dungeon(wanted)) : state.dungeon.link;
      if (!target) {
        const loc = numericLocation(state.expedition.link && new URL(state.expedition.link).searchParams.get('loc'));
        if (loc !== null) target = ctx.url(PAGES.dungeon(loc));
      }
      if (!target) throw new ActionError('Cannot find the dungeon link');
      return ctx.navigate(target, 'dungeon');
    }

    const enemies = dungeonEnemies();
    if (enemies.length) {
      await click(ctx, enemies[0], 'attack dungeon enemy');
      if (await expectNavigation(ctx)) return { navigated: true };
      throw new ActionError('Dungeon attack did not open a combat report');
    }

    // No dungeon in progress: start one.
    const advanced = settings.dungeon.difficulty === 'advanced';
    let start = $(advanced ? SEL.dungeon.startAdvanced : SEL.dungeon.startNormal);
    if (!start) start = $$(SEL.dungeon.startFallback)[advanced ? 1 : 0];
    if (!start) throw new ActionError('No dungeon enemies and no start button found');
    await click(ctx, start, `start ${advanced ? 'advanced' : 'normal'} dungeon`);
    if (await expectNavigation(ctx)) return { navigated: true };
    throw new ActionError('Starting the dungeon did not reload the page');
  }

  // --------------------------------------------------------- arena / circus

  function readOpponents(type) {
    const table = $(SEL.arena.tables[type]);
    if (!table) return null;
    return $$('tr', table)
      .map((row) => ({ row, attack: row.querySelector(SEL.arena.attack) }))
      .filter((o) => o.attack)
      .map((o, index) => {
        const cell = o.row.cells[SEL.arena.levelCellIndex];
        return { ...o, index, level: cell ? parseNumber(cell.textContent) : null };
      });
  }

  function visibleConfirmDialog() {
    return $$(SEL.dialogs.confirm).find(isVisible) || null;
  }

  async function arenaLike(ctx, type) {
    const { state, settings } = ctx;
    const page = type === 'arena' ? PAGES.arena() : PAGES.circus();
    const onPage = state.page.mod === 'arena' && state.page.submod === 'serverArena' && state.page.aType === String(page.aType);
    if (!onPage) return ctx.navigate(ctx.url(page), type === 'arena' ? 'arena provinciarum' : 'circus provinciarum');

    const opponents = readOpponents(type);
    if (!opponents) throw new ActionError(`The ${type} opponent list was not found`);
    if (!opponents.length) throw new ActionError(`No ${type} opponents can be attacked`);

    const order = brain.pickOpponents(opponents, settings[type].target);
    for (const opponent of order.slice(0, 3)) {
      await click(ctx, opponent.attack, `attack ${type} opponent (level ${opponent.level ?? '?'})`);
      const outcome = await waitFor(() => {
        if (ctx.isUnloading()) return 'navigated';
        if (visibleConfirmDialog()) return 'confirm';
        const error = $(SEL.arena.error);
        if (error && isVisible(error)) return 'error';
        return null;
      }, 10000, 150);

      if (outcome === 'navigated') return { navigated: true };
      if (outcome === 'confirm') {
        const buttons = $$(SEL.dialogs.confirmButton, visibleConfirmDialog()).filter(isVisible);
        if (buttons.length) {
          await click(ctx, buttons[0], 'confirm attack');
          if (await expectNavigation(ctx)) return { navigated: true };
        }
      }
      if (outcome === 'error') {
        const msg = ($(SEL.arena.errorText) || $(SEL.arena.error)).textContent.trim();
        ctx.log('warn', `${type}: ${msg || 'attack refused'}; trying another opponent`);
        $(SEL.arena.error).style.display = 'none';
      }
    }
    throw new ActionError(`None of the ${type} attacks went through`);
  }

  const arena = (ctx) => arenaLike(ctx, 'arena');
  const circus = (ctx) => arenaLike(ctx, 'circus');

  // ------------------------------------------------------------------- heal

  // Heal amount from the item tooltip. The tooltip is a JSON array of lines;
  // the heal value sits on the line before the first "+N" bonus line.
  function foodHealAmount(el) {
    try {
      const lines = JSON.parse(el.getAttribute('data-tooltip'))[0].map((l) => String(Array.isArray(l) ? l[0] : l));
      for (let i = 1; i + 1 < lines.length; i++) {
        if (/\+\d+/.test(lines[i + 1])) {
          const m = lines[i].match(/(\d[\d.]*)/);
          if (m) return parseNumber(m[1]);
        }
      }
    } catch (e) {
      // Unknown tooltip format; treat the heal amount as unknown.
    }
    return 0;
  }

  function center(el) {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }

  function fireMouse(target, type, point, pressed) {
    target.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: point.x,
        clientY: point.y,
        screenX: point.x,
        screenY: point.y,
        button: 0,
        buttons: pressed ? 1 : 0,
      })
    );
  }

  // Drags an inventory item onto a drop target the way a user would: the game
  // uses jQuery UI drag & drop, which listens to plain mouse events.
  async function dragAndDrop(item, target) {
    const from = center(item);
    const to = center(target);
    const at = (p) => document.elementFromPoint(p.x, p.y) || document;
    fireMouse(item, 'mouseover', from, false);
    fireMouse(item, 'mousedown', from, true);
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const p = { x: Math.round(from.x + ((to.x - from.x) * i) / steps), y: Math.round(from.y + ((to.y - from.y) * i) / steps) };
      fireMouse(at(p), 'mousemove', p, true);
      await sleep(20 + Math.random() * 30);
    }
    fireMouse(at(to), 'mouseup', to, false);
  }

  // Fallback used when the drag had no visible effect: the request the game
  // itself sends when an item is dropped on the character (target 8).
  async function consumeViaRequest(ctx, item) {
    const bagTab = $(SEL.inventory.currentBagTab);
    const bag = bagTab && parseNumber(bagTab.getAttribute('data-bag-number'));
    const x = item.getAttribute('data-position-x');
    const y = item.getAttribute('data-position-y');
    if (!bag || !x || !y || !ctx.state.sh) return false;
    const url = new URL('ajax.php', location.href);
    const params = { mod: 'inventory', submod: 'move', from: bag, fromX: x, fromY: y, to: 8, toX: 1, toY: 1, amount: 1 };
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    // Firefox: content.fetch sends the request as the page would.
    const pageFetch = typeof content !== 'undefined' && content && content.fetch ? content.fetch.bind(content) : fetch;
    const response = await pageFetch(url.href, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
      body: `a=${Date.now()}&sh=${encodeURIComponent(ctx.state.sh)}`,
    });
    return response.ok;
  }

  const inventoryReady = () => {
    const grid = $(SEL.inventory.grid);
    return grid && !grid.classList.contains(SEL.inventory.loadingClass) ? grid : null;
  };

  async function heal(ctx) {
    const { state } = ctx;
    if (state.page.mod !== 'overview' || (state.page.doll && state.page.doll !== '1')) {
      return ctx.navigate(ctx.url(PAGES.overview()), 'character overview');
    }
    if (!(await waitFor(inventoryReady, 10000))) throw new ActionError('The inventory did not load');
    const avatar = $(SEL.inventory.avatar);
    if (!avatar) throw new ActionError('Character avatar (food drop target) not found');

    const tried = new Set();
    for (;;) {
      const current = $(SEL.inventory.currentBagTab);
      if (current) tried.add(current.getAttribute('data-bag-number'));

      const foods = $$(SEL.inventory.food).map((el) => ({ el, heal: foodHealAmount(el) }));
      if (foods.length) {
        const hp = GBot.state.readHp(document);
        const missing = hp.max && hp.value !== null ? hp.max - hp.value : null;
        const food = brain.pickFood(foods, missing);
        ctx.log('info', `Eating food${food.heal ? ` (+${food.heal} HP)` : ''} at ${hp.percent}% HP`);
        await ctx.humanDelay();
        await dragAndDrop(food.el, avatar);
        const changed = await waitFor(() => {
          const now = GBot.state.readHp(document).value;
          return now !== null && now !== hp.value;
        }, 5000);
        if (!changed) {
          ctx.log('debug', 'Drag had no effect, using the inventory request instead');
          await consumeViaRequest(ctx, food.el);
          await sleep(1500);
        }
        return { refresh: true };
      }

      const next = $$(SEL.inventory.bagTabs).find((tab) => !tried.has(tab.getAttribute('data-bag-number')));
      if (!next) break;
      tried.add(next.getAttribute('data-bag-number'));
      await click(ctx, next, `open inventory bag ${next.textContent.trim()}`);
      await waitFor(() => next.classList.contains('current') && inventoryReady(), 8000);
      await sleep(400);
    }

    brain.markNoFood(ctx.memory, ctx.now());
    ctx.log('warn', 'No food in the inventory; waiting for HP to regenerate (retrying food in 30 min)');
    return { retick: true };
  }

  // ------------------------------------------------------------------- work

  function readWorkRemaining() {
    const ticker = $(SEL.work.ticker);
    if (!ticker) return null;
    const holder = ticker.hasAttribute('data-ticker-time-left') ? ticker : ticker.querySelector('[data-ticker-time-left]');
    if (holder) {
      const ms = parseNumber(holder.getAttribute('data-ticker-time-left'));
      if (ms !== null) return ms;
    }
    return parseDuration(ticker.textContent);
  }

  async function work(ctx) {
    const { state, settings, memory } = ctx;
    if (state.page.mod !== 'work') return ctx.navigate(ctx.url(PAGES.work()), 'stable (work)');

    const remaining = readWorkRemaining();
    if (remaining !== null) {
      memory.workUntil = ctx.now() + remaining + 30000;
      ctx.log('info', `Working for another ${GBot.util.formatDuration(remaining)}`);
      return { retick: true };
    }

    const submit = $(SEL.work.submit);
    if (!submit) {
      // No form and no timer: if we just submitted, assume the job started.
      if (memory.workSubmittedAt && ctx.now() - memory.workSubmittedAt < 3 * 60 * 1000) {
        memory.workUntil = memory.workSubmittedAt + memory.workSubmittedHours * 3600 * 1000 + 30000;
        return { retick: true };
      }
      throw new ActionError('The work form was not found');
    }

    const job = $(SEL.work.job(settings.work.job));
    if (job) await click(ctx, job, `select job #${settings.work.job + 1}`);
    else ctx.log('warn', `Job #${settings.work.job + 1} not found, using the default job`);

    const select = $(SEL.work.hours);
    let hours = settings.work.hours;
    if (select) {
      const values = Array.from(select.options).map((o) => parseInt(o.value, 10)).filter((v) => !Number.isNaN(v));
      const fitting = values.filter((v) => v <= settings.work.hours);
      hours = fitting.length ? Math.max(...fitting) : Math.min(...values);
      select.value = String(hours);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    memory.workSubmittedAt = ctx.now();
    memory.workSubmittedHours = hours;
    await click(ctx, submit, `start working for ${hours}h`);
    if (await expectNavigation(ctx)) return { navigated: true };
    return { refresh: true };
  }

  // ----------------------------------------------------------------- quests

  function questType(slot) {
    const icon = slot.querySelector(SEL.quests.icon);
    if (!icon) return null;
    const bg = icon.style.backgroundImage || getComputedStyle(icon).backgroundImage || '';
    return Object.keys(SEL.questIcons).find((type) => bg.includes(SEL.questIcons[type])) || null;
  }

  async function quests(ctx) {
    const { state, settings, memory } = ctx;
    if (state.page.mod !== 'quests') return ctx.navigate(ctx.url(PAGES.quests()), 'pantheon quests');

    const now = ctx.now();
    if (!brain.questStep(memory, now)) {
      memory.nextQuestCheck = now + 15 * 60 * 1000;
      ctx.log('warn', 'Quests: too many steps in a short time, checking again in 15 min');
      return { retick: true };
    }

    const finish = $$(SEL.quests.finish).find(isVisible);
    if (finish) {
      await click(ctx, finish, 'collect finished quest');
      if (await expectNavigation(ctx)) {
        memory.stats.quests += 1;
        return { navigated: true };
      }
      throw new ActionError('Collecting the quest reward did not reload the page');
    }

    for (const slot of $$(SEL.quests.openSlots)) {
      const type = questType(slot);
      const accept = slot.querySelector(SEL.quests.acceptInSlot);
      if (type && settings.quests.types[type] && accept && isVisible(accept)) {
        await click(ctx, accept, `accept ${type} quest`);
        if (await expectNavigation(ctx)) return { navigated: true };
        throw new ActionError('Accepting the quest did not reload the page');
      }
    }

    const cooldown = $(SEL.quests.cooldown);
    const ms = cooldown ? parseNumber(cooldown.getAttribute('data-ticker-time-left')) : null;
    const wait = Math.min(Math.max(ms || 10 * 60 * 1000, 60 * 1000), 60 * 60 * 1000);
    memory.nextQuestCheck = now + wait;
    ctx.log('info', `Quests: nothing to do, next check in ${GBot.util.formatDuration(wait)}`);
    return { retick: true };
  }

  GBot.actions = {
    dialog,
    expedition,
    dungeon,
    arena,
    circus,
    heal,
    work,
    quests,
    // Exposed for tests.
    _internal: { foodHealAmount, dragAndDrop, readOpponents },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
