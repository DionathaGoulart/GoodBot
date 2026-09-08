import { MAX_PURGE } from '@cobot/shared';
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { runPurge } from './purge-run';
import { addChannelOption, requireUtilities, resolveTextChannel } from './shared';
import { defineCommand } from '../../lib/command';

/** Quantas mensagens `/clear` apaga quando ninguém diz o número. */
const DEFAULT_AMOUNT = 50;

const builder = new SlashCommandBuilder()
  .setName('clear')
  .setDescription('Limpa as mensagens recentes do canal')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addIntegerOption((option) =>
    option
      .setName('quantidade')
      .setDescription(`Quantas mensagens apagar (padrão: ${DEFAULT_AMOUNT}, máximo ${MAX_PURGE})`)
      .setMinValue(1)
      .setMaxValue(MAX_PURGE),
  )
  .addUserOption((option) =>
    option.setName('usuario').setDescription('Só mensagens deste usuário'),
  );
addChannelOption(builder, 'Canal onde limpar (padrão: este)');

/**
 * `/clear` é o `/purge` do dia a dia: mesmo motor, sem os oito filtros. Pede
 * só o número (opcional) e, quando muito, um autor — mensagens fixadas ficam,
 * como no `/purge`. Para recortes finos (`contém`, `apenas_links`, intervalo
 * de IDs) o comando continua sendo o `/purge`.
 */
export default defineCommand({
  data: builder,
  module: 'utilities',
  level: 'mod',
  cooldown: 5,
  defer: true,
  ephemeral: true,
  help: 'Apaga as mensagens recentes do canal (versão simples do /purge).',
  async execute(ctx) {
    const config = await requireUtilities(ctx);
    const { interaction } = ctx;
    const requested = interaction.options.getInteger('quantidade') ?? DEFAULT_AMOUNT;

    await runPurge(ctx, {
      channel: resolveTextChannel(interaction),
      // Fixadas preservadas: limpar o canal não pode derrubar o que o
      // servidor fixou de propósito.
      filters: { userId: interaction.options.getUser('usuario')?.id, keepPinned: true },
      amount: Math.min(requested, config.purge.maxPerCommand),
      title: 'Clear',
      logToModlog: config.purge.logToModlog,
    });
  },
});
