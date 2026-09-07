import {
  clearPanelMessage,
  clearTicketPanelMessage,
  getPanel,
  getTicket,
  getTicketPanel,
} from '@cobot/db';
import {
  CloseTicketInputSchema,
  PublishPanelInputSchema,
  SendMessageInputSchema,
  UserFacingError,
} from '@cobot/shared';
import { Hono } from 'hono';

import { memberVars, templateToMessage } from '../../lib/template';
import { notFound } from '../errors';
import { validate } from '../validate';

import type { ApiDeps, ApiEnv } from '../context';
import type { CloseTicketResult, SendMessageResult } from '@cobot/shared';
import type { Guild, GuildTextBasedChannel } from 'discord.js';

async function requireTextChannel(guild: Guild, channelId: string): Promise<GuildTextBasedChannel> {
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) {
    throw new UserFacingError('Não consigo publicar nesse canal.', { code: 'BAD_CHANNEL' });
  }
  return channel;
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
  return (
    new Hono<ApiEnv>()
      /**
       * Envia ou edita uma mensagem gerenciada pelo painel. É o que o botão
       * "testar" da tela de boas-vindas usa: o template ainda nem foi salvo,
       * então ele viaja no corpo.
       */
      .post('/messages', validate('json', SendMessageInputSchema), async (c) => {
        const input = c.req.valid('json');
        const guild = c.get('guild');
        const channel = await requireTextChannel(guild, input.channelId);
        const settings = await deps.config.getSettings(guild.id);

        // Preview não tem um membro que "entrou": o próprio bot serve de
        // exemplo para `{user}`, `{mention}` e companhia renderizarem.
        const sample = guild.members.me;
        if (!sample) throw notFound('O bot não está no servidor.', 'BOT_NOT_MEMBER');

        const body = templateToMessage(input.template, memberVars(sample), {
          embedColor: settings.embedColor,
          user: sample.user,
          guild,
        });

        const message = input.messageId
          ? await (await channel.messages.fetch(input.messageId)).edit(body)
          : await channel.send(body);

        const result: SendMessageResult = { channelId: channel.id, messageId: message.id };
        return c.json(result);
      })

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
