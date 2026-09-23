import { UserFacingError } from '@goodbot/shared';
import { MessageFlags, SlashCommandBuilder } from 'discord.js';

import { scheduleModal, searchToggledText, squadsConfigOrFail } from '../../interactions/squads';
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
      sub.setName('agendar').setDescription('Marca uma jogatina como evento do servidor'),
    )
    .addSubcommand((sub) =>
      sub.setName('painel').setDescription('Publica ou atualiza o painel de salas (admin)'),
    ),
  module: 'squads',
  level: 'member',
  // Sem `defer`: o `agendar` abre modal, que exige a interação intacta. Os
  // outros subcomandos adiam por conta própria.
  opensModal: true,
  ephemeral: true,
  cooldown: 5,
  help: 'Liga ou desliga a sua busca por squad e marca jogatina; a administração publica o painel.',
  async execute(ctx) {
    const subcommand = ctx.interaction.options.getSubcommand();
    if (subcommand === 'agendar') {
      await squadsConfigOrFail(ctx, ctx.guildId);
      await ctx.interaction.showModal(scheduleModal());
      return;
    }
    await ctx.interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (subcommand === 'painel') {
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
