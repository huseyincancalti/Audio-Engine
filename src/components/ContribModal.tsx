// src/components/ContribModal.tsx
// Çeviri katkı akışı: GitHub PR yolu + e-posta yolu — ARCHITECTURE bölüm 9, master prompt D.

import { t } from '../i18n/index';
import en from '../i18n/en.json';

const REPO_URL = 'https://github.com/huseyincancalti/Audio-Engine';

export function ContribModal({ onClose }: { onClose: () => void }) {
  const downloadEn = () => {
    const blob = new Blob([JSON.stringify(en, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'en.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{t('contrib.title')}</h3>
          <button type="button" className="btn btn-ghost modal-x" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </div>
        <p className="modal-intro">{t('contrib.intro')}</p>

        <div className="contrib-path">
          <h4>{t('contrib.github.title')}</h4>
          <ol>
            <li>{t('contrib.github.step1')}</li>
            <li>{t('contrib.github.step2')}</li>
            <li>{t('contrib.github.step3')}</li>
          </ol>
          <a className="btn btn-primary" href={REPO_URL} target="_blank" rel="noreferrer">
            {t('contrib.github.button')}
          </a>
        </div>

        <div className="contrib-path">
          <h4>{t('contrib.email.title')}</h4>
          <ol>
            <li>{t('contrib.email.step1')}</li>
            <li>{t('contrib.email.step2')}</li>
            <li>{t('contrib.email.step3')}</li>
          </ol>
          <button type="button" className="btn" onClick={downloadEn}>
            {t('contrib.email.download')}
          </button>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>
            {t('contrib.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
