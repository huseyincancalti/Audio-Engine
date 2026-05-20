import { AudioEngine } from '@/core/audio/AudioEngine';
import { EventBus } from '@/core/messages/EventBus';
import { storageManager } from '@/core/storage/StorageManager';
import {
  MessageType,
  type AudioSettings,
  type EngineStatus,
  type MessageOfType,
  DEFAULT_AUDIO_SETTINGS,
} from '@/types/index';

// ---------------------------------------------------------------------------
// Frame Isolation Check
// ---------------------------------------------------------------------------

function shouldInit(): boolean {
  try {
    if (window === window.top) return true;
    const isYoutube = window.location.href.includes('youtube.com/embed/');
    const isVimeo = window.location.href.includes('player.vimeo.com');
    const hasMedia = document.querySelector('video, audio') !== null;
    return isYoutube || isVimeo || hasMedia;
  } catch {
    return false;
  }
}

if (!shouldInit()) {
  console.log('[Audio-Engine] Frame isolated: aborting content script injection for:', window.location.href);
} else {
  let isWokenUp = false;

  // Per-tab runtime power state (does NOT affect global storage)
  let tabPowerEnabled = true;

  const engineMap = new WeakMap<HTMLMediaElement, AudioEngine>();

  // Single Source of Truth for Tab RAM settings
  let tabRuntimeSettings: AudioSettings = { ...DEFAULT_AUDIO_SETTINGS };

  let domObserver: MutationObserver | null = null;
  let osdHost: HTMLElement | null = null;
  let osdRoot: ShadowRoot | null = null;
  let osdHideTimer: ReturnType<typeof setTimeout> | null = null;

  // Verify and evaluate engine bypass state cleanly
  function getEffectiveSettings(): AudioSettings {
    try {
      const engines = Array.from(window.__audioEngineRegistry?.values() ?? []);
      const hasActiveEngine = engines.length > 0 && engines.some((e) => !e.getIsBypassed());
      if (!hasActiveEngine && engines.length > 0) {
        return DEFAULT_AUDIO_SETTINGS;
      }
    } catch (err) {
      console.error('[Audio-Engine-Error] Failed to evaluate engine bypass state:', err);
    }
    return tabRuntimeSettings;
  }

  // Compute engine status badge for the Popup UI
  function getEngineStatus(): EngineStatus {
    try {
      const engines = Array.from(window.__audioEngineRegistry?.values() ?? []);
      if (engines.length === 0) return 'sleeping';
      const allBypassed = engines.every((e) => e.getIsBypassed());
      if (allBypassed) return 'bypassed';
      return 'active';
    } catch {
      return 'sleeping';
    }
  }

  // Publish current settings back to background session cache
  function syncToBackground(): void {
    EventBus.publish({
      type: MessageType.STATE_RESPONSE,
      payload: { settings: getEffectiveSettings(), isPowerEnabled: tabPowerEnabled, engineStatus: getEngineStatus() },
    }).catch(() => {});
  }

  async function attachEngine(media: HTMLMediaElement): Promise<void> {
    if (media.dataset.audioEngineHooked === 'true' || engineMap.has(media)) return;
    try {
      media.dataset.audioEngineHooked = 'true';
      const engine = new AudioEngine(media);
      engine.applySettings(tabRuntimeSettings);
      engineMap.set(media, engine);
      if (!window.__audioEngineRegistry) {
        window.__audioEngineRegistry = new Map();
      }
      window.__audioEngineRegistry.set(media, engine);

      // Immediately honour current power state for newly attached engines
      if (!tabPowerEnabled) {
        engine.disableEngine();
      }

      console.log('[Audio-Engine] AudioEngine attached to', media.tagName, media.src || media.currentSrc);
    } catch (err) {
      delete media.dataset.audioEngineHooked;
      console.error('[Audio-Engine-Error] Failed to attach AudioEngine:', (err as Error).message, err);
    }
  }

  function detachEngine(media: HTMLMediaElement): void {
    const engine = engineMap.get(media);
    if (!engine) return;
    try {
      engine.destroy();
      engineMap.delete(media);
      delete media.dataset.audioEngineHooked;
      if (window.__audioEngineRegistry) {
        window.__audioEngineRegistry.delete(media);
      }
      console.log('[Audio-Engine] AudioEngine detached from', media.tagName);
    } catch (err) {
      console.error('[Audio-Engine-Error] Failed to detach AudioEngine:', (err as Error).message, err);
    }
  }

  function scanAndAttach(): void {
    try {
      const elements = document.querySelectorAll<HTMLMediaElement>('video, audio');
      elements.forEach((el) => {
        attachEngine(el).catch((err) => {
          console.error('[Audio-Engine-Error] Scan attach failed:', err);
        });
      });
    } catch (err) {
      console.error('[Audio-Engine-Error] scanAndAttach failed:', (err as Error).message, err);
    }
  }

  // ── Wake Up Engine Activation ──────────────────────────────────────────────

  async function wakeUpEngine(): Promise<void> {
    if (isWokenUp) return;
    isWokenUp = true;
    console.log('[Audio-Engine] Initializing on-demand listeners & capturing media elements.');

    try {
      const settings = await storageManager.resolveSettings(location.href);
      tabRuntimeSettings = settings;
    } catch (err) {
      console.debug('[Audio-Engine] Failed to resolve settings from storage, using baseline settings:', err);
    }

    scanAndAttach();

    document.addEventListener('play', (e) => {
      try {
        if (e.target instanceof HTMLMediaElement) {
          attachEngine(e.target).catch((err) => {
            console.error('[Audio-Engine-Error] Play capture attach failed:', err);
          });
        }
      } catch (err) {
        console.error('[Audio-Engine-Error] play listener failed:', err);
      }
    }, true);

    document.addEventListener('playing', (e) => {
      try {
        if (e.target instanceof HTMLMediaElement) {
          attachEngine(e.target).catch((err) => {
            console.error('[Audio-Engine-Error] Playing capture attach failed:', err);
          });
        }
      } catch (err) {
        console.error('[Audio-Engine-Error] playing listener failed:', err);
      }
    }, true);

    domObserver = new MutationObserver((mutations) => {
      try {
        for (const mutation of mutations) {
          for (const node of mutation.removedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            const el = node as Element;
            if (el instanceof HTMLMediaElement) {
              detachEngine(el);
            }
            el.querySelectorAll<HTMLMediaElement>('video, audio').forEach(detachEngine);
          }
        }
      } catch (err) {
        console.error('[Audio-Engine-Error] MutationObserver execution failed:', err);
      }
    });

    try {
      domObserver.observe(document.documentElement, { childList: true, subtree: true });
    } catch (err) {
      console.error('[Audio-Engine-Error] Failed to observe documentElement:', err);
    }

    const unlockGesture = () => {
      try {
        if (window.__audioEngineRegistry) {
          for (const engine of window.__audioEngineRegistry.values()) {
            try {
              if (engine.getContextState() === 'suspended') {
                engine.resumeContext().catch(() => {});
              }
            } catch {}
          }
        }
        window.removeEventListener('click', unlockGesture, true);
        window.removeEventListener('keydown', unlockGesture, true);
      } catch (err) {
        console.error('[Audio-Engine-Error] unlockGesture failed:', err);
      }
    };
    window.addEventListener('click', unlockGesture, true);
    window.addEventListener('keydown', unlockGesture, true);

    const enum HotkeyAction {
      VOLUME_UP   = 'VOLUME_UP',
      VOLUME_DOWN = 'VOLUME_DOWN',
      TOGGLE_EQ   = 'TOGGLE_EQ',
      TOGGLE_MONO = 'TOGGLE_MONO',
      RESET       = 'RESET',
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

    const VOLUME_STEP = 0.1;
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
      try {
        let next = { ...tabRuntimeSettings };
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

        tabRuntimeSettings = next;
        if (tabPowerEnabled && window.__audioEngineRegistry) {
          for (const engine of window.__audioEngineRegistry.values()) {
            engine.applySettings(next);
          }
        }
        showOsd(action, next);
        syncToBackground();

        EventBus.publish({
          type: MessageType.SET_DEFAULT_SETTINGS,
          payload: { settings: next },
        } satisfies MessageOfType<MessageType.SET_DEFAULT_SETTINGS>).catch((err) => {
          console.error('[Audio-Engine-Error] SET_DEFAULT_SETTINGS publish failed:', err);
        });
      } catch (err) {
        console.error('[Audio-Engine-Error] handleHotkey failed:', err);
      }
    }

    window.addEventListener('keydown', (e: KeyboardEvent) => {
      try {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return;
        for (const binding of HOTKEY_BINDINGS) {
          if (matchesHotkey(e, binding)) {
            e.preventDefault();
            handleHotkey(binding.action);
            return;
          }
        }
      } catch (err) {
        console.error('[Audio-Engine-Error] keydown handler threw:', err);
      }
    });

    let lastUrl = location.href;
    const onUrlChange = () => {
      try {
        if (location.href === lastUrl) return;
        lastUrl = location.href;
        EventBus.publish({
          type: MessageType.REQUEST_SETTINGS,
        } satisfies MessageOfType<MessageType.REQUEST_SETTINGS>).catch(() => {});
      } catch (err) {
        console.error('[Audio-Engine-Error] SPA url change failed:', err);
      }
    };

    window.addEventListener('popstate', onUrlChange);
    const _pushState = history.pushState.bind(history);
    const _replaceState = history.replaceState.bind(history);
    history.pushState = (...args) => { _pushState(...args); onUrlChange(); };
    history.replaceState = (...args) => { _replaceState(...args); onUrlChange(); };

    const OSD_HIDE_DELAY_MS = 2200;

    function ensureOsd(): ShadowRoot {
      if (osdRoot) return osdRoot;
      const host = document.createElement('div');
      host.id = '__audio-engine-osd__';
      Object.assign(host.style, {
        position: 'fixed', top: '0', left: '0', width: '0', height: '0',
        zIndex: '2147483647', pointerEvents: 'none',
      });
      const shadow = host.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = `
        :host { all: initial; }
        #osd {
          position: fixed; top: 24px; left: 50%; transform: translateX(-50%) translateY(-12px);
          min-width: 260px; max-width: 420px; padding: 12px 20px; border-radius: 14px;
          background: rgba(10, 10, 20, 0.82); backdrop-filter: blur(18px) saturate(180%);
          border: 1px solid rgba(255, 255, 255, 0.10); box-shadow: 0 8px 32px rgba(0,0,0,0.45);
          font-family: 'Inter', system-ui, sans-serif; font-size: 13px; color: #f0f0f5;
          display: flex; align-items: center; gap: 14px; opacity: 0; pointer-events: none;
          transition: opacity 180ms ease, transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        #osd.visible { opacity: 1; transform: translateX(-50%) translateY(0); }
        #osd-icon { font-size: 18px; line-height: 1; }
        #osd-body { display: flex; flex-direction: column; gap: 6px; flex: 1; }
        #osd-label { font-size: 11px; font-weight: 600; text-transform: uppercase; color: rgba(255,255,255,0.45); }
        #osd-value { font-size: 15px; font-weight: 700; color: #ffffff; }
        #osd-bar-track { width: 100%; height: 4px; border-radius: 2px; background: rgba(255,255,255,0.12); overflow: hidden; }
        #osd-bar-fill { height: 100%; background: linear-gradient(90deg, #6c63ff, #48cfad); width: 10%; }
      `;
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

    function showOsd(action: HotkeyAction, settings: AudioSettings): void {
      try {
        const shadow = ensureOsd();
        const volumePct = Math.round(settings.volume * 100);
        let iconChar = '🔊';
        let valStr = `${volumePct}%`;
        let fillPct = settings.volume / VOLUME_MAX;

        if (action === HotkeyAction.TOGGLE_EQ) {
          iconChar = '🎛️';
          valStr = settings.isEqEnabled ? 'Enabled' : 'Bypassed';
          fillPct = -1;
        } else if (action === HotkeyAction.TOGGLE_MONO) {
          iconChar = settings.isMono ? '🎙️' : '🎧';
          valStr = settings.isMono ? 'Mono' : 'Stereo';
          fillPct = -1;
        } else if (action === HotkeyAction.RESET) {
          iconChar = '↺';
          valStr = 'Reset';
          fillPct = -1;
        }

        const osd = shadow.getElementById('osd')!;
        const icon = shadow.getElementById('osd-icon')!;
        const value = shadow.getElementById('osd-value')!;
        const barFill = shadow.getElementById('osd-bar-fill') as HTMLElement;
        const barTrack = shadow.getElementById('osd-bar-track') as HTMLElement;

        icon.textContent = iconChar;
        value.textContent = valStr;

        if (fillPct >= 0) {
          barTrack.style.display = '';
          barFill.style.width = `${Math.round(fillPct * 100)}%`;
        } else {
          barTrack.style.display = 'none';
        }

        osd.classList.add('visible');
        if (osdHideTimer !== null) clearTimeout(osdHideTimer);
        osdHideTimer = setTimeout(() => {
          osd.classList.remove('visible');
          osdHideTimer = null;
        }, OSD_HIDE_DELAY_MS);
      } catch (err) {
        console.error('[Audio-Engine-Error] showOsd failed:', err);
      }
    }

    EventBus.publish({
      type: MessageType.CONTENT_READY,
    } satisfies MessageOfType<MessageType.CONTENT_READY>).catch(() => {});
  }

  // ── EventBus Message Subscriptions ─────────────────────────────────────────

  try {
    EventBus.subscribe(MessageType.GET_CURRENT_STATE, () => {
      try {
        if (!isWokenUp) {
          wakeUpEngine().catch(() => {});
        }
        const settings = getEffectiveSettings();
        const engineStatus = getEngineStatus();
        EventBus.publish({
          type: MessageType.STATE_RESPONSE,
          payload: { settings, isPowerEnabled: tabPowerEnabled, engineStatus },
        } satisfies MessageOfType<MessageType.STATE_RESPONSE>).catch((err) => {
          console.error('[Audio-Engine-Error] Failed to publish STATE_RESPONSE:', err);
        });
        return { settings, isPowerEnabled: tabPowerEnabled, engineStatus };
      } catch (err) {
        console.error('[Audio-Engine-Error] GET_CURRENT_STATE handler failed:', err);
        return { settings: DEFAULT_AUDIO_SETTINGS, isPowerEnabled: true, engineStatus: 'sleeping' as const };
      }
    });

    EventBus.subscribe(MessageType.SET_POWER_STATE, (msg) => {
      try {
        const { enabled } = msg.payload;
        tabPowerEnabled = enabled;
        console.log(`[Audio-Engine] Power state set to: ${enabled}`);

        if (window.__audioEngineRegistry) {
          for (const engine of window.__audioEngineRegistry.values()) {
            try {
              if (enabled) {
                engine.enableEngine(tabRuntimeSettings);
              } else {
                engine.disableEngine();
              }
            } catch (err) {
              console.error('[Audio-Engine-Error] Failed to toggle engine power:', err);
            }
          }
        }
        syncToBackground();
      } catch (err) {
        console.error('[Audio-Engine-Error] SET_POWER_STATE handler failed:', err);
      }
    });

    EventBus.subscribe(MessageType.SET_LIVE_VOLUME, (msg) => {
      try {
        const { volume } = msg.payload;
        tabRuntimeSettings = { ...tabRuntimeSettings, volume };
        if (tabPowerEnabled && window.__audioEngineRegistry) {
          for (const engine of window.__audioEngineRegistry.values()) {
            try { engine.setVolume(volume); } catch (err) {
              console.error('[Audio-Engine-Error] Failed to set volume on engine:', err);
            }
          }
        }
        syncToBackground();
      } catch (err) {
        console.error('[Audio-Engine-Error] SET_LIVE_VOLUME handler failed:', err);
      }
    });

    EventBus.subscribe(MessageType.SET_LIVE_EQ, (msg) => {
      try {
        const { eqBands, isEqEnabled, isMono } = msg.payload;
        tabRuntimeSettings = { ...tabRuntimeSettings, eqBands, isEqEnabled, isMono };
        if (tabPowerEnabled && window.__audioEngineRegistry) {
          for (const engine of window.__audioEngineRegistry.values()) {
            try { engine.applySettings(tabRuntimeSettings); } catch (err) {
              console.error('[Audio-Engine-Error] Failed to apply EQ/Mono on engine:', err);
            }
          }
        }
        syncToBackground();
      } catch (err) {
        console.error('[Audio-Engine-Error] SET_LIVE_EQ handler failed:', err);
      }
    });

    EventBus.subscribe(MessageType.WAKE_UP_ENGINE, async () => {
      try {
        await wakeUpEngine();
      } catch (err) {
        console.error('[Audio-Engine-Error] WAKE_UP_ENGINE handler failed:', err);
      }
    });

    EventBus.subscribe(MessageType.APPLY_SETTINGS, (msg) => {
      try {
        if (!isWokenUp) return;
        tabRuntimeSettings = msg.payload.settings;
        if (tabPowerEnabled && window.__audioEngineRegistry) {
          for (const engine of window.__audioEngineRegistry.values()) {
            engine.applySettings(tabRuntimeSettings);
          }
        }
      } catch (err) {
        console.error('[Audio-Engine-Error] APPLY_SETTINGS handler failed:', err);
      }
    });
  } catch (err) {
    console.error('[Audio-Engine-Error] Failed to subscribe content events:', err);
  }

  // Teardown
  try {
    window.addEventListener('pagehide', () => {
      try {
        if (domObserver) domObserver.disconnect();
        document.querySelectorAll<HTMLMediaElement>('video, audio').forEach(detachEngine);
        if (osdHost) osdHost.remove();
        EventBus.unsubscribeAll(MessageType.GET_CURRENT_STATE);
        EventBus.unsubscribeAll(MessageType.SET_POWER_STATE);
        EventBus.unsubscribeAll(MessageType.SET_LIVE_VOLUME);
        EventBus.unsubscribeAll(MessageType.SET_LIVE_EQ);
        EventBus.unsubscribeAll(MessageType.WAKE_UP_ENGINE);
        EventBus.unsubscribeAll(MessageType.APPLY_SETTINGS);
      } catch (err) {
        console.error('[Audio-Engine-Error] pagehide teardown failed:', err);
      }
    });
  } catch (err) {
    console.error('[Audio-Engine-Error] Failed to register pagehide listener:', err);
  }
}
