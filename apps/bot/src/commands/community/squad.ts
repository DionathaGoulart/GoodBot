import { UserFacingError } from '@goodbot/shared';
import { MessageFlags, SlashCommandBuilder } from 'discord.js';

import {
  mineText,
  optOutToggledText,
  scheduleModal,
  searchToggledText,
  squadsConfigOrFail,
} from '../../interactions/squads';
import { defineCommand } from '../../lib/command';
import { levelAtLeast } from '../../services/permissions';

/** Quantas jogatinas o `/squad agenda` lista: o teto por host mais folga para as que a pessoa só vai. */
const MINE_LIMIT = 10;

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
      sub
        .setName('aviso')
        .setDescription('Liga ou desliga o aviso de squad quando você abre o jogo'),
    )
    .addSubcommand((sub) =>
      sub.setName('agendar').setDescription('Marca uma jogatina na agenda do servidor'),
    )
    .addSubcommand((sub) =>
      sub.setName('agenda').setDescription('Lista as jogatinas em que você está'),
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
  help:
    '`buscar` liga ou desliga a sua busca, `aviso` o aviso de quando você abre o jogo, ' +
    '`agendar` marca jogatina, `agenda` lista as suas e `painel` (admin) publica o painel ' +
    'de salas. Para remarcar, mudar vagas ou cancelar, use GERENCIAR na mensagem da jogatina.',
  async execute(ctx) {
    const subcommand = ctx.interaction.options.getSubcommand();
    if (subcommand === 'agendar') {
      const config = await squadsConfigOrFail(ctx, ctx.guildId);
      await ctx.interaction.showModal(scheduleModal(config));
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
    if (subcommand === 'agenda') {
      const entries = await ctx.squadAgenda.mine(ctx.guildId, ctx.member.id, MINE_LIMIT);
      await ctx.interaction.editReply({ content: mineText(entries) });
      return;
    }
    const content =
      subcommand === 'aviso'
        ? optOutToggledText(await ctx.squads.toggleOptOut(ctx.member, config))
        : searchToggledText(await ctx.squads.toggleSearch(ctx.member, config), config);
    await ctx.interaction.editReply({ content });
  },
});
