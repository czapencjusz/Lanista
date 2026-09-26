// Shared logic of the toolbar popup and the options page: both show a header
// with start/stop and server status, and the same settings component that the
// in-game window uses.
(function (root) {
  'use strict';
  const GBot = root.GBot;
  const ext = root.browser || root.chrome;
  const S = GBot.settings;
  const { h, icon } = GBot.ui;

  const GAME_ORIGINS = ['https://*.gladiatus.gameforge.com/*'];
  const memoryKey = (host) => `memory:${host}`;

  async function activeGameHost() {
    try {
      const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url && /^https:\/\/[^/]+\.gladiatus\.gameforge\.com\//.test(tab.url)) return new URL(tab.url).host;
    } catch (e) {
      // No access to the tab URL.
    }
    return null;
  }

  // Servers the bot has played on, most recently active first.
  async function knownServers() {
    const all = await ext.storage.local.get(null);
    return Object.keys(all)
      .filter((k) => k.startsWith('memory:'))
      .map((k) => ({ host: k.slice(7), updatedAt: (all[k].gameInfo && all[k].gameInfo.updatedAt) || 0 }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  const serverName = (host) => {
    const m = host.match(/^s(\d+)-(\w+)\./);
    return m ? `Server ${m[1]} (${m[2].toUpperCase()})` : host;
  };

  async function mount({ compact }) {
    const style = document.createElement('style');
    style.textContent = GBot.ui.STYLES;
    document.head.appendChild(style);
    document.body.classList.add('gb-root');

    let settings = await S.loadSettings();
    const servers = await knownServers();
    let host = (await activeGameHost()) || (servers[0] && servers[0].host) || null;
    let memory = null;

    const loadMemory = async () => {
      if (!host) return null;
      const stored = (await ext.storage.local.get(memoryKey(host)))[memoryKey(host)];
      return stored ? GBot.brain.normalizeMemory(stored, Date.now()) : null;
    };
    const editMemory = async (fn) => {
      if (!host) return;
      const m = (await loadMemory()) || GBot.brain.createMemory(Date.now());
      fn(m);
      await ext.storage.local.set({ [memoryKey(host)]: m });
    };
    memory = await loadMemory();

    // ------------------------------------------------------------ header
    const toggleLabel = h('span', {}, 'Start');
    const toggleIcon = h('span', {}, icon('play', 14));
    const toggle = h(
      'button',
      {
        type: 'button',
        id: 'toggle',
        class: 'gb-play',
        onclick: async () => {
          settings = await S.saveSettings({ ...settings, enabled: !settings.enabled });
          render();
        },
      },
      toggleIcon,
      toggleLabel
    );
    const serverSelect = h('select', {
      class: 'gb-input gb-select gb-server',
      'aria-label': 'Server',
      hidden: servers.length < 2,
      onchange: async () => {
        host = serverSelect.value;
        memory = await loadMemory();
        view.update({ memory });
        render();
      },
    });
    for (const s of servers) serverSelect.appendChild(h('option', { value: s.host }, serverName(s.host)));
    if (host && !servers.some((s) => s.host === host)) serverSelect.appendChild(h('option', { value: host }, serverName(host)));
    if (host) serverSelect.value = host;

    const subtitle = h('div', { class: 'gb-page-sub', id: 'status-host' });
    const header = h(
      'header',
      { class: 'gb-page-head' },
      h('img', { src: '../../icons/icon32.png', alt: '', width: 26, height: 26 }),
      h('div', { class: 'gb-page-title' }, h('h1', {}, 'GBot'), subtitle),
      serverSelect,
      compact
        ? h('button', { type: 'button', class: 'gb-icon-btn gb-open-options', title: 'Open settings in a tab', onclick: () => ext.runtime.openOptionsPage() }, icon('interface', 18))
        : null,
      toggle
    );

    const permission = h(
      'div',
      { class: 'gb-notice', id: 'permission', hidden: true },
      'GBot needs access to gladiatus.gameforge.com to run. ',
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn',
          id: 'grant',
          onclick: async () => {
            await ext.permissions.request({ origins: GAME_ORIGINS });
            checkPermission();
          },
        },
        'Grant access'
      )
    );

    const view = GBot.ui.createSettingsUI({
      settings,
      memory,
      compact,
      onChange: async (next) => {
        settings = await S.saveSettings(next);
        render();
        return settings;
      },
      onResetStats: () =>
        editMemory((m) => {
          m.stats = GBot.brain.createMemory(Date.now()).stats;
          m.blockedUntil = {};
          m.noFoodUntil = 0;
        }),
      onClearLog: () =>
        editMemory((m) => {
          m.log = [];
        }),
    });

    document.body.append(header, permission, h('main', { class: 'gb-page-main' }, view.element));

    function render() {
      toggleLabel.textContent = settings.enabled ? 'Stop' : 'Start';
      toggleIcon.replaceChildren(icon(settings.enabled ? 'pause' : 'play', 14));
      toggle.classList.toggle('running', settings.enabled);
      const lastLog = memory && memory.log.length ? memory.log[memory.log.length - 1] : null;
      if (!host) subtitle.textContent = 'Open a Gladiatus game tab to start.';
      else subtitle.textContent = `${serverName(host)} · ${settings.enabled ? 'running' : 'paused'}${lastLog ? ` · ${lastLog.message}` : ''}`;
    }

    async function checkPermission() {
      try {
        permission.hidden = await ext.permissions.contains({ origins: GAME_ORIGINS });
      } catch (e) {
        permission.hidden = true;
      }
    }

    ext.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[S.STORAGE_KEY]) {
        settings = S.normalize(changes[S.STORAGE_KEY].newValue);
        view.update({ settings });
      }
      if (host && changes[memoryKey(host)]) {
        const value = changes[memoryKey(host)].newValue;
        memory = value ? GBot.brain.normalizeMemory(value, Date.now()) : null;
        view.update({ memory });
      }
      render();
    });

    render();
    checkPermission();
    return { view };
  }

  GBot.page = { mount };
})(typeof globalThis !== 'undefined' ? globalThis : this);
