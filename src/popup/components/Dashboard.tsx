// src/popup/components/Dashboard.tsx

import React, { useCallback } from 'react';
import type { AudioSettings } from '@/types/index';

interface Props {
  settings: AudioSettings;
  onChange: (patch: Partial<AudioSettings>) => void;
}

const VOLUME_MIN = 0;
const VOLUME_MAX = 10; // 10.0 = 1000%

const TICKS = ['0%', '250%', '500%', '750%', '1000%'];

export const Dashboard: React.FC<Props> = ({ settings, onChange }) => {
  const volumePct = Math.round(settings.volume * 100);

  const handleVolumeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange({ volume: Number(e.target.value) });
    },
    [onChange],
  );

  const handleMonoToggle = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange({ isMono: e.target.checked });
    },
    [onChange],
  );

  const handleEqToggle = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange({ isEqEnabled: e.target.checked });
    },
    [onChange],
  );

  const fillPct = (settings.volume / VOLUME_MAX) * 100;

  return (
    <>
      {/* ── Volume ── */}
      <div className="section">
        <div className="section-label">Volume Boost</div>
        <div className="card">
          <div className="volume-header">
            <div>
              <span className="volume-value">{volumePct}</span>
              <span className="volume-unit">%</span>
            </div>
            <div className="status-dot" />
          </div>

          <div className="range-wrap">
            <div className="range-track-bg">
              <div
                className="range-track-fill"
                style={{ width: `${fillPct}%` }}
              />
              <input
                id="volume-slider"
                type="range"
                className="styled-range"
                min={VOLUME_MIN}
                max={VOLUME_MAX}
                step={0.01}
                value={settings.volume}
                onChange={handleVolumeChange}
                aria-label="Volume boost"
              />
            </div>
          </div>

          <div className="range-ticks">
            {TICKS.map((t) => (
              <span key={t} className="range-tick">{t}</span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Quick controls ── */}
      <div className="section">
        <div className="section-label">Audio Mode</div>
        <div className="card">

          <div className="control-row">
            <div className="control-info">
              <span className="control-name">Mono Mix</span>
              <span className="control-desc">Collapses stereo channels to centre</span>
            </div>
            <label className="toggle" htmlFor="mono-toggle" aria-label="Mono mix toggle">
              <input
                id="mono-toggle"
                type="checkbox"
                checked={settings.isMono}
                onChange={handleMonoToggle}
              />
              <span className="toggle-track" />
              <span className="toggle-thumb" />
            </label>
          </div>

          <div className="control-row">
            <div className="control-info">
              <span className="control-name">Equalizer</span>
              <span className="control-desc">Enable 10-band EQ processing</span>
            </div>
            <label className="toggle" htmlFor="eq-toggle" aria-label="Equalizer toggle">
              <input
                id="eq-toggle"
                type="checkbox"
                checked={settings.isEqEnabled}
                onChange={handleEqToggle}
              />
              <span className="toggle-track" />
              <span className="toggle-thumb" />
            </label>
          </div>

        </div>
      </div>
    </>
  );
};
