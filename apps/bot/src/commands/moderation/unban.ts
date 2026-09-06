import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { actionReply, addReasonOption, fetchUserById, requireGuild } from './shared';
import { defineCommand } from '../../lib/command';

const data = new SlashCommandBuilder()
  .setName('unban')
  .setDescription('Remove o banimento de um usuário')
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
  .addStringOption((option) =>
    option
      .setName('user_id')
      .setDescription('ID do usuário banido (ele não está mais no servidor)')
      .setRequired(true),
  );
addReasonOption(data);

export default defineCommand({
  data,
  module: 'moderation',
  level: 'mod',
  defer: true,
  help: 'Remove o banimento de um usuário pelo ID.',
  async execute({ interaction, moderation, member }) {
    const target = await fetchUserById(interaction, interaction.options.getString('user_id', true));

    const result = await moderation.unban({
      guild: requireGuild(interaction),
      target,
      actor: member,
      reason: interaction.options.getString('motivo') ?? undefined,
    });

    await interaction.editReply(actionReply(result));
  },
});
