// src/options/LanguageDropdown.tsx — dil seçici + çeviri katkı seçeneği.

import { useState } from 'react';
import { t } from '../i18n/index';
import type { Language } from '../types/index';

export function LanguageDropdown({
  lang,
  setLang,
  onContribute,
}: {
  lang: Language;
  setLang: (l: Language) => void;
  onContribute: () => void;
}) {
  const [open, setOpen] = useState(false);
  const label = lang === 'tr' ? 'Türkçe' : 'English';

  return (
    <div className="lang-dd">
      <button className="btn lang-btn" onClick={() => setOpen((o) => !o)}>
        🌐 {label} ▾
      </button>
      {open && (
        <div className="lang-menu">
          <button
            data-active={lang === 'tr'}
            onClick={() => {
              setLang('tr');
              setOpen(false);
            }}
          >
            🇹🇷 Türkçe
          </button>
          <button
            data-active={lang === 'en'}
            onClick={() => {
              setLang('en');
              setOpen(false);
            }}
          >
            🇬🇧 English
          </button>
          <div className="divider" />
          <button
            onClick={() => {
              onContribute();
              setOpen(false);
            }}
          >
            {t('lang.contribute')}
          </button>
        </div>
      )}
    </div>
  );
}
