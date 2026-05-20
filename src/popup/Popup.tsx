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
  } catch {
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
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => fn(...args), ms);
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

  // ── Boot: load state + active tab URL ─────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      EventBus.publish({
        type: MessageType.GET_STATE,
      } satisfies MessageOfType<MessageType.GET_STATE>) as Promise<ExtensionState>,
      getActiveTabUrl(),
    ])
      .then(([loadedState, url]) => {
        if (cancelled) return;
        setState(loadedState ?? DEFAULT_EXTENSION_STATE);
        setCurrentUrl(url);
      })
      .catch((err) => {
        console.error('[Popup] Failed to load state:', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  // ── Subscribe to state changes pushed by the background ───────────────────

  useEffect(() => {
    const off = EventBus.subscribe(MessageType.STATE_CHANGED, (msg) => {
      setState(msg.payload.state);
    });
    return off;
  }, []);

  // ── Publish helpers ───────────────────────────────────────────────────────

  const publishSettings = useCallback((settings: AudioSettings) => {
    EventBus.publish({
      type: MessageType.SET_DEFAULT_SETTINGS,
      payload: { settings },
    } satisfies MessageOfType<MessageType.SET_DEFAULT_SETTINGS>).catch(console.error);
  }, []);

  // Debounce high-frequency slider events (e.g. volume drag) to ~60 ms.
  const debouncedPublish = useDebounce(publishSettings, 60);

  // ── Settings change handler (from child tabs) ──────────────────────────────

  const handleSettingsChange = useCallback(
    (patch: Partial<AudioSettings>) => {
      setState((prev) => {
        const next: ExtensionState = {
          ...prev,
          defaultSettings: { ...prev.defaultSettings, ...patch },
        };
        debouncedPublish(next.defaultSettings);
        return next;
      });
    },
    [debouncedPublish],
  );

  // ── Global enable/disable toggle ──────────────────────────────────────────

  const handlePowerToggle = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const isEnabled = e.target.checked;
      setState((prev) => ({ ...prev, isEnabled }));
      EventBus.publish({
        type: MessageType.TOGGLE_ENABLED,
        payload: { isEnabled },
      } satisfies MessageOfType<MessageType.TOGGLE_ENABLED>).catch(console.error);
    },
    [],
  );

  // ── Rule CRUD ─────────────────────────────────────────────────────────────

  const handleAddRule = useCallback(
    (rule: Omit<UrlRule, 'id' | 'createdAt'>) => {
      EventBus.publish({
        type: MessageType.ADD_RULE,
        payload: { rule },
      } satisfies MessageOfType<MessageType.ADD_RULE>).catch(console.error);
      // Optimistic UI update – background will confirm via STATE_CHANGED.
      setState((prev) => ({
        ...prev,
        rules: [
          ...prev.rules,
          { ...rule, id: crypto.randomUUID(), createdAt: Date.now() },
        ],
      }));
    },
    [],
  );

  const handleDeleteRule = useCallback((id: string) => {
    EventBus.publish({
      type: MessageType.DELETE_RULE,
      payload: { id },
    } satisfies MessageOfType<MessageType.DELETE_RULE>).catch(console.error);
    setState((prev) => ({
      ...prev,
      rules: prev.rules.filter((r) => r.id !== id),
    }));
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

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
            onClick={() => setActiveTab(tab.id)}
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
