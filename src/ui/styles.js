// Styles for the control bar, the settings window, the popup and the options
// page, as a string so they can be injected into the in-game shadow root as
// well as into extension pages. Gladiatus look: dark leather and gold for
// chrome, parchment for content.
(function (root) {
  'use strict';
  const GBot = (root.GBot = root.GBot || {});
  const ui = (GBot.ui = GBot.ui || {});

  ui.STYLES = `
:host, .gb-root {
  --gb-leather: #2e1c11;
  --gb-leather-2: #45291a;
  --gb-blood: #6b1b1b;
  --gb-blood-2: #4a1010;
  --gb-gold: #e2bc5f;
  --gb-gold-dim: #a8822c;
  --gb-parchment: #f2e6c9;
  --gb-parchment-2: #fbf4e3;
  --gb-line: #d4bf93;
  --gb-ink: #3a2717;
  --gb-muted: #7a6446;
  --gb-green: #3d7d2a;
  --gb-green-light: #8fe06d;
  --gb-red: #a3281c;
  --gb-amber: #ffb454;
  --gb-font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --gb-serif: Georgia, "Times New Roman", serif;
}
.gb-icon { flex: none; display: block; }

/* ---------------------------------------------------------------- buttons */
.gb-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 12px; border: 1px solid #8a6a36; border-radius: 5px;
  background: linear-gradient(#fbeecb, #e6cc93); color: var(--gb-ink);
  font: 600 12.5px/1.3 var(--gb-font); cursor: pointer;
}
.gb-btn:hover { filter: brightness(1.05); }
.gb-btn:focus-visible, .gb-icon-btn:focus-visible, .gb-tab:focus-visible, .gb-tile:focus-visible, .gb-play:focus-visible {
  outline: 2px solid var(--gb-gold); outline-offset: 1px;
}
.gb-btn.primary { background: linear-gradient(#8a6a1c, #6a4f10); color: #fff7df; border-color: #4e3a0b; }
.gb-btn.danger { background: linear-gradient(#b3372a, #862015); color: #fff; border-color: #5e140d; }
.gb-btn[data-armed="1"] { background: linear-gradient(#e0702f, #b24d14); color: #fff; }
.gb-icon-btn {
  display: inline-grid; place-items: center; width: 26px; height: 26px; padding: 0;
  border: 1px solid transparent; border-radius: 5px; background: none; color: inherit; cursor: pointer;
}
.gb-icon-btn:hover:not(:disabled) { background: rgba(0,0,0,.08); border-color: rgba(0,0,0,.12); }
.gb-icon-btn:disabled { opacity: .3; cursor: default; }

/* ------------------------------------------------------------ settings UI */
.gb-settings {
  display: flex; height: 100%; min-height: 0;
  font: 13px/1.45 var(--gb-font); color: var(--gb-ink); background: var(--gb-parchment);
  text-align: left;
}
.gb-tabs {
  flex: none; width: 176px; overflow-y: auto; padding: 8px 0;
  background: linear-gradient(90deg, var(--gb-leather), var(--gb-leather-2));
  border-right: 2px solid var(--gb-gold-dim);
}
.gb-tab {
  position: relative; display: flex; align-items: center; gap: 9px; width: 100%;
  padding: 7px 12px; border: 0; border-left: 3px solid transparent; background: none;
  color: #e8d5a8; font: 13px/1.2 var(--gb-font); text-align: left; cursor: pointer;
}
.gb-tab:hover { background: rgba(255,255,255,.07); }
.gb-tab.active { background: var(--gb-parchment); color: var(--gb-ink); border-left-color: var(--gb-gold); font-weight: 600; }
.gb-tab .gb-icon { color: var(--gb-gold); }
.gb-tab.active .gb-icon { color: var(--gb-blood); }
.gb-dot { margin-left: auto; width: 8px; height: 8px; border-radius: 50%; background: #6d5b44; flex: none; }
.gb-dot.on { background: #6fcf4f; box-shadow: 0 0 5px #6fcf4f; }
.gb-compact .gb-tabs { width: 46px; padding: 4px 0; }
.gb-compact .gb-tab { justify-content: center; padding: 7px 0; }
.gb-compact .gb-tab-label { display: none; }
.gb-compact .gb-dot { position: absolute; top: 5px; right: 5px; width: 7px; height: 7px; margin: 0; }

.gb-pane { flex: 1; min-width: 0; overflow-y: auto; padding: 14px 18px 18px; }
.gb-compact .gb-pane { padding: 12px 12px 16px; }
.gb-pane-head { display: flex; align-items: center; gap: 10px; color: var(--gb-blood); }
.gb-pane-head h2 { margin: 0; font: 700 17px/1.2 var(--gb-serif); color: var(--gb-blood); flex: 1; }
.gb-pane h3 { margin: 16px 0 6px; font: 700 13px/1.2 var(--gb-serif); color: var(--gb-blood); }
.gb-desc { margin: 4px 0 10px; color: var(--gb-muted); font-size: 12.5px; }
.gb-saved { font-size: 11.5px; color: var(--gb-green); opacity: 0; transition: opacity .2s; font-weight: 600; }
.gb-saved.show { opacity: 1; }
.gb-saved.error { color: var(--gb-red); }

.gb-field {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 4px 12px;
  padding: 9px 0; border-bottom: 1px solid rgba(122, 90, 50, .18);
}
.gb-field.stack { grid-template-columns: minmax(0, 1fr); }
.gb-field.disabled .gb-label, .gb-field.disabled .gb-control { opacity: .45; }
.gb-label { font-weight: 600; }
.gb-help { grid-column: 1 / -1; font-size: 11.5px; color: var(--gb-muted); }
.gb-inline { display: inline-flex; align-items: center; gap: 6px; }
.gb-unit { color: var(--gb-muted); }

.gb-input {
  box-sizing: border-box; padding: 4px 7px; border: 1px solid #b89a63; border-radius: 4px;
  background: var(--gb-parchment-2); color: var(--gb-ink); font: 13px/1.3 var(--gb-font);
}
.gb-input:focus { outline: 2px solid var(--gb-gold); outline-offset: 0; border-color: var(--gb-gold-dim); }
.gb-number { width: 76px; }
.gb-select { min-width: 150px; max-width: 100%; }
.gb-textarea { width: 100%; resize: vertical; min-height: 64px; }
.gb-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; }
.gb-input:disabled { cursor: not-allowed; }

.gb-switch { position: relative; display: inline-block; width: 38px; height: 21px; flex: none; }
.gb-switch input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; z-index: 1; }
.gb-slider { position: absolute; inset: 0; border-radius: 21px; background: #b9a47f; transition: background .15s; }
.gb-slider::before {
  content: ""; position: absolute; top: 2px; left: 2px; width: 17px; height: 17px; border-radius: 50%;
  background: #fffaf0; box-shadow: 0 1px 2px rgba(0,0,0,.35); transition: transform .15s;
}
.gb-switch input:checked + .gb-slider { background: var(--gb-green); }
.gb-switch input:checked + .gb-slider::before { transform: translateX(17px); }
.gb-switch input:focus-visible + .gb-slider { outline: 2px solid var(--gb-gold); outline-offset: 1px; }
.gb-switch input:disabled { cursor: not-allowed; }
.gb-switch-lg { transform: scale(1.12); margin-left: 4px; }

.gb-checks { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 6px 12px; margin-top: 4px; }
.gb-check { display: flex; align-items: center; gap: 7px; cursor: pointer; }
.gb-checkbox { width: 16px; height: 16px; margin: 0; accent-color: var(--gb-green); cursor: pointer; }

.gb-order { list-style: none; margin: 4px 0 0; padding: 0; display: grid; gap: 4px; }
.gb-order li {
  display: flex; align-items: center; gap: 8px; padding: 5px 6px 5px 10px;
  background: var(--gb-parchment-2); border: 1px solid var(--gb-line); border-radius: 6px; color: var(--gb-muted);
}
.gb-order li.on { color: var(--gb-ink); }
.gb-order-num { width: 16px; font: 700 13px var(--gb-serif); color: var(--gb-gold-dim); }
.gb-order-label { flex: 1; font-weight: 600; }
.gb-order-state { font-size: 11px; text-transform: uppercase; letter-spacing: .5px; }
.gb-order li.on .gb-order-state { color: var(--gb-green); }

.gb-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 8px 0; }
.gb-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(128px, 1fr)); gap: 8px; }
.gb-card { padding: 9px 11px; background: var(--gb-parchment-2); border: 1px solid var(--gb-line); border-radius: 7px; }
.gb-card-value { font: 700 21px/1.1 var(--gb-serif); color: var(--gb-blood); font-variant-numeric: tabular-nums; }
.gb-card-label { font-weight: 600; margin-top: 2px; }
.gb-card-sub { font-size: 11px; color: var(--gb-muted); }
.gb-log {
  max-height: 360px; overflow-y: auto; padding: 6px 8px; background: var(--gb-parchment-2);
  border: 1px solid var(--gb-line); border-radius: 6px; font: 11.5px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.gb-log-line { white-space: pre-wrap; word-break: break-word; }
.gb-log-time { color: var(--gb-muted); }
.gb-log-line.warn { color: #8a5200; }
.gb-log-line.error { color: var(--gb-red); }
.gb-empty { color: var(--gb-muted); font-style: italic; }
.gb-import-status.error { color: var(--gb-red); }

/* ----------------------------------------------------------- control bar */
.gb-panel {
  position: fixed; z-index: 2147483646; width: 318px;
  font: 12px/1.35 var(--gb-font); color: #f3e6c4; text-align: left;
  background: linear-gradient(170deg, #3f2819, #24160d); border: 1px solid var(--gb-gold-dim);
  border-radius: 9px; box-shadow: 0 8px 28px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.06);
  user-select: none;
}
.gb-panel-head {
  display: flex; align-items: center; gap: 7px; padding: 6px 7px 6px 10px;
  background: linear-gradient(#7a1f1f, var(--gb-blood-2)); border-bottom: 1px solid var(--gb-gold-dim);
  border-radius: 8px 8px 0 0; cursor: move;
}
.gb-brand { display: flex; align-items: center; gap: 6px; font: 700 14px/1 var(--gb-serif); color: #f5d77f; letter-spacing: .5px; flex: 1; white-space: nowrap; }
.gb-brand .gb-icon { color: var(--gb-gold); }
.gb-play {
  display: inline-flex; align-items: center; gap: 5px; padding: 4px 11px 4px 9px; border-radius: 14px;
  border: 1px solid var(--gb-gold); background: linear-gradient(#4b9a36, #2c6420); color: #fff;
  font: 700 12px/1 var(--gb-font); cursor: pointer; white-space: nowrap;
}
.gb-play.running { background: linear-gradient(#b8382b, #7d1a12); }
.gb-panel .gb-icon-btn { color: #f0d9a0; width: 24px; height: 24px; }
.gb-panel .gb-icon-btn:hover { background: rgba(255,255,255,.1); border-color: rgba(255,255,255,.12); }
.gb-status { padding: 7px 10px 0; font-weight: 700; color: #f8e7b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gb-next { padding: 1px 10px 7px; color: #cdb68a; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gb-next b { color: #f5d77f; }
.gb-vitals {
  margin: 0 8px 7px; padding: 4px 8px; border-radius: 5px; background: rgba(0,0,0,.25);
  color: #e6d2a4; font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.gb-vitals:empty { display: none; }
.gb-tile-points { display: none; }
.gb-tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; padding: 0 8px 8px; }
.gb-tile-wrap { position: relative; display: flex; min-width: 0; }
.gb-tile {
  position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px;
  width: 100%; min-width: 0; padding: 6px 2px 5px; border: 1px solid #5a4029; border-radius: 7px;
  background: rgba(0,0,0,.28); color: #8b775b; font: inherit; cursor: pointer;
}
.gb-tile:hover { border-color: #8a6a36; }
.gb-tile.on { color: #f5e3b3; border-color: var(--gb-gold-dim); background: linear-gradient(rgba(226,188,95,.18), rgba(226,188,95,.05)); }
.gb-tile.on .gb-icon { color: var(--gb-gold); }
.gb-tile-label { font-size: 10.5px; font-weight: 700; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gb-tile-sub { font-size: 10.5px; color: #b9a27a; font-variant-numeric: tabular-nums; white-space: nowrap; }
.gb-tile.on.ready .gb-tile-sub { color: var(--gb-green-light); }
.gb-tile.on.warn .gb-tile-sub { color: var(--gb-amber); }
.gb-tile-gear {
  position: absolute; top: 2px; right: 2px; display: grid; place-items: center; width: 17px; height: 17px;
  padding: 0; border: 0; border-radius: 4px; background: none; color: #d9c08a; cursor: pointer;
  opacity: 0; transition: opacity .12s;
}
.gb-tile-wrap:hover .gb-tile-gear, .gb-tile-gear:focus-visible { opacity: .9; }
.gb-tile-gear:hover { background: rgba(255,255,255,.15); }
.gb-panel-foot {
  display: flex; align-items: center; gap: 8px; padding: 5px 8px 6px 10px;
  border-top: 1px solid #4a3522; color: #cdb68a; font-size: 11px;
}
.gb-panel-foot .gb-stats-line { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gb-last-log { padding: 0 10px 6px; color: #a8936f; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gb-last-log.warn { color: var(--gb-amber); }
.gb-last-log.error { color: #ff8a7a; }
.gb-panel.min .gb-body { display: none; }
.gb-panel.min { width: auto; }
.gb-panel.min .gb-panel-head { border-radius: 8px; border-bottom: 0; }

/* Docked bar layout */
.gb-panel.bar {
  top: 0 !important; left: 0 !important; right: 0; width: auto; display: flex; align-items: stretch;
  border-radius: 0; border-width: 0 0 2px; border-color: var(--gb-gold-dim);
}
.gb-panel.bar .gb-panel-head { border-radius: 0; border-bottom: 0; border-right: 1px solid var(--gb-gold-dim); cursor: default; flex: none; }
.gb-panel.bar .gb-body { display: flex; align-items: center; flex: 1; min-width: 0; }
.gb-panel.bar.min .gb-body { display: none; }
.gb-panel.bar .gb-summary { flex: 0 1 190px; min-width: 110px; }
.gb-panel.bar .gb-status { padding: 3px 10px 0; }
.gb-panel.bar .gb-next { padding: 0 10px 3px; }
/* Tiles wrap onto a second row in narrow windows instead of scrolling. */
.gb-panel.bar .gb-tiles { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px 6px; flex: 1; min-width: 0; }
.gb-panel.bar .gb-tile-wrap { flex: none; }
.gb-panel.bar .gb-tile { flex-direction: row; gap: 5px; padding: 4px 18px 4px 8px; }
.gb-panel.bar .gb-tile-label { display: none; }
.gb-panel.bar .gb-tile-points { display: inline; font-size: 10.5px; color: #e6d2a4; font-variant-numeric: tabular-nums; }
.gb-panel.bar .gb-tile-points:empty { display: none; }
.gb-panel.bar .gb-vitals { display: none; }
.gb-panel.bar .gb-tile.nopoints .gb-tile-sub,
.gb-panel.bar .gb-tile[data-activity="settings"] .gb-tile-sub { display: none; }
.gb-panel.bar .gb-tile[data-activity="settings"] { padding-right: 8px; }
.gb-panel.bar .gb-last-log { display: none; }
.gb-panel.bar .gb-panel-foot { border-top: 0; border-left: 1px solid #4a3522; flex: none; }
.gb-panel.bar .gb-stats-line { display: none; }

/* --------------------------------------------------------- settings modal */
.gb-backdrop {
  position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center;
  background: rgba(12, 6, 2, .6);
}
.gb-modal {
  display: flex; flex-direction: column; width: min(860px, 94vw); height: min(620px, 90vh);
  border: 2px solid var(--gb-gold-dim); border-radius: 10px; overflow: hidden;
  box-shadow: 0 18px 60px rgba(0,0,0,.6); background: var(--gb-parchment);
}
.gb-modal-head {
  display: flex; align-items: center; gap: 10px; padding: 8px 10px 8px 14px;
  background: linear-gradient(#7a1f1f, var(--gb-blood-2)); border-bottom: 2px solid var(--gb-gold-dim);
  color: #f5d77f; font: 700 15px/1 var(--gb-serif);
}
.gb-modal-head .gb-title { flex: 1; }
.gb-modal-head .gb-icon-btn { color: #f5d77f; }
.gb-modal-head .gb-icon-btn:hover { background: rgba(255,255,255,.12); }
.gb-modal-body { flex: 1; min-height: 0; }
`;
})(typeof globalThis !== 'undefined' ? globalThis : this);
