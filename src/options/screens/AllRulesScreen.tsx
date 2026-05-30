// src/options/screens/AllRulesScreen.tsx — spesifikliğe göre sıralı tüm kurallar + silme.

import { useState } from 'react';
import { t } from '../../i18n/index';
import { listAllRules } from '../../core/rules/RuleResolver';
import { EmptyState } from '../../components/EmptyState';
import type { StorageSchema, Group } from '../../types/index';

interface Props {
  data: StorageSchema;
  onDeleteSiteRule: (id: string) => void;
  onRemovePattern: (groupId: string, pattern: string) => void;
  onSetConfirmDelete: (v: boolean) => void;
}

export function AllRulesScreen({ data, onDeleteSiteRule, onRemovePattern, onSetConfirmDelete }: Props) {
  const rules = listAllRules({
    groups: data.groups,
    siteRules: data.siteRules,
    globalDefault: data.globalDefault,
  });

  const [pendingDelete, setPendingDelete] = useState<{
    label: string;
    onConfirm: () => void;
  } | null>(null);
  const [neverAsk, setNeverAsk] = useState(false);

  const requestDelete = (label: string, onConfirm: () => void) => {
    if (!data.confirmDelete) {
      onConfirm();
      return;
    }
    setPendingDelete({ label, onConfirm });
    setNeverAsk(false);
  };

  const confirmDelete = () => {
    pendingDelete?.onConfirm();
    setPendingDelete(null);
  };

  const findGroup = (pattern: string): Group | undefined =>
    data.groups.find((g) => g.patterns.includes(pattern));

  return (
    <div>
      <h1 className="screen-title">{t('nav.allRules')}</h1>
      {rules.length === 0 ? (
        <EmptyState title={t('allRules.empty.title')} desc={t('allRules.empty.desc')} />
      ) : (
        <table className="rules-table">
          <thead>
            <tr>
              <th>{t('allRules.col.pattern')}</th>
              <th>{t('allRules.col.source')}</th>
              <th>{t('allRules.col.volume')}</th>
              <th>{t('allRules.col.score')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rules.map((r, i) => {
              const siteRule = data.siteRules.find((s) => s.pattern === r.pattern);
              const group = r.source === 'group' ? findGroup(r.pattern) : undefined;
              const canDelete = r.source === 'site' || r.source === 'group';

              return (
                <tr key={`${r.pattern}-${i}`}>
                  <td className="mono">{r.pattern}</td>
                  <td>
                    <span className="src-tag">
                      {t(`source.${r.source}`)}
                      {r.source === 'group' && r.label ? ` · ${r.label}` : ''}
                    </span>
                  </td>
                  <td className="mono">{Math.round(r.volume * 100)}%</td>
                  <td className="mono">{r.score}</td>
                  <td>
                    {canDelete && (
                      <button
                        className="btn btn-ghost rule-del-btn"
                        onClick={() => {
                          const label = r.pattern;
                          if (siteRule) {
                            requestDelete(label, () => onDeleteSiteRule(siteRule.id));
                          } else if (group) {
                            requestDelete(label, () => onRemovePattern(group.id, r.pattern));
                          }
                        }}
                        title={t('common.delete')}
                      >
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {pendingDelete && (
        <div className="modal-overlay" onClick={() => setPendingDelete(null)}>
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>{t('confirm.delete.title')}</h3>
            </div>
            <p className="modal-intro">
              {t('confirm.delete.body', { label: pendingDelete.label })}
            </p>
            <label className="confirm-never">
              <input
                type="checkbox"
                checked={neverAsk}
                onChange={(e) => setNeverAsk(e.target.checked)}
              />
              {t('confirm.delete.neverAsk')}
            </label>
            <div className="modal-foot" style={{ gap: 8, display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setPendingDelete(null)}>
                {t('common.cancel')}
              </button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  if (neverAsk) onSetConfirmDelete(false);
                  confirmDelete();
                }}
              >
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
