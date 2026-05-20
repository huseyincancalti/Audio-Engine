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

/**
 * A migration step transforms state from `fromVersion` to `fromVersion + 1`.
 * Add a new entry here whenever the state schema changes between releases.
 */
interface MigrationStep {
  readonly fromVersion: number;
  migrate(state: Record<string, unknown>): Record<string, unknown>;
}

const MIGRATIONS: readonly MigrationStep[] = [
  // Example: v1 → v2 (stub – extend when schema changes are introduced)
  // {
  //   fromVersion: 1,
  //   migrate(state) {
  //     return { ...state, newField: 'defaultValue', version: 2 };
  //   },
  // },
];

// ---------------------------------------------------------------------------
// URL matcher helpers – each function has a single responsibility (SRP).
// ---------------------------------------------------------------------------

/** Tries to match a URL string against an exact URL pattern. */
function matchesExact(url: string, pattern: string): boolean {
  try {
    const regex = new RegExp(`^${pattern}$`);
    return regex.test(url);
  } catch {
    return url === pattern;
  }
}

/** Tries to match a URL string against a domain pattern (e.g. "youtube.com"). */
function matchesDomain(url: string, pattern: string): boolean {
  try {
    const { hostname } = new URL(url);
    const normalised = pattern.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    return hostname === normalised || hostname.endsWith(`.${normalised}`);
  } catch {
    return false;
  }
}

/**
 * Returns true if the rule pattern matches the given URL at any level.
 * Delegates to the appropriate specialist matcher.
 */
function ruleMatchesUrl(rule: UrlRule, url: string): boolean {
  // Exact match: pattern contains a path or query component.
  if (matchesExact(url, rule.pattern)) return true;
  // Domain-level fallback.
  if (matchesDomain(url, rule.pattern)) return true;
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
}

// ---------------------------------------------------------------------------
// StorageManager – single responsibility: chrome.storage.local I/O + rule eval
// ---------------------------------------------------------------------------

export class StorageManager implements IStorageManager {
  // ── Private helpers ────────────────────────────────────────────────────────

  /** Read the raw state object from chrome.storage.local. */
  private async readRaw(): Promise<Record<string, unknown>> {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return (result[STORAGE_KEY] as Record<string, unknown> | undefined) ?? {};
  }

  /** Write an arbitrary state object to chrome.storage.local. */
  private async writeRaw(state: Record<string, unknown>): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
  }

  /**
   * Deserialise the raw storage object into a validated `ExtensionState`.
   * Falls back to defaults for any missing or malformed fields.
   */
  private deserialise(raw: Record<string, unknown>): ExtensionState {
    if (Object.keys(raw).length === 0) return { ...DEFAULT_EXTENSION_STATE };

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
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Load and deserialise the full extension state. */
  async loadState(): Promise<ExtensionState> {
    const raw = await this.readRaw();
    return this.deserialise(raw);
  }

  /** Serialise and persist the full extension state. */
  async saveState(state: ExtensionState): Promise<void> {
    await this.writeRaw(state as unknown as Record<string, unknown>);
  }

  /** Retrieve the persisted URL rules array, sorted by priority descending. */
  async getRules(): Promise<readonly UrlRule[]> {
    const state = await this.loadState();
    return [...state.rules].sort((a, b) => b.priority - a.priority);
  }

  /**
   * Replace the entire rules array and persist.
   * Sorting is preserved on write so reads are always in priority order.
   */
  async saveRules(rules: readonly UrlRule[]): Promise<void> {
    const state = await this.loadState();
    const sorted = [...rules].sort((a, b) => b.priority - a.priority);
    await this.saveState({ ...state, rules: sorted });
  }

  /** Append a new rule. Duplicate IDs are rejected. */
  async addRule(rule: UrlRule): Promise<void> {
    const rules = await this.getRules();
    if (rules.some((r) => r.id === rule.id)) {
      throw new Error(`[StorageManager] Rule with id "${rule.id}" already exists.`);
    }
    await this.saveRules([...rules, rule]);
  }

  /** Replace an existing rule matched by id. Throws if not found. */
  async updateRule(updated: UrlRule): Promise<void> {
    const rules = await this.getRules();
    const idx = rules.findIndex((r) => r.id === updated.id);
    if (idx === -1) {
      throw new Error(`[StorageManager] Rule with id "${updated.id}" not found.`);
    }
    const next = [...rules];
    next[idx] = updated;
    await this.saveRules(next);
  }

  /** Remove a rule by id. No-op if the id doesn't exist. */
  async deleteRule(id: string): Promise<void> {
    const rules = await this.getRules();
    await this.saveRules(rules.filter((r) => r.id !== id));
  }

  // ── Rule resolution ────────────────────────────────────────────────────────

  /**
   * Evaluate all persisted rules against `url` and return the `AudioSettings`
   * of the highest-priority matching rule.
   *
   * Resolution order (highest wins):
   *   1. Exact URL match  (largest `priority` value among exact matches)
   *   2. Domain match     (largest `priority` value among domain matches)
   *   3. Global default   (ExtensionState.defaultSettings)
   */
  async resolveSettings(url: string): Promise<AudioSettings> {
    const [rules, state] = await Promise.all([
      this.getRules(), // already sorted descending by priority
      this.loadState(),
    ]);

    // Rules are sorted descending, so the first match is automatically the
    // highest-priority match – no secondary sort needed.
    for (const rule of rules) {
      if (ruleMatchesUrl(rule, url)) {
        return rule.settings;
      }
    }

    return state.defaultSettings;
  }

  // ── Migration ──────────────────────────────────────────────────────────────

  /**
   * Check the persisted state version and run any pending migration steps.
   *
   * Design:
   *   - Each `MigrationStep` is responsible for exactly one version increment.
   *   - Steps execute sequentially; if one throws, migration stops and the
   *     original data is left untouched (no partial writes).
   *   - Extend `MIGRATIONS` to handle future schema changes.
   */
  async checkAndMigrate(): Promise<void> {
    let raw = await this.readRaw();

    const storedVersion =
      typeof raw['version'] === 'number' ? raw['version'] : 0;

    if (storedVersion >= CURRENT_STATE_VERSION) return;

    console.info(
      `[StorageManager] Migrating state from v${storedVersion} → v${CURRENT_STATE_VERSION}`,
    );

    // Run each applicable migration step in order.
    let working = { ...raw };
    for (const step of MIGRATIONS) {
      if (step.fromVersion >= storedVersion && step.fromVersion < CURRENT_STATE_VERSION) {
        working = step.migrate(working);
      }
    }

    // Stamp the final version and persist atomically.
    working['version'] = CURRENT_STATE_VERSION;
    await this.writeRaw(working);

    console.info('[StorageManager] Migration complete.');
  }
}

// ---------------------------------------------------------------------------
// Singleton export – one instance shared across the extension context.
// ---------------------------------------------------------------------------

export const storageManager = new StorageManager();
