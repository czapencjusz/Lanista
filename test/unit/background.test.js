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
  },
  alarms: { get: async () => ({}), create: () => {}, clear: () => {}, onAlarm: on('alarm') },
  runtime: { onMessage: on('message'), onInstalled: on('installed'), onStartup: on('startup'), getURL: (p) => p },
  notifications: { create: async (o) => notifications.push(o.message) },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  tabs: { onRemoved: on('tabRemoved'), get: async () => ({}), reload: async () => {} },
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
