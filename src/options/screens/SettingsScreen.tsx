// src/options/screens/SettingsScreen.tsx — DRC toggle, tema, dil, kilitli AI slot.

import { t } from '../../i18n/index';
import type { StorageSchema, ThemeName, Language } from '../../types/index';

export function SettingsScreen({
  data,
  onToggleDrc,
  onSetTheme,
  lang,
  setLang,
}: {
  data: StorageSchema;
  onToggleDrc: (v: boolean) => void;
  onSetTheme: (t: ThemeName) => void;
  lang: Language;
  setLang: (l: Language) => void;
}) {
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
