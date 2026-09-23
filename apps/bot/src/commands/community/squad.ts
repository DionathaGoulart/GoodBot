import { UserFacingError } from '@goodbot/shared';
import { SlashCommandBuilder } from 'discord.js';

import { searchToggledText, squadsConfigOrFail } from '../../interactions/squads';
import { defineCommand } from '../../lib/command';
import { levelAtLeast } from '../../services/permissions';

/**
 * `/squad`: atalho dos botões do painel de squads (PRD §5.11). Botão antes de
 * comando: toda ação daqui também existe num botão. É de `member`, menos o
 * `painel`, que é de `admin` (PRD §9.1).
 */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('squad')
    .setDescription('Buscar squad')
    .addSubcommand((sub) =>
      sub.setName('buscar').setDescription('Liga ou desliga o cargo Buscando Squad'),
    )
    .addSubcommand((sub) =>
      sub.setName('painel').setDescription('Publica ou atualiza o painel de salas (admin)'),
    ),
  module: 'squads',
  level: 'member',
  defer: true,
  ephemeral: true,
  cooldown: 5,
  help: 'Liga ou desliga a sua busca por squad; a administração publica o painel.',
  async execute(ctx) {
    if (ctx.interaction.options.getSubcommand() === 'painel') {
      if (!levelAtLeast(ctx.level, 'admin')) {
        throw new UserFacingError('Só a administração publica o painel de squads.', {
          code: 'FORBIDDEN',
        });
      }
      const guild = ctx.interaction.guild;
      if (!guild) throw new UserFacingError('Use este comando no servidor.', { code: 'NO_GUILD' });
      const published = await ctx.squadPanel.publish(guild, ctx.member.id, 'command');
      await ctx.interaction.editReply({
        content: published.created
          ? `Painel publicado em <#${published.channelId}>.`
          : `Painel atualizado em <#${published.channelId}>.`,
      });
      return;
    }
    const config = await squadsConfigOrFail(ctx, ctx.guildId);
    const state = await ctx.squads.toggleSearch(ctx.member, config);
    await ctx.interaction.editReply({ content: searchToggledText(state, config) });
  },
});
