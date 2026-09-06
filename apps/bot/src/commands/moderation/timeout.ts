import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import {
  actionReply,
  addDurationOption,
  addReasonOption,
  addUserOption,
  readDuration,
  requireGuild,
} from './shared';
import { defineCommand } from '../../lib/command';

const data = new SlashCommandBuilder()
  .setName('timeout')
  .setDescription('Silencia um usuário pelo timeout nativo do Discord')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);
addUserOption(data, 'Quem será silenciado');
addDurationOption(data, 'Ex.: 10m, 2h, 7d. Máximo de 28 dias.', true);
addReasonOption(data);

export default defineCommand({
  data,
  module: 'moderation',
  level: 'mod',
  defer: true,
  help: 'Timeout nativo do Discord, até 28 dias.',
  async execute({ interaction, moderation, member }) {
    const result = await moderation.timeout({
      guild: requireGuild(interaction),
      target: interaction.options.getUser('usuario', true),
      actor: member,
      reason: interaction.options.getString('motivo') ?? undefined,
      durationMs: readDuration(interaction),
    });

    await interaction.editReply(actionReply(result));
  },
});
