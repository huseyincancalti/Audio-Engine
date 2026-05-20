// src/popup/Popup.tsx

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { EventBus } from '@/core/messages/EventBus';
import {
  MessageType,
  type ExtensionState,
  type AudioSettings,
  type UrlRule,
  DEFAULT_EXTENSION_STATE,
  type MessageOfType,
} from '@/types/index';
import { Dashboard } from './components/Dashboard';
import { Equalizer } from './components/Equalizer';
import { UrlRules } from './components/UrlRules';

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

type TabId = 'dashboard' | 'equalizer' | 'rules';

interface Tab {
  id: TabId;
  label: string;
  icon: string;
}

const TABS: readonly Tab[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '⚡' },
  { id: 'equalizer', label: 'Equalizer', icon: '🎛️' },
  { id: 'rules',     label: 'URL Rules',  icon: '📋' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fetch the active tab's URL from chrome.tabs API. */
async function getActiveTabUrl(): Promise<string> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.url ?? '';
  } catch (err) {
    console.error('[Audio-Engine-Error] getActiveTabUrl failed:', err);
    return '';
  }
}

/** Debounce helper – delays fn execution until `ms` ms after the last call. */
function useDebounce<T extends unknown[]>(
  fn: (...args: T) => void,
  ms: number,
): (...args: T) => void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return useCallback(
    (...args: T) => {
      try {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          try {
            fn(...args);
          } catch (err) {
            console.error('[Audio-Engine-Error] Debounced function execution failed:', err);
          }
        }, ms);
      } catch (err) {
        console.error('[Audio-Engine-Error] useDebounce invocation failed:', err);
      }
    },
    [fn, ms],
  );
}

// ---------------------------------------------------------------------------
// Main Popup component
// ---------------------------------------------------------------------------

export const Popup: React.FC = () => {
  const [state, setState]         = useState<ExtensionState>(DEFAULT_EXTENSION_STATE);
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [currentUrl, setCurrentUrl] = useState('');
  const [loading, setLoading]     = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // ── Boot: load state + active tab URL ─────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    try {
      Promise.all([
        EventBus.publish({
          type: MessageType.GET_STATE,
        } satisfies MessageOfType<MessageType.GET_STATE>) as Promise<ExtensionState>,
        getActiveTabUrl(),
      ])
        .then(([loadedState, url]) => {
          if (cancelled) return;
          try {
            setState(loadedState ?? DEFAULT_EXTENSION_STATE);
            setCurrentUrl(url);
          } catch (err) {
            console.error('[Audio-Engine-Error] Popup state initialization failed:', err);
          }
        })
        .catch((err) => {
          console.error('[Audio-Engine-Error] Popup boot promise resolution failed:', err);
          setConnectionError('Extension context was invalidated or disconnected.');
        })
        .finally(() => {
          if (!cancelled) {
            try {
              setLoading(false);
            } catch (err) {
              console.error('[Audio-Engine-Error] Popup boot finalization failed:', err);
            }
          }
        });
    } catch (err) {
      console.error('[Audio-Engine-Error] Popup boot setup failed:', err);
      setConnectionError('Extension context was invalidated or disconnected.');
    }

    return () => { cancelled = true; };
  }, []);

  // ── Subscribe to state changes pushed by the background ───────────────────

  useEffect(() => {
    let off = () => {};
    try {
      off = EventBus.subscribe(MessageType.STATE_CHANGED, (msg) => {
        try {
          setState(msg.payload.state);
        } catch (err) {
          console.error('[Audio-Engine-Error] STATE_CHANGED subscriber handler failed:', err);
        }
      });
    } catch (err) {
      console.error('[Audio-Engine-Error] STATE_CHANGED subscriber setup failed:', err);
    }

    return () => {
      try {
        off();
      } catch (err) {
        console.error('[Audio-Engine-Error] STATE_CHANGED unsubscribe failed:', err);
      }
    };
  }, []);

  // ── Publish helpers ────────────────────────────────----------------───────

  const publishSettings = useCallback((settings: AudioSettings) => {
    try {
      console.log(`[Audio-Engine-Trace] Popup sent volume ${settings.volume}`);
      EventBus.publish({
        type: MessageType.SET_DEFAULT_SETTINGS,
        payload: { settings },
      } satisfies MessageOfType<MessageType.SET_DEFAULT_SETTINGS>).catch((err) => {
        console.error('[Audio-Engine-Error] publishSettings async EventBus publish failed:', err);
        setConnectionError('Extension context was invalidated or disconnected.');
      });
    } catch (err) {
      console.error('[Audio-Engine-Error] publishSettings sync failed:', err);
      setConnectionError('Extension context was invalidated or disconnected.');
    }
  }, []);

  // Debounce high-frequency slider events (e.g. volume drag) to ~60 ms.
  const debouncedPublish = useDebounce(publishSettings, 60);

  // ── Settings change handler (from child tabs / sliders) ────────────────────

  const handleSettingsChange = useCallback(
    (patch: Partial<AudioSettings>) => {
      try {
        setState((prev) => {
          try {
            const next: ExtensionState = {
              ...prev,
              defaultSettings: { ...prev.defaultSettings, ...patch },
            };
            debouncedPublish(next.defaultSettings);
            return next;
          } catch (err) {
            console.error('[Audio-Engine-Error] handleSettingsChange state transition failed:', err);
            return prev;
          }
        });
      } catch (err) {
        console.error('[Audio-Engine-Error] handleSettingsChange failed:', err);
      }
    },
    [debouncedPublish],
  );

  // ── Global enable/disable toggle ──────────────────────────────────────────

  const handlePowerToggle = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      try {
        const isEnabled = e.target.checked;
        setState((prev) => {
          try {
            return { ...prev, isEnabled };
          } catch (err) {
            console.error('[Audio-Engine-Error] handlePowerToggle state update failed:', err);
            return prev;
          }
        });
        EventBus.publish({
          type: MessageType.TOGGLE_ENABLED,
          payload: { isEnabled },
        } satisfies MessageOfType<MessageType.TOGGLE_ENABLED>).catch((err) => {
          console.error('[Audio-Engine-Error] handlePowerToggle async publish failed:', err);
          setConnectionError('Extension context was invalidated or disconnected.');
        });
      } catch (err) {
        console.error('[Audio-Engine-Error] handlePowerToggle callback execution failed:', err);
      }
    },
    [],
  );

  // ── Rule CRUD ────────────────---------------------------------------------

  const handleAddRule = useCallback(
    (rule: Omit<UrlRule, 'id' | 'createdAt'>) => {
      try {
        EventBus.publish({
          type: MessageType.ADD_RULE,
          payload: { rule },
        } satisfies MessageOfType<MessageType.ADD_RULE>).catch((err) => {
          console.error('[Audio-Engine-Error] handleAddRule async publish failed:', err);
          setConnectionError('Extension context was invalidated or disconnected.');
        });

        // Optimistic UI update – background will confirm via STATE_CHANGED.
        setState((prev) => {
          try {
            return {
              ...prev,
              rules: [
                ...prev.rules,
                { ...rule, id: crypto.randomUUID(), createdAt: Date.now() },
              ],
            };
          } catch (err) {
            console.error('[Audio-Engine-Error] handleAddRule state transition failed:', err);
            return prev;
          }
        });
      } catch (err) {
        console.error('[Audio-Engine-Error] handleAddRule callback failed:', err);
      }
    },
    [],
  );

  const handleDeleteRule = useCallback((id: string) => {
    try {
      EventBus.publish({
        type: MessageType.DELETE_RULE,
        payload: { id },
      } satisfies MessageOfType<MessageType.DELETE_RULE>).catch((err) => {
        console.error('[Audio-Engine-Error] handleDeleteRule async publish failed:', err);
        setConnectionError('Extension context was invalidated or disconnected.');
      });

      setState((prev) => {
        try {
          return {
            ...prev,
            rules: prev.rules.filter((r) => r.id !== id),
          };
        } catch (err) {
          console.error('[Audio-Engine-Error] handleDeleteRule state transition failed:', err);
          return prev;
        }
      });
    } catch (err) {
      console.error('[Audio-Engine-Error] handleDeleteRule callback failed:', err);
    }
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  if (connectionError) {
    return (
      <div
        className="popup-shell"
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 540,
          background: 'var(--bg-panel, #0f0f15)',
          fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        <div style={{ textAlign: 'center', padding: 24, maxWidth: 280 }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
          <h2
            style={{
              color: 'var(--text-primary, #ffffff)',
              fontSize: 16,
              fontWeight: 600,
              margin: '0 0 8px 0',
            }}
          >
            Connection Disconnected
          </h2>
          <p
            style={{
              color: 'var(--text-muted, rgba(255,255,255,0.5))',
              fontSize: 13,
              lineHeight: '1.5',
              margin: '0 0 24px 0',
            }}
          >
            {connectionError} Please refresh the page and reopen this popup.
          </p>
          <button
            onClick={() => {
              try {
                window.close();
              } catch (err) {
                console.error('[Audio-Engine-Error] window.close failed:', err);
              }
            }}
            style={{
              width: '100%',
              padding: '10px 16px',
              background: 'var(--accent-primary, #6c63ff)',
              color: '#ffffff',
              border: 'none',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Close Popup
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div
        className="popup-shell"
        style={{ alignItems: 'center', justifyContent: 'center', minHeight: 540 }}
      >
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
      </div>
    );
  }

  const settings = state.defaultSettings;

  return (
    <div className="popup-shell">

      {/* ── Header ── */}
      <header className="header">
        <div className="header-brand">
          <div className="header-icon">🎚️</div>
          <div>
            <div className="header-title">Audio Engine</div>
            <div className="header-subtitle">Browser Sound Control</div>
          </div>
        </div>

        <div className="power-btn">
          <span className="power-label">{state.isEnabled ? 'On' : 'Off'}</span>
          <label className="toggle" htmlFor="power-toggle" aria-label="Enable Audio Engine">
            <input
              id="power-toggle"
              type="checkbox"
              checked={state.isEnabled}
              onChange={handlePowerToggle}
            />
            <span className="toggle-track" />
            <span className="toggle-thumb" />
          </label>
        </div>
      </header>

      {/* ── Tab navigation ── */}
      <nav className="tab-nav" role="tablist" aria-label="Navigation">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            id={`tab-${tab.id}`}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`panel-${tab.id}`}
            className={`tab-btn${activeTab === tab.id ? ' active' : ''}`}
            onClick={() => {
              try {
                setActiveTab(tab.id);
              } catch (err) {
                console.error('[Audio-Engine-Error] Tab selection click handler failed:', err);
              }
            }}
          >
            <span className="tab-icon">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </nav>

      {/* ── Tab panels ── */}
      <main
        id={`panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`tab-${activeTab}`}
        className={`tab-content${state.isEnabled ? '' : ' disabled-overlay'}`}
      >
        {activeTab === 'dashboard' && (
          <Dashboard settings={settings} onChange={handleSettingsChange} />
        )}
        {activeTab === 'equalizer' && (
          <Equalizer settings={settings} onChange={handleSettingsChange} />
        )}
        {activeTab === 'rules' && (
          <UrlRules
            rules={state.rules}
            currentSettings={settings}
            currentUrl={currentUrl}
            onAdd={handleAddRule}
            onDelete={handleDeleteRule}
          />
        )}
      </main>

    </div>
  );
};
