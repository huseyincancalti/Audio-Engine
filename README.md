# Audio Engine 🎚️ (v4)

Pattern bazlı **ses yükseltici + ekolayzır + DRC** Chrome eklentisi (Manifest V3). Sekmedeki
sesi kurallarla yönetir: `*.youtube.com → %150`, `*.netflix.com → %57` gibi. Kayıtlı kural
olan siteye gidince **popup açmadan otomatik uygulanır** (auto-wake). WebRTC tabanlı siteler
(Meet, Discord) için 3 katmanlı ses yakalama içerir.

> Mimari ve tasarım kararları için `ARCHITECTURE.md`. Bu eklenti onun v4 modelini birebir
> uygular: **Tek Doğru Kaynak (content script) + net öncelik sırası + lazy activation.**

---

## v4'te yeni neler var?

- 🔊 **Ses %0–%1000** (`MAX_GAIN = 10`), patlama korumalı yumuşak gain rampası.
- 🛡️ **DRC** — `DynamicsCompressorNode` ile dinamik aralık sıkıştırma (dashboard'dan toggle).
- ⚡ **Auto-Wake** — kayıtlı kural varsa content script kendiliğinden uyanır; popup gerekmez.
  SPA geçişleri (YouTube video değişimi) `tabs.onUpdated` ile izlenir.
- 🎥 **3 Katmanlı ses yakalama** — MediaElement → MediaStream → **WebRTC injection (MAIN world)**
  → Bypass. WebRTC sesi yakalanırken kullanıcıya **hiçbir izin kutusu** çıkmaz.
- 🧠 **Tek seferlik ayar artık sadece RAM'de** — `storage.session` kullanılmaz, sayfa
  yenilenince kaybolur.
- 🌍 **i18n (TR/EN)** — varsayılan Türkçe; dashboard'dan dil değişimi + çeviri katkı akışı.
- 🎨 **Tema** — Dark (Noir+Rose) / Light (Frost+Rose), CSS variable tabanlı.
- 🔒 **Auth kancaları** — `TierGate` (free/premium); premium özellikler şimdilik açık.

### Korunan v2/v3 davranışları
- 🎯 Pattern + spesifiklik: `music.youtube.com` (exact) > `*.youtube.com` > `*.com`.
- 👥 Sınırsız grup, sınırsız pattern.
- 🔌 Güç/Bypass: node'lar koparılmadan gain yumuşakça native'e çekilir.
- 🔒 Sekme izolasyonu; popup değer **tutmaz**, her açılışta content'ten çözülmüş değeri çeker.

---

## Kurulum (geliştirici)

Gereksinim: **Node.js 18+**.

```bash
npm install
npm run build      # dist/ üretir
npm run typecheck  # tsc --noEmit
```

`npm run build` 5 bundle üretir (`build.js` orkestratörü):

| # | Bundle | Araç | Çıktı |
|---|--------|------|-------|
| 1 | Popup (React) | Vite | `dist/assets/*` + `dist/src/popup/index.html` |
| 2 | Options (React) | Vite | `dist/assets/*` + `dist/src/options/index.html` |
| 3 | `content/index.ts` | esbuild IIFE | `dist/content.js` |
| 4 | `background/index.ts` | esbuild IIFE | `dist/background.js` |
| 5 | `content/injected.ts` | esbuild IIFE (MAIN world) | `dist/injected.js` |

```
dist/
├── manifest.json
├── background.js      # service worker (IIFE)
├── content.js         # content script — isolated world (IIFE)
├── injected.js        # WebRTC hook — MAIN world (IIFE)
├── icons/             # 16 / 48 / 128 px
├── assets/            # React popup + options bundle'ları
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
injected.js (MAIN world)  ──postMessage──►  content.js (isolated, TEK doğru kaynak)
  RTCPeerConnection hook                       │ precedence çözer, AudioEngine'i sürer
                                               │
Popup (pure view) ──GET_CURRENT_STATE/SET_*──► content.js
        │                                        ▲
        └──SAVE_RULE──► background ──storage──► (kalıcı kurallar)
                          │  CHECK_URL_RULES'a cevap verir (auto-wake oracle)
                          │  tabs.onUpdated → URL_CHANGED (SPA navigasyon)
                          │  storage.onChanged → RULES_UPDATED / SET_DRC yayını
```

### Ses zinciri
```
kaynak (element / stream / RTC track)
  → BiquadFilter ×5 (EQ: 60/250/1k/4k/12k Hz, ±12dB)
  → GainNode (0–10x / %1000)
  → DynamicsCompressorNode (DRC: -24dB / 30 / 12 / 3ms / 250ms)
  → destination
```

### Öncelik sırası (precedence)
```
1. Tek seferlik    (RAM, kaydedilmez, yenilemede kaybolur)
2. Exact match     (music.youtube.com)
3. Subdomain *.    (*.youtube.com)
4. Geniş wildcard  (*.com / grup pattern'i)
5. Global varsayılan
```
2–4 arası: `score = (literal karakter) − (wildcard × 10)`; yüksek skor kazanır, eşitlikte
exact > site > grup.

---

## Manuel test senaryoları
1. **Auto-wake** — YouTube'da %150 + "Site Kaydet". Yeni sekmede YouTube aç → popup
   açmadan %150 uygulanmış olmalı.
2. **Tek seferlik** — Bir sekmede %80 "Tek Seferlik". Sayfayı yenile → ayar gitmeli, kural
   ayarına dönmeli.
3. **SPA** — YouTube'da video değiştir → ayar sıfırlanmamalı.
4. **WebRTC** — Google Meet'te ses değişikliği dene → çökme olmamalı; en azından konsolda
   `[injected] ... WebRTC hook` logu görünmeli (kural varsa boost devreye girer).
5. **İzolasyon** — İki sekme; biri %200, diğeri %100 → birbirini etkilemez.
6. **Tema** — Dark + Light her elemanda doğru görünmeli.

---

## Bilinen sınırlar
- `all_frames: false` — yalnızca üst çerçevedeki media kontrol edilir.
- CORS başlığı olmayan çapraz-kaynak media Web Audio'dan geçerken Chrome tarafından
  susturulabilir; bu durumda gücü kapatıp (Bypass) sekmeyi yenileyin.
- WebRTC (Katman 3): uzak sesi yakalamak için orijinal `<audio>` öğesi `muted` yapılıp boost'lu
  ses paralel zincirden verilir. Eklenti çalışırken devre dışı bırakılırsa ses, sayfa
  yenilenene kadar susabilir.
- Çeviri katkısı: `src/i18n/en.json` → çevir → PR aç **veya** huseyincancalti@gmail.com.

---

## Komutlar
| Komut | Açıklama |
|---|---|
| `npm run build` | `dist/` üretir (Vite + esbuild ×3 + ikon + manifest). |
| `npm run typecheck` | `tsc --noEmit` ile tip kontrolü. |
