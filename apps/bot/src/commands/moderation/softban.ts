import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import {
  actionReply,
  addDeleteDaysOption,
  addReasonOption,
  addUserOption,
  requireGuild,
} from './shared';
import { defineCommand } from '../../lib/command';

const data = new SlashCommandBuilder()
  .setName('softban')
  .setDescription('Bane e desbane na sequência, só para apagar as mensagens do usuário')
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers);
addUserOption(data, 'Quem levará o softban');
addReasonOption(data);
addDeleteDaysOption(data);

export default defineCommand({
  data,
  module: 'moderation',
  level: 'mod',
  defer: true,
  help: 'Ban + unban imediato: expulsa e apaga as mensagens recentes.',
  async execute({ interaction, moderation, member }) {
    const result = await moderation.softban({
      guild: requireGuild(interaction),
      target: interaction.options.getUser('usuario', true),
      actor: member,
      reason: interaction.options.getString('motivo') ?? undefined,
      deleteMessageDays: interaction.options.getInteger('apagar_msgs') ?? undefined,
    });

    await interaction.editReply(actionReply(result));
  },
});
