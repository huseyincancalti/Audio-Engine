// src/components/PatternInput.tsx
// URL → *.domain.com dönüşümü + ekleme sonrası glow feedback.
// Opsiyonel: groups verilince "nereyе eklensin?" modalı açılır (B3).

import { useState, useRef } from 'react';
import { patternFromUrl } from '../core/rules/PatternMatcher';
import { t } from '../i18n/index';
import { DEFAULT_GROUP_COLOR, isValidHex } from '../lib/colors';
import { ColorPicker } from './ColorPicker';
import type { Group } from '../types/index';

interface BaseProps {
  onAdd: (pattern: string) => void;
  onAddSuccess?: (pattern: string) => void;
}

interface GroupAwareProps {
  /** Sağlanırsa "nereyе eklensin?" modalı açılır. */
  groups: Group[];
  onAddToGroup: (pattern: string, groupId: string) => void;
  /** Hiç grup yoksa çağrılır. */
  onCreateGroup?: (name: string, color: string) => void;
  onAddSuccess?: (pattern: string) => void;
  onAdd?: never;
}

type Props = BaseProps | GroupAwareProps;

function isGroupAware(p: Props): p is GroupAwareProps {
  return 'groups' in p && p.groups !== undefined;
}

export function PatternInput(props: Props) {
  const [val, setVal] = useState('');
  const [glowing, setGlowing] = useState(false);
  const glowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { pattern, valid } = patternFromUrl(val);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | '__new__'>('');
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupColor, setNewGroupColor] = useState<string>(DEFAULT_GROUP_COLOR);

  const triggerGlow = () => {
    if (glowTimer.current) clearTimeout(glowTimer.current);
    setGlowing(true);
    glowTimer.current = setTimeout(() => setGlowing(false), 650);
  };

  const submit = () => {
    if (!valid) return;

    if (isGroupAware(props)) {
      const { groups } = props;

      if (groups.length === 0) {
        // Hiç grup yok → modal aç, doğrudan "yeni grup" görünümü
        setSelectedGroupId('__new__');
        setNewGroupName('');
        setNewGroupColor(DEFAULT_GROUP_COLOR);
        setModalOpen(true);
        return;
      }

      if (groups.length === 1) {
        // Tek grup → direkt ekle
        props.onAddToGroup(pattern, groups[0]!.id);
        props.onAddSuccess?.(pattern);
        setVal('');
        triggerGlow();
        return;
      }

      // 2+ grup → modal aç
      setSelectedGroupId(groups[0]!.id);
      setModalOpen(true);
      return;
    }

    // Per-grup kullanım (eski davranış)
    props.onAdd(pattern);
    props.onAddSuccess?.(pattern);
    setVal('');
    triggerGlow();
  };

  const confirmModal = () => {
    if (!isGroupAware(props) || !valid) return;

    if (selectedGroupId === '__new__') {
      const trimmed = newGroupName.trim();
      if (!trimmed) return;
      props.onCreateGroup?.(trimmed, isValidHex(newGroupColor) ? newGroupColor : DEFAULT_GROUP_COLOR);
      // Grup oluşturuldu — pattern'i yeni gruba eklemek için onCreateGroup callback'i
      // üst bileşenin gruba eklemesini bekler; burada sadece gruba "ekle" diyemeyiz
      // (yeni grubun id'si henüz yok). onAddSuccess ile üst bilgilendiriyoruz.
    } else {
      props.onAddToGroup(pattern, selectedGroupId);
    }

    props.onAddSuccess?.(pattern);
    setVal('');
    setModalOpen(false);
    triggerGlow();
  };

  return (
    <>
      <div className={`pi${glowing ? ' pi--success' : ''}`}>
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

      {modalOpen && isGroupAware(props) && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="modal grp-select-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>{t('groupSelect.title', { pattern })}</h3>
              <button className="btn modal-x" onClick={() => setModalOpen(false)}>×</button>
            </div>

            <div className="grp-select-list">
              {props.groups.map((g) => (
                <label key={g.id} className="grp-select-option">
                  <input
                    type="radio"
                    name="group-select"
                    value={g.id}
                    checked={selectedGroupId === g.id}
                    onChange={() => setSelectedGroupId(g.id)}
                  />
                  <span className="dot" style={{ background: g.color }} />
                  <span>{g.name}</span>
                </label>
              ))}

              <label className="grp-select-option grp-select-new">
                <input
                  type="radio"
                  name="group-select"
                  value="__new__"
                  checked={selectedGroupId === '__new__'}
                  onChange={() => setSelectedGroupId('__new__')}
                />
                <span>+ {t('groupSelect.newGroup')}</span>
              </label>

              {selectedGroupId === '__new__' && (
                <div className="grp-select-new-form">
                  <input
                    className="ae-input pat-in"
                    placeholder={t('newGroup.namePlaceholder')}
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                  />
                  <ColorPicker value={newGroupColor} onChange={setNewGroupColor} />
                </div>
              )}
            </div>

            <div className="modal-foot" style={{ gap: 8, display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setModalOpen(false)}>{t('common.cancel')}</button>
              <button
                className="btn btn-primary"
                disabled={selectedGroupId === '__new__' && !newGroupName.trim()}
                onClick={confirmModal}
              >
                {t('pattern.add')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
