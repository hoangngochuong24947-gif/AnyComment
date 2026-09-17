import * as crypto from 'crypto';

/**
 * Normalizes input text by:
 * - Trimming leading and trailing whitespace
 * - Converting all CRLF to LF
 * - Collapsing multiple consecutive empty lines to a single empty line
 */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

/**
 * Generates a consistent SHA-256 hash key for caching.
 * @param text The normalized source text
 * @param targetLang Target language (e.g. 'zh-CN')
 * @param styleId Optional style ID (for custom style store)
 */
export function computeCacheKey(text: string, targetLang: string, styleId?: string): string {
  const normalized = normalizeText(text);
  const payload = styleId ? `${normalized}::${targetLang}::${styleId}` : `${normalized}::${targetLang}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}
