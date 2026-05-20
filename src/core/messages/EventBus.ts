// src/core/messages/EventBus.ts

import type {
  MessagePayload,
  MessageOfType,
} from '@/types/index';
import { MessageType } from '@/types/index';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A handler function registered for a specific message type.
 * Returning a value from a handler sends it back as the response to the caller.
 */
type MessageHandler<T extends MessageType> = (
  message: MessageOfType<T>,
  sender: chrome.runtime.MessageSender,
) => Promise<unknown> | unknown;

/** Unsubscribe callback returned by `subscribe`. Call it to remove the listener. */
type Unsubscribe = () => void;

// ---------------------------------------------------------------------------
// Internal subscriber registry
// ---------------------------------------------------------------------------

/**
 * Registry maps each MessageType string to an array of handlers.
 * Using `MessageType` (const enum) values as keys keeps the map type-safe.
 */
const registry = new Map<string, MessageHandler<MessageType>[]>();

// ---------------------------------------------------------------------------
// Unified onMessage listener – registered exactly once per context.
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (
    rawMessage: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): boolean | void => {
    if (!isMessagePayload(rawMessage)) return;

    const handlers = registry.get(rawMessage.type);
    if (!handlers || handlers.length === 0) return;

    const requiresResponse = rawMessage.type === MessageType.GET_STATE;

    if (requiresResponse) {
      let responded = false;
      const promises: Promise<unknown>[] = [];

      for (const handler of handlers) {
        try {
          const result = handler(
            rawMessage as MessageOfType<MessageType>,
            sender,
          );
          if (result instanceof Promise) {
            promises.push(
              result.then((value) => {
                if (!responded && value !== undefined) {
                  responded = true;
                  sendResponse(value);
                }
              }),
            );
          } else if (!responded && result !== undefined) {
            responded = true;
            sendResponse(result);
          }
        } catch (err) {
          console.error('[EventBus] Handler error:', err);
        }
      }

      if (promises.length > 0) {
        Promise.allSettled(promises)
          .then(() => {
            if (!responded) {
              responded = true;
              sendResponse(undefined);
            }
          })
          .catch(() => {
            if (!responded) {
              responded = true;
              sendResponse(undefined);
            }
          });
        return true;
      }

      if (!responded) {
        responded = true;
        sendResponse(undefined);
      }
      return;
    } else {
      for (const handler of handlers) {
        try {
          handler(
            rawMessage as MessageOfType<MessageType>,
            sender,
          );
        } catch (err) {
          console.error('[EventBus] Handler error:', err);
        }
      }
      sendResponse({ success: true });
      return;
    }
  },
);

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

function isMessagePayload(value: unknown): value is MessagePayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof (value as Record<string, unknown>)['type'] === 'string'
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Publish a message to a **specific tab's** content script.
 * Use this from the background service worker.
 */
async function publishToTab<T extends MessageType>(
  tabId: number,
  message: MessageOfType<T>,
): Promise<unknown> {
  return chrome.tabs.sendMessage(tabId, message);
}

/**
 * Publish a message to the **background service worker** (or any context
 * listening via `chrome.runtime.onMessage`).
 * Use this from popup or content scripts.
 */
async function publish<T extends MessageType>(
  message: MessageOfType<T>,
): Promise<unknown> {
  return chrome.runtime.sendMessage(message);
}

/**
 * Subscribe to messages of a specific type in the current execution context
 * (popup, background, or content script).
 *
 * Returns an `Unsubscribe` function – call it to remove the handler.
 *
 * @example
 * const off = EventBus.subscribe(MessageType.APPLY_SETTINGS, (msg) => {
 *   applyAudioSettings(msg.payload.settings);
 * });
 * // Later:
 * off();
 */
function subscribe<T extends MessageType>(
  type: T,
  handler: MessageHandler<T>,
): Unsubscribe {
  const key = type as string;
  if (!registry.has(key)) {
    registry.set(key, []);
  }
  // The cast is safe because the handler's `T` matches the key stored.
  (registry.get(key) as unknown as MessageHandler<T>[]).push(handler);

  return () => {
    const handlers = registry.get(key);
    if (!handlers) return;
    const idx = handlers.indexOf(handler as unknown as MessageHandler<MessageType>);
    if (idx !== -1) handlers.splice(idx, 1);
  };
}

/**
 * Remove **all** handlers for a given message type.
 * Useful during teardown in content scripts.
 */
function unsubscribeAll(type: MessageType): void {
  registry.delete(type as string);
}

// ---------------------------------------------------------------------------
// Exported singleton namespace
// ---------------------------------------------------------------------------

export const EventBus = {
  publish,
  publishToTab,
  subscribe,
  unsubscribeAll,
} as const;
