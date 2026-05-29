// src/core/rules/PatternMatcher.ts
// Pattern eşleştirme + spesifiklik skoru. Saf fonksiyonlar (chrome bağımlılığı yok).
// ARCHITECTURE.md bölüm 3.2, 6.2.

/**
 * Kullanıcının girdiği bir adresi pattern'e çevirir.
 *   youtube.com          → *.youtube.com
 *   https://youtube.com/ → *.youtube.com
 *   www.youtube.com      → *.youtube.com
 *   *.youtube.com        → *.youtube.com   (zaten pattern)
 *   music.youtube.com    → *.music.youtube.com
 * Manuel pattern (içinde * olan) olduğu gibi korunur.
 */
export function urlToPattern(input: string): string {
  let host = input.trim().toLowerCase();
  if (!host) return '';
  // Şema ve yol kısmını at.
  host = host.replace(/^[a-z]+:\/\//, '');
  host = host.split('/')[0] ?? host;
  host = host.split('?')[0] ?? host;
  // Port varsa at.
  host = host.split(':')[0] ?? host;
  if (!host) return '';
  // Zaten wildcard içeriyorsa dokunma.
  if (host.includes('*')) return host;
  // www. ön ekini at.
  host = host.replace(/^www\./, '');
  return `*.${host}`;
}

/** Pattern'in insan-okur açıklaması (preview). */
export function patternFromUrl(input: string): { pattern: string; valid: boolean } {
  const pattern = urlToPattern(input);
  const valid = pattern.length > 2 && /\.[a-z]{2,}$/.test(pattern.replace(/^\*\./, ''));
  return { pattern, valid };
}

/** host, pattern ile eşleşiyor mu? */
export function matches(pattern: string, host: string): boolean {
  const p = pattern.trim().toLowerCase();
  const h = host.trim().toLowerCase();
  if (!p || !h) return false;

  if (!p.includes('*')) {
    return h === p;
  }

  // "*.example.com" → apex + tüm alt alanlar.
  if (p.startsWith('*.')) {
    const base = p.slice(2);
    return h === base || h.endsWith('.' + base);
  }

  // Genel glob (nadir): * → .*
  const escaped = p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  try {
    return new RegExp(`^${escaped}$`).test(h);
  } catch {
    return false;
  }
}

/**
 * Spesifiklik skoru: literal karakter sayısı − (wildcard sayısı × 10).
 * Yüksek skor daha spesifik. ARCHITECTURE bölüm 3.2.
 */
export function specificityScore(pattern: string): number {
  const wildcards = (pattern.match(/\*/g) || []).length;
  const literal = pattern.replace(/\*/g, '').length;
  return literal - wildcards * 10;
}

/** Pattern wildcard içermiyor mu (exact match mi)? */
export function isExact(pattern: string): boolean {
  return !pattern.includes('*');
}
