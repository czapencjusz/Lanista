// Builds the download page into dist/site/, ready to upload to any static
// host, plus dist/gbot-site.zip with the same files:
//
//   dist/site/index.html        site/index.html with version, build and sizes
//   dist/site/downloads/*.zip   the extension packages (from scripts/build.mjs)
//   dist/site/img/              screenshots from docs/ and the icon
//   dist/site/fonts/            self-hosted fonts (no third-party requests)
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zip } from './zip.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist', 'site');

execFileSync(process.execPath, [join(root, 'scripts', 'build.mjs')], { stdio: 'inherit' });

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'downloads'), { recursive: true });
mkdirSync(join(out, 'img'), { recursive: true });

cpSync(join(root, 'site', 'fonts'), join(out, 'fonts'), { recursive: true });
for (const name of ['settings-window.png', 'control-bar.png', 'docked-bar.png']) {
  cpSync(join(root, 'docs', name), join(out, 'img', name));
}
cpSync(join(root, 'icons', 'icon128.png'), join(out, 'img', 'icon.png'));
for (const name of ['gbot-chrome.zip', 'gbot-firefox.zip']) {
  cpSync(join(root, 'dist', name), join(out, 'downloads', name));
}

const git = (...args) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  } catch (e) {
    return '';
  }
};
const size = (file) => `${Math.max(1, Math.round(statSync(file).size / 1024))} KB`;
const values = {
  VERSION: JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')).version,
  COMMIT: git('rev-parse', '--short', 'HEAD') || 'local',
  DATE: git('log', '-1', '--format=%cs') || new Date().toISOString().slice(0, 10),
  CHROME_SIZE: size(join(out, 'downloads', 'gbot-chrome.zip')),
  FIREFOX_SIZE: size(join(out, 'downloads', 'gbot-firefox.zip')),
};

let html = readFileSync(join(root, 'site', 'index.html'), 'utf8');
html = html.replace(/\{\{(\w+)\}\}/g, (match, key) => {
  if (!(key in values)) throw new Error(`site/index.html: unknown placeholder ${match}`);
  return values[key];
});
writeFileSync(join(out, 'index.html'), html);

// Every local file the page points at must exist.
let missing = 0;
for (const [, ref] of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
  if (/^[a-z]+:/i.test(ref)) continue;
  if (!existsSync(join(out, ref))) {
    missing += 1;
    console.error(`index.html references a missing file: ${ref}`);
  }
}
for (const [, ref] of html.matchAll(/url\("([^"]+)"\)/g)) {
  if (!existsSync(join(out, ref))) {
    missing += 1;
    console.error(`index.html references a missing file: ${ref}`);
  }
}
if (missing) process.exit(1);

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else files.push(full);
  }
};
walk(out);
writeFileSync(
  join(root, 'dist', 'gbot-site.zip'),
  zip(files.map((f) => ({ name: relative(out, f).split(sep).join('/'), data: readFileSync(f) })))
);
console.log(`dist/site/ (${files.length} files, version ${values.VERSION}, build ${values.COMMIT}) and dist/gbot-site.zip`);
