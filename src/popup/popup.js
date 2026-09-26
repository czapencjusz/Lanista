'use strict';

const ext = globalThis.browser || globalThis.chrome;
const { loadSettings, saveSettings, STORAGE_KEY } = GBot.settings;
const GAME_ORIGINS = ['https://*.gladiatus.gameforge.com/*'];

let settings = null;
let host = null;

const $ = (sel) => document.querySelector(sel);

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => o[k], obj);
  target[last] = value;
}

function renderSettings() {
  for (const input of document.querySelectorAll('[data-path]')) {
    const value = getPath(settings, input.dataset.path);
    const base = Number(input.dataset.base || 0);
    if (input.type === 'checkbox') input.checked = !!value;
    else input.value = typeof value === 'number' ? String(value + base) : value;
  }
  const toggle = $('#toggle');
  toggle.textContent = settings.enabled ? 'Stop' : 'Start';
  toggle.classList.toggle('on', settings.enabled);
}

function readInput(input) {
  if (input.type === 'checkbox') return input.checked;
  if (input.dataset.type === 'number') {
    const n = Number(input.value);
    if (!Number.isFinite(n)) return undefined;
    return n - Number(input.dataset.base || 0);
  }
  if (input.dataset.type === 'location') {
    const v = input.value.trim().toLowerCase();
    return /^\d+$/.test(v) ? v : 'auto';
  }
  return input.value;
}

async function onInput(event) {
  const input = event.target;
  if (!input.dataset.path) return;
  const value = readInput(input);
  if (value === undefined) return;
  setPath(settings, input.dataset.path, value);
  settings = await saveSettings(settings);
  if (input.dataset.type === 'location') input.value = getPath(settings, input.dataset.path);
}

async function currentGameHost() {
  try {
    const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && /^https:\/\/[^/]+\.gladiatus\.gameforge\.com\//.test(tab.url)) return new URL(tab.url).host;
  } catch (e) {
    // No access to the tab URL.
  }
  return null;
}

function formatWhen(ts) {
  const ms = ts - Date.now();
  if (ms <= 0) return 'now';
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
}

async function renderStatus() {
  if (!host) return;
  const key = `memory:${host}`;
  const memory = (await ext.storage.local.get(key))[key];
  $('#status-host').textContent = host;
  if (!memory) {
    $('#status-stats').textContent = 'No activity yet on this server.';
    return;
  }
  const s = memory.stats || {};
  $('#status-stats').textContent =
    `Since ${new Date(s.since || Date.now()).toLocaleString()}: expeditions ${s.expedition || 0}, dungeons ${s.dungeon || 0}, ` +
    `arena ${s.arena || 0}, circus ${s.circus || 0}, heals ${s.heal || 0}, quests ${s.quests || 0}`;

  const notes = [];
  for (const [type, until] of Object.entries(memory.blockedUntil || {})) {
    if (until > Date.now()) notes.push(`${type} paused (retry in ${formatWhen(until)})`);
  }
  if (memory.workUntil > Date.now()) notes.push(`working, done in ${formatWhen(memory.workUntil)}`);
  if (memory.noFoodUntil > Date.now()) notes.push(`no food found (re-check in ${formatWhen(memory.noFoodUntil)})`);
  $('#status-blocked').textContent = notes.join(' · ');

  const log = $('#log');
  log.textContent = '';
  for (const e of (memory.log || []).slice(-40).reverse()) {
    const line = document.createElement('div');
    line.className = e.level;
    line.textContent = `${new Date(e.t).toLocaleTimeString()} ${e.message}`;
    log.appendChild(line);
  }
}

async function checkPermission() {
  try {
    const granted = await ext.permissions.contains({ origins: GAME_ORIGINS });
    $('#permission').hidden = granted;
  } catch (e) {
    $('#permission').hidden = true;
  }
}

async function init() {
  settings = await loadSettings();
  host = await currentGameHost();
  renderSettings();
  await renderStatus();
  await checkPermission();

  $('#settings').addEventListener('change', onInput);
  $('#toggle').addEventListener('click', async () => {
    settings.enabled = !settings.enabled;
    settings = await saveSettings(settings);
    renderSettings();
  });
  $('#grant').addEventListener('click', async () => {
    await ext.permissions.request({ origins: GAME_ORIGINS });
    await checkPermission();
  });
  $('#reset').addEventListener('click', async () => {
    if (!host) return;
    const key = `memory:${host}`;
    const memory = (await ext.storage.local.get(key))[key];
    if (!memory) return;
    memory.stats = { since: Date.now(), expedition: 0, dungeon: 0, arena: 0, circus: 0, heal: 0, work: 0, quests: 0 };
    memory.log = [];
    memory.blockedUntil = {};
    await ext.storage.local.set({ [key]: memory });
  });

  ext.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[STORAGE_KEY]) {
      settings = GBot.settings.mergeSettings(GBot.settings.DEFAULT_SETTINGS, changes[STORAGE_KEY].newValue);
      renderSettings();
    }
    if (host && changes[`memory:${host}`]) renderStatus();
  });
}

init();
