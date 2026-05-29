# Audio Engine 🎚️

Pattern bazlı **ses yükseltici + ekolayzır** Chrome eklentisi (Manifest V3). Sekmedeki sesi
kurallarla yönetir: `*.youtube.com → %150`, `*.netflix.com → %57` gibi. İstediğin sekmede
tek seferlik geçici ayar yaparsın; kalıcı kurallar storage'da saklanır.

> Mimari ve tasarım kararları için `ARCHITECTURE.md` dosyasına bakın. Bu eklenti onun
> v2 modelini birebir uygular: **Tek Doğru Kaynak (content script) + net öncelik sırası.**

---

## Özellikler

- 🔊 **Ses yükseltme** — %0–%400 arası (GainNode), patlama korumalı 4x kapak.
- 🎛️ **5 bandlı EQ** — 60 / 230 / 910 / 3.6k / 14k Hz, ±12 dB (BiquadFilterNode).
- 🎯 **Pattern + spesifiklik** — `music.youtube.com` (exact) > `*.youtube.com` > `*.com`.
- 👥 **Gruplar** — birden çok pattern'i tek ayarla yönet.
- ⏱️ **Tek seferlik** — sekmeye özel geçici ayar; storage'a yazılmaz, sekme kapanınca silinir.
- 🔌 **Güç/Bypass** — node'lar koparılmadan gain yumuşakça native'e çekilir.
- 🛡️ **Çökme yok** — ses kilitli sitelerde (`DOMException`) otomatik pass-through.
- 🔒 **Sekme izolasyonu** — her sekmenin durumu birbirinden bağımsız.

---

## Kurulum (geliştirici)

Gereksinim: **Node.js 18+**.

```bash
npm install
npm run build
```

Bu komut `dist/` klasörünü üretir:

```
dist/
├── manifest.json
├── background.js          # service worker (IIFE)
├── content.js             # content script (IIFE)
├── icons/                 # 16 / 48 / 128 px
├── assets/                # React popup + options bundle'ları
└── src/
    ├── popup/index.html
    └── options/index.html
```

### Chrome'a yükleme

1. `chrome://extensions` aç.
2. Sağ üstten **Developer mode**'u aç.
3. **Load unpacked** → projedeki **`dist/`** klasörünü seç.
4. Araç çubuğunda Audio Engine ikonu çıkar. (Kuralları yönetmek için sağ tık → **Options**.)

> Kod değiştirdiğinde `npm run build` çalıştırıp `chrome://extensions`'tan eklentiyi **Reload** et.

---

## Kullanım

### Popup (hızlı kontrol)
Aktif sekme için ses slider'ı, EQ band'ları, durum rozeti (**Active / Sleeping / Bypassed**)
ve üç buton:

| Buton | Ne yapar |
|---|---|
| **Bu site için kaydet** | O an açık host'u (`hostname`) kalıcı site kuralı olarak yazar. |
| **Bu grup için kaydet** | Seçili gruba mevcut host'u ekler + grubun ayarını günceller. |
| **Tek seferlik** | Yalnızca bu sekme için geçici uygular (storage'a yazmaz). |

Popup **değer tutmaz**: her açılışta content script'ten çözülmüş güncel değeri çeker (desync yok).

### Options (yönetim paneli)
- Global varsayılanı düzenle.
- Grup oluştur/yeniden adlandır/sil, gruba pattern ekle/çıkar.
- Site kuralı ekle/sil, ayarlarını düzenle.
- **Tüm Kurallar** tablosu: spesifiklik skoruna göre sıralı tam görünüm.

---

## Öncelik Sırası (precedence)

Bir sekmede ayar çözülürken yukarıdan aşağı kontrol edilir, **ilk eşleşen kazanır**:

```
1. Tek seferlik / canlı override   (RAM, kaydedilmez)
2. Exact match                     (music.youtube.com)
3. Subdomain wildcard              (*.youtube.com)
4. Geniş wildcard / grup           (*.com)
5. Global varsayılan
```

2–4 arası tek bir **spesifiklik yarışmasıyla** çözülür:

```
score = (literal karakter sayısı) − (wildcard sayısı × 10)
```

En yüksek skor kazanır; eşitlikte exact match, sonra site kuralı önceliklidir.

---

## Manuel test senaryoları

1. **YouTube %150 + kaydet** — YouTube'da slider'ı %150 yap, “Bu site için kaydet”. Sayfayı
   yenile → otomatik %150 uygulanır.
2. **Netflix grubu %57** — Options'tan “Video” grubu yerine ayrı bir grup oluştur, `*.netflix.com`
   ekle, %57 ver. Netflix'te ses iner.
3. **Tek seferlik %80** — Bir sekmede %80 “Tek seferlik”. Sayfayı yenile → %80 kalır. Sekmeyi
   kapatıp aynı siteyi tekrar aç → grup/kural ayarına döner.
4. **İzolasyon** — İki sekme aç; birinde %200, diğerinde %100. Biri diğerini etkilemez.
5. **Desync yok** — Popup'ı kapatıp tekrar aç → her zaman güncel değer görünür.
6. **Kilitli site** — Google Meet'te eklenti çökmez; rozet **Bypassed**, ses bozulmaz.

---

## Mimari özet

```
Popup (pure view) ──GET_CURRENT_STATE / SET_*──► Content (TEK doğru kaynak)
        │                                              │ precedence çözer, AudioEngine'i sürer
        └──SAVE_RULE──► Background ──storage──► (kalıcı kurallar)
                          │  tabSessionCache (storage.session): tek seferlik ayar reload'a dayanır,
                          │  sekme kapanınca silinir.
```

- **Content** kuralı çözer, AudioEngine'i sürer (Web Audio API).
- **Popup** sadece okur + slider değişikliklerini push eder.
- **Background** kuralları taşır ve sekme oturumunu cache'ler; ses değeri **hesaplamaz**.
- **Storage** yalnızca kalıcı kuralları tutar.

### Teknoloji
TypeScript (strict) · React + TailwindCSS · Web Audio API · Vite (popup/options) +
esbuild (content/background IIFE) · özel `build.js` orkestratörü.

---

## Komutlar

| Komut | Açıklama |
|---|---|
| `npm run build` | `dist/` üretir (Vite + esbuild + ikon + manifest). |
| `npm run typecheck` | `tsc --noEmit` ile tip kontrolü. |

---

## Bilinen sınırlar

- `all_frames: false` — yalnızca üst çerçevedeki media kontrol edilir (YouTube/Netflix/Twitch
  ana sayfaları kapsanır; üçüncü taraf gömülü iframe player'ları kapsam dışıdır).
- CORS başlığı olmayan çapraz-kaynak media Web Audio'dan geçerken Chrome tarafından
  susturulabilir; bu durumda gücü kapatıp (Bypass) sekmeyi yenileyin.
- İleride: mono/stereo ve AI ses temizleme (mimari hazır, kapsam dışı).
