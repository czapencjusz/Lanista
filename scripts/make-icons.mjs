// Generates the extension icons (a golden gladius on a dark-red shield) as PNGs
// without any image library: shapes are rasterised with 4x4 supersampling and
// encoded with a minimal PNG writer.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

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

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Shapes in a unit square (0..1). Each returns true when (x, y) is inside.
const inShield = (x, y) => {
  if (y < 0.06 || y > 0.96 || x < 0.1 || x > 0.9) return false;
  if (y < 0.55) return true;
  // Lower half narrows to a point.
  const t = (y - 0.55) / 0.41;
  const half = 0.4 * Math.sqrt(Math.max(0, 1 - t * t));
  return Math.abs(x - 0.5) <= half;
};
const inBlade = (x, y) => {
  if (y < 0.14 || y > 0.66) return false;
  const tip = y < 0.24 ? (y - 0.14) / 0.1 : 1;
  return Math.abs(x - 0.5) <= 0.075 * tip;
};
const inGuard = (x, y) => y >= 0.66 && y <= 0.72 && Math.abs(x - 0.5) <= 0.22;
const inGrip = (x, y) => y > 0.72 && y <= 0.84 && Math.abs(x - 0.5) <= 0.045;
const inPommel = (x, y) => (x - 0.5) ** 2 + (y - 0.87) ** 2 <= 0.055 ** 2;

function colorAt(x, y) {
  if (inBlade(x, y) || inGuard(x, y) || inPommel(x, y)) return [240, 196, 84, 255];
  if (inGrip(x, y)) return [120, 72, 30, 255];
  if (inShield(x, y)) {
    const shade = Math.round(40 * (1 - y));
    return [120 + shade, 20, 24, 255];
  }
  return [0, 0, 0, 0];
}

function render(size) {
  const buf = Buffer.alloc(size * size * 4);
  const ss = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = colorAt((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size);
          // Premultiply so transparent samples don't darken edges.
          acc[0] += (c[0] * c[3]) / 255;
          acc[1] += (c[1] * c[3]) / 255;
          acc[2] += (c[2] * c[3]) / 255;
          acc[3] += c[3];
        }
      }
      const n = ss * ss;
      const a = acc[3] / n;
      const i = (py * size + px) * 4;
      buf[i] = a ? Math.round((acc[0] / n) * 255 / a) : 0;
      buf[i + 1] = a ? Math.round((acc[1] / n) * 255 / a) : 0;
      buf[i + 2] = a ? Math.round((acc[2] / n) * 255 / a) : 0;
      buf[i + 3] = Math.round(a);
    }
  }
  return encodePng(size, buf);
}

mkdirSync(join(root, 'icons'), { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writeFileSync(join(root, 'icons', `icon${size}.png`), render(size));
}
console.log('icons written to icons/');
