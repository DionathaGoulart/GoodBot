import { SlashCommandBuilder } from 'discord.js';

import { squadsConfigOrFail } from '../../interactions/squads';
import { defineCommand } from '../../lib/command';
import { notifyText, toggleNotify } from '../../services/squads/notify';

/** `/avisos`: atalho do ME AVISA (PRD §5.11). Liga ou desliga o cargo `Bora`. */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('avisos')
    .setDescription('Liga ou desliga a menção quando alguém procura squad'),
  module: 'squads',
  level: 'member',
  defer: true,
  ephemeral: true,
  cooldown: 5,
  help: 'Dá ou tira o cargo de aviso: quem tem é mencionado nos cards de procurar squad.',
  async execute(ctx) {
    const config = await squadsConfigOrFail(ctx, ctx.guildId);
    await ctx.interaction.editReply({
      content: notifyText(await toggleNotify(ctx.member, config)),
    });
  },
});
