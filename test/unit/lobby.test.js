'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { findAccount, playButton } = require('../../src/content/lobby.js');

// The lobby's API on 2026-10-02: accounts carry their server's language and
// number; the server list names some servers ("Vulcan" is s303-en).
const ACCOUNTS = [
  { server: { language: 'en', number: 55 }, name: '[KLL] fr1ko', lastPlayed: '2026-09-30T23:00:01+0200' },
  { server: { language: 'en', number: 303 }, name: '[PG] DaddyCzapo', lastPlayed: '2026-10-02T18:00:03+0200' },
  { server: { language: 'en', number: 55 }, name: 'Kasztelanpuszka', lastPlayed: '2026-08-26T22:29:55+0200' },
  { server: { language: 'en', number: 60 }, name: '[Lietuva!] daddyCzapo', lastPlayed: '2026-10-02T17:00:00+0200' },
];
const SERVERS = [
  { language: 'en', number: 55, name: '55' },
  { language: 'en', number: 60, name: '60' },
  { language: 'en', number: 303, name: 'Vulcan', multiLanguage: 1 },
  { language: 'pl', number: 60, name: '60' },
];

test('the lobby account of a game server: by language and number, not by the name shown', () => {
  assert.deepEqual(findAccount('s303-en.gladiatus.gameforge.com', ACCOUNTS, SERVERS), { serverName: 'Vulcan', accountName: '[PG] DaddyCzapo' });
  assert.deepEqual(findAccount('s60-en.gladiatus.gameforge.com', ACCOUNTS, SERVERS), { serverName: '60', accountName: '[Lietuva!] daddyCzapo' });
  assert.deepEqual(findAccount('s55-en.gladiatus.gameforge.com', ACCOUNTS, SERVERS), { serverName: '55', accountName: '[KLL] fr1ko' }, 'two accounts there: the one played last');
  assert.equal(findAccount('s60-pl.gladiatus.gameforge.com', ACCOUNTS, SERVERS), null, 'no account on s60-pl');
  assert.equal(findAccount('lobby.gladiatus.gameforge.com', ACCOUNTS, SERVERS), null);
  const blocked = ACCOUNTS.map((a) => (a.server.number === 303 ? { ...a, blocked: true } : a));
  assert.equal(findAccount('s303-en.gladiatus.gameforge.com', blocked, SERVERS), null, 'a blocked account is not used');
});

test('the Play button is in the row showing the server and account names', () => {
  // The accounts table as rendered on /pl_PL/accounts.
  const row = (province, flag, player) =>
    `<div class="rt-tr-group"><div class="rt-tr -odd"><div class="rt-td"></div><div class="rt-td"></div><div class="rt-td">${province}</div>
       <div class="rt-td"><span class="flag-${flag} flag-s1"></span></div><div class="rt-td">7</div><div class="rt-td">4x</div><div class="rt-td">1246</div>
       <div class="rt-td">${player}</div><div class="rt-td">0</div><div class="rt-td action-cell"><button class="btn btn-primary" data-row="${province}/${player}">Graj</button></div></div></div>`;
  const doc = new JSDOM(
    `<div class="ReactTable"><div class="rt-tbody">${row('60', 'en', '[Lietuva!] daddyCzapo')}${row('Vulcan', 'ww', '[PG] DaddyCzapo')}${row('55', 'en', '[KLL] fr1ko')}</div></div>`
  ).window.document;
  assert.equal(playButton(doc, { serverName: 'Vulcan', accountName: '[PG] DaddyCzapo' }).dataset.row, 'Vulcan/[PG] DaddyCzapo');
  assert.equal(playButton(doc, { serverName: '60', accountName: '[Lietuva!] daddyCzapo' }).dataset.row, '60/[Lietuva!] daddyCzapo');
  assert.equal(playButton(doc, { serverName: '55', accountName: 'Kasztelanpuszka' }), null, 'both names must match');
});
