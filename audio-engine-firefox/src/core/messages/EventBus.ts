// src/core/messages/EventBus.ts
// Tek bir chrome.runtime.onMessage dinleyicisi üzerinden tip-güvenli pub/sub.
// ARCHITECTURE.md bölüm 11.

import type { MessagePayload, MessageType, MessageOfType } from '../../types/index';

type MessageHandler<T extends MessageType> = (
  message: MessageOfType<T>,
  sender: chrome.runtime.MessageSender,
) => Promise<unknown> | unknown;

type Unsubscribe = () => void;

const registry = new Map<string, MessageHandler<MessageType>[]>();

chrome.runtime.onMessage.addListener(
  (
    rawMessage: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): boolean => {
    if (!isMessagePayload(rawMessage)) return false;

    const handlers = registry.get(rawMessage.type);
    if (!handlers || handlers.length === 0) return false;

    let responded = false;
    const promises: Promise<unknown>[] = [];

    for (const handler of handlers) {
      try {
        const result = handler(rawMessage as MessageOfType<MessageType>, sender);
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
        console.error('[EventBus] Handler hatası:', err);
      }
    }

    if (promises.length > 0) {
      // Asenkron handler var → kanalı açık tut.
      Promise.allSettled(promises).catch(() => {
        /* zaten yakalandı */
      });
      return true;
    }

    return responded;
  },
);

function isMessagePayload(value: unknown): value is MessagePayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof (value as Record<string, unknown>)['type'] === 'string'
  );
}

/** Belirli bir sekmenin content script'ine mesaj gönder (background veya popup'tan). */
async function publishToTab<T extends MessageType>(
  tabId: number,
  message: MessageOfType<T>,
): Promise<unknown> {
  return chrome.tabs.sendMessage(tabId, message);
}

/** Background service worker'a (veya runtime dinleyenlere) mesaj gönder. */
async function publish<T extends MessageType>(message: MessageOfType<T>): Promise<unknown> {
  return chrome.runtime.sendMessage(message);
}

/** Bu bağlamda belirli tipte mesajlara abone ol. Dönen fonksiyonla aboneliği iptal et. */
function subscribe<T extends MessageType>(type: T, handler: MessageHandler<T>): Unsubscribe {
  const key = type as string;
  if (!registry.has(key)) registry.set(key, []);
  (registry.get(key) as unknown as MessageHandler<T>[]).push(handler);

  return () => {
    const handlers = registry.get(key);
    if (!handlers) return;
    const idx = handlers.indexOf(handler as unknown as MessageHandler<MessageType>);
    if (idx !== -1) handlers.splice(idx, 1);
  };
}

export const EventBus = {
  publish,
  publishToTab,
  subscribe,
} as const;
