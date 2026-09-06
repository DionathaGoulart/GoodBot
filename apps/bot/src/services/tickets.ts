import {
  claimTicket,
  closeTicket,
  countOpenTickets,
  createTicket,
  getTicketByChannel,
  getTicketPanel,
  getTicketType,
  listTicketTypes,
  setTicketPanelMessage,
  setTicketTranscript,
} from '@cobot/db';
import { UserFacingError } from '@cobot/shared';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  OverwriteType,
  PermissionFlagsBits,
} from 'discord.js';

import { botFooter, code, infoEmbed, successEmbed } from '../lib/embeds';
import { memberVars, templateToMessage } from '../lib/template';
import { childLogger } from '../logger';
import {
  buildTranscriptFiles,
  collectMessages,
  transcriptMeta,
} from './transcript';

import type { ConfigService } from './config';
import type { Db, Ticket, TicketType } from '@cobot/db';
import type { MessageTemplate, TicketsConfig } from '@cobot/shared';
import type {
  BaseMessageOptions,
  Guild,
  GuildMember,
  GuildTextBasedChannel,
  OverwriteResolvable,
  TextChannel,
} from 'discord.js';

const log = childLogger('tickets');

/** Prefixo do `custom_id` de todo componente de ticket. */
export const TICKET_PREFIX = 'ticket';
export const TICKET_CLOSE_MODAL_ID = `${TICKET_PREFIX}:close-modal`;
export const TICKET_CLOSE_REASON_FIELD = 'reason';
/** Tempo entre o aviso de fechamento e o canal sumir (PRD §5.5). */
export const TICKET_DELETE_DELAY_MS = 10_000;
/** Nome de canal no Discord vai até 100 caracteres. */
export const MAX_CHANNEL_NAME_LENGTH = 100;

export function ticketOpenButtonId(typeId: string): string {
  return `${TICKET_PREFIX}:open:${typeId}`;
}

const DEFAULT_OPENING: MessageTemplate = {
  content:
    'Descreva seu pedido com o máximo de detalhes. A equipe responde por aqui.',
};

/**
 * Nome de canal a partir do `naming_pattern`. Aceita `{number}`, `{user}` e
 * `{type}` (PRD §5.5) e devolve algo que o Discord aceita: minúsculo, sem
 * acento e sem caractere que ele recusaria.
 */
export function renderChannelName(
  pattern: string,
  vars: { number: number; user: string; type: string },
): string {
  const filled = pattern
    .replaceAll('{number}', String(vars.number))
    .replaceAll('{user}', vars.user)
    .replaceAll('{type}', vars.type);

  const slug = filled
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_CHANNEL_NAME_LENGTH);

  return slug || `ticket-${vars.number}`;
}

/** Limite efetivo do tipo, com o default da config como fallback. */
export function openLimitFor(type: TicketType, config: TicketsConfig): number {
  return type.maxOpenPerUser ?? config.maxOpenPerUserDefault;
}

/** Botões da mensagem de abertura, dentro do canal do ticket. */
export function ticketControls(): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${TICKET_PREFIX}:claim`)
        .setLabel('ASSUMIR')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${TICKET_PREFIX}:close`)
        .setLabel('FECHAR')
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

/** Overwrites do canal: ninguém vê além do autor, do suporte e do bot. */
export function ticketOverwrites(
  guild: Guild,
  userId: string,
  supportRoleIds: readonly string[],
): OverwriteResolvable[] {
  const member = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.EmbedLinks,
  ];

  const overwrites: OverwriteResolvable[] = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: userId, allow: member, type: OverwriteType.Member },
  ];
  for (const roleId of new Set(supportRoleIds)) {
    overwrites.push({ id: roleId, allow: member, type: OverwriteType.Role });
  }
  const me = guild.members.me;
  if (me) {
    overwrites.push({
      id: me.id,
      allow: [...member, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages],
      type: OverwriteType.Member,
    });
  }
  return overwrites;
}

export interface TicketsDeps {
  db: Db;
  config: ConfigService;
}

export interface OpenResult {
  ticket: Ticket;
  channel: GuildTextBasedChannel;
}

/** Abertura, gestão e fechamento de tickets (PRD §5.5). */
export class TicketService {
  constructor(private readonly deps: TicketsDeps) {}

  /** Config do módulo; lança se ele estiver desligado. */
  async requireConfig(guildId: string): Promise<TicketsConfig> {
    const config = await this.deps.config.get(guildId, 'tickets');
    if (!config.enabled) {
      throw new UserFacingError('O módulo de tickets está desligado neste servidor.', {
        code: 'MODULE_DISABLED',
      });
    }
    return config;
  }

  /** O ticket do canal onde o comando/botão foi usado. */
  async requireTicketFor(channelId: string): Promise<Ticket> {
    const ticket = await getTicketByChannel(this.deps.db, channelId);
    if (!ticket || ticket.status !== 'open') {
      throw new UserFacingError('Este canal não é um ticket aberto.', { code: 'NOT_A_TICKET' });
    }
    return ticket;
  }

  /** Mensagem do painel de abertura, com um botão por tipo oferecido. */
  async panelMessage(guild: Guild, panelId: string): Promise<BaseMessageOptions> {
    const panel = await getTicketPanel(this.deps.db, guild.id, panelId);
    if (!panel) throw new UserFacingError('Painel não encontrado.', { code: 'PANEL_NOT_FOUND' });

    const types = await listTicketTypes(this.deps.db, guild.id);
    const offered = types.filter((type) => panel.typeIds.includes(type.id));
    const settings = await this.deps.config.getSettings(guild.id);

    const body = templateToMessage(panel.content, {}, { embedColor: settings.embedColor, guild });
    return {
      ...body,
      components:
        offered.length === 0
          ? []
          : [
              new ActionRowBuilder<ButtonBuilder>().addComponents(
                offered.slice(0, 5).map((type) =>
                  new ButtonBuilder()
                    .setCustomId(ticketOpenButtonId(type.id))
                    .setLabel(type.name.slice(0, 80).toUpperCase())
                    .setStyle(ButtonStyle.Primary),
                ),
              ),
            ],
    };
  }

  /** Publica (ou reedita) o painel de abertura num canal. */
  async publishPanel(guild: Guild, panelId: string, channelId?: string): Promise<string> {
    const panel = await getTicketPanel(this.deps.db, guild.id, panelId);
    if (!panel) throw new UserFacingError('Painel não encontrado.', { code: 'PANEL_NOT_FOUND' });

    const targetId = channelId ?? panel.channelId;
    const channel = await guild.channels.fetch(targetId).catch(() => null);
    if (!channel?.isTextBased()) {
      throw new UserFacingError('Não consigo publicar nesse canal.', { code: 'BAD_CHANNEL' });
    }

    const body = await this.panelMessage(guild, panelId);
    const existing =
      panel.messageId && panel.channelId === targetId
        ? await channel.messages.fetch(panel.messageId).catch(() => null)
        : null;
    const message = existing ? await existing.edit(body) : await channel.send(body);

    await setTicketPanelMessage(this.deps.db, panel.id, targetId, message.id);
    return message.id;
  }

  /**
   * Abre um ticket para `member`. O canal nasce antes da linha no banco (o
   * `channel_id` é obrigatório) e é renomeado depois, quando o padrão usa
   * `{number}` — o número só é reservado no `INSERT`.
   */
  async open(member: GuildMember, typeId: string): Promise<OpenResult> {
    const guild = member.guild;
    const config = await this.requireConfig(guild.id);

    const type = await getTicketType(this.deps.db, guild.id, typeId);
    if (!type) {
      throw new UserFacingError('Este tipo de ticket não existe mais.', { code: 'TYPE_NOT_FOUND' });
    }

    const limit = openLimitFor(type, config);
    const open = await countOpenTickets(this.deps.db, guild.id, member.id);
    if (open >= limit) {
      throw new UserFacingError(
        limit === 1
          ? 'Você já tem um ticket aberto. Feche-o antes de abrir outro.'
          : `Você já tem ${open} tickets abertos (máx. ${limit}).`,
        { code: 'TICKET_LIMIT' },
      );
    }

    const pattern = type.namingPattern ?? config.namingPattern;
    const channel = await this.createChannel(member, type, config, pattern);

    let ticket: Ticket;
    try {
      ticket = await createTicket(this.deps.db, {
        guildId: guild.id,
        typeId: type.id,
        userId: member.id,
        channelId: channel.id,
      });
    } catch (error) {
      // Sem a linha o ticket não existe: o canal órfão só confundiria.
      await channel.delete('Falha ao registrar o ticket').catch(() => null);
      throw error;
    }

    const finalName = renderChannelName(pattern, {
      number: ticket.number,
      user: member.user.username,
      type: type.name,
    });
    if (channel.name !== finalName) {
      await channel.setName(finalName).catch((error: unknown) => {
        log.warn({ err: error, ticketId: ticket.id }, 'não foi possível renomear o canal');
      });
    }

    await this.sendOpening(channel, member, type, ticket);
    await this.notifyLog(guild, config, {
      title: 'Ticket aberto',
      description: `${member} abriu o ticket #${ticket.number} em ${channel}.`,
      fields: [
        { name: 'Tipo', value: type.name, inline: true },
        { name: 'Autor', value: code(member.id), inline: true },
      ],
    });

    return { ticket, channel };
  }

  private async createChannel(
    member: GuildMember,
    type: TicketType,
    config: TicketsConfig,
    pattern: string,
  ): Promise<GuildTextBasedChannel> {
    const guild = member.guild;
    // Nome provisório: o número definitivo só existe depois do `INSERT`.
    const provisional = renderChannelName(pattern, {
      number: 0,
      user: member.user.username,
      type: type.name,
    });

    if (config.useThreads) {
      const parent = await guild.channels.fetch(type.categoryId).catch(() => null);
      if (parent?.type !== ChannelType.GuildText) {
        throw new UserFacingError(
          'Com tickets em thread, o tipo precisa apontar para um canal de texto.',
          { code: 'BAD_TICKET_PARENT' },
        );
      }
      const thread = await (parent as TextChannel).threads.create({
        name: provisional,
        type: ChannelType.PrivateThread,
        invitable: false,
        reason: `Ticket de ${member.user.tag}`,
      });
      await thread.members.add(member.id).catch(() => null);
      return thread;
    }

    return guild.channels.create({
      name: provisional,
      type: ChannelType.GuildText,
      parent: type.categoryId,
      permissionOverwrites: ticketOverwrites(guild, member.id, type.supportRoleIds),
      reason: `Ticket de ${member.user.tag}`,
    });
  }

  private async sendOpening(
    channel: GuildTextBasedChannel,
    member: GuildMember,
    type: TicketType,
    ticket: Ticket,
  ): Promise<void> {
    const settings = await this.deps.config.getSettings(member.guild.id);
    const body = templateToMessage(
      type.openingMessage ?? DEFAULT_OPENING,
      memberVars(member),
      { embedColor: settings.embedColor, user: member.user, guild: member.guild },
    );

    const mentions = [`<@${member.id}>`, ...type.supportRoleIds.map((id) => `<@&${id}>`)].join(' ');
    const message = await channel.send({
      ...body,
      content: [mentions, body.content].filter(Boolean).join('\n'),
      components: ticketControls(),
      allowedMentions: { users: [member.id], roles: [...type.supportRoleIds] },
    });
    await message.pin().catch(() => null);

    log.info(
      { guildId: member.guild.id, ticketId: ticket.id, number: ticket.number },
      'ticket aberto',
    );
  }

  /** `null` quando alguém do suporte já tinha assumido. */
  async claim(ticket: Ticket, actorId: string): Promise<Ticket | null> {
    return claimTicket(this.deps.db, ticket.id, actorId);
  }

  /**
   * Dá (ou tira) acesso ao canal do ticket. Em thread é entrar/sair da thread;
   * em canal é um overwrite de membro.
   */
  async setParticipant(
    channel: GuildTextBasedChannel,
    member: GuildMember,
    included: boolean,
  ): Promise<void> {
    if (channel.isThread()) {
      if (included) await channel.members.add(member.id);
      else await channel.members.remove(member.id);
      return;
    }
    if (included) {
      await channel.permissionOverwrites.edit(member.id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        AttachFiles: true,
        EmbedLinks: true,
      });
      return;
    }
    await channel.permissionOverwrites.delete(member.id, 'Removido do ticket');
  }

  /** Renomeia o canal, já passando pelo mesmo saneamento da abertura. */
  async rename(channel: GuildTextBasedChannel, name: string): Promise<string> {
    const safe = renderChannelName(name, { number: 0, user: '', type: '' });
    await channel.setName(safe, 'Ticket renomeado');
    return safe;
  }

  /**
   * Fecha: marca no banco, gera o transcript, manda ao canal de log e ao autor
   * e apaga o canal. O `closeTicket` vem primeiro para dois cliques em
   * "Fechar" não gerarem dois transcripts.
   */
  async close(
    channel: GuildTextBasedChannel,
    ticket: Ticket,
    input: { actorId: string; reason: string | null },
  ): Promise<Ticket> {
    const guild = channel.guild;
    const config = await this.deps.config.get(guild.id, 'tickets');

    const closed = await closeTicket(this.deps.db, ticket.id, {
      closedBy: input.actorId,
      reason: input.reason,
    });
    if (!closed) {
      throw new UserFacingError('Este ticket já está sendo fechado.', { code: 'ALREADY_CLOSING' });
    }

    const type = closed.typeId ? await getTicketType(this.deps.db, guild.id, closed.typeId) : null;
    const author = await guild.client.users.fetch(closed.userId).catch(() => null);
    const actor = await guild.client.users.fetch(input.actorId).catch(() => null);
    const settings = await this.deps.config.getSettings(guild.id);

    const meta = transcriptMeta(closed, {
      guildName: guild.name,
      typeName: type?.name ?? null,
      openedBy: author?.tag ?? closed.userId,
      closedBy: actor?.tag ?? input.actorId,
    });

    const messages = await collectMessages(channel).catch((error: unknown) => {
      log.warn({ err: error, ticketId: closed.id }, 'não foi possível ler o canal do ticket');
      return [];
    });
    const transcript = buildTranscriptFiles(meta, messages, {
      format: config.transcript.format,
      timezone: settings.timezone,
    });

    const summary = infoEmbed(
      {
        title: 'Ticket fechado',
        description: `Ticket #${closed.number} · ${type?.name ?? 'sem tipo'}`,
        fields: [
          { name: 'Autor', value: `<@${closed.userId}>`, inline: true },
          { name: 'Fechado por', value: `<@${input.actorId}>`, inline: true },
          { name: 'Mensagens', value: String(messages.length), inline: true },
          { name: 'Motivo', value: input.reason ?? '—' },
        ],
        footer: botFooter(`TICKET #${closed.number}`),
      },
      settings.embedColor,
    );

    const logged = await this.sendTranscript(guild, config, summary, transcript.files);
    if (logged) await setTicketTranscript(this.deps.db, closed.id, logged);

    if (config.transcript.sendToUser && author && !author.bot) {
      await author
        .send({ embeds: [summary], files: transcript.files })
        .catch(() => log.debug({ ticketId: closed.id }, 'DM do transcript não pôde ser enviada'));
    }

    await channel
      .send({
        embeds: [
          successEmbed({
            title: 'Ticket fechado',
            description: 'Este canal será apagado em 10 segundos.',
            footer: botFooter(`TICKET #${closed.number}`),
          }),
        ],
      })
      .catch(() => null);

    const timer = setTimeout(() => {
      void channel.delete(`Ticket #${closed.number} fechado`).catch((error: unknown) => {
        log.warn({ err: error, ticketId: closed.id }, 'não foi possível apagar o canal do ticket');
      });
    }, TICKET_DELETE_DELAY_MS);
    timer.unref();

    return { ...closed, transcriptUrl: logged };
  }

  /** URL do anexo publicado no canal de log — vira `transcript_url`. */
  private async sendTranscript(
    guild: Guild,
    config: TicketsConfig,
    embed: ReturnType<typeof infoEmbed>,
    files: ReturnType<typeof buildTranscriptFiles>['files'],
  ): Promise<string | null> {
    if (!config.logChannelId) return null;
    try {
      const channel = await guild.channels.fetch(config.logChannelId).catch(() => null);
      if (!channel?.isTextBased()) return null;
      const message = await channel.send({ embeds: [embed], files });
      return message.attachments.first()?.url ?? null;
    } catch (error) {
      log.warn({ err: error, guildId: guild.id }, 'não foi possível publicar o transcript');
      return null;
    }
  }

  /** Aviso curto no canal de log; nunca lança. */
  private async notifyLog(
    guild: Guild,
    config: TicketsConfig,
    input: Parameters<typeof infoEmbed>[0],
  ): Promise<void> {
    if (!config.logChannelId) return;
    try {
      const channel = await guild.channels.fetch(config.logChannelId).catch(() => null);
      if (!channel?.isTextBased()) return;
      const settings = await this.deps.config.getSettings(guild.id);
      await channel.send({ embeds: [infoEmbed(input, settings.embedColor)] });
    } catch (error) {
      log.warn({ err: error, guildId: guild.id }, 'não foi possível avisar o canal de log');
    }
  }
}
