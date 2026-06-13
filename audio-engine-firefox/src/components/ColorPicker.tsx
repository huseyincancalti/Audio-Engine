// src/components/ColorPicker.tsx
// 10 preset dot + özel hex girişi — ARCHITECTURE bölüm 6.1.

import { GROUP_COLOR_PRESETS, isValidHex } from '../lib/colors';
import { t } from '../i18n/index';

export function ColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <div className="cp">
      <div className="cp-dots">
        {GROUP_COLOR_PRESETS.map((c) => (
          <button
            key={c}
            type="button"
            className="cp-dot"
            data-active={value.toLowerCase() === c.toLowerCase()}
            style={{ background: c }}
            onClick={() => onChange(c)}
            aria-label={c}
          />
        ))}
      </div>
      <div className="cp-hex">
        <span
          className="cp-swatch"
          style={{ background: isValidHex(value) ? value : 'transparent' }}
        />
        <input
          className="ae-input pat-in"
          value={value}
          maxLength={7}
          placeholder="#A82858"
          onChange={(e) => onChange(e.target.value)}
          aria-label={t('newGroup.customHex')}
        />
      </div>
    </div>
  );
}
