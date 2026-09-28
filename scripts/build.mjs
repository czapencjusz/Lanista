// Packages the extension into dist/gbot-chrome.zip and dist/gbot-firefox.zip.
// The repo root is a valid unpacked extension for both browsers; the packaged
// manifests only drop the keys the other browser needs, to avoid warnings.
// Uses a tiny built-in ZIP writer so no external tools are required.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
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
  const out = join(root, 'dist', `gbot-${name}.zip`);
  writeFileSync(out, zip(entries));
  console.log(`${relative(root, out)}  (${entries.length} files)`);
}
