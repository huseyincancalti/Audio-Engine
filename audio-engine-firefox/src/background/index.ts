// src/background/index.ts — Firefox portu
// Kalıcı (MV2) orkestra şefi. Popup'tan komut alır, content script'teki ses
// motorunu yönetir, auto-wake yapar, sekme kapanışını temizler.
// Ses İŞLEMEZ — sadece content'e yönlendirir. esbuild IIFE olarak derlenir.
//
// MV2 background page kalıcıdır: RAM durumu service worker gibi sıfırlanmaz.

import '../lib/shim';
import { EventBus } from '../core/messages/EventBus';
import { StorageManager } from '../core/storage/StorageManager';
import { resolve as resolveRule } from '../core/rules/RuleResolver';
import {
  MessageType,
  DEFAULT_STORAGE,
  CONTENT_TARGET,
  toCaptureSettings,
  type CaptureSettings,
  type ContentMsg,
  type EnableResponse,
  type StartCaptureResponse,
  type PingResponse,
  type TabStatus,
  type RuleSource,
  type EngineStatus,
  type EngineState,
} from '../types/index';

// ---------------------------------------------------------------------------
// RAM durumu (storage'a YAZILMAZ) — sekme bazlı işleme durumu.
// ---------------------------------------------------------------------------

/** Şu an motoru aktif olan sekmeler. */
const capturing = new Set<number>();
/** Sekmeye uygulanan güncel ayar (kuraldan ya da kullanıcı elinden). */
const tabSettings = new Map<number, CaptureSettings>();
/** Kullanıcının elle ayar değiştirdiği sekmeler — kural değişimi bunları ezmez. */
const userTuned = new Set<number>();
/** Sekme → (frameId → o frame'in motor durumu). all_frames açık olduğundan
 *  her frame kendi durumunu push eder; popup için birleştirilir. */
const frameStatus = new Map<number, Map<number, EngineStatus>>();

/** Bir sekmenin tüm frame'lerinin durumunu tek bir özet duruma indirger. */
function mergeEngineStatus(tabId: number): EngineStatus | undefined {
  const frames = frameStatus.get(tabId);
  if (!frames || frames.size === 0) return undefined;

  let attached = 0;
  let mediaFound = 0;
  let skippedDrm = 0;
  let skippedCors = 0;
  let anySuspended = false;
  for (const s of frames.values()) {
    attached += s.attached;
    mediaFound += s.mediaFound;
    skippedDrm += s.skippedDrm;
    skippedCors += s.skippedCors;
    if (s.state === 'suspended') anySuspended = true;
  }

  // Öncelik: bağlı kaynak var AMA atlanan başka kaynak da varsa "partial" —
  // ses ayarı o atlanan kaynağı etkilemez, %0 bile tam susturmayabilir.
  // Sadece bağlı kaynak varsa (atlanan yok) tam "active".
  let state: EngineState;
  if (attached > 0 && (skippedDrm > 0 || skippedCors > 0)) state = 'partial';
  else if (attached > 0) state = 'active';
  else if (anySuspended) state = 'suspended';
  else if (skippedDrm > 0) state = 'blocked_drm';
  else if (skippedCors > 0) state = 'blocked_cors';
  else state = 'no_media';

  return { state, attached, mediaFound, skippedDrm, skippedCors };
}

function hostFromUrl(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Content script iletişimi
// ---------------------------------------------------------------------------

async function sendToContent<T>(tabId: number, msg: ContentMsg, frameId?: number): Promise<T | null> {
  try {
    const res =
      frameId == null
        ? await chrome.tabs.sendMessage(tabId, msg)
        : await chrome.tabs.sendMessage(tabId, msg, { frameId });
    return res as T;
  } catch {
    return null; // content script yok / sayfa kısıtlı
  }
}

/** Content script enjekte mi? Değilse (eklenti kurulumundan önce açık sekme)
 * tabs.executeScript ile enjekte etmeyi dener (MV2). */
async function ensureContent(tabId: number): Promise<boolean> {
  const ping = await sendToContent<PingResponse>(tabId, { target: CONTENT_TARGET, type: 'PING' });
  if (ping?.ok) return true;
  try {
    // allFrames: iframe içine gömülü oynatıcılar (film siteleri vb.) da yakalanabilsin.
    await chrome.tabs.executeScript(tabId, { file: 'content.js', runAt: 'document_idle', allFrames: true });
  } catch {
    return false; // about:, AMO, PDF görüntüleyici vb. — enjekte edilemez
  }
  const retry = await sendToContent<PingResponse>(tabId, { target: CONTENT_TARGET, type: 'PING' });
  return retry?.ok === true;
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
// İşleme başlat / durdur
// ---------------------------------------------------------------------------

async function handleEnable(tabId: number, settings: CaptureSettings): Promise<EnableResponse> {
  if (!(await ensureContent(tabId))) return {};

  const res = await sendToContent<StartCaptureResponse>(tabId, {
    target: CONTENT_TARGET,
    type: 'START_CAPTURE',
    settings,
  });
  if (!res?.ok) return {};

  tabSettings.set(tabId, settings);
  capturing.add(tabId);
  return { ok: true };
}

function cleanupTab(tabId: number): void {
  capturing.delete(tabId);
  tabSettings.delete(tabId);
  userTuned.delete(tabId);
  frameStatus.delete(tabId);
}

function stopTab(tabId: number): void {
  if (capturing.has(tabId)) {
    void sendToContent(tabId, { target: CONTENT_TARGET, type: 'STOP_CAPTURE' });
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
    void sendToContent(tabId, { target: CONTENT_TARGET, type: 'UPDATE_SETTINGS', settings });
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
    engineStatus: active ? mergeEngineStatus(tabId) : undefined,
  };
  return status;
});

// Content (her frame) motor durumunu push eder → birleştirmek için sakla.
EventBus.subscribe(MessageType.ENGINE_STATUS, (msg, sender) => {
  const tabId = sender.tab?.id;
  if (tabId == null) return;
  const frameId = sender.frameId ?? 0;
  let frames = frameStatus.get(tabId);
  if (!frames) {
    frames = new Map();
    frameStatus.set(tabId, frames);
  }
  frames.set(frameId, msg.payload);
  // cevap yok → fire-and-forget
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
// Auto-wake — kayıtlı kuralı olan sekme yüklenince / aktifleşince sessizce başlat.
// ---------------------------------------------------------------------------

async function tryAutoWake(tabId: number): Promise<void> {
  if (capturing.has(tabId)) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.url) return;
  const resolution = await resolveForUrl(tab.url);
  if (!resolution.hasRule) return;
  await handleEnable(tabId, resolution.settings);
}

// Content script yüklendi (sayfa hazır) → kural varsa başlat.
// all_frames açık: her frame ayrı CONTENT_READY gönderir.
//  - Üst frame (frameId 0): gerçek navigasyon → durumu sıfırla, auto-wake.
//  - Alt frame (iframe): tabı sıfırlama; sekme zaten yakalıyorsa o frame'i de başlat.
EventBus.subscribe(MessageType.CONTENT_READY, (_msg, sender) => {
  const tabId = sender.tab?.id;
  if (tabId == null) return;
  const frameId = sender.frameId ?? 0;

  if (frameId === 0) {
    if (capturing.has(tabId)) cleanupTab(tabId);
    void tryAutoWake(tabId);
    return;
  }

  // Alt frame yüklendi — sekme aktifse bu frame'i de yakalamaya dahil et.
  if (capturing.has(tabId)) {
    const settings = tabSettings.get(tabId);
    if (settings) {
      void sendToContent(tabId, { target: CONTENT_TARGET, type: 'START_CAPTURE', settings }, frameId);
    }
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void tryAutoWake(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // SPA navigasyonu (URL değişti, content script ayakta):
  // elle ayarlanmadıysa yeni URL'in kuralını uygula ya da kural yoksa durdur.
  if (changeInfo.url && capturing.has(tabId) && !userTuned.has(tabId)) {
    void (async () => {
      const resolution = await resolveForUrl(changeInfo.url);
      if (resolution.hasRule) {
        tabSettings.set(tabId, resolution.settings);
        void sendToContent(tabId, {
          target: CONTENT_TARGET,
          type: 'UPDATE_SETTINGS',
          settings: resolution.settings,
        });
      } else {
        stopTab(tabId);
      }
    })();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  cleanupTab(tabId);
});

// ---------------------------------------------------------------------------
// storage değişimi → aktif işlemelere yansıt.
// ---------------------------------------------------------------------------

async function reapplyGlobalFlags(patch: Partial<Pick<CaptureSettings, 'drcEnabled' | 'monoEnabled'>>): Promise<void> {
  for (const tabId of capturing) {
    const current = tabSettings.get(tabId);
    if (!current) continue;
    const next: CaptureSettings = { ...current, ...patch };
    tabSettings.set(tabId, next);
    void sendToContent(tabId, { target: CONTENT_TARGET, type: 'UPDATE_SETTINGS', settings: next });
  }
}

async function reapplyRules(): Promise<void> {
  for (const tabId of capturing) {
    if (userTuned.has(tabId)) continue; // elle ayarlananı ezme
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab?.url) continue;
    const resolution = await resolveForUrl(tab.url);
    tabSettings.set(tabId, resolution.settings);
    void sendToContent(tabId, {
      target: CONTENT_TARGET,
      type: 'UPDATE_SETTINGS',
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
});
