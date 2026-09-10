import {
  formatDuration,
  MAX_REASON_LENGTH,
  MINUTE_MS,
  parseDuration,
  UserFacingError,
} from '@goodbot/shared';
import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  LabelBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

import { actionReply, requireGuild } from './shared';
import { defineUserContextCommand } from '../../lib/command';

import type { UserContextCommandContext } from '../../lib/command';
import type { ActionResult } from '../../services/moderation';
import type { ModalSubmitInteraction } from 'discord.js';

/** Ações oferecidas no modal — as que fazem sentido a partir de um usuário. */
const ACTIONS = [
  { value: 'warn', label: 'Aviso', description: 'Registra um aviso e avisa por DM' },
  { value: 'timeout', label: 'Timeout', description: 'Silencia pelo tempo informado' },
  { value: 'kick', label: 'Kick', description: 'Expulsa do servidor' },
  { value: 'ban', label: 'Ban', description: 'Bane; com duração vira ban temporário' },
  { value: 'note', label: 'Anotação', description: 'Só no histórico, invisível ao alvo' },
] as const;

type PunishAction = (typeof ACTIONS)[number]['value'];

const VALID_ACTIONS = new Set<string>(ACTIONS.map((action) => action.value));

const MODAL_TIMEOUT_MS = 2 * MINUTE_MS;

export default defineUserContextCommand({
  data: new ContextMenuCommandBuilder()
    .setName('Punir…')
    .setType(ApplicationCommandType.User)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  module: 'moderation',
  level: 'mod',
  help: 'Abre um modal com ação, motivo e duração para punir o usuário.',
  // Sem `defer`: `showModal` exige a interação ainda não respondida — e o
  // `opensModal` desliga também o adiamento automático dos 2,5 s.
  opensModal: true,
  async execute(ctx) {
    const { interaction } = ctx;
    const guild = requireGuild(interaction);
    const target = interaction.targetUser;

    // A hierarquia é checada de novo ao aplicar; aqui é só para não abrir um
    // modal que já se sabe que vai falhar.
    await ctx.moderation.assertCanAct(guild, ctx.member, target);

    const config = await ctx.config.get(ctx.guildId, 'moderation');
    const customId = `punish:${interaction.id}`;

    await interaction.showModal(buildModal(customId, target.tag, config.defaultTimeoutMs));

    const submit = await interaction
      .awaitModalSubmit({
        time: MODAL_TIMEOUT_MS,
        filter: (modal) => modal.customId === customId && modal.user.id === interaction.user.id,
      })
      .catch(() => null);
    // Modal fechado sem enviar: não há interação pendente a responder.
    if (!submit) return;

    await submit.deferReply();
    try {
      const result = await apply(ctx, guild, submit);
      await submit.editReply(actionReply(result));
    } catch (error) {
      // O erro pertence à interação do modal, não à do menu — o handler
      // genérico não alcança esta aqui.
      const message =
        error instanceof UserFacingError
          ? error.message
          : 'Algo deu errado ao aplicar a punição. A equipe já foi avisada.';
      if (!(error instanceof UserFacingError)) {
        ctx.logger.error({ err: error, command: 'punir' }, 'falha no menu de contexto');
      }
      await submit.editReply({ content: `⚠ ${message}` });
    }
  },
});

function buildModal(customId: string, targetTag: string, defaultTimeoutMs: number): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(`Punir ${targetTag}`.slice(0, 45))
    .setLabelComponents(
      new LabelBuilder().setLabel('Ação').setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId('acao')
          .setPlaceholder('O que fazer com este usuário')
          .addOptions(
            ACTIONS.map((action) => ({
              label: action.label,
              value: action.value,
              description: action.description,
            })),
          ),
      ),
      new LabelBuilder()
        .setLabel('Motivo')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('motivo')
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(MAX_REASON_LENGTH)
            .setRequired(false)
            .setPlaceholder('Em branco usa o motivo padrão da configuração'),
        ),
      new LabelBuilder()
        .setLabel('Duração')
        .setDescription(
          `Só para timeout e ban temporário. Ex.: 10m, 2h, 7d. ` +
            `Timeout em branco = ${formatDuration(defaultTimeoutMs, { style: 'long' })}.`,
        )
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('duracao')
            .setStyle(TextInputStyle.Short)
            .setMaxLength(32)
            .setRequired(false),
        ),
    );
}

async function apply(
  ctx: UserContextCommandContext,
  guild: ReturnType<typeof requireGuild>,
  submit: ModalSubmitInteraction,
): Promise<ActionResult> {
  const selected = submit.fields.getStringSelectValues('acao')[0];
  if (!selected || !VALID_ACTIONS.has(selected)) {
    throw new UserFacingError('Escolha uma ação no menu.', { code: 'NO_ACTION' });
  }
  const action = selected as PunishAction;

  const request = {
    guild,
    target: ctx.interaction.targetUser,
    actor: ctx.member,
    reason: submit.fields.getTextInputValue('motivo').trim() || undefined,
    source: 'context' as const,
  };
  const durationMs = readModalDuration(submit.fields.getTextInputValue('duracao'));

  switch (action) {
    case 'warn':
      return ctx.moderation.warn(request);
    case 'timeout':
      return ctx.moderation.timeout({ ...request, durationMs });
    case 'kick':
      return ctx.moderation.kick(request);
    case 'ban':
      return ctx.moderation.ban({ ...request, durationMs });
    default:
      return ctx.moderation.note(request);
  }
}

function readModalDuration(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const ms = parseDuration(trimmed);
  if (ms === null) {
    throw new UserFacingError(
      `Duração inválida: \`${trimmed}\`. Use algo como \`30m\`, \`2h\`, \`7d\` ou \`1h30m\`.`,
      { code: 'BAD_DURATION' },
    );
  }
  return ms;
}
