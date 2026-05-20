// src/content/index.ts

import { AudioEngine } from '@/core/audio/AudioEngine';
import { EventBus } from '@/core/messages/EventBus';
import {
  MessageType,
  type AudioSettings,
  type MessageOfType,
  DEFAULT_AUDIO_SETTINGS,
} from '@/types/index';

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

/** One AudioEngine instance per media element, keyed by the element itself. */
const engineMap = new WeakMap<HTMLMediaElement, AudioEngine>();

/** The current audio settings for this tab, kept in sync via EventBus. */
let currentSettings: AudioSettings = { ...DEFAULT_AUDIO_SETTINGS };

/** Whether the content script has already sent its CONTENT_READY handshake. */
let handshakeSent = false;

// ---------------------------------------------------------------------------
// AudioEngine lifecycle
// ---------------------------------------------------------------------------

/**
 * Attach an AudioEngine to a media element.
 * Wrapped in try/catch so DRM-protected streams (e.g. Netflix EME) fail
 * silently without muting the video or crashing the script.
 */
function attachEngine(media: HTMLMediaElement): void {
  if (engineMap.has(media)) return; // already attached

  try {
    const engine = new AudioEngine(media);
    engine.applySettings(currentSettings);
    engineMap.set(media, engine);
    console.debug('[Content] AudioEngine attached to', media.tagName, media.src || media.currentSrc);
  } catch (err) {
    // DRM / cross-origin restriction – bypass gracefully.
    console.debug('[Content] Skipping DRM-protected element:', (err as Error).message);
  }
}

/**
 * Detach and destroy the AudioEngine bound to a media element.
 * Called when the element is removed from the DOM or the page navigates.
 */
function detachEngine(media: HTMLMediaElement): void {
  const engine = engineMap.get(media);
  if (!engine) return;
  engine.destroy();
  engineMap.delete(media);
}

// ---------------------------------------------------------------------------
// DOM scanning
// ---------------------------------------------------------------------------

function scanAndAttach(): void {
  const elements = document.querySelectorAll<HTMLMediaElement>('video, audio');
  elements.forEach(attachEngine);
}

// ---------------------------------------------------------------------------
// MutationObserver – handles SPAs and dynamically added media elements
// ---------------------------------------------------------------------------

const domObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    // Newly added nodes.
    for (const node of mutation.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const el = node as Element;

      if (el instanceof HTMLMediaElement) {
        attachEngine(el);
      }
      // Media elements inside a subtree (e.g. added via innerHTML).
      el.querySelectorAll<HTMLMediaElement>('video, audio').forEach(attachEngine);
    }

    // Removed nodes – teardown engines to prevent leaks.
    for (const node of mutation.removedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const el = node as Element;

      if (el instanceof HTMLMediaElement) {
        detachEngine(el);
      }
      el.querySelectorAll<HTMLMediaElement>('video, audio').forEach(detachEngine);
    }
  }
});

domObserver.observe(document.documentElement, {
  childList: true,
  subtree: true,
});

// ---------------------------------------------------------------------------
// SPA URL change detection (History API + popstate)
// ---------------------------------------------------------------------------

let lastUrl = location.href;

function onUrlChange(): void {
  if (location.href === lastUrl) return;
  lastUrl = location.href;

  // Notify the background SW so it can resolve new rules for this URL.
  EventBus.publish({
    type: MessageType.REQUEST_SETTINGS,
  } satisfies MessageOfType<MessageType.REQUEST_SETTINGS>).catch(() => {/* SW may be sleeping */});
}

window.addEventListener('popstate', onUrlChange);

// Monkey-patch History API to catch pushState / replaceState navigations.
const _pushState = history.pushState.bind(history);
const _replaceState = history.replaceState.bind(history);

history.pushState = (...args) => {
  _pushState(...args);
  onUrlChange();
};
history.replaceState = (...args) => {
  _replaceState(...args);
  onUrlChange();
};

// ---------------------------------------------------------------------------
// Settings application
// ---------------------------------------------------------------------------

function applyToAllEngines(settings: AudioSettings): void {
  currentSettings = settings;
  document.querySelectorAll<HTMLMediaElement>('video, audio').forEach((media) => {
    engineMap.get(media)?.applySettings(settings);
  });
}

// ---------------------------------------------------------------------------
// EventBus – receive settings pushed by the background SW
// ---------------------------------------------------------------------------

EventBus.subscribe(MessageType.APPLY_SETTINGS, (msg) => {
  applyToAllEngines(msg.payload.settings);
});

// ---------------------------------------------------------------------------
// Hotkey definitions
// ---------------------------------------------------------------------------

const enum HotkeyAction {
  VOLUME_UP = 'VOLUME_UP',
  VOLUME_DOWN = 'VOLUME_DOWN',
  TOGGLE_EQ = 'TOGGLE_EQ',
  TOGGLE_MONO = 'TOGGLE_MONO',
  RESET = 'RESET',
}

interface HotkeyBinding {
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  action: HotkeyAction;
}

const HOTKEY_BINDINGS: readonly HotkeyBinding[] = [
  { key: 'ArrowUp',   shiftKey: true, action: HotkeyAction.VOLUME_UP },
  { key: 'ArrowDown', shiftKey: true, action: HotkeyAction.VOLUME_DOWN },
  { key: 'KeyE',      shiftKey: true, action: HotkeyAction.TOGGLE_EQ },
  { key: 'KeyM',      shiftKey: true, action: HotkeyAction.TOGGLE_MONO },
  { key: 'KeyR',      shiftKey: true, action: HotkeyAction.RESET },
];

const VOLUME_STEP = 0.1; // 10% per keypress
const VOLUME_MAX  = 10.0;
const VOLUME_MIN  = 0.0;

function matchesHotkey(e: KeyboardEvent, binding: HotkeyBinding): boolean {
  return (
    (e.code === binding.key || e.key === binding.key) &&
    !!e.shiftKey === !!binding.shiftKey &&
    !!e.ctrlKey  === !!binding.ctrlKey &&
    !!e.altKey   === !!binding.altKey
  );
}

function handleHotkey(action: HotkeyAction): void {
  let next = { ...currentSettings };

  switch (action) {
    case HotkeyAction.VOLUME_UP:
      next = { ...next, volume: Math.min(next.volume + VOLUME_STEP, VOLUME_MAX) };
      break;
    case HotkeyAction.VOLUME_DOWN:
      next = { ...next, volume: Math.max(next.volume - VOLUME_STEP, VOLUME_MIN) };
      break;
    case HotkeyAction.TOGGLE_EQ:
      next = { ...next, isEqEnabled: !next.isEqEnabled };
      break;
    case HotkeyAction.TOGGLE_MONO:
      next = { ...next, isMono: !next.isMono };
      break;
    case HotkeyAction.RESET:
      next = { ...DEFAULT_AUDIO_SETTINGS };
      break;
  }

  applyToAllEngines(next);
  showOsd(action, next);

  // Push the change back to the background so it persists.
  EventBus.publish({
    type: MessageType.SET_DEFAULT_SETTINGS,
    payload: { settings: next },
  } satisfies MessageOfType<MessageType.SET_DEFAULT_SETTINGS>).catch(() => {});
}

window.addEventListener('keydown', (e: KeyboardEvent) => {
  // Ignore keypresses focused inside inputs/textareas to avoid conflicts.
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return;

  for (const binding of HOTKEY_BINDINGS) {
    if (matchesHotkey(e, binding)) {
      e.preventDefault();
      handleHotkey(binding.action);
      return;
    }
  }
});

// ---------------------------------------------------------------------------
// OSD – Shadow DOM encapsulated feedback bar
// ---------------------------------------------------------------------------

const OSD_SHADOW_HOST_ID = '__audio-engine-osd__';
const OSD_HIDE_DELAY_MS  = 2200;

let osdHost: HTMLElement | null = null;
let osdRoot: ShadowRoot | null = null;
let osdHideTimer: ReturnType<typeof setTimeout> | null = null;

/** Lazily create the Shadow DOM host and inject the OSD stylesheet. */
function ensureOsd(): ShadowRoot {
  if (osdRoot) return osdRoot;

  const host = document.createElement('div');
  host.id = OSD_SHADOW_HOST_ID;

  // Position the host at a fixed, zero-dimension anchor at the top of the
  // stacking context – all real layout happens inside the shadow tree.
  Object.assign(host.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '0',
    height: '0',
    zIndex: '2147483647', // max z-index
    pointerEvents: 'none',
  });

  const shadow = host.attachShadow({ mode: 'closed' });

  // ── OSD stylesheet ──────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }

    #osd {
      position: fixed;
      top: 24px;
      left: 50%;
      transform: translateX(-50%) translateY(-12px);
      min-width: 260px;
      max-width: 420px;
      padding: 12px 20px;
      border-radius: 14px;
      background: rgba(10, 10, 20, 0.82);
      backdrop-filter: blur(18px) saturate(180%);
      -webkit-backdrop-filter: blur(18px) saturate(180%);
      border: 1px solid rgba(255, 255, 255, 0.10);
      box-shadow:
        0 8px 32px rgba(0, 0, 0, 0.45),
        0 1px 0 rgba(255, 255, 255, 0.06) inset;
      font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
      font-size: 13px;
      color: #f0f0f5;
      display: flex;
      align-items: center;
      gap: 14px;
      opacity: 0;
      pointer-events: none;
      transition:
        opacity 180ms ease,
        transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1);
      will-change: opacity, transform;
    }

    #osd.visible {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }

    #osd-icon {
      font-size: 18px;
      flex-shrink: 0;
      line-height: 1;
    }

    #osd-body {
      display: flex;
      flex-direction: column;
      gap: 6px;
      flex: 1;
      min-width: 0;
    }

    #osd-label {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: rgba(255, 255, 255, 0.45);
    }

    #osd-value {
      font-size: 15px;
      font-weight: 700;
      color: #ffffff;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    #osd-bar-track {
      width: 100%;
      height: 4px;
      border-radius: 2px;
      background: rgba(255, 255, 255, 0.12);
      overflow: hidden;
    }

    #osd-bar-fill {
      height: 100%;
      border-radius: 2px;
      background: linear-gradient(90deg, #6c63ff, #48cfad);
      transition: width 140ms ease;
      width: 10%;
    }
  `;

  // ── OSD markup ──────────────────────────────────────────────────────────
  const osd = document.createElement('div');
  osd.id = 'osd';
  osd.innerHTML = `
    <span id="osd-icon">🔊</span>
    <div id="osd-body">
      <div id="osd-label">Volume</div>
      <div id="osd-value">100%</div>
      <div id="osd-bar-track"><div id="osd-bar-fill"></div></div>
    </div>
  `;

  shadow.appendChild(style);
  shadow.appendChild(osd);
  document.documentElement.appendChild(host);

  osdHost = host;
  osdRoot = shadow;
  return shadow;
}

interface OsdConfig {
  icon: string;
  label: string;
  value: string;
  /** Fill fraction 0–1 for the progress bar; omit to hide bar. */
  fill?: number;
}

function buildOsdConfig(action: HotkeyAction, settings: AudioSettings): OsdConfig {
  const volumePct = Math.round(settings.volume * 100);

  switch (action) {
    case HotkeyAction.VOLUME_UP:
    case HotkeyAction.VOLUME_DOWN:
      return {
        icon: settings.volume === 0 ? '🔇' : settings.volume < 0.5 ? '🔉' : '🔊',
        label: 'Volume',
        value: `${volumePct}%`,
        fill: settings.volume / VOLUME_MAX,
      };
    case HotkeyAction.TOGGLE_EQ:
      return {
        icon: '🎛️',
        label: 'Equalizer',
        value: settings.isEqEnabled ? 'Enabled' : 'Bypassed',
      };
    case HotkeyAction.TOGGLE_MONO:
      return {
        icon: settings.isMono ? '🎙️' : '🎧',
        label: 'Audio Mode',
        value: settings.isMono ? 'Mono' : 'Stereo',
      };
    case HotkeyAction.RESET:
      return {
        icon: '↺',
        label: 'Audio Engine',
        value: 'Reset to Defaults',
      };
  }
}

function showOsd(action: HotkeyAction, settings: AudioSettings): void {
  const shadow = ensureOsd();
  const config = buildOsdConfig(action, settings);

  const osd     = shadow.getElementById('osd')!;
  const icon    = shadow.getElementById('osd-icon')!;
  const label   = shadow.getElementById('osd-label')!;
  const value   = shadow.getElementById('osd-value')!;
  const barFill = shadow.getElementById('osd-bar-fill') as HTMLElement;
  const barTrack = shadow.getElementById('osd-bar-track') as HTMLElement;

  icon.textContent  = config.icon;
  label.textContent = config.label;
  value.textContent = config.value;

  if (config.fill !== undefined) {
    barTrack.style.display = '';
    barFill.style.width = `${Math.round(config.fill * 100)}%`;
  } else {
    barTrack.style.display = 'none';
  }

  osd.classList.add('visible');

  if (osdHideTimer !== null) clearTimeout(osdHideTimer);
  osdHideTimer = setTimeout(() => {
    osd.classList.remove('visible');
    osdHideTimer = null;
  }, OSD_HIDE_DELAY_MS);
}

// ---------------------------------------------------------------------------
// Page unload – tear down all engines and the OSD host
// ---------------------------------------------------------------------------

window.addEventListener('pagehide', () => {
  domObserver.disconnect();
  document.querySelectorAll<HTMLMediaElement>('video, audio').forEach(detachEngine);
  osdHost?.remove();
  EventBus.unsubscribeAll(MessageType.APPLY_SETTINGS);
});

// ---------------------------------------------------------------------------
// Entry point – announce readiness and scan for existing media elements
// ---------------------------------------------------------------------------

(function boot() {
  if (handshakeSent) return;
  handshakeSent = true;

  // Announce to the background SW that this content script is alive.
  EventBus.publish({
    type: MessageType.CONTENT_READY,
  } satisfies MessageOfType<MessageType.CONTENT_READY>).catch(() => {});

  // Attach to any media elements already in the DOM at injection time.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanAndAttach, { once: true });
  } else {
    scanAndAttach();
  }
})();
