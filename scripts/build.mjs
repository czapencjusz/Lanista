// Packages the extension into dist/lanista-chrome.zip and dist/lanista-firefox.zip.
// The repo root is a valid unpacked extension for both browsers; the packaged
// manifests only drop the keys the other browser needs, to avoid warnings.
// Uses a tiny built-in ZIP writer so no external tools are required.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zip } from './zip.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const INCLUDE = ['icons', 'src', 'LICENSE'];

function collect(path) {
  const full = join(root, path);
  if (statSync(full).isFile()) return [path];
  return readdirSync(full).flatMap((name) => collect(join(path, name)));
}

// Premium keys only work once `npm run license -- init` has written the
// public key (see docs/premium.md).
const tier = createRequire(import.meta.url)(join(root, 'src', 'shared', 'tier.js'));
if (!tier.PUBLIC_KEY) console.warn('Warning: src/shared/tier.js has no PUBLIC_KEY, so this build accepts no Premium key. Run "npm run license -- init".');
if (!tier.PREMIUM_URL) console.warn('Warning: src/shared/tier.js has no PREMIUM_URL, so there is no "Get Premium" button.');

const files = INCLUDE.flatMap(collect).sort();
const base = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));

const targets = {
  chrome(manifest) {
    delete manifest.browser_specific_settings;
    manifest.background = { service_worker: manifest.background.service_worker };
    return manifest;
  },
  firefox(manifest) {
    delete manifest.minimum_chrome_version;
    manifest.background = { scripts: manifest.background.scripts };
    return manifest;
  },
};

mkdirSync(join(root, 'dist'), { recursive: true });
for (const [name, transform] of Object.entries(targets)) {
  const manifest = transform(structuredClone(base));
  const entries = [
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n') },
    ...files.map((f) => ({ name: relative(root, join(root, f)).split(sep).join('/'), data: readFileSync(join(root, f)) })),
  ];
  const out = join(root, 'dist', `lanista-${name}.zip`);
  writeFileSync(out, zip(entries));
  console.log(`${relative(root, out)}  (${entries.length} files)`);
}
