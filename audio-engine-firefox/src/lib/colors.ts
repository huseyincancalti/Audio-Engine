// src/lib/colors.ts
// Grup rengi preset'leri — ARCHITECTURE bölüm 6.1 (8-10 preset + özel hex).

export const GROUP_COLOR_PRESETS = [
  '#E8729A', // rose
  '#A82858', // deep rose
  '#F4A261', // amber
  '#E76F51', // coral
  '#2A9D8F', // teal
  '#4895EF', // blue
  '#7209B7', // violet
  '#43AA8B', // green
  '#F9C74F', // yellow
  '#577590', // slate
] as const;

export const DEFAULT_GROUP_COLOR = GROUP_COLOR_PRESETS[0];

/** Basit hex doğrulama (#RGB veya #RRGGBB). */
export function isValidHex(value: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim());
}
