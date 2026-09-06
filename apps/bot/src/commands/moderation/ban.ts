import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import {
  actionReply,
  addDeleteDaysOption,
  addDurationOption,
  addReasonOption,
  addUserOption,
  readDuration,
  requireGuild,
} from './shared';
import { defineCommand } from '../../lib/command';

const data = new SlashCommandBuilder()
  .setName('ban')
  .setDescription('Bane um usuário (com duração vira ban temporário)')
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers);
addUserOption(data, 'Quem será banido');
addReasonOption(data);
addDeleteDaysOption(data);
addDurationOption(data, 'Em branco = permanente. Ex.: 7d, 12h, 1h30m');

export default defineCommand({
  data,
  module: 'moderation',
  level: 'mod',
  defer: true,
  help: 'Bane um usuário; com duração, vira ban temporário.',
  async execute({ interaction, moderation, member }) {
    const target = interaction.options.getUser('usuario', true);
    const deleteMessageDays = interaction.options.getInteger('apagar_msgs') ?? undefined;

    const result = await moderation.ban({
      guild: requireGuild(interaction),
      target,
      actor: member,
      reason: interaction.options.getString('motivo') ?? undefined,
      durationMs: readDuration(interaction),
      deleteMessageDays,
    });

    await interaction.editReply(actionReply(result));
  },
});
