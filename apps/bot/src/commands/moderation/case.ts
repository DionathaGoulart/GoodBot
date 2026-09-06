import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { deleteCase, editCaseReason, viewCase } from './case-actions';
import { addReasonOption } from './shared';
import { defineCommand } from '../../lib/command';

import type { SlashCommandSubcommandBuilder } from 'discord.js';

/** Opção `numero` — o caso é sempre referido pelo número da guild, não pelo id. */
function addCaseNumberOption(sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return sub.addIntegerOption((option) =>
    option
      .setName('numero')
      .setDescription('Número do caso (o `#12` do rodapé)')
      .setMinValue(1)
      .setRequired(true),
  );
}

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('case')
    .setDescription('Consulta e edição de casos de moderação')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand((sub) =>
      addCaseNumberOption(sub.setName('view').setDescription('Mostra um caso')),
    )
    .addSubcommand((sub) =>
      addReasonOption(
        addCaseNumberOption(sub.setName('edit').setDescription('Edita o motivo de um caso')),
        true,
      ),
    )
    .addSubcommand((sub) =>
      addCaseNumberOption(
        sub.setName('delete').setDescription('Apaga um caso do histórico (só administração)'),
      ),
    ),
  module: 'moderation',
  level: 'mod',
  defer: true,
  ephemeral: true,
  help: 'Ver, editar o motivo ou apagar um caso.',
  async execute(ctx) {
    const { interaction } = ctx;
    const caseNumber = interaction.options.getInteger('numero', true);

    switch (interaction.options.getSubcommand()) {
      case 'view':
        return viewCase(ctx, caseNumber);
      case 'edit':
        return editCaseReason(ctx, caseNumber, interaction.options.getString('motivo', true));
      default:
        return deleteCase(ctx, caseNumber);
    }
  },
});
