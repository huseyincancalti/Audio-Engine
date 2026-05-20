// src/types/index.ts

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

/** Represents a single EQ band's gain value in decibels (-12 to +12 dB). */
export type EqBandGain = number;

/**
 * Full audio processing configuration applied to a tab or as a default rule.
 * All fields are required – no partial state leaks into the audio pipeline.
 */
export interface AudioSettings {
  /** Volume multiplier. 1.0 = 100%, 10.0 = 1000%. Range: [0, 10]. */
  readonly volume: number;
  /** Gain values (dB) for each of the 10 EQ bands.
   *  Bands (Hz): 32, 64, 125, 250, 500, 1k, 2k, 4k, 8k, 16k. */
  readonly eqBands: readonly EqBandGain[];
  /** When true the stereo signal is summed to mono. */
  readonly isMono: boolean;
  /** Whether the EQ stage is active; if false, EQ nodes are bypassed. */
  readonly isEqEnabled: boolean;
}

export const DEFAULT_AUDIO_SETTINGS: Readonly<AudioSettings> = Object.freeze({
  volume: 1.0,
  eqBands: Object.freeze([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  isMono: false,
  isEqEnabled: false,
});

// ---------------------------------------------------------------------------
// URL Rule
// ---------------------------------------------------------------------------

/** Priority tiers – lower numeric value wins (Exact > Domain > Global). */
export const enum RulePriority {
  GLOBAL = 0,
  DOMAIN = 10,
  EXACT = 20,
}

/**
 * A mapping from a URL pattern to a specific AudioSettings configuration.
 * Pattern may be an exact URL string or a domain string (e.g. "youtube.com").
 */
export interface UrlRule {
  readonly id: string;
  /** Exact URL or domain string used for matching. Supports regex. */
  readonly pattern: string;
  readonly settings: AudioSettings;
  /** Higher value wins when multiple rules match. */
  readonly priority: RulePriority | number;
  readonly createdAt: number;
}

// ---------------------------------------------------------------------------
// Extension State
// ---------------------------------------------------------------------------

/** Snapshot of the entire extension state persisted to chrome.storage. */
export interface ExtensionState {
  readonly version: number;
  readonly defaultSettings: AudioSettings;
  readonly rules: readonly UrlRule[];
  /** Global on/off kill-switch. */
  readonly isEnabled: boolean;
}

export const CURRENT_STATE_VERSION = 1;

export const DEFAULT_EXTENSION_STATE: Readonly<ExtensionState> = Object.freeze({
  version: CURRENT_STATE_VERSION,
  defaultSettings: DEFAULT_AUDIO_SETTINGS,
  rules: Object.freeze([]),
  isEnabled: true,
});

// ---------------------------------------------------------------------------
// Message Bus Payload Types
// ---------------------------------------------------------------------------

/** All message types exchanged between popup, background, and content script. */
export const enum MessageType {
  // Background → Content
  APPLY_SETTINGS = 'APPLY_SETTINGS',

  // Popup → Background
  GET_STATE = 'GET_STATE',
  SET_DEFAULT_SETTINGS = 'SET_DEFAULT_SETTINGS',
  ADD_RULE = 'ADD_RULE',
  UPDATE_RULE = 'UPDATE_RULE',
  DELETE_RULE = 'DELETE_RULE',
  TOGGLE_ENABLED = 'TOGGLE_ENABLED',

  // Content → Background
  CONTENT_READY = 'CONTENT_READY',
  REQUEST_SETTINGS = 'REQUEST_SETTINGS',

  // Background → Popup (state push)
  STATE_CHANGED = 'STATE_CHANGED',
}

// ---------------------------------------------------------------------------
// Discriminated union of all message shapes – no `any` allowed.
// ---------------------------------------------------------------------------

export interface MsgApplySettings {
  readonly type: MessageType.APPLY_SETTINGS;
  readonly payload: { readonly settings: AudioSettings };
}

export interface MsgGetState {
  readonly type: MessageType.GET_STATE;
}

export interface MsgSetDefaultSettings {
  readonly type: MessageType.SET_DEFAULT_SETTINGS;
  readonly payload: { readonly settings: AudioSettings };
}

export interface MsgAddRule {
  readonly type: MessageType.ADD_RULE;
  readonly payload: { readonly rule: Omit<UrlRule, 'id' | 'createdAt'> };
}

export interface MsgUpdateRule {
  readonly type: MessageType.UPDATE_RULE;
  readonly payload: { readonly rule: UrlRule };
}

export interface MsgDeleteRule {
  readonly type: MessageType.DELETE_RULE;
  readonly payload: { readonly id: string };
}

export interface MsgToggleEnabled {
  readonly type: MessageType.TOGGLE_ENABLED;
  readonly payload: { readonly isEnabled: boolean };
}

export interface MsgContentReady {
  readonly type: MessageType.CONTENT_READY;
}

export interface MsgRequestSettings {
  readonly type: MessageType.REQUEST_SETTINGS;
}

export interface MsgStateChanged {
  readonly type: MessageType.STATE_CHANGED;
  readonly payload: { readonly state: ExtensionState };
}

/**
 * The discriminated union of every valid message that can be sent over the
 * extension's message bus. Adding a new message type requires extending this
 * union – the TypeScript compiler will enforce exhaustive handling.
 */
export type MessagePayload =
  | MsgApplySettings
  | MsgGetState
  | MsgSetDefaultSettings
  | MsgAddRule
  | MsgUpdateRule
  | MsgDeleteRule
  | MsgToggleEnabled
  | MsgContentReady
  | MsgRequestSettings
  | MsgStateChanged;

/** Map each MessageType to its concrete message shape for lookup. */
export type MessageOfType<T extends MessageType> = Extract<
  MessagePayload,
  { type: T }
>;
