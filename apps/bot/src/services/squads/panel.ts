import { setModuleConfig } from '@goodbot/db';
import { SECOND_MS, UserFacingError } from '@goodbot/shared';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  DiscordAPIError,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
} from 'discord.js';

import { OPT_OUT_TOGGLE_ID, SCHEDULE_ID, SEARCH_TOGGLE_ID } from './ids';
import { listRooms, occupantsOf } from './rooms';
import { infoEmbed } from '../../lib/embeds';
import { childLogger } from '../../logger';

import type { AuditService } from '../audit';
import type { ConfigService } from '../config';
import type { AgendaSummary, SquadAgendaService } from './agenda';
import type { Db } from '@goodbot/db';
import type { AuditSource, SquadsConfig } from '@goodbot/shared';
import type { Client, Guild, TextChannel } from 'discord.js';

const log = childLogger('squads');

/** Quantas jogatinas o painel lista. */
export const PANEL_SESSION_COUNT = 3;

/**
 * Uma edição do painel por guild a cada tanto: o Discord limita edição de
 * mensagem por canal, e uma noite movimentada estouraria o limite.
 */
export const PANEL_COALESCE_MS = 5 * SECOND_MS;

/** O que o painel lista de cada sala com gente. */
export interface PanelRoom {
  channelId: string;
  occupants: number;
  limit: number;
}

/** As salas com gente, na ordem do alfabeto grego. Vazia (na janela) não aparece. */
export function panelRooms(guild: Guild, config: SquadsConfig): PanelRoom[] {
  return listRooms(guild, config)
    .map((room) => ({
      channelId: room.id,
      occupants: occupantsOf(guild, room.id),
      // `userLimit` 0 é "sem teto" no Discord; a staff pode ter mexido à mão.
      limit: room.userLimit || config.roomSize,
    }))
    .filter((room) => room.occupants > 0);
}

export function roomLine(room: PanelRoom): string {
  const full = room.occupants >= room.limit;
  return (
    `${full ? '🔴' : '🟢'} <#${room.channelId}> · ${String(room.occupants)}/${String(room.limit)}` +
    ` · ${full ? 'lotada' : 'clique pra entrar'}`
  );
}

/** A jogatina com a hora que o Discord mostra no fuso de quem lê, e o link para a agenda. */
export function sessionLine(session: AgendaSummary): string {
  const unix = String(Math.floor(session.startsAt / 1000));
  return `📅 <t:${unix}:F> (<t:${unix}:R>) · de <@${session.hostId}> · [ver na agenda](${session.url})`;
}

/** A mensagem fixa: as salas abertas, as próximas jogatinas e os botões. */
export function panelMessage(
  rooms: PanelRoom[],
  config: SquadsConfig,
  embedColor?: number,
  sessions: AgendaSummary[] = [],
) {
  const create = config.createChannelId ? `<#${config.createChannelId}>` : '**➕ Criar Squad**';
  const canSchedule = config.agendaChannelId !== null;
  const empty =
    `Ninguém em sala agora. Entre em ${create} para abrir uma e chamar o pessoal` +
    (canSchedule && sessions.length === 0 ? ', ou marque uma jogatina para mais tarde.' : '.');
  const list = rooms.length > 0 ? rooms.map(roomLine).join('\n') : empty;
  const agenda =
    sessions.length > 0
      ? `\n\n**Jogatinas marcadas**\n${sessions.map(sessionLine).join('\n')}`
      : '';
  const embed = infoEmbed(
    {
      title: 'Buscar squad',
      description:
        `${list}${agenda}\n\n` +
        `Para abrir uma sala nova, entre em ${create}: o bot cria a sala e te leva para ela. ` +
        '**BUSCAR SQUAD** mostra para o servidor que você quer jogar agora.' +
        (canSchedule
          ? ` **MARCAR JOGATINA** põe uma jogatina em <#${String(config.agendaChannelId)}>, ` +
            'com a lista de quem vai.'
          : ''),
    },
    embedColor,
  );
  const buttons: ButtonBuilder[] = [];
  if (config.searchRoleId !== null) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(SEARCH_TOGGLE_ID)
        .setLabel('BUSCAR SQUAD')
        .setStyle(ButtonStyle.Primary),
    );
  }
  if (config.optOutRoleId !== null) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(OPT_OUT_TOGGLE_ID)
        .setLabel('SEM AVISO')
        .setStyle(ButtonStyle.Secondary),
    );
  }
  if (canSchedule) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(SCHEDULE_ID)
        .setLabel('MARCAR JOGATINA')
        .setStyle(ButtonStyle.Secondary),
    );
  }
  const components =
    buttons.length > 0 ? [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)] : [];
  return { embeds: [embed], components };
}

function isUnknownMessage(error: unknown): boolean {
  return error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownMessage;
}

function isMissingAccess(error: unknown): boolean {
  return (
    error instanceof DiscordAPIError &&
    (error.code === RESTJSONErrorCodes.MissingAccess ||
      error.code === RESTJSONErrorCodes.MissingPermissions)
  );
}

export interface PublishedPanel {
  channelId: string;
  messageId: string;
  /** `true` quando nasceu mensagem nova; `false` quando a do ar foi editada. */
  created: boolean;
}

export interface SquadPanelDeps {
  client: Client;
  db: Db;
  config: Pick<ConfigService, 'get' | 'getSettings' | 'publishInvalidate'>;
  audit: Pick<AuditService, 'record'>;
  agenda: Pick<SquadAgendaService, 'upcoming'>;
  now?: () => number;
  coalesceMs?: number;
}

/**
 * O painel fixo do módulo (PRD §5.11). Quem publica é `/squad painel` ou o
 * painel web; depois disso o bot só edita, coalescido, a cada mudança numa
 * sala ou na lista de jogatinas. Edição que falha fica para a mudança seguinte. A mensagem apagada é
 * publicada de novo, mas só com "Unknown Message": republicar por falha
 * passageira deixaria duas mensagens fixas no canal.
 */
export class SquadPanelService {
  private readonly client: Client;
  private readonly db: Db;
  private readonly config: SquadPanelDeps['config'];
  private readonly audit: Pick<AuditService, 'record'>;
  private readonly agenda: SquadPanelDeps['agenda'];
  private readonly now: () => number;
  private readonly coalesceMs: number;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  /** Uma escrita por vez em cada guild, para refresh e publish nunca postarem duas. */
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(deps: SquadPanelDeps) {
    this.client = deps.client;
    this.db = deps.db;
    this.config = deps.config;
    this.audit = deps.audit;
    this.agenda = deps.agenda;
    this.now = deps.now ?? Date.now;
    this.coalesceMs = deps.coalesceMs ?? PANEL_COALESCE_MS;
  }

  stop(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  /** Pede uma edição. Várias no mesmo intervalo viram uma só. */
  schedule(guildId: string): void {
    if (this.timers.has(guildId)) return;
    const timer = setTimeout(() => {
      this.timers.delete(guildId);
      void this.refresh(guildId);
    }, this.coalesceMs);
    timer.unref();
    this.timers.set(guildId, timer);
  }

  private enqueue<T>(guildId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(guildId) ?? Promise.resolve();
    const next = previous.then(task, task);
    const settled = next.catch(() => undefined);
    this.queues.set(guildId, settled);
    void settled.then(() => {
      if (this.queues.get(guildId) === settled) this.queues.delete(guildId);
    });
    return next;
  }

  /** Reedita o painel publicado. Nunca lança: falha só vai para o log. */
  refresh(guildId: string): Promise<void> {
    return this.enqueue(guildId, async () => {
      try {
        await this.edit(guildId);
      } catch (error) {
        log.debug({ err: error, guildId }, 'painel de squad não atualizado');
      }
    });
  }

  private async edit(guildId: string): Promise<void> {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return;
    const config = await this.config.get(guildId, 'squads');
    // Sem mensagem publicada, não há o que editar: publicar é da staff.
    if (!config.enabled || config.panelChannelId === null || config.panelMessageId === null) return;
    const channel = guild.channels.cache.get(config.panelChannelId);
    if (channel?.type !== ChannelType.GuildText) return;
    const body = await this.render(guild, config);
    try {
      await channel.messages.edit(config.panelMessageId, body);
    } catch (error) {
      if (!isUnknownMessage(error)) throw error;
      const published = await this.post(guild, channel, config, body);
      log.info({ guildId, messageId: published }, 'painel de squad apagado; publiquei de novo');
    }
  }

  /**
   * Publica o painel, ou reedita o que está no ar no canal configurado. É o que
   * `/squad painel` e o painel web chamam, então a falta vira erro que ensina.
   */
  publish(guild: Guild, actorId: string, source: AuditSource): Promise<PublishedPanel> {
    return this.enqueue(guild.id, async () => {
      const config = await this.config.get(guild.id, 'squads');
      if (!config.enabled) {
        throw new UserFacingError('O módulo de squads está desligado neste servidor.', {
          code: 'MODULE_DISABLED',
        });
      }
      const channelId = config.panelChannelId;
      const channel = channelId ? guild.channels.cache.get(channelId) : undefined;
      if (channel?.type !== ChannelType.GuildText) {
        throw new UserFacingError(
          'Escolha no painel web um canal de texto para o painel de squads.',
          { code: 'SQUADS_NO_PANEL_CHANNEL' },
        );
      }
      const me = guild.members.me;
      const permissions = me ? channel.permissionsFor(me) : null;
      const needed = [
        ['Ver canal', PermissionFlagsBits.ViewChannel],
        ['Enviar mensagens', PermissionFlagsBits.SendMessages],
        ['Inserir links', PermissionFlagsBits.EmbedLinks],
      ] as const;
      const missing = needed.filter(([, flag]) => !permissions?.has(flag)).map(([name]) => name);
      if (missing.length > 0) {
        throw new UserFacingError(
          `Em ${channel.toString()} me falta: **${missing.join('**, **')}**.`,
          { code: 'MISSING_PERMISSIONS' },
        );
      }

      const body = await this.render(guild, config);
      let messageId: string | null = null;
      if (config.panelMessageId !== null) {
        try {
          await channel.messages.edit(config.panelMessageId, body);
          messageId = config.panelMessageId;
        } catch (error) {
          if (!isUnknownMessage(error)) throw error;
        }
      }
      const created = messageId === null;
      messageId ??= await this.post(guild, channel, config, body, actorId);

      this.audit.record({
        guildId: guild.id,
        action: 'squad.panel.publish',
        source,
        actor: actorId,
        target: { type: 'channel', id: channel.id },
        after: { messageId, created },
      });
      return { channelId: channel.id, messageId, created };
    });
  }

  private async render(guild: Guild, config: SquadsConfig) {
    const settings = await this.config.getSettings(guild.id);
    const now = this.now();
    // As que já estão rolando saem: o painel lista o que ainda vai começar.
    const sessions = (await this.agenda.upcoming(guild.id, PANEL_SESSION_COUNT * 2))
      .filter((session) => session.startsAt > now)
      .slice(0, PANEL_SESSION_COUNT);
    return panelMessage(panelRooms(guild, config), config, settings.embedColor, sessions);
  }

  /**
   * Manda a mensagem, fixa e grava o id. O id vai para o config porque é ele
   * que diz, depois de um restart, qual mensagem editar.
   */
  private async post(
    guild: Guild,
    channel: TextChannel,
    config: SquadsConfig,
    body: Awaited<ReturnType<SquadPanelService['render']>>,
    actorId: string | null = null,
  ): Promise<string> {
    let message;
    try {
      message = await channel.send(body);
    } catch (error) {
      if (isMissingAccess(error)) {
        throw new UserFacingError(`Não tenho permissão para escrever em ${channel.toString()}.`, {
          code: 'MISSING_PERMISSIONS',
          cause: error,
        });
      }
      throw error;
    }
    try {
      await message.pin();
    } catch (error) {
      // Sem `PinMessages` a mensagem fica no ar sem pin; o resto funciona.
      log.warn({ err: error, guildId: guild.id, channelId: channel.id }, 'não fixei o painel');
    }
    await setModuleConfig(
      this.db,
      guild.id,
      'squads',
      { ...config, panelMessageId: message.id },
      actorId,
    );
    this.config.publishInvalidate(guild.id, 'squads');
    return message.id;
  }
}
