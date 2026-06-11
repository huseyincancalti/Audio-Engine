// src/lib/messaging.ts
// Popup → Background (kontrol) ve Popup → Offscreen (VU seviyesi) tip-güvenli yardımcıları.

import {
  MessageType,
  OFFSCREEN_TARGET,
  type CaptureSettings,
  type EnableResponse,
  type TabStatus,
  type SaveRulePayload,
  type LevelResponse,
} from '../types/index';

export async function getActiveTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

/** Sekmenin güncel durumunu background'dan al (popup tek doğru kaynak olarak bunu gösterir). */
export async function getTabStatus(tabId: number): Promise<TabStatus | null> {
  try {
    return (await chrome.runtime.sendMessage({
      type: MessageType.GET_TAB_STATUS,
      payload: { tabId },
    })) as TabStatus;
  } catch {
    return null;
  }
}

/** Bu sekme için yakalamayı başlat. İzin yoksa { needsPermission:true } döner. */
export async function enableAudio(
  tabId: number,
  settings: CaptureSettings,
): Promise<EnableResponse> {
  try {
    return (await chrome.runtime.sendMessage({
      type: MessageType.ENABLE_AUDIO,
      payload: { tabId, settings },
    })) as EnableResponse;
  } catch {
    return {};
  }
}

/** Bu sekme için yakalamayı durdur (sekme orijinal sesini normal çalar). */
export async function disableAudio(tabId: number): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: MessageType.DISABLE_AUDIO, payload: { tabId } });
  } catch {
    /* background uykuda olabilir */
  }
}

/** Canlı ayar gönder (yakalama aktifse offscreen'e yansır). */
export async function updateSettings(tabId: number, settings: CaptureSettings): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      type: MessageType.UPDATE_SETTINGS,
      payload: { tabId, settings },
    });
  } catch {
    /* yoksay */
  }
}

/** VU metre seviyesi — doğrudan offscreen'e sorar (background'ı es geçer). */
export async function getLevel(tabId: number): Promise<number> {
  try {
    const res = (await chrome.runtime.sendMessage({
      target: OFFSCREEN_TARGET,
      type: 'GET_LEVEL',
      tabId,
    })) as LevelResponse | undefined;
    return res?.level ?? 0;
  } catch {
    return 0;
  }
}

/** Kalıcı kural kaydet (background'a). */
export async function saveRule(payload: SaveRulePayload): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: MessageType.SAVE_RULE, payload });
  } catch (err) {
    console.error('[messaging] SAVE_RULE başarısız:', err);
  }
}
