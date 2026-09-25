import { UserFacingError } from '@goodbot/shared';
import { MessageFlags, SlashCommandBuilder } from 'discord.js';

import { mineText, scheduleModal, squadsConfigOrFail } from '../../interactions/squads';
import { defineCommand } from '../../lib/command';
import { levelAtLeast } from '../../services/permissions';

/** Quantas jogatinas o `/squad agenda` lista: o teto por host mais folga para as que a pessoa só vai. */
const MINE_LIMIT = 10;

/**
 * `/squad`: atalho dos botões do buscar squad (PRD §5.11). Botão antes de
 * comando: toda ação daqui também existe num botão. É de `member`, menos o
 * `painel`, que é de `admin` (PRD §9.1).
 */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('squad')
    .setDescription('Buscar squad')
    .addSubcommand((sub) =>
      sub.setName('agendar').setDescription('Marca uma jogatina na agenda do servidor'),
    )
    .addSubcommand((sub) =>
      sub.setName('agenda').setDescription('Lista as jogatinas em que você está'),
    )
    .addSubcommand((sub) =>
      sub.setName('painel').setDescription('Publica ou atualiza os guias do buscar squad (admin)'),
    ),
  module: 'squads',
  level: 'member',
  // Sem `defer`: o `agendar` abre modal, que exige a interação intacta. Os
  // outros subcomandos adiam por conta própria.
  opensModal: true,
  ephemeral: true,
  cooldown: 5,
  help:
    '`agendar` marca jogatina, `agenda` lista as suas e `painel` (admin) publica os guias. ' +
    'Para remarcar, mudar vagas ou cancelar, use GERENCIAR na mensagem da jogatina.',
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
        throw new UserFacingError('Só a administração publica os guias do buscar squad.', {
          code: 'FORBIDDEN',
        });
      }
      // TODO(etapa 3): publica os guias e os botões dos três canais.
      throw new UserFacingError('Em construção: os guias do buscar squad voltam em breve.', {
        code: 'SQUADS_GUIDES_PENDING',
      });
    }
    await squadsConfigOrFail(ctx, ctx.guildId);
    const entries = await ctx.squadAgenda.mine(ctx.guildId, ctx.member.id, MINE_LIMIT);
    await ctx.interaction.editReply({ content: mineText(entries) });
  },
});
