import { cacheMessages, deleteCachedMessagesBefore, getCachedMessages } from '@goodbot/db';
import {
  DAY_MS,
  HOUR_MS,
  MESSAGE_CACHE_RETENTION_DAYS,
  MINUTE_MS,
  SECOND_MS,
} from '@goodbot/shared';

import { childLogger } from '../logger';

import type { CacheMessageInput, CachedAttachment, Db } from '@goodbot/db';
import type { Message, PartialMessage } from 'discord.js';

const log = childLogger('message-cache');

/** Mensagens acumuladas antes de um `INSERT` (ou 5 s, o que vier primeiro). */
export const BUFFER_SIZE = 100;
export const BUFFER_FLUSH_MS = 5 * SECOND_MS;

/**
 * Canal sem mensagem nova há mais que isto sai da memória. É o mesmo prazo do
 * sweeper de mensagens do discord.js (`client.ts`): passado ele, quem pede o
 * conteúdo vai ao banco, que guarda 7 dias.
 */
export const IDLE_CHANNEL_MS = HOUR_MS;
/** De quanto em quanto tempo os canais parados são procurados. */
export const SWEEP_INTERVAL_MS = 10 * MINUTE_MS;

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
  bufferSize?: number;
  flushIntervalMs?: number;
  now?: () => number;
}

/** O LRU de um canal e a hora da última mensagem que entrou nele. */
interface ChannelMemory {
  /** `Map` preserva a ordem de inserção: o primeiro item é o mais antigo. */
  entries: Map<string, CachedContent>;
  lastAt: number;
}

/**
 * Recupera o conteúdo de mensagens que o discord.js não tem em cache — sem
 * isto, `messageDelete` de uma mensagem anterior ao boot do bot chega vazio
 * (PRD §5.4).
 *
 * São duas camadas: um LRU por canal em memória (leitura instantânea, sem ida
 * ao banco) e a tabela `message_cache`, escrita em lote e podada em 7 dias.
 *
 * A memória é o que mais cresce com o número de servidores, então ela tem dois
 * limites: o tamanho de cada canal é o `perChannel` da guild **dona** do canal
 * (um servidor que pede 1000 não aumenta o cache dos outros), e canal parado há
 * mais de `IDLE_CHANNEL_MS` sai inteiro. Sem o segundo, todo canal que falou
 * uma vez desde o boot ficava na RAM até o próximo reinício.
 */
export class MessageCacheService {
  private readonly deps: MessageCacheDeps;
  private readonly bufferSize: number;
  private readonly now: () => number;
  private readonly memory = new Map<string, ChannelMemory>();
  private buffer: CacheMessageInput[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;
  private flushing = false;

  constructor(deps: MessageCacheDeps) {
    this.deps = deps;
    this.bufferSize = deps.bufferSize ?? BUFFER_SIZE;
    this.now = deps.now ?? Date.now;
  }

  start(): void {
    if (!this.flushTimer) {
      this.flushTimer = setInterval(
        () => void this.flush(),
        this.deps.flushIntervalMs ?? BUFFER_FLUSH_MS,
      );
      this.flushTimer.unref();
    }
    if (!this.sweepTimer) {
      this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
      this.sweepTimer.unref();
    }
  }

  stop(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.flushTimer = null;
    this.sweepTimer = null;
  }

  /** Mensagens no buffer esperando o INSERT em lote — gauge do `/metrics`. */
  get pendingSize(): number {
    return this.buffer.length;
  }

  /** Canais com mensagens na memória agora (gauge `message_cache_channels`). */
  get channelsInMemory(): number {
    return this.memory.size;
  }

  /**
   * Registra uma mensagem (memória na hora, banco no próximo lote).
   *
   * `perChannel` é o `logs.messageCache.perChannel` da guild da mensagem. Ele
   * vem de quem chama, que já leu a config pelo `ConfigService`: assim uma
   * mudança no painel vale na mensagem seguinte, sem reinício.
   */
  record(message: Message | PartialMessage, perChannel: number): void {
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
    this.remember(entry, perChannel);

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

  private remember(entry: CachedContent, perChannel: number): void {
    let channel = this.memory.get(entry.channelId);
    if (!channel) {
      channel = { entries: new Map(), lastAt: 0 };
      this.memory.set(entry.channelId, channel);
    }
    channel.lastAt = this.now();
    const { entries } = channel;
    entries.delete(entry.messageId);
    entries.set(entry.messageId, entry);
    while (entries.size > perChannel) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  }

  /**
   * Tira da memória os canais parados há mais de `IDLE_CHANNEL_MS`. O conteúdo
   * continua no banco; o que muda é só que a próxima leitura dele custa uma
   * query. Devolve quantos canais saíram.
   */
  sweep(): number {
    const cutoff = this.now() - IDLE_CHANNEL_MS;
    let removed = 0;
    for (const [channelId, channel] of this.memory) {
      if (channel.lastAt <= cutoff) {
        this.memory.delete(channelId);
        removed += 1;
      }
    }
    if (removed > 0)
      log.debug({ removed, left: this.memory.size }, 'canais parados saíram da memória');
    return removed;
  }

  /** Conteúdo de uma mensagem: memória primeiro, banco depois. */
  async get(channelId: string, messageId: string): Promise<CachedContent | null> {
    const hit = this.memory.get(channelId)?.entries.get(messageId);
    if (hit) return hit;
    const [row] = await this.lookup([messageId]);
    return row ?? null;
  }

  /** Versão em lote, usada pelo log de bulk delete. */
  async getMany(channelId: string, messageIds: readonly string[]): Promise<CachedContent[]> {
    const channel = this.memory.get(channelId)?.entries;
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
