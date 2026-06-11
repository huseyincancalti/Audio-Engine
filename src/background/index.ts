// src/background/index.ts
// v5.0 orkestra şefi. Popup'tan komut alır, tabCapture streamId üretir, offscreen
// document'i yönetir, auto-wake yapar, sekme kapanışını temizler.
// Ses İŞLEMEZ — sadece offscreen'e yönlendirir. esbuild IIFE olarak derlenir.

import { EventBus } from '../core/messages/EventBus';
import { StorageManager } from '../core/storage/StorageManager';
import { resolve as resolveRule } from '../core/rules/RuleResolver';
import {
  MessageType,
  DEFAULT_STORAGE,
  OFFSCREEN_TARGET,
  toCaptureSettings,
  type CaptureSettings,
  type EnableResponse,
  type OffscreenMsg,
  type TabStatus,
  type RuleSource,
  type IsCapturingResponse,
} from '../types/index';

// ---------------------------------------------------------------------------
// RAM durumu (storage'a YAZILMAZ) — sekme bazlı yakalama durumu.
// ---------------------------------------------------------------------------

/** Şu an offscreen'de yakalanan sekmeler. */
const capturing = new Set<number>();
/** Sekmeye uygulanan güncel ayar (kuraldan ya da kullanıcı elinden). */
const tabSettings = new Map<number, CaptureSettings>();
/** Kullanıcının elle ayar değiştirdiği sekmeler — kural değişimi bunları ezmez. */
const userTuned = new Set<number>();

function hostFromUrl(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Offscreen document yönetimi
// ---------------------------------------------------------------------------

let creatingOffscreen: Promise<void> | null = null;

async function ensureOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;
  // Eşzamanlı çağrılarda çift oluşturmayı engelle.
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen
      .createDocument({
        url: 'offscreen/offscreen.html',
        reasons: [chrome.offscreen.Reason.USER_MEDIA],
        justification: 'Sekme sesini işlemek için Web Audio API kullanılır.',
      })
      .finally(() => {
        creatingOffscreen = null;
      });
  }
  await creatingOffscreen;
}

function sendToOffscreen(msg: OffscreenMsg): void {
  chrome.runtime.sendMessage(msg).catch(() => {
    /* offscreen henüz yok / kapanmış olabilir */
  });
}

// ---------------------------------------------------------------------------
// Kural çözümü
// ---------------------------------------------------------------------------

interface Resolution {
  settings: CaptureSettings;
  source: RuleSource;
  sourceLabel: string;
  hasConflict: boolean;
  hasRule: boolean;
}

async function resolveForUrl(url: string | undefined): Promise<Resolution> {
  const data = await StorageManager.getAll();
  const host = hostFromUrl(url);
  const r = resolveRule(host, {
    groups: data.groups,
    siteRules: data.siteRules,
    globalDefault: data.globalDefault,
  });
  return {
    settings: toCaptureSettings(r.settings, data.drcEnabled, data.monoEnabled),
    source: r.source,
    sourceLabel: r.sourceLabel,
    hasConflict: r.hasConflict,
    hasRule: r.hasRule,
  };
}

// ---------------------------------------------------------------------------
// Yakalama başlat / durdur
// ---------------------------------------------------------------------------

function getMediaStreamId(targetTabId: number): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId }, (streamId) => {
      resolve(chrome.runtime.lastError ? null : streamId ?? null);
    });
  });
}

/** content.js'e capture durumunu bildir (background → content; EventBus değil). */
function notifyCaptureState(tabId: number, active: boolean): void {
  chrome.tabs
    .sendMessage(tabId, { _ae: 'set_captured', capturing: active })
    .catch(() => {});
}

/** content.js + injected.js'i dinamik enjekte et ve capture aktif olduğunu bildir.
 * Statik content_scripts sadece eklenti kurulduktan SONRA açılan sekmelere uygulanır.
 * Daha önce açık olan sekmelere bu çağrı ile enjekte edilir.
 * Her iki dosyadaki window flag, çift enjeksiyonu önler. */
async function injectFullscreenWatcher(tabId: number): Promise<void> {
  try {
    await Promise.all([
      chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }),
      // injected.js MAIN world'de çalışır — requestFullscreen interceptor.
      chrome.scripting.executeScript({ target: { tabId }, files: ['injected.js'], world: 'MAIN' }),
    ]);
  } catch {
    /* chrome://, PDF, sandboxed iframe → sessizce yoksay */
  }
  // Scriptler yerleşti; content.js'e _aeCaptured = true bildir.
  notifyCaptureState(tabId, true);
}

async function handleEnable(tabId: number, settings: CaptureSettings): Promise<EnableResponse> {
  await ensureOffscreen();
  const streamId = await getMediaStreamId(tabId);
  // streamId null ise sekme yakalanabilir değil (chrome://, PDF, eklenti sayfası vb.)
  if (!streamId) return {};

  tabSettings.set(tabId, settings);
  capturing.add(tabId);
  sendToOffscreen({ target: OFFSCREEN_TARGET, type: 'START_CAPTURE', tabId, streamId, settings });
  // Sekme zaten açıksa (statik content script enjekte edilmemiş olabilir) fullscreen
  // watcher'ını dinamik enjekte et.
  injectFullscreenWatcher(tabId);
  return { ok: true };
}

function cleanupTab(tabId: number): void {
  // Content script'e yakalama durduğunu bildir (PRE_FULLSCREEN köprüsünü devre dışı bırakır).
  notifyCaptureState(tabId, false);
  capturing.delete(tabId);
  tabSettings.delete(tabId);
  userTuned.delete(tabId);
}

function stopTab(tabId: number): void {
  if (capturing.has(tabId)) {
    sendToOffscreen({ target: OFFSCREEN_TARGET, type: 'STOP_CAPTURE', tabId });
  }
  cleanupTab(tabId);
}

// ---------------------------------------------------------------------------
// Popup → Background mesajları
// ---------------------------------------------------------------------------

EventBus.subscribe(MessageType.ENABLE_AUDIO, async (msg) => {
  return handleEnable(msg.payload.tabId, msg.payload.settings);
});

EventBus.subscribe(MessageType.DISABLE_AUDIO, (msg) => {
  stopTab(msg.payload.tabId);
  return { ok: true };
});

EventBus.subscribe(MessageType.UPDATE_SETTINGS, (msg) => {
  const { tabId, settings } = msg.payload;
  tabSettings.set(tabId, settings);
  userTuned.add(tabId);
  if (capturing.has(tabId)) {
    sendToOffscreen({ target: OFFSCREEN_TARGET, type: 'UPDATE_SETTINGS', tabId, settings });
  }
  // Cevap yok → senkron, kanalı açık tutmaz.
});

EventBus.subscribe(MessageType.GET_TAB_STATUS, async (msg) => {
  const { tabId } = msg.payload;
  const tab = await chrome.tabs.get(tabId).catch(() => null);

  const resolution = await resolveForUrl(tab?.url);
  const active = capturing.has(tabId);
  const settings = (active && tabSettings.get(tabId)) || resolution.settings;

  const status: TabStatus = {
    active,
    volume: settings.volume,
    eq: [...settings.eq],
    drcEnabled: settings.drcEnabled,
    monoEnabled: settings.monoEnabled,
    source: active && userTuned.has(tabId) ? 'one-off' : resolution.source,
    sourceLabel: active && userTuned.has(tabId) ? hostFromUrl(tab?.url) : resolution.sourceLabel,
    hasConflict: resolution.hasConflict,
    host: hostFromUrl(tab?.url),
  };
  return status;
});

EventBus.subscribe(MessageType.CAPTURE_ENDED, (msg) => {
  // Stream offscreen'de bitti (navigasyon / sekme kapanışı) → RAM durumunu temizle.
  cleanupTab(msg.payload.tabId);
});

EventBus.subscribe(MessageType.SAVE_RULE, async (msg) => {
  const p = msg.payload;
  if (p.kind === 'site') {
    await StorageManager.upsertSiteRule(p.pattern, p.settings);
  } else {
    await StorageManager.addPatternToGroup(p.groupId, p.pattern, p.settings);
  }
  return { ok: true };
});

// ---------------------------------------------------------------------------
// Fullscreen senkronu — Chromium, yakalanan sekmede element fullscreen'in
// pencereyi fullscreen'e geçirmesine izin vermez (video büyür ama sekme şeridi
// ve görev çubuğu kalır). Content script fullscreenchange'i bildirir; sekme
// yakalanıyorsa pencereyi chrome.windows ile biz fullscreen'e alır, çıkışta
// önceki durumuna geri döndürürüz. Yakalanmayan sekmede doğal akışa karışmayız.
// ---------------------------------------------------------------------------

type WindowState = NonNullable<chrome.windows.Window['state']>;

/** Bizim fullscreen'e aldığımız pencereler: windowId → tetikleyen sekme + önceki durum. */
const forcedFullscreen = new Map<number, { tabId: number; prevState: WindowState }>();

/** SW yeniden başlamış olabilir (capturing seti boşalır) → gerçek durumu offscreen'e sor. */
async function isTabCaptured(tabId: number): Promise<boolean> {
  if (capturing.has(tabId)) return true;
  if (!(await chrome.offscreen.hasDocument())) return false;
  try {
    const res = (await chrome.runtime.sendMessage({
      target: OFFSCREEN_TARGET,
      type: 'IS_CAPTURING',
      tabId,
    } satisfies OffscreenMsg)) as IsCapturingResponse | undefined;
    return res?.capturing === true;
  } catch {
    return false;
  }
}

async function enterWindowFullscreen(tabId: number, windowId: number): Promise<void> {
  if (forcedFullscreen.has(windowId)) return;
  if (!(await isTabCaptured(tabId))) return;
  const win = await chrome.windows.get(windowId).catch(() => null);
  if (!win || win.state === 'fullscreen') return; // zaten fullscreen (ör. F11)
  forcedFullscreen.set(windowId, { tabId, prevState: win.state ?? 'normal' });
  await chrome.windows.update(windowId, { state: 'fullscreen' }).catch(() => {
    forcedFullscreen.delete(windowId);
  });
}

async function exitWindowFullscreen(windowId: number): Promise<void> {
  const entry = forcedFullscreen.get(windowId);
  if (!entry) return; // fullscreen'i biz başlatmadık → karışma
  forcedFullscreen.delete(windowId);
  const win = await chrome.windows.get(windowId).catch(() => null);
  if (win?.state === 'fullscreen') {
    await chrome.windows.update(windowId, { state: entry.prevState }).catch(() => {});
  }
}

/** Sekme kapandı / navigasyon oldu → o sekmenin zorladığı fullscreen'i geri al. */
function restoreForcedFullscreen(tabId: number): void {
  for (const [windowId, entry] of forcedFullscreen) {
    if (entry.tabId === tabId) void exitWindowFullscreen(windowId);
  }
}

// PRE_FULLSCREEN: injected.ts (MAIN world) requestFullscreen'i yakaladı;
// content.js köprüsü aracılığıyla pencereyi önce fullscreen'e alıyoruz.
// Bu tamamlanınca injected.ts orijinal requestFullscreen()'i çağırır — tek animasyon.
EventBus.subscribe(MessageType.PRE_FULLSCREEN, async (_msg, sender) => {
  const tabId = sender.tab?.id;
  const windowId = sender.tab?.windowId;
  if (tabId != null && windowId != null) {
    await enterWindowFullscreen(tabId, windowId);
  }
  return { ok: true };
});

EventBus.subscribe(MessageType.FULLSCREEN_CHANGED, (msg, sender) => {
  const tabId = sender.tab?.id;
  const windowId = sender.tab?.windowId;
  if (tabId == null || windowId == null) return;
  if (msg.payload.fullscreen) {
    void enterWindowFullscreen(tabId, windowId);
  } else {
    void exitWindowFullscreen(windowId);
  }
});

// ---------------------------------------------------------------------------
// Auto-wake — kayıtlı kuralı olan sekme aktifleşince / yüklenince sessizce başlat.
// ---------------------------------------------------------------------------

async function tryAutoWake(tabId: number): Promise<void> {
  if (capturing.has(tabId)) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.url) return;
  const resolution = await resolveForUrl(tab.url);
  if (!resolution.hasRule) return;
  await handleEnable(tabId, resolution.settings);
}

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void tryAutoWake(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // Navigasyon element fullscreen'i doğal olarak bitirir; zorladığımız pencere
  // fullscreen'i de geri al (eski document'in exit haberi güvenilir değildir).
  if (changeInfo.status === 'loading') restoreForcedFullscreen(tabId);
  if (changeInfo.status !== 'complete') return;
  void tryAutoWake(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  stopTab(tabId);
  restoreForcedFullscreen(tabId);
});

// ---------------------------------------------------------------------------
// storage değişimi → aktif yakalamalara yansıt.
// ---------------------------------------------------------------------------

async function reapplyGlobalFlags(patch: Partial<Pick<CaptureSettings, 'drcEnabled' | 'monoEnabled'>>): Promise<void> {
  for (const tabId of capturing) {
    const current = tabSettings.get(tabId);
    if (!current) continue;
    const next: CaptureSettings = { ...current, ...patch };
    tabSettings.set(tabId, next);
    sendToOffscreen({ target: OFFSCREEN_TARGET, type: 'UPDATE_SETTINGS', tabId, settings: next });
  }
}

async function reapplyRules(): Promise<void> {
  for (const tabId of capturing) {
    if (userTuned.has(tabId)) continue; // elle ayarlananı ezme
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab?.url) continue;
    const resolution = await resolveForUrl(tab.url);
    tabSettings.set(tabId, resolution.settings);
    sendToOffscreen({
      target: OFFSCREEN_TARGET,
      type: 'UPDATE_SETTINGS',
      tabId,
      settings: resolution.settings,
    });
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  const flagPatch: Partial<Pick<CaptureSettings, 'drcEnabled' | 'monoEnabled'>> = {};
  if ('drcEnabled' in changes) {
    flagPatch.drcEnabled = Boolean(changes['drcEnabled']?.newValue ?? DEFAULT_STORAGE.drcEnabled);
  }
  if ('monoEnabled' in changes) {
    flagPatch.monoEnabled = Boolean(changes['monoEnabled']?.newValue ?? DEFAULT_STORAGE.monoEnabled);
  }
  if (Object.keys(flagPatch).length > 0) void reapplyGlobalFlags(flagPatch);

  if ('groups' in changes || 'siteRules' in changes || 'globalDefault' in changes) {
    void reapplyRules();
  }
});

// ---------------------------------------------------------------------------
// İlk kurulum — varsayılanları tohumla.
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async () => {
  const existing = (await chrome.storage.local.get(null)) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(DEFAULT_STORAGE)) {
    if (!(key in existing)) patch[key] = value;
  }
  if (Object.keys(patch).length > 0) await chrome.storage.local.set(patch);

  // Eklenti yüklendiğinde / yeniden yüklendiğinde halihazırda açık olan
  // sekmelere statik content_scripts enjekte edilmez. Fullscreen watcher'ı
  // tüm mevcut http/https sekmelerine tek seferlik inject et.
  const openTabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  // Halihazırda açık sekmelere her iki script'i de enjekte et.
  // _aeFullscreenWatcher / _aeInjected flag'leri çift enjeksiyonu önler.
  // set_captured gönderilmez (henüz capture yok).
  void Promise.allSettled(
    openTabs
      .filter((t) => t.id != null)
      .flatMap((t) => [
        chrome.scripting.executeScript({ target: { tabId: t.id! }, files: ['content.js'] }).catch(() => {}),
        chrome.scripting.executeScript({ target: { tabId: t.id! }, files: ['injected.js'], world: 'MAIN' }).catch(() => {}),
      ]),
  );
});
