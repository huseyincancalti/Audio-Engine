// src/lib/shim.ts
// Firefox compat shim — HER entry'nin İLK import'u olmalı.
//
// Kod tabanı chrome.* namespace'ini Promise tarzında kullanır (Chrome MV3 stili).
// Firefox'ta Promise garantisi `browser.*` namespace'indedir; chrome.* alias'ının
// Promise davranışı sürüme göre değişebilir. Bu shim chrome'u browser'a eşitler:
// tek codebase, iki tarayıcı.

declare const browser: typeof chrome | undefined;

const g = globalThis as { chrome?: typeof chrome; browser?: typeof chrome };
if (typeof browser !== 'undefined') {
  g.chrome = g.browser;
}

export {};
