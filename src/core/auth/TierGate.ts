// src/core/auth/TierGate.ts
// Premium özellik kapısı (kanca) — ARCHITECTURE.md bölüm 7.
// Şu an entegrasyon yok; tüm kullanıcılar 'free'. Premium özellikler UI'da
// data-premium="true" ile işaretli ama henüz erişime açık.

import type { Tier } from '../../types/index';

export type PremiumFeature = 'ai' | 'cloud_sync';

const PREMIUM_FEATURES: PremiumFeature[] = ['ai', 'cloud_sync'];

/**
 * Bir özelliğin mevcut tier ile kullanılabilir olup olmadığını döner.
 * Premium olmayan her özellik herkese açıktır.
 */
export function canUseFeature(feature: PremiumFeature, tier: Tier): boolean {
  return tier === 'premium' || !PREMIUM_FEATURES.includes(feature);
}

/** Bir özelliğin premium olup olmadığı (UI rozetleri için). */
export function isPremiumFeature(feature: PremiumFeature): boolean {
  return PREMIUM_FEATURES.includes(feature);
}
