// src/lib/messaging.ts
// Popup → aktif sekmenin content script'i ile, ve Popup/Options → background ile
// tip-güvenli mesajlaşma yardımcıları.

import {
  MessageType,
  type ResolvedState,
  type AudioSettings,
  type EQBand,
  type MessageOfType,
  type SaveRulePayload,
} from '../types/index';

export async function getActiveTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

async function sendToTab<T extends MessageType>(
  tabId: number,
  message: MessageOfType<T>,
): Promise<ResolvedState | null> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as ResolvedState;
  } catch {
    // content script yok (ör. chrome:// sayfası) veya henüz hazır değil.
    return null;
  }
}

export async function getCurrentState(tabId: number): Promise<ResolvedState | null> {
  return sendToTab(tabId, { type: MessageType.GET_CURRENT_STATE });
}

export async function wakeEngine(tabId: number): Promise<ResolvedState | null> {
  return sendToTab(tabId, { type: MessageType.WAKE_UP_ENGINE });
}

export async function setLiveVolume(tabId: number, volume: number): Promise<ResolvedState | null> {
  return sendToTab(tabId, { type: MessageType.SET_LIVE_VOLUME, payload: { volume } });
}

export async function setLiveEq(tabId: number, eq: EQBand[]): Promise<ResolvedState | null> {
  return sendToTab(tabId, { type: MessageType.SET_LIVE_EQ, payload: { eq } });
}

export async function setOneOff(tabId: number, settings: AudioSettings): Promise<ResolvedState | null> {
  return sendToTab(tabId, { type: MessageType.SET_ONE_OFF, payload: { settings } });
}

export async function setPowerState(tabId: number, power: boolean): Promise<ResolvedState | null> {
  return sendToTab(tabId, { type: MessageType.SET_POWER_STATE, payload: { power } });
}

export async function setDrcLive(tabId: number, drcEnabled: boolean): Promise<ResolvedState | null> {
  return sendToTab(tabId, { type: MessageType.SET_DRC, payload: { drcEnabled } });
}

/** Kalıcı kural kaydet (background'a). */
export async function saveRule(payload: SaveRulePayload): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: MessageType.SAVE_RULE, payload });
  } catch (err) {
    console.error('[messaging] SAVE_RULE başarısız:', err);
  }
}
