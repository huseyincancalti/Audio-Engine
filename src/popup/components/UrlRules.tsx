// src/popup/components/UrlRules.tsx

import React, { useState, useCallback } from 'react';
import type { UrlRule, AudioSettings } from '@/types/index';
import { RulePriority } from '@/types/index';

interface Props {
  rules: readonly UrlRule[];
  currentSettings: AudioSettings;
  currentUrl: string;
  onAdd: (rule: Omit<UrlRule, 'id' | 'createdAt'>) => void;
  onDelete: (id: string) => void;
}

type PatternType = 'domain' | 'exact';

function detectPatternType(pattern: string): PatternType {
  if (pattern.includes('/') && pattern.replace(/^https?:\/\//, '').includes('/')) {
    return 'exact';
  }
  return 'domain';
}

function ruleIcon(priority: number): string {
  if (priority >= RulePriority.EXACT) return '🎯';
  if (priority >= RulePriority.DOMAIN) return '🌐';
  return '⚙️';
}

function priorityBadgeClass(priority: number): string {
  if (priority >= RulePriority.EXACT) return 'rule-badge exact';
  if (priority >= RulePriority.DOMAIN) return 'rule-badge domain';
  return 'rule-badge';
}

function priorityLabel(priority: number): string {
  if (priority >= RulePriority.EXACT) return 'Exact URL';
  if (priority >= RulePriority.DOMAIN) return 'Domain';
  return 'Global';
}

export const UrlRules: React.FC<Props> = ({
  rules,
  currentSettings,
  currentUrl,
  onAdd,
  onDelete,
}) => {
  const [pattern, setPattern] = useState('');
  const [patternType, setPatternType] = useState<PatternType>('domain');
  const [formOpen, setFormOpen] = useState(false);

  /* Save the current tab's URL + current audio settings as a new rule. */
  const handleSaveCurrentSite = useCallback(() => {
    if (!currentUrl) return;
    try {
      const { hostname } = new URL(currentUrl);
      onAdd({
        pattern: hostname,
        settings: currentSettings,
        priority: RulePriority.DOMAIN,
      });
    } catch {
      // currentUrl is not a valid URL – no-op.
    }
  }, [currentUrl, currentSettings, onAdd]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!pattern.trim()) return;

      const priority =
        patternType === 'exact' ? RulePriority.EXACT : RulePriority.DOMAIN;

      onAdd({
        pattern: pattern.trim(),
        settings: currentSettings,
        priority,
      });

      setPattern('');
      setFormOpen(false);
    },
    [pattern, patternType, currentSettings, onAdd],
  );

  /* Auto-detect type as user types. */
  const handlePatternChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setPattern(val);
      if (val) setPatternType(detectPatternType(val));
    },
    [],
  );

  return (
    <>
      {/* ── Save current site shortcut ── */}
      {currentUrl && (
        <div className="section">
          <button
            id="save-current-site-btn"
            className="btn btn-save-site"
            onClick={handleSaveCurrentSite}
            title={`Save settings for: ${currentUrl}`}
          >
            <span>⚡</span>
            Save current site settings
          </button>

          <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: -8 }}>
            {(() => {
              try { return new URL(currentUrl).hostname; } catch { return currentUrl; }
            })()}
          </p>
        </div>
      )}

      {/* ── Rules list ── */}
      <div className="section">
        <div className="section-label">Saved Rules ({rules.length})</div>

        {rules.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📋</div>
            <div>No URL rules yet.<br />Save a site above or add a custom pattern below.</div>
          </div>
        ) : (
          <div className="rules-list">
            {[...rules]
              .sort((a, b) => b.priority - a.priority)
              .map((rule) => (
                <div key={rule.id} className="rule-card">
                  <div className="rule-icon">{ruleIcon(rule.priority)}</div>

                  <div className="rule-info">
                    <div className="rule-pattern" title={rule.pattern}>
                      {rule.pattern}
                    </div>
                    <div className="rule-meta">
                      <span className={priorityBadgeClass(rule.priority)}>
                        {priorityLabel(rule.priority)}
                      </span>
                      <span className="rule-vol">
                        {Math.round(rule.settings.volume * 100)}% vol
                      </span>
                      {rule.settings.isMono && (
                        <span className="rule-badge">Mono</span>
                      )}
                      {rule.settings.isEqEnabled && (
                        <span className="rule-badge">EQ On</span>
                      )}
                    </div>
                  </div>

                  <button
                    className="rule-delete"
                    onClick={() => onDelete(rule.id)}
                    aria-label={`Delete rule for ${rule.pattern}`}
                    title="Delete rule"
                  >
                    ×
                  </button>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* ── Add custom rule ── */}
      <div className="section">
        {!formOpen ? (
          <button
            id="add-rule-btn"
            className="btn btn-secondary btn-full"
            onClick={() => setFormOpen(true)}
          >
            <span>＋</span> Add custom rule
          </button>
        ) : (
          <form className="add-rule-form" onSubmit={handleSubmit}>
            <div className="section-label" style={{ marginBottom: 0 }}>
              New Rule
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="rule-pattern">
                Pattern (domain or URL)
              </label>
              <input
                id="rule-pattern"
                className="form-input"
                type="text"
                placeholder="e.g. youtube.com or https://site.com/path.*"
                value={pattern}
                onChange={handlePatternChange}
                autoFocus
              />
            </div>

            <div className="form-row">
              <div className="form-field">
                <label className="form-label" htmlFor="rule-type">
                  Match type
                </label>
                <select
                  id="rule-type"
                  className="form-select"
                  value={patternType}
                  onChange={(e) => setPatternType(e.target.value as PatternType)}
                >
                  <option value="domain">Domain</option>
                  <option value="exact">Exact / Regex</option>
                </select>
              </div>

              <div className="form-field">
                <label className="form-label" htmlFor="rule-priority">
                  Priority weight
                </label>
                <select
                  id="rule-priority"
                  className="form-select"
                  defaultValue={
                    patternType === 'exact'
                      ? RulePriority.EXACT
                      : RulePriority.DOMAIN
                  }
                >
                  <option value={RulePriority.DOMAIN}>Domain (10)</option>
                  <option value={RulePriority.EXACT}>Exact (20)</option>
                </select>
              </div>
            </div>

            <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Current audio settings ({Math.round(currentSettings.volume * 100)}% vol
              {currentSettings.isEqEnabled ? ', EQ on' : ''}
              {currentSettings.isMono ? ', Mono' : ''}) will be saved with this rule.
            </p>

            <div className="form-row">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => { setFormOpen(false); setPattern(''); }}
              >
                Cancel
              </button>
              <button
                type="submit"
                id="save-rule-btn"
                className="btn btn-primary"
                disabled={!pattern.trim()}
              >
                Save Rule
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  );
};
