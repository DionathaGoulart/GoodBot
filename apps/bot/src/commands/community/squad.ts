import { SlashCommandBuilder } from 'discord.js';

import { searchToggledText, squadsConfigOrFail } from '../../interactions/squads';
import { defineCommand } from '../../lib/command';

/**
 * `/squad`: atalho dos botões do painel de squads (PRD §5.11). Botão antes de
 * comando: toda ação daqui também existe num botão.
 */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('squad')
    .setDescription('Buscar squad')
    .addSubcommand((sub) =>
      sub.setName('buscar').setDescription('Liga ou desliga o cargo Buscando Squad'),
    ),
  module: 'squads',
  level: 'member',
  defer: true,
  ephemeral: true,
  cooldown: 5,
  help: 'Liga ou desliga a sua busca por squad.',
  async execute(ctx) {
    const config = await squadsConfigOrFail(ctx, ctx.guildId);
    const state = await ctx.squads.toggleSearch(ctx.member, config);
    await ctx.interaction.editReply({ content: searchToggledText(state, config) });
  },
});
