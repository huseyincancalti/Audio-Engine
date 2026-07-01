// build.js — Firefox WebExtension (MV2) bundling orkestratörü
//
//  1) Vite  → popup + options (React, standart build)
//  2) esbuild → background + content (her biri ayrı IIFE; `import` yok)
//     - content: media element tabanlı ses motoru (Firefox'ta tabCapture YOK)
//  3) İkonları üret (dist/icons)
//  4) manifest.json'u dist'e kopyala
//
// Çıktı: dist/  → Firefox'a about:debugging → "Load Temporary Add-on" ile yüklenebilir.

import { build as viteBuild } from "vite";
import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve, sep } from "node:path";
import {
  mkdirSync,
  writeFileSync,
  copyFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import zlib from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const r = (p) => resolve(__dirname, p);
const DIST = r("dist");

async function main() {
  console.log("→ [1/4] Vite build (popup + options)...");
  await viteBuild({ configFile: r("vite.config.ts"), logLevel: "warn" });
  // Firefox düzeltmesi: Vite, extension sayfalarında çalışmayan crossorigin
  // attribute'ları ve dış Google Fonts linkleri üretir. moz-extension:// kaynakları
  // CORS başlığı dönmediği için crossorigin'li CSS yüklenmez (sayfa stilsiz kalır);
  // LibreWolf dış istekleri bloklar. Bu yüzden HTML'i her build'de temizliyoruz.
  fixExtensionHtml();

  console.log("→ [2/4] esbuild (background + content, IIFE)...");
  await esbuild.build({
    entryPoints: {
      background: r("src/background/index.ts"),
      content: r("src/content/index.ts"),
    },
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "firefox115",
    minify: true,
    sourcemap: false,
    legalComments: "none",
    outdir: DIST,
    logLevel: "warning",
  });

  console.log("→ [3/4] İkonlar üretiliyor...");
  generateIcons();

  console.log("→ [4/4] manifest.json kopyalanıyor...");
  const manifestSrc = r("public/manifest.json");
  if (!existsSync(manifestSrc)) throw new Error("public/manifest.json bulunamadı");
  copyFileSync(manifestSrc, resolve(DIST, "manifest.json"));

  console.log("→ [5/5] audio-engine.xpi paketleniyor...");
  const xpiPath = resolve(DIST, "audio-engine.xpi");
  zipDirectory(DIST, xpiPath);

  console.log("\n✅ Build tamamlandı → dist/");
  console.log("   Firefox → about:debugging → This Firefox → 'Load Temporary Add-on' → dist/manifest.json");
  console.log("   Kalıcı kurulum → dist/audio-engine.xpi dosyasını about:addons üzerine sürükle.");
}

// ---------------------------------------------------------------------------
// XPI/ZIP paketleyici — bağımlılıksız, dosya yollarını daima "/" ile yazar.
// PowerShell'in Compress-Archive'ı Windows'ta "\" ayraçlı path üretiyor;
// bu, ZIP spesifikasyonunu ihlal eder ve Firefox'un XPI okuyucusu
// manifest.json'daki "src/popup/index.html" gibi yolları bulamıyor
// ("File not found" hatası). Bu yüzden ZIP'i burada elle, doğru yazıyoruz.
// ---------------------------------------------------------------------------

function listFiles(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listFiles(full, base));
    } else {
      const rel = full.slice(base.length + 1).split(sep).join("/");
      out.push({ full, rel });
    }
  }
  return out;
}

function buildZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const time = 0;
  const date = 0x21; // 1980-01-01 — reproducible build

  for (const { full, rel } of files) {
    const data = readFileSync(full);
    const crc = crc32(data);
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const useCompressed = compressed.length < data.length;
    const method = useCompressed ? 8 : 0;
    const payload = useCompressed ? compressed : data;
    const nameBuf = Buffer.from(rel, "utf8");

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuf, payload);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(date, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + payload.length;
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((s, b) => s + b.length, 0);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, end]);
}

function zipDirectory(dir, outFile) {
  const files = listFiles(dir).filter((f) => resolve(f.full) !== resolve(outFile));
  writeFileSync(outFile, buildZip(files));
}

// ---------------------------------------------------------------------------
// Firefox HTML temizliği — crossorigin attribute'larını ve Google Fonts
// linklerini kaldır (extension sayfalarında çalışmaz / CSS'i kırar).
// ---------------------------------------------------------------------------

function fixExtensionHtml() {
  const files = [
    resolve(DIST, "src/popup/index.html"),
    resolve(DIST, "src/options/index.html"),
  ];
  for (const file of files) {
    if (!existsSync(file)) continue;
    let html = readFileSync(file, "utf8");
    // 1) crossorigin attribute'larını kaldır (bare attribute, değersiz).
    html = html.replace(/\s+crossorigin(?:="[^"]*")?/g, "");
    // 2) Google Fonts <link> etiketlerini kaldır (çok satırlı olabilir).
    html = html.replace(
      /<link\b[^>]*?(?:fonts\.googleapis|fonts\.gstatic)[^>]*>/gi,
      "",
    );
    // 3) Arta kalan boş satırları sadeleştir.
    html = html.replace(/\n\s*\n\s*\n/g, "\n\n");
    writeFileSync(file, html);
  }
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
