// src/content/index.ts
// v5'te ses content script'te İŞLENMEZ — bu dosyanın tek görevi fullscreen senkronu.
//
// Chromium, tabCapture ile yakalanan sekmelerde element fullscreen isteğinin
// tarayıcı penceresini fullscreen'e geçirmesine izin vermez: video sekme
// alanını doldurur ama sekme şeridi / görev çubuğu ekranda kalır. Buradan
// background'a haber verilir; sekme yakalanıyorsa pencere chrome.windows
// API'siyle fullscreen'e alınır, çıkışta eski durumuna döndürülür.

import { MessageType } from '../types/index';

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
