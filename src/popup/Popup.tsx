// src/popup/Popup.tsx

import React, { useState, useEffect, useCallback } from 'react';
import { EventBus } from '@/core/messages/EventBus';
import { storageManager } from '@/core/storage/StorageManager';
import {
  MessageType,
  type ExtensionState,
  type AudioSettings,
  type UrlRule,
  DEFAULT_EXTENSION_STATE,
  DEFAULT_AUDIO_SETTINGS,
  type MessageOfType,
} from '@/types/index';
import { Dashboard } from './components/Dashboard';
import { Equalizer } from './components/Equalizer';
import { UrlRules } from './components/UrlRules';

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

export const Popup: React.FC = () => {
  const [state, setState] = useState<ExtensionState>(DEFAULT_EXTENSION_STATE);
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [currentUrl, setCurrentUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // 1. Strict Tab-ID Scoping & Transient Tab State
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [tabSettings, setTabSettings] = useState<AudioSettings>(DEFAULT_AUDIO_SETTINGS);
  const [isTabReady, setIsTabReady] = useState(false);

  // ── On Mount: Discover active tab and request current running settings ──────

  useEffect(() => {
    let cancelled = false;

    // Listen strictly for STATE_RESPONSE
    const off = EventBus.subscribe(MessageType.STATE_RESPONSE, (msg) => {
      if (cancelled) return;
      console.log('[Audio-Engine] STATE_RESPONSE received:', msg.payload.settings);
      setTabSettings(msg.payload.settings);
      setIsTabReady(true);
    });

    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (cancelled) return;
        const activeTab = tabs[0];
        if (activeTab && activeTab.id != null) {
          const tabId = activeTab.id;
          setActiveTabId(tabId);
          setCurrentUrl(activeTab.url ?? '');

          // Dispatches GET_CURRENT_STATE only. Does not send setup parameters.
          chrome.tabs.sendMessage(
            tabId,
            { type: MessageType.GET_CURRENT_STATE } satisfies MessageOfType<MessageType.GET_CURRENT_STATE>,
            () => {
              const err = chrome.runtime.lastError;
              if (err) {
                console.log('[Audio-Engine] GET_CURRENT_STATE failed (target tab not ready):', err.message);
                setIsTabReady(false);
              }
            }
          );
        }
      });
    } catch (err) {
      console.error('[Audio-Engine-Error] Tab query failed:', err);
      setIsTabReady(false);
    }

    return () => {
      cancelled = true;
      off();
    };
  }, []);

  // ── Load Global Database State ────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    storageManager.loadState()
      .then((loadedState) => {
        if (cancelled) return;
        setState(loadedState ?? DEFAULT_EXTENSION_STATE);
      })
      .catch((err) => {
        console.error('[Audio-Engine-Error] Failed to load state:', err);
        setConnectionError('Extension context is disconnected.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // ── Subscribe to database changes ────────────────────────────────────────

  useEffect(() => {
    let off = () => {};
    try {
      off = EventBus.subscribe(MessageType.STATE_CHANGED, (msg) => {
        setState(msg.payload.state);
      });
    } catch (err) {
      console.error('[Audio-Engine-Error] STATE_CHANGED subscriber setup failed:', err);
    }
    return () => {
      off();
    };
  }, []);

  // ── Outbound message dispatching: User UI action listeners only ──────────

  const handleSettingsChange = useCallback(
    (patch: Partial<AudioSettings>) => {
      try {
        if (activeTabId == null) return;

        setTabSettings((prev) => {
          const next = { ...prev, ...patch };

          if (patch.volume !== undefined) {
            // One-way, targeted user slider volume change command
            chrome.tabs.sendMessage(
              activeTabId,
              {
                type: MessageType.SET_LIVE_VOLUME,
                payload: { volume: next.volume },
              } satisfies MessageOfType<MessageType.SET_LIVE_VOLUME>,
              () => {
                const err = chrome.runtime.lastError;
                if (err) {
                  console.debug('[Audio-Engine] SET_LIVE_VOLUME failed:', err.message);
                }
              }
            );
          } else if (
            patch.eqBands !== undefined ||
            patch.isEqEnabled !== undefined ||
            patch.isMono !== undefined
          ) {
            // One-way, targeted user EQ/mono setting change command
            chrome.tabs.sendMessage(
              activeTabId,
              {
                type: MessageType.SET_LIVE_EQ,
                payload: {
                  eqBands: next.eqBands,
                  isEqEnabled: next.isEqEnabled,
                  isMono: next.isMono,
                },
              } satisfies MessageOfType<MessageType.SET_LIVE_EQ>,
              () => {
                const err = chrome.runtime.lastError;
                if (err) {
                  console.debug('[Audio-Engine] SET_LIVE_EQ failed:', err.message);
                }
              }
            );
          }

          return next;
        });
      } catch (err) {
        console.error('[Audio-Engine-Error] handleSettingsChange failed:', err);
      }
    },
    [activeTabId],
  );

  // ── Explicit Rule Persistence ─────────────────────────────────────────────

  const handleSaveRule = useCallback(() => {
    try {
      if (!currentUrl || currentUrl.startsWith('chrome')) return;
      const urlObj = new URL(currentUrl);
      const pattern = urlObj.hostname;

      console.log(`[Audio-Engine] Explicitly saving rule for pattern: ${pattern}`);
      EventBus.publish({
        type: MessageType.SAVE_RULE,
        payload: {
          pattern,
          settings: tabSettings,
        },
      } satisfies MessageOfType<MessageType.SAVE_RULE>).catch((err) => {
        console.error('[Audio-Engine-Error] SAVE_RULE publish failed:', err);
      });
    } catch (err) {
      console.error('[Audio-Engine-Error] handleSaveRule failed:', err);
    }
  }, [currentUrl, tabSettings]);

  // ── Global Toggle ────────────────-----------------------------------------

  const handlePowerToggle = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      try {
        const isEnabled = e.target.checked;
        setState((prev) => ({ ...prev, isEnabled }));
        EventBus.publish({
          type: MessageType.TOGGLE_ENABLED,
          payload: { isEnabled },
        } satisfies MessageOfType<MessageType.TOGGLE_ENABLED>).catch((err) => {
          console.error('[Audio-Engine-Error] TOGGLE_ENABLED publish failed:', err);
        });
      } catch (err) {
        console.error('[Audio-Engine-Error] handlePowerToggle failed:', err);
      }
    },
    [],
  );

  // ── URL Rules CRUD ────────────────────────────────────────────────────────

  const handleAddRule = useCallback(
    (rule: Omit<UrlRule, 'id' | 'createdAt'>) => {
      try {
        EventBus.publish({
          type: MessageType.ADD_RULE,
          payload: { rule },
        } satisfies MessageOfType<MessageType.ADD_RULE>).catch((err) => {
          console.error('[Audio-Engine-Error] ADD_RULE failed:', err);
        });
      } catch (err) {
        console.error('[Audio-Engine-Error] handleAddRule execution failed:', err);
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
        console.error('[Audio-Engine-Error] DELETE_RULE failed:', err);
      });
    } catch (err) {
      console.error('[Audio-Engine-Error] handleDeleteRule execution failed:', err);
    }
  }, []);

  // ── Render ────────────────------------------------------------------------

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
              } catch {}
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
                console.error('[Audio-Engine-Error] Tab selection failed:', err);
              }
            }}
          >
            <span className="tab-icon">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </nav>

      {/* ── Graceful connection waiting state notice ── */}
      {!isTabReady && state.isEnabled && activeTab !== 'rules' && (
        <div style={{
          textAlign: 'center',
          padding: '16px',
          background: 'rgba(255, 193, 7, 0.08)',
          borderBottom: '1px solid rgba(255, 193, 7, 0.2)',
          color: '#ffc107',
          fontSize: '13px',
          fontWeight: 500,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px'
        }}>
          <div>⏳ Connecting to tab audio stream...</div>
          <div style={{ fontSize: '11px', color: 'rgba(255, 255, 255, 0.5)', fontWeight: 400 }}>
            Play audio/video in the active tab to activate the control panel.
          </div>
        </div>
      )}

      {/* ── Tab panels ── */}
      <main
        id={`panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`tab-${activeTab}`}
        className={`tab-content${(state.isEnabled && (isTabReady || activeTab === 'rules')) ? '' : ' disabled-overlay'}`}
      >
        {activeTab === 'dashboard' && (
          <Dashboard settings={tabSettings} onChange={handleSettingsChange} />
        )}
        {activeTab === 'equalizer' && (
          <Equalizer settings={tabSettings} onChange={handleSettingsChange} />
        )}
        {activeTab === 'rules' && (
          <UrlRules
            rules={state.rules}
            currentSettings={tabSettings}
            currentUrl={currentUrl}
            onAdd={handleAddRule}
            onDelete={handleDeleteRule}
          />
        )}
      </main>

      {/* ── Save Settings explicit persistence button ── */}
      {isTabReady && state.isEnabled && currentUrl && !currentUrl.startsWith('chrome') && (activeTab === 'dashboard' || activeTab === 'equalizer') && (
        <div style={{ padding: '0 16px 16px 16px', display: 'flex', justifyContent: 'center' }}>
          <button
            onClick={handleSaveRule}
            style={{
              width: '100%',
              padding: '10px 16px',
              background: 'linear-gradient(135deg, #6c63ff, #48cfad)',
              color: '#ffffff',
              border: 'none',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(108, 99, 255, 0.3)',
            }}
          >
            💾 Save Settings for this Site
          </button>
        </div>
      )}

    </div>
  );
};
