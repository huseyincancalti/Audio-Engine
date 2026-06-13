// src/content/index.ts
// ISOLATED world — ses burada işlenmez, yalnızca fullscreen senkronu yapılır.
//
// İki mekanizma çalışır:
//
// 1. MAIN world köprüsü (injected.ts ile):
//    injected.ts, requestFullscreen()'i yakalar ve postMessage { _ae:'ae_fs_req' }
//    gönderir. Biz bunu alır, sekme yakalanıyorsa background'a PRE_FULLSCREEN
//    mesajı göndeririz. Background pencereyi önce fullscreen'e alıp cevap verir;
//    sonra injected.ts orijinal requestFullscreen()'i çağırır → tek animasyon.
//    Sekme yakalanmıyorsa anında ae_fs_go dönülür → sıfır gecikme.
//
// 2. fullscreenchange dinleyicisi:
//    Element fullscreen değişince FULLSCREEN_CHANGED gönderilir; background
//    window durumunu eşler ve çıkışta eski haline döner.

import { MessageType } from '../types/index';

declare global {
  interface Window {
    _aeFullscreenWatcher?: true;
  }
}

/** background'dan gelen { _ae:'set_captured' } mesajıyla güncellenir. */
let _aeCaptured = false;

chrome.runtime.onMessage.addListener((msg: unknown) => {
  if (typeof msg === 'object' && msg !== null) {
    const m = msg as Record<string, unknown>;
    if (m['_ae'] === 'set_captured') _aeCaptured = Boolean(m['capturing']);
  }
});

if (!window._aeFullscreenWatcher) {
  window._aeFullscreenWatcher = true;

  // --- MAIN world köprüsü ---
  window.addEventListener('message', (e: MessageEvent<{ _ae?: string }>) => {
    if (e.source !== window || e.data?._ae !== 'ae_fs_req') return;

    const reply = () => window.postMessage({ _ae: 'ae_fs_go' }, '*');

    if (!_aeCaptured) {
      // Yakalanmıyor → anında geç, gecikme yok.
      reply();
      return;
    }

    try {
      if (!chrome?.runtime?.sendMessage) { reply(); return; }
      void chrome.runtime
        .sendMessage({ type: MessageType.PRE_FULLSCREEN, payload: {} })
        .then(reply)
        .catch(reply);
    } catch {
      reply();
    }
  });

  // --- fullscreenchange dinleyicisi ---
  function onFullscreenChange() {
    try {
      if (!chrome?.runtime?.sendMessage) return;
      void chrome.runtime
        .sendMessage({
          type: MessageType.FULLSCREEN_CHANGED,
          payload: { fullscreen: document.fullscreenElement != null },
        })
        .catch(() => {});
    } catch {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    }
  }
  document.addEventListener('fullscreenchange', onFullscreenChange);
}
