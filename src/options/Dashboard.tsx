// src/options/Dashboard.tsx — sol sidebar + ana içerik (4 ekran). ARCHITECTURE bölüm 9.

import { useEffect, useState } from 'react';
import { useStorage } from '../lib/useStorage';
import { useTranslation } from '../i18n/index';
import { StorageManager } from '../core/storage/StorageManager';
import { StartScreen } from './screens/StartScreen';
import { GroupsScreen } from './screens/GroupsScreen';
import { AllRulesScreen } from './screens/AllRulesScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { Toast, type ToastData } from '../components/Toast';
import { ContribModal } from '../components/ContribModal';
import { GitHubIcon } from '../components/GitHubIcon';
import type { Group, ThemeName, Language } from '../types/index';

type Screen = 'start' | 'groups' | 'allRules' | 'settings';

const REPO_URL = 'https://github.com/huseyincancalti/Audio-Engine';

const NAV: { key: Screen; icon: string }[] = [
  { key: 'start', icon: '✦' },
  { key: 'groups', icon: '◫' },
  { key: 'allRules', icon: '≣' },
  { key: 'settings', icon: '⚙' },
];

const NAV_LABEL: Record<Screen, string> = {
  start: 'nav.start',
  groups: 'nav.groups',
  allRules: 'nav.allRules',
  settings: 'nav.settings',
};

export function Dashboard() {
  const { data, update } = useStorage();
  const { t, setLanguage } = useTranslation();

  const [screen, setScreen] = useState<Screen | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [contribOpen, setContribOpen] = useState(false);
  const [newGroupSignal, setNewGroupSignal] = useState(0);

  const theme: ThemeName = data?.theme ?? 'dark';

  useEffect(() => {
    if (data) setLanguage(data.language);
  }, [data, setLanguage]);

  useEffect(() => {
    const el = document.documentElement;
    el.classList.remove('theme-dark', 'theme-light');
    el.classList.add(`theme-${theme}`);
  }, [theme]);

  if (!data) {
    return <div className={`dash surface-root theme-${theme}`} style={{ padding: 30 }} />;
  }

  const activeScreen: Screen = screen ?? (data.onboardingCompleted ? 'groups' : 'start');

  const navTo = (key: Screen) => {
    setScreen(key);
    if (key !== 'start' && !data.onboardingCompleted) void update({ onboardingCompleted: true });
  };

  const lang: Language = data.language;
  const setLang = (l: Language) => void update({ language: l });
  const onSetTheme = (th: ThemeName) => void update({ theme: th });
  const onToggleDrc = (v: boolean) => void update({ drcEnabled: v });

  // --- Grup CRUD ---
  const onCreateGroup = (name: string, color: string) => {
    void StorageManager.createGroup(name, color);
    if (!data.onboardingCompleted) void update({ onboardingCompleted: true });
  };
  const onUpdateGroup = (id: string, patch: Partial<Omit<Group, 'id'>>) =>
    void StorageManager.updateGroup(id, patch);
  const onAddPattern = (groupId: string, pattern: string) =>
    void StorageManager.addPatternToGroup(groupId, pattern);
  const onRemovePattern = (groupId: string, pattern: string) =>
    void StorageManager.removePatternFromGroup(groupId, pattern);

  const onDeleteGroup = (group: Group) => {
    const prev = data.groups;
    void update({ groups: prev.filter((g) => g.id !== group.id) });
    setToast({
      message: t('toast.deleted', { name: group.name }),
      actionLabel: t('toast.undo'),
      onAction: () => void update({ groups: prev }),
    });
  };

  const screenView = () => {
    switch (activeScreen) {
      case 'start':
        return <StartScreen onGoGroups={() => navTo('groups')} />;
      case 'groups':
        return (
          <GroupsScreen
            data={data}
            lang={lang}
            setLang={setLang}
            onContribute={() => setContribOpen(true)}
            openFormSignal={newGroupSignal}
            onCreateGroup={onCreateGroup}
            onDeleteGroup={onDeleteGroup}
            onUpdateGroup={onUpdateGroup}
            onAddPattern={onAddPattern}
            onRemovePattern={onRemovePattern}
          />
        );
      case 'allRules':
        return <AllRulesScreen data={data} />;
      case 'settings':
        return (
          <SettingsScreen
            data={data}
            onToggleDrc={onToggleDrc}
            onSetTheme={onSetTheme}
            lang={lang}
            setLang={setLang}
          />
        );
    }
  };

  return (
    <div className={`dash surface-root theme-${theme}`}>
      <aside className="sidebar">
        <div className="sb-brand">
          <span className="logo" />
          {t('brand')}
        </div>
        <nav className="sb-nav">
          {NAV.map((n) => (
            <button
              key={n.key}
              className="sb-link"
              data-active={activeScreen === n.key}
              onClick={() => navTo(n.key)}
            >
              <span aria-hidden="true">{n.icon}</span>
              {t(NAV_LABEL[n.key])}
            </button>
          ))}
        </nav>
        <button
          className="btn btn-primary sb-new"
          onClick={() => {
            navTo('groups');
            setNewGroupSignal((s) => s + 1);
          }}
        >
          {t('sidebar.newGroup')}
        </button>

        <div className="sb-spacer" />

        <div className="sb-sign">
          <span>{t('sidebar.signature')}</span>
          <a href={REPO_URL} target="_blank" rel="noreferrer" aria-label="GitHub">
            <GitHubIcon />
          </a>
        </div>
      </aside>

      <main className="content">{screenView()}</main>

      {toast && (
        <Toast
          message={toast.message}
          actionLabel={toast.actionLabel}
          onAction={toast.onAction}
          onDismiss={() => setToast(null)}
        />
      )}

      {contribOpen && <ContribModal onClose={() => setContribOpen(false)} />}
    </div>
  );
}
