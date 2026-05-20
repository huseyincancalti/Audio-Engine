// src/core/storage/StorageManager.ts

import {
  type AudioSettings,
  type ExtensionState,
  type UrlRule,
  CURRENT_STATE_VERSION,
  DEFAULT_EXTENSION_STATE,
  DEFAULT_AUDIO_SETTINGS,
  RulePriority,
} from '@/types/index';

// ---------------------------------------------------------------------------
// Storage key constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'audioEngineState' as const;

const MIGRATIONS: readonly {
  readonly fromVersion: number;
  migrate(state: Record<string, unknown>): Record<string, unknown>;
}[] = [];

// ---------------------------------------------------------------------------
// Match helpers
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

// ---------------------------------------------------------------------------
// StorageManager class
// ---------------------------------------------------------------------------

export class StorageManager {
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

  // 4. "Save Rule" Explicit Persistence Helper
  async saveSiteRule(pattern: string, settings: AudioSettings): Promise<void> {
    try {
      const rules = await this.getRules();
      const existingIdx = rules.findIndex((r) => r.pattern === pattern);
      if (existingIdx !== -1) {
        const updatedRule: UrlRule = {
          ...rules[existingIdx]!,
          settings,
        };
        await this.updateRule(updatedRule);
      } else {
        const newRule: UrlRule = {
          id: crypto.randomUUID(),
          pattern,
          settings,
          priority: RulePriority.DOMAIN,
          createdAt: Date.now(),
        };
        await this.addRule(newRule);
      }
    } catch (err) {
      console.error('[Audio-Engine-Error] StorageManager saveSiteRule failed:', err);
    }
  }

  // 3. Fallback Hierarchy Resolution Order:
  // Check exact URL -> Check Domain -> Fallback to Default Global Config
  async resolveSettings(url: string): Promise<AudioSettings> {
    try {
      const rules = await this.getRules();

      // Phase 1: Exact URL rule check
      for (const rule of rules) {
        try {
          if (matchesExact(url, rule.pattern)) {
            return rule.settings;
          }
        } catch {}
      }

      // Phase 2: Domain rule check
      for (const rule of rules) {
        try {
          if (matchesDomain(url, rule.pattern)) {
            return rule.settings;
          }
        } catch {}
      }

      // Phase 3: Fallback to global config (100% volume, flat EQ)
      return DEFAULT_AUDIO_SETTINGS;
    } catch (err) {
      console.error('[Audio-Engine-Error] StorageManager resolveSettings failed, falling back to default:', err);
      return DEFAULT_AUDIO_SETTINGS;
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
