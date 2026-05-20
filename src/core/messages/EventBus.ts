// src/core/messages/EventBus.ts

import type {
  MessagePayload,
  MessageOfType,
} from '@/types/index';
import { MessageType } from '@/types/index';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MessageHandler<T extends MessageType> = (
  message: MessageOfType<T>,
  sender: chrome.runtime.MessageSender,
) => Promise<unknown> | unknown;

type Unsubscribe = () => void;

// ---------------------------------------------------------------------------
// Internal subscriber registry
// ---------------------------------------------------------------------------

const registry = new Map<string, MessageHandler<MessageType>[]>();

// ---------------------------------------------------------------------------
// Unified onMessage listener – strictly synchronous and fire-and-forget.
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (
    rawMessage: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): void => {
    try {
      if (!isMessagePayload(rawMessage)) {
        sendResponse(undefined);
        return;
      }

      const handlers = registry.get(rawMessage.type);
      if (!handlers || handlers.length === 0) {
        sendResponse(undefined);
        return;
      }

      let responseData: unknown = undefined;

      for (const handler of handlers) {
        try {
          const result = handler(
            rawMessage as MessageOfType<MessageType>,
            sender,
          );
          if (result !== undefined && !(result instanceof Promise)) {
            responseData = result;
          }
          if (result instanceof Promise) {
            result.catch((err) => {
              console.error('[Audio-Engine-Error] EventBus async handler failed:', err);
            });
          }
        } catch (err) {
          console.error('[Audio-Engine-Error] EventBus handler execution failed:', err);
        }
      }

      // Always invoke sendResponse synchronously to prevent freezing message ports.
      try {
        sendResponse(responseData !== undefined ? responseData : { success: true });
      } catch (err) {
        // Safe ignore if the channel was already closed
      }
    } catch (err) {
      console.error('[Audio-Engine-Error] EventBus onMessage processing failed:', err);
      try {
        sendResponse({ success: false });
      } catch {}
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

async function publishToTab<T extends MessageType>(
  tabId: number,
  message: MessageOfType<T>,
): Promise<void> {
  try {
    chrome.tabs.sendMessage(tabId, message, () => {
      const err = chrome.runtime.lastError;
      if (err) {
        console.debug('[EventBus] Tab sendMessage resolved with lastError (safe to ignore):', err.message);
      }
    });
  } catch (err) {
    console.debug('[EventBus] publishToTab sendMessage threw exception (safe to ignore):', err);
  }
}

async function publish<T extends MessageType>(
  message: MessageOfType<T>,
): Promise<void> {
  try {
    chrome.runtime.sendMessage(message, () => {
      const err = chrome.runtime.lastError;
      if (err) {
        console.debug('[EventBus] Runtime sendMessage resolved with lastError (safe to ignore):', err.message);
      }
    });
  } catch (err) {
    console.debug('[EventBus] publish sendMessage threw exception (safe to ignore):', err);
  }
}

function subscribe<T extends MessageType>(
  type: T,
  handler: MessageHandler<T>,
): Unsubscribe {
  const key = type as string;
  if (!registry.has(key)) {
    registry.set(key, []);
  }
  (registry.get(key) as unknown as MessageHandler<T>[]).push(handler);

  return () => {
    try {
      const handlers = registry.get(key);
      if (!handlers) return;
      const idx = handlers.indexOf(handler as unknown as MessageHandler<MessageType>);
      if (idx !== -1) handlers.splice(idx, 1);
    } catch (err) {
      console.error('[Audio-Engine-Error] EventBus unsubscribe failed:', err);
    }
  };
}

function unsubscribeAll(type: MessageType): void {
  try {
    registry.delete(type as string);
  } catch (err) {
    console.error('[Audio-Engine-Error] EventBus unsubscribeAll failed:', err);
  }
}

export const EventBus = {
  publish,
  publishToTab,
  subscribe,
  unsubscribeAll,
} as const;
