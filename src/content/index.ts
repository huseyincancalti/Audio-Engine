// src/content/index.ts
// v5'te ses content script'te İŞLENMEZ — bu dosyanın tek görevi fullscreen senkronu.
//
// Chromium, tabCapture ile yakalanan sekmelerde element fullscreen isteğinin
// tarayıcı penceresini fullscreen'e geçirmesine izin vermez: video sekme
// alanını doldurur ama sekme şeridi / görev çubuğu ekranda kalır. Buradan
// background'a haber verilir; sekme yakalanıyorsa pencere chrome.windows
// API'siyle fullscreen'e alınır, çıkışta eski durumuna döndürülür.
//
// Bu dosya hem statik content_scripts ile hem de chrome.scripting.executeScript
// ile enjekte edilebilir. İkinci inject'te duplicate listener oluşmasını önlemek
// için window flag kontrolü yapılır.

import { MessageType } from '../types/index';

declare global {
  interface Window {
    _aeFullscreenWatcher?: true;
  }
}

if (!window._aeFullscreenWatcher) {
  window._aeFullscreenWatcher = true;

  document.addEventListener('fullscreenchange', () => {
    chrome.runtime
      .sendMessage({
        type: MessageType.FULLSCREEN_CHANGED,
        payload: { fullscreen: document.fullscreenElement != null },
      })
      .catch(() => {
        /* background'a ulaşılamadıysa (ör. eklenti yeniden yüklendi) yoksay */
      });
  });
}
