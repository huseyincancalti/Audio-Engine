// src/popup/Popup.tsx
// Saf görünüm (ARCHITECTURE bölüm 3.3): content script'ten çözülmüş durumu okur,
// slider/EQ değişimlerini push eder, kendi kafasından kalıcı değer tutmaz.

import { useEffect, useState } from 'react';
import { useStorage } from '../lib/useStorage';
import { useTranslation } from '../i18n/index';
import {
  getActiveTabId,
  getCurrentState,
  setLiveVolume,
  setLiveEq,
  setOneOff,
  setPowerState,
  saveRule,
} from '../lib/messaging';
import { urlToPattern } from '../core/rules/PatternMatcher';
import { EQ_FREQUENCIES, MAX_GAIN, type ResolvedState, type Badge } from '../types/index';

const MAX_PCT = MAX_GAIN * 100; // 1000

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
  const [vol, setVol] = useState(100); // yüzde
  const [eq, setEq] = useState<number[]>([0, 0, 0, 0, 0]);
  const [seeded, setSeeded] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [oneOffActive, setOneOffActive] = useState(false);

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

  useEffect(() => {
    if (state && !seeded) {
      setVol(Math.round(state.volume * 100));
      setEq(state.eq.length === EQ_FREQUENCIES.length ? [...state.eq] : [0, 0, 0, 0, 0]);
      setOneOffActive(state.source === 'one-off');
      setSeeded(true);
    }
  }, [state, seeded]);

  const apply = (s: ResolvedState | null) => {
    if (s) setState(s);
  };

  const onVolume = (pct: number) => {
    setVol(pct);
    setOneOffActive(false);
    if (tabId != null) void setLiveVolume(tabId, pct / 100).then(apply);
  };

  const onEqBand = (i: number, value: number) => {
    const next = [...eq];
    next[i] = value;
    setEq(next);
    setOneOffActive(false);
    if (tabId != null) void setLiveEq(tabId, next).then(apply);
  };

  const togglePower = () => {
    if (tabId == null || !state) return;
    void setPowerState(tabId, !state.power).then(apply);
  };

  const toggleTheme = () => {
    if (data) void update({ theme: theme === 'dark' ? 'light' : 'dark' });
  };

  const currentSettings = () => ({ volume: vol / 100, eq });

  const onSaveSite = () => {
    if (!state) return;
    void saveRule({ kind: 'site', pattern: state.host, settings: currentSettings() });
  };

  const onSaveGroup = (groupId: string) => {
    if (!state) return;
    void saveRule({
      kind: 'group',
      groupId,
      pattern: urlToPattern(state.host),
      settings: currentSettings(),
    });
    setGroupOpen(false);
  };

  const onOneOff = () => {
    if (tabId == null) return;
    void setOneOff(tabId, currentSettings()).then((s) => {
      apply(s);
      setOneOffActive(true);
    });
  };

  const groups = data?.groups ?? [];

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
          {t('popup.bypassMessage')}
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

          {state.captureLayer === 'bypass' && (
            <div className="pop-note bypass">{t('popup.bypassMessage')}</div>
          )}
          {state.captureLayer === 'rtc' && (
            <div className="pop-note webrtc">{t('popup.webrtcMessage')}</div>
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

          <div className="pop-actions">
            <button className="btn btn-primary" onClick={onSaveSite}>
              {t('popup.btn.saveSite')}
            </button>
            <button className="btn btn-primary" onClick={() => setGroupOpen((o) => !o)}>
              {t('popup.btn.saveGroup')}
            </button>
            <button
              className="btn oneoff full"
              data-on={oneOffActive ? 'true' : 'false'}
              onClick={onOneOff}
            >
              {oneOffActive ? t('popup.btn.oneOffActive') : t('popup.btn.oneOff')}
            </button>

            {groupOpen && (
              <div className="grp-menu">
                {groups.length === 0 ? (
                  <div className="grp-empty">{t('groups.empty.title')}</div>
                ) : (
                  groups.map((g) => (
                    <button key={g.id} className="grp-item" onClick={() => onSaveGroup(g.id)}>
                      <span className="dot" style={{ background: g.color }} />
                      {g.name}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="ai-slot" data-premium="true">
            <span className="lock">🔒</span>
            <span className="ai-title">{t('popup.ai.title')}</span>
            <span className="ai-badge">{t('popup.ai.badge')}</span>
          </div>

          <div className="pop-foot">
            <button onClick={() => chrome.runtime.openOptionsPage()}>{t('popup.openDashboard')}</button>
          </div>
        </>
      )}
    </div>
  );
}
