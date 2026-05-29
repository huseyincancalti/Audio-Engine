# Audio Engine — Mimari Dokümantasyonu (v2)

> Bu doküman, "Audio Engine" Chrome Eklentisinin sıfırdan kurulacak yeni mimarisini tanımlar.
> v1'deki kronik bug'lar (sekme sızıntısı, popup desync, video bozulması) bu mimaride kökten çözülür.

---

## 1. Amaç

Audio Engine, tarayıcı sekmelerindeki sesi pattern bazlı kurallarla yöneten Manifest V3 eklentisidir. Kullanıcı `*.youtube.com → %150`, `*.netflix.com → %57` gibi kurallar tanımlar; istediğinde tek bir sekme için geçici (kaydedilmeyen) ayar yapar.

Temel felsefe: **Tek Doğru Kaynak (Single Source of Truth) + Net Öncelik Sırası.**
v1'in çöküş sebebi, "hangi ayar geçerli?" sorusunun birden fazla yerde (background cache, content RAM, storage, popup) farklı cevaplanmasıydı. v2'de bu soruyu **sadece content script** cevaplar.

---

## 2. Teknoloji Yığını

* Arayüz: React.js + TailwindCSS
* Dil: TypeScript (strict mode)
* Ses İşleme: Web Audio API (AudioContext, GainNode, BiquadFilterNode)
* Çerçeve: Chrome Extensions API (Manifest V3)
* Bundler: Vite + özel `build.js` (content/background için IIFE çıktısı)

---

## 3. State Modeli — Mimarinin Kalbi

### 3.1 Öncelik Sırası (Precedence)

Bir sekmede ses ayarı çözülürken bu sıra yukarıdan aşağı kontrol edilir. **İlk eşleşen kazanır.**

```
1. Tek seferlik ayar    → bu sekme, şimdi. RAM'de, kaydedilmez.
2. Exact match          → music.youtube.com (en spesifik pattern)
3. Subdomain wildcard   → *.youtube.com
4. Geniş wildcard / grup → *.com veya grubun pattern'i
5. Global varsayılan     → hiçbir kural yoksa
```

### 3.2 Spesifiklik Algoritması

Birden fazla pattern eşleştiğinde "daha spesifik olan" kazanır. Spesifiklik skoru:

```
score = (eşleşen karakter sayısı) - (wildcard sayısı * 10)
```

* Wildcard (`*`) ne kadar azsa o kadar spesifik.
* Eşleşen literal karakter ne kadar çoksa o kadar spesifik.
* En yüksek skorlu pattern kazanır. Eşitlikte exact match önceliklidir.

Örnek: `music.youtube.com` adresinde
* `music.youtube.com` (exact) → score yüksek → KAZANIR
* `*.youtube.com` → score düşük
* `*.com` → en düşük

### 3.3 Tek Doğru Kaynak Kuralı

| Bileşen | Sorumluluk | Yapmayacağı şey |
|---|---|---|
| Content script | Kuralı çözer, tek doğru değeri üretir, AudioEngine'i sürer | — |
| Popup | Sadece okur ve gösterir, slider'la değişiklik gönderir | Kendi kafasından değer TUTMAZ |
| Background | Kuralları storage'dan okur, SPA için cache tutar | Aktif ses değerini HESAPLAMAZ |
| Storage | Sadece kalıcı kuralları saklar | Anlık/geçici değer SAKLAMAZ |

Bu tablo v1'deki desync'i bitirir: popup her açıldığında content'ten çözülmüş değeri çeker (pull), asla varsaymaz.

---

## 4. Grup ve Pattern Sistemi

* Bir **grup**, birden fazla pattern içerir. Gruba tek bir ses/EQ ayarı verilir.
  * örn: "video" grubu → `*.youtube.com`, `*.twitch.tv` → ses %150
* Bir **site kuralı**, tek bir pattern'e özel ayardır. Grubu ezer (daha spesifikse).
* **Tek seferlik ayar**, o anki sekmenin RAM'inde tutulur, kaydedilmez, her şeyi geçici olarak ezer.

Kullanıcı karmaşıklığı görmez: grup açar, içine site ekler, slider oynatır. Spesifiklik algoritması arka planda çalışır.

---

## 5. Sistem Mimarisi ve Katmanlar

### A. Popup (React) — Pure View
* Açıldığında aktif Tab ID'yi bulur, content'e `GET_CURRENT_STATE` gönderir, gelen değeri gösterir.
* Slider oynatıldığında `SET_LIVE_VOLUME` / `SET_LIVE_EQ` gönderir (storage'a yazmaz).
* Butonlar: "Bu site için kaydet", "Bu grup için kaydet", "Tek seferlik".
* Rozetler: Active / Sleeping / Bypassed.

### B. Content Script — Single Source of Truth
* Sayfa yüklendiğinde Idle bekler (Lazy Activation). MutationObserver kullanmaz.
* İlk `SET_*` veya `GET_CURRENT_STATE` sinyalinde uyanır:
  1. Storage'dan kuralları ister (background üzerinden).
  2. Mevcut URL için precedence zincirini çözer.
  3. `<video>`/`<audio>` elementini bulur, AudioEngine'i başlatır.
* Çözülmüş aktif değeri kendi RAM'inde tutar — bu o sekmenin TEK doğrusudur.

### C. Background (Service Worker) — Kural Deposu + SPA Cache
* Storage'daki kuralları okur ve content'e iletir.
* `tabSessionCache` (Map): SPA geçişlerinde (client-side routing) durum kaybını önler.
* `tabs.onRemoved` → ilgili cache temizlenir (garbage collection).
* Aktif ses değerini HESAPLAMAZ — sadece taşır ve cache'ler.

### D. Audio Engine (Web Audio API)
* GainNode (ses) + BiquadFilterNode zinciri (EQ).
* Ses sınırı: maksimum gain kapağı (patlama koruması) — v1'den korunur.

---

## 6. İki Kök Bug ve Çözümleri

### Bug 1 — State Precedence Kaosu (sekme sızıntısı + popup desync)
**Çözüm:** Bölüm 3'teki tek doğru kaynak modeli. Tek seferlik ayar asla storage'a yazılmaz, sadece hedef Tab ID'ye iletilir. Popup değer tutmaz.

### Bug 2 — `createMediaElementSource` Timing (video bozulması / açılışı engelleme)
v1'de element hazır olmadan veya iki kez hook'lanıyordu. **Çözüm kuralları:**
1. Element üzerinde hook olup olmadığını işaretle (`element.dataset.audioEngineHooked`). İkinci kez asla çağırma.
2. Element `readyState >= 1` (HAVE_METADATA) olana kadar bekle; değilse `loadedmetadata` event'ini dinle.
3. `createMediaElementSource` `try-catch` içinde olsun. `DOMException` alınırsa (Google Meet, Prime Video gibi sesi zaten kilitlemiş siteler) → `isBypassed = true`, orijinal ses bozulmadan pass-through.
4. Anti-crackle: ses/EQ değişiminde `setTargetAtTime` ile 15-20ms logaritmik yumuşatma.

---

## 7. İletişim Protokolü (EventBus Contract)

* `WAKE_UP_ENGINE`: Popup → Content (motoru ilk kez başlatır)
* `GET_CURRENT_STATE`: Popup → Content (sekmenin çözülmüş anlık değerini ister)
* `STATE_RESPONSE`: Content → Popup (ses, EQ, aktif kural kaynağı, durum rozeti)
* `SET_LIVE_VOLUME` / `SET_LIVE_EQ`: Popup → Content (slider oynadıkça, storage'a yazmaz)
* `SAVE_RULE`: Popup → Background (site/grup kuralını storage'a yazar)
* `SET_ONE_OFF`: Popup → Content (tek seferlik geçici ayar)
* `SET_POWER_STATE`: Popup → Content (aç/kapat/bypass)

---

## 8. Arayüz — İki Yüzey

### Popup (hızlı kontrol)
O anki sekme için: ses slider'ı, EQ band'ları, durum rozeti, üç kaydetme butonu. Küçük, hızlı.

### Dashboard / Options Sayfası (yönetim)
Grup oluştur/düzenle/sil, pattern ekle/çıkar, tüm kuralları topluca gör, hangi pattern hangi gruba ait. Tam sekme genişliği.

---

## 9. Dosya Ağacı

```text
├── public/
│   └── manifest.json          # Manifest V3
├── src/
│   ├── background/            # service worker, tabSessionCache
│   ├── content/              # DOM etkileşimi, precedence çözücü, DOMException koruması
│   ├── core/
│   │   ├── audio/            # AudioEngine.ts (Web Audio sarıcısı, hook guard)
│   │   ├── messages/        # EventBus.ts (mesaj sözleşmeleri)
│   │   ├── rules/           # PatternMatcher.ts (spesifiklik algoritması), RuleResolver.ts
│   │   └── storage/         # StorageManager.ts (sadece kalıcı kurallar)
│   ├── popup/               # React popup (pure view)
│   ├── options/             # React dashboard (grup/pattern yönetimi)
│   └── types/               # TS arayüzleri, mesaj tipleri
├── build.js                 # IIFE bundling orkestratörü
├── vite.config.ts           # sadece popup + options için
└── package.json
```

---

## 10. İleride Eklenecek (şu an kapsam dışı)
* Mono/stereo ayarı
* AI ile ses temizleme

Bu özellikler için mimari hazır: AudioEngine'e yeni node tipleri eklenir, precedence/storage modeli değişmez.

---

## 11. Gelecek Özellik İçin Kayıtlı Karar
* Ses sınırı kapağı her zaman aktif (patlama koruması).
* Power off'ta node'lar koparılmaz; gain yumuşakça native'e çekilir (ses hattı çökmesin).
* Kurallar dashboard'dan anında silinip global default'a dönülebilir.
