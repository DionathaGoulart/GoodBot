import { SECOND_MS } from '@goodbot/shared';

import { botFooter, code, successEmbed } from '../../lib/embeds';
import { logEmbed } from '../../lib/log-embeds';
import { chunk, describeFilters, matchesPurgeFilters, splitByAge } from '../../lib/purge';

import type { CommandContext } from '../../lib/command';
import type { PurgeFilters } from '../../lib/purge';
import type { GuildTextBasedChannel, Message } from 'discord.js';

/** Uma página do histórico do canal. */
const PAGE_SIZE = 100;
/** Teto de mensagens varridas: evita rodar o canal inteiro atrás de um filtro raro. */
const MAX_SCAN = 2_000;
/** Delay entre deletes individuais (>14 dias) — PRD §7.4. */
const INDIVIDUAL_DELAY_MS = SECOND_MS;
/** Atualiza a resposta efêmera a cada N deletes individuais. */
const PROGRESS_EVERY = 10;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface PurgeRequest {
  channel: GuildTextBasedChannel;
  filters: PurgeFilters;
  /** Quantas mensagens apagar, já limitada pelo teto da config. */
  amount: number;
  /** Título do embed e do mod-log: `Purge` ou `Clear`. */
  title: string;
  /** Registrar no mod-log (vem de `utilities.purge.logToModlog`). */
  logToModlog: boolean;
}

/**
 * Varre o histórico do canal aplicando os filtros e apaga o que casar. É o
 * miolo compartilhado por `/purge` (com filtros) e `/clear` (sem eles), então
 * as duas telas contam a mesma história no mod-log e respeitam o mesmo teto.
 *
 * Exige uma interação já adiada e efêmera (`defer`/`ephemeral` do comando).
 */
export async function runPurge(ctx: CommandContext, request: PurgeRequest): Promise<void> {
  const { interaction } = ctx;
  const { channel, filters, amount, title } = request;

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
          title,
          description: 'Nenhuma mensagem bateu com os filtros.',
          fields: [{ name: 'Filtros', value: describeFilters(filters), inline: false }],
          footer: botFooter(title.toUpperCase()),
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
        title,
        description: `Apaguei ${deleted} mensagem(ns) em <#${channel.id}>.`,
        fields,
        footer: botFooter(title.toUpperCase()),
      }),
    ],
  });

  if (request.logToModlog) {
    await ctx.modlog.postAction(ctx.guildId, {
      embeds: [
        logEmbed({
          title,
          tone: 'delete',
          fields: [
            {
              name: 'Moderador',
              value: `<@${ctx.member.id}>\n${code(ctx.member.id)}`,
              inline: true,
            },
            { name: 'Canal', value: `<#${channel.id}>`, inline: true },
            { name: 'Apagadas', value: `${deleted}`, inline: true },
            { name: 'Filtros', value: describeFilters(filters), inline: false },
          ],
          footer: `CANAL: ${channel.id}`,
        }),
      ],
    });
  }
}
