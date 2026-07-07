// src/content/index.ts — Firefox portu
// Content script = motor barındırıcısı. Background'dan `target:'ae-content'`
// mesajları alır (tabs.sendMessage); offscreen.ts'in Chrome'daki rolünün
// Firefox karşılığıdır. Kural/karar mantığı YOK — background orkestra şefidir.
//
// Açılışta background'a CONTENT_READY gönderir; kayıtlı kural varsa background
// START_CAPTURE ile sessizce başlatır (auto-wake).

import '../lib/shim';
import { ContentAudioEngine } from './engine';
import {
  MessageType,
  CONTENT_TARGET,
  type ContentMsg,
  type StartCaptureResponse,
  type LevelResponse,
  type PingResponse,
  type EngineStatus,
} from '../types/index';

// Çift enjeksiyon koruması: manifest content.js'i document_idle'da enjekte eder,
// background'un ensureContent()'i PING başarısız olursa executeScript ile BİR KEZ
// DAHA enjekte edebilir (popup sayfa yüklenmeden açıldığında olur). İki motor aynı
// frameId için status push edip birbirini ezer; ikinci createMediaElementSource
// denemesi de fırlatır. Aynı eklentinin aynı frame'deki content script'leri tek
// sandbox paylaştığından window expando'su ikinci kopyada görünür (sayfaya görünmez).
const w = window as unknown as { __audioEngineContentLoaded?: boolean };
if (w.__audioEngineContentLoaded) {
  console.debug('[AudioEngine] duplicate injection skipped');
} else {
  w.__audioEngineContentLoaded = true;
  init();
}

function init(): void {
  const engine = new ContentAudioEngine();

  // Motor durumu değişince background'a push et (bu frame için). Background tüm
  // frame'leri birleştirip popup'a verir — kullanıcı "neden çalışmıyor"u görür.
  engine.onStatus = (status: EngineStatus) => {
    void chrome.runtime
      .sendMessage({ type: MessageType.ENGINE_STATUS, payload: status })
      .catch(() => {
        /* background hazır değil — yoksay */
      });
  };

  chrome.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse) => {
    const msg = raw as Partial<ContentMsg> | undefined;
    if (!msg || msg.target !== CONTENT_TARGET) return false;

    switch (msg.type) {
      case 'START_CAPTURE': {
        const layer = engine.start(msg.settings!);
        const res: StartCaptureResponse = { ok: true, layer };
        sendResponse(res);
        return true;
      }
      case 'UPDATE_SETTINGS':
        engine.update(msg.settings!);
        return false;
      case 'STOP_CAPTURE':
        engine.stop();
        return false;
      case 'GET_LEVEL': {
        const res: LevelResponse = { level: engine.getLevel() };
        sendResponse(res);
        return true;
      }
      case 'PING': {
        const res: PingResponse = { ok: true };
        sendResponse(res);
        return true;
      }
      default:
        return false;
    }
  });

  // Auto-wake tetiği: sayfa hazır → background kural varsa START gönderir.
  void chrome.runtime
    .sendMessage({ type: MessageType.CONTENT_READY, payload: {} })
    .catch(() => {
      /* background henüz hazır değilse yoksay */
    });
}
