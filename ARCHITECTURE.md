# Audio Engine — Mimari Dokümantasyonu (v4)

> v3'ten v4'e eklenenler: 3 katmanlı ses yakalama (WebRTC desteği),
> auto-wake (kayıtlı kural varsa otomatik uyanma), tek seferlik ayar RAM'e taşındı.

---

## 1. Amaç ve İş Modeli

Audio Engine, tarayıcı sekmelerindeki sesi pattern bazlı kurallarla yöneten
Manifest V3 eklentisidir.

### 1.1 Open Core Modeli

```
FREE (sınırsız)          PREMIUM (ileride, API maliyeti olanlar)
────────────────         ──────────────────────────────────────
Ses ayarı (%1000)        AI ses temizleme
EQ (5 band)              Bulut senkronizasyonu
DRC                      İleride eklenecek AI özellikleri
Sınırsız grup
Sınırsız pattern
Tema (dark/light)
i18n (TR/EN)
Tek seferlik ayar
WebRTC ses yakalama
```

### 1.2 Ödeme Altyapısı (ileride)
Lemon Squeezy. Şu an kanca hazır, entegrasyon yok.

---

## 2. Teknoloji Yığını

* Arayüz: React.js + TailwindCSS
* Fontlar: DM Sans (300/400/500/600) + DM Mono (300/400/500)
* Dil: TypeScript (strict mode)
* Ses İşleme: Web Audio API (AudioContext, GainNode,
  DynamicsCompressorNode, BiquadFilterNode)
* Auth: Supabase (şu an boş kanca)
* Çerçeve: Chrome Extensions API (Manifest V3)
* Bundler: Vite + özel build.js (content/background IIFE)

---

## 3. State Modeli — Mimarinin Kalbi

### 3.1 Öncelik Sırası (Precedence)

```
1. Tek seferlik ayar     → bu sekme, sadece RAM, kaydedilmez,
                           sayfa yenilenince KAYBOLUR
2. Exact match           → music.youtube.com
3. Subdomain wildcard    → *.youtube.com
4. Geniş wildcard / grup → *.com veya grubun pattern'i
5. Global varsayılan     → hiçbir kural yoksa
```

### 3.2 Spesifiklik Algoritması

```
score = (eşleşen karakter sayısı) - (wildcard sayısı * 10)
```

En yüksek skor kazanır. Eşitlikte exact match önceliklidir.

### 3.3 Tek Doğru Kaynak Kuralı

| Bileşen        | Sorumluluk                                      | Yapmayacağı şey               |
|----------------|-------------------------------------------------|-------------------------------|
| Content script | Kuralı çözer, tek doğru değeri üretir           | —                             |
| Popup          | Sadece okur/gösterir, slider değişiklik gönderir| Kendi kafasından değer TUTMAZ |
| Background     | Kuralları storage'dan okur, SPA cache tutar     | Aktif ses değeri HESAPLAMAZ   |
| Storage        | Kalıcı kuralları + ayarları saklar              | Tek seferlik ayar SAKLAMAZ    |

---

## 4. Auto-Wake Sistemi (v4 — kritik değişiklik)

### 4.1 Problem (v3)
v3'te content script tamamen pasifti — sadece popup'tan `WAKE_UP_ENGINE`
gelince uyanıyordu. Kullanıcı kayıtlı kural olan bir siteye gittiğinde
popup'u açmadan geçerse ayar uygulanmıyordu.

### 4.2 Çözüm: Kayıtlı Kural Varsa Otomatik Uyan

```
Content script yüklenir (sayfa açıldı)
        ↓
Background'a sor: CHECK_URL_RULES (mevcut URL)
        ↓
    EVET: kural var              HAYIR: kural yok
         ↓                             ↓
  Otomatik uyan               Idle (Sleeping) modunda bekle
  AudioEngine başlat          Popup'tan WAKE_UP_ENGINE gelince uyanır
  Kuralı uygula
```

Felsefe korunuyor: "lazy activation" — ama kayıtlı kural varsa kullanıcı
müdahalesi gerekmeksizin sessizce çalışır.

### 4.3 Yeni EventBus Mesajı

```
CHECK_URL_RULES: Content → Background
  → payload: { url: string, tabId: number }
  → response: { hasRule: boolean, settings: AudioSettings | null }
```

### 4.4 SPA Geçişlerinde Auto-Wake

YouTube gibi client-side routing yapan sitelerde URL değişince content
script yeniden yüklenmez. Background'daki `tabSessionCache` URL değişimini
`tabs.onUpdated` ile izler ve content script'e `URL_CHANGED` mesajı gönderir.
Content script bu mesajda yeni URL için CHECK_URL_RULES döngüsünü tekrar çalıştırır.

---

## 5. 3 Katmanlı Ses Yakalama (v4 — WebRTC desteği)

### 5.1 Neden Gerekli?
Meet, Zoom, Discord gibi uygulamalar sesi WebRTC MediaStream üzerinden çalıştırır.
`createMediaElementSource` bu sese ulaşamaz ve bypass'a düşer.

### 5.2 Katman Sırası (waterfall)

```
KATMAN 1 — MediaElementSource (standart)
  → <video>/<audio> elementi var ve erişilebilir
  → createMediaElementSource ile yakala
  → Başarısızsa → Katman 2

KATMAN 2 — MediaStreamSource
  → Elementin srcObject'i MediaStream ise
  → createMediaStreamSource ile yakala
  → Başarısızsa → Katman 3

KATMAN 3 — Page Script Injection (WebRTC)
  → Content script, sayfa bağlamına bir <script> inject eder
  → Injected script, RTCPeerConnection.prototype'ı wrap'ler
  → Yeni ses track'leri oluştuğunda postMessage ile bildirir
  → Content script AudioEngine'i MediaStream ile başlatır
  → Kullanıcıya HİÇBİR izin kutusu gösterilmez
  → Başarısızsa → Bypass

BYPASS (son çare)
  → isBypassed = true
  → Popup'ta açıklayıcı mesaj: "Bu site ses işlemeye izin vermiyor"
  → Orijinal ses bozulmadan devam eder
```

### 5.3 Injection Güvenliği

Injected script sadece `RTCPeerConnection` track'lerini dinler, veri okumaz.
Sayfa kapanınca temizlenir. `world: 'MAIN'` execution context kullanılır.
manifest.json'da `"world": "MAIN"` ile tanımlanır.

### 5.4 Hook Guard (v2'den korunur, tüm katmanlar için)

* `element.dataset.audioEngineHooked` — MediaElement için
* `WeakSet<MediaStream>` — MediaStream için
* `window.__audioEngineRTCHooked` — RTCPeerConnection için
Her kaynak sadece BİR KEZ hook'lanır.

---

## 6. Grup ve Pattern Sistemi

### 6.1 Grup
* İsim + renk seçici (8-10 preset + özel hex)
* Sınırsız grup, sınırsız pattern

### 6.2 Pattern Girişi — URL → Pattern Dönüşümü

```
Kullanıcı girer:   youtube.com
Sistem üretir:     *.youtube.com
Açıklama:          "YouTube'un tüm sayfaları için geçerli"
```

Manuel pattern girişi de desteklenir. Her pattern yanında "i" ikonu.

### 6.3 Çakışma Göstergesi
İki pattern aynı URL'e eşleşiyorsa kullanıcıya görünür uyarı gösterilir.

---

## 7. Auth Katmanı — Supabase Kancası

```typescript
interface UserProfile {
  userId: string | null        // default: null
  tier: 'free' | 'premium'    // default: 'free'
  email: string | null
}
```

```typescript
// src/core/auth/TierGate.ts
export function canUseFeature(
  feature: 'ai' | 'cloud_sync',
  tier: 'free' | 'premium'
): boolean {
  const premiumFeatures = ['ai', 'cloud_sync']
  return tier === 'premium' || !premiumFeatures.includes(feature)
}
```

---

## 8. Ses Motoru

### 8.1 Audio Node Zinciri

```
MediaElementSource / MediaStreamSource / RTCTrack
      ↓
  GainNode          ← ses seviyesi (0 — 10x / %1000)
      ↓
DynamicsCompressorNode  ← patlama koruması (DRC)
      ↓
AudioContext.destination
```

### 8.2 Parametreler

**GainNode:** MAX_GAIN = 10 (%1000), setTargetAtTime 18ms anti-crackle

**DRC:** threshold -24dB, knee 30dB, ratio 12, attack 0.003s, release 0.25s
Dashboard toggle: `drcEnabled: boolean`. Power off'ta DRC de devre dışı.

---

## 9. i18n Sistemi

```
src/i18n/
  index.ts     ← t(key), setLanguage(), aktif dil yönetimi
  tr.json      ← Türkçe (varsayılan)
  en.json      ← İngilizce
```

Dil seçici: dropdown. "Çeviri katkısı" seçeneği:
* GitHub PR yolu (fork → çevir → PR aç)
* E-posta yolu (en.json → çevir → gönder)

---

## 10. UX Kuralları

### 10.1 Auto-Wake Durumunda UI
Auto-wake ile uyanınca popup rozeti otomatik "Active" gösterir.
Kullanıcı popup'u açmadan da ayar uygulanmış olur.

### 10.2 Tek Seferlik Davranışı (v4)
* Sadece content script RAM'inde — `storage.session`'a YAZILMAZ
* Sayfa yenilenince kaybolur, precedence kurala döner
* Sekme kapanınca zaten kaybolur

### 10.3 WebRTC Katmanı UI
Katman 3 (injection) çalışıyorsa popup'ta küçük gösterge:
"WebRTC modu" badge'i — kullanıcıya teknik detay değil, sadece
"gelişmiş mod aktif" mesajı.

### 10.4 Boş Durum
Hiç grup yoksa "İlk grubunu oluştur" ekranı. Popup'ta "Ayar kaydet" yönlendirmesi.

### 10.5 Onboarding
`onboardingCompleted: boolean`. İlk açılışta dashboard "Başlangıç" ekranı
default olarak gelir. Pattern kavramı büyük kutuda, öncelik sırası küçük badge'ler.

### 10.6 Geri Alma
Silme: 5 saniye undo penceresi, toast mesajı.

### 10.7 Çakışma
İki kural eşleşiyorsa popup'ta ve dashboard'da uyarı.

---

## 11. İletişim Protokolü (EventBus)

```
WAKE_UP_ENGINE      Popup → Content (manuel uyanma)
CHECK_URL_RULES     Content → Background (auto-wake sorgusu)
URL_CHANGED         Background → Content (SPA navigasyon)
GET_CURRENT_STATE   Popup → Content
STATE_RESPONSE      Content → Popup (ses, EQ, kural kaynağı, rozet, katman)
SET_LIVE_VOLUME     Popup → Content (storage'a yazmaz)
SET_LIVE_EQ         Popup → Content (storage'a yazmaz)
SAVE_RULE           Popup → Background (kalıcı kural)
SET_ONE_OFF         Popup → Content (RAM'e, storage'a değil)
SET_POWER_STATE     Popup → Content
RULES_UPDATED       Background → Content (re-resolve tetikler)
SET_DRC             Popup/Options → Content
```

---

## 12. Dosya Ağacı

```text
├── public/
│   └── manifest.json
├── src/
│   ├── background/
│   │   └── index.ts         # service worker, tabSessionCache, URL izleme
│   ├── content/
│   │   ├── index.ts         # auto-wake, precedence çözücü, katman waterfall
│   │   └── injected.ts      # RTCPeerConnection wrapper (MAIN world)
│   ├── core/
│   │   ├── audio/
│   │   │   └── AudioEngine.ts  # GainNode+DRC+EQ, 3 katman hook, guard
│   │   ├── auth/
│   │   │   └── TierGate.ts
│   │   ├── messages/
│   │   │   └── EventBus.ts
│   │   ├── rules/
│   │   │   ├── PatternMatcher.ts
│   │   │   └── RuleResolver.ts
│   │   └── storage/
│   │       └── StorageManager.ts
│   ├── i18n/
│   │   ├── index.ts
│   │   ├── tr.json
│   │   └── en.json
│   ├── popup/               # React, pure view, 360px
│   ├── options/             # React dashboard, sol sidebar
│   ├── components/
│   │   ├── Toast.tsx
│   │   ├── Tooltip.tsx
│   │   ├── ColorPicker.tsx
│   │   ├── PatternInput.tsx
│   │   ├── EmptyState.tsx
│   │   └── ContribModal.tsx
│   └── types/
├── build.js                 # popup/options: Vite, content/background: esbuild IIFE
│                            # injected.ts: ayrı IIFE bundle (MAIN world)
├── vite.config.ts
└── package.json
```

---

## 13. StorageManager — Tam Veri Modeli

```typescript
interface StorageSchema {
  // Auth (kanca)
  userId: string | null
  tier: 'free' | 'premium'
  email: string | null

  // Ayarlar
  theme: 'dark' | 'light'
  language: 'tr' | 'en'
  drcEnabled: boolean
  onboardingCompleted: boolean

  // Kurallar
  groups: Group[]
  siteRules: SiteRule[]
  globalDefault: AudioSettings
}

// NOT: Tek seferlik ayar storage'a HİÇ yazılmaz.
// Content script RAM'inde: Map<tabId, AudioSettings>

interface Group {
  id: string
  name: string
  color: string
  patterns: string[]
  settings: AudioSettings
}

interface SiteRule {
  id: string
  pattern: string
  settings: AudioSettings
}

interface AudioSettings {
  volume: number        // 0-10 (10 = %1000)
  eq: EQBand[]
  drcEnabled: boolean
}
```

---

## 14. Kayıtlı Mimari Kararlar

* MAX_GAIN = 10 (%1000)
* Power off: gain yumuşakça 1.0'a, node koparılmaz
* DRC zincirde kalır, toggle sadece bypass eder
* Tek seferlik: sadece RAM, storage.session YOK, yenilemede silinir
* Auto-wake: kayıtlı kural varsa popup gerekmez
* WebRTC: page injection, kullanıcıya izin kutusu yok
* Katman waterfall: MediaElement → MediaStream → WebRTC injection → Bypass
* Pattern: URL → wildcard otomatik, manuel de desteklenir
* Çakışma görünür uyarı
* Geri alma: 5 saniye undo
* Grup/pattern sınırı yok (free tier)
* Onboarding: tek seferlik, "Başlangıç" default ekran

---

## 15. İleride Eklenecek (Kapsam Dışı)

* Supabase auth entegrasyonu
* AI ses temizleme
* Bulut senkronizasyon
* Lemon Squeezy ödeme
* Mono/stereo ayarı
* Ek diller (i18n hazır)
