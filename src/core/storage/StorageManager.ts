// src/core/storage/StorageManager.ts
// chrome.storage.local sarmalayıcısı. SADECE kalıcı kurallar + ayarlar.
// Tek seferlik ayar BURADA tutulmaz (content RAM'inde) — ARCHITECTURE bölüm 3.3, 13.

import {
  DEFAULT_STORAGE,
  DEFAULT_AUDIO_SETTINGS,
  type StorageSchema,
  type Group,
  type SiteRule,
  type AudioSettings,
} from '../../types/index';

const AREA = chrome.storage.local;

function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Tüm storage'ı varsayılanlarla birleştirip döner. */
async function getAll(): Promise<StorageSchema> {
  const raw = (await AREA.get(null)) as Partial<StorageSchema>;
  return {
    ...DEFAULT_STORAGE,
    ...raw,
    // İç içe alanlar için güvenli birleşim:
    globalDefault: raw.globalDefault ?? {
      ...DEFAULT_AUDIO_SETTINGS,
      eq: [...DEFAULT_AUDIO_SETTINGS.eq],
    },
    groups: raw.groups ?? [],
    siteRules: raw.siteRules ?? [],
  };
}

/** Tek bir anahtarı oku. */
async function get<K extends keyof StorageSchema>(key: K): Promise<StorageSchema[K]> {
  const all = await getAll();
  return all[key];
}

/** Kısmi güncelleme yaz. */
async function set(patch: Partial<StorageSchema>): Promise<void> {
  await AREA.set(patch);
}

// --- Site kuralları ---

/** Site kuralı ekle/güncelle (aynı pattern varsa üzerine yazar). */
async function upsertSiteRule(pattern: string, settings: AudioSettings): Promise<SiteRule> {
  const rules = await get('siteRules');
  const existing = rules.find((r) => r.pattern === pattern);
  let rule: SiteRule;
  if (existing) {
    rule = { ...existing, settings };
    await set({ siteRules: rules.map((r) => (r.id === existing.id ? rule : r)) });
  } else {
    rule = { id: genId(), pattern, settings };
    await set({ siteRules: [...rules, rule] });
  }
  return rule;
}

async function deleteSiteRule(id: string): Promise<void> {
  const rules = await get('siteRules');
  await set({ siteRules: rules.filter((r) => r.id !== id) });
}

// --- Gruplar ---

async function createGroup(name: string, color: string): Promise<Group> {
  const groups = await get('groups');
  const group: Group = {
    id: genId(),
    name,
    color,
    patterns: [],
    settings: { ...DEFAULT_AUDIO_SETTINGS, eq: [...DEFAULT_AUDIO_SETTINGS.eq] },
  };
  await set({ groups: [...groups, group] });
  return group;
}

async function updateGroup(id: string, patch: Partial<Omit<Group, 'id'>>): Promise<void> {
  const groups = await get('groups');
  await set({ groups: groups.map((g) => (g.id === id ? { ...g, ...patch } : g)) });
}

async function deleteGroup(id: string): Promise<void> {
  const groups = await get('groups');
  await set({ groups: groups.filter((g) => g.id !== id) });
}

/** Gruba pattern ekle (zaten varsa yok sayar) ve grubun ayarını günceller. */
async function addPatternToGroup(
  groupId: string,
  pattern: string,
  settings?: AudioSettings,
): Promise<void> {
  const groups = await get('groups');
  await set({
    groups: groups.map((g) => {
      if (g.id !== groupId) return g;
      const patterns = g.patterns.includes(pattern) ? g.patterns : [...g.patterns, pattern];
      return { ...g, patterns, settings: settings ?? g.settings };
    }),
  });
}

async function removePatternFromGroup(groupId: string, pattern: string): Promise<void> {
  const groups = await get('groups');
  await set({
    groups: groups.map((g) =>
      g.id === groupId ? { ...g, patterns: g.patterns.filter((p) => p !== pattern) } : g,
    ),
  });
}

/** storage.local değişimine abone ol. Dönen fonksiyonla iptal et. */
function onChange(listener: (changes: Record<string, chrome.storage.StorageChange>) => void): () => void {
  const wrapped = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ): void => {
    if (area === 'local') listener(changes);
  };
  chrome.storage.onChanged.addListener(wrapped);
  return () => chrome.storage.onChanged.removeListener(wrapped);
}

export const StorageManager = {
  getAll,
  get,
  set,
  upsertSiteRule,
  deleteSiteRule,
  createGroup,
  updateGroup,
  deleteGroup,
  addPatternToGroup,
  removePatternFromGroup,
  onChange,
  genId,
} as const;
