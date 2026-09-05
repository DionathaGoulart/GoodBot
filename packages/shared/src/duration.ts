import { DAY_MS, HOUR_MS, MINUTE_MS, SECOND_MS, WEEK_MS } from './constants';

const UNIT_MS: Record<string, number> = {
  s: SECOND_MS,
  m: MINUTE_MS,
  h: HOUR_MS,
  d: DAY_MS,
  w: WEEK_MS,
};

const TOKEN_RE = /(\d+(?:\.\d+)?)\s*([smhdw])/gi;
const VALID_RE = /^(?:\s*\d+(?:\.\d+)?\s*[smhdw]\s*)+$/i;

/**
 * Converte uma duração humana (`'1h30m'`, `'2d'`, `'45 s'`, `'1.5h'`) em
 * milissegundos. Retorna `null` para entradas inválidas ou zero. Unidades:
 * `s`, `m`, `h`, `d`, `w`; pode misturar e repetir.
 */
export function parseDuration(input: string): number | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed || !VALID_RE.test(trimmed)) return null;

  let total = 0;
  for (const match of trimmed.matchAll(TOKEN_RE)) {
    const value = Number(match[1]);
    const unit = UNIT_MS[match[2]!.toLowerCase()];
    if (!Number.isFinite(value) || unit === undefined) return null;
    total += value * unit;
  }
  if (total <= 0 || !Number.isFinite(total)) return null;
  return Math.round(total);
}

interface FormatDurationOptions {
  /** Quantas unidades exibir no máximo (padrão: 2 → `'1d 2h'`). */
  maxUnits?: number;
  /** `'short'` → `'1h 30m'`; `'long'` → `'1 hora e 30 minutos'`. */
  style?: 'short' | 'long';
}

const LONG_LABELS: Record<string, [string, string]> = {
  d: ['dia', 'dias'],
  h: ['hora', 'horas'],
  m: ['minuto', 'minutos'],
  s: ['segundo', 'segundos'],
};

/**
 * Formata milissegundos como duração legível em pt-BR. Semanas são exibidas
 * como dias (`'14d'`) para manter o formato previsível.
 */
export function formatDuration(ms: number, options: FormatDurationOptions = {}): string {
  const { maxUnits = 2, style = 'short' } = options;
  if (!Number.isFinite(ms) || ms < SECOND_MS) {
    return style === 'long' ? '0 segundos' : '0s';
  }

  let remaining = Math.floor(ms / SECOND_MS);
  const parts: Array<[string, number]> = [];
  for (const [unit, size] of [
    ['d', DAY_MS / SECOND_MS],
    ['h', HOUR_MS / SECOND_MS],
    ['m', MINUTE_MS / SECOND_MS],
    ['s', 1],
  ] as Array<[string, number]>) {
    const qty = Math.floor(remaining / size);
    if (qty > 0) {
      parts.push([unit, qty]);
      remaining -= qty * size;
    }
    if (parts.length >= maxUnits) break;
  }

  if (style === 'short') return parts.map(([u, q]) => `${q}${u}`).join(' ');

  const labelled = parts.map(([u, q]) => `${q} ${LONG_LABELS[u]![q === 1 ? 0 : 1]}`);
  if (labelled.length === 1) return labelled[0]!;
  return `${labelled.slice(0, -1).join(', ')} e ${labelled[labelled.length - 1]}`;
}
