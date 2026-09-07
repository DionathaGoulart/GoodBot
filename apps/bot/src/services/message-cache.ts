import { cacheMessages, deleteCachedMessagesBefore, getCachedMessages } from '@cobot/db';
import { DAY_MS, MESSAGE_CACHE_RETENTION_DAYS, SECOND_MS } from '@cobot/shared';

import { childLogger } from '../logger';

import type { CacheMessageInput, CachedAttachment, Db } from '@cobot/db';
import type { Message, PartialMessage } from 'discord.js';

const log = childLogger('message-cache');

/** Mensagens acumuladas antes de um `INSERT` (ou 5 s, o que vier primeiro). */
export const BUFFER_SIZE = 100;
export const BUFFER_FLUSH_MS = 5 * SECOND_MS;

/** O que o log de exclusão precisa saber sobre uma mensagem. */
export interface CachedContent {
  messageId: string;
  channelId: string;
  authorId: string;
  content: string;
  attachments: CachedAttachment[];
}

export interface MessageCacheDeps {
  db: Db;
  /** Mensagens mantidas em memória por canal (`logs.messageCache.perChannel`). */
  perChannel?: number;
  bufferSize?: number;
  flushIntervalMs?: number;
}

/**
 * Recupera o conteúdo de mensagens que o discord.js não tem em cache — sem
 * isto, `messageDelete` de uma mensagem anterior ao boot do bot chega vazio
 * (PRD §5.4).
 *
 * São duas camadas: um LRU por canal em memória (leitura instantânea, sem ida
 * ao banco) e a tabela `message_cache`, escrita em lote e podada em 7 dias.
 */
export class MessageCacheService {
  private readonly deps: MessageCacheDeps;
  private perChannel: number;
  private readonly bufferSize: number;
  /** `Map` preserva a ordem de inserção: o primeiro item é o mais antigo. */
  private readonly memory = new Map<string, Map<string, CachedContent>>();
  private buffer: CacheMessageInput[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private flushing = false;

  constructor(deps: MessageCacheDeps) {
    this.deps = deps;
    this.perChannel = deps.perChannel ?? 200;
    this.bufferSize = deps.bufferSize ?? BUFFER_SIZE;
  }

  /**
   * Ajusta o LRU ao `logs.messageCache.perChannel` da guild. Single-server
   * hoje: o valor é aplicado uma vez no `ready`.
   */
  setPerChannel(value: number): void {
    this.perChannel = value;
  }

  start(): void {
    if (!this.flushTimer) {
      this.flushTimer = setInterval(
        () => void this.flush(),
        this.deps.flushIntervalMs ?? BUFFER_FLUSH_MS,
      );
      this.flushTimer.unref();
    }
  }

  stop(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
  }

  /** Mensagens no buffer esperando o INSERT em lote — gauge do `/metrics`. */
  get pendingSize(): number {
    return this.buffer.length;
  }

  /** Registra uma mensagem (memória na hora, banco no próximo lote). */
  record(message: Message | PartialMessage): void {
    if (!message.guildId || !message.author) return;
    // Bots geram volume alto e conteúdo pouco útil para auditoria.
    if (message.author.bot) return;

    const entry: CachedContent = {
      messageId: message.id,
      channelId: message.channelId,
      authorId: message.author.id,
      content: message.content ?? '',
      attachments: toCachedAttachments(message),
    };
    this.remember(entry);

    this.buffer.push({
      messageId: entry.messageId,
      guildId: message.guildId,
      channelId: entry.channelId,
      authorId: entry.authorId,
      content: entry.content,
      attachments: entry.attachments,
      createdAt: message.createdAt ?? new Date(),
    });
    if (this.buffer.length >= this.bufferSize) void this.flush();
  }

  private remember(entry: CachedContent): void {
    let channel = this.memory.get(entry.channelId);
    if (!channel) {
      channel = new Map();
      this.memory.set(entry.channelId, channel);
    }
    channel.delete(entry.messageId);
    channel.set(entry.messageId, entry);
    while (channel.size > this.perChannel) {
      const oldest = channel.keys().next().value;
      if (oldest === undefined) break;
      channel.delete(oldest);
    }
  }

  /** Conteúdo de uma mensagem: memória primeiro, banco depois. */
  async get(channelId: string, messageId: string): Promise<CachedContent | null> {
    const hit = this.memory.get(channelId)?.get(messageId);
    if (hit) return hit;
    const [row] = await this.lookup([messageId]);
    return row ?? null;
  }

  /** Versão em lote, usada pelo log de bulk delete. */
  async getMany(channelId: string, messageIds: readonly string[]): Promise<CachedContent[]> {
    const channel = this.memory.get(channelId);
    const found: CachedContent[] = [];
    const missing: string[] = [];
    for (const id of messageIds) {
      const hit = channel?.get(id);
      if (hit) found.push(hit);
      else missing.push(id);
    }
    if (missing.length === 0) return found;
    // O que sobrou pode estar no banco, mas só depois do lote pendente entrar.
    await this.flush();
    return [...found, ...(await this.lookup(missing))];
  }

  private async lookup(messageIds: readonly string[]): Promise<CachedContent[]> {
    try {
      const rows = await getCachedMessages(this.deps.db, messageIds);
      return rows.map((row) => ({
        messageId: row.messageId,
        channelId: row.channelId,
        authorId: row.authorId,
        content: row.content,
        attachments: row.attachments,
      }));
    } catch (error) {
      log.error({ err: error }, 'falha ao ler o cache de mensagens');
      return [];
    }
  }

  /** Esvazia o buffer no banco. Nunca lança. */
  async flush(): Promise<number> {
    if (this.flushing || this.buffer.length === 0) return 0;
    this.flushing = true;
    const batch = this.buffer;
    this.buffer = [];
    try {
      const written = await cacheMessages(this.deps.db, batch);
      log.debug({ written }, 'lote de cache de mensagens gravado');
      return written;
    } catch (error) {
      log.error({ err: error, size: batch.length }, 'falha ao gravar o cache de mensagens');
      return 0;
    } finally {
      this.flushing = false;
    }
  }

  /** Job de retenção (PRD §8): 7 dias. Roda pelo `RetentionJob`, que alerta se falhar. */
  async cleanup(): Promise<number> {
    const before = new Date(Date.now() - MESSAGE_CACHE_RETENTION_DAYS * DAY_MS);
    return deleteCachedMessagesBefore(this.deps.db, before);
  }

  /** Esquece um canal inteiro (canal apagado). */
  forgetChannel(channelId: string): void {
    this.memory.delete(channelId);
  }
}

/** Anexos viram nome + tamanho: o bot nunca guarda o arquivo (PRD §5.4). */
export function toCachedAttachments(message: Message | PartialMessage): CachedAttachment[] {
  return [...message.attachments.values()].map((attachment) => ({
    name: attachment.name,
    size: attachment.size,
    contentType: attachment.contentType,
  }));
}
