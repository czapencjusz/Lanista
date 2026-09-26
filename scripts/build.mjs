// Packages the extension into dist/gbot-chrome.zip and dist/gbot-firefox.zip.
// The repo root is a valid unpacked extension for both browsers; the packaged
// manifests only drop the keys the other browser needs, to avoid warnings.
// Uses a tiny built-in ZIP writer so no external tools are required.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const INCLUDE = ['icons', 'src', 'LICENSE'];

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// 1980-01-01, the earliest valid DOS date (keeps builds reproducible).
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const compressed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10); // time 00:00
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + compressed.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

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
