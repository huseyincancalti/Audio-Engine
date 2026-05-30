// src/popup/Popup.tsx
// Saf görünüm (ARCHITECTURE bölüm 3.3).
// tabCapture akışı buradan yürütülür (MV3'te popup extension page sayılır).

import { useEffect, useState, useRef } from 'react';
import { useStorage } from '../lib/useStorage';
import { useTranslation } from '../i18n/index';
import {
  getActiveTabId,
  getCurrentState,
  setLiveVolume,
  setLiveEq,
  setPowerState,
  setDrcLive,
  setMonoLive,
  saveRule,
  sendTabCaptureStreamId,
} from '../lib/messaging';
import { StorageManager } from '../core/storage/StorageManager';
import { urlToPattern } from '../core/rules/PatternMatcher';
import { isValidHex } from '../lib/colors';
import { DEFAULT_GROUP_COLOR } from '../lib/colors';
import { ColorPicker } from '../components/ColorPicker';
import { EQ_FREQUENCIES, MAX_GAIN, type ResolvedState, type Badge } from '../types/index';
import { Toast, type ToastData } from '../components/Toast';

const MAX_PCT = MAX_GAIN * 100;

function freqLabel(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}k` : `${hz}`;
}

function BadgeView({ badge }: { badge: Badge }) {
  const { t } = useTranslation();
  return (
    <span className={`chip badge-${badge}`}>
      <span className="dot" />
      {t(`badge.${badge}`)}
    </span>
  );
}

export function Popup() {
  const { data, update } = useStorage();
  const { t, setLanguage } = useTranslation();

  const [tabId, setTabId] = useState<number | null>(null);
  const [state, setState] = useState<ResolvedState | null>(null);
  const [ready, setReady] = useState(false);
  const [vol, setVol] = useState(100);
  const [eq, setEq] = useState<number[]>([0, 0, 0, 0, 0]);
  const [seeded, setSeeded] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [permDismissed, setPermDismissed] = useState(false);

  // Save Group modal
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | '__new__'>('');
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupColor, setNewGroupColor] = useState<string>(DEFAULT_GROUP_COLOR);

  const tabCaptureTriggered = useRef(false);
  const theme = data?.theme ?? 'dark';

  useEffect(() => {
    if (data) setLanguage(data.language);
  }, [data, setLanguage]);

  useEffect(() => {
    void (async () => {
      const id = await getActiveTabId();
      setTabId(id);
      if (id != null) {
        const s = await getCurrentState(id);
        if (s) setState(s);
      }
      setReady(true);
    })();
  }, []);

  // tabCapture: popup yüklenince ve advancedCapture aktifse streamId üret → content'e gönder
  useEffect(() => {
    if (!data || !tabId || tabCaptureTriggered.current) return;
    if (data.advancedCapture === 'off') return;

    tabCaptureTriggered.current = true;
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
      if (chrome.runtime.lastError || !streamId) {
        void update({ advancedCapture: 'off' });
        setToast({ message: t('popup.tabCaptureError'), variant: 'default' });
        return;
      }
      void sendTabCaptureStreamId(tabId, streamId);
    });
  }, [data, tabId, update, t]);

  useEffect(() => {
    if (state && !seeded) {
      setVol(Math.round(state.volume * 100));
      setEq(state.eq.length === EQ_FREQUENCIES.length ? [...state.eq] : [0, 0, 0, 0, 0]);
      setSeeded(true);
    }
  }, [state, seeded]);

  const apply = (s: ResolvedState | null) => { if (s) setState(s); };

  const onVolume = (pct: number) => {
    setVol(pct);
    setUnsaved(true);
    if (tabId != null) void setLiveVolume(tabId, pct / 100).then(apply);
  };

  const onEqBand = (i: number, value: number) => {
    const next = [...eq];
    next[i] = value;
    setEq(next);
    setUnsaved(true);
    if (tabId != null) void setLiveEq(tabId, next).then(apply);
  };

  const togglePower = () => {
    if (tabId == null || !state) return;
    void setPowerState(tabId, !state.power).then(apply);
  };

  const toggleDrc = () => {
    if (!data || tabId == null) return;
    const next = !data.drcEnabled;
    void update({ drcEnabled: next });
    void setDrcLive(tabId, next).then(apply);
  };

  const toggleMono = () => {
    if (!data || tabId == null) return;
    const next = !data.monoEnabled;
    void update({ monoEnabled: next });
    void setMonoLive(tabId, next).then(apply);
  };

  const grantCapturePermission = () => {
    chrome.permissions.request({ permissions: ['tabCapture'] }, (granted) => {
      if (granted && tabId != null) {
        chrome.tabs.reload(tabId);
        window.close();
      } else {
        setPermDismissed(true);
      }
    });
  };

  const toggleTheme = () => {
    if (data) void update({ theme: theme === 'dark' ? 'light' : 'dark' });
  };

  const currentSettings = () => ({ volume: vol / 100, eq });

  const onSaveSite = () => {
    if (!state) return;
    void saveRule({ kind: 'site', pattern: state.host, settings: currentSettings() });
    setUnsaved(false);
    setToast({ message: `✓ ${state.host}`, variant: 'success', duration: 2000 });
  };

  const openGroupModal = () => {
    const groups = data?.groups ?? [];
    setSelectedGroupId(groups.length > 0 ? (groups[0]?.id ?? '__new__') : '__new__');
    setNewGroupName('');
    setNewGroupColor(DEFAULT_GROUP_COLOR);
    setGroupModalOpen(true);
  };

  const confirmGroupSave = async () => {
    if (!state) return;
    const settings = currentSettings();
    const pattern = urlToPattern(state.host);

    if (selectedGroupId === '__new__') {
      const trimmed = newGroupName.trim();
      if (!trimmed) return;
      const color = isValidHex(newGroupColor) ? newGroupColor : DEFAULT_GROUP_COLOR;
      const group = await StorageManager.createGroup(trimmed, color);
      await StorageManager.addPatternToGroup(group.id, pattern, settings);
    } else {
      void saveRule({ kind: 'group', groupId: selectedGroupId, pattern, settings });
    }

    setGroupModalOpen(false);
    setUnsaved(false);
    setToast({ message: `✓ ${pattern}`, variant: 'success', duration: 2000 });
  };

  const onRefresh = () => {
    if (tabId != null) chrome.tabs.reload(tabId);
    window.close();
  };

  const groups = data?.groups ?? [];
  const drcOn = data?.drcEnabled ?? true;
  const monoOn = data?.monoEnabled ?? false;

  return (
    <div className={`popup surface-root theme-${theme}`}>
      <header className="pop-head">
        <div className="pop-brand">
          <span className="logo" />
          {t('brand')}
        </div>
        {state && <BadgeView badge={state.badge} />}
        <button className="icon-btn" onClick={toggleTheme} title={t('theme.toggle')} aria-label={t('theme.toggle')}>
          ◐
        </button>
        <button
          className="icon-btn power"
          data-on={state?.power ? 'true' : 'false'}
          onClick={togglePower}
          title={state?.power ? t('power.on') : t('power.off')}
          aria-label={t('power.on')}
        >
          ⏻
        </button>
      </header>

      {!ready && <div className="pop-unavailable">…</div>}

      {ready && !state && (
        <div className="pop-unavailable">
          <button className="refresh-btn" onClick={onRefresh} title={t('popup.refresh')}>
            ↺
            <span>{t('popup.refresh')}</span>
          </button>
          <div className="pop-foot">
            <button onClick={() => chrome.runtime.openOptionsPage()}>{t('popup.openDashboard')}</button>
          </div>
        </div>
      )}

      {state && (
        <>
          <div className="rule-pill">
            <span className="dot" style={{ background: 'var(--primary)' }} />
            <span className="host">{state.host}</span>
            <span className="src">{state.source === 'default' ? t('source.default') : t(`source.${state.source}`)}</span>
          </div>

          {state.hasConflict && (
            <div className="rule-conflict">⚠ {t('conflict.warning')}</div>
          )}

          {unsaved && (
            <div className="unsaved-indicator">
              <span className="unsaved-dot" />
              {t('popup.unsaved')}
            </div>
          )}

          {state.needsCapturePermission && !permDismissed && (
            <div className="perm-banner">
              <div className="perm-text">{t('popup.permRequired')}</div>
              <div className="perm-actions">
                <button className="btn btn-primary perm-grant" onClick={grantCapturePermission}>
                  {t('popup.permGrant')}
                </button>
                <button className="btn perm-ignore" onClick={() => setPermDismissed(true)}>
                  {t('popup.permIgnore')}
                </button>
              </div>
            </div>
          )}

          {state.captureLayer === 'bypass' && (
            <div className="pop-note bypass">
              <div>{t('popup.bypassMessage')}</div>
              <div className="bypass-adv">
                <span>{t('popup.bypassAdvHint')}</span>
                <button className="bypass-adv-link" onClick={() => chrome.runtime.openOptionsPage()}>
                  {t('popup.bypassAdvLink')} →
                </button>
              </div>
            </div>
          )}
          {state.captureLayer === 'rtc' && (
            <div className="pop-note webrtc">{t('popup.webrtcMessage')}</div>
          )}

          <div className="vol-block">
            <div className="vol-top">
              <span className="vol-label">{t('popup.volume')}</span>
              <span className="vol-num mono">
                {vol}<span className="pct">%</span>
              </span>
            </div>
            <input
              className="vol-slider"
              type="range" min={0} max={MAX_PCT} step={5} value={vol}
              onChange={(e) => onVolume(Number(e.target.value))}
            />
          </div>

          <div className="eq-block">
            <div className="eq-label">{t('popup.eq')}</div>
            <div className="eq-grid">
              {EQ_FREQUENCIES.map((hz, i) => (
                <div className="eq-band" key={hz}>
                  <span className="eq-val mono">{(eq[i] ?? 0) > 0 ? `+${eq[i]}` : eq[i] ?? 0}</span>
                  <input
                    className="eq-slider"
                    type="range" min={-12} max={12} step={1}
                    value={eq[i] ?? 0}
                    onChange={(e) => onEqBand(i, Number(e.target.value))}
                    aria-label={`${freqLabel(hz)}Hz`}
                  />
                  <span className="eq-freq mono">{freqLabel(hz)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* DRC + Mono toggles */}
          <div className="pop-toggles">
            <div className="pop-toggle-row pop-toggle-accent" data-on={drcOn}>
              <div className="pop-toggle-left">
                <span className="pop-toggle-icon">≋</span>
                <span className="pop-toggle-label pop-toggle-label--bold">{t('popup.drc')}</span>
              </div>
              <div
                className="toggle"
                role="switch"
                aria-checked={drcOn}
                data-on={drcOn}
                onClick={toggleDrc}
              />
            </div>
            <div className="pop-toggle-divider" />
            <div className="pop-toggle-row pop-toggle-accent" data-on={monoOn}>
              <div className="pop-toggle-left">
                <span className="pop-toggle-icon">◐</span>
                <span className="pop-toggle-label pop-toggle-label--bold">{t('popup.monoMode')}</span>
              </div>
              <div
                className="toggle"
                role="switch"
                aria-checked={monoOn}
                data-on={monoOn}
                onClick={toggleMono}
              />
            </div>
          </div>

          <div className="pop-actions">
            <button className="btn btn-primary" onClick={onSaveSite}>
              {t('popup.btn.saveSite')}
            </button>
            <button className="btn btn-primary" onClick={openGroupModal}>
              {t('popup.btn.saveGroup')}
            </button>
          </div>

          <div className="pop-foot">
            <button onClick={() => chrome.runtime.openOptionsPage()}>{t('popup.openDashboard')}</button>
          </div>
        </>
      )}

      {/* Save Group Modal */}
      {groupModalOpen && (
        <div className="modal-overlay" onClick={() => setGroupModalOpen(false)}>
          <div className="modal grp-select-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>{t('groupSelect.title', { pattern: state?.host ?? '' })}</h3>
              <button className="btn modal-x" onClick={() => setGroupModalOpen(false)}>×</button>
            </div>
            <div className="grp-select-list">
              {groups.map((g) => (
                <label key={g.id} className="grp-select-option">
                  <input
                    type="radio" name="popup-grp" value={g.id}
                    checked={selectedGroupId === g.id}
                    onChange={() => setSelectedGroupId(g.id)}
                  />
                  <span className="dot" style={{ background: g.color }} />
                  <span>{g.name}</span>
                </label>
              ))}
              <label className="grp-select-option grp-select-new">
                <input
                  type="radio" name="popup-grp" value="__new__"
                  checked={selectedGroupId === '__new__'}
                  onChange={() => setSelectedGroupId('__new__')}
                />
                <span>+ {t('groupSelect.newGroup')}</span>
              </label>
              {selectedGroupId === '__new__' && (
                <div className="grp-select-new-form">
                  <input
                    className="ae-input pat-in"
                    placeholder={t('newGroup.namePlaceholder')}
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                  />
                  <ColorPicker value={newGroupColor} onChange={setNewGroupColor} />
                </div>
              )}
            </div>
            <div className="modal-foot" style={{ gap: 8, display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setGroupModalOpen(false)}>{t('common.cancel')}</button>
              <button
                className="btn btn-primary"
                disabled={selectedGroupId === '__new__' && !newGroupName.trim()}
                onClick={() => void confirmGroupSave()}
              >
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <Toast
          message={toast.message}
          variant={toast.variant}
          duration={toast.duration}
          onDismiss={() => setToast(null)}
        />
      )}
    </div>
  );
}
