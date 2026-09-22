// Generates simple funnel icons as PNGs with no dependencies (zlib is built into Node).
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y, size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}
// Blue rounded square with a white funnel.
function pixel(x, y, s) {
  const u = (x + 0.5) / s, v = (y + 0.5) / s;
  const r = 0.2; // corner radius
  const cx = Math.min(Math.max(u, r), 1 - r), cy = Math.min(Math.max(v, r), 1 - r);
  const inside = Math.hypot(u - cx, v - cy) <= r;
  if (!inside) return [0, 0, 0, 0];
  // funnel: wide top trapezoid narrowing to a stem
  let white = false;
  if (v >= 0.22 && v <= 0.5) { const half = 0.34 - (v - 0.22) * (0.34 - 0.07) / 0.28; white = Math.abs(u - 0.5) <= half; }
  else if (v > 0.5 && v <= 0.8) { white = Math.abs(u - 0.5) <= 0.07; }
  return white ? [255, 255, 255, 255] : [10, 102, 194, 255];
}
mkdirSync("public/icons", { recursive: true });
for (const s of [16, 48, 128]) writeFileSync(`public/icons/icon${s}.png`, png(s, pixel));
console.log("icons written");
