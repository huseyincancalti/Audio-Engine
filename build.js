// build.js — IIFE bundling orkestratörü (v5.0 offscreen + tabCapture)
//
//  1) Vite  → popup + options (React, standart build)
//  2) esbuild → background + content + offscreen (her biri ayrı IIFE; `import` yok)
//     - offscreen: tabCapture stream'ini Web Audio ile işler (CLAUDE.md)
//     - content: yalnızca fullscreen senkronu (ses işlemez)
//  3) İkonları üret (dist/icons)
//  4) offscreen.html + manifest.json'u dist'e kopyala
//
// Çıktı: dist/  → Chrome'a "unpacked extension" olarak yüklenebilir.

import { build as viteBuild } from "vite";
import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import zlib from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const r = (p) => resolve(__dirname, p);
const DIST = r("dist");

async function main() {
  console.log("→ [1/4] Vite build (popup + options)...");
  await viteBuild({ configFile: r("vite.config.ts"), logLevel: "warn" });

  console.log("→ [2/4] esbuild (background + offscreen, IIFE)...");
  await esbuild.build({
    entryPoints: {
      background: r("src/background/index.ts"),
      content: r("src/content/index.ts"),
      "offscreen/offscreen": r("src/offscreen/offscreen.ts"),
    },
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome110",
    minify: true,
    sourcemap: false,
    legalComments: "none",
    outdir: DIST,
    logLevel: "warning",
  });

  console.log("→ [3/4] İkonlar üretiliyor...");
  generateIcons();

  console.log("→ [4/4] offscreen.html + manifest.json kopyalanıyor...");
  const offscreenSrc = r("src/offscreen/offscreen.html");
  if (!existsSync(offscreenSrc)) throw new Error("src/offscreen/offscreen.html bulunamadı");
  mkdirSync(resolve(DIST, "offscreen"), { recursive: true });
  copyFileSync(offscreenSrc, resolve(DIST, "offscreen", "offscreen.html"));

  const manifestSrc = r("public/manifest.json");
  if (!existsSync(manifestSrc)) throw new Error("public/manifest.json bulunamadı");
  copyFileSync(manifestSrc, resolve(DIST, "manifest.json"));

  console.log("\n✅ Build tamamlandı → dist/");
  console.log("   Chrome → chrome://extensions → Developer mode → 'Load unpacked' → dist/");
}

// ---------------------------------------------------------------------------
// İkon üretimi — bağımlılıksız PNG kodlayıcı (truecolor + alpha).
// EQ çubukları görselli, marka renginde basit bir logo üretir.
// ---------------------------------------------------------------------------

function generateIcons() {
  const iconsDir = resolve(DIST, "icons");
  mkdirSync(iconsDir, { recursive: true });
  for (const size of [16, 48, 128]) {
    const png = makeIcon(size);
    writeFileSync(resolve(iconsDir, `icon${size}.png`), png);
  }
}

function makeIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const bg = [79, 70, 229]; // brand-600
  for (let i = 0; i < size * size; i++) {
    px[i * 4] = bg[0];
    px[i * 4 + 1] = bg[1];
    px[i * 4 + 2] = bg[2];
    px[i * 4 + 3] = 255;
  }
  const bars = 4;
  const margin = Math.max(1, Math.round(size * 0.2));
  const inner = size - 2 * margin;
  const gap = Math.max(1, Math.round(inner * 0.09));
  const barW = Math.max(1, Math.round((inner - (bars - 1) * gap) / bars));
  const heights = [0.5, 0.9, 0.4, 0.72];
  for (let b = 0; b < bars; b++) {
    const x0 = margin + b * (barW + gap);
    const h = Math.max(1, Math.round(inner * heights[b]));
    const y0 = size - margin - h;
    for (let y = y0; y < size - margin; y++) {
      for (let x = x0; x < x0 + barW; x++) {
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        const i = (y * size + x) * 4;
        px[i] = 255;
        px[i + 1] = 255;
        px[i + 2] = 255;
        px[i + 3] = 255;
      }
    }
  }
  return encodePng(size, size, px);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: truecolor + alpha
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    raw[pos++] = 0; // filter: none
    rgba.copy(raw, pos, y * width * 4, (y + 1) * width * 4);
    pos += width * 4;
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

main().catch((err) => {
  console.error("\n❌ Build hatası:", err);
  process.exit(1);
});
