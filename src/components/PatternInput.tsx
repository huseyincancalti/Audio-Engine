// src/components/PatternInput.tsx
// URL → *.domain.com dönüşümü, anlık preview ile — ARCHITECTURE bölüm 6.2.

import { useState } from 'react';
import { patternFromUrl } from '../core/rules/PatternMatcher';
import { t } from '../i18n/index';

export function PatternInput({ onAdd }: { onAdd: (pattern: string) => void }) {
  const [val, setVal] = useState('');
  const { pattern, valid } = patternFromUrl(val);

  const submit = () => {
    if (valid) {
      onAdd(pattern);
      setVal('');
    }
  };

  return (
    <div className="pi">
      <div className="pi-row">
        <input
          className="ae-input pat-in"
          value={val}
          placeholder={t('pattern.inputPlaceholder')}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <button type="button" className="btn pat-add-btn" disabled={!valid} onClick={submit}>
          {t('pattern.add')}
        </button>
      </div>
      {val.trim() && (
        <div className="pi-preview">
          <span className="pi-arrow">→</span>
          <code className="mono pi-pattern">{pattern}</code>
          <span className="pi-desc">{t('pattern.previewDesc')}</span>
        </div>
      )}
    </div>
  );
}
