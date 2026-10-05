'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { settings: S, brain } = require('./load');
const R = require('../../src/background/remote.js');

const HOST = 's303-en.gladiatus.gameforge.com';
const OTHER = 's60-en.gladiatus.gameforge.com';
const TELEGRAM = 'https://api.telegram.org/bot123:AAbc/sendMessage?chat_id=4567';
const NTFY = 'https://ntfy.sh/lanista-cmd-Xy7';

// The extension API, as in background.test.js; fetch answers like Telegram
// and ntfy do, and records what was sent.
const store = {};
const session = {};
const listeners = {};
const sentToTabs = [];
const posted = [];
let updates = [];
let ntfyLines = [];
const on = (name) => ({ addListener: (fn) => (listeners[name] = fn) });
globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => {
        if (keys === null) return JSON.parse(JSON.stringify(store));
        const list = Array.isArray(keys) ? keys : [keys];
        return JSON.parse(JSON.stringify(Object.fromEntries(list.filter((k) => k in store).map((k) => [k, store[k]]))));
      },
      set: async (items) => Object.assign(store, JSON.parse(JSON.stringify(items))),
    },
    onChanged: on('storage'),
    session: {
      get: async (key) => (key in session ? { [key]: session[key] } : {}),
      set: async (items) => Object.assign(session, items),
    },
  },
  alarms: { get: async () => ({}), create: () => {}, clear: () => {}, onAlarm: on('alarm') },
  runtime: { onMessage: on('message'), onInstalled: on('installed'), onStartup: on('startup'), getURL: (p) => p },
  notifications: { create: async () => {} },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  tabs: {
    onRemoved: on('tabRemoved'),
    get: async (id) => ({ id, url: `https://${HOST}/game/index.php` }),
    reload: async () => {},
    update: async () => {},
    remove: async () => {},
    sendMessage: async (tabId, message) => (sentToTabs.push([tabId, message.type]), { ok: true }),
  },
};
globalThis.fetch = async (url, init = {}) => {
  if (init.method === 'POST') {
    posted.push([url, typeof init.body === 'string' ? init.body : Object.fromEntries(init.body)]);
    return {};
  }
  if (url.includes('/getUpdates')) {
    const offset = Number(new URL(url).searchParams.get('offset') || 0);
    return { status: 200, json: async () => ({ ok: true, result: updates.filter((u) => u.update_id >= offset) }) };
  }
  if (url.startsWith(NTFY)) return { status: 200, text: async () => ntfyLines.map((l) => JSON.stringify(l)).join('\n') };
  throw new Error(`unexpected fetch ${url}`);
};
require('../../src/background/background.js');

const NOW_S = () => Math.floor(Date.now() / 1000);
const tick = async () => {
  listeners.alarm({ name: 'lanista-watchdog' });
  await new Promise((r) => setTimeout(r, 30));
};

test('commands: one word and an optional server', () => {
  assert.deepEqual(R.parseCommand('/stop@LanistaBot 303'), { command: 'stop', server: '303' });
  assert.deepEqual(R.parseCommand('Status'), { command: 'status', server: null });
  assert.deepEqual(R.parseCommand('dance'), { command: 'unknown', word: 'dance' });
  assert.equal(R.parseCommand('Lanista (status): Server 303 is running'), null, 'not a command');
  assert.deepEqual(R.targetHosts([HOST, OTHER], '303'), [HOST]);
  assert.deepEqual(R.targetHosts([HOST, OTHER], null), [HOST, OTHER]);
  assert.deepEqual(R.targetHosts([HOST, OTHER], '3'), [], 'the whole number');
  assert.deepEqual(R.telegramOf({ pushUrl: `https://ntfy.sh/x\n${TELEGRAM}` }), { token: '123:AAbc', chatId: '4567' });
  assert.equal(R.telegramOf({ pushUrl: 'https://ntfy.sh/x' }), null);
});

test('status and log lines come from what the game tab saw last', () => {
  const now = new Date(2026, 9, 4, 19, 30).getTime();
  const memory = brain.createMemory(now);
  memory.snapshot = { at: now - 60000, hp: 55, gold: 1234567, level: 110, underworld: false, doing: 'Arena is ready', next: { label: 'Expedition', at: now + 5 * 60000 } };
  const settings = S.sanitizeSettings({ enabled: true });
  assert.equal(R.statusLine(HOST, settings, memory, { tabId: 1, at: now - 30000 }, now), 'Server 303 (EN): running · HP 55% · 1,234,567 gold · level 110 · Arena is ready · next: Expedition at 19:35 · (seen 19:29)');
  assert.match(R.statusLine(HOST, settings, memory, { tabId: 1, at: now - 10 * 60000 }, now), /switched on, but no game tab is playing/);
  assert.equal(R.statusLine(HOST, S.sanitizeSettings({ enabled: false }), memory, null, now), 'Server 303 (EN): paused');
  memory.log = [
    { t: now - 120000, level: 'info', message: 'Arena vs X: won' },
    { t: now - 60000, level: 'debug', message: 'noise' },
  ];
  assert.equal(R.logLines(HOST, memory), 'Server 303 (EN):\n19:28 Arena vs X: won');
});

test('Telegram: commands from the bot chat are carried out once and answered there', async () => {
  await S.saveSettings(S.sanitizeSettings({ enabled: true, notifications: { pushUrl: TELEGRAM }, remote: { enabled: true } }), HOST);
  session.owners = { [HOST]: { tabId: 42, at: Date.now(), nextAt: null } };
  updates = [
    { update_id: 10, message: { chat: { id: 4567 }, date: NOW_S() - 3600, text: 'stop' } },
    { update_id: 11, message: { chat: { id: 999 }, date: NOW_S(), text: 'stop' } },
    { update_id: 12, message: { chat: { id: 4567 }, date: NOW_S(), text: '/check' } },
    { update_id: 13, message: { chat: { id: 4567 }, date: NOW_S(), text: 'stop 303' } },
  ];
  await tick();
  assert.equal((await S.loadSettings(HOST)).enabled, false, 'stopped');
  assert.deepEqual(sentToTabs, [[42, 'checkNow']], 'an hour-old command and a stranger are ignored');
  assert.deepEqual(
    posted.map(([url, body]) => [url, body.chat_id, body.text]),
    [
      ['https://api.telegram.org/bot123:AAbc/sendMessage', '4567', 'Lanista (check):\nServer 303 (EN): looking at the game now'],
      ['https://api.telegram.org/bot123:AAbc/sendMessage', '4567', 'Lanista (stop):\nServer 303 (EN): paused'],
    ]
  );
  assert.equal(store.remoteState['telegram:123:AAbc:4567'].offset, 14);

  posted.length = 0;
  await tick();
  assert.equal(posted.length, 0, 'nothing runs twice');

  updates.push({ update_id: 14, message: { chat: { id: 4567 }, date: NOW_S(), text: 'start' } });
  await tick();
  assert.equal((await S.loadSettings(HOST)).enabled, true);
  assert.equal(posted[0][1].text, 'Lanista (start):\nServer 303 (EN): started');
});

test('ntfy: commands from the topic, answers in the same topic; its own messages are skipped', async () => {
  posted.length = 0;
  await S.saveSettings(S.sanitizeSettings({ enabled: true, remote: { enabled: true, ntfyTopic: NTFY } }), HOST);
  ntfyLines = [
    { id: 'a1', time: NOW_S(), event: 'open' },
    { id: 'a2', time: NOW_S(), event: 'message', message: 'Lanista (status):\nServer 303 (EN): running' },
    { id: 'a3', time: NOW_S(), event: 'message', message: 'status' },
    { id: 'a4', time: NOW_S(), event: 'message', message: 'fly 303' },
  ];
  await tick();
  assert.equal(posted.length, 2);
  assert.equal(posted[0][0], NTFY);
  assert.match(posted[0][1], /^Lanista \(status\):\nServer 303 \(EN\): running/);
  assert.match(posted[1][1], /^Lanista: "fly" is not a command\.\nLanista commands/);
  assert.equal(store.remoteState[`ntfy:${NTFY}`].since, 'a4');
});

test('remote control is off by default; the topic must be https', () => {
  const s = S.sanitizeSettings({});
  assert.equal(s.remote.enabled, false);
  assert.equal(S.sanitizeSettings({ remote: { ntfyTopic: 'http://ntfy.sh/x' } }).remote.ntfyTopic, '');
  assert.equal(S.sanitizeSettings({ remote: { ntfyTopic: ' https://ntfy.sh/Lanista-Cmd ' } }).remote.ntfyTopic, 'https://ntfy.sh/Lanista-Cmd');
  assert.deepEqual(R.channels({ [`settings:${HOST}`]: s }), []);
});
