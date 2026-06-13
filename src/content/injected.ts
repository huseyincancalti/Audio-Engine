// src/content/injected.ts
// MAIN world — document_start'ta çalışır, sayfa scriptlerinden önce yüklenir.
// chrome.* API'lerine erişim yoktur; yalnızca page context'i (window, DOM) kullanır.
//
// Sorun: tabCapture aktifken Chromium element fullscreen isteğinin pencereyi
// fullscreen'e geçirmesine izin vermez. Normalde requestFullscreen() tek hamlede
// hem içeriği hem pencereyi fullscreen yapar; bizim durumumuzda:
//   1) element fullscreen → video sekme alanını doldurur  (animasyon A)
//   2) chrome.windows.update fullscreen → sekme şeridi kaybolur  (animasyon B)
// Bu iki ayrı animasyon "kayma / titreme" hissi yaratır.
//
// Çözüm: requestFullscreen()'i burada yakalar, content.js (ISOLATED world) üzerinden
// background'a PRE_FULLSCREEN sinyali göndeririz. Background pencereyi fullscreen'e
// alır (animasyon A); pencere hazır olunca orijinal requestFullscreen() tetiklenir
// (artık pencere zaten fullscreen, video sorunsuz dolar — animasyon B yok).
//
// Sekme yakalanmıyorsa content.js anında ae_fs_go yanıtlar → sıfır gecikme.

declare global {
  interface Window {
    _aeInjected?: true;
  }
}

if (!window._aeInjected) {
  window._aeInjected = true;

  const _orig = Element.prototype.requestFullscreen;

  Element.prototype.requestFullscreen = function (
    this: Element,
    options?: FullscreenOptions,
  ): Promise<void> {
    const el = this;
    return new Promise<void>((resolve, reject) => {
      let settled = false;

      const proceed = () => {
        if (settled) return;
        settled = true;
        _orig.call(el, options).then(resolve, reject);
      };

      // Güvenlik ağı: content.js 600 ms içinde yanıt vermezse orijinal
      // akışa devam et (eklenti yoksa, SW uykudaysa vb.).
      const timer = setTimeout(proceed, 600);

      const handler = (e: MessageEvent<{ _ae?: string }>) => {
        if (e.source !== window || e.data?._ae !== 'ae_fs_go') return;
        window.removeEventListener('message', handler);
        clearTimeout(timer);
        proceed();
      };
      window.addEventListener('message', handler);

      // content.js'e (ISOLATED) sinyal: fullscreen'e girmek üzereyiz.
      window.postMessage({ _ae: 'ae_fs_req' }, '*');
    });
  };
}
