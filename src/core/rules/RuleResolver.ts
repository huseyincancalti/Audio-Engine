// src/core/rules/RuleResolver.ts
// Öncelik sırası + spesifiklik yarışması. Saf fonksiyonlar (content & background paylaşır).
// ARCHITECTURE.md bölüm 3.1, 3.2.

import type { AudioSettings, Group, SiteRule, RuleSource } from '../../types/index';
import { cloneSettings } from '../../types/index';
import { matches, specificityScore, isExact } from './PatternMatcher';

export interface RuleData {
  groups: Group[];
  siteRules: SiteRule[];
  globalDefault: AudioSettings;
}

interface Candidate {
  settings: AudioSettings;
  source: Exclude<RuleSource, 'one-off' | 'default'>;
  label: string;
  pattern: string;
  score: number;
  exact: boolean;
}

export interface ResolvedRule {
  settings: AudioSettings;
  source: RuleSource;
  sourceLabel: string;
  hasConflict: boolean;
  /** Site/grup kuralı eşleşti mi? (default tek başına "kural" sayılmaz — auto-wake için.) */
  hasRule: boolean;
}

/** host için eşleşen tüm site + grup adaylarını toplar. */
function collectCandidates(host: string, data: RuleData): Candidate[] {
  const out: Candidate[] = [];

  for (const rule of data.siteRules) {
    if (matches(rule.pattern, host)) {
      out.push({
        settings: rule.settings,
        source: 'site',
        label: rule.pattern,
        pattern: rule.pattern,
        score: specificityScore(rule.pattern),
        exact: isExact(rule.pattern),
      });
    }
  }

  for (const group of data.groups) {
    for (const pattern of group.patterns) {
      if (matches(pattern, host)) {
        out.push({
          settings: group.settings,
          source: 'group',
          label: group.name,
          pattern,
          score: specificityScore(pattern),
          exact: isExact(pattern),
        });
      }
    }
  }

  return out;
}

/** Aday sıralaması: skor ↓, eşitlikte exact önce, sonra site > grup. */
function compareCandidates(a: Candidate, b: Candidate): number {
  if (b.score !== a.score) return b.score - a.score;
  if (a.exact !== b.exact) return a.exact ? -1 : 1;
  if (a.source !== b.source) return a.source === 'site' ? -1 : 1;
  return 0;
}

/**
 * host için kuralı çözer. `oneOff` verilirse (content RAM) en yüksek önceliği alır.
 */
export function resolve(host: string, data: RuleData, oneOff?: AudioSettings | null): ResolvedRule {
  if (oneOff) {
    return {
      settings: cloneSettings(oneOff),
      source: 'one-off',
      sourceLabel: host,
      hasConflict: false,
      hasRule: true,
    };
  }

  const candidates = collectCandidates(host, data);

  if (candidates.length === 0) {
    return {
      settings: cloneSettings(data.globalDefault),
      source: 'default',
      sourceLabel: '',
      hasConflict: false,
      hasRule: false,
    };
  }

  candidates.sort(compareCandidates);
  const winner = candidates[0]!;

  return {
    settings: cloneSettings(winner.settings),
    source: winner.source,
    sourceLabel: winner.label,
    hasConflict: candidates.length >= 2,
    hasRule: true,
  };
}

export interface ListedRule {
  pattern: string;
  source: 'site' | 'group';
  label: string;
  volume: number;
  score: number;
}

/** "Tüm Kurallar" ekranı için: tüm kuralları spesifikliğe göre sıralı düz liste. */
export function listAllRules(data: RuleData): ListedRule[] {
  const out: ListedRule[] = [];

  for (const rule of data.siteRules) {
    out.push({
      pattern: rule.pattern,
      source: 'site',
      label: rule.pattern,
      volume: rule.settings.volume,
      score: specificityScore(rule.pattern),
    });
  }

  for (const group of data.groups) {
    for (const pattern of group.patterns) {
      out.push({
        pattern,
        source: 'group',
        label: group.name,
        volume: group.settings.volume,
        score: specificityScore(pattern),
      });
    }
  }

  out.sort((a, b) => b.score - a.score);
  return out;
}

/** Bir pattern'in mevcut kurallarla çakışıp çakışmadığını döner (dashboard uyarısı). */
export function patternConflicts(pattern: string, data: RuleData, ignorePattern?: string): boolean {
  const all = listAllRules(data);
  // Pattern'in eşleştiği host örneği yerine, doğrudan başka bir pattern'le
  // aynı host'lara denk gelip gelmediğini kaba bir testle kontrol ederiz:
  // aynı base domain'i hedefleyen başka bir pattern varsa çakışma say.
  const base = pattern.replace(/^\*\./, '');
  return all.some((r) => {
    if (r.pattern === pattern || r.pattern === ignorePattern) return false;
    const rBase = r.pattern.replace(/^\*\./, '');
    return rBase === base || base.endsWith('.' + rBase) || rBase.endsWith('.' + base);
  });
}
