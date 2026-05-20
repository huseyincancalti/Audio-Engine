// src/core/storage/StorageManager.ts

import {
  type AudioSettings,
  type ExtensionState,
  type UrlRule,
  CURRENT_STATE_VERSION,
  DEFAULT_EXTENSION_STATE,
} from '@/types/index';

// ---------------------------------------------------------------------------
// Storage key constants – single source of truth for chrome.storage keys.
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'audioEngineState' as const;

// ---------------------------------------------------------------------------
// Migration registry
// ---------------------------------------------------------------------------

interface MigrationStep {
  readonly fromVersion: number;
  migrate(state: Record<string, unknown>): Record<string, unknown>;
}

const MIGRATIONS: readonly MigrationStep[] = [];

// ---------------------------------------------------------------------------
// URL matcher helpers – each function has a single responsibility (SRP).
// ---------------------------------------------------------------------------

function matchesExact(url: string, pattern: string): boolean {
  try {
    const regex = new RegExp(`^${pattern}$`);
    return regex.test(url);
  } catch (err) {
    console.error('[Audio-Engine-Error] StorageManager matchesExact failed:', err);
    return url === pattern;
  }
}

function matchesDomain(url: string, pattern: string): boolean {
  try {
    const { hostname } = new URL(url);
    const normalised = pattern.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    return hostname === normalised || hostname.endsWith(`.${normalised}`);
  } catch (err) {
    console.error('[Audio-Engine-Error] StorageManager matchesDomain failed:', err);
    return false;
  }
}

function ruleMatchesUrl(rule: UrlRule, url: string): boolean {
  try {
    if (matchesExact(url, rule.pattern)) return true;
    if (matchesDomain(url, rule.pattern)) return true;
  } catch (err) {
    console.error('[Audio-Engine-Error] StorageManager ruleMatchesUrl failed:', err);
  }
  return false;
}

// ---------------------------------------------------------------------------
// IStorageManager – interface segregation (ISP)
// ---------------------------------------------------------------------------

export interface IStorageManager {
  loadState(): Promise<ExtensionState>;
  saveState(state: ExtensionState): Promise<void>;
  getRules(): Promise<readonly UrlRule[]>;
  saveRules(rules: readonly UrlRule[]): Promise<void>;
  addRule(rule: UrlRule): Promise<void>;
  updateRule(rule: UrlRule): Promise<void>;
  deleteRule(id: string): Promise<void>;
  resolveSettings(url: string): Promise<AudioSettings>;
  checkAndMigrate(): Promise<void>;
  clear(): Promise<void>;
}

// ---------------------------------------------------------------------------
// StorageManager – single responsibility: chrome.storage.local I/O + rule eval
// ---------------------------------------------------------------------------

export class StorageManager implements IStorageManager {
  private async readRaw(): Promise<Record<string, unknown>> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      return (result[STORAGE_KEY] as Record<string, unknown> | undefined) ?? {};
    } catch (err) {
      console.error('[Audio-Engine-Error] StorageManager readRaw failed:', err);
      return {};
    }
  }

  private async writeRaw(state: Record<string, unknown>): Promise<void> {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: state });
    } catch (err) {
      console.error('[Audio-Engine-Error] StorageManager writeRaw failed:', err);
    }
  }

  private deserialise(raw: Record<string, unknown>): ExtensionState {
    try {
      if (!raw || Object.keys(raw).length === 0) return { ...DEFAULT_EXTENSION_STATE };

      const rules = Array.isArray(raw['rules'])
        ? (raw['rules'] as UrlRule[])
        : [];

      return {
        version:
          typeof raw['version'] === 'number'
            ? raw['version']
            : CURRENT_STATE_VERSION,
        isEnabled:
          typeof raw['isEnabled'] === 'boolean' ? raw['isEnabled'] : true,
        defaultSettings:
          (raw['defaultSettings'] as AudioSettings | undefined) ??
          DEFAULT_EXTENSION_STATE.defaultSettings,
        rules,
      };
    } catch (err) {
      console.error('[Audio-Engine-Error] StorageManager deserialise failed:', err);
      return { ...DEFAULT_EXTENSION_STATE };
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async loadState(): Promise<ExtensionState> {
    try {
      const raw = await this.readRaw();
      return this.deserialise(raw);
    } catch (err) {
      console.error('[Audio-Engine-Error] StorageManager loadState failed:', err);
      return { ...DEFAULT_EXTENSION_STATE };
    }
  }

  async saveState(state: ExtensionState): Promise<void> {
    try {
      await this.writeRaw(state as unknown as Record<string, unknown>);
    } catch (err) {
      console.error('[Audio-Engine-Error] StorageManager saveState failed:', err);
    }
  }

  async getRules(): Promise<readonly UrlRule[]> {
    try {
      const state = await this.loadState();
      return [...state.rules].sort((a, b) => b.priority - a.priority);
    } catch (err) {
      console.error('[Audio-Engine-Error] StorageManager getRules failed:', err);
      return [];
    }
  }

  async saveRules(rules: readonly UrlRule[]): Promise<void> {
    try {
      const state = await this.loadState();
      const sorted = [...rules].sort((a, b) => b.priority - a.priority);
      await this.saveState({ ...state, rules: sorted });
    } catch (err) {
      console.error('[Audio-Engine-Error] StorageManager saveRules failed:', err);
    }
  }

  async addRule(rule: UrlRule): Promise<void> {
    try {
      const rules = await this.getRules();
      if (rules.some((r) => r.id === rule.id)) {
        throw new Error(`Rule with id "${rule.id}" already exists.`);
      }
      await this.saveRules([...rules, rule]);
    } catch (err) {
      console.error('[Audio-Engine-Error] StorageManager addRule failed:', err);
    }
  }

  async updateRule(updated: UrlRule): Promise<void> {
    try {
      const rules = await this.getRules();
      const idx = rules.findIndex((r) => r.id === updated.id);
      if (idx === -1) {
        throw new Error(`Rule with id "${updated.id}" not found.`);
      }
      const next = [...rules];
      next[idx] = updated;
      await this.saveRules(next);
    } catch (err) {
      console.error('[Audio-Engine-Error] StorageManager updateRule failed:', err);
    }
  }

  async deleteRule(id: string): Promise<void> {
    try {
      const rules = await this.getRules();
      await this.saveRules(rules.filter((r) => r.id !== id));
    } catch (err) {
      console.error('[Audio-Engine-Error] StorageManager deleteRule failed:', err);
    }
  }

  async resolveSettings(url: string): Promise<AudioSettings> {
    try {
      const [rules, state] = await Promise.all([
        this.getRules(),
        this.loadState(),
      ]);

      for (const rule of rules) {
        try {
          if (ruleMatchesUrl(rule, url)) {
            return rule.settings;
          }
        } catch (matchErr) {
          console.error('[Audio-Engine-Error] StorageManager rule matches url check failed:', matchErr);
        }
      }

      return state.defaultSettings;
    } catch (err) {
      console.error('[Audio-Engine-Error] StorageManager resolveSettings failed, falling back to default:', err);
      return DEFAULT_EXTENSION_STATE.defaultSettings;
    }
  }

  async checkAndMigrate(): Promise<void> {
    try {
      let raw = await this.readRaw();
      const storedVersion =
        typeof raw['version'] === 'number' ? raw['version'] : 0;

      if (storedVersion >= CURRENT_STATE_VERSION) return;

      console.info(
        `[StorageManager] Migrating state from v${storedVersion} → v${CURRENT_STATE_VERSION}`,
      );

      let working = { ...raw };
      for (const step of MIGRATIONS) {
        try {
          if (step.fromVersion >= storedVersion && step.fromVersion < CURRENT_STATE_VERSION) {
            working = step.migrate(working);
          }
        } catch (stepErr) {
          console.error('[Audio-Engine-Error] StorageManager migration step failed:', stepErr);
          throw stepErr;
        }
      }

      working['version'] = CURRENT_STATE_VERSION;
      await this.writeRaw(working);

      console.info('[StorageManager] Migration complete.');
    } catch (err) {
      console.error('[Audio-Engine-Error] StorageManager checkAndMigrate failed:', err);
    }
  }

  async clear(): Promise<void> {
    try {
      await chrome.storage.local.clear();
    } catch (err) {
      console.error('[Audio-Engine-Error] StorageManager clear failed:', err);
    }
  }
}

export const storageManager = new StorageManager();
