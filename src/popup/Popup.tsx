// src/popup/Popup.tsx
// Saf görünüm. Kontrol mesajları background'a, VU seviyesi offscreen'e gider.
// Güç düğmesi = bu sekme için yakalamayı aç/kapat.

import { useEffect, useState, useRef, useCallback } from 'react';
import { useStorage } from '../lib/useStorage';
import { useTranslation } from '../i18n/index';
import {
  getActiveTabId,
  getTabStatus,
  enableAudio,
  disableAudio,
  updateSettings,
  getLevel,
  saveRule,
} from '../lib/messaging';
import { StorageManager } from '../core/storage/StorageManager';
import { urlToPattern } from '../core/rules/PatternMatcher';
import { isValidHex, DEFAULT_GROUP_COLOR } from '../lib/colors';
import { ColorPicker } from '../components/ColorPicker';
import {
  EQ_FREQUENCIES,
  MAX_GAIN,
  type CaptureSettings,
  type TabStatus,
  type Badge,
} from '../types/index';
import { Toast, type ToastData } from '../components/Toast';

const MAX_PCT = MAX_GAIN * 100;
const VU_THRESHOLD = 1; // bu seviyenin üzerinde rozet nabız atar

function freqLabel(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}k` : `${hz}`;
}

function BadgeView({ badge, pulse }: { badge: Badge; pulse: boolean }) {
  const { t } = useTranslation();
  return (
    <span className={`chip badge-${badge}`}>
      <span className={`dot${pulse ? ' dot-pulse' : ''}`} />
      {t(`badge.${badge}`)}
    </span>
  );
}

export function Popup() {
  const { data, update } = useStorage();
  const { t, setLanguage } = useTranslation();

  const [tabId, setTabId] = useState<number | null>(null);
  const [status, setStatus] = useState<TabStatus | null>(null);
  const [ready, setReady] = useState(false);
  const [vol, setVol] = useState(100);
  const [eq, setEq] = useState<number[]>([0, 0, 0, 0, 0]);
  const [seeded, setSeeded] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [level, setLevel] = useState(0);

  // Save Group modal
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | '__new__'>('');
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupColor, setNewGroupColor] = useState<string>(DEFAULT_GROUP_COLOR);

  const updateTimer = useRef<number | null>(null);
  const enabling = useRef(false);
  // Yakalama başlatılırken hızlı slider hareketleri düşmesin diye en güncel ayarı tut.
  const latest = useRef<CaptureSettings | null>(null);
  const theme = data?.theme ?? 'dark';
  const drcOn = data?.drcEnabled ?? true;
  const monoOn = data?.monoEnabled ?? false;
  const groups = data?.groups ?? [];

  useEffect(() => {
    if (data) setLanguage(data.language);
  }, [data, setLanguage]);

  useEffect(() => {
    void (async () => {
      const id = await getActiveTabId();
      setTabId(id);
      if (id != null) {
        const s = await getTabStatus(id);
        if (s) setStatus(s);
      }
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (status && !seeded) {
      setVol(Math.round(status.volume * 100));
      setEq(status.eq.length === EQ_FREQUENCIES.length ? [...status.eq] : [0, 0, 0, 0, 0]);
      setSeeded(true);
    }
  }, [status, seeded]);

  // VU metre — yalnızca yakalama aktifken 200ms'de bir sorgula.
  useEffect(() => {
    if (!status?.active || tabId == null) {
      setLevel(0);
      return;
    }
    const poll = window.setInterval(() => {
      void getLevel(tabId).then(setLevel);
    }, 200);
    return () => window.clearInterval(poll);
  }, [status?.active, tabId]);

  const currentSettings = useCallback(
    (): CaptureSettings => ({ volume: vol / 100, eq, drcEnabled: drcOn, monoEnabled: monoOn }),
    [vol, eq, drcOn, monoOn],
  );

  /** Yakalama aktifse offscreen'e debounce'lu canlı ayar gönder; değilse başlat. */
  const applyLive = (next: CaptureSettings) => {
    if (tabId == null) return;
    latest.current = next;
    if (status?.active) {
      if (updateTimer.current) window.clearTimeout(updateTimer.current);
      updateTimer.current = window.setTimeout(() => void updateSettings(tabId, next), 50);
      return;
    }
    if (enabling.current) return;
    enabling.current = true;
    void enableAudio(tabId, next).then((res) => {
      enabling.current = false;
      if (res.ok) {
        setStatus((s) => (s ? { ...s, active: true } : s));
        if (latest.current) void updateSettings(tabId, latest.current);
      }
    });
  };

  const onVolume = (pct: number) => {
    setVol(pct);
    setUnsaved(true);
    applyLive({ volume: pct / 100, eq, drcEnabled: drcOn, monoEnabled: monoOn });
  };

  const onEqBand = (i: number, value: number) => {
    const next = [...eq];
    next[i] = value;
    setEq(next);
    setUnsaved(true);
    applyLive({ volume: vol / 100, eq: next, drcEnabled: drcOn, monoEnabled: monoOn });
  };

  // Güç düğmesi: aktifse durdur, değilse başlat.
  const togglePower = () => {
    if (tabId == null) return;
    if (status?.active) {
      void disableAudio(tabId);
      setStatus((s) => (s ? { ...s, active: false } : s));
    } else {
      applyLive(currentSettings());
    }
  };

  // DRC/Mono global anahtarlar — storage'a yaz; background aktif yakalamalara yansıtır.
  const toggleDrc = () => {
    if (data) void update({ drcEnabled: !data.drcEnabled });
  };
  const toggleMono = () => {
    if (data) void update({ monoEnabled: !data.monoEnabled });
  };

  const toggleTheme = () => {
    if (data) void update({ theme: theme === 'dark' ? 'light' : 'dark' });
  };

  const onSaveSite = () => {
    if (!status) return;
    void saveRule({ kind: 'site', pattern: status.host, settings: { volume: vol / 100, eq } });
    setUnsaved(false);
    setToast({ message: `✓ ${status.host}`, variant: 'success', duration: 2000 });
  };

  const openGroupModal = () => {
    setSelectedGroupId(groups.length > 0 ? (groups[0]?.id ?? '__new__') : '__new__');
    setNewGroupName('');
    setNewGroupColor(DEFAULT_GROUP_COLOR);
    setGroupModalOpen(true);
  };

  const confirmGroupSave = async () => {
    if (!status) return;
    const settings = { volume: vol / 100, eq };
    const pattern = urlToPattern(status.host);

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

  const badge: Badge = status?.active ? 'active' : 'ready';

  return (
    <div className={`popup surface-root theme-${theme}`}>
      <header className="pop-head">
        <div className="pop-brand">
          <span className="logo" />
          {t('brand')}
        </div>
        {status && <BadgeView badge={badge} pulse={status.active && level > VU_THRESHOLD} />}
        <button className="icon-btn" onClick={toggleTheme} title={t('theme.toggle')} aria-label={t('theme.toggle')}>
          ◐
        </button>
        <button
          className="icon-btn power"
          data-on={status?.active ? 'true' : 'false'}
          onClick={togglePower}
          title={status?.active ? t('power.on') : t('power.off')}
          aria-label={t('power.on')}
        >
          ⏻
        </button>
      </header>

      {!ready && <div className="pop-unavailable">…</div>}

      {ready && !status && (
        <div className="pop-unavailable">
          <button className="refresh-btn" onClick={onRefresh} title={t('popup.refresh')}>
            ↺<span>{t('popup.refresh')}</span>
          </button>
          <div className="pop-foot">
            <button onClick={() => chrome.runtime.openOptionsPage()}>{t('popup.openDashboard')}</button>
          </div>
        </div>
      )}

      {status && (
        <>
          <div className="rule-pill">
            <span className="dot" style={{ background: 'var(--primary)' }} />
            <span className="host">{status.host}</span>
            <span className="src">
              {status.source === 'default' ? t('source.default') : t(`source.${status.source}`)}
            </span>
          </div>

          {status.hasConflict && <div className="rule-conflict">⚠ {t('conflict.warning')}</div>}

          {unsaved && (
            <div className="unsaved-indicator">
              <span className="unsaved-dot" />
              {t('popup.unsaved')}
            </div>
          )}

          <div className="vol-block">
            <div className="vol-top">
              <span className="vol-label">{t('popup.volume')}</span>
              <span className="vol-num mono">
                {vol}
                <span className="pct">%</span>
              </span>
            </div>
            <input
              className="vol-slider"
              type="range"
              min={0}
              max={MAX_PCT}
              step={5}
              value={vol}
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
                    type="range"
                    min={-12}
                    max={12}
                    step={1}
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
              <div className="toggle" role="switch" aria-checked={drcOn} data-on={drcOn} onClick={toggleDrc} />
            </div>
            <div className="pop-toggle-divider" />
            <div className="pop-toggle-row pop-toggle-accent" data-on={monoOn}>
              <div className="pop-toggle-left">
                <span className="pop-toggle-icon">◐</span>
                <span className="pop-toggle-label pop-toggle-label--bold">{t('popup.monoMode')}</span>
              </div>
              <div className="toggle" role="switch" aria-checked={monoOn} data-on={monoOn} onClick={toggleMono} />
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
              <h3>{t('groupSelect.title', { pattern: status?.host ?? '' })}</h3>
              <button className="btn modal-x" onClick={() => setGroupModalOpen(false)}>
                ×
              </button>
            </div>
            <div className="grp-select-list">
              {groups.map((g) => (
                <label key={g.id} className="grp-select-option">
                  <input
                    type="radio"
                    name="popup-grp"
                    value={g.id}
                    checked={selectedGroupId === g.id}
                    onChange={() => setSelectedGroupId(g.id)}
                  />
                  <span className="dot" style={{ background: g.color }} />
                  <span>{g.name}</span>
                </label>
              ))}
              <label className="grp-select-option grp-select-new">
                <input
                  type="radio"
                  name="popup-grp"
                  value="__new__"
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
              <button className="btn" onClick={() => setGroupModalOpen(false)}>
                {t('common.cancel')}
              </button>
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
