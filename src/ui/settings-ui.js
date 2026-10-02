// Renders the tabbed settings window described by schema.js. The same
// component is used in three places: the in-game settings window (inside a
// shadow root), the toolbar popup (compact: icon-only tabs) and the options
// page.
//
//   const view = GBot.ui.createSettingsUI({
//     settings, memory, compact, initialTab,
//     onChange: async (settings) => savedSettings,  // persist
//     onResetStats: async () => {}, onClearLog: async () => {},
//     // optional, for "Copy from another server":
//     host: 'sNN-xx...' or () => host, listServers: async () => [host],
//     loadServerSettings: async (host) => settings,
//   });
//   container.appendChild(view.element);
//   view.update({ settings, memory });  // push external changes in
(function (root) {
  'use strict';
  const GBot = (root.GBot = root.GBot || {});
  const ui = (GBot.ui = GBot.ui || {});
  const { h, icon } = ui;
  const S = GBot.settings;

  const clone = (v) => JSON.parse(JSON.stringify(v));
  const isFocused = (el) => {
    try {
      return el.matches(':focus');
    } catch (e) {
      return false;
    }
  };

  function createSettingsUI(opts) {
    const view = {
      settings: S.sanitizeSettings(opts.settings || {}),
      memory: opts.memory || null,
      tab: ui.TABS.some((t) => t.id === opts.initialTab) ? opts.initialTab : 'overview',
    };

    const nav = h('nav', { class: 'gb-tabs', role: 'tablist', 'aria-label': 'Settings sections' });
    const pane = h('section', { class: 'gb-pane', role: 'tabpanel' });
    const element = h('div', { class: `gb-settings${opts.compact ? ' gb-compact' : ''}` }, nav, pane);

    // The on/off path a tab's dot shows: its header switch, or another one.
    const onPath = (tab) => tab.enable || tab.toggle || null;

    const tabButtons = new Map();
    let group = null;
    for (const tab of ui.TABS) {
      if (tab.group && tab.group !== group) nav.appendChild(h('div', { class: 'gb-tab-group', role: 'presentation' }, tab.group));
      group = tab.group;
      const button = h(
        'button',
        { type: 'button', class: 'gb-tab', role: 'tab', title: tab.title, dataset: { tab: tab.id }, onclick: () => showTab(tab.id) },
        icon(tab.icon, 16),
        h('span', { class: 'gb-tab-label' }, tab.title),
        onPath(tab) ? h('span', { class: 'gb-dot', 'aria-hidden': 'true' }) : null
      );
      tabButtons.set(tab.id, button);
      nav.appendChild(button);
    }

    // Controls of the visible tab: each knows how to refresh itself.
    let syncers = [];
    let savedLabel = null;
    let savedTimer = null;

    const get = (path) => S.getPath(view.settings, path);
    // The server whose settings are shown (the popup can switch servers).
    const currentHost = () => (typeof opts.host === 'function' ? opts.host() : opts.host) || null;

    function flash(text, isError) {
      if (!savedLabel) return;
      savedLabel.textContent = text;
      savedLabel.classList.toggle('error', !!isError);
      savedLabel.classList.add('show');
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => savedLabel && savedLabel.classList.remove('show'), 1600);
    }

    async function save(next) {
      view.settings = S.sanitizeSettings(next);
      sync();
      try {
        const saved = await opts.onChange(view.settings);
        if (saved) view.settings = saved;
        sync();
        flash('Saved');
      } catch (e) {
        flash(`Could not save: ${e && e.message ? e.message : e}`, true);
      }
    }

    const commit = (path, value) => save(S.setPath(clone(view.settings), path, value));

    // ------------------------------------------------------------- controls

    function limits(path, base = 0) {
      const rule = S.CONSTRAINTS[path] || {};
      return {
        min: rule.min !== undefined ? rule.min + base : undefined,
        max: rule.max !== undefined ? rule.max + base : undefined,
      };
    }

    function switchControl(path, label, onToggle) {
      const input = h('input', {
        type: 'checkbox',
        'aria-label': label,
        dataset: { path },
        onchange: () => (onToggle ? onToggle(input.checked) : commit(path, input.checked)),
      });
      const el = h('label', { class: 'gb-switch' }, input, h('span', { class: 'gb-slider' }));
      return { el, input, sync: () => (input.checked = !!get(path)) };
    }

    const renderers = {
      toggle(field) {
        const control = switchControl(field.path, field.label);
        return { control: control.el, inputs: [control.input], sync: control.sync };
      },

      number(field) {
        const base = field.base || 0;
        const { min, max } = limits(field.path, base);
        const input = h('input', {
          type: 'number',
          class: 'gb-input gb-number',
          min,
          max,
          step: field.step || 1,
          'aria-label': field.label,
          dataset: { path: field.path },
          onchange: () => {
            const n = Number(input.value);
            if (input.value === '' || !Number.isFinite(n)) return sync();
            commit(field.path, n - base);
          },
        });
        const control = h('span', { class: 'gb-inline' }, input, field.unit ? h('span', { class: 'gb-unit' }, field.unit) : null);
        return {
          control,
          inputs: [input],
          sync: () => {
            if (!isFocused(input)) input.value = String(get(field.path) + base);
          },
        };
      },

      select(field) {
        const select = h(
          'select',
          {
            class: 'gb-input gb-select',
            'aria-label': field.label,
            dataset: { path: field.path },
            onchange: () => {
              const option = field.options[select.selectedIndex];
              commit(field.path, option.value);
            },
          },
          field.options.map((o) => h('option', { value: String(o.value) }, o.label))
        );
        return { control: select, inputs: [select], sync: () => (select.value = String(get(field.path))) };
      },

      time(field) {
        const input = h('input', {
          type: 'time',
          class: 'gb-input gb-time',
          'aria-label': field.label,
          dataset: { path: field.path },
          onchange: () => input.value && commit(field.path, input.value),
        });
        return {
          control: input,
          inputs: [input],
          sync: () => {
            if (!isFocused(input)) input.value = get(field.path);
          },
        };
      },

      text(field) {
        const input = h('input', {
          type: 'text',
          class: 'gb-input',
          placeholder: field.placeholder,
          'aria-label': field.label,
          dataset: { path: field.path },
          onchange: () => commit(field.path, input.value),
        });
        return {
          control: input,
          inputs: [input],
          sync: () => {
            if (!isFocused(input)) input.value = get(field.path);
          },
        };
      },

      textarea(field) {
        const input = h('textarea', {
          class: 'gb-input gb-textarea',
          rows: 4,
          placeholder: field.placeholder,
          'aria-label': field.label,
          dataset: { path: field.path },
          onchange: () => commit(field.path, input.value),
        });
        return {
          control: input,
          inputs: [input],
          stack: true,
          sync: () => {
            if (!isFocused(input)) input.value = get(field.path);
          },
        };
      },

      // Location: "last visited" (auto), one of the locations read from the
      // game menu, or any location id typed in.
      location(field) {
        const select = h('select', { class: 'gb-input gb-select', 'aria-label': field.label, dataset: { path: field.path } });
        const custom = h('input', {
          type: 'number',
          class: 'gb-input gb-number',
          min: 1,
          max: 9999,
          placeholder: 'id',
          'aria-label': `${field.label} id`,
          dataset: { path: `${field.path}#custom` },
          onchange: () => {
            const n = parseInt(custom.value, 10);
            if (Number.isFinite(n) && n > 0) commit(field.path, String(n));
          },
        });
        let knownKey = null;
        let showCustom = false;

        const known = () => (view.memory && view.memory.gameInfo && view.memory.gameInfo.locations) || [];

        function buildOptions() {
          const list = known();
          const key = JSON.stringify(list);
          if (key === knownKey) return;
          knownKey = key;
          select.textContent = '';
          select.appendChild(h('option', { value: 'auto' }, 'Last visited (auto)'));
          for (const l of list) select.appendChild(h('option', { value: l.id }, `${l.name} (#${l.id})`));
          select.appendChild(h('option', { value: 'custom' }, 'Other location id…'));
        }

        select.addEventListener('change', () => {
          if (select.value === 'custom') {
            showCustom = true;
            custom.hidden = false;
            custom.focus();
          } else {
            showCustom = false;
            commit(field.path, select.value);
          }
        });

        return {
          control: h('span', { class: 'gb-inline' }, select, custom),
          inputs: [select, custom],
          sync: () => {
            buildOptions();
            const value = get(field.path);
            const listed = value === 'auto' || known().some((l) => l.id === value);
            const useCustom = showCustom || !listed;
            select.value = useCustom ? 'custom' : value;
            custom.hidden = !useCustom;
            if (useCustom && !isFocused(custom) && value !== 'auto') custom.value = value;
          },
        };
      },

      // Priority list with up/down buttons.
      order(field) {
        const list = h('ol', { class: 'gb-order', dataset: { path: field.path } });
        const move = (index, delta) => {
          const order = get(field.path).slice();
          const target = index + delta;
          if (target < 0 || target >= order.length) return;
          [order[index], order[target]] = [order[target], order[index]];
          commit(field.path, order);
        };
        return {
          control: list,
          inputs: [],
          stack: true,
          sync: () => {
            const order = get(field.path);
            list.textContent = '';
            order.forEach((id, i) => {
              const meta = ui.ACTIVITIES[id];
              const on = !!get(meta.path);
              list.appendChild(
                h(
                  'li',
                  { dataset: { item: id }, class: on ? 'on' : '' },
                  h('span', { class: 'gb-order-num' }, String(i + 1)),
                  icon(meta.icon, 16),
                  h('span', { class: 'gb-order-label' }, meta.label),
                  h('span', { class: 'gb-order-state' }, on ? 'on' : 'off'),
                  h('button', { type: 'button', class: 'gb-icon-btn', title: `Move ${meta.label} up`, disabled: i === 0, onclick: () => move(i, -1) }, icon('up', 16)),
                  h('button', { type: 'button', class: 'gb-icon-btn', title: `Move ${meta.label} down`, disabled: i === order.length - 1, onclick: () => move(i, 1) }, icon('down', 16))
                )
              );
            });
          },
        };
      },

      // Address for phone alerts, with a button that sends a test message.
      push(field) {
        const input = h('input', {
          type: 'url',
          class: 'gb-input gb-input-wide',
          placeholder: field.placeholder,
          spellcheck: 'false',
          'aria-label': field.label,
          dataset: { path: field.path },
          onchange: () => commit(field.path, input.value.trim()),
        });
        const status = h('div', { class: 'gb-help gb-push-status', role: 'status' });
        const test = h(
          'button',
          {
            type: 'button',
            class: 'gb-btn',
            onclick: async () => {
              const url = input.value.trim();
              if (!/^https:\/\//i.test(url)) {
                status.textContent = 'Enter an https:// address first.';
                return;
              }
              status.textContent = 'Sending…';
              let result;
              try {
                result = await opts.onTestPush(url);
              } catch (e) {
                result = { ok: false, error: e && e.message ? e.message : String(e) };
              }
              status.textContent =
                result && result.ok ? 'Sent. If nothing arrives, check the address.' : `Could not send: ${(result && result.error) || 'Lanista did not answer (reload the page?)'}`;
            },
          },
          'Send a test'
        );
        return {
          control: h('div', {}, h('span', { class: 'gb-inline gb-push' }, input, opts.onTestPush ? test : null), status),
          inputs: [input, test],
          stack: true,
          sync: () => {
            if (!isFocused(input)) input.value = get(field.path);
          },
        };
      },

      checks(field) {
        const controls = field.items.map((item) => ({ item, control: switchControl(item.path, item.label) }));
        const grid = h(
          'div',
          { class: 'gb-checks' },
          controls.map(({ item, control }) => h('label', { class: 'gb-check' }, control.el.firstChild, h('span', {}, item.label)))
        );
        // Checkboxes in a grid read better than switches here.
        for (const { control } of controls) control.input.classList.add('gb-checkbox');
        return {
          control: grid,
          inputs: controls.map((c) => c.control.input),
          stack: true,
          sync: () => controls.forEach(({ control }) => control.sync()),
        };
      },
    };

    function renderField(field) {
      const r = renderers[field.type](field);
      const row = h(
        'div',
        { class: `gb-field${r.stack ? ' stack' : ''}`, dataset: { field: field.path } },
        h('div', { class: 'gb-label' }, field.label),
        h('div', { class: 'gb-control' }, r.control),
        field.help ? h('div', { class: 'gb-help' }, field.help) : null
      );
      syncers.push(() => {
        r.sync();
        const enabled = !field.dependsOn || !!get(field.dependsOn);
        row.classList.toggle('disabled', !enabled);
        for (const input of r.inputs) input.disabled = !enabled;
      });
      return row;
    }

    // -------------------------------------------------------- custom tabs

    const formatNumber = (n) => (n === null || n === undefined ? '–' : Number(n).toLocaleString());

    // "Today", "Yesterday", or "Mon 28 Sep" for a day key (YYYY-MM-DD).
    function dayLabel(day) {
      const [y, m, d] = day.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const ago = Math.round((today - date) / 86400000);
      if (ago === 0) return 'Today';
      if (ago === 1) return 'Yesterday';
      return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    }

    // One row per day: fights and how many were won, what came in and what
    // was spent.
    function daysTable(days) {
      const fightTypes = ['expedition', 'dungeon', 'arena', 'circus'];
      const n = (v) => (typeof v === 'number' ? v : 0);
      const rows = days.map((d) => {
        const fights = fightTypes.reduce((sum, t) => sum + n(d[t]), 0);
        const results = d.results || {};
        const won = fightTypes.reduce((sum, t) => sum + n(results[t] && results[t].won), 0);
        const lost = fightTypes.reduce((sum, t) => sum + n(results[t] && results[t].lost), 0);
        const loot = d.loot || {};
        const gold = n(loot.gold) + n(d.soldGold) + n(d.goldCollected);
        return h(
          'tr',
          { dataset: { day: d.day } },
          h('th', { scope: 'row' }, dayLabel(d.day)),
          h('td', {}, formatNumber(fights)),
          h('td', {}, won + lost ? `${Math.round((100 * won) / (won + lost))}%` : '–'),
          h('td', {}, formatNumber(gold)),
          h('td', {}, formatNumber(n(loot.xp))),
          h('td', {}, formatNumber(n(loot.honour))),
          h('td', {}, formatNumber(n(loot.fame))),
          h('td', {}, formatNumber(n(d.goldSpent)))
        );
      });
      const head = ['Day', 'Fights', 'Won', 'Gold in', 'XP', 'Honour', 'Fame', 'Gold spent'].map((t) => h('th', { scope: 'col' }, t));
      return h('div', { class: 'gb-table-wrap' }, h('table', { class: 'gb-table gb-days' }, h('thead', {}, h('tr', {}, head)), h('tbody', {}, rows)));
    }

    // Every feature on one page: its switch and a line about its settings;
    // the name opens its tab.
    function overviewPane() {
      const master = switchControl('enabled', 'Lanista is running');
      master.el.classList.add('gb-switch-lg');
      const state = h('span', { class: 'gb-overview-state' });
      syncers.push(() => {
        master.sync();
        state.textContent = get('enabled') ? 'Running' : 'Paused';
        state.classList.toggle('on', !!get('enabled'));
      });
      const out = [h('div', { class: 'gb-overview-master' }, h('span', { class: 'gb-label' }, 'Lanista'), state, master.el)];
      let grid = null;
      let group = null;
      for (const tab of ui.TABS) {
        if (!tab.summary) continue;
        if (!grid || tab.group !== group) {
          group = tab.group;
          grid = h('div', { class: 'gb-overview-grid' });
          out.push(h('h3', {}, group), grid);
        }
        const path = onPath(tab);
        const control = path ? switchControl(path, `${tab.title} on or off`) : null;
        const summary = h('div', { class: 'gb-overview-sum' });
        const card = h(
          'div',
          { class: 'gb-overview-card', dataset: { card: tab.id } },
          h(
            'div',
            { class: 'gb-overview-card-head' },
            h('button', { type: 'button', class: 'gb-overview-open', title: `${tab.title} settings`, onclick: () => showTab(tab.id) }, icon(tab.icon, 16), h('span', {}, tab.title)),
            control ? control.el : null
          ),
          summary
        );
        syncers.push(() => {
          if (control) control.sync();
          card.classList.toggle('off', !!path && !get(path));
          summary.textContent = tab.summary(view.settings, view.memory && view.memory.gameInfo);
        });
        grid.appendChild(card);
      }
      return out;
    }

    function statsPane() {
      const cards = h('div', { class: 'gb-cards' });
      const daysBox = h('div', {});
      const since = h('p', { class: 'gb-desc' });
      const reset = h('button', { type: 'button', class: 'gb-btn', onclick: () => confirmThen(reset, 'Reset statistics', opts.onResetStats) }, 'Reset statistics');
      syncers.push(() => {
        const stats = (view.memory && view.memory.stats) || null;
        cards.textContent = '';
        daysBox.textContent = '';
        if (!stats) {
          since.textContent = 'No data yet. Open a game tab with the bot running.';
          return;
        }
        const days = GBot.brain && GBot.brain.statsDays ? GBot.brain.statsDays(view.memory) : [];
        if (days.length) {
          daysBox.appendChild(h('h3', {}, 'Per day'));
          daysBox.appendChild(daysTable(days));
          daysBox.appendChild(h('p', { class: 'gb-help' }, 'Gold in: looted, sold and taken from gold packages. Gold spent: training, repairs, smelting, auction bids and food. The last 30 days are kept.'));
        }
        const hours = Math.max((Date.now() - stats.since) / 3600000, 1 / 60);
        const card = (label, value, sub) =>
          h('div', { class: 'gb-card' }, h('div', { class: 'gb-card-value' }, value), h('div', { class: 'gb-card-label' }, label), sub ? h('div', { class: 'gb-card-sub' }, sub) : null);
        const rate = (n) => `${(n / hours).toFixed(1)} / hour`;
        for (const [key, label] of [
          ['expedition', 'Expeditions'],
          ['dungeon', 'Dungeon fights'],
          ['arena', 'Arena fights'],
          ['circus', 'Circus fights'],
          ['heal', 'Meals eaten'],
          ['nest', 'Nests searched'],
          ['training', 'Stats trained'],
          ['repairs', 'Items repaired'],
          ['smelted', 'Items smelted'],
          ['sold', 'Items sold'],
          ['foodBought', 'Food bought'],
          ['auctionBids', 'Auction bids'],
          ['quests', 'Quests finished'],
          ['work', 'Work shifts'],
        ]) {
          const r = stats.results && stats.results[key];
          const record = r && r.won + r.lost ? ` · ${r.won}W ${r.lost}L (${Math.round((100 * r.won) / (r.won + r.lost))}%)` : '';
          cards.appendChild(card(label, formatNumber(stats[key] || 0), rate(stats[key] || 0) + record));
        }
        const loot = stats.loot;
        if (loot && (loot.gold || loot.xp || loot.honour || loot.fame)) {
          cards.appendChild(card('Gold looted', formatNumber(loot.gold), rate(loot.gold)));
          cards.appendChild(card('Experience', formatNumber(loot.xp), rate(loot.xp)));
          cards.appendChild(card('Honour', formatNumber(loot.honour || 0), rate(loot.honour || 0)));
          cards.appendChild(card('Fame', formatNumber(loot.fame || 0), rate(loot.fame || 0)));
        }
        if (stats.soldGold) cards.appendChild(card('Gold from sales', formatNumber(stats.soldGold), rate(stats.soldGold)));
        if (stats.goldCollected) cards.appendChild(card('Gold from packages', formatNumber(stats.goldCollected), rate(stats.goldCollected)));
        if (stats.goldStart !== null && stats.goldNow !== null) {
          const diff = stats.goldNow - stats.goldStart;
          cards.appendChild(card('Gold change', `${diff >= 0 ? '+' : ''}${formatNumber(diff)}`, `now ${formatNumber(stats.goldNow)}`));
        }
        since.textContent = `Since ${new Date(stats.since).toLocaleString()}.`;
      });
      return [since, cards, daysBox, h('div', { class: 'gb-actions' }, reset)];
    }

    function logPane() {
      const filter = h(
        'select',
        { class: 'gb-input gb-select', 'aria-label': 'Log level', onchange: () => sync() },
        h('option', { value: 'all' }, 'Everything'),
        h('option', { value: 'warn' }, 'Warnings and errors')
      );
      const list = h('div', { class: 'gb-log' });
      const clear = h('button', { type: 'button', class: 'gb-btn', onclick: () => confirmThen(clear, 'Clear log', opts.onClearLog) }, 'Clear log');
      const status = h('span', { class: 'gb-help gb-copy-status', role: 'status' });
      const shown = () => ((view.memory && view.memory.log) || []).filter((e) => filter.value === 'all' || e.level === 'warn' || e.level === 'error');

      // The lines shown, oldest first, as text: for a bug report or a chat.
      async function copyLog() {
        const text = ui.logText(shown());
        let copied = false;
        try {
          await navigator.clipboard.writeText(text);
          copied = true;
        } catch (e) {
          // No clipboard access here: copy through a selected text field.
          const area = h('textarea', { class: 'gb-offscreen', 'aria-hidden': 'true' });
          area.value = text;
          element.appendChild(area);
          area.select();
          try {
            copied = document.execCommand('copy');
          } catch (e2) {
            copied = false;
          }
          area.remove();
        }
        status.textContent = copied ? `Copied ${shown().length} lines.` : 'Could not reach the clipboard.';
        setTimeout(() => (status.textContent = ''), 4000);
      }
      const copy = h('button', { type: 'button', class: 'gb-btn', onclick: copyLog }, 'Copy log');

      syncers.push(() => {
        const entries = shown();
        list.textContent = '';
        if (!entries.length) list.appendChild(h('div', { class: 'gb-empty' }, 'Nothing logged yet.'));
        for (const e of entries.slice().reverse()) {
          const time = new Date(e.t).toLocaleTimeString();
          list.appendChild(h('div', { class: `gb-log-line ${e.level}` }, h('span', { class: 'gb-log-time' }, time), ' ', e.message));
        }
      });
      const report = ui.reportLink({ log: () => (view.memory && view.memory.log) || [] });
      return [h('div', { class: 'gb-actions' }, filter, copy, clear, report, status), list];
    }

    function profilePane() {
      const status = h('p', { class: 'gb-help gb-import-status', role: 'status' });
      const text = h('textarea', { class: 'gb-input gb-textarea gb-mono', rows: 8, placeholder: 'Paste exported settings here, or choose a file', 'aria-label': 'Settings JSON' });
      const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });

      const exportJson = () => JSON.stringify({ ...view.settings, enabled: false }, null, 2);

      function download() {
        const blob = new Blob([exportJson()], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = h('a', { href: url, download: `lanista-settings-${new Date().toISOString().slice(0, 10)}.json` });
        element.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        status.textContent = 'Settings file downloaded.';
      }

      async function copy() {
        text.value = exportJson();
        text.select();
        try {
          await navigator.clipboard.writeText(text.value);
          status.textContent = 'Copied to the clipboard.';
        } catch (e) {
          status.textContent = 'Settings shown above: copy them with Ctrl+C.';
        }
      }

      function importText(raw) {
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (e) {
          status.textContent = `That is not valid JSON: ${e.message}`;
          status.classList.add('error');
          return;
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          status.textContent = 'That does not look like Lanista settings.';
          status.classList.add('error');
          return;
        }
        // Importing never starts the bot by itself.
        save({ ...S.normalize(parsed), enabled: view.settings.enabled });
        status.classList.remove('error');
        status.textContent = 'Settings imported.';
      }

      file.addEventListener('change', async () => {
        const f = file.files && file.files[0];
        if (f) importText(await f.text());
        file.value = '';
      });

      const reset = h(
        'button',
        {
          type: 'button',
          class: 'gb-btn danger',
          onclick: () =>
            confirmThen(reset, 'Reset all settings', () => {
              save({ ...S.DEFAULT_SETTINGS, enabled: view.settings.enabled });
              status.textContent = 'All settings reset to their defaults.';
            }),
        },
        'Reset all settings'
      );

      return [
        ...copyFromServer(status),
        h('h3', {}, 'Export'),
        h(
          'div',
          { class: 'gb-actions' },
          h('button', { type: 'button', class: 'gb-btn', onclick: download }, 'Download settings file'),
          h('button', { type: 'button', class: 'gb-btn', onclick: copy }, 'Copy to clipboard')
        ),
        h('h3', {}, 'Import'),
        text,
        h(
          'div',
          { class: 'gb-actions' },
          h('button', { type: 'button', class: 'gb-btn primary', onclick: () => importText(text.value) }, 'Import pasted settings'),
          h('button', { type: 'button', class: 'gb-btn', onclick: () => file.click() }, 'Import from file…'),
          file
        ),
        status,
        h('h3', {}, 'Reset'),
        h('div', { class: 'gb-actions' }, reset),
      ];
    }

    // Settings are kept per game server: take over another server's.
    function copyFromServer(status) {
      if (!opts.listServers || !opts.loadServerSettings) return [];
      const host = currentHost();
      const select = h('select', { class: 'gb-input gb-select', 'aria-label': 'Server to copy from' });
      const note = h('p', { class: 'gb-help' }, 'Looking for your other servers…');
      const actions = h('div', { class: 'gb-actions' });
      const button = h(
        'button',
        {
          type: 'button',
          class: 'gb-btn',
          onclick: () =>
            confirmThen(button, 'Copy settings', async () => {
              const from = select.value;
              const copied = await opts.loadServerSettings(from);
              // Copying never starts or stops the bot.
              save({ ...copied, enabled: view.settings.enabled });
              status.classList.remove('error');
              status.textContent = `Settings copied from ${S.serverName(from)}.`;
            }),
        },
        'Copy settings'
      );
      opts.listServers().then((hosts) => {
        const others = hosts.filter((x) => x !== host);
        for (const x of others) select.appendChild(h('option', { value: x }, S.serverName(x)));
        if (others.length) actions.append(select, button);
        note.textContent = others.length
          ? `Replace the settings of ${host ? S.serverName(host) : 'this server'} with those of another server you play on.`
          : 'Lanista has only been used on this server so far.';
      });
      return [h('h3', {}, 'Copy from another server'), note, actions];
    }

    // Two-click confirmation (window.confirm() is unreliable in popups).
    function confirmThen(button, label, action) {
      if (button.dataset.armed === '1') {
        button.dataset.armed = '';
        button.textContent = label;
        if (action) action();
        return;
      }
      button.dataset.armed = '1';
      button.textContent = 'Click again to confirm';
      setTimeout(() => {
        if (button.dataset.armed === '1') {
          button.dataset.armed = '';
          button.textContent = label;
        }
      }, 4000);
    }

    // ------------------------------------------------------------ layout

    function showTab(id) {
      const tab = ui.TABS.find((t) => t.id === id) || ui.TABS[0];
      view.tab = tab.id;
      syncers = [];
      for (const [tabId, button] of tabButtons) {
        const active = tabId === tab.id;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', active ? 'true' : 'false');
      }

      savedLabel = h('span', { class: 'gb-saved', role: 'status' });
      const head = h('div', { class: 'gb-pane-head' }, icon(tab.icon, 22), h('h2', {}, tab.title), savedLabel);
      if (tab.enable) {
        const control = switchControl(tab.enable, `Enable ${tab.title}`);
        control.el.classList.add('gb-switch-lg');
        head.appendChild(control.el);
        syncers.push(control.sync);
      }

      let body;
      if (tab.custom === 'overview') body = overviewPane();
      else if (tab.custom === 'stats') body = statsPane();
      else if (tab.custom === 'log') body = logPane();
      else if (tab.custom === 'profile') body = profilePane();
      else body = tab.fields.map(renderField);

      pane.textContent = '';
      pane.dataset.tab = tab.id;
      pane.append(head, h('p', { class: 'gb-desc' }, tab.description), ...body);
      pane.scrollTop = 0;
      sync();
      if (opts.onTabChange) opts.onTabChange(tab.id);
    }

    function sync() {
      for (const tab of ui.TABS) {
        if (!onPath(tab)) continue;
        const dot = tabButtons.get(tab.id).querySelector('.gb-dot');
        dot.classList.toggle('on', !!get(onPath(tab)));
      }
      for (const fn of syncers) fn();
    }

    function update({ settings, memory } = {}) {
      if (settings) view.settings = S.sanitizeSettings(settings);
      if (memory !== undefined) view.memory = memory;
      sync();
    }

    showTab(view.tab);
    return { element, update, showTab, getTab: () => view.tab, getSettings: () => view.settings };
  }

  ui.createSettingsUI = createSettingsUI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
