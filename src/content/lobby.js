// Logs back in to a game server from the Gladiatus lobby, when the
// background script sent the game tab here for that (Settings > General >
// "Log back in through the lobby"). On any other visit to the lobby it does
// nothing.
//
// The lobby names some servers ("Vulcan" is s303-en), so the account is
// found through the lobby's own API (each account carries its server's
// language and number), and its row in the accounts table is the one that
// shows that server's name and the account's name. Its Play button is
// pressed like a player would; the lobby then opens the game in a new
// window. No password is ever typed: without a lobby session nothing
// happens and the player is told.
(function (root) {
  'use strict';

  const TOKEN_COOKIE = /(?:^|;\s*)gf-token-production=([^;]+)/;
  const LOCALE = /^\/([a-z]{2}_[A-Z]{2})(?:\/|$)/;
  const ROWS = '.rt-tbody .rt-tr';
  const CELLS = '.rt-td';
  const PLAY = '.action-cell button, button';

  // The lobby account for a game server host: by the server's language
  // and number, the one played last when there are several.
  function findAccount(host, accounts, servers) {
    const m = /^s(\d+)-([a-z]+)\./.exec(String(host));
    if (!m) return null;
    const number = Number(m[1]);
    const language = m[2];
    const onServer = (accounts || []).filter((a) => a && a.server && Number(a.server.number) === number && a.server.language === language && !a.blocked);
    if (!onServer.length) return null;
    const account = onServer.slice().sort((a, b) => String(b.lastPlayed || '').localeCompare(String(a.lastPlayed || '')))[0];
    const server = (servers || []).find((s) => Number(s.number) === number && s.language === language);
    return { serverName: server && server.name ? String(server.name) : String(number), accountName: String(account.name) };
  }

  // The Play button in the row that shows the server's and the account's
  // names, or null.
  function playButton(doc, target) {
    for (const row of doc.querySelectorAll(ROWS)) {
      const cells = Array.from(row.querySelectorAll(CELLS)).map((c) => c.textContent.trim());
      if (cells.includes(target.serverName) && cells.includes(target.accountName)) return row.querySelector(PLAY);
    }
    return null;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitFor(fn, timeoutMs) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const value = fn();
      if (value || Date.now() > end) return value || null;
      await sleep(250);
    }
  }

  async function run() {
    const ext = root.browser || root.chrome;
    const job = await ext.runtime.sendMessage({ type: 'rejoinJob' }).catch(() => null);
    if (!job || !job.host) return;
    const report = (result) => ext.runtime.sendMessage({ type: 'rejoinResult', host: job.host, ...result }).catch(() => null);

    // The lobby picks its language itself ("/" -> "/pl_PL/hub"), sometimes
    // without reloading the page: wait for it, then open the account list.
    const locale = await waitFor(() => (LOCALE.exec(location.pathname) || [])[1], 15000);
    const token = (TOKEN_COOKIE.exec(document.cookie) || [])[1];
    if (!locale || !token) return report({ ok: false, reason: 'you are not logged in to the Gladiatus lobby' });
    if (!/\/accounts\/?$/.test(location.pathname)) {
      location.href = `/${locale}/accounts`;
      return;
    }

    const api = async (path) => {
      const response = await fetch(`/api${path}`, { credentials: 'include', headers: { Authorization: `Bearer ${decodeURIComponent(token)}` } });
      if (!response.ok) throw new Error(`the lobby answered ${response.status}`);
      return response.json();
    };
    let target;
    try {
      const [accounts, servers] = await Promise.all([api('/users/me/accounts'), api('/servers')]);
      target = findAccount(job.host, accounts, servers);
    } catch (e) {
      return report({ ok: false, reason: e.message });
    }
    if (!target) return report({ ok: false, reason: 'this Gameforge account has no game account on that server' });

    const button = await waitFor(() => playButton(document, target), 20000);
    if (!button) return report({ ok: false, reason: `the lobby does not list ${target.serverName} · ${target.accountName}` });
    await sleep(1500 + Math.random() * 2000);
    button.click();
    report({ ok: true, clicked: `${target.serverName} · ${target.accountName}` });
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { findAccount, playButton };
  else if (root.top === root) run();
})(typeof globalThis !== 'undefined' ? globalThis : this);
