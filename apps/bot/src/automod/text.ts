/**
 * Normalização usada pelo filtro de palavras e pelo anti-spam. Sem isto,
 * `PALAVRÃO`, `palavrao` e `palavrão` seriam três coisas diferentes.
 */
export interface NormalizeOptions {
  caseSensitive?: boolean;
  normalizeDiacritics?: boolean;
}

export function normalizeText(value: string, options: NormalizeOptions = {}): string {
  let result = value;
  if (options.normalizeDiacritics !== false) {
    result = result.normalize('NFD').replace(/\p{M}/gu, '');
  }
  if (!options.caseSensitive) result = result.toLowerCase();
  return result;
}

/** Fronteira de palavra que entende acentos (o `\b` do JS só conhece ASCII). */
export const WORD_START = '(?<![\\p{L}\\p{N}_])';
export const WORD_END = '(?![\\p{L}\\p{N}_])';

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Divide em tokens de letras/números — base do modo `exact`. */
export function tokenize(value: string): string[] {
  return value.split(/[^\p{L}\p{N}_]+/u).filter((token) => token.length > 0);
}
