import { BULK_DELETE_MAX_AGE_MS } from '@goodbot/shared';

/** O mínimo de uma mensagem para os filtros; o `Message` real satisfaz isto. */
export interface PurgeCandidate {
  id: string;
  content: string;
  createdTimestamp: number;
  pinned: boolean;
  author: { id: string; bot: boolean };
  attachments: { size: number };
  embeds: readonly unknown[];
}

export interface PurgeFilters {
  /** Só mensagens deste autor. */
  userId?: string;
  /** Só mensagens de bots. */
  botsOnly?: boolean;
  /** Substring (case-insensitive) que o conteúdo precisa ter. */
  contains?: string;
  /** Só mensagens com link. */
  linksOnly?: boolean;
  /** Só mensagens com anexo ou embed. */
  attachmentsOnly?: boolean;
  /** Mensagens mais antigas que este id. */
  beforeId?: string;
  /** Mensagens mais novas que este id. */
  afterId?: string;
  /** Preserva mensagens fixadas (padrão: sim). */
  keepPinned?: boolean;
}

const LINK_RE = /https?:\/\/\S+/i;

/** Compara snowflakes como números grandes — string não ordena por tamanho. */
function isBefore(id: string, reference: string): boolean {
  return BigInt(id) < BigInt(reference);
}

/**
 * Aplica os filtros do `/purge` (PRD §5.3) a uma mensagem. Puro de propósito:
 * a regra é testada sem client nem canal.
 */
export function matchesPurgeFilters(message: PurgeCandidate, filters: PurgeFilters): boolean {
  if (filters.keepPinned !== false && message.pinned) return false;
  if (filters.userId && message.author.id !== filters.userId) return false;
  if (filters.botsOnly && !message.author.bot) return false;
  if (filters.contains) {
    const needle = filters.contains.toLowerCase();
    if (!message.content.toLowerCase().includes(needle)) return false;
  }
  if (filters.linksOnly && !LINK_RE.test(message.content)) return false;
  if (filters.attachmentsOnly && message.attachments.size === 0 && message.embeds.length === 0) {
    return false;
  }
  if (filters.beforeId && !isBefore(message.id, filters.beforeId)) return false;
  if (filters.afterId && !isBefore(filters.afterId, message.id)) return false;
  return true;
}

/** `true` enquanto a mensagem couber no `bulkDelete` (14 dias). */
export function isBulkDeletable(message: PurgeCandidate, now = Date.now()): boolean {
  return now - message.createdTimestamp < BULK_DELETE_MAX_AGE_MS;
}

/**
 * Separa o que vai por `bulkDelete` do que precisa de delete individual — o
 * Discord recusa o bulk para mensagens com mais de 14 dias (PRD §7.4).
 */
export function splitByAge<T extends PurgeCandidate>(
  messages: readonly T[],
  now = Date.now(),
): { bulk: T[]; individual: T[] } {
  const bulk: T[] = [];
  const individual: T[] = [];
  for (const message of messages) {
    (isBulkDeletable(message, now) ? bulk : individual).push(message);
  }
  return { bulk, individual };
}

/** Fatias de no máximo `size` (o `bulkDelete` aceita 100 por chamada). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/** Resumo dos filtros usados, para a resposta e o mod-log. */
export function describeFilters(filters: PurgeFilters): string {
  const parts: string[] = [];
  if (filters.userId) parts.push(`autor <@${filters.userId}>`);
  if (filters.botsOnly) parts.push('apenas bots');
  if (filters.contains) parts.push(`contém "${filters.contains}"`);
  if (filters.linksOnly) parts.push('apenas links');
  if (filters.attachmentsOnly) parts.push('apenas anexos');
  if (filters.beforeId) parts.push(`antes de \`${filters.beforeId}\``);
  if (filters.afterId) parts.push(`depois de \`${filters.afterId}\``);
  return parts.length > 0 ? parts.join(', ') : 'nenhum';
}
