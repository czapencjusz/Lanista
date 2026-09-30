// Free and Premium.
//
//  - Free: every feature, for FREE_MINUTES_PER_DAY minutes of bot time a day.
//  - Premium: no time limit. Unlocked with a Premium key.
//
// Bot time is the time the bot is switched on and playing in a game tab, on
// any server (two servers at once count twice). The background script adds
// it up; it starts again from zero at midnight, local time. When it runs out
// the bot waits until midnight, like it does outside its active hours.
//
// Premium keys are signed with the maintainer's private key (see
// scripts/license.mjs) and checked here with the public key, so they work
// offline and cannot be made up. Loaded as a classic script everywhere
// (content scripts, background, extension pages); also require()-able from
// Node for tests and scripts/license.mjs.
(function (root) {
  'use strict';
  const GBot = (root.GBot = root.GBot || {});

  const FREE_MINUTES_PER_DAY = 120;

  // Where "Get Premium" leads (a shop page, a Discord invite...). Empty: the
  // buttons are not shown.
  const PREMIUM_URL = '';

  // Public half of the key pair Premium keys are signed with. Written by
  // `npm run license -- init`; while it is null no key is accepted.
  const PUBLIC_KEY = null;

  const LICENSE_KEY = 'license'; // storage: the Premium key, as activated
  const USAGE_KEY = 'usage'; // storage: { day: 'YYYY-MM-DD', ms }
  const KEY_PREFIX = 'LANISTA-';

  // Longest gap counted at once: a longer one means the computer slept.
  const MAX_STEP_MS = 2 * 60 * 1000;

  const SIGN_ALGORITHM = { name: 'ECDSA', hash: 'SHA-256' };
  const KEY_ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' };

  function storageArea() {
    const api = root.browser || root.chrome;
    return api && api.storage && api.storage.local;
  }

  // ------------------------------------------------------------ bot time

  const pad = (n) => String(n).padStart(2, '0');
  const dayOf = (now) => {
    const d = new Date(now);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const nextMidnight = (now) => {
    const d = new Date(now);
    d.setHours(24, 0, 0, 0);
    return d.getTime();
  };

  // Bot time used today, from the stored { day, ms }.
  const usedToday = (usage, now) => (usage && usage.day === dayOf(now) && Number.isFinite(usage.ms) ? Math.max(0, usage.ms) : 0);

  // Bot time since `since`; a tab counted for the first time adds nothing.
  const step = (since, now) => (since ? Math.min(MAX_STEP_MS, Math.max(0, now - since)) : 0);

  const addUsage = (usage, ms, now) => ({ day: dayOf(now), ms: usedToday(usage, now) + Math.max(0, ms) });

  // "2 hours", "90 minutes".
  function allowanceText(minutes = FREE_MINUTES_PER_DAY) {
    if (minutes % 60) return `${minutes} minutes`;
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }

  // "1 h 05 min", "45 min".
  function formatDuration(ms, round = Math.round) {
    const minutes = Math.max(0, round(ms / 60000));
    const h = Math.floor(minutes / 60);
    return h ? `${h} h ${pad(minutes % 60)} min` : `${minutes} min`;
  }

  // -------------------------------------------------------- Premium keys

  function toBase64Url(bytes) {
    let text = '';
    for (const b of bytes) text += String.fromCharCode(b);
    return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromBase64Url(text) {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  }

  // A key as pasted: spaces and line breaks (from an e-mail) do not matter.
  const cleanKey = (text) => String(text || '').replace(/\s+/g, '');

  const formatDate = (ms) => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

  // The signed part of a key: { v, id, to, iat, exp }, exp null for a key
  // that never expires.
  function encodeKey(payloadBytes, signatureBytes) {
    return `${KEY_PREFIX}${toBase64Url(payloadBytes)}.${toBase64Url(signatureBytes)}`;
  }

  // Checks a key: { ok, license: { id, to, issued, expires }, error }.
  async function checkKey(text, now, publicKey = PUBLIC_KEY) {
    const key = cleanKey(text);
    if (!key) return { ok: false, error: 'Paste your Premium key first.' };
    const match = /^LANISTA-([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(key);
    if (!match) return { ok: false, error: 'That is not a Lanista Premium key. Premium keys start with LANISTA-.' };
    if (!publicKey) return { ok: false, error: 'This copy of Lanista cannot check Premium keys.' };
    let payload = null;
    let valid = false;
    try {
      const data = fromBase64Url(match[1]);
      const subtle = root.crypto.subtle;
      const verifier = await subtle.importKey('jwk', publicKey, KEY_ALGORITHM, false, ['verify']);
      valid = await subtle.verify(SIGN_ALGORITHM, verifier, fromBase64Url(match[2]), data);
      payload = JSON.parse(new TextDecoder().decode(data));
    } catch (e) {
      valid = false;
    }
    if (!valid || !payload || typeof payload !== 'object') {
      return { ok: false, error: 'This key is not valid. Check that you copied all of it.' };
    }
    const license = {
      id: String(payload.id || ''),
      to: String(payload.to || ''),
      issued: Number.isFinite(payload.iat) ? payload.iat : null,
      expires: Number.isFinite(payload.exp) ? payload.exp : null,
    };
    if (license.expires !== null && license.expires <= now) {
      return { ok: false, expired: true, license, error: `This Premium key expired on ${formatDate(license.expires)}.` };
    }
    return { ok: true, license };
  }

  // ---------------------------------------------------------- the tier

  // Everything the runner and the UI need, from what is stored.
  async function status({ key, usage } = {}, now = Date.now(), publicKey = PUBLIC_KEY) {
    const check = key ? await checkKey(key, now, publicKey) : null;
    const premium = !!(check && check.ok);
    const usedMs = usedToday(usage, now);
    const limitMs = premium ? null : FREE_MINUTES_PER_DAY * 60000;
    return {
      premium,
      license: (check && check.license) || null,
      keyError: check && !check.ok ? check.error : null,
      usedMs,
      limitMs,
      leftMs: premium ? null : Math.max(0, limitMs - usedMs),
      exhausted: !premium && usedMs >= limitMs,
      resetsAt: nextMidnight(now),
    };
  }

  async function load(now = Date.now()) {
    const area = storageArea();
    if (!area) return status({}, now);
    const data = await area.get([LICENSE_KEY, USAGE_KEY]);
    return status({ key: data[LICENSE_KEY], usage: data[USAGE_KEY] }, now);
  }

  // Saves the key if it is valid; returns the check either way.
  async function activate(text, now = Date.now()) {
    const check = await checkKey(text, now);
    if (check.ok) await storageArea().set({ [LICENSE_KEY]: cleanKey(text) });
    return check;
  }

  const deactivate = () => storageArea().remove(LICENSE_KEY);

  GBot.tier = {
    FREE_MINUTES_PER_DAY,
    PREMIUM_URL,
    PUBLIC_KEY,
    LICENSE_KEY,
    USAGE_KEY,
    KEY_PREFIX,
    MAX_STEP_MS,
    SIGN_ALGORITHM,
    KEY_ALGORITHM,
    dayOf,
    nextMidnight,
    usedToday,
    step,
    addUsage,
    allowanceText,
    formatDuration,
    formatDate,
    toBase64Url,
    fromBase64Url,
    cleanKey,
    encodeKey,
    checkKey,
    status,
    load,
    activate,
    deactivate,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = GBot.tier;
})(typeof globalThis !== 'undefined' ? globalThis : this);
