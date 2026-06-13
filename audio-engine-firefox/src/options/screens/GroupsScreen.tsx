// src/options/screens/GroupsScreen.tsx — grup yönetimi, pattern preview, çakışma uyarısı.

import { useEffect, useState } from 'react';
import { t } from '../../i18n/index';
import { ColorPicker } from '../../components/ColorPicker';
import { PatternInput } from '../../components/PatternInput';
import { EmptyState } from '../../components/EmptyState';
import { LanguageDropdown } from '../LanguageDropdown';
import { DEFAULT_GROUP_COLOR, isValidHex } from '../../lib/colors';
import { patternConflicts } from '../../core/rules/RuleResolver';
import { MAX_GAIN, type Group, type StorageSchema, type Language } from '../../types/index';

interface Props {
  data: StorageSchema;
  lang: Language;
  setLang: (l: Language) => void;
  onContribute: () => void;
  openFormSignal: number;
  onCreateGroup: (name: string, color: string) => void;
  onDeleteGroup: (group: Group) => void;
  onUpdateGroup: (id: string, patch: Partial<Omit<Group, 'id'>>) => void;
  onAddPattern: (groupId: string, pattern: string) => void;
  onRemovePattern: (groupId: string, pattern: string) => void;
  onPatternAdded?: (pattern: string) => void;
  onSetConfirmDelete?: (v: boolean) => void;
}

export function GroupsScreen(props: Props) {
  const { data, lang, setLang, onContribute, openFormSignal } = props;
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(DEFAULT_GROUP_COLOR);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [glowingGroupId, setGlowingGroupId] = useState<string | null>(null);

  // Onay modalı (grup silme)
  const [pendingDelete, setPendingDelete] = useState<{ group: Group } | null>(null);
  const [neverAsk, setNeverAsk] = useState(false);

  useEffect(() => {
    if (openFormSignal > 0) setShowForm(true);
  }, [openFormSignal]);

  const ruleData = {
    groups: data.groups,
    siteRules: data.siteRules,
    globalDefault: data.globalDefault,
  };
  const groups = data.groups;

  const submitNew = () => {
    const n = name.trim();
    if (!n) return;
    props.onCreateGroup(n, isValidHex(color) ? color : DEFAULT_GROUP_COLOR);
    setName('');
    setColor(DEFAULT_GROUP_COLOR);
    setShowForm(false);
  };

  const startEdit = (g: Group) => {
    setEditingId(g.id);
    setNameDraft(g.name);
  };
  const commitEdit = (g: Group) => {
    const n = nameDraft.trim();
    if (n && n !== g.name) props.onUpdateGroup(g.id, { name: n });
    setEditingId(null);
  };

  const requestDeleteGroup = (g: Group) => {
    if (!data.confirmDelete) {
      props.onDeleteGroup(g);
      return;
    }
    setPendingDelete({ group: g });
    setNeverAsk(false);
  };

  const confirmGroupDelete = () => {
    if (!pendingDelete) return;
    if (neverAsk) props.onSetConfirmDelete?.(false);
    props.onDeleteGroup(pendingDelete.group);
    setPendingDelete(null);
  };

  const handlePatternAdded = (groupId: string, pattern: string) => {
    props.onAddPattern(groupId, pattern);
    props.onPatternAdded?.(pattern);
    setGlowingGroupId(groupId);
    setTimeout(() => setGlowingGroupId(null), 700);
  };

  function renderCard(g: Group) {
    const editing = editingId === g.id;
    const hasConflict = g.patterns.some((p) => patternConflicts(p, ruleData, p));
    const volPct = Math.round(g.settings.volume * 100);
    const isGlowing = glowingGroupId === g.id;

    return (
      <div className={`ae-card group-card${isGlowing ? ' card--added-glow' : ''}`} key={g.id}>
        <span className="color-bar" style={{ background: g.color }} />
        <div className="gc-head">
          <span className="dot" style={{ background: g.color }} />
          <span className="gc-name">{g.name}</span>
          <span className="gc-vol mono">{volPct}%</span>
          <div className="gc-actions">
            <button className="btn g-btn" onClick={() => (editing ? commitEdit(g) : startEdit(g))}>
              {editing ? t('common.done') : t('groups.edit')}
            </button>
            <button className="btn g-btn" onClick={() => requestDeleteGroup(g)}>
              {t('groups.delete')}
            </button>
          </div>
        </div>

        {hasConflict && <div className="gc-conflict">⚠ {t('groups.conflict')}</div>}

        {g.patterns.length > 0 && (
          <div className="pat-list">
            {g.patterns.map((p) => (
              <span className="pat-tag mono" key={p}>
                {p}
                <span
                  className="x"
                  role="button"
                  onClick={() => props.onRemovePattern(g.id, p)}
                >
                  ×
                </span>
              </span>
            ))}
          </div>
        )}

        {editing && (
          <>
            <div className="ng-row">
              <span className="ng-label">{t('newGroup.namePlaceholder')}</span>
              <input
                className="ae-input pat-in"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={() => commitEdit(g)}
              />
            </div>
            <div className="ng-row">
              <span className="ng-label">{t('newGroup.color')}</span>
              <ColorPicker value={g.color} onChange={(c) => props.onUpdateGroup(g.id, { color: c })} />
            </div>
            <div className="gc-vol-edit">
              <span>{t('groups.volume')}</span>
              <input
                type="range"
                className="vol-slider"
                min={0}
                max={MAX_GAIN * 100}
                step={5}
                value={volPct}
                onChange={(e) =>
                  props.onUpdateGroup(g.id, {
                    settings: { ...g.settings, volume: Number(e.target.value) / 100 },
                  })
                }
              />
              <span className="mono">{volPct}%</span>
            </div>
          </>
        )}

        <PatternInput onAdd={(p) => handlePatternAdded(g.id, p)} />
      </div>
    );
  }

  const handleGlobalAdd = (pattern: string, groupId: string) => {
    props.onAddPattern(groupId, pattern);
    props.onPatternAdded?.(pattern);
    setGlowingGroupId(groupId);
    setTimeout(() => setGlowingGroupId(null), 700);
  };

  const handleGlobalCreateGroup = (gName: string, gColor: string) => {
    props.onCreateGroup(gName, isValidHex(gColor) ? gColor : DEFAULT_GROUP_COLOR);
  };

  return (
    <div>
      <div className="screen-head">
        <h1 className="screen-title">{t('groups.title')}</h1>
        <LanguageDropdown lang={lang} setLang={setLang} onContribute={onContribute} />
      </div>

      {/* Global pattern input — grup seçim modalı ile */}
      {(groups.length > 0) && (
        <div style={{ marginBottom: 18 }}>
          <PatternInput
            groups={groups}
            onAddToGroup={handleGlobalAdd}
            onCreateGroup={handleGlobalCreateGroup}
            onAddSuccess={(p) => props.onPatternAdded?.(p)}
          />
        </div>
      )}

      {groups.length === 0 && !showForm && (
        <EmptyState
          title={t('groups.empty.title')}
          desc={t('groups.empty.desc')}
          actionLabel={t('groups.empty.cta')}
          onAction={() => setShowForm(true)}
        />
      )}

      {groups.length > 0 && <div className="group-list">{groups.map((g) => renderCard(g))}</div>}

      {showForm ? (
        <div className="ae-card new-group">
          <div className="ng-row">
            <span className="ng-label">{t('newGroup.namePlaceholder')}</span>
            <input
              className="ae-input pat-in"
              value={name}
              placeholder={t('newGroup.namePlaceholder')}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitNew()}
            />
          </div>
          <div className="ng-row">
            <span className="ng-label">{t('newGroup.color')}</span>
            <ColorPicker value={color} onChange={setColor} />
          </div>
          <div className="ng-actions">
            <button className="btn btn-primary" disabled={!name.trim()} onClick={submitNew}>
              {t('newGroup.create')}
            </button>
            <button
              className="btn"
              onClick={() => {
                setShowForm(false);
                setName('');
              }}
            >
              {t('newGroup.cancel')}
            </button>
          </div>
        </div>
      ) : (
        groups.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <button className="btn" onClick={() => setShowForm(true)}>
              {t('sidebar.newGroup')}
            </button>
          </div>
        )
      )}

      {pendingDelete && (
        <div className="modal-overlay" onClick={() => setPendingDelete(null)}>
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>{t('confirm.delete.title')}</h3>
            </div>
            <p className="modal-intro">
              {t('confirm.delete.body', { label: pendingDelete.group.name })}
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
              <button className="btn btn-danger" onClick={confirmGroupDelete}>
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
