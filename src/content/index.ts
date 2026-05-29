// src/content/index.ts
// Tek doğru kaynak (ARCHITECTURE bölüm 3.3). Auto-wake (bölüm 4), tek seferlik
// ayar RAM'de (bölüm 3.1/10.2), 3 katman waterfall sürücüsü (bölüm 5).
// esbuild IIFE olarak derlenir — runtime'da `import` YOK.

import { AudioEngine } from '../core/audio/AudioEngine';
import { EventBus } from '../core/messages/EventBus';
import {
  MessageType,
  RTC_TRACK_EVENT,
  RTC_CONTROL_EVENT,
  DEFAULT_AUDIO_SETTINGS,
  type AudioSettings,
  type ResolvedState,
  type RuleSource,
  type CaptureLayer,
  type Badge,
  type CheckUrlRulesResponse,
  type RtcTrackMessage,
  type RtcControlMessage,
} from '../types/index';

// ---------------------------------------------------------------------------
// Tab-içi RAM durumu — sayfa yenilenince sıfırlanır (storage'a YAZILMAZ).
// Bir content script örneği = bir sekme, dolayısıyla tek seferlik ayar tek
// değişkende tutulur (ARCHITECTURE'daki Map<tabId> kavramı burada tek girdiye iner).
// ---------------------------------------------------------------------------

let engine: AudioEngine | null = null;
let awake = false;
let power = true;
let drcEnabled = true;
let oneOff: AudioSettings | null = null;
let rtcAvailable = false; // injected WebRTC ses tespit etti mi?
let rtcEnabled = false; // boost'u etkinleştirdik mi (sadece awake iken)?
let observer: MutationObserver | null = null;

let lastResolution: {
  settings: AudioSettings;
  source: RuleSource;
  sourceLabel: string;
  hasConflict: boolean;
} | null = null;

const FALLBACK_SETTINGS: AudioSettings = {
  ...DEFAULT_AUDIO_SETTINGS,
  eq: [...DEFAULT_AUDIO_SETTINGS.eq],
};

function currentHost(): string {
  return location.hostname;
}

function effectiveSettings(): AudioSettings {
  if (oneOff) return oneOff;
  if (lastResolution) return lastResolution.settings;
  return FALLBACK_SETTINGS;
}

// ---------------------------------------------------------------------------
// Background'a kural sorgusu (auto-wake oracle) — ARCHITECTURE bölüm 4.3
// ---------------------------------------------------------------------------

async function checkRules(url: string): Promise<CheckUrlRulesResponse | null> {
  try {
    const res = (await EventBus.publish({
      type: MessageType.CHECK_URL_RULES,
      payload: { url },
    })) as CheckUrlRulesResponse | undefined;
    return res ?? null;
  } catch (err) {
    console.debug('[content] CHECK_URL_RULES başarısız:', err);
    return null;
  }
}

/** Background cevabını yerel duruma işler. */
function ingestResolution(res: CheckUrlRulesResponse): void {
  power = res.power;
  drcEnabled = res.drcEnabled;
  lastResolution = {
    settings: res.settings ?? FALLBACK_SETTINGS,
    source: res.source,
    sourceLabel: res.sourceLabel,
    hasConflict: res.hasConflict,
  };
}

// ---------------------------------------------------------------------------
// Uyanma + ses bağlama
// ---------------------------------------------------------------------------

function wake(): void {
  if (!engine) engine = new AudioEngine();
  awake = true;
  attachAllMedia();
  startObserving();
  applyEffective();
  if (rtcAvailable) enableRtc();
}

/** WebRTC boost'unu etkinleştir — sadece motor uyanıkken (lazy activation). */
function enableRtc(): void {
  rtcEnabled = true;
  forwardToRtc();
}

function applyEffective(): void {
  if (!engine) return;
  engine.applySettings(effectiveSettings());
  engine.setDrcEnabled(drcEnabled);
  engine.setPower(power);
  forwardToRtc();
}

function attachAllMedia(): void {
  if (!engine) return;
  const media = document.querySelectorAll<HTMLMediaElement>('video, audio');
  media.forEach((el) => engine!.attachToSource(el));
}

function startObserving(): void {
  if (observer) return;
  observer = new MutationObserver((mutations) => {
    if (!engine || !awake) return;
    for (const m of mutations) {
      m.addedNodes.forEach((node) => {
        if (node instanceof HTMLMediaElement) {
          engine!.attachToSource(node);
        } else if (node instanceof Element) {
          node
            .querySelectorAll<HTMLMediaElement>('video, audio')
            .forEach((el) => engine!.attachToSource(el));
        }
      });
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Dinamik oluşturulan media'yı yakalamak için play olayını da dinle.
  document.addEventListener(
    'play',
    (e) => {
      if (engine && awake && e.target instanceof HTMLMediaElement) {
        engine.attachToSource(e.target);
      }
    },
    true,
  );
}

// ---------------------------------------------------------------------------
// Katman 3 — WebRTC köprüsü (injected.ts MAIN world ile postMessage)
// ---------------------------------------------------------------------------

function forwardToRtc(): void {
  if (!rtcEnabled) return;
  const s = effectiveSettings();
  const msg: RtcControlMessage = {
    source: RTC_CONTROL_EVENT,
    volume: s.volume,
    eq: s.eq,
    drcEnabled,
    power,
  };
  window.postMessage(msg, '*');
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data as Partial<RtcTrackMessage> | undefined;
  if (!data || data.source !== RTC_TRACK_EVENT) return;

  // WebRTC ses track'i TESPİT edildi. Boost'u yalnızca motor uyanıksa
  // (kural var ya da kullanıcı uyandırdı) başlat — lazy activation korunur.
  rtcAvailable = (data.streamCount ?? 0) > 0;
  console.info('[content] WebRTC ses tespit edildi (Katman 3), stream:', data.streamCount);
  if (rtcAvailable && awake) enableRtc();
});

// ---------------------------------------------------------------------------
// Durum üretimi (popup için tek doğru değer)
// ---------------------------------------------------------------------------

function computeCaptureLayer(): CaptureLayer {
  if (rtcEnabled) return 'rtc';
  if (!engine) return 'none';
  return engine.getCaptureLayer();
}

function computeBadge(): Badge {
  if (!awake) return 'sleeping';
  if (rtcEnabled) return 'webrtc';
  if (engine && engine.isBypassed()) return 'bypassed';
  return 'active';
}

function buildState(): ResolvedState {
  const eff = effectiveSettings();
  return {
    awake,
    power,
    volume: engine ? engine.getVolume() : eff.volume,
    eq: engine ? engine.getEq() : [...eff.eq],
    drcEnabled,
    source: oneOff ? 'one-off' : lastResolution?.source ?? 'default',
    sourceLabel: oneOff ? currentHost() : lastResolution?.sourceLabel ?? '',
    badge: computeBadge(),
    captureLayer: computeCaptureLayer(),
    hasConflict: lastResolution?.hasConflict ?? false,
    host: currentHost(),
  };
}

// ---------------------------------------------------------------------------
// Popup / background mesaj dinleyicileri
// ---------------------------------------------------------------------------

EventBus.subscribe(MessageType.GET_CURRENT_STATE, () => buildState());

EventBus.subscribe(MessageType.WAKE_UP_ENGINE, async () => {
  if (!awake) {
    const res = await checkRules(location.href);
    if (res) ingestResolution(res);
    wake();
  }
  return buildState();
});

EventBus.subscribe(MessageType.SET_LIVE_VOLUME, (msg) => {
  if (!awake) wake();
  engine?.setVolume(msg.payload.volume);
  forwardToRtc();
  return buildState();
});

EventBus.subscribe(MessageType.SET_LIVE_EQ, (msg) => {
  if (!awake) wake();
  engine?.setEq(msg.payload.eq);
  forwardToRtc();
  return buildState();
});

EventBus.subscribe(MessageType.SET_ONE_OFF, (msg) => {
  oneOff = { volume: msg.payload.settings.volume, eq: [...msg.payload.settings.eq] };
  if (!awake) wake();
  else applyEffective();
  return buildState();
});

EventBus.subscribe(MessageType.SET_POWER_STATE, (msg) => {
  power = msg.payload.power;
  if (!awake && power) wake();
  engine?.setPower(power);
  forwardToRtc();
  return buildState();
});

EventBus.subscribe(MessageType.SET_DRC, (msg) => {
  drcEnabled = msg.payload.drcEnabled;
  engine?.setDrcEnabled(drcEnabled);
  forwardToRtc();
  return buildState();
});

// Background: kurallar değişti → yeniden çöz. (Cevap döndürmez → senkron handler,
// kanalı açık tutmaz; "message port closed" uyarısı oluşmaz.)
EventBus.subscribe(MessageType.RULES_UPDATED, () => {
  void (async () => {
    const res = await checkRules(location.href);
    if (!res) return;
    ingestResolution(res);
    if (awake) {
      if (!oneOff) applyEffective();
      else {
        // Tek seferlik aktifse sadece power/drc'yi tazele.
        engine?.setDrcEnabled(drcEnabled);
        engine?.setPower(power);
      }
    } else if (res.hasRule) {
      wake();
    }
  })();
});

// Background: SPA navigasyonu → tek seferlik düşer, yeni URL için yeniden çöz.
EventBus.subscribe(MessageType.URL_CHANGED, () => {
  void (async () => {
    oneOff = null;
    const res = await checkRules(location.href);
    if (!res) return;
    ingestResolution(res);
    if (awake) {
      applyEffective();
      attachAllMedia();
    } else if (res.hasRule) {
      wake();
    }
  })();
});

// ---------------------------------------------------------------------------
// Açılış — auto-wake (ARCHITECTURE bölüm 4.2)
// ---------------------------------------------------------------------------

void (async () => {
  const res = await checkRules(location.href);
  if (res) {
    ingestResolution(res);
    if (res.hasRule) {
      wake(); // Kayıtlı kural var → popup gerekmeden sessizce uygula.
    }
    // Kural yoksa idle (Sleeping) bekle; WAKE_UP_ENGINE ile uyanır.
  }
})();
