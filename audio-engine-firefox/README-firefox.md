# Audio Engine — Firefox WebExtension (MV2)

Chrome eklentisinin Firefox portu. UI/UX (glassmorphism popup, EQ, pattern bazlı
kurallar, gruplar, dashboard, i18n, tema) birebir aynıdır; **ses yakalama katmanı
Firefox'a göre tamamen farklıdır** (aşağıya bakın).

## Kurulum

### Geliştirme (geçici yükleme)

```bash
cd audio-engine-firefox
npm install
npm run build
```

Firefox → `about:debugging` → **This Firefox** → **Load Temporary Add-on** →
`dist/manifest.json` seç. (Geçici eklentiler Firefox kapanınca kaldırılır.)

Alternatif — canlı geliştirme:

```bash
npx web-ext run --source-dir dist
```

### Kalıcı kurulum / dağıtım

AMO (addons.mozilla.org) imzası gerekir:

```bash
npx web-ext sign --source-dir dist --api-key=... --api-secret=...
```

veya `about:config` → `xpinstall.signatures.required = false`
(yalnızca Firefox Developer/Nightly).

## Chrome sürümünden mimari farklar

| | Chrome (v5) | Firefox (bu port) |
|---|---|---|
| Manifest | MV3 | MV2 (`browser_action`, kalıcı background page) |
| Ses yakalama | `chrome.tabCapture` + offscreen document | Content script içinde `createMediaElementSource` |
| Ses işleme yeri | Offscreen document (sekme başına stream) | Sayfanın kendisi (content script AudioContext) |
| Durum güvenilirliği | SW uyur, RAM sıfırlanabilir | Kalıcı background page — RAM hep ayakta |
| Tam ekran workaround | Gerekli (capture pencere fullscreen'i bastırır) | **Gereksiz** — doğal fullscreen çalışır |
| İzin akışı | `tabCapture` required permission | Ek izin yok (host izinleri yeterli) |

> **Neden tabCapture değil?** Firefox `chrome.tabCapture` API'sini hiç
> implement etmedi (Bugzilla #1391223, açık). `chrome.offscreen` de yoktur.
> Bu yüzden ses, sayfadaki `<video>/<audio>` elementlerinden Web Audio ile işlenir.

### Ses motoru katmanları (content script)

1. **MediaElementSource** — elementin çıkışı EQ→gain→DRC zincirine yönlendirilir
   (orijinal playback otomatik susar; çift ses olmaz). YouTube/Netflix gibi MSE
   kullanan sitelerde `blob:` src same-origin sayıldığı için sorunsuz çalışır.
2. **srcObject MediaStream** — WebRTC elementleri (Google Meet uzak sesi):
   stream doğrudan bağlanır, element mute edilir. Mikrofon stream'i bir media
   elemente bağlı olmadığından etkilenmez.

### Koruma mekanizmaları

- **DRM (EME) guard** — `el.mediaKeys` dolu olan elementler (Netflix, Spotify
  DRM akışları) atlanır: Web Audio DRM'li sesi sessizleştirir; atlamak orijinal
  sesi korur. Sonuç: video normal oynar, **boost uygulanmaz**.
- **CORS taint guard** — cross-origin + CORS başlıksız yüklenen medya
  `createMediaElementSource`'a bağlanırsa Firefox sesi kalıcı olarak susturur.
  Bu elementler atlanır: orijinal ses korunur, boost uygulanmaz.
- **Nötr geçiş** — `createMediaElementSource` geri alınamaz; "durdur" gain'i
  1.0'a, EQ'yu düze, DRC'yi transparana çeker. Ses orijinal halini alır ama
  Web Audio zinciri sayfa ömrü boyunca yerinde kalır.

## Bilinen kısıtlamalar

- **DRM'li içerikte boost yok** (Netflix, Disney+ vb.) — video bozulmaz,
  yalnızca ses işlenmeden geçer. Chrome sürümü tabCapture sayesinde DRM'li
  sesi de işleyebilir; Firefox'ta platform genelinde bunun karşılığı yok.
- **CORS'suz cross-origin medyada boost yok** — aynı koruma mantığı.
  (MSE kullanan büyük siteler etkilenmez.)
- **iframe içindeki oynatıcılar** boost edilmez (`all_frames: false` —
  Chrome sürümüyle aynı davranış).
- **Autoplay politikası** — sayfayla hiç etkileşim olmadıysa AudioContext
  askıda başlayabilir; ilk tıklama/tuş ile otomatik devam eder.
- **Geçici yükleme** her Firefox açılışında tekrarlanmalı (AMO imzasız).

## Test senaryoları

| Senaryo | Beklenen |
|---|---|
| YouTube: ses artır → EQ ayarla → tam ekran | Boost + EQ çalışır; tam ekran doğal (workaround yok) |
| TikTok: ses artır | Hata yok; MSE'li videolarda boost çalışır, CORS'suz direkt mp4'te ses orijinal kalır |
| Netflix: ses artır | Video kesintisiz oynar; DRM nedeniyle boost uygulanmaz (bilinen kısıt) |
| Google Meet | Uzak ses boost edilir (srcObject katmanı); mikrofon etkilenmez |
| EQ panel | Tüm handle'lar track merkezinde (Chrome fix'i portlandı) |
| about:addons | Eklenti görünür ve aktif |

## web-ext lint durumu

`npx web-ext lint --source-dir dist` → **0 hata**. Kalan uyarılar:

- `UNSAFE_VAR_ASSIGNMENT` (×2) — react-dom'un minify edilmiş bundle'ındaki
  dahili `innerHTML` kullanımı; bizim kodda `innerHTML` yok. React tabanlı
  eklentilerde bilinen zararsız uyarı.
- Android min-version bilgi notu — masaüstü hedefliyoruz.
