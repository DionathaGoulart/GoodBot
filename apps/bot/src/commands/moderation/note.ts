import { MAX_REASON_LENGTH } from '@goodbot/shared';
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { addUserOption, requireGuild } from './shared';
import { caseEmbed } from '../../lib/case-embed';
import { defineCommand } from '../../lib/command';

const data = new SlashCommandBuilder()
  .setName('note')
  .setDescription('Anota algo sobre um usuário — invisível para ele')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);
addUserOption(data, 'Sobre quem é a anotação');
data.addStringOption((option) =>
  option
    .setName('texto')
    .setDescription('O que registrar no histórico')
    .setMaxLength(MAX_REASON_LENGTH)
    .setRequired(true),
);

export default defineCommand({
  data,
  module: 'moderation',
  level: 'mod',
  defer: true,
  // A anotação é invisível ao alvo (PRD §5.1); a resposta também.
  ephemeral: true,
  help: 'Anotação interna sobre um usuário, sem DM.',
  async execute({ interaction, moderation, member }) {
    const result = await moderation.note({
      guild: requireGuild(interaction),
      target: interaction.options.getUser('usuario', true),
      actor: member,
      reason: interaction.options.getString('texto', true),
    });

    await interaction.editReply({ embeds: [caseEmbed(result.case)] });
  },
});
