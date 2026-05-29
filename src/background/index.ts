// src/background/index.ts
// Service worker: kuralları storage'dan okur, CHECK_URL_RULES'a cevap verir,
// SPA URL değişimini izler (tabs.onUpdated → URL_CHANGED), kural/DRC değişimini
// tüm sekmelere yayar. Aktif ses değerini HESAPLAMAZ (ARCHITECTURE bölüm 3.3).
// esbuild IIFE olarak derlenir.

import { EventBus } from '../core/messages/EventBus';
import { StorageManager } from '../core/storage/StorageManager';
import { resolve as resolveRule } from '../core/rules/RuleResolver';
import {
  MessageType,
  DEFAULT_STORAGE,
  type CheckUrlRulesResponse,
} from '../types/index';

/** SPA navigasyon tespiti için sekme başına son URL (ARCHITECTURE bölüm 4.4). */
const tabUrlCache = new Map<number, string>();

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// CHECK_URL_RULES — auto-wake oracle (Content → Background)
// ---------------------------------------------------------------------------

EventBus.subscribe(MessageType.CHECK_URL_RULES, async (msg, sender) => {
  const url = msg.payload.url;
  const host = hostFromUrl(url);
  const data = await StorageManager.getAll();

  const resolved = resolveRule(host, {
    groups: data.groups,
    siteRules: data.siteRules,
    globalDefault: data.globalDefault,
  });

  if (sender.tab?.id != null) tabUrlCache.set(sender.tab.id, url);

  const response: CheckUrlRulesResponse = {
    hasRule: resolved.hasRule,
    settings: resolved.settings,
    source: resolved.source,
    sourceLabel: resolved.sourceLabel,
    hasConflict: resolved.hasConflict,
    power: data.isEnabled,
    drcEnabled: data.drcEnabled,
  };
  return response;
});

// ---------------------------------------------------------------------------
// SAVE_RULE — kalıcı kural (Popup/Options → Background)
// Yayını storage.onChanged yapar (tek kaynak) — burada sadece yazıyoruz.
// ---------------------------------------------------------------------------

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
// Yayın yardımcıları
// ---------------------------------------------------------------------------

async function broadcast(message: Parameters<typeof EventBus.publishToTab>[1]): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs.map((tab) =>
      tab.id != null ? EventBus.publishToTab(tab.id, message) : Promise.resolve(),
    ),
  );
}

// ---------------------------------------------------------------------------
// storage değişimi → tüm sekmelere yay
// ---------------------------------------------------------------------------

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  if ('drcEnabled' in changes) {
    const drcEnabled = Boolean(changes['drcEnabled']?.newValue ?? DEFAULT_STORAGE.drcEnabled);
    void broadcast({ type: MessageType.SET_DRC, payload: { drcEnabled } });
  }

  if (
    'groups' in changes ||
    'siteRules' in changes ||
    'globalDefault' in changes ||
    'isEnabled' in changes
  ) {
    void broadcast({ type: MessageType.RULES_UPDATED });
  }
});

// ---------------------------------------------------------------------------
// SPA / sayfa navigasyonu → URL_CHANGED (ARCHITECTURE bölüm 4.4)
// ---------------------------------------------------------------------------

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return;
  const prev = tabUrlCache.get(tabId);
  tabUrlCache.set(tabId, changeInfo.url);
  if (prev === undefined || prev === changeInfo.url) return; // ilk yükleme content auto-wake'i halleder
  void EventBus.publishToTab(tabId, {
    type: MessageType.URL_CHANGED,
    payload: { url: changeInfo.url },
  }).catch(() => {
    /* content script yok (chrome:// vb.) */
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabUrlCache.delete(tabId);
});

// ---------------------------------------------------------------------------
// İlk kurulum — varsayılanları tohumla
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async () => {
  const existing = (await chrome.storage.local.get(null)) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(DEFAULT_STORAGE)) {
    if (!(key in existing)) patch[key] = value;
  }
  if (Object.keys(patch).length > 0) await chrome.storage.local.set(patch);
});
