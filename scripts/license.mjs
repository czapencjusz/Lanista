// Premium keys (see src/shared/tier.js).
//
//   npm run license -- init                      make the key pair, once
//   npm run license -- issue "Name" [days]       make a Premium key
//   npm run license -- check "LANISTA-..."       show what a key contains
//
// The private key stays on your computer, outside the repository, in
// ~/.lanista/private-key.json (or the file named by LANISTA_PRIVATE_KEY).
// Anyone who has it can make Premium keys, and keys made with it stop working
// if it is replaced. `init` writes the matching public key into
// src/shared/tier.js: build and publish the extension after it.
//
// Every key issued is listed in issued-keys.csv next to the private key.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomBytes, webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tierFile = join(root, 'src', 'shared', 'tier.js');
const require = createRequire(import.meta.url);
const T = require(tierFile);
const { subtle } = webcrypto;

const privateKeyFile = process.env.LANISTA_PRIVATE_KEY || join(homedir(), '.lanista', 'private-key.json');
const issuedFile = join(dirname(privateKeyFile), 'issued-keys.csv');
const DAY_MS = 24 * 3600 * 1000;

function fail(message) {
  console.error(message);
  process.exit(1);
}

const publicPart = ({ kty, crv, x, y }) => ({ kty, crv, x, y });

async function init(force) {
  if (existsSync(privateKeyFile) && !force) {
    fail(
      `There is already a private key in ${privateKeyFile}.\n` +
        'Replacing it makes every Premium key issued so far stop working. Add --force to do it anyway.'
    );
  }
  const pair = await subtle.generateKey(T.KEY_ALGORITHM, true, ['sign', 'verify']);
  const privateJwk = await subtle.exportKey('jwk', pair.privateKey);
  mkdirSync(dirname(privateKeyFile), { recursive: true, mode: 0o700 });
  writeFileSync(privateKeyFile, `${JSON.stringify(privateJwk, null, 2)}\n`, { mode: 0o600 });

  const source = readFileSync(tierFile, 'utf8');
  const line = /const PUBLIC_KEY = [^;]*;/;
  if (!line.test(source)) fail(`Could not find "const PUBLIC_KEY = ...;" in ${tierFile}.`);
  writeFileSync(tierFile, source.replace(line, `const PUBLIC_KEY = ${JSON.stringify(publicPart(privateJwk))};`));

  console.log(`Private key: ${privateKeyFile}`);
  console.log('Keep it safe and private: back it up, never commit or share it.');
  console.log('Public key written to src/shared/tier.js. Commit it, then build and publish the extension.');
}

function loadPrivateKey() {
  if (!existsSync(privateKeyFile)) fail(`No private key in ${privateKeyFile}. Run "npm run license -- init" first.`);
  const jwk = JSON.parse(readFileSync(privateKeyFile, 'utf8'));
  const inBuild = T.PUBLIC_KEY;
  if (!inBuild || inBuild.x !== jwk.x || inBuild.y !== jwk.y) {
    fail(
      'src/shared/tier.js does not hold the public key of this private key, so keys made now would not work\n' +
        'in this build. Use the tier.js that "init" wrote, or set LANISTA_PRIVATE_KEY to the right private key.'
    );
  }
  return subtle.importKey('jwk', jwk, T.KEY_ALGORITHM, false, ['sign']);
}

const csv = (value) => `"${String(value).replace(/"/g, '""')}"`;

async function issue(to, days) {
  if (!to) fail('Usage: npm run license -- issue "Name or e-mail" [days]');
  if (days !== undefined && !(Number.isInteger(Number(days)) && Number(days) > 0)) fail(`Days must be a whole number above 0, not "${days}".`);
  const signer = await loadPrivateKey();
  const now = Date.now();
  const payload = { v: 1, id: randomBytes(6).toString('hex'), to, iat: now, exp: days ? now + Number(days) * DAY_MS : null };
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const signature = new Uint8Array(await subtle.sign(T.SIGN_ALGORITHM, signer, data));
  const key = T.encodeKey(data, signature);

  const check = await T.checkKey(key, now);
  if (!check.ok) fail(`The new key does not pass its own check: ${check.error}`);

  if (!existsSync(issuedFile)) writeFileSync(issuedFile, 'issued,id,to,expires\n', { mode: 0o600 });
  appendFileSync(issuedFile, `${new Date(now).toISOString()},${payload.id},${csv(to)},${payload.exp ? new Date(payload.exp).toISOString() : 'never'}\n`);

  console.log(key);
  console.error(`\nPremium key ${payload.id} for ${to}, ${payload.exp ? `valid until ${T.formatDate(payload.exp)}` : 'never expires'}. Listed in ${issuedFile}.`);
}

async function check(key) {
  if (!key) fail('Usage: npm run license -- check "LANISTA-..."');
  const result = await T.checkKey(key, Date.now());
  const { license } = result;
  if (license) {
    console.log(`id:      ${license.id}`);
    console.log(`to:      ${license.to}`);
    console.log(`issued:  ${license.issued ? new Date(license.issued).toISOString() : '?'}`);
    console.log(`expires: ${license.expires ? new Date(license.expires).toISOString() : 'never'}`);
  }
  console.log(result.ok ? 'Valid.' : result.error);
  if (!result.ok) process.exitCode = 1;
}

const [command, ...args] = process.argv.slice(2);
if (command === 'init') await init(args.includes('--force'));
else if (command === 'issue') await issue(args[0], args[1]);
else if (command === 'check') await check(args.join(''));
else fail('Usage: npm run license -- init | issue "Name or e-mail" [days] | check "LANISTA-..."');
