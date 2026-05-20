// src/popup/Popup.tsx

import React, { useState, useEffect, useCallback } from 'react';
import { EventBus } from '@/core/messages/EventBus';
import { storageManager } from '@/core/storage/StorageManager';
import {
  MessageType,
  type ExtensionState,
  type AudioSettings,
  type EngineStatus,
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

// ── Status Badge ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<EngineStatus, { label: string; color: string; bg: string; dot: string }> = {
  active:   { label: 'ACTIVE',   color: '#22c55e', bg: 'rgba(34, 197, 94, 0.12)',  dot: '#22c55e' },
  sleeping: { label: 'SLEEPING', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.10)', dot: '#94a3b8' },
  bypassed: { label: 'BYPASSED', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.12)', dot: '#f59e0b' },
};

const StatusBadge: React.FC<{ status: EngineStatus }> = ({ status }) => {
  const cfg = STATUS_CONFIG[status];
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      padding: '3px 9px', borderRadius: '20px',
      background: cfg.bg, border: `1px solid ${cfg.color}33`,
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%', background: cfg.dot,
        boxShadow: status === 'active' ? `0 0 6px ${cfg.dot}` : 'none',
        animation: status === 'active' ? 'pulse-dot 2s ease-in-out infinite' : 'none',
      }} />
      <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em', color: cfg.color }}>
        {cfg.label}
      </span>
    </div>
  );
};


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
  // Per-tab power state (RAM-only, does NOT write to storage)
  const [tabPowerEnabled, setTabPowerEnabled] = useState(true);
  // Engine status badge
  const [engineStatus, setEngineStatus] = useState<EngineStatus>('sleeping');
  // Domain rule UX
  const [existingRuleId, setExistingRuleId] = useState<string | null>(null);
  const [savedFeedback, setSavedFeedback] = useState(false);
  const savedFeedbackTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── On Mount: Discover active tab and request current running settings ──────

  useEffect(() => {
    let cancelled = false;

    // Listen strictly for STATE_RESPONSE
    const off = EventBus.subscribe(MessageType.STATE_RESPONSE, (msg) => {
      if (cancelled) return;
      console.log('[Audio-Engine] STATE_RESPONSE received:', msg.payload.settings);
      setTabSettings(msg.payload.settings);
      setTabPowerEnabled(msg.payload.isPowerEnabled);
      setEngineStatus(msg.payload.engineStatus);
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

  // ── Load Global Database State ───────────────────────────────────────────

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

  // ── Check for existing domain rule whenever URL is known ─────────────────

  useEffect(() => {
    if (!currentUrl || currentUrl.startsWith('chrome')) {
      setExistingRuleId(null);
      return;
    }
    storageManager.findRuleForDomain(currentUrl)
      .then((rule) => setExistingRuleId(rule?.id ?? null))
      .catch(() => setExistingRuleId(null));
  }, [currentUrl]);

  // ── Subscribe to database changes ────────────────────────────────────────

  useEffect(() => {
    let off = () => {};
    try {
      off = EventBus.subscribe(MessageType.STATE_CHANGED, (msg) => {
        setState(msg.payload.state);
        // Re-check the domain rule whenever persisted state changes
        if (currentUrl && !currentUrl.startsWith('chrome')) {
          storageManager.findRuleForDomain(currentUrl)
            .then((rule) => setExistingRuleId(rule?.id ?? null))
            .catch(() => {});
        }
      });
    } catch (err) {
      console.error('[Audio-Engine-Error] STATE_CHANGED subscriber setup failed:', err);
    }
    return () => {
      off();
    };
  }, [currentUrl]);

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
        payload: { pattern, settings: tabSettings },
      } satisfies MessageOfType<MessageType.SAVE_RULE>).catch((err) => {
        console.error('[Audio-Engine-Error] SAVE_RULE publish failed:', err);
      });

      // "Saved!" feedback animation
      setSavedFeedback(true);
      if (savedFeedbackTimer.current) clearTimeout(savedFeedbackTimer.current);
      savedFeedbackTimer.current = setTimeout(() => setSavedFeedback(false), 2200);
    } catch (err) {
      console.error('[Audio-Engine-Error] handleSaveRule failed:', err);
    }
  }, [currentUrl, tabSettings]);

  // ── Delete Domain Rule & revert tab to global baseline ───────────────────

  const handleDeleteSiteRule = useCallback(async () => {
    try {
      if (!existingRuleId || !activeTabId) return;

      await storageManager.deleteRule(existingRuleId);
      setExistingRuleId(null);

      // Broadcast updated state to all listeners
      const newState = await storageManager.loadState();
      EventBus.publish({
        type: MessageType.STATE_CHANGED,
        payload: { state: newState },
      } satisfies MessageOfType<MessageType.STATE_CHANGED>).catch(() => {});

      // Revert this tab in real-time to global defaults (no rule match)
      const baseline = DEFAULT_AUDIO_SETTINGS;
      setTabSettings(baseline);
      chrome.tabs.sendMessage(
        activeTabId,
        ({ type: MessageType.SET_LIVE_VOLUME, payload: { volume: baseline.volume } }) satisfies MessageOfType<MessageType.SET_LIVE_VOLUME>,
        () => { void chrome.runtime.lastError; }
      );
      chrome.tabs.sendMessage(
        activeTabId,
        {
          type: MessageType.SET_LIVE_EQ,
          payload: { eqBands: baseline.eqBands, isEqEnabled: baseline.isEqEnabled, isMono: baseline.isMono },
        } satisfies MessageOfType<MessageType.SET_LIVE_EQ>,
        () => { void chrome.runtime.lastError; }
      );

      console.log('[Audio-Engine] Deleted site rule and reverted tab to global defaults.');
    } catch (err) {
      console.error('[Audio-Engine-Error] handleDeleteSiteRule failed:', err);
    }
  }, [existingRuleId, activeTabId]);

  // ── Reset to Default ──────────────────────────────────────────────────────

  const handleReset = useCallback(() => {
    try {
      if (activeTabId == null) return;
      const defaults = DEFAULT_AUDIO_SETTINGS;
      setTabSettings(defaults);

      // Volume reset
      chrome.tabs.sendMessage(
        activeTabId,
        {
          type: MessageType.SET_LIVE_VOLUME,
          payload: { volume: defaults.volume },
        } satisfies MessageOfType<MessageType.SET_LIVE_VOLUME>,
        () => { void chrome.runtime.lastError; }
      );

      // EQ reset
      chrome.tabs.sendMessage(
        activeTabId,
        {
          type: MessageType.SET_LIVE_EQ,
          payload: {
            eqBands: defaults.eqBands,
            isEqEnabled: defaults.isEqEnabled,
            isMono: defaults.isMono,
          },
        } satisfies MessageOfType<MessageType.SET_LIVE_EQ>,
        () => { void chrome.runtime.lastError; }
      );

      console.log('[Audio-Engine] Reset to default settings dispatched to tab', activeTabId);
    } catch (err) {
      console.error('[Audio-Engine-Error] handleReset failed:', err);
    }
  }, [activeTabId]);

  // ── Global Toggle (writes to storage, affects all tabs) ───────────────────

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

  // ── Per-Tab Power Toggle (RAM-only, targets ONLY the active tab) ──────────

  const handleTabPowerToggle = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      try {
        if (activeTabId == null) return;
        const enabled = e.target.checked;
        setTabPowerEnabled(enabled);
        chrome.tabs.sendMessage(
          activeTabId,
          {
            type: MessageType.SET_POWER_STATE,
            payload: { enabled },
          } satisfies MessageOfType<MessageType.SET_POWER_STATE>,
          () => {
            const err = chrome.runtime.lastError;
            if (err) {
              console.debug('[Audio-Engine] SET_POWER_STATE failed:', err.message);
            }
          }
        );
      } catch (err) {
        console.error('[Audio-Engine-Error] handleTabPowerToggle failed:', err);
      }
    },
    [activeTabId],
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
              <div className="header-subtitle">Browser Sound Control</div>
              <StatusBadge status={isTabReady ? engineStatus : 'sleeping'} />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
          {/* Reset button */}
          {isTabReady && tabPowerEnabled && state.isEnabled && (
            <button
              id="btn-reset-defaults"
              onClick={handleReset}
              title="Reset to default (100% volume, flat EQ)"
              style={{
                padding: '3px 9px', fontSize: '10px', fontWeight: 700,
                letterSpacing: '0.05em', textTransform: 'uppercase',
                background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.55)',
                border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px',
                cursor: 'pointer', transition: 'all 150ms',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,100,100,0.18)'; (e.currentTarget as HTMLButtonElement).style.color = '#ff6b6b'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)'; (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.55)'; }}
            >
              ↺ Reset
            </button>
          )}

          <div className="power-btn" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
          {/* Global power toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span className="power-label" style={{ fontSize: '11px', color: 'rgba(255,255,255,0.45)' }}>All</span>
            <label className="toggle" htmlFor="power-toggle" aria-label="Enable Audio Engine globally">
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
          {/* Per-tab power toggle — only when connected */}
          {isTabReady && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="power-label" style={{ fontSize: '11px', color: tabPowerEnabled ? '#48cfad' : 'rgba(255,255,255,0.35)' }}>Tab</span>
              <label className="toggle" htmlFor="tab-power-toggle" aria-label="Enable Audio Engine for this tab">
                <input
                  id="tab-power-toggle"
                  type="checkbox"
                  checked={tabPowerEnabled}
                  onChange={handleTabPowerToggle}
                  disabled={!state.isEnabled}
                />
                <span className="toggle-track" />
                <span className="toggle-thumb" />
              </label>
            </div>
          )}
          </div>
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

      {/* ── Tab power-off notice ── */}
      {isTabReady && !tabPowerEnabled && state.isEnabled && activeTab !== 'rules' && (
        <div style={{
          textAlign: 'center',
          padding: '10px 16px',
          background: 'rgba(255, 80, 80, 0.08)',
          borderBottom: '1px solid rgba(255, 80, 80, 0.2)',
          color: '#ff6b6b',
          fontSize: '12px',
          fontWeight: 500,
        }}>
          ⏸ Audio engine paused for this tab. Native audio is active.
        </div>
      )}

      {/* ── Tab panels ── */}
      <main
        id={`panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`tab-${activeTab}`}
        className={`tab-content${(state.isEnabled && tabPowerEnabled && (isTabReady || activeTab === 'rules')) ? '' : ' disabled-overlay'}`}
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

      {/* ── Save/Delete site-rule footer ── */}
      {isTabReady && state.isEnabled && currentUrl && !currentUrl.startsWith('chrome') && (activeTab === 'dashboard' || activeTab === 'equalizer') && (
        <div style={{ padding: '0 16px 16px 16px', display: 'flex', gap: '8px' }}>

          {/* Save / Saved! button */}
          <button
            id="btn-save-site-rule"
            onClick={handleSaveRule}
            disabled={savedFeedback}
            style={{
              flex: 1,
              padding: '10px 16px',
              background: savedFeedback
                ? 'linear-gradient(135deg, #22c55e, #16a34a)'
                : 'linear-gradient(135deg, #6c63ff, #48cfad)',
              color: '#ffffff',
              border: 'none',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: savedFeedback ? 'default' : 'pointer',
              boxShadow: savedFeedback
                ? '0 4px 12px rgba(34, 197, 94, 0.35)'
                : '0 4px 12px rgba(108, 99, 255, 0.3)',
              transition: 'background 300ms, box-shadow 300ms',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            {savedFeedback ? (
              <>
                <span style={{ fontSize: 15 }}>✓</span>
                Saved!
              </>
            ) : (
              <>
                <span>💾</span>
                {existingRuleId ? 'Update Rule' : 'Save for this Site'}
              </>
            )}
          </button>

          {/* Delete rule button — only when a custom rule exists */}
          {existingRuleId && (
            <button
              id="btn-delete-site-rule"
              onClick={() => { handleDeleteSiteRule().catch(() => {}); }}
              title="Remove custom rule — tab reverts to global defaults"
              style={{
                padding: '10px 14px',
                background: 'rgba(239, 68, 68, 0.10)',
                color: '#ef4444',
                border: '1px solid rgba(239, 68, 68, 0.30)',
                borderRadius: 8,
                fontSize: 16,
                cursor: 'pointer',
                transition: 'background 150ms',
                display: 'flex',
                alignItems: 'center',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.22)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.10)'; }}
            >
              🗑
            </button>
          )}

        </div>
      )}

    </div>
  );
};
