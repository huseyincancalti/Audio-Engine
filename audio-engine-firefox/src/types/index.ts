// src/types/index.ts — Firefox (MV2) portu
// Tek tip kaynağı — tüm bağlamlar (background / content / popup / options) buradan import eder.
// Firefox'ta chrome.tabCapture ve chrome.offscreen YOK; ses işleme content script'te
// (createMediaElementSource + srcObject fallback), background kalıcı orkestra şefi.

// ---------------------------------------------------------------------------
// Ses
// ---------------------------------------------------------------------------

/** Maksimum gain çarpanı. 10 = %1000. */
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

/** DRC (DynamicsCompressor) sabit parametreleri. */
export const DRC_PARAMS = {
  threshold: -24,
  knee: 30,
  ratio: 12,
  attack: 0.003,
  release: 0.25,
} as const;

/**
 * Bir sekmeye / kurala uygulanan ses yapılandırması (volume + EQ).
 * Mono/DRC global anahtarlardır; offscreen'e `CaptureSettings` içinde ulaşırlar.
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

/**
 * Offscreen'in bir TabEngine'i (yeniden) kurmak için ihtiyaç duyduğu her şey.
 * drc/mono global storage bayraklarıdır; sekme başına buraya katlanır ki offscreen
 * grafiği kendi kendine yeterli olsun.
 */
export interface CaptureSettings {
  volume: number;
  eq: EQBand[];
  drcEnabled: boolean;
  monoEnabled: boolean;
}

/** AudioSettings + global bayraklardan CaptureSettings üretir. */
export function toCaptureSettings(
  settings: AudioSettings,
  drcEnabled: boolean,
  monoEnabled: boolean,
): CaptureSettings {
  return { volume: settings.volume, eq: [...settings.eq], drcEnabled, monoEnabled };
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
// Auth (kanca)
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
// Storage şeması
// Tek seferlik / sekme bazlı ayar burada YOK; background RAM'inde Map<tabId> tutulur.
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
  /** DRC global anahtar. */
  drcEnabled: boolean;
  /** Mono indirgeme global anahtar. Açıkken L+R tek kanala düşer. */
  monoEnabled: boolean;
  onboardingCompleted: boolean;
  /** Silme onayı modal gösterilsin mi? Varsayılan: true. */
  confirmDelete: boolean;

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
  language: 'en',
  drcEnabled: true,
  monoEnabled: false,
  onboardingCompleted: false,
  confirmDelete: true,
  groups: [],
  siteRules: [],
  globalDefault: { ...DEFAULT_AUDIO_SETTINGS, eq: [...DEFAULT_AUDIO_SETTINGS.eq] },
};

// ---------------------------------------------------------------------------
// Popup durumu — background üretir, popup sadece gösterir.
// ---------------------------------------------------------------------------

/** Çözülen ayarın hangi katmandan geldiği. */
export type RuleSource = 'one-off' | 'site' | 'group' | 'default';

/** Popup rozeti. */
export type Badge = 'active' | 'permission' | 'ready';

/**
 * Background'ın popup'a döndürdüğü tek doğru durum.
 * Popup bu değeri sadece gösterir; kendi state'inde TUTMAZ.
 */
export interface TabStatus {
  /** Bu sekme şu an yakalanıyor mu? */
  active: boolean;
  volume: number;
  eq: EQBand[];
  drcEnabled: boolean;
  monoEnabled: boolean;
  source: RuleSource;
  /** Kullanıcıya gösterilecek kural etiketi, ör. "*.youtube.com" veya grup adı. */
  sourceLabel: string;
  /** Aynı URL'e birden fazla kural eşleşiyor mu? */
  hasConflict: boolean;
  /** Mevcut sekmenin host'u (popup "Site Kaydet" için kullanır). */
  host: string;
}

// ---------------------------------------------------------------------------
// Kontrol protokolü (Popup ↔ Background) — EventBus tabanlı
// ---------------------------------------------------------------------------

export enum MessageType {
  // Popup → Background
  ENABLE_AUDIO = 'ENABLE_AUDIO',
  DISABLE_AUDIO = 'DISABLE_AUDIO',
  UPDATE_SETTINGS = 'UPDATE_SETTINGS',
  GET_TAB_STATUS = 'GET_TAB_STATUS',

  // Popup/Options → Background
  SAVE_RULE = 'SAVE_RULE',

  // Content → Background
  /** Content script yüklendi — background kural varsa auto-wake başlatır. */
  CONTENT_READY = 'CONTENT_READY',
}

// --- Mesaj gövdeleri (discriminated union) ---

export interface MsgEnableAudio {
  type: MessageType.ENABLE_AUDIO;
  payload: { tabId: number; settings: CaptureSettings };
}

export interface MsgDisableAudio {
  type: MessageType.DISABLE_AUDIO;
  payload: { tabId: number };
}

export interface MsgUpdateSettings {
  type: MessageType.UPDATE_SETTINGS;
  payload: { tabId: number; settings: CaptureSettings };
}

export interface MsgGetTabStatus {
  type: MessageType.GET_TAB_STATUS;
  payload: { tabId: number };
}

export interface MsgSaveRule {
  type: MessageType.SAVE_RULE;
  payload: SaveRulePayload;
}

export interface MsgContentReady {
  type: MessageType.CONTENT_READY;
  payload: Record<string, never>;
}

export type SaveRulePayload =
  | { kind: 'site'; pattern: string; settings: AudioSettings }
  | { kind: 'group'; groupId: string; pattern: string; settings: AudioSettings };

/** ENABLE_AUDIO cevabı (background → popup). */
export interface EnableResponse {
  ok?: true;
}

export type MessagePayload =
  | MsgEnableAudio
  | MsgDisableAudio
  | MsgUpdateSettings
  | MsgGetTabStatus
  | MsgSaveRule
  | MsgContentReady;

export type MessageOfType<T extends MessageType> = Extract<MessagePayload, { type: T }>;

// ---------------------------------------------------------------------------
// Content protokolü (Background/Popup → Content, tabs.sendMessage ile)
// Content kendi raw chrome.runtime.onMessage dinleyicisini `target:'ae-content'`
// ile filtreler; bu yüzden MessagePayload union'ına dahil DEĞİL.
// ---------------------------------------------------------------------------

export const CONTENT_TARGET = 'ae-content' as const;

export type ContentMsg =
  | { target: typeof CONTENT_TARGET; type: 'START_CAPTURE'; settings: CaptureSettings }
  | { target: typeof CONTENT_TARGET; type: 'UPDATE_SETTINGS'; settings: CaptureSettings }
  | { target: typeof CONTENT_TARGET; type: 'STOP_CAPTURE' }
  | { target: typeof CONTENT_TARGET; type: 'GET_LEVEL' }
  | { target: typeof CONTENT_TARGET; type: 'PING' };

/** Ses kaynağının hangi yöntemle yakalandığı (Firefox katmanları). */
export type CaptureLayer = 'media_element' | 'media_stream' | 'none';

/** START_CAPTURE cevabı (content → background). */
export interface StartCaptureResponse {
  ok: boolean;
  layer: CaptureLayer;
}

/** GET_LEVEL cevabı (content → popup). */
export interface LevelResponse {
  level: number;
}

/** PING cevabı — content script enjekte mi kontrolü. */
export interface PingResponse {
  ok: true;
}
