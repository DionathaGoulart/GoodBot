import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { actionReply, addReasonOption, addUserOption, requireGuild } from './shared';
import { defineCommand } from '../../lib/command';

const data = new SlashCommandBuilder()
  .setName('warn')
  .setDescription('Registra um aviso e avisa o usuário por DM')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);
addUserOption(data, 'Quem receberá o aviso');
addReasonOption(data, true);

export default defineCommand({
  data,
  module: 'moderation',
  level: 'mod',
  defer: true,
  help: 'Aviso formal; pode disparar a escalada automática.',
  async execute({ interaction, moderation, member }) {
    const result = await moderation.warn({
      guild: requireGuild(interaction),
      target: interaction.options.getUser('usuario', true),
      actor: member,
      reason: interaction.options.getString('motivo', true),
    });

    await interaction.editReply(actionReply(result));
  },
});
