// src/types/index.ts
// Tek tip kaynağı — tüm bağlamlar (content / background / popup / options) buradan import eder.
// ARCHITECTURE.md bölüm 3, 11, 13.

// ---------------------------------------------------------------------------
// Ses
// ---------------------------------------------------------------------------

/** Maksimum gain çarpanı. 10 = %1000 (ARCHITECTURE bölüm 8.2 / 14). */
export const MAX_GAIN = 10;

/** Gain rampası zaman sabiti (anti-crackle), saniye. */
export const GAIN_TIME_CONSTANT = 0.018;

/**
 * EQ band merkez frekansları (Hz). Popup'taki 5 dikey slider ile birebir hizalı.
 * eq dizisindeki index'ler bu frekanslara karşılık gelir.
 */
export const EQ_FREQUENCIES = [60, 250, 1000, 4000, 12000] as const;

/** EQ band sayısı. */
export const EQ_BAND_COUNT = EQ_FREQUENCIES.length;

/** Bir EQ band'ının dB cinsinden kazancı (-12 .. +12). */
export type EQBand = number;

/** DRC (DynamicsCompressor) sabit parametreleri — ARCHITECTURE bölüm 8.2. */
export const DRC_PARAMS = {
  threshold: -24,
  knee: 30,
  ratio: 12,
  attack: 0.003,
  release: 0.25,
} as const;

/**
 * Bir sekmeye / kurala uygulanan ses yapılandırması.
 * NOT: DRC global bir anahtardır (StorageSchema.drcEnabled) — kural başına değil.
 */
export interface AudioSettings {
  /** Ses çarpanı. 1.0 = %100, 10.0 = %1000. Aralık: [0, MAX_GAIN]. */
  volume: number;
  /** EQ_FREQUENCIES ile hizalı, dB cinsinden band kazançları (uzunluk = EQ_BAND_COUNT). */
  eq: EQBand[];
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  volume: 1.0,
  eq: [0, 0, 0, 0, 0],
};

/** Verilen ayarın derin kopyasını üretir (paylaşılan referans sızıntısını önler). */
export function cloneSettings(s: AudioSettings): AudioSettings {
  return { volume: s.volume, eq: [...s.eq] };
}

// ---------------------------------------------------------------------------
// Kurallar — Grup & Site
// ---------------------------------------------------------------------------

export interface Group {
  id: string;
  name: string;
  /** Hex renk, ör. "#E8729A". */
  color: string;
  /** Pattern listesi, ör. ["*.youtube.com", "music.youtube.com"]. */
  patterns: string[];
  settings: AudioSettings;
}

export interface SiteRule {
  id: string;
  /** Pattern, ör. "*.netflix.com" veya "music.youtube.com". */
  pattern: string;
  settings: AudioSettings;
}

// ---------------------------------------------------------------------------
// Auth (kanca) — ARCHITECTURE bölüm 7
// ---------------------------------------------------------------------------

export type Tier = 'free' | 'premium';

export interface UserProfile {
  userId: string | null;
  tier: Tier;
  email: string | null;
}

export const DEFAULT_USER_PROFILE: UserProfile = {
  userId: null,
  tier: 'free',
  email: null,
};

// ---------------------------------------------------------------------------
// Storage şeması — ARCHITECTURE bölüm 13
// Tek seferlik ayar burada YOK; sadece content script RAM'inde tutulur.
// ---------------------------------------------------------------------------

export type ThemeName = 'dark' | 'light';
export type Language = 'tr' | 'en';

export interface StorageSchema {
  // Auth (kanca)
  userId: string | null;
  tier: Tier;
  email: string | null;

  // Ayarlar
  theme: ThemeName;
  language: Language;
  drcEnabled: boolean;
  onboardingCompleted: boolean;
  /** Global açma/kapama (power). Kapalıyken motor pass-through. */
  isEnabled: boolean;

  // Kurallar
  groups: Group[];
  siteRules: SiteRule[];
  globalDefault: AudioSettings;
}

export const DEFAULT_STORAGE: StorageSchema = {
  userId: null,
  tier: 'free',
  email: null,
  theme: 'dark',
  language: 'tr',
  drcEnabled: true,
  onboardingCompleted: false,
  isEnabled: true,
  groups: [],
  siteRules: [],
  globalDefault: { ...DEFAULT_AUDIO_SETTINGS, eq: [...DEFAULT_AUDIO_SETTINGS.eq] },
};

// ---------------------------------------------------------------------------
// Çözülmüş durum — content script üretir, popup okur (ARCHITECTURE bölüm 3.3)
// ---------------------------------------------------------------------------

/** Çözülen ayarın hangi katmandan geldiği. */
export type RuleSource = 'one-off' | 'site' | 'group' | 'default';

/** Popup rozeti. */
export type Badge = 'active' | 'sleeping' | 'bypassed' | 'webrtc';

/** Ses yakalamanın hangi katmanla yapıldığı — ARCHITECTURE bölüm 5. */
export type CaptureLayer =
  | 'media_element' // Katman 1
  | 'media_stream' // Katman 2
  | 'rtc' // Katman 3 (WebRTC injection)
  | 'bypass' // hiçbiri çalışmadı
  | 'none'; // henüz hiçbir kaynağa bağlanmadı (idle)

/**
 * Content script'in popup'a döndürdüğü tek doğru durum.
 * Popup bu değeri sadece gösterir, kendi state'inde TUTMAZ.
 */
export interface ResolvedState {
  /** Motor uyandı mı (idle değil mi)? */
  awake: boolean;
  /** Global power açık mı? */
  power: boolean;
  volume: number;
  eq: EQBand[];
  drcEnabled: boolean;
  source: RuleSource;
  /** Kullanıcıya gösterilecek kural etiketi, ör. "*.youtube.com" veya grup adı. */
  sourceLabel: string;
  badge: Badge;
  captureLayer: CaptureLayer;
  /** Aynı URL'e birden fazla kural eşleşiyor mu? */
  hasConflict: boolean;
  /** Mevcut sekmenin host'u (popup "Site Kaydet" için kullanır). */
  host: string;
}

// ---------------------------------------------------------------------------
// Mesaj protokolü (EventBus) — ARCHITECTURE bölüm 11
// ---------------------------------------------------------------------------

export enum MessageType {
  // Popup → Content
  WAKE_UP_ENGINE = 'WAKE_UP_ENGINE',
  GET_CURRENT_STATE = 'GET_CURRENT_STATE',
  SET_LIVE_VOLUME = 'SET_LIVE_VOLUME',
  SET_LIVE_EQ = 'SET_LIVE_EQ',
  SET_ONE_OFF = 'SET_ONE_OFF',
  SET_POWER_STATE = 'SET_POWER_STATE',
  SET_DRC = 'SET_DRC',

  // Content → Background
  CHECK_URL_RULES = 'CHECK_URL_RULES',

  // Background → Content
  URL_CHANGED = 'URL_CHANGED',
  RULES_UPDATED = 'RULES_UPDATED',

  // Popup/Options → Background
  SAVE_RULE = 'SAVE_RULE',
}

// --- Mesaj gövdeleri (discriminated union) ---

export interface MsgWakeUpEngine {
  type: MessageType.WAKE_UP_ENGINE;
}

export interface MsgGetCurrentState {
  type: MessageType.GET_CURRENT_STATE;
}

export interface MsgSetLiveVolume {
  type: MessageType.SET_LIVE_VOLUME;
  payload: { volume: number };
}

export interface MsgSetLiveEq {
  type: MessageType.SET_LIVE_EQ;
  payload: { eq: EQBand[] };
}

export interface MsgSetOneOff {
  type: MessageType.SET_ONE_OFF;
  payload: { settings: AudioSettings };
}

export interface MsgSetPowerState {
  type: MessageType.SET_POWER_STATE;
  payload: { power: boolean };
}

export interface MsgSetDrc {
  type: MessageType.SET_DRC;
  payload: { drcEnabled: boolean };
}

export interface MsgCheckUrlRules {
  type: MessageType.CHECK_URL_RULES;
  payload: { url: string };
}

/** CHECK_URL_RULES cevabı (background → content). */
export interface CheckUrlRulesResponse {
  hasRule: boolean;
  /** Çözülmüş ayar (kural varsa) — content bunu direkt uygular. */
  settings: AudioSettings | null;
  source: RuleSource;
  sourceLabel: string;
  hasConflict: boolean;
  /** Global ayarlar — auto-wake anında content'in ihtiyacı olanlar. */
  power: boolean;
  drcEnabled: boolean;
}

export interface MsgUrlChanged {
  type: MessageType.URL_CHANGED;
  payload: { url: string };
}

export interface MsgRulesUpdated {
  type: MessageType.RULES_UPDATED;
}

/** Popup → Background: kalıcı kural kaydet. */
export interface MsgSaveRule {
  type: MessageType.SAVE_RULE;
  payload: SaveRulePayload;
}

export type SaveRulePayload =
  | { kind: 'site'; pattern: string; settings: AudioSettings }
  | { kind: 'group'; groupId: string; pattern: string; settings: AudioSettings };

export type MessagePayload =
  | MsgWakeUpEngine
  | MsgGetCurrentState
  | MsgSetLiveVolume
  | MsgSetLiveEq
  | MsgSetOneOff
  | MsgSetPowerState
  | MsgSetDrc
  | MsgCheckUrlRules
  | MsgUrlChanged
  | MsgRulesUpdated
  | MsgSaveRule;

export type MessageOfType<T extends MessageType> = Extract<MessagePayload, { type: T }>;

// ---------------------------------------------------------------------------
// MAIN-world ↔ content köprüsü (window.postMessage) — Katman 3 (WebRTC)
// ---------------------------------------------------------------------------

/** Injected (MAIN) → Content: WebRTC ses track'i yakalandı. */
export const RTC_TRACK_EVENT = 'AUDIO_ENGINE_RTC_TRACK';
/** Content → Injected (MAIN): canlı ayar gönder (volume/eq/drc/power). */
export const RTC_CONTROL_EVENT = 'AUDIO_ENGINE_RTC_CONTROL';

export interface RtcTrackMessage {
  source: typeof RTC_TRACK_EVENT;
  /** Yakalanan aktif ses stream sayısı. */
  streamCount: number;
}

export interface RtcControlMessage {
  source: typeof RTC_CONTROL_EVENT;
  volume: number;
  eq: EQBand[];
  drcEnabled: boolean;
  power: boolean;
}
