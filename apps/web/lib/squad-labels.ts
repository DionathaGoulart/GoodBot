import {
  SQUAD_DAYS,
  fromBits,
  type RunSquadMatchResult,
  type SquadBlockConfig,
  type SquadFieldMatch,
  type SquadFieldType,
  type SquadStatus,
} from '@goodbot/shared';

/**
 * Rótulos do módulo de squads no painel. Puro e sem `server-only`: a página é
 * server component, as abas são client components, e as duas leem daqui.
 *
 * Datas saem sempre no fuso da guild e montadas peça por peça. O servidor da
 * Vercel roda em UTC e o navegador no fuso de quem abre: um texto diferente
 * dos dois lados quebra a hidratação. E a janela de um squad é a hora da
 * guild, não a de quem lê.
 */

/** Dias da grade na ordem dos bits: 0 = domingo. */
export const SQUAD_DAY_SHORT = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'] as const;

export const SQUAD_FIELD_TYPE_LABEL: Record<SquadFieldType, string> = {
  select: 'UMA OPÇÃO',
  tags: 'VÁRIAS OPÇÕES',
  text: 'TEXTO LIVRE',
};

export const SQUAD_FIELD_MATCH_LABEL: Record<SquadFieldMatch, string> = {
  hard: 'PRECISA BATER',
  soft: 'PESA NO MATCH',
  none: 'NÃO ENTRA',
};

export const SQUAD_STATUS_LABEL: Record<SquadStatus, string> = {
  open: 'COM VAGA',
  full: 'CHEIO',
  archived: 'ARQUIVADO',
};

function dayShort(day: number): string {
  return SQUAD_DAY_SHORT[((day % SQUAD_DAYS) + SQUAD_DAYS) % SQUAD_DAYS] ?? '?';
}

/**
 * Janela semanal de um squad: "SÁB · NOITE 18H ÀS 24H". A madrugada é o
 * começo do próprio dia, então a de sábado é a noite de sexta para sábado, e
 * o rótulo diz isso, como o embed do bot.
 */
export function formatSquadWindow(
  day: number,
  block: number,
  blocks: readonly SquadBlockConfig[],
): string {
  const name = dayShort(day);
  const config = blocks[block];
  if (!config) return name;
  const label = `${name} · ${config.label.toUpperCase()} ${String(config.startHour)}H ÀS ${String(config.endHour)}H`;
  return config.key === 'night' ? `${label} (NOITE DE ${dayShort(day - 1)})` : label;
}

/**
 * A grade de um perfil numa célula de tabela: as primeiras faixas marcadas e
 * quantas sobram ("SEG NOITE · QUA NOITE · +2").
 */
export function summarizeAvailability(
  mask: number,
  blocks: readonly SquadBlockConfig[],
  shown = 2,
): string {
  const cells = fromBits(mask);
  if (cells.length === 0) return 'SEM HORÁRIO';
  const labels = cells
    .slice(0, shown)
    .map(({ day, block }) => `${dayShort(day)} ${(blocks[block]?.label ?? '?').toUpperCase()}`);
  const rest = cells.length - labels.length;
  return (rest > 0 ? [...labels, `+${String(rest)}`] : labels).join(' · ');
}

// ── Datas ───────────────────────────────────────────────────────────────────

type DateParts = Record<'day' | 'month' | 'year' | 'hour' | 'minute', string>;

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsIn(iso: string, timeZone: string): DateParts {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '00';
  return {
    day: get('day'),
    month: get('month'),
    year: get('year'),
    // Algumas ICUs escrevem a meia-noite como 24.
    hour: get('hour') === '24' ? '00' : get('hour'),
    minute: get('minute'),
  };
}

/** "14/09/2026", no fuso da guild. */
export function formatDate(iso: string, timeZone: string): string {
  const { day, month, year } = partsIn(iso, timeZone);
  return `${day}/${month}/${year}`;
}

/** "14/09 21:30", no fuso da guild. */
export function formatDateTime(iso: string, timeZone: string): string {
  const { day, month, hour, minute } = partsIn(iso, timeZone);
  return `${day}/${month} ${hour}:${minute}`;
}

// ── Editor de jogo ──────────────────────────────────────────────────────────

const MAX_KEY_LENGTH = 32;

/**
 * Chave sugerida a partir da pergunta ("Plataforma de jogo" vira
 * `plataforma_de_jogo`), no alfabeto de `SQUAD_FIELD_KEY_RE`.
 */
export function fieldKeyFromLabel(label: string): string {
  const slug = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .slice(0, MAX_KEY_LENGTH)
    .replace(/^_+|_+$/g, '');
  if (slug === '') return 'campo';
  // `constructor` passa no padrão, mas o schema recusa: já existe em todo objeto.
  return slug in Object.prototype ? `${slug.slice(0, MAX_KEY_LENGTH - 2)}_1` : slug;
}

/**
 * Preenche as chaves em branco com a da pergunta, sem repetir nenhuma do
 * jogo. Chave já escrita fica como está: ela pode estar gravada nas respostas.
 */
export function withFieldKeys<T extends { key: string; label: string }>(fields: readonly T[]): T[] {
  const taken = new Set(fields.map((field) => field.key.trim()).filter((key) => key !== ''));
  return fields.map((field) => {
    if (field.key.trim() !== '') return field;
    const base = fieldKeyFromLabel(field.label);
    let key = base;
    for (let n = 2; taken.has(key); n++) {
      const suffix = `_${String(n)}`;
      key = `${base.slice(0, MAX_KEY_LENGTH - suffix.length)}${suffix}`;
    }
    taken.add(key);
    return { ...field, key };
  });
}

/** Opções editadas como texto, uma por linha; linha em branco não vira opção. */
export function parseOptionLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** O toast do botão MATCH. */
export function formatMatchResult({ proposals, joinRequests }: RunSquadMatchResult): string {
  if (proposals === 0 && joinRequests === 0) {
    return 'Nenhum par novo: ninguém procurando combina em horário e perguntas, ou a dupla ainda está na pausa entre propostas.';
  }
  const parts: string[] = [];
  if (proposals > 0) {
    parts.push(proposals === 1 ? '1 proposta aberta' : `${String(proposals)} propostas abertas`);
  }
  if (joinRequests > 0) {
    parts.push(
      joinRequests === 1 ? '1 pedido de entrada' : `${String(joinRequests)} pedidos de entrada`,
    );
  }
  return `${parts.join(' e ')}.`;
}
