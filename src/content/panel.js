// The in-game control bar: a start/stop button, one tile per activity (click
// to switch it on/off, gear to open its settings), the current status with a
// live countdown, and a settings window with every option. Lives in a shadow
// root so the game's CSS cannot affect it (and vice versa).
(function (root) {
  'use strict';
  const GBot = (root.GBot = root.GBot || {});
  const ui = GBot.ui;
  const { h, icon, countdown } = ui;

  const TILE_ORDER = ['expedition', 'dungeon', 'arena', 'circus', 'heal', 'work', 'quests'];
  const POS_KEY = 'gbot-panel-pos';
  const MIN_KEY = 'gbot-panel-min';

  const storage = {
    get(key) {
      try {
        return localStorage.getItem(key);
      } catch (e) {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch (e) {
        // Storage blocked: the panel just won't remember this.
      }
    },
  };

  const shortNumber = (n) => {
    const abs = Math.abs(n);
    if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (abs >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
    return n.toLocaleString();
  };

  function create(handlers) {
    const host = h('div', { id: 'gbot-root' });
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = ui.STYLES;
    const wrap = h('div', { class: 'gb-root' });
    shadow.append(style, wrap);

    let settings = null;
    let memory = null;
    let decision = null;
    let status = {};
    let modal = null;

    // ------------------------------------------------------------ header
    const playLabel = h('span', {}, 'Start');
    const playIcon = h('span', { class: 'gb-play-icon' }, icon('play', 14));
    const play = h('button', { type: 'button', class: 'gb-play', title: 'Start / stop the bot', onclick: () => handlers.onToggleBot() }, playIcon, playLabel);
    const minimize = h('button', { type: 'button', class: 'gb-icon-btn', title: 'Minimise', onclick: () => setMinimized(!panel.classList.contains('min')) }, icon('minimize', 16));
    const head = h(
      'div',
      { class: 'gb-panel-head' },
      h('span', { class: 'gb-brand' }, icon('arena', 16), 'GBot'),
      play,
      h('button', { type: 'button', class: 'gb-icon-btn', title: 'Check now', dataset: { action: 'run' }, onclick: () => handlers.onRunNow() }, icon('refresh', 16)),
      h('button', { type: 'button', class: 'gb-icon-btn', title: 'Settings', dataset: { action: 'settings' }, onclick: () => openSettings() }, icon('gear', 16)),
      minimize
    );

    // ------------------------------------------------------------ body
    const statusEl = h('div', { class: 'gb-status' }, 'Starting…');
    const nextEl = h('div', { class: 'gb-next' });
    const vitalsEl = h('div', { class: 'gb-vitals' });
    const tiles = new Map();
    const tileGrid = h('div', { class: 'gb-tiles' });
    for (const id of TILE_ORDER) {
      const meta = ui.ACTIVITIES[id];
      const sub = h('span', { class: 'gb-tile-sub' }, '–');
      const points = h('span', { class: 'gb-tile-points' });
      const button = h(
        'button',
        { type: 'button', class: 'gb-tile', dataset: { activity: id }, onclick: () => handlers.onToggleActivity(id) },
        icon(meta.icon, 20),
        h('span', { class: 'gb-tile-label' }, meta.label),
        points,
        sub
      );
      const gear = h(
        'button',
        { type: 'button', class: 'gb-tile-gear', title: `${meta.label} settings`, dataset: { settings: id }, onclick: () => openSettings(meta.tab) },
        icon('gear', 12)
      );
      tiles.set(id, { button, sub, points });
      tileGrid.appendChild(h('div', { class: 'gb-tile-wrap' }, button, gear));
    }
    tileGrid.appendChild(
      h(
        'div',
        { class: 'gb-tile-wrap' },
        h('button', { type: 'button', class: 'gb-tile on', dataset: { activity: 'settings' }, onclick: () => openSettings() }, icon('gear', 20), h('span', { class: 'gb-tile-label' }, 'Settings'), h('span', { class: 'gb-tile-sub' }, 'all options'))
      )
    );
    const lastLog = h('div', { class: 'gb-last-log' });
    const statsLine = h('span', { class: 'gb-stats-line' });
    const foot = h(
      'div',
      { class: 'gb-panel-foot' },
      statsLine,
      h('button', { type: 'button', class: 'gb-icon-btn', title: 'Statistics', onclick: () => openSettings('stats') }, icon('stats', 15)),
      h('button', { type: 'button', class: 'gb-icon-btn', title: 'Log', onclick: () => openSettings('log') }, icon('log', 15))
    );
    const body = h('div', { class: 'gb-body' }, h('div', { class: 'gb-summary' }, statusEl, nextEl), vitalsEl, tileGrid, lastLog, foot);
    const panel = h('div', { class: 'gb-panel', role: 'region', 'aria-label': 'GBot control bar' }, head, body);
    wrap.appendChild(panel);
    document.documentElement.appendChild(host);

    // --------------------------------------------------- position / drag
    function applyPosition(pos) {
      if (!pos) {
        Object.assign(panel.style, { top: '12px', right: '12px', left: 'auto' });
        return;
      }
      const maxX = Math.max(0, window.innerWidth - panel.offsetWidth);
      const maxY = Math.max(0, window.innerHeight - 40);
      Object.assign(panel.style, {
        left: `${Math.min(Math.max(0, pos.x), maxX)}px`,
        top: `${Math.min(Math.max(0, pos.y), maxY)}px`,
        right: 'auto',
      });
    }
    let savedPos = null;
    try {
      savedPos = JSON.parse(storage.get(POS_KEY) || 'null');
    } catch (e) {
      savedPos = null;
    }
    applyPosition(savedPos);

    head.addEventListener('mousedown', (e) => {
      if (panel.classList.contains('bar') || e.button !== 0 || e.target.closest('button')) return;
      const rect = panel.getBoundingClientRect();
      const dx = e.clientX - rect.left;
      const dy = e.clientY - rect.top;
      const move = (ev) => applyPosition({ x: ev.clientX - dx, y: ev.clientY - dy });
      const up = () => {
        document.removeEventListener('mousemove', move, true);
        document.removeEventListener('mouseup', up, true);
        const r = panel.getBoundingClientRect();
        savedPos = { x: Math.round(r.left), y: Math.round(r.top) };
        storage.set(POS_KEY, JSON.stringify(savedPos));
      };
      document.addEventListener('mousemove', move, true);
      document.addEventListener('mouseup', up, true);
      e.preventDefault();
    });
    window.addEventListener('resize', () => !panel.classList.contains('bar') && savedPos && applyPosition(savedPos));

    // The docked bar pushes the game down instead of covering its header.
    // Gameforge's strip (#mmonetbar: country, "More Games") is absolutely
    // positioned at the very top, so it is moved down by the same amount.
    const originalPadding = document.documentElement.style.paddingTop;
    function updatePageOffset() {
      const docked = panel.classList.contains('bar') && panel.style.display !== 'none';
      const padding = docked ? `${panel.offsetHeight}px` : originalPadding;
      if (document.documentElement.style.paddingTop !== padding) document.documentElement.style.paddingTop = padding;
      const netbar = document.getElementById('mmonetbar');
      const top = docked ? `${panel.offsetHeight}px` : '';
      if (netbar && netbar.style.top !== top) netbar.style.top = top;
    }
    // The bar's height changes when its tiles wrap (narrow windows). Resize
    // observers do not run in background tabs, hence also the 1 s timer below.
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(updatePageOffset).observe(panel);

    function setMinimized(min) {
      panel.classList.toggle('min', min);
      minimize.title = min ? 'Expand' : 'Minimise';
      minimize.replaceChildren(icon(min ? 'expand' : 'minimize', 16));
      storage.set(MIN_KEY, min ? '1' : '0');
      updatePageOffset();
    }
    setMinimized(storage.get(MIN_KEY) === '1');

    // ------------------------------------------------------------ render
    function renderTiles() {
      const now = Date.now();
      for (const [id, tile] of tiles) {
        const s = status[id] || {};
        const on = settings ? !!GBot.settings.getPath(settings, ui.ACTIVITIES[id].path) : false;
        // A cooldown can run out while the bot is stopped (no new status).
        const due = !!s.until && s.until <= now && (s.text === 'cooldown' || s.text === 'next');
        tile.button.classList.toggle('on', on);
        tile.button.classList.toggle('ready', !!s.ready || due);
        tile.button.classList.toggle('warn', !!s.warn);
        tile.button.classList.toggle('nopoints', s.text === 'no points');
        tile.button.setAttribute('aria-pressed', on ? 'true' : 'false');
        let text = due ? 'ready' : s.text || (on ? '…' : 'off');
        if (s.until && s.until > now) text = s.text === 'cooldown' || s.text === 'next' ? countdown(s.until, now) : `${s.text} ${countdown(s.until, now)}`;
        tile.sub.textContent = text;
        tile.points.textContent = s.points && on ? s.points : '';
        tile.button.title = `${ui.ACTIVITIES[id].label}: ${on ? 'on' : 'off'}${on ? ` (${text}${s.points ? `, ${s.points} points` : ''})` : ''}. Click to switch ${on ? 'off' : 'on'}.`;
      }
    }

    function renderStatus() {
      if (!decision) return;
      statusEl.textContent = decision.type === 'wait' || decision.type === 'idle' ? decision.reason : `Now: ${decision.reason}`;
      nextEl.textContent = '';
      if (decision.type === 'wait' && decision.next) {
        nextEl.append('Next: ', h('b', {}, decision.next.label), ` in ${countdown(decision.until)}`);
      } else if (decision.type === 'idle') {
        nextEl.textContent = settings && settings.enabled ? '' : 'Press Start to play.';
      } else {
        nextEl.textContent = 'Working…';
      }
    }

    function renderVitals(state) {
      if (!state || !state.inGame) return;
      const pts = (p) => (p && p.points !== null && p.points !== undefined ? `${p.points}/${p.maxPoints ?? '?'}` : '?');
      const parts = [`HP ${state.hp.percent ?? '?'}%`, `Exp ${pts(state.expedition)}`, `Dung ${pts(state.dungeon)}`];
      if (state.gold !== null) parts.push(`${state.gold.toLocaleString()} gold`);
      vitalsEl.textContent = parts.join(' · ');
    }

    function renderStats() {
      if (!memory) return;
      const s = memory.stats;
      const parts = [`Exp ${s.expedition}`, `Dung ${s.dungeon}`, `Arena ${s.arena}`, `Circus ${s.circus}`];
      if (s.goldStart !== null && s.goldNow !== null && s.goldNow !== s.goldStart) {
        const diff = s.goldNow - s.goldStart;
        parts.push(`${diff >= 0 ? '+' : ''}${shortNumber(diff)} gold`);
      }
      statsLine.textContent = parts.join(' · ');
      const last = memory.log[memory.log.length - 1];
      lastLog.className = `gb-last-log ${last ? last.level : ''}`;
      lastLog.textContent = last ? `${new Date(last.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ${last.message}` : '';
    }

    setInterval(() => {
      renderTiles();
      if (decision && decision.type === 'wait') renderStatus();
      updatePageOffset();
    }, 1000);

    function update(next) {
      if (next.settings) {
        settings = next.settings;
        const running = settings.enabled;
        play.classList.toggle('running', running);
        playLabel.textContent = running ? 'Stop' : 'Start';
        playIcon.replaceChildren(icon(running ? 'pause' : 'play', 14));
        // Hide only the bar: an open settings window stays usable.
        panel.style.display = settings.ui.panel ? '' : 'none';
        panel.classList.toggle('bar', settings.ui.layout === 'bar');
        // Docked: drop the floating position (its "right: auto" would
        // shrink the bar to its content).
        if (settings.ui.layout === 'bar') Object.assign(panel.style, { left: '', top: '', right: '' });
        else applyPosition(savedPos);
        updatePageOffset();
      }
      if (next.memory) memory = next.memory;
      if (next.decision) decision = next.decision;
      if (next.status) status = next.status;
      if (next.state) renderVitals(next.state);
      renderTiles();
      renderStatus();
      renderStats();
      if (modal) modal.view.update({ settings: next.settings, memory: next.memory });
    }

    // ---------------------------------------------------- settings window
    function openSettings(tab) {
      if (modal) {
        if (tab) modal.view.showTab(tab);
        return;
      }
      const view = ui.createSettingsUI({
        settings,
        memory,
        initialTab: tab,
        onChange: (s) => handlers.onSaveSettings(s),
        onResetStats: () => handlers.onResetStats(),
        onClearLog: () => handlers.onClearLog(),
        host: handlers.host,
        listServers: handlers.listServers,
        loadServerSettings: handlers.loadServerSettings,
      });
      const close = () => {
        backdrop.remove();
        document.removeEventListener('keydown', onKey, true);
        modal = null;
      };
      const onKey = (e) => {
        if (e.key === 'Escape') close();
      };
      const dialog = h(
        'div',
        { class: 'gb-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'GBot settings' },
        h(
          'div',
          { class: 'gb-modal-head' },
          icon('arena', 18),
          h('span', { class: 'gb-title' }, handlers.host ? `GBot settings · ${GBot.settings.serverName(handlers.host)}` : 'GBot settings'),
          h('button', { type: 'button', class: 'gb-icon-btn', title: 'Close (Esc)', dataset: { action: 'close' }, onclick: close }, icon('close', 18))
        ),
        h('div', { class: 'gb-modal-body' }, view.element)
      );
      // Keep typing inside the window from reaching the game's key handlers.
      dialog.addEventListener('keydown', (e) => e.stopPropagation());
      const backdrop = h('div', { class: 'gb-backdrop', onclick: (e) => e.target === backdrop && close() }, dialog);
      wrap.appendChild(backdrop);
      document.addEventListener('keydown', onKey, true);
      modal = { view, close };
    }

    return { update, openSettings, host };
  }

  GBot.panel = { create };
})(typeof globalThis !== 'undefined' ? globalThis : this);
