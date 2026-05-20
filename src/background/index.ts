import { storageManager } from '@/core/storage/StorageManager';
import { EventBus } from '@/core/messages/EventBus';
import {
  MessageType,
  type MessageOfType,
  type ExtensionState,
  type AudioSettings,
} from '@/types/index';

// ---------------------------------------------------------------------------
// Service Worker boot
// ---------------------------------------------------------------------------

async function rehydrate(): Promise<ExtensionState> {
  try {
    await storageManager.checkAndMigrate();
    return await storageManager.loadState();
  } catch (err) {
    console.error('[Audio-Engine-Error] rehydrate failed:', (err as Error).message, err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// In-Memory Tab Session Cache
// ---------------------------------------------------------------------------

const tabSessionCache = new Map<number, AudioSettings>();

// Listen for state responses / updates from content scripts to cache transient states
EventBus.subscribe(MessageType.STATE_RESPONSE, (msg, sender) => {
  try {
    const tabId = sender.tab?.id;
    if (tabId != null) {
      tabSessionCache.set(tabId, msg.payload.settings);
      console.log(`[Audio-Engine] Cached settings for tab ${tabId}:`, msg.payload.settings);
    }
  } catch (err) {
    console.error('[Audio-Engine-Error] Failed to cache tab session settings:', err);
  }
});

// ---------------------------------------------------------------------------
// Core dispatch logic - target-specific piping
// ---------------------------------------------------------------------------

async function dispatchSettingsToTab(tabId: number, url: string): Promise<void> {
  try {
    console.log(`[Audio-Engine] Resolving settings for tab: ${tabId}, url: ${url}`);
    const state = await storageManager.loadState();

    if (!state.isEnabled) {
      console.log('[Audio-Engine] Extension is globally disabled.');
      return;
    }

    // Prioritize background session cache if it exists, otherwise resolve from DB
    let settings: AudioSettings;
    if (tabSessionCache.has(tabId)) {
      settings = tabSessionCache.get(tabId)!;
      console.log(`[Audio-Engine] Prioritizing background session cache for tab ${tabId}`);
    } else {
      settings = await storageManager.resolveSettings(url);
      tabSessionCache.set(tabId, settings);
    }

    const message: MessageOfType<MessageType.APPLY_SETTINGS> = {
      type: MessageType.APPLY_SETTINGS,
      payload: { settings },
    };

    console.log(`[Audio-Engine-Trace] Background piping settings to tab ${tabId}`);
    try {
      await EventBus.publishToTab(tabId, message);
    } catch (publishErr) {
      console.debug(`[Audio-Engine] Target tab ${tabId} not reachable:`, publishErr);
    }
  } catch (err) {
    console.error(`[Audio-Engine-Error] dispatchSettingsToTab failed for tab ${tabId}:`, err);
  }
}

// ---------------------------------------------------------------------------
// SPA URL tracker
// ---------------------------------------------------------------------------

const tabUrlCache = new Map<number, string>();

function hasUrlChanged(tabId: number, url: string): boolean {
  return tabUrlCache.get(tabId) !== url;
}

function recordUrl(tabId: number, url: string): void {
  tabUrlCache.set(tabId, url);
}

// ---------------------------------------------------------------------------
// Tab event listeners
// ---------------------------------------------------------------------------

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  try {
    if (changeInfo.status !== 'complete') return;

    const url = tab.url ?? changeInfo.url ?? '';
    if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return;

    if (!hasUrlChanged(tabId, url)) return;
    recordUrl(tabId, url);

    await dispatchSettingsToTab(tabId, url);
  } catch (err) {
    console.error(`[Audio-Engine-Error] tabs.onUpdated failed for tab ${tabId}:`, err);
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url ?? '';
    if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return;

    recordUrl(tabId, url);
    await dispatchSettingsToTab(tabId, url);
  } catch (err) {
    console.error(`[Audio-Engine-Error] tabs.onActivated failed for tab ${tabId}:`, err);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  try {
    tabUrlCache.delete(tabId);
    tabSessionCache.delete(tabId);
    console.log(`[Audio-Engine] Wiped session cache entry for tab ${tabId}`);
  } catch (err) {
    console.error(`[Audio-Engine-Error] tabs.onRemoved failed for tab ${tabId}:`, err);
  }
});

// ---------------------------------------------------------------------------
// Content script Handshake router
// ---------------------------------------------------------------------------

EventBus.subscribe(MessageType.CONTENT_READY, async (_msg, sender) => {
  try {
    const tabId = sender.tab?.id;
    const url = sender.tab?.url ?? '';

    if (tabId == null || !url) return;
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return;

    recordUrl(tabId, url);
    await dispatchSettingsToTab(tabId, url);
  } catch (err) {
    console.error('[Audio-Engine-Error] CONTENT_READY router failed:', err);
  }
});

EventBus.subscribe(MessageType.REQUEST_SETTINGS, async (_msg, sender) => {
  try {
    const tabId = sender.tab?.id;
    const url = sender.tab?.url ?? '';

    if (tabId == null || !url) return;

    if (hasUrlChanged(tabId, url)) {
      recordUrl(tabId, url);
      await dispatchSettingsToTab(tabId, url);
    }
  } catch (err) {
    console.error('[Audio-Engine-Error] REQUEST_SETTINGS router failed:', err);
  }
});

// ---------------------------------------------------------------------------
// Popup DB storage handlers
// ---------------------------------------------------------------------------

EventBus.subscribe(MessageType.GET_STATE, async () => {
  try {
    return await storageManager.loadState();
  } catch (err) {
    console.error('[Audio-Engine-Error] GET_STATE DB read failed:', err);
    throw err;
  }
});

// 4. "Save Rule" Explicit Persistence
EventBus.subscribe(MessageType.SAVE_RULE, async (msg) => {
  try {
    const { pattern, settings } = msg.payload;
    console.log(`[Audio-Engine] Explicitly persisting rule for pattern: ${pattern}`);
    await storageManager.saveSiteRule(pattern, settings);
    await broadcastStateChange();
  } catch (err) {
    console.error('[Audio-Engine-Error] SAVE_RULE subscriber failed:', err);
    throw err;
  }
});

EventBus.subscribe(MessageType.DELETE_RULE, async (msg) => {
  try {
    await storageManager.deleteRule(msg.payload.id);
    await broadcastStateChange();
  } catch (err) {
    console.error('[Audio-Engine-Error] DELETE_RULE subscriber failed:', err);
    throw err;
  }
});

EventBus.subscribe(MessageType.TOGGLE_ENABLED, async (msg) => {
  try {
    const state = await storageManager.loadState();
    await storageManager.saveState({ ...state, isEnabled: msg.payload.isEnabled });
    await broadcastStateChange();

    // Notify all active tabs of the change in enable state
    const tabs = await chrome.tabs.query({});
    await Promise.allSettled(
      tabs.map((tab) => {
        if (tab.id != null && tab.url) {
          return dispatchSettingsToTab(tab.id, tab.url);
        }
        return Promise.resolve();
      })
    );
  } catch (err) {
    console.error('[Audio-Engine-Error] TOGGLE_ENABLED subscriber failed:', err);
    throw err;
  }
});

async function broadcastStateChange(): Promise<void> {
  try {
    const state = await storageManager.loadState();
    await EventBus.publish({
      type: MessageType.STATE_CHANGED,
      payload: { state },
    });
  } catch {}
}

// ---------------------------------------------------------------------------
// SW boot
// ---------------------------------------------------------------------------

(async () => {
  try {
    await rehydrate();
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id != null && tab.url) {
        tabUrlCache.set(tab.id, tab.url);
      }
    }
    console.debug('[Background] Isolated router active.');
  } catch (err) {
    console.error('[Audio-Engine-Error] Background SW boot failed:', err);
  }
})();
