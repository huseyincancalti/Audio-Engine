// src/i18n/index.ts
// Basit, bağımlılıksız i18n. Varsayılan dil: 'tr'. ARCHITECTURE.md bölüm 9.
// Sadece UI bundle'ları (popup/options) import eder — content/background değil.

import { useEffect, useReducer } from 'react';
import tr from './tr.json';
import en from './en.json';
import type { Language } from '../types/index';

type Dict = Record<string, string>;

const dictionaries: Record<Language, Dict> = {
  tr: tr as Dict,
  en: en as Dict,
};

let current: Language = 'tr';
const listeners = new Set<() => void>();

/** Aktif dili döner. */
export function getLanguage(): Language {
  return current;
}

/** Aktif dili değiştirir ve aboneleri tetikler. */
export function setLanguage(lang: Language): void {
  if (lang === current) return;
  current = lang;
  listeners.forEach((l) => l());
}

/**
 * Çeviri anahtarını çözer. Eksikse 'tr' sözlüğüne, o da yoksa anahtarın
 * kendisine düşer. {name} biçimindeki yer tutucular `vars` ile değiştirilir.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const active = dictionaries[current] ?? dictionaries.tr;
  let str = active[key] ?? dictionaries.tr[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return str;
}

/** Dil değişimine abone ol (React dışı kullanımlar için). */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * React hook'u: dil değiştiğinde bileşeni yeniden render eder.
 * `const { t, lang, setLanguage } = useTranslation();`
 */
export function useTranslation() {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => subscribe(() => force()), []);
  return { t, lang: current, setLanguage };
}
