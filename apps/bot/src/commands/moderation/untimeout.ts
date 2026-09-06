import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { actionReply, addReasonOption, addUserOption, requireGuild } from './shared';
import { defineCommand } from '../../lib/command';

const data = new SlashCommandBuilder()
  .setName('untimeout')
  .setDescription('Remove o timeout de um usuário')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);
addUserOption(data, 'Quem terá o timeout removido');
addReasonOption(data);

export default defineCommand({
  data,
  module: 'moderation',
  level: 'mod',
  defer: true,
  help: 'Devolve a voz a quem está em timeout.',
  async execute({ interaction, moderation, member }) {
    const result = await moderation.untimeout({
      guild: requireGuild(interaction),
      target: interaction.options.getUser('usuario', true),
      actor: member,
      reason: interaction.options.getString('motivo') ?? undefined,
    });

    await interaction.editReply(actionReply(result));
  },
});
