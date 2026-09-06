import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { actionReply, addReasonOption, addUserOption, requireGuild } from './shared';
import { defineCommand } from '../../lib/command';

const data = new SlashCommandBuilder()
  .setName('kick')
  .setDescription('Expulsa um usuário do servidor')
  .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers);
addUserOption(data, 'Quem será expulso');
addReasonOption(data);

export default defineCommand({
  data,
  module: 'moderation',
  level: 'mod',
  defer: true,
  help: 'Expulsa um usuário (ele pode voltar por convite).',
  async execute({ interaction, moderation, member }) {
    const result = await moderation.kick({
      guild: requireGuild(interaction),
      target: interaction.options.getUser('usuario', true),
      actor: member,
      reason: interaction.options.getString('motivo') ?? undefined,
    });

    await interaction.editReply(actionReply(result));
  },
});
