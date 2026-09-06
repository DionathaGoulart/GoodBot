import { MAX_PURGE, SECOND_MS, UserFacingError, isSnowflake } from '@cobot/shared';
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { addChannelOption, requireUtilities, resolveTextChannel } from './shared';
import { defineCommand } from '../../lib/command';
import { botFooter, code, successEmbed } from '../../lib/embeds';
import { logEmbed } from '../../lib/log-embeds';
import { chunk, describeFilters, matchesPurgeFilters, splitByAge } from '../../lib/purge';

import type { PurgeFilters } from '../../lib/purge';
import type { ChatInputCommandInteraction, Message } from 'discord.js';

/** Uma página do histórico do canal. */
const PAGE_SIZE = 100;
/** Teto de mensagens varridas: evita rodar o canal inteiro atrás de um filtro raro. */
const MAX_SCAN = 2_000;
/** Delay entre deletes individuais (>14 dias) — PRD §7.4. */
const INDIVIDUAL_DELAY_MS = SECOND_MS;
/** Atualiza a resposta efêmera a cada N deletes individuais. */
const PROGRESS_EVERY = 10;

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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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
    const channel = resolveTextChannel(interaction);
    const filters = readFilters(interaction);

    const requested = interaction.options.getInteger('quantidade', true);
    const amount = Math.min(requested, config.purge.maxPerCommand);

    // Varre o histórico em páginas até juntar o pedido ou bater no teto.
    const matched: Message[] = [];
    let cursor = filters.beforeId;
    let scanned = 0;
    while (matched.length < amount && scanned < MAX_SCAN) {
      const page = await channel.messages.fetch({ limit: PAGE_SIZE, before: cursor });
      if (page.size === 0) break;
      scanned += page.size;
      for (const message of page.values()) {
        if (matched.length >= amount) break;
        if (matchesPurgeFilters(message, filters)) matched.push(message);
      }
      cursor = page.last()?.id;
      if (!cursor) break;
      // `depois_de` limita o passado: não adianta paginar além dele.
      if (filters.afterId && BigInt(cursor) <= BigInt(filters.afterId)) break;
    }

    if (matched.length === 0) {
      await interaction.editReply({
        embeds: [
          successEmbed({
            title: 'Purge',
            description: 'Nenhuma mensagem bateu com os filtros.',
            fields: [{ name: 'Filtros', value: describeFilters(filters), inline: false }],
            footer: botFooter('PURGE'),
          }),
        ],
      });
      return;
    }

    const { bulk, individual } = splitByAge(matched);
    let deleted = 0;
    let failed = 0;

    for (const batch of chunk(bulk, PAGE_SIZE)) {
      try {
        const removed = await channel.bulkDelete(batch, true);
        deleted += removed.size;
      } catch (error) {
        failed += batch.length;
        ctx.logger.warn({ err: error, channelId: channel.id }, 'falha no bulkDelete do purge');
      }
    }

    if (individual.length > 0) {
      await interaction.editReply({
        content:
          `Apaguei ${deleted}. Faltam ${individual.length} mensagem(ns) com mais de 14 dias — ` +
          'elas vão uma a uma, com 1s entre cada.',
      });
    }

    for (const [index, message] of individual.entries()) {
      try {
        await message.delete();
        deleted += 1;
      } catch {
        failed += 1;
      }
      if ((index + 1) % PROGRESS_EVERY === 0 && index + 1 < individual.length) {
        await interaction.editReply({
          content: `Apagando antigas: ${index + 1}/${individual.length}…`,
        });
      }
      if (index + 1 < individual.length) await sleep(INDIVIDUAL_DELAY_MS);
    }

    const fields = [
      { name: 'Canal', value: `<#${channel.id}>`, inline: true },
      { name: 'Apagadas', value: `${deleted}`, inline: true },
      { name: 'Filtros', value: describeFilters(filters), inline: false },
    ];
    if (failed > 0) fields.push({ name: 'Falharam', value: `${failed}`, inline: true });

    await interaction.editReply({
      content: '',
      embeds: [
        successEmbed({
          title: 'Purge',
          description: `Apaguei ${deleted} mensagem(ns) em <#${channel.id}>.`,
          fields,
          footer: botFooter('PURGE'),
        }),
      ],
    });

    if (config.purge.logToModlog) {
      await ctx.modlog.postAction(ctx.guildId, {
        embeds: [
          logEmbed({
            title: 'Purge',
            tone: 'delete',
            fields: [
              { name: 'Moderador', value: `<@${ctx.member.id}>\n${code(ctx.member.id)}`, inline: true },
              { name: 'Canal', value: `<#${channel.id}>`, inline: true },
              { name: 'Apagadas', value: `${deleted}`, inline: true },
              { name: 'Filtros', value: describeFilters(filters), inline: false },
            ],
            footer: `CANAL: ${channel.id}`,
          }),
        ],
      });
    }
  },
});
