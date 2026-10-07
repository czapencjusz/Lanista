// Background script (service worker in Chrome, event page in Firefox).
//  - shows ON/OFF on the toolbar badge
//  - makes sure only one tab per game server runs the bot ("claim")
//  - watchdog: reloads the bot's tab if it stops reporting in (e.g. the page
//    hung, or the browser froze its timers)
//  - shows desktop notifications for problems that need the user, and
//    sends them to the phone (ntfy, Discord, Slack, Telegram, Pushover,
//    Gotify) if set up, holding them during the user's quiet hours
//  - logs back in through the lobby after a logout, if switched on
//  - takes commands from the phone (Telegram, ntfy), if switched on
'use strict';

// Firefox loads these from the manifest's background scripts.
if (typeof importScripts === 'function' && !(globalThis.GBot && globalThis.GBot.settings)) importScripts('../shared/settings.js');
if (typeof importScripts === 'function' && !(globalThis.GBot && globalThis.GBot.remote)) importScripts('../content/brain.js', 'remote.js');

const ext = globalThis.browser || globalThis.chrome;
const S = globalThis.GBot.settings;
const R = globalThis.GBot.remote;

const WATCHDOG_ALARM = 'lanista-watchdog';
const STALE_MS = 4 * 60 * 1000;

// True while the bot is switched on for any server.
async function anyEnabled() {
  const all = await ext.storage.local.get(null);
  return S.serversIn(all).some((host) => S.pickSettings(all, host).enabled);
}

const hostEnabled = async (host) => (await S.loadSettings(host)).enabled;

async function updateBadge() {
  const enabled = await anyEnabled();
  await ext.action.setBadgeText({ text: enabled ? 'ON' : '' });
  await ext.action.setBadgeBackgroundColor({ color: enabled ? '#2e7d32' : '#777777' });
}

async function getOwners() {
  const { owners } = await ext.storage.session.get('owners');
  return owners || {};
}

const setOwners = (owners) => ext.storage.session.set({ owners });

async function tabExists(tabId) {
  try {
    await ext.tabs.get(tabId);
    return true;
  } catch (e) {
    return false;
  }
}

// True when the tab still shows an in-game page (not the lobby / login page).
async function tabInGame(tabId) {
  try {
    const tab = await ext.tabs.get(tabId);
    return !!tab.url && /^https:\/\/[^/]+\.gladiatus\.gameforge\.com\/game\//.test(tab.url);
  } catch (e) {
    return false;
  }
}

// An owner is alive while it keeps reporting in, or while it is sleeping
// until a time it announced.
const ownerAlive = (owner, now) => now - Math.max(owner.at, owner.nextAt || 0) < STALE_MS;

async function claim(host, tabId) {
  const owners = await getOwners();
  const owner = owners[host];
  const now = Date.now();
  if (owner && owner.tabId !== tabId && ownerAlive(owner, now) && (await tabExists(owner.tabId))) {
    return { ok: false };
  }
  owners[host] = { tabId, at: now, nextAt: owner && owner.tabId === tabId ? owner.nextAt : null };
  await setOwners(owners);
  await rejoined(host, tabId);
  return { ok: true };
}

// ---------------------------------------------------------------- rejoin
//
// After a logout the game tab is sent to the lobby; lobby.js presses Play
// for the server's account there, and the lobby opens the game in a new
// window. Once that one claims the server, the lobby tab is closed.

const LOBBY_URL = 'https://lobby.gladiatus.gameforge.com/';
const REJOIN_MAX = 3;
const REJOIN_WINDOW_MS = 6 * 3600 * 1000;
const REJOIN_TIMEOUT_MS = 3 * 60 * 1000;
const USER_LOGOUT_MS = 12 * 3600 * 1000;

// { jobs: { tabId: { host, at, clicked } }, tries: { host: [times] },
//   userLogout: { host: time } }
async function getRejoin() {
  const { rejoin } = await ext.storage.session.get('rejoin');
  return { jobs: {}, tries: {}, userLogout: {}, ...(rejoin || {}) };
}

const setRejoin = (rejoin) => ext.storage.session.set({ rejoin });

// Sends `tabId` to the lobby to log back in to `host`, when the player
// wants that and it has not been tried too often. Returns { ok, reason }.
async function startRejoin(host, tabId) {
  const settings = await S.loadSettings(host);
  if (!settings.enabled || !settings.general.rejoin) return { ok: false, reason: null };
  const r = await getRejoin();
  const now = Date.now();
  if (now - (r.userLogout[host] || 0) < USER_LOGOUT_MS) return { ok: false, reason: 'you logged out yourself' };
  if (Object.values(r.jobs).some((j) => j.host === host && now - j.at < REJOIN_TIMEOUT_MS)) return { ok: true, reason: 'already under way' };
  const tries = (r.tries[host] || []).filter((t) => now - t < REJOIN_WINDOW_MS);
  if (tries.length >= REJOIN_MAX) return { ok: false, reason: `already tried ${REJOIN_MAX} times in 6 hours` };
  r.tries[host] = tries.concat(now);
  r.jobs[tabId] = { host, at: now };
  await setRejoin(r);
  console.info(`[Lanista] ${host}: logged out, logging back in through the lobby`);
  await ext.tabs.update(tabId, { url: LOBBY_URL });
  return { ok: true, reason: null };
}

// A game tab claimed `host`: a rejoin for it is done.
async function rejoined(host, tabId) {
  const r = await getRejoin();
  const done = Object.entries(r.jobs).filter(([, j]) => j.host === host);
  if (!done.length) return;
  for (const [lobbyTab] of done) {
    delete r.jobs[lobbyTab];
    if (Number(lobbyTab) !== tabId) ext.tabs.remove(Number(lobbyTab)).catch(() => {});
  }
  await setRejoin(r);
  await alert('loggedOut', `Lanista logged back in to ${S.serverName(host)} through the lobby.`, host);
}

// What lobby.js found: the button pressed, or why it could not.
async function rejoinResult(tabId, result) {
  const r = await getRejoin();
  const job = r.jobs[tabId];
  if (!job) return;
  if (result.ok) {
    job.clicked = Date.now();
  } else {
    delete r.jobs[tabId];
    await alert('loggedOut', `Lanista could not log back in to ${S.serverName(job.host)}: ${result.reason}. Please log in yourself.`, job.host);
  }
  await setRejoin(r);
}

// Rejoins that did not bring the game back in time.
async function expireRejoins(now) {
  const r = await getRejoin();
  let changed = false;
  for (const [tabId, job] of Object.entries(r.jobs)) {
    if (now - job.at < REJOIN_TIMEOUT_MS) continue;
    delete r.jobs[tabId];
    changed = true;
    const why = job.clicked
      ? 'Play was pressed in the lobby but no game window came up. Allow pop-ups for lobby.gladiatus.gameforge.com, or log in yourself.'
      : 'the lobby did not get as far as Play. Please log in yourself.';
    await alert('loggedOut', `Lanista could not log back in to ${S.serverName(job.host)}: ${why}`, job.host);
  }
  if (changed) await setRejoin(r);
}

async function userLogout(host) {
  const r = await getRejoin();
  r.userLogout[host] = Date.now();
  await setRejoin(r);
}

async function heartbeat(host, tabId, nextAt, enabled) {
  const owners = await getOwners();
  const owner = owners[host];
  if (!enabled) {
    if (owner && owner.tabId === tabId) delete owners[host];
  } else if (!owner || owner.tabId === tabId) {
    owners[host] = { tabId, at: Date.now(), nextAt };
  }
  await setOwners(owners);
}

async function notify(message) {
  try {
    await ext.notifications.create({
      type: 'basic',
      iconUrl: ext.runtime.getURL('icons/icon128.png'),
      title: 'Lanista',
      message,
    });
  } catch (e) {
    console.warn('[Lanista] notification failed', e);
  }
}

// Phone alerts, the way each service takes them. All are "simple" no-cors
// POSTs, so no extra permission is needed; the reply cannot be read, only a
// network failure shows. Values in the address's query (a Telegram chat id,
// Pushover's keys) go into the form along with the text. Anything else (an
// ntfy topic) gets the text as the plain body, which is what ntfy publishes.
const SERVICES = [
  { test: /^https:\/\/(?:[\w-]+\.)?discord(?:app)?\.com\/api\/webhooks\//i, multipart: true, form: (text) => ({ content: text }) },
  { test: /^https:\/\/hooks\.slack\.com\//i, form: (text) => ({ payload: JSON.stringify({ text }) }) },
  { test: /^https:\/\/api\.telegram\.org\/bot[^/]+\/sendMessage\b/i, query: true, form: (text) => ({ text }) },
  { test: /^https:\/\/api\.pushover\.net\//i, query: true, form: (text) => ({ title: 'Lanista', message: text }) },
  // Gotify: https://<server>/message?token=<app token>
  { test: /^https:\/\/[^?#]+\/message\?(?:[^#]*&)?token=/i, form: (text) => ({ title: 'Lanista', message: text }) },
];

function pushRequest(url, text) {
  const service = SERVICES.find((s) => s.test.test(url));
  if (!service) return { url, body: text };
  const fields = [];
  let target = url;
  if (service.query) {
    const u = new URL(url);
    fields.push(...u.searchParams);
    u.search = '';
    target = u.href;
  }
  fields.push(...Object.entries(service.form(text)));
  const body = service.multipart ? new FormData() : new URLSearchParams();
  for (const [k, v] of fields) body.append(k, v);
  return { url: target, body };
}

async function push(url, message) {
  if (!/^https:\/\//i.test(url || '')) return { ok: false, error: 'not an https:// address' };
  const request = pushRequest(url, message);
  try {
    await fetch(request.url, { method: 'POST', mode: 'no-cors', credentials: 'omit', body: request.body });
    return { ok: true };
  } catch (e) {
    console.warn('[Lanista] phone alert failed', e);
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch (e) {
    return url.slice(0, 20);
  }
};

// Sends to every address (one per line); { ok } or { ok: false, error }.
async function pushAll(addresses, message) {
  const urls = S.pushUrls({ pushUrl: addresses });
  if (!urls.length) return { ok: false, error: 'no address', sent: 0 };
  let error = null;
  for (const url of urls) {
    const result = await push(url, message);
    if (!result.ok && !error) error = urls.length > 1 ? `${hostOf(url)}: ${result.error}` : result.error;
  }
  return error ? { ok: false, error } : { ok: true };
}

// During the quiet hours phone alerts wait in storage ({ host: [texts] })
// and go out together afterwards (the watchdog looks every minute).
const HELD_KEY = 'heldAlerts';
const HELD_MAX = 30;

async function holdPush(host, text) {
  const held = (await ext.storage.local.get(HELD_KEY))[HELD_KEY] || {};
  held[host || ''] = (held[host || ''] || []).concat(text).slice(-HELD_MAX);
  await ext.storage.local.set({ [HELD_KEY]: held });
}

async function sendHeld(now) {
  const held = (await ext.storage.local.get(HELD_KEY))[HELD_KEY];
  if (!held || !Object.keys(held).length) return;
  const left = { ...held };
  for (const [host, texts] of Object.entries(held)) {
    const n = (await S.loadSettings(host || undefined)).notifications;
    if (n.quiet && S.inTimeWindow(n.quietStart, n.quietEnd, now)) continue;
    delete left[host];
    if (!texts.length || !S.pushUrls(n).length) continue;
    const text = texts.length === 1 ? texts[0] : `${texts.length} alerts during your quiet hours:\n${texts.join('\n')}`;
    await pushAll(n.pushUrl, text);
  }
  await ext.storage.local.set({ [HELD_KEY]: left });
}

// "Lanista (Server 303): ..." for the phone, where the server is not obvious.
function pushText(message, host) {
  const text = String(message).replace(/^Lanista:\s*/, '');
  return host ? `Lanista (${S.serverName(host)}): ${text}` : `Lanista: ${text}`;
}

// Notification requested by a content script; respects the user's choice
// for that server.
async function alert(kind, message, host) {
  const n = (await S.loadSettings(host)).notifications;
  if (kind && n[kind] === false) return;
  if (n.desktop) await notify(message);
  if (!S.pushUrls(n).length) return;
  const text = pushText(message, host);
  if (n.quiet && S.inTimeWindow(n.quietStart, n.quietEnd, Date.now())) await holdPush(host, text);
  else await pushAll(n.pushUrl, text);
}

// ---------------------------------------------------------- remote control
//
// Once a minute: new messages in the Telegram bot's chat (getUpdates) and
// in the ntfy command topic (a poll), each read once (the offset / last id
// is kept), carried out and answered the same way.

const REMOTE_KEY = 'remoteState';

async function sendToTab(tabId, message) {
  try {
    const reply = await ext.tabs.sendMessage(tabId, message);
    return !!(reply && reply.ok);
  } catch (e) {
    return false;
  }
}

// Carries out one command for the servers listening on its channel;
// returns the answer, or null when the text is not a command.
async function runCommand(text, hosts, now) {
  const cmd = R.parseCommand(text);
  if (!cmd) return null;
  if (cmd.command === 'unknown') return `Lanista: "${cmd.word}" is not a command.\n${R.helpText()}`;
  if (cmd.command === 'help') return R.helpText();
  const targets = R.targetHosts(hosts, cmd.server);
  if (!targets.length) return `Lanista: no server "${cmd.server}" listens here (${hosts.map(S.serverName).join(', ')})`;
  const all = await ext.storage.local.get(null);
  const owners = await getOwners();
  const lines = [];
  for (const host of targets) {
    const settings = S.pickSettings(all, host);
    const memory = globalThis.GBot.brain.normalizeMemory(all[`memory:${host}`], now);
    const owner = owners[host];
    const name = S.serverName(host);
    if (cmd.command === 'stop' || cmd.command === 'start') {
      const on = cmd.command === 'start';
      if (settings.enabled !== on) await S.saveSettings({ ...settings, enabled: on }, host);
      const note = on && !R.tabPlaying(owner, now) ? ' (no game tab is playing: open the game in that browser)' : '';
      lines.push(`${name}: ${on ? 'started' : 'paused'}${note}`);
    } else if (cmd.command === 'check') {
      const asked = settings.enabled && owner && (await sendToTab(owner.tabId, { type: 'checkNow' }));
      lines.push(`${name}: ${asked ? 'looking at the game now' : settings.enabled ? 'no game tab to ask' : 'paused'}`);
    } else if (cmd.command === 'status') lines.push(R.statusLine(host, settings, memory, owner, now));
    else if (cmd.command === 'stats') lines.push(R.statsLine(host, memory));
    else if (cmd.command === 'log') lines.push(R.logLines(host, memory));
  }
  return `Lanista (${cmd.command}):\n${lines.join('\n')}`;
}

async function telegramCommands(channel, state, now) {
  const s = state[channel.key] || {};
  const query = `timeout=0&allowed_updates=${encodeURIComponent('["message"]')}${s.offset ? `&offset=${s.offset}` : ''}`;
  const response = await fetch(`https://api.telegram.org/bot${channel.token}/getUpdates?${query}`, { credentials: 'omit' });
  const data = await response.json();
  if (!data.ok) throw new Error(data.description || `getUpdates answered ${response.status}`);
  const texts = [];
  for (const update of data.result || []) {
    s.offset = update.update_id + 1;
    const m = update.message;
    if (!m || String(m.chat && m.chat.id) !== channel.chatId || typeof m.text !== 'string') continue;
    if (now - m.date * 1000 > R.MAX_AGE_MS) continue;
    texts.push(m.text);
  }
  state[channel.key] = s;
  return texts;
}

async function ntfyCommands(channel, state, now) {
  const s = state[channel.key] || { since: String(Math.floor((now - R.MAX_AGE_MS) / 1000)) };
  const response = await fetch(`${channel.url}/json?poll=1&since=${encodeURIComponent(s.since)}`, { credentials: 'omit' });
  const texts = [];
  for (const line of (await response.text()).split('\n')) {
    let m = null;
    try {
      m = JSON.parse(line);
    } catch (e) {
      continue;
    }
    if (!m || m.event !== 'message') continue;
    s.since = m.id;
    // Lanista's own answers and alerts.
    if (/^Lanista\b/.test(m.message || '')) continue;
    if (now - m.time * 1000 > R.MAX_AGE_MS) continue;
    texts.push(m.message);
  }
  state[channel.key] = s;
  return texts;
}

const answer = (channel, text) =>
  channel.kind === 'telegram' ? push(`https://api.telegram.org/bot${channel.token}/sendMessage?chat_id=${channel.chatId}`, text) : push(channel.url, text);

let polling = false;

async function pollRemote(now) {
  if (polling) return;
  polling = true;
  try {
    const all = await ext.storage.local.get(null);
    const list = R.channels(all);
    if (!list.length) return;
    const state = all[REMOTE_KEY] || {};
    for (const channel of list) {
      let texts = [];
      try {
        texts = channel.kind === 'telegram' ? await telegramCommands(channel, state, now) : await ntfyCommands(channel, state, now);
      } catch (e) {
        console.warn('[Lanista] remote control: could not read commands', e);
        continue;
      }
      // Marked as read before carrying them out, so none runs twice.
      await ext.storage.local.set({ [REMOTE_KEY]: state });
      for (const text of texts) {
        const reply = await runCommand(text, channel.hosts, now);
        if (reply) await answer(channel, reply);
      }
    }
  } finally {
    polling = false;
  }
}

async function watchdog() {
  const owners = await getOwners();
  const now = Date.now();
  await expireRejoins(now);
  await sendHeld(now);
  await pollRemote(now).catch((e) => console.warn('[Lanista] remote control', e));
  let changed = false;
  for (const [host, owner] of Object.entries(owners)) {
    if (ownerAlive(owner, now)) continue;
    if (!(await hostEnabled(host))) {
      delete owners[host];
      changed = true;
      continue;
    }
    if (!(await tabExists(owner.tabId))) {
      delete owners[host];
      changed = true;
      continue;
    }
    if (!(await tabInGame(owner.tabId))) {
      // Reloading would not help (logged out, or the user browsed away).
      delete owners[host];
      changed = true;
      const rejoin = await startRejoin(host, owner.tabId);
      if (!rejoin.ok) {
        const why = rejoin.reason ? ` (not logging back in: ${rejoin.reason})` : '';
        await alert('loggedOut', `The ${host} tab left the game (logged out?). Lanista is waiting until you log back in.${why}`, host);
      }
      continue;
    }
    console.warn(`[Lanista] tab ${owner.tabId} (${host}) stopped reporting, reloading it`);
    owners[host] = { ...owner, at: now, nextAt: null };
    changed = true;
    try {
      await ext.tabs.reload(owner.tabId);
    } catch (e) {
      delete owners[host];
    }
  }
  if (changed) await setOwners(owners);
}

ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab && sender.tab.id;
  let work;
  if (message.type === 'claim' && tabId !== undefined) work = claim(message.host, tabId);
  else if (message.type === 'heartbeat' && tabId !== undefined) {
    work = heartbeat(message.host, tabId, message.nextAt, message.enabled).then(() => ({ ok: true }));
  } else if (message.type === 'alert') work = alert(message.kind, message.message, message.host).then(() => ({ ok: true }));
  else if (message.type === 'pushTest') work = pushAll(message.url, pushText('Test message. Alerts will arrive here.', message.host));
  else if (message.type === 'rejoin' && tabId !== undefined) work = startRejoin(message.host, tabId);
  else if (message.type === 'rejoinJob' && tabId !== undefined) work = getRejoin().then((r) => r.jobs[tabId] || null);
  else if (message.type === 'rejoinResult' && tabId !== undefined) work = rejoinResult(tabId, message).then(() => ({ ok: true }));
  else if (message.type === 'userLogout') work = userLogout(message.host).then(() => ({ ok: true }));
  else if (message.type === 'reloadExtension') {
    // Answer first: the reload ends this script.
    setTimeout(() => ext.runtime.reload(), 200);
    work = Promise.resolve({ ok: true });
  }
  else return false;
  work.then(sendResponse, (e) => sendResponse({ ok: true, error: String(e) }));
  return true; // async response
});

ext.tabs.onRemoved.addListener(async (tabId) => {
  const r = await getRejoin();
  if (r.jobs[tabId]) {
    delete r.jobs[tabId];
    await setRejoin(r);
  }
  const owners = await getOwners();
  let changed = false;
  for (const [host, owner] of Object.entries(owners)) {
    if (owner.tabId === tabId) {
      delete owners[host];
      changed = true;
    }
  }
  if (changed) await setOwners(owners);
});

ext.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && Object.keys(changes).some((k) => k === S.STORAGE_KEY || k.startsWith(S.SERVER_PREFIX))) updateBadge();
});

ext.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === WATCHDOG_ALARM) watchdog();
});

let splitting = null;

async function init() {
  // Only create the alarm once: re-creating it on every wake-up would restart
  // its period and it might never fire.
  if (!(await ext.alarms.get(WATCHDOG_ALARM))) ext.alarms.create(WATCHDOG_ALARM, { periodInMinutes: 1 });
  // The watchdog alarm's name before the rename.
  ext.alarms.clear('gbot-watchdog');
  splitting = splitting || S.splitSettings().catch((e) => console.warn('[Lanista] could not split the settings per server', e));
  await splitting;
  await updateBadge();
}

// After Lanista is reloaded or updated, open game tabs still run the old
// scripts, cut off from the extension: load them again.
async function reloadGameTabs() {
  try {
    for (const tab of await ext.tabs.query({ url: 'https://*.gladiatus.gameforge.com/game/*' })) ext.tabs.reload(tab.id).catch(() => {});
  } catch (e) {
    console.warn('[Lanista] could not reload the game tabs', e);
  }
}

ext.runtime.onInstalled.addListener((details) => {
  init();
  if (details && details.reason === 'update') reloadGameTabs();
});
ext.runtime.onStartup.addListener(init);
init();
