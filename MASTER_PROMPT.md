# Claude Code Master Prompt — Audio Engine Chrome Extension

> Bu prompt'u VS Code'daki Claude Code'a ver. Yanına `ARCHITECTURE.md` dosyasını da koy.
> Boş bir klasörde başla: `claude` çalıştır, sonra aşağıdaki metni yapıştır.

---

## Görev

Boş bir projeden başlayarak, `ARCHITECTURE.md` dosyasında tanımlanan "Audio Engine" Chrome eklentisini sıfırdan, eksiksiz ve çalışır halde kur. Manifest V3 tabanlı, sekmedeki sesi pattern bazlı kurallarla yöneten bir ses yükseltici + ekolayzır.

## Önce Yapman Gerekenler (sırayla)

1. `ARCHITECTURE.md` dosyasını baştan sona oku. Bu senin tek doğru kaynağın. Mimariye dair her karar orada.
2. Projeyi kurmadan önce bana 1 paragrafta planını söyle: hangi dosyaları hangi sırayla oluşturacaksın. Onay bekleme, planı söyle ve devam et.
3. Sonra implementasyona geç ve bitene kadar durma.

## Stack (sapma)

- TypeScript strict mode, React + TailwindCSS (popup ve options için)
- Web Audio API: AudioContext, GainNode, BiquadFilterNode
- Vite + özel `build.js`: popup/options standart React build, content/background `iife` formatında tek dosya inline (Chrome content script `import` kullanamaz)

## Kritik İmplementasyon Kuralları

Bunlar projenin can damarı. Atlamadan uygula:

### 1. State precedence (ARCHITECTURE.md bölüm 3)

- Ayar çözümü SADECE content script'te olur. Popup değer tutmaz, sadece pull yapar. Background ses değeri hesaplamaz.
- Öncelik sırası: tek seferlik → exact match → subdomain wildcard → geniş wildcard/grup → global default.
- Spesifiklik skoru: `(eşleşen karakter sayısı) - (wildcard sayısı * 10)`. En yüksek kazanır. `PatternMatcher.ts` ve `RuleResolver.ts` içinde net, test edilebilir fonksiyonlar olarak yaz.

### 2. Audio hook timing (ARCHITECTURE.md bölüm 6, Bug 2)

- `createMediaElementSource` her element için SADECE BİR KEZ çağrılır. `element.dataset.audioEngineHooked` ile işaretle, ikinci çağrıyı engelle.
- Element `readyState >= 1` olana kadar bekle; değilse `loadedmetadata` dinle. Element hazır değilken hook'lama (video açılışını bozar).
- `try-catch` içinde olsun. `DOMException` → `isBypassed = true`, pass-through. Çökme yok.
- Anti-crackle: değer değişiminde `setTargetAtTime` ile 15-20ms yumuşatma.

### 3. Tab isolation

- Tek seferlik ayar ASLA storage'a yazılmaz. Sadece hedef Tab ID'ye `SET_ONE_OFF` ile iletilir, content RAM'inde tutulur.
- Kalıcı kural sadece "Bu site/grup için kaydet" butonuyla, `SAVE_RULE` ile storage'a yazılır.

### 4. Ses güvenliği

- GainNode'a maksimum kapak koy (örn. 4x = %400 sınırı), patlama koruması.
- Power off'ta node'ları koparma; gain'i yumuşakça native (1.0) değerine çek, EQ sıfırla.

## EventBus Sözleşmesi (ARCHITECTURE.md bölüm 7'ye birebir uy)

`WAKE_UP_ENGINE`, `GET_CURRENT_STATE`, `STATE_RESPONSE`, `SET_LIVE_VOLUME`, `SET_LIVE_EQ`, `SAVE_RULE`, `SET_ONE_OFF`, `SET_POWER_STATE`. Hepsi `src/types/` içinde tiplenmiş mesaj olarak tanımlansın.

## Arayüz

- Popup: o anki sekme için ses slider + EQ band'ları + durum rozeti (Active/Sleeping/Bypassed) + üç buton (bu site için kaydet / bu grup için kaydet / tek seferlik). Temiz, kompakt, Tailwind ile modern görünüm.
- Options (dashboard): grup oluştur/düzenle/sil, gruba pattern ekle/çıkar, tüm kuralları tablo halinde göster. Tam sekme genişliği.

## Yapma

- MutationObserver ile sayfayı agresif tarama (lazy activation, sadece sinyalle uyan).
- Tek seferlik ayarı kaydetme.
- Element hazır olmadan hook'lama.
- Aynı elementi iki kez hook'lama.
- Popup'ta yerel state olarak ses değeri tutup onu doğru kabul etme.
- Placeholder/TODO bırakma — her dosya gerçek, çalışır kod olsun.

## Bittiğini Nasıl Anlarsın (done criteria)

1. `npm run build` hatasız çalışır, `dist/` üretir.
2. `dist/` klasörü Chrome'a "unpacked extension" olarak yüklenebilir, hata vermez.
3. Şu senaryolar manuel test edilebilir durumda:
   - YouTube'da ses %150'ye çıkar, ayar kalıcı kaydedilebilir.
   - Netflix'te ayrı bir grup ile ses %57'ye iner.
   - Bir sekmede tek seferlik %80 yapılır, sekme kapanınca grup ayarına döner.
   - İki sekme açıkken biri diğerini etkilemez (izolasyon).
   - Popup her açıldığında doğru güncel değeri gösterir (desync yok).
   - Google Meet gibi sesi kilitli sitede çökmez, pass-through'a geçer.
4. README.md yaz: kurulum, build, Chrome'a yükleme adımları.

## Çalışma Tarzı

- Açıklamaları Türkçe yap, kod ve dosya isimleri İngilizce.
- Her büyük adım bitince tek cümleyle "✅ [X] bitti, sıradaki: [Y]" de.
- Bir dosyayı değiştirmeden önce mevcut halini oku.
- Bağımsız ilerle, karar noktasına gelmedikçe bana sorma. Bittiğinde özet ver.
