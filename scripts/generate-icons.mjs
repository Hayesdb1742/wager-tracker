// Generates the PWA / home-screen icons in public/.
//
// Kept in the repo rather than checking in opaque binaries: the icons are a handful of
// shapes and a palette, and the palette is the app's own (slate-950 ground, sky-400 mark,
// the same two colours the admin nav uses). Re-run with `node scripts/generate-icons.mjs`
// after changing anything here.
//
// Writes its own PNGs rather than pulling in a dependency. An RGBA PNG is four chunks and a
// zlib stream, which is less code than the wrapper around a wrapper would be.

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

// ------------------------------------------------------------------ PNG encoding

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  const crcInput = Buffer.concat([Buffer.from(type, "ascii"), data]);
  out.writeUInt32BE(crc32(crcInput), data.length + 8);
  return out;
}

/** `pixels` is RGBA, 4 bytes per pixel, row-major. */
function encodePng(width, height, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // 10-12: deflate, adaptive filtering, no interlace -- all zero.

  // Filter type 0 (none) in front of every scanline.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ drawing

const SLATE_950 = [2, 6, 23];
const SKY_400 = [56, 189, 248];

/** Signed distance from a point to a line segment -- the whole rasteriser, really. */
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Distance from a point to a rounded rectangle's edge; negative inside. */
function distToRoundedRect(px, py, x0, y0, x1, y1, r) {
  const cx = Math.max(x0 + r, Math.min(x1 - r, px));
  const cy = Math.max(y0 + r, Math.min(y1 - r, py));
  const inside = px >= x0 && px <= x1 && py >= y0 && py <= y1;
  const d = Math.hypot(px - cx, py - cy) - r;
  return inside ? Math.min(d, 0) : Math.max(d, 0);
}

function mix(under, over, alpha) {
  return [
    Math.round(under[0] + (over[0] - under[0]) * alpha),
    Math.round(under[1] + (over[1] - under[1]) * alpha),
    Math.round(under[2] + (over[2] - under[2]) * alpha),
  ];
}

/**
 * A rising two-segment trend line on a dark ground, with the last point called out.
 *
 * Full-bleed background on purpose: Android crops a maskable icon to a circle, so the mark
 * stays inside the middle 60% where nothing can clip it.
 */
function drawIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const s = (v) => v * size; // fractions of the icon, so one design scales to every size

  // Polyline points, and the stroke half-width.
  const pts = [
    [s(0.22), s(0.68)],
    [s(0.43), s(0.47)],
    [s(0.62), s(0.58)],
    [s(0.79), s(0.30)],
  ];
  const half = s(0.052);
  const dotR = s(0.082);
  const [dotX, dotY] = pts[pts.length - 1];

  // 3x3 supersampling: enough to keep the diagonals clean at 192px without the cost of more.
  const SS = 3;
  const step = 1 / (SS + 1);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bgHits = 0;
      let markHits = 0;

      for (let sy = 1; sy <= SS; sy++) {
        for (let sx = 1; sx <= SS; sx++) {
          const px = x + sx * step;
          const py = y + sy * step;

          // iOS already rounds the corners of a home-screen icon, so the radius here is
          // gentle -- just enough that the icon reads as a tile on Android too.
          if (distToRoundedRect(px, py, 0, 0, size, size, s(0.18)) <= 0) bgHits++;

          let onMark = Math.hypot(px - dotX, py - dotY) <= dotR;
          if (!onMark) {
            for (let i = 0; i < pts.length - 1 && !onMark; i++) {
              const [ax, ay] = pts[i];
              const [bx, by] = pts[i + 1];
              if (distToSegment(px, py, ax, ay, bx, by) <= half) onMark = true;
            }
          }
          if (onMark) markHits++;
        }
      }

      const total = SS * SS;
      const bgAlpha = bgHits / total;
      const markAlpha = markHits / total;

      const rgb = mix(SLATE_950, SKY_400, markAlpha);
      const i = (y * size + x) * 4;
      pixels[i] = rgb[0];
      pixels[i + 1] = rgb[1];
      pixels[i + 2] = rgb[2];
      pixels[i + 3] = Math.round(255 * bgAlpha);
    }
  }

  return encodePng(size, size, pixels);
}

// ------------------------------------------------------------------ output

const OUT = new URL("../public/", import.meta.url).pathname;

// 192 and 512 are the manifest's two required sizes; 180 is what iOS reads for a home-screen
// icon, and it wants no transparency, so it gets the same art on an opaque tile.
for (const [name, size] of [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["apple-touch-icon.png", 180],
]) {
  const png = drawIcon(size);
  writeFileSync(join(OUT, name), png);
  console.log(`${name.padEnd(22)} ${size}x${size}  ${png.length} bytes`);
}
