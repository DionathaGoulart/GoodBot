import {
  clearPanelMessage,
  clearTicketPanelMessage,
  getPanel,
  getTicket,
  getTicketPanel,
} from '@goodbot/db';
import {
  CloseTicketInputSchema,
  MessageTemplateSchema,
  DeleteMessageInputSchema,
  MESSAGE_HISTORY_LIMIT,
  MessageHistoryQuerySchema,
  PublishPanelInputSchema,
  SendMessageInputSchema,
  UserFacingError,
} from '@goodbot/shared';
import { PermissionFlagsBits } from 'discord.js';
import { Hono } from 'hono';

import { memberVars, templateToMessage } from '../../lib/template';
import { requireActor, requireBotMember } from '../actor';
import { forbidden, notFound } from '../errors';
import {
  MESSAGE_LIMIT_PER_MINUTE,
  createRateLimiter,
  guildRateLimit,
} from '../middleware/rate-limit';
import { validate } from '../validate';

import type { ApiDeps, ApiEnv } from '../context';
import type {
  AllowedMentions,
  ChannelMessageSummary,
  CloseTicketResult,
  MessageTemplate,
  SendMessageResult,
} from '@goodbot/shared';
import type {
  Embed,
  Guild,
  GuildTextBasedChannel,
  Message,
  MessageMentionOptions,
  MessageMentionTypes,
} from 'discord.js';

/** Quanto do conteúdo o painel mostra na lista; o resto fica no Discord. */
const CONTENT_PREVIEW_LENGTH = 500;

/**
 * `AllowedMentions` do painel virando o payload do discord.js. O que não foi
 * marcado simplesmente não entra em `parse` — é assim que o padrão continua
 * sendo "não pinga ninguém" mesmo se um dia alguém esquecer o campo.
 */
export function toMentionOptions(mentions: AllowedMentions): MessageMentionOptions {
  const parse: MessageMentionTypes[] = [];
  if (mentions.users) parse.push('users');
  if (mentions.roles) parse.push('roles');
  if (mentions.everyone) parse.push('everyone');
  return { parse };
}

/**
 * Editar mensagem alheia é impossível no Discord, mas a recusa precisa vir
 * daqui com um texto que o painel possa mostrar — senão o usuário recebe um
 * 500 opaco do `edit()`.
 */
export function assertBotAuthored(message: { author: { id: string } }, botId: string): void {
  if (message.author.id === botId) return;
  throw new UserFacingError('Só dá para editar mensagens enviadas pelo bot.', {
    code: 'NOT_BOT_MESSAGE',
  });
}

/**
 * `@everyone` é o único campo do editor que acorda o servidor inteiro, então
 * ele não basta estar marcado: quem clicou precisa ter a permissão no próprio
 * Discord (PRD §9.2).
 */
export function assertCanMentionEveryone(actor: {
  permissions: { has: (flag: bigint) => boolean };
}): void {
  if (actor.permissions.has(PermissionFlagsBits.MentionEveryone)) return;
  throw forbidden('Você não tem permissão para mencionar @everyone.', 'CANNOT_MENTION_EVERYONE');
}

/**
 * A mensagem relida como `MessageTemplate`, para o editor do painel abrir com
 * o que já está publicado. O que não couber no schema volta `null` em vez de
 * abrir o editor com metade da mensagem.
 */
export function toTemplate(message: {
  content: string;
  embeds: readonly Embed[];
}): MessageTemplate | null {
  const embed = message.embeds.length === 1 ? message.embeds[0] : undefined;
  const parsed = MessageTemplateSchema.safeParse({
    ...(message.content ? { content: message.content } : {}),
    ...(embed
      ? {
          embed: {
            ...(embed.title ? { title: embed.title } : {}),
            ...(embed.description ? { description: embed.description } : {}),
            ...(embed.url ? { url: embed.url } : {}),
            color: embed.color,
            fields: embed.fields.map((field) => ({
              name: field.name,
              value: field.value,
              inline: field.inline ?? false,
            })),
            ...(embed.footer?.text ? { footer: embed.footer.text } : {}),
            ...(embed.thumbnail?.url ? { thumbnail: embed.thumbnail.url } : {}),
            ...(embed.image?.url ? { image: embed.image.url } : {}),
            timestamp: embed.timestamp !== null,
          },
        }
      : {}),
  });
  return parsed.success ? parsed.data : null;
}

function toMessageSummary(message: Message<true>, botId: string): ChannelMessageSummary {
  return {
    id: message.id,
    channelId: message.channelId,
    author: {
      id: message.author.id,
      username: message.author.username,
      avatarUrl: message.author.displayAvatarURL(),
      bot: message.author.bot,
    },
    content: message.content.slice(0, CONTENT_PREVIEW_LENGTH),
    template: toTemplate(message),
    embedCount: message.embeds.length,
    attachmentCount: message.attachments.size,
    editable: message.author.id === botId,
    createdAt: message.createdAt.toISOString(),
    editedAt: message.editedAt?.toISOString() ?? null,
    url: message.url,
  };
}

async function requireTextChannel(guild: Guild, channelId: string): Promise<GuildTextBasedChannel> {
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) {
    throw new UserFacingError('Não consigo publicar nesse canal.', { code: 'BAD_CHANNEL' });
  }
  return channel;
}

/** A mensagem pedida, com o 404 do painel em vez do erro cru do Discord. */
async function fetchMessage(
  channel: GuildTextBasedChannel,
  messageId: string,
): Promise<Message<true>> {
  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) throw notFound('Mensagem não encontrada.', 'MESSAGE_NOT_FOUND');
  return message;
}

/**
 * Apaga a mensagem publicada de um painel. Mensagem já sumida não é erro: o
 * objetivo é o painel voltar a ser rascunho, e ele volta de qualquer jeito.
 */
async function deletePublished(
  guild: Guild,
  channelId: string,
  messageId: string | null,
): Promise<void> {
  if (!messageId) return;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) return;
  await channel.messages.delete(messageId).catch(() => null);
}

export function createMessageRoutes(deps: ApiDeps): Hono<ApiEnv> {
  // Escrever no canal tem balde próprio, bem menor que o das rotas de config
  // (PRD §7.4): o painel não pode virar um caminho para floodar canal.
  const writeLimiter = createRateLimiter({ limit: MESSAGE_LIMIT_PER_MINUTE });

  return (
    new Hono<ApiEnv>()
      /**
       * Envia ou edita uma mensagem gerenciada pelo painel. É o que o botão
       * "testar" da tela de boas-vindas usa (o template ainda nem foi salvo,
       * então ele viaja no corpo) e também o compositor de `/mensagens`.
       */
      .post(
        '/messages',
        guildRateLimit(writeLimiter),
        validate('json', SendMessageInputSchema),
        async (c) => {
          const input = c.req.valid('json');
          const guild = c.get('guild');
          const channel = await requireTextChannel(guild, input.channelId);
          const settings = await deps.config.getSettings(guild.id);

          // Preview não tem um membro que "entrou": o próprio bot serve de
          // exemplo para `{user}`, `{mention}` e companhia renderizarem.
          const sample = requireBotMember(guild);

          if (input.allowedMentions.everyone) {
            // O schema garante o `actorId` quando `everyone` está marcado.
            const actor = await requireActor(deps, guild, input.actorId ?? '', 'admin');
            assertCanMentionEveryone(actor);
          }

          const body = templateToMessage(input.template, memberVars(sample), {
            embedColor: settings.embedColor,
            user: sample.user,
            guild,
            allowedMentions: toMentionOptions(input.allowedMentions),
          });

          if (!input.messageId) {
            const sent = await channel.send({
              ...body,
              ...(input.replyToId
                ? {
                    reply: { messageReference: input.replyToId, failIfNotExists: false },
                  }
                : {}),
            });
            const created: SendMessageResult = { channelId: channel.id, messageId: sent.id };
            return c.json(created);
          }

          const existing = await fetchMessage(channel, input.messageId);
          assertBotAuthored(existing, sample.id);
          const edited = await existing.edit(body);

          const result: SendMessageResult = { channelId: channel.id, messageId: edited.id };
          return c.json(result);
        },
      )

      /**
       * As últimas mensagens do canal, para o painel escolher o que editar ou
       * apagar. Vem tudo, não só o do bot: quem modera precisa enxergar a
       * conversa em volta para saber se editar aquela mensagem faz sentido.
       */
      .get(
        '/channels/:channelId/messages',
        validate('query', MessageHistoryQuerySchema),
        async (c) => {
          const { limit } = c.req.valid('query');
          const guild = c.get('guild');
          const botId = requireBotMember(guild).id;
          const channel = await requireTextChannel(guild, c.req.param('channelId'));

          const messages = await channel.messages.fetch({
            limit: Math.min(limit, MESSAGE_HISTORY_LIMIT),
          });
          const summaries = [...messages.values()]
            .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
            .map((message) => toMessageSummary(message, botId));
          return c.json(summaries);
        },
      )

      /**
       * Apaga uma mensagem pelo painel. Devolve o resumo do que foi apagado
       * porque é ele que a auditoria guarda — depois do `delete()` não há mais
       * onde buscar o conteúdo.
       */
      .delete(
        '/channels/:channelId/messages/:messageId',
        guildRateLimit(writeLimiter),
        validate('json', DeleteMessageInputSchema),
        async (c) => {
          const input = c.req.valid('json');
          const guild = c.get('guild');
          const botId = requireBotMember(guild).id;
          await requireActor(deps, guild, input.actorId, 'admin');

          const channel = await requireTextChannel(guild, c.req.param('channelId'));
          const message = await fetchMessage(channel, c.req.param('messageId'));
          const summary = toMessageSummary(message, botId);
          await message.delete();
          return c.json(summary);
        },
      )

      .post(
        '/reaction-roles/:panelId/publish',
        validate('json', PublishPanelInputSchema),
        async (c) => {
          const { channelId } = c.req.valid('json');
          const guild = c.get('guild');
          const panel = await deps.reactionRoles.publishPanel(
            guild,
            c.req.param('panelId'),
            channelId,
          );
          const result: SendMessageResult = {
            channelId: panel.channelId,
            messageId: panel.messageId ?? '',
          };
          return c.json(result);
        },
      )

      .post(
        '/tickets/panels/:panelId/publish',
        validate('json', PublishPanelInputSchema),
        async (c) => {
          const { channelId } = c.req.valid('json');
          const guild = c.get('guild');
          const panelId = c.req.param('panelId');
          const messageId = await deps.tickets.publishPanel(guild, panelId, channelId);

          const panel = await getTicketPanel(deps.db, guild.id, panelId);
          const result: SendMessageResult = {
            channelId: channelId ?? panel?.channelId ?? '',
            messageId,
          };
          return c.json(result);
        },
      )

      .post('/reaction-roles/:panelId/unpublish', async (c) => {
        const guild = c.get('guild');
        const panelId = c.req.param('panelId');
        const panel = await getPanel(deps.db, guild.id, panelId);
        if (!panel) throw notFound('Painel não encontrado.', 'PANEL_NOT_FOUND');

        await deletePublished(guild, panel.channelId, panel.messageId);
        await clearPanelMessage(deps.db, panelId);
        return c.json({ ok: true as const });
      })

      .post('/tickets/panels/:panelId/unpublish', async (c) => {
        const guild = c.get('guild');
        const panelId = c.req.param('panelId');
        const panel = await getTicketPanel(deps.db, guild.id, panelId);
        if (!panel) throw notFound('Painel não encontrado.', 'PANEL_NOT_FOUND');

        await deletePublished(guild, panel.channelId, panel.messageId);
        await clearTicketPanelMessage(deps.db, panelId);
        return c.json({ ok: true as const });
      })

      /**
       * Botão `FECHAR` da tabela de tickets. Passa pelo `TicketService` para o
       * transcript, o log e o apagamento do canal serem idênticos ao do botão
       * dentro do Discord.
       */
      .post('/tickets/:ticketId/close', validate('json', CloseTicketInputSchema), async (c) => {
        const input = c.req.valid('json');
        const guild = c.get('guild');
        const ticketId = Number(c.req.param('ticketId'));
        if (!Number.isInteger(ticketId)) {
          throw new UserFacingError('Ticket inválido.', { code: 'BAD_TICKET' });
        }

        const ticket = await getTicket(deps.db, guild.id, ticketId);
        if (!ticket) throw notFound('Ticket não encontrado.', 'TICKET_NOT_FOUND');
        if (ticket.status === 'closed') {
          throw new UserFacingError('Este ticket já está fechado.', { code: 'ALREADY_CLOSED' });
        }

        const channel = await requireTextChannel(guild, ticket.channelId);
        const closed = await deps.tickets.close(channel, ticket, {
          actorId: input.actorId,
          reason: input.reason,
        });

        const result: CloseTicketResult = {
          ticketId: closed.id,
          transcriptUrl: closed.transcriptUrl,
        };
        return c.json(result);
      })
  );
}
