// Background script (service worker in Chrome, event page in Firefox).
//  - shows ON/OFF on the toolbar badge
//  - makes sure only one tab per game server runs the bot ("claim")
//  - watchdog: reloads the bot's tab if it stops reporting in (e.g. the page
//    hung, or the browser froze its timers)
//  - shows desktop notifications for problems that need the user
'use strict';

// Firefox loads settings.js from the manifest's background scripts.
if (typeof importScripts === 'function' && !(globalThis.GBot && globalThis.GBot.settings)) importScripts('../shared/settings.js');

const ext = globalThis.browser || globalThis.chrome;
const S = globalThis.GBot.settings;

const WATCHDOG_ALARM = 'gbot-watchdog';
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
  return { ok: true };
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
      title: 'GBot',
      message,
    });
  } catch (e) {
    console.warn('[GBot] notification failed', e);
  }
}

// Notification requested by a content script; respects the user's choice
// for that server.
async function alert(kind, message, host) {
  const settings = await S.loadSettings(host);
  if (kind && settings.notifications[kind] === false) return;
  await notify(message);
}

async function watchdog() {
  const owners = await getOwners();
  const now = Date.now();
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
      await alert('loggedOut', `The ${host} tab left the game (logged out?). GBot is waiting until you log back in.`, host);
      continue;
    }
    console.warn(`[GBot] tab ${owner.tabId} (${host}) stopped reporting, reloading it`);
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
  else return false;
  work.then(sendResponse, (e) => sendResponse({ ok: true, error: String(e) }));
  return true; // async response
});

ext.tabs.onRemoved.addListener(async (tabId) => {
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
  splitting = splitting || S.splitSettings().catch((e) => console.warn('[GBot] could not split the settings per server', e));
  await splitting;
  await updateBadge();
}

ext.runtime.onInstalled.addListener(init);
ext.runtime.onStartup.addListener(init);
init();
