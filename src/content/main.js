// The runner: on every game page load it reads the state, asks the brain what
// to do next and executes it. Navigation reloads the content script, so all
// state that must survive lives in extension storage ("memory", per server).
(function (root) {
  'use strict';
  if (window.top !== window) return;
  const GBot = root.GBot;
  const ext = root.browser || root.chrome;
  const { brain, actions, util } = GBot;
  const S = GBot.settings;
  const { PAGES, buildUrl } = GBot.selectors;

  // Memory and settings are kept per game server.
  const HOST = location.host;
  const MEMORY_KEY = `memory:${HOST}`;
  const SETTINGS_KEY = S.settingsKey(HOST);
  const LOG_LIMIT = 150;
  const DEBUG_LOGS = false;

  let settings = null;
  let memory = null;
  let lastState = null;
  let unloading = false;
  let running = false;
  let timer = null;
  let lastAlertAt = 0;

  window.addEventListener('beforeunload', () => {
    unloading = true;
  });
  window.addEventListener('pageshow', (e) => {
    // Restored from the back/forward cache: start over.
    if (e.persisted) {
      unloading = false;
      schedule(tick, 1000);
    }
  });

  const extensionAlive = () => {
    try {
      return !!(ext && ext.runtime && ext.runtime.id);
    } catch (e) {
      return false;
    }
  };

  async function loadMemory() {
    const data = await ext.storage.local.get(MEMORY_KEY);
    return brain.normalizeMemory(data[MEMORY_KEY], Date.now());
  }

  async function persist() {
    if (memory && extensionAlive()) await ext.storage.local.set({ [MEMORY_KEY]: memory });
  }

  // Read-modify-write of the stored memory from UI buttons (reset stats...).
  async function editMemory(fn) {
    const current = memory || (await loadMemory());
    fn(current);
    memory = current;
    await persist();
    panel.update({ memory });
  }

  function log(level, message) {
    if (level === 'debug' && !DEBUG_LOGS) {
      console.debug('[GBot]', message);
      return;
    }
    (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)('[GBot]', message);
    if (!memory) return;
    memory.log.push({ t: Date.now(), level, message });
    if (memory.log.length > LOG_LIMIT) memory.log.splice(0, memory.log.length - LOG_LIMIT);
    panel.update({ memory });
  }

  function send(message) {
    if (!extensionAlive()) return Promise.resolve(null);
    return ext.runtime.sendMessage(message).catch(() => null);
  }

  // Desktop notification, if the user enabled this kind in the settings.
  function notify(kind, message) {
    if (settings && settings.notifications[kind] === false) return;
    send({ type: 'alert', kind, message, host: HOST });
  }

  function schedule(fn, delayMs) {
    clearTimeout(timer);
    timer = setTimeout(fn, Math.max(0, delayMs));
  }

  function cancel() {
    clearTimeout(timer);
    timer = null;
  }

  function overviewUrl(state) {
    return buildUrl(location.href, state && state.sh, PAGES.overview());
  }

  async function navigate(url, what, level = 'info') {
    log(level, `Going to ${what}`);
    await persist();
    location.href = url;
    return { navigated: true };
  }

  async function humanDelay() {
    const { minClickDelay, maxClickDelay } = settings.timing;
    await util.sleep(util.randomBetween(minClickDelay, Math.max(minClickDelay, maxClickDelay)) * 1000);
    // `settings` is replaced by the storage listener when the user presses
    // Stop. Repairs keep going so no item is left off the character.
    if (!settings.enabled && !repairRunning()) throw new util.ActionError('stopped by the user');
  }

  const repairRunning = () => !!(memory && (memory.repair || memory.repairAll));

  // "Repair all" button under the character (or the mercenary shown) on the
  // overview page.
  function renderRepairButton(state) {
    let box = document.getElementById('gbot-repair-all');
    const onOverview = state && state.inGame && state.page.mod === 'overview' && !state.page.submod;
    const dollNumber = Math.min(6, Math.max(1, Number((state && state.page.doll) || 1) || 1));
    const doll = document.querySelector('#char');
    if (!onOverview || !doll) {
      if (box) box.remove();
      return;
    }
    if (!box) {
      box = document.createElement('div');
      box.id = 'gbot-repair-all';
      box.style.cssText = 'margin:4px 0 0;text-align:center;font:11px Arial,sans-serif;color:#4a2d0d';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'awesome-button';
      button.addEventListener('click', () => {
        if (button.disabled) return;
        const which = Number(button.dataset.doll) || 1;
        editMemory((m) => {
          m.repairAll = { dolls: [which], done: [], skipped: [], repaired: 0, failures: 0, startedAt: Date.now() };
          m.nextRepairCheck = 0;
        }).then(() => {
          log('info', `Repair all: started${brain.dollSuffix(which)}`);
          cancel();
          tick();
        });
      });
      const status = document.createElement('div');
      status.className = 'gbot-repair-status';
      status.style.marginTop = '2px';
      box.append(button, status);
      doll.insertAdjacentElement('afterend', box);
    }
    const button = box.querySelector('button');
    button.dataset.doll = String(dollNumber);
    const status = box.querySelector('.gbot-repair-status');
    const cutoff = settings.repair.allUpToPercent;
    const worn = GBot.workbench.readDoll(document, dollNumber).filter((i) => brain.inRepairAll(i, settings));
    const quality = ['Standard', 'Ceres', 'Neptun', 'Mars', 'Jupiter', 'Olymp'][settings.repair.maxQuality + 1];
    if (repairRunning()) {
      button.disabled = true;
      button.textContent = 'Repairing…';
      const r = memory.repair;
      const done = memory.repairAll ? `${memory.repairAll.repaired} done` : '';
      status.textContent = [r ? `${r.name}: ${r.stage}` : '', done].filter(Boolean).join(' · ');
    } else {
      button.disabled = worn.length === 0;
      button.textContent = worn.length ? `Repair all (${worn.length})` : `All gear above ${cutoff}%`;
      const lowest = worn.reduce((a, b) => (!a || b.condition.percent < a.condition.percent ? b : a), null);
      status.textContent = lowest ? `Lowest: ${lowest.name} ${lowest.condition.percent}%` : '';
    }
    const whose = dollNumber === 1 ? 'your character' : brain.DOLL_LABELS[dollNumber];
    button.title = `Repair every item on ${whose} at or below ${cutoff}% conditioning at the workbench, with Horreum materials up to ${quality} (lowest quality first). Rent is paid in gold for each item. Works even while the bot is stopped. Change the cutoff under Settings > Repair.`;
  }

  // "Store all resources in the Horreum" button on the packages page.
  function renderPackagesButton(state) {
    let box = document.getElementById('gbot-store-resources');
    const list = document.querySelector(GBot.selectors.SEL.packages.list);
    if (!(state && state.inGame && state.page.mod === 'packages') || !list) {
      if (box) box.remove();
      return;
    }
    if (box) {
      renderSmeltTicks(box);
      return;
    }
    box = document.createElement('div');
    box.id = 'gbot-store-resources';
    box.style.cssText = 'margin:6px 0;text-align:center;font:11px Arial,sans-serif;color:#4a2d0d';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'awesome-button';
    button.textContent = 'Store all resources in the Horreum';
    button.title = 'Move every resource from all your packages into the Horreum, like the Horreum\'s own "Store resources" with only "Packages" ticked. Surplus above 99,999 per type and quality is sold. Items and food stay in the packages.';
    const status = document.createElement('div');
    status.style.marginTop = '3px';
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      button.disabled = true;
      status.textContent = 'Storing…';
      try {
        const stored = await GBot.workbench.storePackagedResources(state.sh);
        const message = stored > 0 ? `Stored ${stored.toLocaleString('en-US')} resources from the packages in the Horreum` : 'There were no resources in the packages';
        status.textContent = message;
        log('info', message);
        await persist();
        if (stored > 0) setTimeout(() => location.reload(), 1500);
        else button.disabled = false;
      } catch (e) {
        status.textContent = `Could not store the resources: ${e.message}`;
        button.disabled = false;
      }
    });
    const tickAll = document.createElement('button');
    tickAll.type = 'button';
    tickAll.className = 'awesome-button gbot-smelt-all';
    tickAll.style.marginLeft = '6px';
    tickAll.addEventListener('click', () => {
      const items = smeltableOnPage();
      const all = items.length && items.every((el) => smeltQueued(el));
      setSmeltQueued(items, !all);
    });
    const queueLine = document.createElement('div');
    queueLine.className = 'gbot-smelt-status';
    queueLine.style.marginTop = '3px';
    box.append(button, tickAll, status, queueLine);
    // Above the packages' "Content" header, with or without add-ons
    // restyling the page.
    const section = list.parentElement;
    const header = section.previousElementSibling;
    const anchor = header && header.classList.contains('section-header') ? header : list;
    anchor.parentNode.insertBefore(box, anchor);
    renderSmeltTicks(box);
  }

  // ------------------------------------------------ smelting queue (packages)

  const packageCn = (el) => util.parseNumber(el.parentElement.getAttribute('data-container-number'));
  const smeltableOnPage = () =>
    Array.from(document.querySelectorAll(`${GBot.selectors.SEL.packages.package} [data-content-type]`)).filter(GBot.smelter.isSmeltable);
  const smeltQueued = (el) => !!(memory && memory.smeltQueue.some((q) => q.cn === packageCn(el)));

  function setSmeltQueued(items, on) {
    const entries = items.map(GBot.smelter.queueEntry);
    editMemory((m) => {
      for (const entry of entries) {
        const i = m.smeltQueue.findIndex((q) => q.cn === entry.cn);
        if (on && i < 0) m.smeltQueue.push(entry);
        if (!on && i >= 0) m.smeltQueue.splice(i, 1);
      }
      // Let the bot look at the smelter soon.
      if (on && m.smeltQueue.length) m.smeltNext = Math.min(m.smeltNext || Infinity, Date.now());
    }).then(() => renderPackagesButton(lastState));
  }

  // One tickbox per smeltable item, the "tick all" label and the queue size.
  function renderSmeltTicks(box) {
    const items = smeltableOnPage();
    for (const el of items) {
      const pkg = el.closest('.packageItem');
      let tick = pkg.querySelector('.gbot-smelt-tick');
      if (!tick) {
        if (getComputedStyle(pkg).position === 'static') pkg.style.position = 'relative';
        tick = document.createElement('input');
        tick.type = 'checkbox';
        tick.className = 'gbot-smelt-tick';
        tick.title = 'Smelt this item (GBot)';
        tick.style.cssText = 'position:absolute;top:2px;right:2px;z-index:5;margin:0;width:15px;height:15px;cursor:pointer;accent-color:#b8382b';
        tick.addEventListener('click', (e) => e.stopPropagation());
        tick.addEventListener('change', () => setSmeltQueued([el], tick.checked));
        pkg.appendChild(tick);
      }
      tick.checked = smeltQueued(el);
    }
    const tickAll = box.querySelector('.gbot-smelt-all');
    const all = items.length && items.every((el) => smeltQueued(el));
    tickAll.textContent = all ? 'Untick all on this page' : 'Tick all on this page for smelting';
    tickAll.disabled = !items.length;
    tickAll.title = 'Queue every weapon, armour and jewellery item on this page for smelting. Smelting destroys the item and gives resources.';
    const queued = memory ? memory.smeltQueue.length : 0;
    const note = !settings || !settings.smelting.enabled ? ' (smelting is off under Settings > Smelting)' : !settings.enabled ? ' (starts when the bot runs)' : '';
    box.querySelector('.gbot-smelt-status').textContent = queued ? `${queued} item${queued === 1 ? '' : 's'} queued for smelting${note}` : '';
  }

  function renderPageButtons(state) {
    renderRepairButton(state);
    renderPackagesButton(state);
  }

  // Remember facts about the game for the settings UI and statistics.
  function recordGameInfo(state, now) {
    if (!state.inGame) return;
    if (state.locations.length) memory.gameInfo.locations = state.locations;
    if (state.level !== null) memory.gameInfo.level = state.level;
    if (state.dungeonName) memory.gameInfo.dungeonName = state.dungeonName;
    memory.gameInfo.updatedAt = now;
    if (state.gold !== null) {
      if (memory.stats.goldStart === null) memory.stats.goldStart = state.gold;
      memory.stats.goldNow = state.gold;
    }
  }

  const statusFor = (state) => (state && settings && memory ? brain.activityStatus(state, settings, memory, Date.now()) : {});

  // Fills in the control bar as soon as the page is parsed, from storage and
  // the page itself. Read-only: decide() has no side effects and nothing is
  // executed or saved, so the first tick (which may act) keeps its delay.
  async function paintNow() {
    const now = Date.now();
    const [loadedSettings, loadedMemory] = await Promise.all([S.loadSettings(HOST), loadMemory()]);
    if (running) return; // the first tick got here first
    settings = loadedSettings;
    memory = loadedMemory;
    const state = GBot.state.readState(document, location, now);
    lastState = state;
    const decision = brain.decide(state, settings, memory, now);
    panel.update({ settings, memory, decision, state, status: statusFor(state) });
    renderPageButtons(state);
  }

  async function tick() {
    if (running || unloading || !extensionAlive()) return;
    running = true;
    cancel();
    let state = null;
    try {
      const now = Date.now();
      settings = await S.loadSettings(HOST);
      memory = await loadMemory();
      state = GBot.state.readState(document, location, now);
      lastState = state;

      recordGameInfo(state, now);
      const visit = memory.underworldRun;
      brain.trackUnderworld(state, memory, now);
      // Beating Dīs Pater (or leaving) ends the visit without a report page.
      if (visit && !memory.underworldRun) {
        const used = [visit.mobilisations && `${visit.mobilisations} Mobilisation(s)`, visit.potions && `${visit.potions} healing potion(s)`].filter(Boolean);
        log('info', `Back from the Underworld${used.length ? ` (used ${used.join(' and ')})` : ''}`);
      }
      for (const event of brain.resolvePending(state, memory, now)) log(event.level, event.message);
      if (settings.enabled) brain.updateBreaks(settings.schedule, memory, now);

      let decision = brain.decide(state, settings, memory, now);
      // A repair also runs while paused; it must not run in two tabs at once.
      if ((settings.enabled || repairRunning()) && state.inGame) {
        const claim = await send({ type: 'claim', host: location.host });
        if (claim && claim.ok === false) decision = { type: 'idle', reason: 'GBot is running in another tab', retryMs: 60000 };
      }

      panel.update({ settings, memory, decision, state, status: statusFor(state) });
      renderPageButtons(state);
      await persist();
      await execute(decision, state);
    } catch (e) {
      log('error', `Unexpected error: ${e && e.message ? e.message : e}`);
      await persist().catch(() => {});
      if (settings && settings.enabled) schedule(() => navigate(overviewUrl(state), 'overview (recovering)'), 20000);
    } finally {
      running = false;
    }
  }

  async function execute(decision, state) {
    const now = Date.now();

    if (decision.type === 'idle') {
      // Release the tab lock so the watchdog leaves an idle tab alone.
      await send({ type: 'heartbeat', host: location.host, nextAt: null, enabled: false });
      // Another tab owns the bot: check again later in case it gets closed.
      if (decision.retryMs) schedule(tick, decision.retryMs);
      if (settings.enabled && !state.inGame && now - lastAlertAt > 30 * 60 * 1000) {
        lastAlertAt = now;
        notify('loggedOut', 'GBot is enabled but this is not an in-game page. Are you logged out?');
      }
      return;
    }

    if (decision.type === 'wait') {
      await send({ type: 'heartbeat', host: location.host, nextAt: decision.until, enabled: true });
      // Reload the overview on wake-up so the header values are fresh.
      schedule(() => navigate(overviewUrl(state), 'overview (refresh)', 'debug'), decision.until - now);
      return;
    }

    // Quests, repairs, smelting, the auction house and the packages are
    // multi-step and keep their own failure handling.
    if (!['quests', 'repair', 'smelt', 'auction', 'packages', 'underworld', 'premium'].includes(decision.type)) {
      const attempt = brain.beginAttempt(memory, decision.type, now, settings, state);
      if (!attempt.ok) {
        log('warn', attempt.message);
        notify('activityPaused', `GBot: ${attempt.message}`);
        await persist();
        schedule(tick, 1000);
        return;
      }
    }
    // Multi-step actions (navigate, then act) re-decide on every page; log
    // the reason once per run. Repairs log their own steps (workbench.js).
    if (['repair', 'smelt', 'auction', 'packages'].includes(decision.type)) log('debug', decision.reason);
    else if (!memory.pending || memory.pending.attempts === 1) log('info', decision.reason);
    await persist();
    await send({ type: 'heartbeat', host: location.host, nextAt: now + 60000, enabled: true });

    const ctx = {
      state,
      settings,
      memory,
      log,
      notify,
      url: (params) => buildUrl(location.href, state.sh, params),
      navigate,
      persist,
      humanDelay,
      isUnloading: () => unloading,
      now: () => Date.now(),
    };

    let result;
    try {
      result = await actions[decision.type](ctx, decision);
    } catch (e) {
      log(e instanceof util.ActionError ? 'warn' : 'error', `${decision.type}: ${e.message}`);
      await persist();
      if (!settings.enabled && !repairRunning()) return;
      schedule(() => navigate(overviewUrl(state), 'overview (retry)'), util.randomBetween(5000, 12000));
      return;
    }

    await persist();
    panel.update({ memory, status: statusFor(state) });
    renderPageButtons(state);
    if (!result || result.navigated || unloading) return;
    if (result.refresh) schedule(() => navigate(overviewUrl(state), 'overview (refresh)', 'debug'), 1500);
    else if (result.retick) schedule(tick, result.delayMs || 1000);
  }

  const panel = GBot.panel.create({
    onToggleBot: async () => {
      const current = await S.loadSettings(HOST);
      await S.saveSettings({ ...current, enabled: !current.enabled }, HOST);
    },
    onToggleActivity: async (id) => {
      const current = await S.loadSettings(HOST);
      const path = GBot.ui.ACTIVITIES[id].path;
      await S.saveSettings(S.setPath(current, path, !S.getPath(current, path)), HOST);
    },
    onSaveSettings: (next) => S.saveSettings(next, HOST),
    host: HOST,
    listServers: S.listServers,
    loadServerSettings: S.loadSettings,
    onRunNow: () => {
      cancel();
      tick();
    },
    onResetStats: () =>
      editMemory((m) => {
        m.stats = brain.createMemory(Date.now()).stats;
        m.blockedUntil = {};
        m.noFoodUntil = 0;
      }),
    onClearLog: () =>
      editMemory((m) => {
        m.log = [];
      }),
  });

  ext.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[MEMORY_KEY] && !running && changes[MEMORY_KEY].newValue) {
      memory = brain.normalizeMemory(changes[MEMORY_KEY].newValue, Date.now());
      panel.update({ memory, status: statusFor(lastState) });
      renderPageButtons(lastState);
    }
    // This server's settings, or the shared ones while it has none of its own.
    if (changes[SETTINGS_KEY] && changes[SETTINGS_KEY].newValue) applySettings(S.normalize(changes[SETTINGS_KEY].newValue));
    else if (changes[SETTINGS_KEY] || changes[S.STORAGE_KEY]) S.loadSettings(HOST).then(applySettings, () => {});
  });

  function applySettings(next) {
    if (settings && JSON.stringify(next) === JSON.stringify(settings)) return;
    const wasEnabled = settings && settings.enabled;
    // New auction settings (price, limits, timing): look again right away
    // instead of at the next scheduled check.
    if (settings && JSON.stringify(settings.auction) !== JSON.stringify(next.auction)) {
      editMemory((m) => {
        m.nextAuctionCheck = 0;
        m.auctionNote = null;
      }).catch(() => {});
    }
    settings = next;
    panel.update({ settings, status: statusFor(lastState) });
    renderRepairButton(lastState);
    if (next.enabled && !wasEnabled) {
      schedule(tick, 500);
    } else if (!next.enabled && wasEnabled) {
      cancel();
      panel.update({ decision: { type: 'idle', reason: 'Paused' } });
      send({ type: 'heartbeat', host: location.host, nextAt: null, enabled: false });
    } else if (next.enabled) {
      // Settings changed while running: re-evaluate soon.
      schedule(tick, 1500);
    }
  }

  // Show the bar's state right away, but give the game's own scripts a moment
  // to initialise before the first tick, which may click or navigate.
  paintNow().catch((e) => console.debug('[GBot] first paint failed', e));
  schedule(tick, 800 + Math.random() * 1200);
})(typeof globalThis !== 'undefined' ? globalThis : this);
