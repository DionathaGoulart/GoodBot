import { getTicketType } from '@goodbot/db';
import { isUserFacingError } from '@goodbot/shared';
import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

import { botFooter, successEmbed } from '../lib/embeds';
import { levelAtLeast, resolveLevel, toMemberLike } from '../services/permissions';
import {
  TICKET_CLOSE_MODAL_ID,
  TICKET_CLOSE_REASON_FIELD,
  TICKET_PREFIX,
} from '../services/tickets';

import type { BotContext } from '../lib/command';
import type { Ticket } from '@goodbot/db';
import type {
  ButtonInteraction,
  GuildMember,
  GuildTextBasedChannel,
  ModalSubmitInteraction,
  RepliableInteraction,
} from 'discord.js';

/** Motivo máximo no modal de fechamento (cabe num field de embed). */
const MAX_REASON_LENGTH = 500;

interface TicketScope {
  ticket: Ticket;
  channel: GuildTextBasedChannel;
  member: GuildMember;
  /** Autor do ticket, suporte do tipo ou moderação. */
  canManage: boolean;
}

/**
 * Contexto comum aos botões dentro do canal do ticket. `null` = já respondeu
 * ao usuário dizendo por que não dá para seguir.
 */
async function scopeFor(
  ctx: BotContext,
  interaction: RepliableInteraction,
): Promise<TicketScope | null> {
  const guildId = interaction.guildId;
  const member = interaction.member as GuildMember | null;
  const channel = interaction.channel;
  if (
    !guildId ||
    !member ||
    !('roles' in member) ||
    !channel?.isTextBased() ||
    channel.isDMBased()
  ) {
    await interaction.editReply({ content: 'Não consegui identificar este ticket.' });
    return null;
  }

  const ticket = await ctx.tickets.requireTicketFor(channel.id);
  const type = ticket.typeId ? await getTicketType(ctx.db, guildId, ticket.typeId) : null;
  const settings = await ctx.config.getSettings(guildId);
  const level = resolveLevel(toMemberLike(member), settings);

  const isSupport = (type?.supportRoleIds ?? []).some((id) => member.roles.cache.has(id));
  return {
    ticket,
    channel: channel as GuildTextBasedChannel,
    member,
    canManage: isSupport || levelAtLeast(level, 'mod') || ticket.userId === member.id,
  };
}

/** Modal do motivo, aberto quando `closeConfirm` está ligado. */
export function closeReasonModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(TICKET_CLOSE_MODAL_ID)
    .setTitle('Fechar ticket')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(TICKET_CLOSE_REASON_FIELD)
          .setLabel('Motivo do fechamento')
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(MAX_REASON_LENGTH)
          .setRequired(false),
      ),
    );
}

/** Botões `ticket:open:<typeId>`, `ticket:claim` e `ticket:close`. */
export async function handleTicketComponent(
  ctx: BotContext,
  interaction: ButtonInteraction,
): Promise<boolean> {
  const [prefix, action, argument] = interaction.customId.split(':');
  if (prefix !== TICKET_PREFIX || !action) return false;

  if (action === 'open') {
    if (!argument) return false;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await openFromPanel(ctx, interaction, argument);
    return true;
  }

  // O modal precisa da interação intacta: nada de `deferReply` antes dele.
  if (action === 'close') {
    const config = await ctx.tickets.requireConfig(interaction.guildId ?? '');
    if (config.closeConfirm) {
      await interaction.showModal(closeReasonModal());
      return true;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await closeFrom(ctx, interaction, null);
    return true;
  }

  if (action === 'claim') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await claimFrom(ctx, interaction);
    return true;
  }

  return false;
}

/** `ticket:close-modal` — o motivo digitado no modal. */
export async function handleTicketModal(
  ctx: BotContext,
  interaction: ModalSubmitInteraction,
): Promise<boolean> {
  if (interaction.customId !== TICKET_CLOSE_MODAL_ID) return false;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const reason = interaction.fields.getTextInputValue(TICKET_CLOSE_REASON_FIELD).trim();
  await closeFrom(ctx, interaction, reason || null);
  return true;
}

async function openFromPanel(
  ctx: BotContext,
  interaction: ButtonInteraction,
  typeId: string,
): Promise<void> {
  const member = interaction.member as GuildMember | null;
  if (!member || !('roles' in member)) {
    await interaction.editReply({ content: 'Não consegui ler seus dados. Tente de novo.' });
    return;
  }

  try {
    const { ticket, channel } = await ctx.tickets.open(member, typeId);
    await interaction.editReply({
      embeds: [
        successEmbed({
          title: 'Ticket aberto',
          description: `Seu ticket é ${channel}.`,
          footer: botFooter(`TICKET #${ticket.number}`),
        }),
      ],
    });
  } catch (error) {
    await replyFailure(ctx, interaction, error, 'não foi possível abrir o ticket');
  }
}

async function claimFrom(ctx: BotContext, interaction: ButtonInteraction): Promise<void> {
  try {
    const scope = await scopeFor(ctx, interaction);
    if (!scope) return;
    if (!scope.canManage) {
      await interaction.editReply({ content: 'Só a equipe de suporte pode assumir tickets.' });
      return;
    }

    const claimed = await ctx.tickets.claim(scope.ticket, scope.member.id);
    if (!claimed) {
      await interaction.editReply({
        content: `Este ticket já foi assumido por <@${scope.ticket.claimedBy ?? ''}>.`,
      });
      return;
    }

    await scope.channel
      .send({
        embeds: [
          successEmbed({
            title: 'Ticket assumido',
            description: `${scope.member} vai cuidar deste ticket.`,
            footer: botFooter(`TICKET #${claimed.number}`),
          }),
        ],
      })
      .catch(() => null);
    await interaction.editReply({ content: 'Ticket assumido.' });
  } catch (error) {
    await replyFailure(ctx, interaction, error, 'não foi possível assumir o ticket');
  }
}

async function closeFrom(
  ctx: BotContext,
  interaction: ButtonInteraction | ModalSubmitInteraction,
  reason: string | null,
): Promise<void> {
  try {
    const scope = await scopeFor(ctx, interaction);
    if (!scope) return;
    if (!scope.canManage) {
      await interaction.editReply({ content: 'Você não pode fechar este ticket.' });
      return;
    }

    await ctx.tickets.close(scope.channel, scope.ticket, {
      actorId: scope.member.id,
      reason,
    });
    await interaction.editReply({ content: 'Ticket fechado. O canal some em 10 segundos.' });
  } catch (error) {
    await replyFailure(ctx, interaction, error, 'não foi possível fechar o ticket');
  }
}

/** Erro de usuário vira o próprio texto; o resto vira log e mensagem genérica. */
async function replyFailure(
  ctx: BotContext,
  interaction: RepliableInteraction,
  error: unknown,
  message: string,
): Promise<void> {
  if (isUserFacingError(error)) {
    await interaction.editReply({ content: error.message });
    return;
  }
  ctx.logger.error({ err: error, guildId: interaction.guildId }, message);
  await interaction.editReply({ content: 'Algo deu errado. A equipe já foi avisada.' });
}
