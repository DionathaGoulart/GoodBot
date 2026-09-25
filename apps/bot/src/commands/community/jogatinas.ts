import { SlashCommandBuilder } from 'discord.js';

import { MINE_LIMIT, mineText, squadsConfigOrFail } from '../../interactions/squads';
import { defineCommand } from '../../lib/command';

/** `/jogatinas`: atalho do MINHAS JOGATINAS (PRD §5.11). Efêmero, com os links. */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('jogatinas')
    .setDescription('Lista as jogatinas e os cards em que você está'),
  module: 'squads',
  level: 'member',
  defer: true,
  ephemeral: true,
  cooldown: 5,
  async execute(ctx) {
    await squadsConfigOrFail(ctx, ctx.guildId);
    const entries = await ctx.squadAgenda.mine(ctx.guildId, ctx.member.id, MINE_LIMIT);
    await ctx.interaction.editReply({ content: mineText(entries) });
  },
});
