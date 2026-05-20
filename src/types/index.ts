// src/types/index.ts

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

export type EqBandGain = number;

export type EngineStatus = 'active' | 'sleeping' | 'bypassed';

export interface AudioSettings {
  readonly volume: number;
  readonly eqBands: readonly EqBandGain[];
  readonly isMono: boolean;
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

export const enum RulePriority {
  GLOBAL = 0,
  DOMAIN = 10,
  EXACT = 20,
}

export interface UrlRule {
  readonly id: string;
  readonly pattern: string;
  readonly settings: AudioSettings;
  readonly priority: RulePriority | number;
  readonly createdAt: number;
}

// ---------------------------------------------------------------------------
// Extension State
// ---------------------------------------------------------------------------

export interface ExtensionState {
  readonly version: number;
  readonly defaultSettings: AudioSettings;
  readonly rules: readonly UrlRule[];
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
  SAVE_RULE = 'SAVE_RULE',

  // Content → Background
  CONTENT_READY = 'CONTENT_READY',
  REQUEST_SETTINGS = 'REQUEST_SETTINGS',

  // Background → Popup (state push)
  STATE_CHANGED = 'STATE_CHANGED',

  // Popup → Content (isolated routing)
  WAKE_UP_ENGINE = 'WAKE_UP_ENGINE',
  LIVE_UPDATE = 'LIVE_UPDATE',
  GET_TAB_SETTINGS = 'GET_TAB_SETTINGS',

  // Request-Response and Live updates
  GET_CURRENT_STATE = 'GET_CURRENT_STATE',
  STATE_RESPONSE = 'STATE_RESPONSE',
  SET_LIVE_VOLUME = 'SET_LIVE_VOLUME',
  SET_LIVE_EQ = 'SET_LIVE_EQ',

  // Power Toggle
  SET_POWER_STATE = 'SET_POWER_STATE',
}

// ---------------------------------------------------------------------------
// Discriminated union of all message shapes
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

export interface MsgSaveRule {
  readonly type: MessageType.SAVE_RULE;
  readonly payload: { readonly pattern: string; readonly settings: AudioSettings };
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

export interface MsgWakeUpEngine {
  readonly type: MessageType.WAKE_UP_ENGINE;
}

export interface MsgLiveUpdate {
  readonly type: MessageType.LIVE_UPDATE;
  readonly payload: { readonly settings: AudioSettings };
}

export interface MsgGetTabSettings {
  readonly type: MessageType.GET_TAB_SETTINGS;
}

export interface MsgGetCurrentState {
  readonly type: MessageType.GET_CURRENT_STATE;
}

export interface MsgStateResponse {
  readonly type: MessageType.STATE_RESPONSE;
  readonly payload: { readonly settings: AudioSettings; readonly isPowerEnabled: boolean; readonly engineStatus: EngineStatus };
}

export interface MsgSetLiveVolume {
  readonly type: MessageType.SET_LIVE_VOLUME;
  readonly payload: { readonly volume: number };
}

export interface MsgSetLiveEq {
  readonly type: MessageType.SET_LIVE_EQ;
  readonly payload: {
    readonly eqBands: readonly number[];
    readonly isEqEnabled: boolean;
    readonly isMono: boolean;
  };
}

export interface MsgSetPowerState {
  readonly type: MessageType.SET_POWER_STATE;
  readonly payload: { readonly enabled: boolean };
}

export type MessagePayload =
  | MsgApplySettings
  | MsgGetState
  | MsgSetDefaultSettings
  | MsgAddRule
  | MsgUpdateRule
  | MsgDeleteRule
  | MsgToggleEnabled
  | MsgSaveRule
  | MsgContentReady
  | MsgRequestSettings
  | MsgStateChanged
  | MsgWakeUpEngine
  | MsgLiveUpdate
  | MsgGetTabSettings
  | MsgGetCurrentState
  | MsgStateResponse
  | MsgSetLiveVolume
  | MsgSetLiveEq
  | MsgSetPowerState;

export type MessageOfType<T extends MessageType> = Extract<
  MessagePayload,
  { type: T }
>;
