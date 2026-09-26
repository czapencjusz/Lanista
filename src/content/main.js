// The runner: on every game page load it reads the state, asks the brain what
// to do next and executes it. Navigation reloads the content script, so all
// state that must survive lives in extension storage ("memory", per server).
(function (root) {
  'use strict';
  if (window.top !== window) return;
  const GBot = root.GBot;
  const ext = root.browser || root.chrome;
  const { brain, actions, util } = GBot;
  const { loadSettings, saveSettings } = GBot.settings;
  const { PAGES, buildUrl } = GBot.selectors;

  const MEMORY_KEY = `memory:${location.host}`;
  const LOG_LIMIT = 120;
  const DEBUG_LOGS = false;

  let settings = null;
  let memory = null;
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

  function log(level, message) {
    if (level === 'debug' && !DEBUG_LOGS) {
      console.debug('[GBot]', message);
      return;
    }
    (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)('[GBot]', message);
    if (!memory) return;
    memory.log.push({ t: Date.now(), level, message });
    if (memory.log.length > LOG_LIMIT) memory.log.splice(0, memory.log.length - LOG_LIMIT);
    overlay.renderLog(memory.log);
  }

  function send(message) {
    if (!extensionAlive()) return Promise.resolve(null);
    return ext.runtime.sendMessage(message).catch(() => null);
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

  async function navigate(url, what) {
    log('info', `Going to ${what}`);
    await persist();
    location.href = url;
    return { navigated: true };
  }

  async function humanDelay() {
    const { minClickDelay, maxClickDelay } = settings.timing;
    await util.sleep(util.randomBetween(minClickDelay, Math.max(minClickDelay, maxClickDelay)) * 1000);
    // `settings` is replaced by the storage listener when the user presses Stop.
    if (!settings.enabled) throw new util.ActionError('stopped by the user');
  }

  async function tick() {
    if (running || unloading || !extensionAlive()) return;
    running = true;
    cancel();
    let state = null;
    try {
      const now = Date.now();
      settings = await loadSettings();
      memory = await loadMemory();
      state = GBot.state.readState(document, location, now);

      for (const event of brain.resolvePending(state, memory, now)) log(event.level, event.message);

      let decision = brain.decide(state, settings, memory, now);
      if (settings.enabled && state.inGame) {
        const claim = await send({ type: 'claim', host: location.host });
        if (claim && claim.ok === false) decision = { type: 'idle', reason: 'GBot is running in another tab', retryMs: 60000 };
      }

      overlay.update({ settings, memory, decision, state });
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
        send({ type: 'alert', message: 'GBot is enabled but this is not an in-game page. Are you logged out?' });
      }
      return;
    }

    if (decision.type === 'wait') {
      await send({ type: 'heartbeat', host: location.host, nextAt: decision.until, enabled: true });
      // Reload the overview on wake-up so the header values are fresh.
      schedule(() => navigate(overviewUrl(state), 'overview (refresh)'), decision.until - now);
      return;
    }

    if (decision.type !== 'quests') {
      const attempt = brain.beginAttempt(memory, decision.type, now, settings, state);
      if (!attempt.ok) {
        log('warn', attempt.message);
        await persist();
        schedule(tick, 1000);
        return;
      }
    }
    log('info', decision.reason);
    await persist();
    await send({ type: 'heartbeat', host: location.host, nextAt: now + 60000, enabled: true });

    const ctx = {
      state,
      settings,
      memory,
      log,
      url: (params) => buildUrl(location.href, state.sh, params),
      navigate,
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
      if (!settings.enabled) return;
      schedule(() => navigate(overviewUrl(state), 'overview (retry)'), util.randomBetween(5000, 12000));
      return;
    }

    await persist();
    if (!result || result.navigated || unloading) return;
    if (result.refresh) schedule(() => navigate(overviewUrl(state), 'overview (refresh)'), 1500);
    else if (result.retick) schedule(tick, result.delayMs || 1000);
  }

  const overlay = GBot.overlay.create({
    onToggle: async () => {
      const current = await loadSettings();
      await saveSettings({ ...current, enabled: !current.enabled });
    },
    onRunNow: () => {
      cancel();
      tick();
    },
  });

  ext.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[MEMORY_KEY] && !running && changes[MEMORY_KEY].newValue) {
      overlay.update({ memory: brain.normalizeMemory(changes[MEMORY_KEY].newValue, Date.now()) });
    }
    if (!changes[GBot.settings.STORAGE_KEY]) return;
    const next = GBot.settings.mergeSettings(GBot.settings.DEFAULT_SETTINGS, changes[GBot.settings.STORAGE_KEY].newValue);
    const wasEnabled = settings && settings.enabled;
    settings = next;
    overlay.update({ settings });
    if (next.enabled && !wasEnabled) {
      schedule(tick, 500);
    } else if (!next.enabled && wasEnabled) {
      cancel();
      overlay.update({ decision: { type: 'idle', reason: 'Paused' } });
      send({ type: 'heartbeat', host: location.host, nextAt: null, enabled: false });
    } else if (next.enabled) {
      // Settings changed while running: re-evaluate soon.
      schedule(tick, 1500);
    }
  });

  // Give the game's own scripts a moment to initialise before the first look.
  schedule(tick, 800 + Math.random() * 1200);
})(typeof globalThis !== 'undefined' ? globalThis : this);
