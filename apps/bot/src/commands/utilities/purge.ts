import { MAX_PURGE, UserFacingError, isSnowflake } from '@cobot/shared';
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { runPurge } from './purge-run';
import { addChannelOption, requireUtilities, resolveTextChannel } from './shared';
import { defineCommand } from '../../lib/command';

import type { PurgeFilters } from '../../lib/purge';
import type { ChatInputCommandInteraction } from 'discord.js';

function readMessageId(
  interaction: ChatInputCommandInteraction,
  name: string,
): string | undefined {
  const raw = interaction.options.getString(name);
  if (!raw) return undefined;
  if (!isSnowflake(raw)) {
    throw new UserFacingError(`\`${raw}\` não parece um ID de mensagem.`, {
      code: 'BAD_SNOWFLAKE',
    });
  }
  return raw;
}

function readFilters(interaction: ChatInputCommandInteraction): PurgeFilters {
  return {
    userId: interaction.options.getUser('usuario')?.id,
    botsOnly: interaction.options.getBoolean('apenas_bots') ?? undefined,
    contains: interaction.options.getString('contem') ?? undefined,
    linksOnly: interaction.options.getBoolean('apenas_links') ?? undefined,
    attachmentsOnly: interaction.options.getBoolean('apenas_anexos') ?? undefined,
    beforeId: readMessageId(interaction, 'antes_de'),
    afterId: readMessageId(interaction, 'depois_de'),
    keepPinned: interaction.options.getBoolean('incluir_fixadas') === true ? false : true,
  };
}

const builder = new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Apaga mensagens em lote, com filtros')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((option) =>
      option
        .setName('quantidade')
        .setDescription(`Quantas mensagens apagar (1–${MAX_PURGE})`)
        .setMinValue(1)
        .setMaxValue(MAX_PURGE)
        .setRequired(true),
    )
    .addUserOption((option) =>
      option.setName('usuario').setDescription('Só mensagens deste usuário'),
    )
    .addBooleanOption((option) =>
      option.setName('apenas_bots').setDescription('Só mensagens de bots'),
    )
    .addStringOption((option) =>
      option.setName('contem').setDescription('Só mensagens que contenham este texto'),
    )
    .addBooleanOption((option) =>
      option.setName('apenas_links').setDescription('Só mensagens com link'),
    )
    .addBooleanOption((option) =>
      option.setName('apenas_anexos').setDescription('Só mensagens com anexo ou embed'),
    )
    .addStringOption((option) =>
      option.setName('antes_de').setDescription('Só mensagens anteriores a este ID'),
    )
    .addStringOption((option) =>
      option.setName('depois_de').setDescription('Só mensagens posteriores a este ID'),
    )
    .addBooleanOption((option) =>
      option.setName('incluir_fixadas').setDescription('Também apagar mensagens fixadas'),
    );
addChannelOption(builder, 'Canal onde apagar (padrão: este)');

export default defineCommand({
  data: builder,
  module: 'utilities',
  level: 'mod',
  cooldown: 5,
  defer: true,
  ephemeral: true,
  help: 'Apaga mensagens em lote com filtros de autor, conteúdo e período.',
  async execute(ctx) {
    const config = await requireUtilities(ctx);
    const { interaction } = ctx;

    await runPurge(ctx, {
      channel: resolveTextChannel(interaction),
      filters: readFilters(interaction),
      amount: Math.min(interaction.options.getInteger('quantidade', true), config.purge.maxPerCommand),
      title: 'Purge',
      logToModlog: config.purge.logToModlog,
    });
  },
});
