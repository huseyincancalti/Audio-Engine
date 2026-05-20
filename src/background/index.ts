// src/background/index.ts

import { storageManager } from '@/core/storage/StorageManager';
import { EventBus } from '@/core/messages/EventBus';
import {
  MessageType,
  type MessageOfType,
  type ExtensionState,
} from '@/types/index';

// ---------------------------------------------------------------------------
// Service Worker boot – runs every time the SW wakes from suspension.
// ---------------------------------------------------------------------------

/**
 * Rehydrate critical state from chrome.storage immediately on wake.
 * The SW may be killed and restarted by the browser at any point; this
 * ensures we are never operating with stale in-memory assumptions.
 */
async function rehydrate(): Promise<ExtensionState> {
  await storageManager.checkAndMigrate();
  const state = await storageManager.loadState();
  console.debug('[Background] Rehydrated state:', state.version, 'rules:', state.rules.length);
  return state;
}

// ---------------------------------------------------------------------------
// Core dispatch logic
// ---------------------------------------------------------------------------

/**
 * Resolve the correct AudioSettings for `url` and push them to the tab
 * via the EventBus. Called on every meaningful URL change.
 */
async function dispatchSettingsToTab(tabId: number, url: string): Promise<void> {
  const state = await storageManager.loadState();

  // Extension kill-switch.
  if (!state.isEnabled) return;

  const settings = await storageManager.resolveSettings(url);

  const message: MessageOfType<MessageType.APPLY_SETTINGS> = {
    type: MessageType.APPLY_SETTINGS,
    payload: { settings },
  };

  try {
    await EventBus.publishToTab(tabId, message);
  } catch (err) {
    // Content script may not yet be injected (e.g. on a chrome:// page).
    // This is expected – log at debug level only.
    console.debug(`[Background] Could not reach tab ${tabId}:`, (err as Error).message);
  }
}

// ---------------------------------------------------------------------------
// SPA URL tracker
// ---------------------------------------------------------------------------

/**
 * Tracks the last URL seen per tab so we can detect SPA navigations that
 * don't fire `onUpdated` with status === 'complete'.
 *
 * Stored in-memory only; rebuilt from `chrome.tabs.query` after SW wakes.
 */
const tabUrlCache = new Map<number, string>();

/** Returns true if `url` differs from the last dispatched URL for this tab. */
function hasUrlChanged(tabId: number, url: string): boolean {
  return tabUrlCache.get(tabId) !== url;
}

function recordUrl(tabId: number, url: string): void {
  tabUrlCache.set(tabId, url);
}

// ---------------------------------------------------------------------------
// Tab event handlers
// ---------------------------------------------------------------------------

/**
 * Fires when a tab's load status or URL changes.
 * We only act on `status === 'complete'` to avoid dispatching multiple times
 * per navigation (loading → complete).
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Ignore incremental load events; wait for the page to be fully committed.
  if (changeInfo.status !== 'complete') return;

  const url = tab.url ?? changeInfo.url ?? '';
  if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return;

  if (!hasUrlChanged(tabId, url)) return; // SPA guard – URL didn't change.
  recordUrl(tabId, url);

  await dispatchSettingsToTab(tabId, url);
});

/**
 * Fires when the user switches to a different tab.
 * We re-dispatch here so the content script always has fresh settings even
 * if it was injected after the original `onUpdated` event.
 */
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url ?? '';
    if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return;

    recordUrl(tabId, url);
    await dispatchSettingsToTab(tabId, url);
  } catch (err) {
    console.debug('[Background] onActivated error:', (err as Error).message);
  }
});

/**
 * Clean up the URL cache when a tab is closed to prevent unbounded growth.
 */
chrome.tabs.onRemoved.addListener((tabId) => {
  tabUrlCache.delete(tabId);
});

// ---------------------------------------------------------------------------
// Content script handshake
// ---------------------------------------------------------------------------

/**
 * A content script sends `CONTENT_READY` as soon as it is injected.
 * We respond by immediately dispatching the correct settings so the audio
 * pipeline is configured before the user interacts with any media.
 */
EventBus.subscribe(MessageType.CONTENT_READY, async (_msg, sender) => {
  const tabId = sender.tab?.id;
  const url = sender.tab?.url ?? '';

  if (tabId == null || !url) return;
  if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return;

  recordUrl(tabId, url);
  await dispatchSettingsToTab(tabId, url);
});

/**
 * Content script can explicitly request its settings (e.g. after an SPA
 * navigation detected via MutationObserver / History API).
 */
EventBus.subscribe(MessageType.REQUEST_SETTINGS, async (_msg, sender) => {
  const tabId = sender.tab?.id;
  const url = sender.tab?.url ?? '';

  if (tabId == null || !url) return;

  if (hasUrlChanged(tabId, url)) {
    recordUrl(tabId, url);
    await dispatchSettingsToTab(tabId, url);
  }
});

// ---------------------------------------------------------------------------
// Popup message handlers
// ---------------------------------------------------------------------------

EventBus.subscribe(MessageType.GET_STATE, async () => {
  return storageManager.loadState();
});

EventBus.subscribe(MessageType.SET_DEFAULT_SETTINGS, async (msg) => {
  const state = await storageManager.loadState();
  await storageManager.saveState({ ...state, defaultSettings: msg.payload.settings });
  await broadcastStateChange();
});

EventBus.subscribe(MessageType.ADD_RULE, async (msg) => {
  const rule = {
    ...msg.payload.rule,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
  };
  await storageManager.addRule(rule);
  await broadcastStateChange();
});

EventBus.subscribe(MessageType.UPDATE_RULE, async (msg) => {
  await storageManager.updateRule(msg.payload.rule);
  await broadcastStateChange();
});

EventBus.subscribe(MessageType.DELETE_RULE, async (msg) => {
  await storageManager.deleteRule(msg.payload.id);
  await broadcastStateChange();
});

EventBus.subscribe(MessageType.TOGGLE_ENABLED, async (msg) => {
  const state = await storageManager.loadState();
  await storageManager.saveState({ ...state, isEnabled: msg.payload.isEnabled });
  await broadcastStateChange();
});

// ---------------------------------------------------------------------------
// State broadcast helpers
// ---------------------------------------------------------------------------

/**
 * After any storage mutation push the new state to all open popups so the
 * UI stays in sync without polling.
 */
async function broadcastStateChange(): Promise<void> {
  const state = await storageManager.loadState();
  try {
    await EventBus.publish({
      type: MessageType.STATE_CHANGED,
      payload: { state },
    });
  } catch {
    // No popup is open – safe to ignore.
  }
}

// ---------------------------------------------------------------------------
// SW boot – seed the URL cache for all currently open tabs.
// ---------------------------------------------------------------------------

(async () => {
  await rehydrate();

  // Populate the in-memory URL cache from existing tabs so the SW can
  // detect SPA navigations correctly immediately after waking up.
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id != null && tab.url) {
      tabUrlCache.set(tab.id, tab.url);
    }
  }

  console.debug(`[Background] Service Worker ready. Tracking ${tabUrlCache.size} tab(s).`);
})();
