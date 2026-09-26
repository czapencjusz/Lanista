// Small status panel injected into the game page (inside a shadow root so the
// game's CSS cannot affect it).
(function (root) {
  'use strict';
  const GBot = (root.GBot = root.GBot || {});

  const STYLE = `
    :host { all: initial; }
    .panel {
      position: fixed; right: 12px; bottom: 12px; z-index: 2147483647;
      width: 290px; font: 12px/1.4 system-ui, -apple-system, Segoe UI, sans-serif;
      color: #f3e9d2; background: rgba(28, 18, 12, 0.94);
      border: 1px solid #a8822c; border-radius: 8px; box-shadow: 0 4px 18px rgba(0,0,0,.5);
      overflow: hidden;
    }
    .head { display: flex; align-items: center; gap: 8px; padding: 6px 8px; background: #5a1414; cursor: pointer; user-select: none; }
    .title { font-weight: 700; letter-spacing: .5px; flex: 1; }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: #777; }
    .dot.on { background: #4cd964; box-shadow: 0 0 6px #4cd964; }
    .body { padding: 8px; display: grid; gap: 6px; }
    .collapsed .body { display: none; }
    .row { display: flex; justify-content: space-between; gap: 8px; }
    .muted { color: #bfae8a; }
    .status { font-weight: 600; }
    .buttons { display: flex; gap: 6px; }
    button {
      flex: 1; padding: 5px 6px; border: 1px solid #a8822c; border-radius: 5px;
      background: #3b2717; color: #f3e9d2; font: inherit; cursor: pointer;
    }
    button:hover { background: #50341e; }
    button.primary { background: #7a5a16; }
    button.primary.on { background: #6b1b1b; }
    .log { max-height: 120px; overflow-y: auto; border-top: 1px solid #4a3522; padding-top: 4px; }
    .log div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .log .warn { color: #f0c05a; }
    .log .error { color: #ff7a6b; }
    .log .debug { color: #9c8f75; }
  `;

  function create({ onToggle, onRunNow }) {
    const host = document.createElement('div');
    host.id = 'gbot-overlay';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>${STYLE}</style>
      <div class="panel">
        <div class="head" part="head">
          <span class="dot"></span><span class="title">GBot</span><span class="muted summary"></span>
        </div>
        <div class="body">
          <div class="status">Starting...</div>
          <div class="row"><span class="muted">Next check</span><span class="next">-</span></div>
          <div class="row"><span class="muted">HP / Exp. / Dung.</span><span class="vitals">-</span></div>
          <div class="row muted stats"></div>
          <div class="buttons">
            <button class="primary toggle">Start</button>
            <button class="run">Check now</button>
          </div>
          <div class="log"></div>
        </div>
      </div>`;
    document.documentElement.appendChild(host);

    const q = (s) => shadow.querySelector(s);
    const panel = q('.panel');
    let collapsed = false;
    try {
      collapsed = localStorage.getItem('gbot-overlay-collapsed') === '1';
    } catch (e) {
      collapsed = false;
    }
    panel.classList.toggle('collapsed', collapsed);
    q('.head').addEventListener('click', () => {
      collapsed = !collapsed;
      panel.classList.toggle('collapsed', collapsed);
      try {
        localStorage.setItem('gbot-overlay-collapsed', collapsed ? '1' : '0');
      } catch (e) {
        // Storage unavailable; the panel just won't remember its state.
      }
    });
    q('.toggle').addEventListener('click', () => onToggle());
    q('.run').addEventListener('click', () => onRunNow());

    let nextAt = null;
    setInterval(() => {
      q('.next').textContent = nextAt ? GBot.util.formatDuration(nextAt - Date.now()) : '-';
    }, 1000);

    function update({ settings, memory, decision, state }) {
      if (settings) {
        q('.dot').classList.toggle('on', settings.enabled);
        const toggle = q('.toggle');
        toggle.textContent = settings.enabled ? 'Stop' : 'Start';
        toggle.classList.toggle('on', settings.enabled);
        q('.summary').textContent = settings.enabled ? 'running' : 'paused';
      }
      if (decision) {
        q('.status').textContent = decision.reason || decision.type;
        nextAt = decision.type === 'wait' ? decision.until : null;
        q('.next').textContent = nextAt ? GBot.util.formatDuration(nextAt - Date.now()) : decision.type === 'idle' ? '-' : 'now';
      }
      if (state && state.inGame) {
        const fmt = (p) => (p && p.points !== null && p.points !== undefined ? `${p.points}/${p.maxPoints ?? '?'}` : '?');
        q('.vitals').textContent = `${state.hp.percent ?? '?'}% / ${fmt(state.expedition)} / ${fmt(state.dungeon)}`;
      }
      if (memory) {
        const s = memory.stats;
        q('.stats').textContent = `Exp ${s.expedition} · Dung ${s.dungeon} · Arena ${s.arena} · Circus ${s.circus} · Heal ${s.heal}`;
        renderLog(memory.log);
      }
    }

    function renderLog(entries) {
      const box = q('.log');
      box.textContent = '';
      for (const e of entries.slice(-30).reverse()) {
        const line = document.createElement('div');
        line.className = e.level;
        const time = new Date(e.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        line.textContent = `${time} ${e.message}`;
        line.title = line.textContent;
        box.appendChild(line);
      }
    }

    return { update, renderLog };
  }

  GBot.overlay = { create };
})(typeof globalThis !== 'undefined' ? globalThis : this);
