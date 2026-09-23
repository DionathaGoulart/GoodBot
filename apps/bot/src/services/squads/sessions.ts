import {
  HOUR_MS,
  LFG_EVENT_HOURS,
  LFG_MAX_EVENTS,
  MINUTE_MS,
  parseWhen,
  UserFacingError,
} from '@goodbot/shared';
import {
  ChannelType,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventStatus,
  PermissionFlagsBits,
} from 'discord.js';

import { childLogger } from '../../logger';

import type { AuditService } from '../audit';
import type { ConfigService } from '../config';
import type { RegistryService } from '../registry';
import type { AuditSource, SquadsConfig } from '@goodbot/shared';
import type { Client, Guild, GuildMember, GuildScheduledEvent } from 'discord.js';

const log = childLogger('squads');

/**
 * De quanto em quanto tempo o bot relê os eventos das guilds. É o que percebe
 * jogatina cancelada pela staff e jogatina que passou (o cache de eventos está
 * desligado, §7.2, e sem a intent de eventos nada disso chega pelo gateway).
 * Início que cai dentro do intervalo ganha um timer próprio, na hora certa.
 */
export const SESSIONS_POLL_MS = 5 * MINUTE_MS;

/** Quantas jogatinas o painel lista. */
export const PANEL_SESSION_COUNT = 3;

/** Teto do nome de evento no Discord. */
const EVENT_NAME_MAX = 100;

const SESSION_REASON = 'Jogatina marcada no painel de squads';

/** O que o painel mostra de uma jogatina. */
export interface SessionSummary {
  id: string;
  name: string;
  startsAt: number;
  url: string;
}

/** O pedaço do evento do Discord que as regras leem. */
export type SessionEvent = Pick<
  GuildScheduledEvent,
  'id' | 'name' | 'creatorId' | 'status' | 'scheduledStartTimestamp' | 'scheduledEndTimestamp'
> & { url: string };

export function sessionName(displayName: string): string {
  return `Jogatina de ${displayName}`.slice(0, EVENT_NAME_MAX);
}

/**
 * As jogatinas do módulo que ainda não começaram, da mais próxima para a mais
 * distante. O módulo reconhece as suas pelo criador, que é o próprio bot: não
 * há tabela.
 */
export function upcomingSessions(
  events: Iterable<SessionEvent>,
  botId: string,
  now: number,
): SessionSummary[] {
  return [...events]
    .filter(
      (event) =>
        event.creatorId === botId &&
        event.status === GuildScheduledEventStatus.Scheduled &&
        event.scheduledStartTimestamp !== null &&
        event.scheduledStartTimestamp > now,
    )
    .map((event) => ({
      id: event.id,
      name: event.name,
      startsAt: event.scheduledStartTimestamp as number,
      url: event.url,
    }))
    .sort((a, b) => a.startsAt - b.startsAt);
}

/**
 * Jogatinas do bot cuja hora chegou e que ninguém iniciou. Evento de voz não
 * começa sozinho no Discord, e é o início que dispara a notificação de quem
 * marcou "Tenho interesse". Depois do fim previsto já não vale iniciar.
 */
export function dueSessions<T extends SessionEvent>(
  events: Iterable<T>,
  botId: string,
  now: number,
): T[] {
  return [...events].filter((event) => {
    if (event.creatorId !== botId || event.status !== GuildScheduledEventStatus.Scheduled) {
      return false;
    }
    const start = event.scheduledStartTimestamp;
    if (start === null || start > now) return false;
    const end = event.scheduledEndTimestamp ?? start + LFG_EVENT_HOURS * HOUR_MS;
    return now < end;
  });
}

export interface ScheduledSession {
  eventId: string;
  startsAt: Date;
  url: string;
}

export interface SquadSessionDeps {
  client: Client;
  config: Pick<ConfigService, 'get' | 'getSettings'>;
  registry: Pick<RegistryService, 'servedGuildIds'>;
  audit: Pick<AuditService, 'record'>;
  /** A lista de jogatinas mudou: o painel precisa se refazer. */
  onChange: (guildId: string) => void;
  now?: () => number;
  pollMs?: number;
}

/**
 * A jogatina agendada (PRD §5.11): um evento nativo do Discord, de voz,
 * apontando para o canal de criar. RSVP e lembrete são do Discord; o bot cria,
 * inicia na hora e lista no painel. Nada é gravado: a lista é relida dos
 * eventos da guild e guardada só em memória, para o painel não fazer uma
 * chamada REST a cada edição.
 */
export class SquadSessionService {
  private readonly client: Client;
  private readonly config: SquadSessionDeps['config'];
  private readonly registry: SquadSessionDeps['registry'];
  private readonly audit: Pick<AuditService, 'record'>;
  private readonly onChange: (guildId: string) => void;
  private readonly now: () => number;
  private readonly pollMs: number;
  private readonly cache = new Map<string, SessionSummary[]>();
  private readonly startTimers = new Map<string, NodeJS.Timeout>();
  /** Uma leitura por vez em cada guild: o poll e o timer de início se cruzam. */
  private readonly syncing = new Map<string, Promise<void>>();
  private timer: NodeJS.Timeout | null = null;

  constructor(deps: SquadSessionDeps) {
    this.client = deps.client;
    this.config = deps.config;
    this.registry = deps.registry;
    this.audit = deps.audit;
    this.onChange = deps.onChange;
    this.now = deps.now ?? Date.now;
    this.pollMs = deps.pollMs ?? SESSIONS_POLL_MS;
  }

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.pollMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const timer of this.startTimers.values()) clearTimeout(timer);
    this.startTimers.clear();
  }

  /** As próximas jogatinas da guild, como a última leitura as viu. */
  upcoming(guildId: string): SessionSummary[] {
    return this.cache.get(guildId) ?? [];
  }

  async tick(): Promise<void> {
    const served = new Set(this.registry.servedGuildIds());
    for (const guildId of this.cache.keys()) {
      if (!served.has(guildId)) this.forget(guildId);
    }
    for (const guildId of served) {
      try {
        const config = await this.config.get(guildId, 'squads');
        if (!config.enabled) {
          this.forget(guildId);
          continue;
        }
        await this.sync(guildId);
      } catch (error) {
        log.warn({ err: error, guildId }, 'não li as jogatinas');
      }
    }
  }

  private forget(guildId: string): void {
    this.cache.delete(guildId);
    const timer = this.startTimers.get(guildId);
    if (timer) clearTimeout(timer);
    this.startTimers.delete(guildId);
  }

  /**
   * Relê os eventos, inicia o que venceu e guarda a lista. Pedido que chega com
   * uma leitura em curso ganha outra depois dela, porque a em curso pode ter
   * começado antes do evento que motivou o pedido.
   */
  sync(guildId: string): Promise<void> {
    const running = this.syncing.get(guildId);
    const task = (running ?? Promise.resolve()).then(() => this.read(guildId));
    const settled: Promise<void> = task
      .catch(() => undefined)
      .finally(() => {
        if (this.syncing.get(guildId) === settled) this.syncing.delete(guildId);
      });
    this.syncing.set(guildId, settled);
    return task;
  }

  private async read(guildId: string): Promise<void> {
    const guild = this.client.guilds.cache.get(guildId);
    const botId = this.client.user?.id;
    if (!guild || !botId) return;
    const events = [...(await guild.scheduledEvents.fetch()).values()];
    const now = this.now();

    for (const event of dueSessions(events, botId, now)) {
      try {
        await event.setStatus(GuildScheduledEventStatus.Active, SESSION_REASON);
        log.debug({ guildId, eventId: event.id }, 'jogatina iniciada');
      } catch (error) {
        log.warn({ err: error, guildId, eventId: event.id }, 'não iniciei a jogatina');
      }
    }

    const upcoming = upcomingSessions(events, botId, now);
    const before = this.cache.get(guildId);
    this.cache.set(guildId, upcoming);
    if (before === undefined || signature(before) !== signature(upcoming)) {
      this.onChange(guildId);
    }
    this.armStart(guildId, upcoming[0]?.startsAt ?? null, now);
  }

  /** Início antes do próximo poll ganha timer; o resto o poll alcança. */
  private armStart(guildId: string, startsAt: number | null, now: number): void {
    const previous = this.startTimers.get(guildId);
    if (previous) clearTimeout(previous);
    this.startTimers.delete(guildId);
    if (startsAt === null || startsAt - now >= this.pollMs) return;
    const timer = setTimeout(
      () => {
        this.startTimers.delete(guildId);
        void this.sync(guildId).catch((error: unknown) => {
          log.warn({ err: error, guildId }, 'não li as jogatinas');
        });
      },
      // Um segundo de folga: o Discord recusa iniciar antes da hora.
      Math.max(0, startsAt - now) + 1_000,
    );
    timer.unref();
    this.startTimers.set(guildId, timer);
  }

  /**
   * Marca uma jogatina. Tudo é conferido antes, e a falta vira erro que diz o
   * que falta: é resposta de um modal, com gente esperando.
   */
  async schedule(
    guild: Guild,
    member: GuildMember,
    when: string,
    config: SquadsConfig,
    source: AuditSource,
  ): Promise<ScheduledSession> {
    const channel = config.createChannelId
      ? guild.channels.cache.get(config.createChannelId)
      : undefined;
    if (channel?.type !== ChannelType.GuildVoice) {
      throw new UserFacingError(
        'A jogatina acontece no canal de criar squad, e ele não está configurado.',
        { code: 'SQUADS_NO_CREATE_CHANNEL' },
      );
    }
    const me = guild.members.me;
    const permissions = me ? channel.permissionsFor(me) : null;
    const needed = [
      ['Gerenciar eventos', PermissionFlagsBits.ManageEvents],
      ['Ver canal', PermissionFlagsBits.ViewChannel],
      ['Conectar', PermissionFlagsBits.Connect],
    ] as const;
    const missing = needed.filter(([, flag]) => !permissions?.has(flag)).map(([name]) => name);
    if (missing.length > 0) {
      throw new UserFacingError(
        `Para marcar jogatina em ${channel.toString()} me falta: **${missing.join('**, **')}**.`,
        { code: 'MISSING_PERMISSIONS' },
      );
    }

    const { timezone } = await this.config.getSettings(guild.id);
    const startsAt = parseWhen(when, new Date(this.now()), timezone);

    const botId = this.client.user?.id ?? me?.id ?? '';
    const events = [...(await guild.scheduledEvents.fetch()).values()];
    if (upcomingSessions(events, botId, this.now()).length >= LFG_MAX_EVENTS) {
      throw new UserFacingError(
        `Já há ${String(LFG_MAX_EVENTS)} jogatinas marcadas. Espere uma acontecer ` +
          'ou peça à staff para cancelar alguma.',
        { code: 'SQUADS_TOO_MANY_EVENTS' },
      );
    }

    const event = await guild.scheduledEvents.create({
      name: sessionName(member.displayName),
      description: `Marcada por ${member.displayName} (@${member.user.username}).`,
      scheduledStartTime: startsAt,
      scheduledEndTime: new Date(startsAt.getTime() + LFG_EVENT_HOURS * HOUR_MS),
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      entityType: GuildScheduledEventEntityType.Voice,
      channel: channel.id,
      reason: `${SESSION_REASON} por ${member.user.username}`,
    });

    this.audit.record({
      guildId: guild.id,
      action: 'squad.session.create',
      source,
      actor: member.id,
      target: { type: 'event', id: event.id },
      after: { startsAt: startsAt.toISOString(), channelId: channel.id },
    });
    // A lista do painel sai de uma leitura nova, com o evento que acabou de nascer.
    void this.sync(guild.id).catch((error: unknown) => {
      log.warn({ err: error, guildId: guild.id }, 'não li as jogatinas');
    });
    return { eventId: event.id, startsAt, url: event.url };
  }
}

function signature(sessions: SessionSummary[]): string {
  return sessions.map((session) => `${session.id}@${String(session.startsAt)}`).join(',');
}
