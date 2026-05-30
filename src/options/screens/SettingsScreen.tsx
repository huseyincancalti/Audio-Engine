// src/options/screens/SettingsScreen.tsx — DRC toggle, tema, dil, gelişmiş yakalama, silme onayı.

import { t } from '../../i18n/index';
import type { StorageSchema, ThemeName, Language, AdvancedCapture } from '../../types/index';

export function SettingsScreen({
  data,
  onToggleDrc,
  onSetTheme,
  onSetAdvancedCapture,
  onSetConfirmDelete,
  lang,
  setLang,
}: {
  data: StorageSchema;
  onToggleDrc: (v: boolean) => void;
  onSetTheme: (t: ThemeName) => void;
  onSetAdvancedCapture: (v: AdvancedCapture) => void;
  onSetConfirmDelete: (v: boolean) => void;
  lang: Language;
  setLang: (l: Language) => void;
}) {
  const handleAdvancedCapture = (next: AdvancedCapture) => {
    if (next === 'off') {
      onSetAdvancedCapture('off');
      return;
    }
    // İzin iste
    chrome.permissions.request({ permissions: ['tabCapture'] }, (granted) => {
      if (granted) {
        onSetAdvancedCapture(next);
      } else {
        onSetAdvancedCapture('off');
        // İzin reddedildi — toast göstermek için üst bileşene sinyal atmak yerine
        // storage'da off kalır; kullanıcı radyo butonunun geri döndüğünü görür.
      }
    });
  };

  return (
    <div>
      <h1 className="screen-title">{t('settings.title')}</h1>

      <div className="ae-card setting-row">
        <div className="sr-text">
          <div className="sr-title">{t('settings.drc.title')}</div>
          <div className="sr-desc">{t('settings.drc.desc')}</div>
        </div>
        <div
          className="toggle"
          role="switch"
          aria-checked={data.drcEnabled}
          data-on={data.drcEnabled}
          onClick={() => onToggleDrc(!data.drcEnabled)}
        />
      </div>

      <div className="ae-card setting-row">
        <div className="sr-text">
          <div className="sr-title">{t('settings.confirmDelete.title')}</div>
          <div className="sr-desc">{t('settings.confirmDelete.desc')}</div>
        </div>
        <div
          className="toggle"
          role="switch"
          aria-checked={data.confirmDelete}
          data-on={data.confirmDelete}
          onClick={() => onSetConfirmDelete(!data.confirmDelete)}
        />
      </div>

      <div className="ae-card setting-row">
        <div className="sr-text">
          <div className="sr-title">{t('settings.theme.title')}</div>
          <div className="sr-desc">{t('settings.theme.desc')}</div>
        </div>
        <div className="seg">
          <button data-active={data.theme === 'dark'} onClick={() => onSetTheme('dark')}>
            {t('settings.theme.dark')}
          </button>
          <button data-active={data.theme === 'light'} onClick={() => onSetTheme('light')}>
            {t('settings.theme.light')}
          </button>
        </div>
      </div>

      <div className="ae-card setting-row">
        <div className="sr-text">
          <div className="sr-title">{t('settings.language.title')}</div>
        </div>
        <div className="seg">
          <button data-active={lang === 'tr'} onClick={() => setLang('tr')}>
            TR
          </button>
          <button data-active={lang === 'en'} onClick={() => setLang('en')}>
            EN
          </button>
        </div>
      </div>

      {/* Gelişmiş Ses Yakalama (C2) */}
      <div className="ae-card advanced-capture-card">
        <div className="sr-text" style={{ marginBottom: 14 }}>
          <div className="sr-title">🎙 {t('settings.advancedCapture.title')}</div>
          <div className="sr-desc">{t('settings.advancedCapture.desc')}</div>
          <div className="sr-desc" style={{ marginTop: 4, fontSize: 11 }}>
            {t('settings.advancedCapture.privacy')}
          </div>
        </div>
        <div className="capture-radio-group">
          {(['off', 'global', 'tab'] as AdvancedCapture[]).map((opt) => (
            <label key={opt} className="capture-radio-option">
              <input
                type="radio"
                name="advancedCapture"
                value={opt}
                checked={data.advancedCapture === opt}
                onChange={() => handleAdvancedCapture(opt)}
              />
              <span>{t(`settings.advancedCapture.${opt}`)}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="ae-card setting-row locked-slot" data-premium="true">
        <div className="sr-text">
          <div className="sr-title">🔒 {t('settings.ai.title')}</div>
          <div className="sr-desc">{t('settings.ai.desc')}</div>
        </div>
        <span className="chip">{t('settings.ai.badge')}</span>
      </div>
    </div>
  );
}
