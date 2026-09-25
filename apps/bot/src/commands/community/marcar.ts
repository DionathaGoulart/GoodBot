import { SlashCommandBuilder } from 'discord.js';

import { requireSquadChannel, scheduleModal, squadsConfigOrFail } from '../../interactions/squads';
import { defineCommand } from '../../lib/command';

/**
 * `/marcar`: atalho do MARCAR JOGATINA (PRD §5.11). Abre o modal; a jogatina
 * vai para o `#agenda` e nasce privada.
 */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('marcar')
    .setDescription('Marca uma jogatina para mais tarde na agenda do servidor'),
  module: 'squads',
  level: 'member',
  // Sem `defer`: o modal exige a interação intacta.
  opensModal: true,
  ephemeral: true,
  cooldown: 5,
  help:
    'Marca uma jogatina na agenda. Para remarcar, mudar vagas, convidar ou cancelar, use ' +
    'GERENCIAR na mensagem dela.',
  async execute(ctx) {
    const config = await squadsConfigOrFail(ctx, ctx.guildId);
    requireSquadChannel(config, 'agendaChannelId');
    await ctx.interaction.showModal(scheduleModal(config));
  },
});
