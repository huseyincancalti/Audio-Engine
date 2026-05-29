// src/options/screens/AllRulesScreen.tsx — spesifikliğe göre sıralı tüm kurallar.

import { t } from '../../i18n/index';
import { listAllRules } from '../../core/rules/RuleResolver';
import { EmptyState } from '../../components/EmptyState';
import type { StorageSchema } from '../../types/index';

export function AllRulesScreen({ data }: { data: StorageSchema }) {
  const rules = listAllRules({
    groups: data.groups,
    siteRules: data.siteRules,
    globalDefault: data.globalDefault,
  });

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
            </tr>
          </thead>
          <tbody>
            {rules.map((r, i) => (
              <tr key={`${r.pattern}-${i}`}>
                <td className="mono">{r.pattern}</td>
                <td>
                  <span className="src-tag">
                    {t(`source.${r.source}`)}
                    {r.source === 'group' ? ` · ${r.label}` : ''}
                  </span>
                </td>
                <td className="mono">{Math.round(r.volume * 100)}%</td>
                <td className="mono">{r.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
