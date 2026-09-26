// Syntax-checks every JavaScript file in the extension and validates that all
// files referenced by manifest.json exist.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failed = false;

function walk(dir) {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const rel = join(dir, name);
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) return [];
    return statSync(join(root, rel)).isDirectory() ? walk(rel) : [rel];
  });
}

for (const file of walk('.').filter((f) => /\.(m?js)$/.test(f))) {
  try {
    execFileSync(process.execPath, ['--check', join(root, file)], { stdio: 'pipe' });
  } catch (e) {
    failed = true;
    console.error(`Syntax error in ${file}:\n${e.stderr}`);
  }
}

const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const referenced = [
  ...Object.values(manifest.icons),
  ...Object.values(manifest.action.default_icon),
  manifest.action.default_popup,
  manifest.background.service_worker,
  ...manifest.background.scripts,
  ...manifest.content_scripts.flatMap((c) => c.js),
];
for (const file of referenced) {
  if (!existsSync(join(root, file))) {
    failed = true;
    console.error(`manifest.json references missing file: ${file}`);
  }
}

if (failed) process.exit(1);
console.log('Syntax and manifest checks passed.');
