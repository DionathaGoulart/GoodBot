import { MAX_REASON_LENGTH } from '@cobot/shared';
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { editCaseReason } from './case-actions';
import { defineCommand } from '../../lib/command';

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('reason')
    .setDescription('Atalho de /case edit: troca o motivo de um caso')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addIntegerOption((option) =>
      option.setName('numero').setDescription('Número do caso').setMinValue(1).setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('motivo')
        .setDescription('Novo motivo')
        .setMaxLength(MAX_REASON_LENGTH)
        .setRequired(true),
    ),
  module: 'moderation',
  level: 'mod',
  defer: true,
  ephemeral: true,
  help: 'Troca o motivo de um caso já criado.',
  execute(ctx) {
    return editCaseReason(
      ctx,
      ctx.interaction.options.getInteger('numero', true),
      ctx.interaction.options.getString('motivo', true),
    );
  },
});
