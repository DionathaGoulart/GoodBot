import {
  cleanupExpiredTicketOpenings,
  listInactiveTickets,
  touchTicketActivity,
} from '@goodbot/db';
import { HOUR_MS, MINUTE_MS, isUserFacingError } from '@goodbot/shared';
import { Events } from 'discord.js';

import { childLogger } from '../logger';

import type { ConfigService } from '../services/config';
import type { TicketService } from '../services/tickets';
import type { Db } from '@goodbot/db';
import type { Client, Message } from 'discord.js';

const log = childLogger('ticket-inactivity');

/** Fecha tickets vencidos sem depender do cache de mensagens ou de membros. */
export class TicketInactivityJob {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly negativeChannels = new Map<string, number>();
  private readonly now: () => number;

  constructor(
    private readonly deps: {
      db: Db;
      client: Client;
      config: Pick<ConfigService, 'get'>;
      tickets: TicketService;
      servesGuild: (guildId: string) => boolean;
      intervalMs?: number;
      now?: () => number;
    },
  ) {
    this.now = deps.now ?? Date.now;
  }

  private readonly onMessage = (message: Message): void => {
    if (!message.guildId || !this.deps.servesGuild(message.guildId) || message.author.bot) return;
    void this.recordActivity(message).catch((error: unknown) => {
      log.warn({ err: error, channelId: message.channelId }, 'atividade de ticket não registrada');
    });
  };

  start(): void {
    if (this.timer) return;
    this.deps.client.on(Events.MessageCreate, this.onMessage);
    this.timer = setInterval(() => void this.tick(), this.deps.intervalMs ?? MINUTE_MS);
    this.timer.unref();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.deps.client.off(Events.MessageCreate, this.onMessage);
    this.negativeChannels.clear();
  }

  private async recordActivity(message: Message): Promise<void> {
    if (!message.guildId || !this.deps.servesGuild(message.guildId)) return;
    const until = this.negativeChannels.get(message.channelId);
    if (until && until > this.now()) return;
    const isTicket = await touchTicketActivity(this.deps.db, message.channelId, message.createdAt);
    if (isTicket) {
      this.negativeChannels.delete(message.channelId);
      return;
    }
    if (this.negativeChannels.size >= 1_000) this.negativeChannels.clear();
    this.negativeChannels.set(message.channelId, this.now() + 5 * MINUTE_MS);
  }

  /** Uma passada lê o banco; no vencimento confirma a última mensagem no Discord. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const guild of this.deps.client.guilds.cache.values()) {
        if (!this.deps.servesGuild(guild.id)) continue;
        try {
          await cleanupExpiredTicketOpenings(this.deps.db, guild.id, new Date(this.now()));
          const config = await this.deps.config.get(guild.id, 'tickets');
          if (!config.enabled || config.autoCloseInactiveHours === 0) continue;
          const cutoff = new Date(this.now() - config.autoCloseInactiveHours * HOUR_MS);
          for (const ticket of await listInactiveTickets(this.deps.db, guild.id, cutoff)) {
            try {
              if (!this.deps.servesGuild(guild.id)) break;
              const channel = await guild.channels.fetch(ticket.channelId);
              if (!this.deps.servesGuild(guild.id)) break;
              if (!channel?.isTextBased() || channel.isDMBased()) {
                log.warn({ ticketId: ticket.id }, 'canal de ticket inativo não encontrado');
                continue;
              }
              // Mensagens recebidas durante uma queda do bot não estão no banco.
              // A última mensagem REST basta para impedir fechamento prematuro.
              const latest = (await channel.messages.fetch({ limit: 1 })).first();
              if (latest && latest.createdAt > cutoff) {
                await touchTicketActivity(this.deps.db, ticket.channelId, latest.createdAt);
                continue;
              }
              await this.deps.tickets.close(channel, ticket, {
                actorId: this.deps.client.user!.id,
                reason: `Fechado automaticamente após ${config.autoCloseInactiveHours} hora(s) sem atividade.`,
                inactiveBefore: cutoff,
              });
            } catch (error) {
              if (isUserFacingError(error) && error.code === 'ALREADY_CLOSING') continue;
              log.warn({ err: error, ticketId: ticket.id }, 'fechamento automático falhou');
            }
          }
        } catch (error) {
          log.warn({ err: error, guildId: guild.id }, 'verificação de tickets inativos falhou');
        }
      }
    } catch (error) {
      log.error({ err: error }, 'passada de tickets inativos falhou');
    } finally {
      this.running = false;
    }
  }
}
