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
  try {
    await storageManager.checkAndMigrate();
    const state = await storageManager.loadState();
    console.debug('[Background] Rehydrated state:', state.version, 'rules:', state.rules.length);
    return state;
  } catch (err) {
    console.error('[Audio-Engine-Error] rehydrate failed:', (err as Error).message, err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Core dispatch logic
// ---------------------------------------------------------------------------

/**
 * Resolve the correct AudioSettings for `url` and push them to the tab
 * via the EventBus. Called on every meaningful URL change.
 */
async function dispatchSettingsToTab(tabId: number, url: string): Promise<void> {
  try {
    console.log(`[Audio-Engine] Fetching and dispatching rule for URL: ${url} to tab: ${tabId}`);
    const state = await storageManager.loadState();

    // Extension kill-switch.
    if (!state.isEnabled) {
      console.log('[Audio-Engine] Extension is disabled, bypassing settings dispatch');
      return;
    }

    const settings = await storageManager.resolveSettings(url);
    console.log(`[Audio-Engine] Resolved settings for URL: ${url}`, settings);

    const message: MessageOfType<MessageType.APPLY_SETTINGS> = {
      type: MessageType.APPLY_SETTINGS,
      payload: { settings },
    };

    console.log(`[Audio-Engine-Trace] Background relaying to tab ${tabId}`);
    await EventBus.publishToTab(tabId, message);
    console.log(`[Audio-Engine] Settings successfully dispatched to tab: ${tabId}`);
  } catch (err) {
    console.error(`[Audio-Engine-Error] dispatchSettingsToTab failed for tab ${tabId} with URL ${url}:`, (err as Error).message, err);
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
  try {
    // Ignore incremental load events; wait for the page to be fully committed.
    if (changeInfo.status !== 'complete') return;

    const url = tab.url ?? changeInfo.url ?? '';
    if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return;

    if (!hasUrlChanged(tabId, url)) return; // SPA guard – URL didn't change.
    recordUrl(tabId, url);

    await dispatchSettingsToTab(tabId, url);
  } catch (err) {
    console.error(`[Audio-Engine-Error] chrome.tabs.onUpdated listener failed for tabId ${tabId}:`, (err as Error).message, err);
  }
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
    console.error(`[Audio-Engine-Error] chrome.tabs.onActivated listener failed for tabId ${tabId}:`, (err as Error).message, err);
  }
});

/**
 * Clean up the URL cache when a tab is closed to prevent unbounded growth.
 */
chrome.tabs.onRemoved.addListener((tabId) => {
  try {
    tabUrlCache.delete(tabId);
  } catch (err) {
    console.error(`[Audio-Engine-Error] chrome.tabs.onRemoved listener failed for tabId ${tabId}:`, (err as Error).message, err);
  }
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
  try {
    const tabId = sender.tab?.id;
    const url = sender.tab?.url ?? '';

    if (tabId == null || !url) return;
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return;

    recordUrl(tabId, url);
    await dispatchSettingsToTab(tabId, url);
  } catch (err) {
    console.error('[Audio-Engine-Error] CONTENT_READY subscriber failed:', (err as Error).message, err);
  }
});

/**
 * Content script can explicitly request its settings (e.g. after an SPA
 * navigation detected via MutationObserver / History API).
 */
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
    console.error('[Audio-Engine-Error] REQUEST_SETTINGS subscriber failed:', (err as Error).message, err);
  }
});

// ---------------------------------------------------------------------------
// Popup message handlers
// ---------------------------------------------------------------------------

EventBus.subscribe(MessageType.GET_STATE, async () => {
  try {
    return await storageManager.loadState();
  } catch (err) {
    console.error('[Audio-Engine-Error] GET_STATE subscriber failed:', (err as Error).message, err);
    throw err;
  }
});

EventBus.subscribe(MessageType.SET_DEFAULT_SETTINGS, async (msg) => {
  try {
    const state = await storageManager.loadState();
    await storageManager.saveState({ ...state, defaultSettings: msg.payload.settings });
    await broadcastStateChange();

    // Query all tabs and immediately relay new settings to their content scripts
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id != null && tab.url) {
        await dispatchSettingsToTab(tab.id, tab.url);
      }
    }
  } catch (err) {
    console.error('[Audio-Engine-Error] SET_DEFAULT_SETTINGS subscriber failed:', (err as Error).message, err);
    throw err;
  }
});

EventBus.subscribe(MessageType.ADD_RULE, async (msg) => {
  try {
    const rule = {
      ...msg.payload.rule,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    };
    await storageManager.addRule(rule);
    await broadcastStateChange();
  } catch (err) {
    console.error('[Audio-Engine-Error] ADD_RULE subscriber failed:', (err as Error).message, err);
    throw err;
  }
});

EventBus.subscribe(MessageType.UPDATE_RULE, async (msg) => {
  try {
    await storageManager.updateRule(msg.payload.rule);
    await broadcastStateChange();
  } catch (err) {
    console.error('[Audio-Engine-Error] UPDATE_RULE subscriber failed:', (err as Error).message, err);
    throw err;
  }
});

EventBus.subscribe(MessageType.DELETE_RULE, async (msg) => {
  try {
    await storageManager.deleteRule(msg.payload.id);
    await broadcastStateChange();
  } catch (err) {
    console.error('[Audio-Engine-Error] DELETE_RULE subscriber failed:', (err as Error).message, err);
    throw err;
  }
});

EventBus.subscribe(MessageType.TOGGLE_ENABLED, async (msg) => {
  try {
    const state = await storageManager.loadState();
    await storageManager.saveState({ ...state, isEnabled: msg.payload.isEnabled });
    await broadcastStateChange();

    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id != null && tab.url) {
        await dispatchSettingsToTab(tab.id, tab.url);
      }
    }
  } catch (err) {
    console.error('[Audio-Engine-Error] TOGGLE_ENABLED subscriber failed:', (err as Error).message, err);
    throw err;
  }
});

// ---------------------------------------------------------------------------
// State broadcast helpers
// ---------------------------------------------------------------------------

/**
 * After any storage mutation push the new state to all open popups so the
 * UI stays in sync without polling.
 */
async function broadcastStateChange(): Promise<void> {
  try {
    const state = await storageManager.loadState();
    await EventBus.publish({
      type: MessageType.STATE_CHANGED,
      payload: { state },
    });
  } catch (err) {
    // No popup is open – safe to ignore, but we still catch to satisfy strict requirements.
  }
}

// ---------------------------------------------------------------------------
// SW boot – seed the URL cache for all currently open tabs.
// ---------------------------------------------------------------------------

(async () => {
  try {
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
  } catch (err) {
    console.error('[Audio-Engine-Error] Background initialization boot IIFE failed:', (err as Error).message, err);
  }
})();
