# Audio Engine 🎚️ (v5)

Pattern bazlı **ses yükseltici + ekolayzır + DRC** Chrome eklentisi (Manifest V3). Sekmedeki
sesi kurallarla yönetir: `*.youtube.com → %150`, `*.netflix.com → %57` gibi. Kayıtlı kural
olan siteye gidince **popup açmadan otomatik uygulanır** (auto-wake).

v5'te ses yakalama katmanı **tamamen yeniden yazıldı**: artık `chrome.tabCapture` +
**offscreen document** kullanılıyor (endüstri standardı — Volume Master vb.). tabCapture
sekmenin **çıkış miksini** yakaladığı için CORS/tainted sorunu yoktur ve **her sitede**
(TikTok, Netflix, Meet, hdfilmcehennemi…) çalışır — sadece YouTube değil.

> Tasarım kararlarının arka planı için `ARCHITECTURE.md`. Yakalama mimarisi `CLAUDE.md`
> v5.0 spesifikasyonunu uygular.

---

## v5'te yeni neler var?

- 🎯 **Offscreen + tabCapture motoru** — ses işleme tek bir offscreen document'te,
  sekme başına `Map<tabId, TabEngine>` ile yapılır. Background orkestra şefidir; popup
  ince bir görünümdür.
- 🌐 **Her sitede çalışır** — cross-origin `<video>` (TikTok/Netflix) artık CORS'a takılmaz.
- 🔊 **Ses %0–%1000** (`MAX_GAIN = 10`), patlama korumalı yumuşak gain rampası.
- 🛡️ **DRC** ve 🎧 **Mono** — global anahtarlar; aktif yakalamalarda zincir anında yeniden kurulur.
- ⚡ **Auto-Wake** — kayıtlı kuralı olan sekme aktifleşince/yüklenince background sessizce başlatır.
- 🔐 **Tek seferlik izin** — `tabCapture` opsiyonel izindir; kullanıcı bir ses aksiyonu
  yapınca (slider oynatma / kaydet) bir kez istenir, içerik scripti yoktur.
- 📊 **VU metre** — popup açıkken offscreen'den 200ms'de bir seviye okunur; ses varken rozet nabız atar.
- 🌍 **i18n (TR/EN)**, 🎨 **Tema** (Dark/Light), 🔒 **Auth kancaları** (`TierGate`) korunur.

### Korunan davranışlar
- 🎯 Pattern + spesifiklik: `music.youtube.com` (exact) > `*.youtube.com` > `*.com`.
- 👥 Sınırsız grup, sınırsız pattern; site/grup kuralları + global varsayılan.
- 🔒 Sekme izolasyonu (her sekme kendi AudioContext'i); popup değer **tutmaz**, durumu
  background'dan çeker.

---

## Kurulum (geliştirici)

Gereksinim: **Node.js 18+**.

```bash
npm install
npm run build      # dist/ üretir
npm run typecheck  # tsc --noEmit
```

`npm run build` (`build.js` orkestratörü) şu çıktıları üretir:

| # | Bundle | Araç | Çıktı |
|---|--------|------|-------|
| 1 | Popup (React) | Vite | `dist/assets/*` + `dist/src/popup/index.html` |
| 2 | Options (React) | Vite | `dist/assets/*` + `dist/src/options/index.html` |
| 3 | `background/index.ts` | esbuild IIFE | `dist/background.js` |
| 4 | `offscreen/offscreen.ts` | esbuild IIFE | `dist/offscreen/offscreen.js` |

```
dist/
├── manifest.json
├── background.js          # service worker / orkestra şefi (IIFE)
├── offscreen/
│   ├── offscreen.html
│   └── offscreen.js       # Web Audio motoru, sekme başına (IIFE)
├── icons/                 # 16 / 48 / 128 px
├── assets/                # React popup + options bundle'ları
└── src/
    ├── popup/index.html
    └── options/index.html
```

### Chrome'a yükleme
1. `chrome://extensions` aç → sağ üstten **Developer mode**.
2. **Load unpacked** → projedeki **`dist/`** klasörünü seç.
3. Kod değiştirince `npm run build` + eklentiyi **Reload**.

---

## Mimari özet

```
┌──────────┐   komut     ┌────────────┐  target:'offscreen' ┌───────────────────┐
│  Popup   │ ──────────► │ Background │ ──────────────────► │ Offscreen Document │
│ (React)  │  ENABLE /   │  (worker)  │   START / UPDATE /  │  (Web Audio motoru)│
└──────────┘  DISABLE /  └────────────┘   STOP_CAPTURE      └───────────────────┘
     │        UPDATE /          │                                    │
     │        GET_TAB_STATUS    │  getMediaStreamId(tabId)           │ getUserMedia(tab)
     └──── GET_LEVEL ───────────┴──────────────────────────────────►│ gain+EQ+DRC+mono
                            ▲ CAPTURE_ENDED (stream bitince)         │ → destination
```

- **Background**: izin/streamId, offscreen yaşam döngüsü, auto-wake, kural çözümü, sekme
  başına RAM ayarları (`Map<tabId, CaptureSettings>`).
- **Offscreen**: her sekme için tabCapture stream'ini Web Audio ile işler; mono/DRC değişince
  zinciri yeniden bağlar; VU seviyesi döndürür.
- **Popup**: saf görünüm; güç düğmesi = bu sekme için yakalamayı aç/kapat.

### Ses zinciri (offscreen, sekme başına)
```
tabCapture stream
  → BiquadFilter ×5 (EQ: 60/250/1k/4k/12k Hz, ±12dB)
  → GainNode (0–10x / %1000)
  → [mono?  splitter→merger]
  → [drc?   DynamicsCompressor: -24dB / 30 / 12 / 3ms / 250ms]
  → AnalyserNode (VU)
  → destination
```

### Öncelik sırası (precedence)
```
1. Tek seferlik (kullanıcı elle ayarladı; RAM, kaydedilmez)
2. Exact match     (music.youtube.com)
3. Subdomain *.    (*.youtube.com)
4. Geniş wildcard  (*.com / grup pattern'i)
5. Global varsayılan
```
2–4 arası: `score = (literal karakter) − (wildcard × 10)`; yüksek skor kazanır, eşitlikte
exact > site > grup.

---

## Manuel test senaryoları
1. **İzin** — Bir sekmede slider'ı oynat → tek seferlik `tabCapture` izni istenir → ver.
2. **YouTube** %500 → çalışmalı.
3. **TikTok** ses değişimi → çalışmalı (asıl cross-origin testi).
4. **Netflix / Google Meet / hdfilmcehennemi** → çalışmalı.
5. **Mono** toggle → ses tek kanala düşmeli.
6. **VU metre** → ses varken rozet nabız atmalı.
7. **İzolasyon** — İki sekme; biri %200, diğeri %100 → birbirini etkilemez.
8. **Auto-wake** — Kayıtlı kuralı olan siteyi yeni sekmede aç → popup açmadan uygulanmalı.

---

## Bilinen sınırlar
- tabCapture yalnızca **normal web sekmelerinde** çalışır; `chrome://`, Web Store ve eklenti
  sayfaları yakalanamaz.
- İzin verilmeden ses işlenmez — bu bilinçli bir tasarımdır (offscreen + tabCapture gereği).
- Çeviri katkısı: `src/i18n/en.json` → çevir → PR aç **veya** huseyincancalti@gmail.com.

---

## Komutlar
| Komut | Açıklama |
|---|---|
| `npm run build` | `dist/` üretir (Vite + esbuild ×2 + ikon + offscreen.html + manifest). |
| `npm run typecheck` | `tsc --noEmit` ile tip kontrolü. |
