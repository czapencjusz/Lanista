'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');

const T = require('./load').tier;

const HOUR = 3600 * 1000;
const noon = new Date(2026, 8, 30, 12, 0, 0).getTime();

// A key pair like `npm run license -- init` makes, and keys signed with it.
async function keyPair() {
  const pair = await webcrypto.subtle.generateKey(T.KEY_ALGORITHM, true, ['sign', 'verify']);
  const { kty, crv, x, y } = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
  const sign = async (payload) => {
    const data = new TextEncoder().encode(JSON.stringify(payload));
    return T.encodeKey(data, new Uint8Array(await webcrypto.subtle.sign(T.SIGN_ALGORITHM, pair.privateKey, data)));
  };
  return { publicKey: { kty, crv, x, y }, sign };
}

test('bot time is counted per local day', () => {
  const usage = T.addUsage(null, 30 * 60000, noon);
  assert.deepEqual(usage, { day: '2026-09-30', ms: 30 * 60000 });
  assert.equal(T.usedToday(T.addUsage(usage, 5 * 60000, noon + HOUR), noon + HOUR), 35 * 60000);
  const tomorrow = new Date(2026, 9, 1, 0, 1).getTime();
  assert.equal(T.usedToday(usage, tomorrow), 0);
  assert.deepEqual(T.addUsage(usage, 60000, tomorrow), { day: '2026-10-01', ms: 60000 });
  assert.equal(T.nextMidnight(noon), new Date(2026, 9, 1).getTime());
  assert.equal(T.usedToday({ day: '2026-09-30', ms: 'x' }, noon), 0);
});

test('a counting step is capped, and a new tab adds nothing', () => {
  assert.equal(T.step(noon - 60000, noon), 60000);
  assert.equal(T.step(noon - 3 * HOUR, noon), T.MAX_STEP_MS);
  assert.equal(T.step(undefined, noon), 0);
  assert.equal(T.step(noon + 5000, noon), 0);
});

test('free tier: time left, then used up until midnight', async () => {
  const limit = T.FREE_MINUTES_PER_DAY * 60000;
  let s = await T.status({ usage: { day: '2026-09-30', ms: limit - 25 * 60000 } }, noon);
  assert.equal(s.premium, false);
  assert.equal(s.exhausted, false);
  assert.equal(s.leftMs, 25 * 60000);
  assert.equal(s.resetsAt, new Date(2026, 9, 1).getTime());
  s = await T.status({ usage: { day: '2026-09-30', ms: limit } }, noon);
  assert.equal(s.exhausted, true);
  assert.equal(s.leftMs, 0);
  // Yesterday's time does not count.
  s = await T.status({ usage: { day: '2026-09-29', ms: limit } }, noon);
  assert.equal(s.exhausted, false);
});

test('a signed key unlocks Premium: no limit', async () => {
  const { publicKey, sign } = await keyPair();
  const key = await sign({ v: 1, id: 'abc123', to: 'Marcus', iat: noon, exp: null });
  const check = await T.checkKey(key, noon, publicKey);
  assert.equal(check.ok, true);
  assert.deepEqual(check.license, { id: 'abc123', to: 'Marcus', issued: noon, expires: null });
  const s = await T.status({ key, usage: { day: '2026-09-30', ms: 10 * HOUR } }, noon, publicKey);
  assert.equal(s.premium, true);
  assert.equal(s.exhausted, false);
  assert.equal(s.limitMs, null);
  assert.equal(s.usedMs, 10 * HOUR);
});

test('pasted keys may contain spaces and line breaks', async () => {
  const { publicKey, sign } = await keyPair();
  const key = await sign({ v: 1, id: 'a', to: 'x', iat: noon, exp: null });
  const pasted = ` ${key.slice(0, 40)}\n${key.slice(40, 90)} \r\n${key.slice(90)}\n`;
  assert.equal((await T.checkKey(pasted, noon, publicKey)).ok, true);
});

test('changed, foreign and malformed keys are refused', async () => {
  const { publicKey, sign } = await keyPair();
  const other = await keyPair();
  const key = await sign({ v: 1, id: 'a', to: 'Marcus', iat: noon, exp: null });

  // Payload swapped for one that never expires / names someone else.
  const [, sig] = key.split('.');
  const forged = `${T.KEY_PREFIX}${T.toBase64Url(new TextEncoder().encode(JSON.stringify({ v: 1, id: 'a', to: 'Eve', iat: noon, exp: null })))}.${sig}`;
  assert.equal((await T.checkKey(forged, noon, publicKey)).ok, false);
  assert.equal((await T.checkKey(key, noon, other.publicKey)).ok, false);
  assert.equal((await T.checkKey(key.slice(0, -4), noon, publicKey)).ok, false);
  assert.match((await T.checkKey('hello', noon, publicKey)).error, /starts? with LANISTA-/);
  assert.match((await T.checkKey('', noon, publicKey)).error, /Paste/);
  assert.equal((await T.checkKey('LANISTA-!!!.???', noon, publicKey)).ok, false);
  // A build without a public key accepts nothing.
  assert.equal((await T.checkKey(key, noon, null)).ok, false);
});

test('an expired key falls back to the free tier and says so', async () => {
  const { publicKey, sign } = await keyPair();
  const key = await sign({ v: 1, id: 'a', to: 'Marcus', iat: noon - 40 * 24 * HOUR, exp: noon - HOUR });
  const check = await T.checkKey(key, noon, publicKey);
  assert.equal(check.ok, false);
  assert.equal(check.expired, true);
  assert.match(check.error, /expired/);
  const s = await T.status({ key }, noon, publicKey);
  assert.equal(s.premium, false);
  assert.match(s.keyError, /expired/);
  // Still valid an hour before it expires.
  assert.equal((await T.checkKey(key, noon - 2 * HOUR, publicKey)).ok, true);
});

test('durations and the allowance read naturally', () => {
  assert.equal(T.formatDuration(45 * 60000), '45 min');
  assert.equal(T.formatDuration(65 * 60000), '1 h 05 min');
  assert.equal(T.formatDuration(61 * 1000, Math.ceil), '2 min');
  assert.equal(T.formatDuration(-5), '0 min');
  assert.equal(T.allowanceText(120), '2 hours');
  assert.equal(T.allowanceText(60), '1 hour');
  assert.equal(T.allowanceText(90), '90 minutes');
});
