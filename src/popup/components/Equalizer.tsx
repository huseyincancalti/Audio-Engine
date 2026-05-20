// src/popup/components/Equalizer.tsx

import React, { useCallback } from 'react';
import type { AudioSettings } from '@/types/index';

interface Props {
  settings: AudioSettings;
  onChange: (patch: Partial<AudioSettings>) => void;
}

const EQ_FREQUENCIES: readonly number[] = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const EQ_MIN = -12;
const EQ_MAX = 12;

function formatFreq(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}k` : `${hz}`;
}

function formatGain(db: number): string {
  if (db === 0) return '0';
  return db > 0 ? `+${db}` : `${db}`;
}

export const Equalizer: React.FC<Props> = ({ settings, onChange }) => {
  const { eqBands, isEqEnabled } = settings;

  const handleBandChange = useCallback(
    (index: number, value: number) => {
      const next = [...eqBands] as number[];
      next[index] = value;
      onChange({ eqBands: next });
    },
    [eqBands, onChange],
  );

  const handleReset = useCallback(() => {
    onChange({ eqBands: EQ_FREQUENCIES.map(() => 0) });
  }, [onChange]);

  const handleEqToggle = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange({ isEqEnabled: e.target.checked });
    },
    [onChange],
  );

  return (
    <>
      {/* ── EQ enable header ── */}
      <div className="section">
        <div className="card">
          <div className="control-row" style={{ paddingTop: 0 }}>
            <div className="control-info">
              <span className="control-name">10-Band Equalizer</span>
              <span className="control-desc">
                ISO standard graphic EQ · drag bands to shape tone
              </span>
            </div>
            <label className="toggle" htmlFor="eq-enable" aria-label="Enable equalizer">
              <input
                id="eq-enable"
                type="checkbox"
                checked={isEqEnabled}
                onChange={handleEqToggle}
              />
              <span className="toggle-track" />
              <span className="toggle-thumb" />
            </label>
          </div>
        </div>
      </div>

      {/* ── Band sliders ── */}
      <div className={`section${isEqEnabled ? '' : ' disabled-overlay'}`}>
        <div className="card">
          <div className="eq-grid">
            {EQ_FREQUENCIES.map((freq, i) => {
              const gain = (eqBands[i] ?? 0) as number;
              return (
                <div key={freq} className="eq-band">
                  <span className="eq-band-value">
                    {formatGain(gain)}
                  </span>

                  <div className="eq-slider-wrap">
                    <div className="eq-zero-line" />
                    <input
                      id={`eq-band-${i}`}
                      type="range"
                      className="eq-range"
                      min={EQ_MIN}
                      max={EQ_MAX}
                      step={0.5}
                      value={gain}
                      disabled={!isEqEnabled}
                      aria-label={`${formatFreq(freq)}Hz EQ band`}
                      onChange={(e) => handleBandChange(i, Number(e.target.value))}
                    />
                  </div>

                  <span className="eq-freq">{formatFreq(freq)}</span>
                </div>
              );
            })}
          </div>

          <button
            className="eq-reset-btn"
            onClick={handleReset}
            disabled={!isEqEnabled}
            aria-label="Reset all EQ bands to zero"
          >
            ↺ Flat (Reset All)
          </button>
        </div>
      </div>

      {/* ── Preset hint ── */}
      {!isEqEnabled && (
        <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 11, marginTop: -8 }}>
          Enable the equalizer to adjust bands.
        </p>
      )}
    </>
  );
};
