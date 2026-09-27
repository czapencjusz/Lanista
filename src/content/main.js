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

  const MEMORY_KEY = `memory:${location.host}`;
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
    send({ type: 'alert', kind, message });
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

  // "Repair all" button under the character on the overview page.
  function renderRepairButton(state) {
    let box = document.getElementById('gbot-repair-all');
    const onOverview = state && state.inGame && state.page.mod === 'overview' && (!state.page.doll || state.page.doll === '1');
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
        editMemory((m) => {
          m.repairAll = { done: [], skipped: [], repaired: 0, failures: 0, startedAt: Date.now() };
          m.nextRepairCheck = 0;
        }).then(() => {
          log('info', 'Repair all: started');
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
    const status = box.querySelector('.gbot-repair-status');
    const cutoff = settings.repair.allUpToPercent;
    const worn = GBot.workbench.readDoll(document).filter((i) => brain.inRepairAll(i, settings));
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
    button.title = `Repair every item on your character at or below ${cutoff}% conditioning at the workbench, with Horreum materials up to ${quality} (lowest quality first). Rent is paid in gold. Works even while the bot is stopped. Change the cutoff under Settings > Repair.`;
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

  async function tick() {
    if (running || unloading || !extensionAlive()) return;
    running = true;
    cancel();
    let state = null;
    try {
      const now = Date.now();
      settings = await S.loadSettings();
      memory = await loadMemory();
      state = GBot.state.readState(document, location, now);
      lastState = state;

      recordGameInfo(state, now);
      for (const event of brain.resolvePending(state, memory, now)) log(event.level, event.message);
      if (settings.enabled) brain.updateBreaks(settings.schedule, memory, now);

      let decision = brain.decide(state, settings, memory, now);
      // A repair also runs while paused; it must not run in two tabs at once.
      if ((settings.enabled || repairRunning()) && state.inGame) {
        const claim = await send({ type: 'claim', host: location.host });
        if (claim && claim.ok === false) decision = { type: 'idle', reason: 'GBot is running in another tab', retryMs: 60000 };
      }

      panel.update({ settings, memory, decision, state, status: statusFor(state) });
      renderRepairButton(state);
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

    // Quests and repairs are multi-step and keep their own failure counts.
    if (decision.type !== 'quests' && decision.type !== 'repair') {
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
    if (decision.type === 'repair') log('debug', decision.reason);
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
    renderRepairButton(state);
    if (!result || result.navigated || unloading) return;
    if (result.refresh) schedule(() => navigate(overviewUrl(state), 'overview (refresh)', 'debug'), 1500);
    else if (result.retick) schedule(tick, result.delayMs || 1000);
  }

  const panel = GBot.panel.create({
    onToggleBot: async () => {
      const current = await S.loadSettings();
      await S.saveSettings({ ...current, enabled: !current.enabled });
    },
    onToggleActivity: async (id) => {
      const current = await S.loadSettings();
      const path = GBot.ui.ACTIVITIES[id].path;
      await S.saveSettings(S.setPath(current, path, !S.getPath(current, path)));
    },
    onSaveSettings: (next) => S.saveSettings(next),
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
    }
    if (!changes[S.STORAGE_KEY]) return;
    const next = S.normalize(changes[S.STORAGE_KEY].newValue);
    const wasEnabled = settings && settings.enabled;
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
  });

  // Give the game's own scripts a moment to initialise before the first look.
  schedule(tick, 800 + Math.random() * 1200);
})(typeof globalThis !== 'undefined' ? globalThis : this);
