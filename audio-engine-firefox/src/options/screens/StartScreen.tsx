// src/options/screens/StartScreen.tsx — onboarding "Başlangıç" ekranı (ARCHITECTURE 10.5).

import { t } from '../../i18n/index';

const PRECEDENCE = ['oneOff', 'site', 'group', 'default'] as const;

export function StartScreen({ onGoGroups }: { onGoGroups: () => void }) {
  return (
    <div>
      <h1 className="screen-title">{t('nav.start')}</h1>

      <div className="ae-card start-hero">
        <h2>{t('start.title')}</h2>
        <div className="pattern-flow">
          <span className="pf-box">{t('start.patternFrom')}</span>
          <span className="pf-arrow">→</span>
          <span className="pf-box out">{t('start.patternTo')}</span>
        </div>
        <p>{t('start.patternDesc')}</p>
      </div>

      <p className="section-label">{t('start.precedenceTitle')}</p>
      <div className="prec-row">
        {PRECEDENCE.map((k, i) => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span className="prec-badge">
              <span className="num">{i + 1}</span>
              {t(`start.precedence.${k}`)}
            </span>
            {i < PRECEDENCE.length - 1 && <span className="prec-sep">›</span>}
          </span>
        ))}
      </div>

      <p className="section-label">{t('start.stepsTitle')}</p>
      <div className="steps">
        {[1, 2, 3].map((n) => (
          <div className="ae-card step-card" key={n}>
            <div className="step-n">{n}</div>
            <h4>{t(`start.step${n}.title`)}</h4>
            <p>{t(`start.step${n}.desc`)}</p>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 24 }}>
        <button className="btn btn-primary" onClick={onGoGroups}>
          {t('start.cta')}
        </button>
      </div>
    </div>
  );
}
