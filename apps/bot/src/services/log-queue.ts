import { SECOND_MS } from '@goodbot/shared';
import { DiscordAPIError, HTTPError } from 'discord.js';

import { TEXT_CHANNEL_TYPES } from '../client';
import { childLogger } from '../logger';

import type {
  APIEmbed,
  Client,
  EmbedBuilder,
  JSONEncodable,
  Message,
  MessageCreateOptions,
} from 'discord.js';

/** Mesma união que `channel.send({ files })` aceita (Buffer, builder, anexo). */
export type LogFiles = NonNullable<MessageCreateOptions['files']>;

const log = childLogger('log-queue');

/** O Discord aceita 10 embeds por mensagem — é o teto do coalescing (PRD §7.4). */
export const MAX_EMBEDS_PER_MESSAGE = 10;
/** Janela de agrupamento: 2 s (PRD §7.4). */
export const FLUSH_INTERVAL_MS = 2 * SECOND_MS;
/** Teto por canal; acima disso o log mais antigo é descartado com warn. */
export const MAX_PENDING_PER_CHANNEL = 200;

/** Uma entrada de log já pronta para virar mensagem. */
export interface LogEntry {
  embeds: (EmbedBuilder | JSONEncodable<APIEmbed> | APIEmbed)[];
  /** Anexos (o `.txt` do bulk delete). Entradas com anexo não são agrupadas. */
  files?: LogFiles;
}

/** Envio efetivo. Injetável para os testes não precisarem de um `Client`. */
export type LogSender = (channelId: string, entry: LogEntry) => Promise<Message | null>;

export interface LogQueueOptions {
  client?: Client;
  sender?: LogSender;
  flushIntervalMs?: number;
  maxEmbeds?: number;
  maxPending?: number;
  now?: () => number;
}

/** Códigos que significam "esse canal não serve mais": o queue desiste dele. */
const FATAL_CODES = new Set([10003, 50001, 50013, 160002]);

interface ChannelState {
  pending: LogEntry[];
  /** Enquanto `> now`, o canal está em backoff por 429. */
  blockedUntil: number;
  flushing: boolean;
  /** Canal inexistente/sem permissão: para de tentar até o próximo boot. */
  dead: boolean;
}

/**
 * Fila de envio por canal com coalescing. Todo log do bot passa por aqui para
 * não estourar o limite de 5 mensagens/5 s por canal: as entradas acumuladas
 * viram uma mensagem só, com até 10 embeds, a cada 2 s (ou na hora, quando a
 * fila enche).
 *
 * Nada aqui lança: falhar um log nunca pode derrubar o evento que o gerou.
 */
export class LogQueue {
  private readonly channels = new Map<string, ChannelState>();
  private readonly sender: LogSender;
  private readonly flushIntervalMs: number;
  private readonly maxEmbeds: number;
  private readonly maxPending: number;
  private readonly now: () => number;
  private timer: NodeJS.Timeout | null = null;

  constructor(options: LogQueueOptions = {}) {
    this.flushIntervalMs = options.flushIntervalMs ?? FLUSH_INTERVAL_MS;
    this.maxEmbeds = options.maxEmbeds ?? MAX_EMBEDS_PER_MESSAGE;
    this.maxPending = options.maxPending ?? MAX_PENDING_PER_CHANNEL;
    this.now = options.now ?? Date.now;
    this.sender = options.sender ?? createClientSender(options.client);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flushAll(), this.flushIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private state(channelId: string): ChannelState {
    let state = this.channels.get(channelId);
    if (!state) {
      state = { pending: [], blockedUntil: 0, flushing: false, dead: false };
      this.channels.set(channelId, state);
    }
    return state;
  }

  /** Enfileira uma entrada. Retorna `false` quando o canal já foi descartado. */
  push(channelId: string, entry: LogEntry): boolean {
    const state = this.state(channelId);
    if (state.dead) return false;

    state.pending.push(entry);
    if (state.pending.length > this.maxPending) {
      const dropped = state.pending.length - this.maxPending;
      state.pending.splice(0, dropped);
      log.warn({ channelId, dropped }, 'fila de log cheia; descartando entradas antigas');
    }

    // Cheia antes dos 2 s: manda agora em vez de esperar o tick.
    if (countEmbeds(state.pending) >= this.maxEmbeds) {
      void this.flush(channelId);
    }
    return true;
  }

  /**
   * Envia uma entrada agora e devolve a mensagem criada. É o caminho do
   * mod-log, que precisa do id da mensagem para editá-la quando o motivo do
   * caso muda — o coalescing não teria como devolver esse id.
   */
  async send(channelId: string, entry: LogEntry): Promise<Message | null> {
    const state = this.state(channelId);
    if (state.dead) return null;
    await this.waitForBackoff(state);
    return this.deliver(channelId, state, entry);
  }

  /** Descarrega todos os canais com pendência. Nunca lança. */
  async flushAll(): Promise<void> {
    await Promise.all([...this.channels.keys()].map((channelId) => this.flush(channelId)));
  }

  /** Descarrega um canal, uma mensagem por vez, até esvaziar. */
  async flush(channelId: string): Promise<void> {
    const state = this.channels.get(channelId);
    if (!state || state.flushing || state.dead || state.pending.length === 0) return;
    if (state.blockedUntil > this.now()) return;

    state.flushing = true;
    try {
      while (state.pending.length > 0 && !state.dead && state.blockedUntil <= this.now()) {
        const batch = takeBatch(state.pending, this.maxEmbeds);
        const sent = await this.deliver(channelId, state, batch.entry);
        // 429 ou falha transitória: devolve o lote para a próxima passada.
        if (!sent && state.blockedUntil > this.now()) {
          state.pending.unshift(...batch.taken);
          break;
        }
      }
    } finally {
      state.flushing = false;
    }
  }

  private async waitForBackoff(state: ChannelState): Promise<void> {
    const wait = state.blockedUntil - this.now();
    if (wait <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 10 * SECOND_MS)));
  }

  /** Envia e traduz a falha: 429 vira backoff, canal inválido mata a fila. */
  private async deliver(
    channelId: string,
    state: ChannelState,
    entry: LogEntry,
  ): Promise<Message | null> {
    try {
      return await this.sender(channelId, entry);
    } catch (error) {
      const retryAfterMs = rateLimitDelay(error);
      if (retryAfterMs !== null) {
        state.blockedUntil = this.now() + retryAfterMs;
        log.warn({ channelId, retryAfterMs }, 'rate limit no canal de log; adiando');
        return null;
      }
      if (isFatal(error)) {
        state.dead = true;
        state.pending.length = 0;
        log.warn(
          { channelId, err: error },
          'canal de log inacessível (inexistente ou sem permissão); logs descartados',
        );
        return null;
      }
      log.error({ channelId, err: error }, 'falha ao enviar log');
      return null;
    }
  }

  /** Reabilita um canal marcado como morto (mudou a config ou a permissão). */
  reset(channelId?: string): void {
    if (channelId) {
      this.channels.delete(channelId);
      return;
    }
    this.channels.clear();
  }

  /** Só para testes e diagnóstico. */
  pendingCount(channelId: string): number {
    return this.channels.get(channelId)?.pending.length ?? 0;
  }

  /** Total represado em todos os canais — gauge do `/metrics` (PRD §11). */
  get pendingSize(): number {
    let total = 0;
    for (const state of this.channels.values()) total += state.pending.length;
    return total;
  }
}

/** Junta entradas até o limite de embeds; entrada com anexo vai sozinha. */
function takeBatch(pending: LogEntry[], maxEmbeds: number): { entry: LogEntry; taken: LogEntry[] } {
  const first = pending.shift() as LogEntry;
  if (first.files?.length) return { entry: first, taken: [first] };

  const taken = [first];
  const embeds = [...first.embeds];
  while (pending.length > 0) {
    const next = pending[0] as LogEntry;
    if (next.files?.length) break;
    if (embeds.length + next.embeds.length > maxEmbeds) break;
    pending.shift();
    taken.push(next);
    embeds.push(...next.embeds);
  }
  return { entry: { embeds }, taken };
}

function countEmbeds(pending: readonly LogEntry[]): number {
  return pending.reduce((total, entry) => total + entry.embeds.length, 0);
}

/** `retry_after` do Discord em ms, ou `null` quando não é rate limit. */
function rateLimitDelay(error: unknown): number | null {
  if (error instanceof DiscordAPIError && error.status === 429) {
    const retryAfter = (error.rawError as { retry_after?: number } | undefined)?.retry_after;
    return Math.max(SECOND_MS, (retryAfter ?? 1) * SECOND_MS);
  }
  if (error instanceof HTTPError && error.status === 429) return 5 * SECOND_MS;
  return null;
}

function isFatal(error: unknown): boolean {
  return error instanceof DiscordAPIError && FATAL_CODES.has(Number(error.code));
}

/** Sender real: resolve o canal pelo cache do client e posta a mensagem. */
export function createClientSender(client?: Client): LogSender {
  return async (channelId, entry) => {
    if (!client) return null;
    const channel =
      client.channels.cache.get(channelId) ?? (await client.channels.fetch(channelId));
    if (!channel || !channel.isTextBased() || channel.isDMBased()) {
      throw new Error(`canal de log ${channelId} não é um canal de texto de servidor`);
    }
    if (!TEXT_CHANNEL_TYPES.includes(channel.type as (typeof TEXT_CHANNEL_TYPES)[number])) {
      throw new Error(`canal de log ${channelId} não aceita mensagens do bot`);
    }
    return channel.send({ embeds: entry.embeds, files: entry.files });
  };
}
