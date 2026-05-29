# Audio Engine — Mimari Dokümantasyonu (v3)

> v2'den v3'e eklenenler: iş modeli + auth katmanı + premium kancaları + DRC +
> %1000 ses sınırı + i18n + UX iyileştirmeleri + UI sistemi.
> Tüm yeni özellikler geriye dönük uyumludur; v2'nin çekirdek mimarisi korunur.

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
```

Kural: Sana MALİYETİ OLAN şeyler premium. Grup/pattern sayısına limit yok —
kullanıcıyı gereksiz kısıtlamak değer katmaz. Gelir AI servisinden gelecek.

### 1.2 Ödeme Altyapısı (ileride)

Lemon Squeezy — merchant of record, KDV/vergi onlar halleder, Türk kartları
desteklenir. Şu an entegrasyon yok, mimari kanca hazır.

---

## 2. Teknoloji Yığını

* Arayüz: React.js + TailwindCSS
* Fontlar: DM Sans (300/400/500/600) + DM Mono (300/400/500) — Google Fonts
* Dil: TypeScript (strict mode)
* Ses İşleme: Web Audio API (AudioContext, GainNode, DynamicsCompressorNode,
  BiquadFilterNode)
* Auth: Supabase (şu an boş kanca — entegrasyon ileride)
* Çerçeve: Chrome Extensions API (Manifest V3)
* Bundler: Vite + özel build.js (content/background için IIFE çıktısı)

---

## 3. State Modeli — Mimarinin Kalbi (v2'den korunur)

### 3.1 Öncelik Sırası (Precedence)

İlk eşleşen kazanır:

```
1. Tek seferlik ayar     → bu sekme, RAM'de, kaydedilmez
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

| Bileşen        | Sorumluluk                                      | Yapmayacağı şey            |
|----------------|-------------------------------------------------|----------------------------|
| Content script | Kuralı çözer, tek doğru değeri üretir           | —                          |
| Popup          | Sadece okur/gösterir, slider değişiklik gönderir| Kendi kafasından değer TUTMAZ |
| Background     | Kuralları storage'dan okur, SPA cache tutar     | Aktif ses değeri HESAPLAMAZ|
| Storage        | Kalıcı kuralları + ayarları saklar              | Anlık/geçici değer SAKLAMAZ|

---

## 4. Grup ve Pattern Sistemi (v3 güncellemesi)

### 4.1 Grup

* İsim + renk seçici (8-10 preset + özel hex girişi)
* İkon yok (şimdilik kapsam dışı)
* Sınırsız grup

### 4.2 Pattern Girişi — URL → Pattern Dönüşümü

Kullanıcı pattern syntax'ı öğrenmek zorunda değil:

```
Kullanıcı girer:   youtube.com
Sistem üretir:     *.youtube.com
Açıklama gösterir: "YouTube'un tüm sayfaları için geçerli"
```

* Manuel pattern girişi de desteklenir (teknik kullanıcılar için)
* Her pattern yanında "i" ikonu → açıklama tooltip'i
  * örn: `*.youtube.com` → "youtube.com ve tüm alt domainleri kapsar"
* Sınırsız pattern

### 4.3 Çakışma Göstergesi

İki pattern aynı URL'e eşleşiyorsa kullanıcıya görünür uyarı:
"Bu site 2 kuralla eşleşiyor — [daha spesifik olan] geçerli"

---

## 5. Auth Katmanı — Supabase (Kanca Hazır, Entegrasyon İleride)

### 5.1 Veri Modeli

StorageManager'da şu alanlar bulunur (şu an boş/default):

```typescript
interface UserProfile {
  userId: string | null        // Supabase user id — şimdilik null
  tier: 'free' | 'premium'    // şimdilik her zaman 'free'
  email: string | null         // şimdilik null
}
```

### 5.2 Tier Kontrolü

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

Şu an her kullanıcı 'free', her özellik açık. Supabase entegrasyonu
geldiğinde sadece bu fonksiyon güncellenir — başka hiçbir şey değişmez.

### 5.3 Premium İşaretleme

Premium olacak UI elementleri şimdilik `data-premium="true"` ile işaretlenir.
Kilitli görünür ama işlevseldir — ileride gerçek kontrol buraya gelir.

---

## 6. Ses Motoru (v3 güncellemeleri)

### 6.1 Audio Node Zinciri

```
MediaElementSource
      ↓
  GainNode          ← ses seviyesi (0 — 10x / %1000)
      ↓
DynamicsCompressorNode  ← patlama koruması (DRC)
      ↓
AudioContext.destination
```

### 6.2 Parametreler

**GainNode:**
* MAX_GAIN = 10 (= %1000)
* Anti-crackle: setTargetAtTime ile 15-20ms logaritmik yumuşatma

**DynamicsCompressorNode (sabit, kullanıcı değiştirmez):**
* threshold: -24 dB
* knee: 30 dB
* ratio: 12
* attack: 0.003 s
* release: 0.25 s

Dashboard'da DRC toggle var (açık/kapalı). StorageManager'a `drcEnabled: boolean` eklenir.
Power off durumunda DRC de devre dışı.

### 6.3 Hook Guard (v2'den korunur)

* `element.dataset.audioEngineHooked` — ikinci hook'u engeller
* `readyState >= 1` bekle, yoksa `loadedmetadata` dinle
* DOMException → `isBypassed = true`, pass-through

---

## 7. i18n Sistemi

```
src/i18n/
  index.ts     ← t(key) fonksiyonu, setLanguage(), aktif dil yönetimi
  tr.json      ← Türkçe (varsayılan)
  en.json      ← İngilizce
```

* `t('vol.label')` → "Ses" veya "Volume"
* `setLanguage('en')` → StorageManager'a yazar, tüm UI anında güncellenir
* Yeni dil eklemek = sadece yeni JSON dosyası
* Dil seçici: dropdown (chip değil) — ileride dil sayısı artınca temiz kalır
* Varsayılan: 'tr'

---

## 8. UX Kuralları

### 8.1 Boş Durum

Hiç grup yoksa dashboard "İlk grubunu oluştur" ekranı gösterir.
Hiç kural yokken popup "Ayar kaydetmek için butonları kullan" mesajı gösterir.

### 8.2 Onboarding (İlk Açılış)

`StorageManager`'da `onboardingCompleted: boolean` alanı.
İlk açılışta popup 3 adımlı kısa rehber gösterir:
1. "Ses slider'ını oynат"
2. "Bu site için kaydet'e bas"
3. "Dashboard'dan grup oluştur"
Sonraki açılışlarda gösterilmez.

### 8.3 Geri Alma (Undo Toast)

Grup veya kural silindiğinde:
* Kalıcı silme 5 saniye ertelenir
* "Silindi. Geri al" toast mesajı gösterilir
* Kullanıcı "Geri al"a basarsa işlem iptal edilir
* 5 saniye geçerse kalıcı silinir

### 8.4 Aktif Kural Kaynağı (Popup)

Popup'ta site pill'in yanında kaynak göstergesi:
* "video grubundan" → grup kuralı geçerli
* "site kuralı" → exact match geçerli
* "tek seferlik" → geçici ayar aktif
* "varsayılan" → hiç kural yok

---

## 9. UI Sistemi

### 9.1 Tema

Dark ve Light, `document.body.className = 'theme-dark' | 'theme-light'` ile anlık geçiş.
StorageManager'a `theme: 'dark' | 'light'` yazılır.

**Dark (Noir + Rose):**
```css
--bg-base: #1A0A0A;
--bg-glass: rgba(26,10,10,0.82);
--bg-card: rgba(255,255,255,0.03);
--border-primary: rgba(232,114,154,0.18);
--border-secondary: rgba(255,255,255,0.06);
--text-primary: rgba(255,255,255,0.9);
--text-secondary: rgba(255,255,255,0.4);
--text-tertiary: rgba(255,255,255,0.2);
--rose: #E8729A;
--rose-dim: rgba(232,114,154,0.15);
--success: #4ade80;
--warning: #fbbf24;
--danger: rgba(239,68,68,0.7);
```

**Light (Frost + Rose):**
```css
--bg-base: #E4F0F6;
--bg-glass: rgba(228,240,246,0.78);
--bg-card: rgba(255,255,255,0.6);
--border-primary: rgba(232,114,154,0.25);
--border-secondary: rgba(26,10,10,0.08);
--text-primary: rgba(26,10,10,0.9);
--text-secondary: rgba(26,10,10,0.5);
--text-tertiary: rgba(26,10,10,0.3);
--rose: #E8729A;
--rose-dim: rgba(232,114,154,0.12);
--success: #16a34a;
--warning: #d97706;
--danger: rgba(220,38,38,0.7);
```

### 9.2 Glassmorphism Kuralları

```css
backdrop-filter: blur(24px);
background: var(--bg-glass);
border: 1px solid var(--border-primary);
```

Opaklık dengesi: container'lar %80-85, iç kartlar %60-70, hover %75-80.
Her temada okunabilirlik kontrolü zorunlu (WCAG AA minimum kontrast).

### 9.3 Popup Boyutu

Genişlik: 360px (sabit)
Yükseklik: max 580px, scroll yok — içerik sığmalı

### 9.4 Uyarı Renkleri

Sistem genelinde:
* Hata / silme / kritik: `--danger` (kırmızı tonu)
* Bypass / dikkat: `--warning` (amber)
* Aktif / başarı: `--success` (yeşil)
* Premium / kilitli: `--rose` + 🔒 ikonu

---

## 10. İletişim Protokolü (EventBus Contract)

* `WAKE_UP_ENGINE`: Popup → Content
* `GET_CURRENT_STATE`: Popup → Content
* `STATE_RESPONSE`: Content → Popup (ses, EQ, aktif kural kaynağı, rozet)
* `SET_LIVE_VOLUME` / `SET_LIVE_EQ`: Popup → Content (storage'a yazmaz)
* `SAVE_RULE`: Popup → Background (site/grup kuralı storage'a)
* `SET_ONE_OFF`: Popup → Content (geçici ayar)
* `SET_POWER_STATE`: Popup → Content
* `RULES_UPDATED`: Background → Content (kural değişince re-resolve tetikler)
* `SET_DRC`: Popup/Options → Content (DRC aç/kapat)

---

## 11. Dosya Ağacı

```text
├── public/
│   └── manifest.json
├── src/
│   ├── background/          # service worker, tabSessionCache
│   ├── content/             # DOM, precedence çözücü, DOMException koruması
│   ├── core/
│   │   ├── audio/           # AudioEngine.ts (GainNode+DRC+EQ, hook guard)
│   │   ├── auth/            # TierGate.ts (şimdilik boş kanca)
│   │   ├── messages/        # EventBus.ts
│   │   ├── rules/           # PatternMatcher.ts, RuleResolver.ts
│   │   └── storage/         # StorageManager.ts
│   ├── i18n/                # index.ts, tr.json, en.json
│   ├── popup/               # React popup (pure view, 360px)
│   ├── options/             # React dashboard
│   ├── components/          # Paylaşılan: Toast, Tooltip, ColorPicker,
│   │                        #   PatternInput, EmptyState, OnboardingFlow
│   └── types/               # TS arayüzleri, mesaj tipleri
├── build.js
├── vite.config.ts
└── package.json
```

---

## 12. StorageManager — Tam Veri Modeli

```typescript
interface StorageSchema {
  // Kullanıcı profili (auth kancası)
  userId: string | null          // default: null
  tier: 'free' | 'premium'      // default: 'free'
  email: string | null           // default: null

  // Ayarlar
  theme: 'dark' | 'light'       // default: 'dark'
  language: 'tr' | 'en'         // default: 'tr'
  drcEnabled: boolean            // default: true
  onboardingCompleted: boolean   // default: false

  // Kurallar
  groups: Group[]                // gruplar + pattern'ler
  siteRules: SiteRule[]          // tekil site kuralları
  globalDefault: AudioSettings   // hiç kural yoksa

  // Geçici (session — sekme kapanınca silinir)
  // chrome.storage.session kullanılır, buraya yazılmaz
}

interface Group {
  id: string
  name: string
  color: string                  // hex renk kodu
  patterns: string[]             // ['*.youtube.com', '*.twitch.tv']
  settings: AudioSettings
}

interface SiteRule {
  id: string
  pattern: string
  settings: AudioSettings
}

interface AudioSettings {
  volume: number                 // 0-10 (10 = %1000)
  eq: EQBand[]
  drcEnabled: boolean
}
```

---

## 13. Kayıtlı Mimari Kararlar

* MAX_GAIN = 10 (%1000) — ses sınırı
* Power off'ta node koparılmaz, gain yumuşakça 1.0'a çekilir
* DRC her zaman zincirde, toggle sadece bypass eder (node kaldırılmaz)
* Tek seferlik ayar: chrome.storage.session'da Tab ID bazlı
* Grup/pattern sınırı yok — free tier için sınır koyulmaz
* Pattern girişi: URL → wildcard dönüşümü otomatik, manuel giriş de desteklenir
* Çakışma sessizce çözülmez — kullanıcıya gösterilir
* Geri alma: 5 saniye undo penceresi, kalıcı silme ertelenir
* Onboarding: tek seferlik, 3 adım, StorageManager'da flag

---

## 14. İleride Eklenecek (Kapsam Dışı)

* Supabase auth entegrasyonu (TierGate.ts hazır)
* AI ses temizleme (AudioEngine.ts'e yeni node — zincir hazır)
* Bulut senkronizasyon
* Lemon Squeezy ödeme entegrasyonu
* Mono/stereo ayarı
* Daha fazla dil (i18n altyapısı hazır)
