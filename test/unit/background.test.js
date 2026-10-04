'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { settings: S } = require('./load');

const HOST = 's303-en.gladiatus.gameforge.com';

// Just enough of the extension API for background.js to load and answer
// messages; fetch() is recorded instead of sent.
const store = {};
const listeners = {};
const notifications = [];
const fetched = [];
const session = {};
const tabUrls = {};
const tabMoves = [];
const tabsClosed = [];
const on = (name) => ({ addListener: (fn) => (listeners[name] = fn) });
globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => {
        if (keys === null) return { ...store };
        const list = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(list.filter((k) => k in store).map((k) => [k, store[k]]));
      },
      set: async (items) => Object.assign(store, items),
      remove: async (keys) => [].concat(keys).forEach((k) => delete store[k]),
    },
    onChanged: on('storage'),
    session: {
      get: async (key) => (key in session ? { [key]: session[key] } : {}),
      set: async (items) => Object.assign(session, items),
    },
  },
  alarms: { get: async () => ({}), create: () => {}, clear: () => {}, onAlarm: on('alarm') },
  runtime: { onMessage: on('message'), onInstalled: on('installed'), onStartup: on('startup'), getURL: (p) => p },
  notifications: { create: async (o) => notifications.push(o.message) },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  tabs: {
    onRemoved: on('tabRemoved'),
    get: async (id) => ({ id, url: tabUrls[id] || '' }),
    reload: async () => {},
    update: async (id, props) => tabMoves.push([id, props.url]),
    remove: async (id) => tabsClosed.push(id),
  },
};
globalThis.fetch = async (url, init) => {
  fetched.push({ url, ...init });
  return {};
};
require('../../src/background/background.js');

function message(msg) {
  return new Promise((resolve) => listeners.message(msg, { tab: { id: 7 } }, resolve));
}

async function useSettings(notificationsSettings) {
  await S.saveSettings(S.sanitizeSettings({ notifications: notificationsSettings }), HOST);
  fetched.length = 0;
  notifications.length = 0;
}

test('alerts also go to an ntfy topic, as plain text naming the server', async () => {
  await useSettings({ pushUrl: 'https://ntfy.sh/Lanista-Ab12' });
  await message({ type: 'alert', kind: 'noFood', message: 'Lanista: HP is low and there is no food left', host: HOST });
  assert.deepEqual(notifications, ['Lanista: HP is low and there is no food left']);
  assert.equal(fetched.length, 1);
  assert.equal(fetched[0].url, 'https://ntfy.sh/Lanista-Ab12', 'the address keeps its capitals');
  assert.equal(fetched[0].method, 'POST');
  assert.equal(fetched[0].mode, 'no-cors');
  assert.equal(fetched[0].body, `Lanista (${S.serverName(HOST)}): HP is low and there is no food left`);
});

test('a Discord webhook gets the text as its "content" form field', async () => {
  await useSettings({ pushUrl: 'https://discord.com/api/webhooks/123/AbC-xyz' });
  await message({ type: 'alert', kind: 'activityPaused', message: 'Lanista: arena paused', host: HOST });
  assert.equal(fetched.length, 1);
  assert.ok(fetched[0].body instanceof FormData);
  assert.equal(fetched[0].body.get('content'), `Lanista (${S.serverName(HOST)}): arena paused`);
});

test('nothing is sent for switched-off alerts, or without an address', async () => {
  await useSettings({ pushUrl: 'https://ntfy.sh/x', noFood: false });
  await message({ type: 'alert', kind: 'noFood', message: 'Lanista: no food', host: HOST });
  assert.equal(fetched.length, 0);
  assert.equal(notifications.length, 0);
  await useSettings({ pushUrl: '' });
  await message({ type: 'alert', kind: 'noFood', message: 'Lanista: no food', host: HOST });
  assert.equal(fetched.length, 0);
  assert.equal(notifications.length, 1, 'the desktop notification still shows');
});

test('"Send a test" posts a test message and reports network failures', async () => {
  await useSettings({});
  assert.deepEqual(await message({ type: 'pushTest', url: 'https://ntfy.sh/x', host: HOST }), { ok: true });
  assert.match(fetched[0].body, /Test message/);
  assert.deepEqual(await message({ type: 'pushTest', url: 'http://ntfy.sh/x', host: HOST }), { ok: false, error: 'not an https:// address' });
  const real = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  try {
    assert.deepEqual(await message({ type: 'pushTest', url: 'https://nowhere.invalid/x', host: HOST }), { ok: false, error: 'Failed to fetch' });
  } finally {
    globalThis.fetch = real;
  }
});

test('the address must be https; anything else is dropped', () => {
  assert.equal(S.sanitizeSettings({ notifications: { pushUrl: ' https://ntfy.sh/MyTopic ' } }).notifications.pushUrl, 'https://ntfy.sh/MyTopic');
  assert.equal(S.sanitizeSettings({ notifications: { pushUrl: 'http://ntfy.sh/x' } }).notifications.pushUrl, '');
  assert.equal(S.sanitizeSettings({ notifications: { pushUrl: 'javascript:alert(1)' } }).notifications.pushUrl, '');
  assert.equal(S.DEFAULT_SETTINGS.notifications.pushUrl, '');
});

function from(tabId, msg) {
  return new Promise((resolve) => listeners.message(msg, { tab: { id: tabId } }, resolve));
}

test('rejoin: off by default; when on, the tab goes to the lobby, at most 3 times in 6 hours', async () => {
  await S.saveSettings(S.sanitizeSettings({ enabled: true }), HOST);
  assert.deepEqual(await from(21, { type: 'rejoin', host: HOST }), { ok: false, reason: null }, 'switched off');
  assert.equal(tabMoves.length, 0);

  await S.saveSettings(S.sanitizeSettings({ enabled: true, general: { rejoin: true } }), HOST);
  notifications.length = 0;
  assert.deepEqual(await from(21, { type: 'rejoin', host: HOST }), { ok: true, reason: null });
  assert.deepEqual(tabMoves, [[21, 'https://lobby.gladiatus.gameforge.com/']]);
  assert.deepEqual(await from(21, { type: 'rejoin', host: HOST }), { ok: true, reason: 'already under way' }, 'no second trip while one runs');
  assert.deepEqual(await from(21, { type: 'rejoinJob' }), { host: HOST, at: session.rejoin.jobs[21].at });
  assert.equal(await from(99, { type: 'rejoinJob' }), null, 'other lobby visits are left alone');

  // The lobby pressed Play; the game window claims the server: done, and
  // the lobby tab is closed.
  await from(21, { type: 'rejoinResult', ok: true, clicked: 'Vulcan · [PG] DaddyCzapo' });
  assert.ok(session.rejoin.jobs[21].clicked);
  await from(22, { type: 'claim', host: HOST });
  assert.deepEqual(tabsClosed, [21]);
  assert.deepEqual(session.rejoin.jobs, {});
  assert.match(notifications.at(-1), /logged back in to Server 303 \(EN\) through the lobby/);

  await from(22, { type: 'rejoin', host: HOST });
  await from(22, { type: 'claim', host: HOST });
  await from(22, { type: 'rejoin', host: HOST });
  await from(22, { type: 'claim', host: HOST });
  assert.deepEqual(await from(22, { type: 'rejoin', host: HOST }), { ok: false, reason: 'already tried 3 times in 6 hours' });
});

test('rejoin: never after the player pressed Logout; failures are reported', async () => {
  session.rejoin = undefined;
  await S.saveSettings(S.sanitizeSettings({ enabled: true, general: { rejoin: true } }), HOST);
  await from(30, { type: 'userLogout', host: HOST });
  assert.deepEqual(await from(30, { type: 'rejoin', host: HOST }), { ok: false, reason: 'you logged out yourself' });

  session.rejoin = undefined;
  notifications.length = 0;
  await from(31, { type: 'rejoin', host: HOST });
  await from(31, { type: 'rejoinResult', ok: false, reason: 'you are not logged in to the Gladiatus lobby' });
  assert.match(notifications.at(-1), /could not log back in to Server 303 \(EN\): you are not logged in to the Gladiatus lobby/);
  assert.deepEqual(session.rejoin.jobs, {});

  await S.saveSettings(S.sanitizeSettings({ enabled: false, general: { rejoin: true } }), HOST);
  assert.deepEqual(await from(31, { type: 'rejoin', host: HOST }), { ok: false, reason: null }, 'not while Lanista is stopped');
});

test('Telegram, Slack, Pushover and Gotify get the text the way each takes it', async () => {
  const text = `Lanista (${S.serverName(HOST)}): arena paused`;
  await useSettings({
    pushUrl: [
      'https://api.telegram.org/bot123:AAbc/sendMessage?chat_id=4567',
      'https://hooks.slack.com/services/T1/B2/xyz',
      'https://api.pushover.net/1/messages.json?token=app1&user=usr2',
      'https://push.example.org/message?token=Gt0k',
      'https://ntfy.sh/Lanista-Ab12',
    ].join('\n'),
  });
  await message({ type: 'alert', kind: 'activityPaused', message: 'Lanista: arena paused', host: HOST });
  assert.deepEqual(
    fetched.map((f) => [f.url, typeof f.body === 'string' ? f.body : Object.fromEntries(f.body)]),
    [
      ['https://api.telegram.org/bot123:AAbc/sendMessage', { chat_id: '4567', text }],
      ['https://hooks.slack.com/services/T1/B2/xyz', { payload: JSON.stringify({ text }) }],
      ['https://api.pushover.net/1/messages.json', { token: 'app1', user: 'usr2', title: 'Lanista', message: text }],
      ['https://push.example.org/message?token=Gt0k', { title: 'Lanista', message: text }],
      ['https://ntfy.sh/Lanista-Ab12', text],
    ]
  );
  assert.ok(fetched.slice(0, 4).every((f) => f.body instanceof URLSearchParams && f.mode === 'no-cors'), 'simple form posts');
});

test('desktop alerts can be switched off; the phone still gets them', async () => {
  await useSettings({ pushUrl: 'https://ntfy.sh/x', desktop: false });
  await message({ type: 'alert', kind: 'levelUp', message: 'Lanista: you reached level 111!', host: HOST });
  assert.equal(notifications.length, 0);
  assert.equal(fetched.length, 1);
});

test('"Send a test" with several addresses names the one that failed', async () => {
  await useSettings({});
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.includes('bad.example')) throw new TypeError('Failed to fetch');
    return {};
  };
  try {
    assert.deepEqual(await message({ type: 'pushTest', url: 'https://ntfy.sh/x\nhttps://bad.example/hook', host: HOST }), { ok: false, error: 'bad.example: Failed to fetch' });
  } finally {
    globalThis.fetch = real;
  }
});

test('quiet hours: phone alerts wait, then go out together; the desktop ones do not wait', async () => {
  const hhmm = (ms) => {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const now = Date.now();
  const quiet = { pushUrl: 'https://ntfy.sh/x', quiet: true, quietStart: hhmm(now - 3600 * 1000), quietEnd: hhmm(now + 3600 * 1000) };
  await useSettings(quiet);
  await message({ type: 'alert', kind: 'noFood', message: 'Lanista: no food', host: HOST });
  await message({ type: 'alert', kind: 'levelUp', message: 'Lanista: you reached level 111!', host: HOST });
  assert.equal(fetched.length, 0, 'held');
  assert.equal(notifications.length, 2);

  listeners.alarm({ name: 'lanista-watchdog' });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(fetched.length, 0, 'still quiet');

  await useSettings({ ...quiet, quietStart: hhmm(now + 3600 * 1000), quietEnd: hhmm(now + 2 * 3600 * 1000) });
  listeners.alarm({ name: 'lanista-watchdog' });
  await new Promise((r) => setTimeout(r, 20));
  const server = S.serverName(HOST);
  assert.deepEqual(fetched.map((f) => f.body), [`2 alerts during your quiet hours:\nLanista (${server}): no food\nLanista (${server}): you reached level 111!`]);
  listeners.alarm({ name: 'lanista-watchdog' });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(fetched.length, 1, 'sent once');
});

test('the quiet window may run past midnight', () => {
  const at = (h, m) => new Date(2026, 9, 4, h, m).getTime();
  assert.equal(S.inTimeWindow('23:00', '07:00', at(23, 30)), true);
  assert.equal(S.inTimeWindow('23:00', '07:00', at(6, 59)), true);
  assert.equal(S.inTimeWindow('23:00', '07:00', at(7, 0)), false);
  assert.equal(S.inTimeWindow('13:00', '15:00', at(14, 0)), true);
  assert.equal(S.inTimeWindow('13:00', '13:00', at(13, 0)), false, 'an empty window');
});
