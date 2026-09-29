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
    if (ctx.state.underworld && decision.dialog === 'notification') {
      // In the Underworld a dialog may offer to leave it (after falling to
      // 0 HP): only ever close it.
      const close = $(SEL.underworld.closeDialog);
      if (!close || !isVisible(close)) {
        ctx.notify('activityPaused', 'GBot: a dialog in the Underworld needs your answer; the bot will not choose for you.');
        throw new ActionError('A dialog in the Underworld has no close button; leaving it to you');
      }
      await click(ctx, close, 'close the dialog');
      return { retick: true, delayMs: 1500 };
    }
    const selector = decision.dialog === 'loginBonus' ? SEL.dialogs.loginBonusButton : SEL.dialogs.notificationButton;
    const button = $$(selector).find(isVisible);
    if (!button) throw new ActionError(`No button found in the ${decision.dialog} dialog`);
    await click(ctx, button, decision.dialog === 'loginBonus' ? 'collect login bonus' : 'close notification');
    if (await expectNavigation(ctx, 5000)) return { navigated: true };
    return { refresh: true };
  }

  // ------------------------------------------------------------------ nest

  const NEST_BUTTON = { return: 0, quick: 1, thorough: 2 };

  async function nest(ctx, decision) {
    const buttons = $$(SEL.dialogs.nestButtons).filter(isVisible);
    const button = buttons[NEST_BUTTON[decision.mode]];
    if (!button) throw new ActionError(`Nest search: no "${decision.mode}" button (found ${buttons.length})`);
    await click(ctx, button, `${decision.mode} nest search`);
    // Searching reloads the page; returning to safety only closes the dialog.
    if (await expectNavigation(ctx, 8000)) return { navigated: true };
    return { retick: true, delayMs: 1500 };
  }

  // ------------------------------------------------------------- expedition

  async function expedition(ctx) {
    const { state, settings } = ctx;
    if (state.underworld) return underworldExpedition(ctx);
    const wanted = numericLocation(settings.expedition.location);
    const onPage = state.page.mod === 'location' && (wanted === null || numericLocation(state.page.loc) === wanted);
    if (!onPage) {
      const target = wanted !== null ? ctx.url(PAGES.location(wanted)) : state.expedition.link || lastLocationLink();
      if (!target) throw new ActionError('Cannot find the expedition location link');
      return ctx.navigate(target, 'expedition location');
    }

    const buttons = $$(SEL.expedition.attackButtons);
    if (!buttons.length) throw new ActionError('No expedition attack buttons on this page');
    const enemies = GBot.state.readExpeditionEnemies(document);
    const target = brain.expeditionTarget(enemies, settings.expedition);
    const index = Math.min(Math.max(target, 0), buttons.length - 1);
    if (index !== settings.expedition.enemy - 1) {
      // Log the bonus hunt when it moves on (a new enemy, or a bonus learned).
      const enemy = enemies[index];
      const progress = `${state.page.loc}:${index}:${enemy.learnable}`;
      if (ctx.memory.bonusHunt !== progress) {
        ctx.memory.bonusHunt = progress;
        const chance = enemy.chance !== null ? ` (${enemy.chance}% per win)` : '';
        ctx.log('info', `Expedition: ${enemy.name || `enemy #${index + 1}`} has ${enemy.learnable} bonus${enemy.learnable === 1 ? '' : 'es'} left to learn${chance}, fighting it before the boss`);
        // Save now: the attack below leaves the page before the runner saves.
        await ctx.persist();
      }
    }
    const button = buttons[index];
    if (button.disabled || button.classList.contains(SEL.expedition.disabledClass)) {
      throw new ActionError(`Expedition enemy #${index + 1} cannot be attacked right now`);
    }
    await click(ctx, button, `attack expedition enemy #${index + 1}`);
    if (await expectNavigation(ctx)) return { navigated: true };
    throw new ActionError('Expedition attack did not open a combat report');
  }

  // ------------------------------------------------------------- underworld

  // The enemy whose turn it is in this Underworld area (1-based), or null.
  function underworldEnemy() {
    for (const script of document.querySelectorAll('script')) {
      const m = SEL.underworld.nextEnemy.exec(script.textContent);
      if (m) return Number(m[1]);
    }
    return null;
  }

  // The Underworld's areas and enemies unlock one after another: fight the
  // newest area (last in the location menu) and the enemy whose turn it is.
  // The stakes slider stays at its default, and an attack is only made while
  // expedition points pay for it (without them it would cost rubies).
  async function underworldExpedition(ctx) {
    const { state } = ctx;
    const target = lastLocationLink();
    if (!target) throw new ActionError('Cannot find the Underworld area in the menu');
    const wanted = numericLocation(new URL(target).searchParams.get('loc'));
    const onPage = state.page.mod === 'location' && numericLocation(state.page.loc) === wanted && $(SEL.underworld.enemies);
    if (!onPage) return ctx.navigate(target, 'Underworld area');

    const buttons = $$(SEL.expedition.attackButtons, $(SEL.underworld.enemies));
    const next = underworldEnemy();
    const button = next ? buttons[next - 1] : null;
    if (!button) throw new ActionError(`Cannot tell which Underworld enemy is next (${next === null ? 'not on the page' : `#${next} of ${buttons.length}`})`);
    if (button.disabled || button.classList.contains(SEL.expedition.disabledClass)) {
      throw new ActionError(`Underworld enemy #${next} cannot be attacked right now`);
    }
    const box = button.closest(SEL.expedition.box);
    const paid = box && box.querySelector(SEL.underworld.pointsCost) && Number(box.dataset.points) >= Number(box.dataset.costs || 1);
    if (!(state.expedition.points > 0) || !paid) {
      throw new ActionError('Out of Underworld expedition points (attacks would cost rubies)');
    }
    const name = ((box.querySelector('.expedition_name') || {}).textContent || '').trim();
    await click(ctx, button, `attack Underworld enemy ${name || `#${next}`}`);
    if (await expectNavigation(ctx)) return { navigated: true };
    throw new ActionError('Underworld attack did not open a combat report');
  }

  // Uses one owned premium item (Mobilisation or 100% Healing Potion) with
  // its "Activate" button in the premium inventory. Nothing is ever bought:
  // without an Activate button (none owned, or none usable right now) the
  // bot stops asking for the rest of the visit.
  async function premium(ctx, decision) {
    const { state, memory } = ctx;
    const page = PAGES.premiumInventory();
    const label = decision.item === 'mobilisation' ? 'Mobilisation' : '100% Healing Potion';
    const key = decision.item === 'mobilisation' ? 'mobilisations' : 'potions';
    if (state.page.mod !== page.mod || state.page.submod !== page.submod) return ctx.navigate(ctx.url(page), `the premium inventory (${label})`);

    const run = memory.underworldRun || (memory.underworldRun = { since: ctx.now(), mobilisations: 0, potions: 0 });
    const feature = SEL.premium[decision.item];
    const button = $$(SEL.premium.activate).find((b) => {
      const m = SEL.premium.feature.exec(b.getAttribute('onclick') || b.getAttribute('href') || '');
      return m && Number(m[1]) === feature;
    });
    if (!button) {
      run[key] = Math.max(run[key], ctx.settings.underworld[key]);
      ctx.log('warn', `Underworld: no ${label} to use (none owned, or none usable now)`);
      return { refresh: true };
    }
    const holder = button.closest(SEL.premium.box);
    const count = parseNumber(((holder && holder.parentElement.querySelector(SEL.premium.count)) || {}).textContent);
    run[key] += 1;
    ctx.log('info', `Underworld: using a ${label}${count !== null ? ` (${count - 1} left)` : ''}`);
    await ctx.persist();
    await click(ctx, button, `activate ${label}`);
    if (await expectNavigation(ctx)) return { navigated: true };
    throw new ActionError(`Activating the ${label} did not reload the page`);
  }

  // Enters the Underworld at the chosen difficulty on the Hermit's page.
  // The travel afterwards is waited out (never shortened with rubies, never
  // turned back).
  async function underworld(ctx) {
    const { state, settings, memory } = ctx;
    const page = PAGES.underworldEntry();
    if (state.page.mod !== page.mod || state.page.submod !== page.submod) return ctx.navigate(ctx.url(page), 'the Hermit');
    const difficulty = settings.underworld.enter;
    const label = { normal: 'Normal', medium: 'Middle', hard: 'Hard' }[difficulty];
    const button = $(SEL.underworld.enter[difficulty]);
    if (!button) {
      // No entry form: still in the cooldown after the last visit.
      memory.nextUnderworldCheck = ctx.now() + 6 * 3600 * 1000;
      ctx.log('info', 'Underworld: it cannot be entered yet; looking again in 6 hours');
      return { refresh: true };
    }
    if (button.disabled || button.classList.contains('disabled')) {
      memory.nextUnderworldCheck = ctx.now() + 24 * 3600 * 1000;
      ctx.log('warn', `Underworld: ${label} is not unlocked yet (beat Dīs Pater on the level before); change it under Settings > Underworld`);
      return { refresh: true };
    }
    if (state.gold !== null && state.gold < brain.UNDERWORLD_COST) {
      memory.nextUnderworldCheck = ctx.now() + 3600 * 1000;
      ctx.log('info', 'Underworld: not enough gold for the journey (8,000)');
      return { refresh: true };
    }
    // If the click does not go through, try again in an hour, not at once.
    memory.nextUnderworldCheck = ctx.now() + 3600 * 1000;
    ctx.log('info', `Underworld: entering on ${label} (8,000 gold)`);
    await ctx.persist();
    await click(ctx, button, `enter the Underworld (${label})`);
    if (await expectNavigation(ctx)) return { navigated: true };
    throw new ActionError('Entering the Underworld did not reload the page');
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

    // Still in the cooldown: the page offers to skip it for a ruby. Never
    // click anything here; the overview shows the real time left.
    if ($(SEL.dungeon.skipCooldown)) {
      ctx.log('debug', 'Dungeon: the cooldown is not over yet');
      return { refresh: true };
    }

    const targets = dungeonTargets();
    if (targets.length) {
      const choice = brain.dungeonChoice(targets, settings.dungeon, ctx.memory);
      if (choice.cancel) return cancelDungeon(ctx, choice.cancel);
      const target = targets.find((t) => t.position === choice.position);
      await click(ctx, target.el, `attack dungeon enemy #${target.position}${target.boss ? ' (boss)' : ''}`);
      if (await expectNavigation(ctx)) return { navigated: true };
      throw new ActionError('Dungeon attack did not open a combat report');
    }

    // No dungeon in progress: start one.
    const startButton = (sel) => {
      const el = $(sel);
      return el && !el.disabled && !el.classList.contains(SEL.dungeon.disabledClass) ? el : null;
    };
    let advanced = settings.dungeon.difficulty === 'advanced';
    let start = startButton(advanced ? SEL.dungeon.startAdvanced : SEL.dungeon.startNormal);
    if (!start && advanced && startButton(SEL.dungeon.startNormal)) {
      // Advanced unlocks after Normal has been finished at this location.
      ctx.log('info', 'Dungeon: Advanced is not unlocked here yet, starting Normal');
      advanced = false;
      start = startButton(SEL.dungeon.startNormal);
    }
    if (!start && !$(SEL.dungeon.startNormal)) {
      // Normal + Advanced without their names. Never "Cancel dungeon", nor
      // the ruby cooldown skip (both excluded by the selector).
      const buttons = $$(SEL.dungeon.startFallback);
      if (buttons.length >= 2) start = buttons[advanced ? 1 : 0];
    }
    if (!start) throw new ActionError(`No dungeon enemies and no ${advanced ? 'advanced' : 'normal'} start button (not unlocked?)`);
    await click(ctx, start, `start ${advanced ? 'advanced' : 'normal'} dungeon`);
    if (await expectNavigation(ctx)) return { navigated: true };
    throw new ActionError('Starting the dungeon did not reload the page');
  }

  // Enemies on the dungeon map by position ({ position, el, boss }), in
  // page order. Each position has an image-map area, an icon and sometimes
  // a label; the boss's label is a word ("Boss"), a group's is "1/3".
  function dungeonTargets() {
    const targets = [];
    for (const el of dungeonEnemies()) {
      const m = /startFight\(\s*['"]?(\d+)/.exec(el.getAttribute('onclick') || '');
      if (!m) continue;
      const position = Number(m[1]);
      let target = targets.find((t) => t.position === position);
      if (!target) targets.push((target = { position, el, boss: false }));
      if (el.matches(SEL.dungeon.label) && !/^\s*\d+\s*\/\s*\d+\s*$/.test(el.textContent)) target.boss = true;
    }
    return targets;
  }

  async function cancelDungeon(ctx, why) {
    const button = $(SEL.dungeon.cancel);
    if (!button) throw new ActionError('No "Cancel dungeon" button found');
    ctx.log('info', `Dungeon: ${why}, cancelling it to start a new one`);
    ctx.memory.dungeonLosses = 0;
    await ctx.persist();
    await click(ctx, button, 'cancel dungeon');
    const outcome = await waitFor(() => (ctx.isUnloading() ? 'navigated' : visibleConfirmDialog() ? 'confirm' : null), 8000, 150);
    if (outcome === 'navigated') return { navigated: true };
    if (outcome === 'confirm') {
      const buttons = $$(SEL.dialogs.confirmButton, visibleConfirmDialog()).filter(isVisible);
      if (buttons.length) {
        await click(ctx, buttons[0], 'confirm cancelling the dungeon');
        if (await expectNavigation(ctx)) return { navigated: true };
      }
    }
    throw new ActionError('Cancelling the dungeon did not reload the page');
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
        const nameCell = o.row.cells[SEL.arena.nameCellIndex];
        return {
          ...o,
          index,
          level: cell ? parseNumber(cell.textContent) : null,
          name: nameCell ? nameCell.textContent.trim() : '',
        };
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

    const avoided = brain.avoidedNames(ctx.memory, type, ctx.now());
    const allowed = brain.filterOpponents(opponents, settings[type], state.level, avoided);
    if (!allowed.length) throw new ActionError(`None of the ${opponents.length} ${type} opponents match your filters`);
    const order = brain.pickOpponents(allowed, settings[type].target);
    for (const opponent of order.slice(0, 3)) {
      // Remembered so the combat report can be tied to this opponent.
      if (ctx.memory.pending) Object.assign(ctx.memory.pending, { opponent: opponent.name, avoidHours: settings[type].avoidLostHours });
      await ctx.persist();
      await click(ctx, opponent.attack, `attack ${type} opponent ${opponent.name || ''} (level ${opponent.level ?? '?'})`);
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
    // The game sends its CSRF token with every AJAX request.
    const csrf = document.querySelector('meta[name="csrf-token"]');
    const response = await pageFetch(url.href, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        ...(csrf ? { 'X-CSRF-Token': csrf.getAttribute('content') } : {}),
      },
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

    // Auction wins and other food arrive as packages: take one out.
    if (GBot.auction) {
      try {
        const hp = GBot.state.readHp(document);
        const taken = await GBot.auction.takeFoodFromPackages(ctx, hp.max && hp.value !== null ? hp.max - hp.value : null);
        if (taken) {
          ctx.log('info', `Took ${taken} from the packages to eat`);
          return { refresh: true };
        }
      } catch (e) {
        ctx.log('warn', `Could not take food from the packages: ${e.message}`);
      }
    }

    brain.markNoFood(ctx.memory, ctx.now());
    ctx.log('warn', 'No food in the bags or packages; waiting for HP to regenerate (retrying food in 30 min)');
    if (ctx.notify) ctx.notify('noFood', `GBot: HP is ${state.hp.percent}% and there is no food left in your bags.`);
    return { retick: true };
  }

  // --------------------------------------------------------------- training

  async function training(ctx) {
    const { state, settings, memory } = ctx;
    if (state.page.mod !== 'training') return ctx.navigate(ctx.url(PAGES.training()), 'training ground');

    const buttons = $$(SEL.training.buttons);
    const costs = $$(SEL.training.costs);
    if (!buttons.length || buttons.length !== costs.length) throw new ActionError('The training ground looks different than expected');
    const options = buttons.map((button, i) => ({ button, stat: GBot.settings.TRAINING_STATS[i], cost: parseNumber(costs[i].textContent) }));
    const pick = brain.pickTraining(options, settings.training.stats);
    if (!pick) throw new ActionError('No trainable stat selected');

    const spare = state.gold - settings.training.keepGold;
    if (spare < pick.cost) {
      memory.trainCost = pick.cost;
      memory.nextTrainingCheck = ctx.now() + 30 * 60 * 1000;
      memory.pending = null;
      ctx.log('info', `Training: ${pick.stat} costs ${pick.cost.toLocaleString('en-US')} gold, waiting until there is enough`);
      return { retick: true };
    }
    memory.trainCost = null;
    if (memory.pending) memory.pending.stat = pick.stat;
    await ctx.persist();
    await click(ctx, pick.button, `train ${pick.stat} (${pick.cost.toLocaleString('en-US')} gold)`);
    if (await expectNavigation(ctx)) return { navigated: true };
    throw new ActionError('Training did not reload the page');
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
    // The game fills the hours list only after a job is picked.
    const values = select
      ? (await waitFor(() => {
          const list = Array.from(select.options).map((o) => parseInt(o.value, 10)).filter((v) => !Number.isNaN(v));
          return list.length ? list : null;
        }, 5000)) || []
      : [];
    if (select && !values.length) throw new ActionError('The work duration list stayed empty');
    if (select) {
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
    return Object.keys(SEL.questIcons).find((type) => SEL.questIcons[type].some((part) => bg.includes(part))) || null;
  }

  // Name of the expedition location the bot fights at, or null when unknown.
  function fightLocationName(state, settings, memory) {
    let id = numericLocation(settings.expedition.location);
    if (id === null && state.expedition.link) id = numericLocation(new URL(state.expedition.link).searchParams.get('loc'));
    if (id === null) return null;
    const list = state.locations.length ? state.locations : memory.gameInfo.locations || [];
    const found = list.find((l) => numericLocation(l.id) === id);
    return found ? found.name : null;
  }

  // "Accepted quests: 2 / 5" -> { count: 2, max: 5 }, or null.
  function acceptedQuests() {
    const el = $(SEL.quests.accepted);
    const m = el && el.textContent.match(/(\d+)\s*\/\s*(\d+)/);
    return m ? { count: Number(m[1]), max: Number(m[2]) } : null;
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

    const accepted = acceptedQuests();
    if (!accepted || accepted.count < accepted.max) {
      const offers = $$(SEL.quests.openSlots)
        .map((slot) => {
          const title = slot.querySelector(SEL.quests.title);
          const reward = slot.querySelector(SEL.quests.reward);
          return {
            type: questType(slot),
            title: title ? title.textContent.trim() : '',
            reward: reward ? parseNumber(reward.textContent) : null,
            accept: slot.querySelector(SEL.quests.acceptInSlot),
          };
        })
        .filter((q) => q.accept && isVisible(q.accept));
      const quest = brain.chooseQuest(offers, settings, {
        location: fightLocationName(state, settings, memory),
        dungeon: memory.gameInfo.dungeonName,
      });
      if (quest) {
        await click(ctx, quest.accept, `accept ${quest.type} quest "${quest.title}"`);
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
    nest,
    expedition,
    underworld,
    premium,
    dungeon,
    arena,
    circus,
    heal,
    training,
    work,
    quests,
    // Exposed for tests.
    _internal: { foodHealAmount, dragAndDrop, readOpponents },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
