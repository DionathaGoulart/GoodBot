import { SlashCommandBuilder } from 'discord.js';

import { callModal, requireSquadChannel, squadsConfigOrFail } from '../../interactions/squads';
import { defineCommand } from '../../lib/command';

/**
 * `/procurar`: atalho do PROCURAR AGORA (PRD §5.11). Abre o modal do card; o
 * card vai para o `#buscar-squad`, com a sala de voz já criada.
 */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('procurar')
    .setDescription('Procura gente para jogar agora: abre uma sala e posta um card'),
  module: 'squads',
  level: 'member',
  // Sem `defer`: o modal exige a interação intacta.
  opensModal: true,
  ephemeral: true,
  cooldown: 5,
  help: 'Abre uma sala de voz e posta um card no canal de buscar squad, mencionando quem pediu aviso.',
  async execute(ctx) {
    const config = await squadsConfigOrFail(ctx, ctx.guildId);
    requireSquadChannel(config, 'chatChannelId');
    await ctx.interaction.showModal(callModal(config));
  },
});
