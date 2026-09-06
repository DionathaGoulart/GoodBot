import { summary, topChannels, topUsers } from '@cobot/db';
import { DAY_MS, UserFacingError } from '@cobot/shared';
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { defineCommand } from '../../lib/command';
import { botFooter, code, infoEmbed } from '../../lib/embeds';

import type { StatsPeriod, SummaryTile } from '@cobot/db';
import type { APIEmbedField } from 'discord.js';

/** Janela do resumo no Discord; o painel é quem oferece períodos livres. */
const WINDOW_DAYS = 7;
const TOP_LIMIT = 5;

/** `1.234` — separador de milhar pt-BR, sem depender do locale do processo. */
function number(value: number): string {
  return value.toLocaleString('pt-BR');
}

/** `12.340 (+320)` — o delta é contra os 7 dias anteriores. */
function tile(value: SummaryTile): string {
  if (value.delta === 0) return number(value.current);
  const sign = value.delta > 0 ? '+' : '−';
  return `${number(value.current)} (${sign}${number(Math.abs(value.delta))})`;
}

function ranking(rows: readonly { id: string; count: number }[], mention: (id: string) => string) {
  if (rows.length === 0) return '—';
  return rows.map((row, index) => `${index + 1}. ${mention(row.id)} — ${number(row.count)}`).join('\n');
}

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription(`Resumo das estatísticas dos últimos ${WINDOW_DAYS} dias`)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  module: 'stats',
  level: 'mod',
  cooldown: 10,
  defer: true,
  help: 'Resumo de mensagens, membros, moderação e tickets dos últimos 7 dias.',
  async execute(ctx) {
    const config = await ctx.config.get(ctx.guildId, 'stats');
    if (!config.enabled) {
      throw new UserFacingError('A coleta de estatísticas está desligada neste servidor.', {
        code: 'MODULE_DISABLED',
      });
    }

    // O que ainda está na memória do agregador só apareceria no próximo minuto.
    await ctx.stats.flush();

    const to = new Date();
    const period: StatsPeriod = {
      guildId: ctx.guildId,
      from: new Date(to.getTime() - WINDOW_DAYS * DAY_MS),
      to,
      timezone: ctx.settings.timezone,
    };

    const [totals, channels, users] = await Promise.all([
      summary(ctx.db, period),
      topChannels(ctx.db, period, TOP_LIMIT),
      config.trackTopUsers
        ? topUsers(ctx.db, period, TOP_LIMIT)
        : Promise.resolve([] as { id: string; count: number }[]),
    ]);

    const fields: APIEmbedField[] = [
      { name: 'Mensagens', value: tile(totals.messages), inline: true },
      { name: 'Entradas', value: tile(totals.joins), inline: true },
      { name: 'Saídas', value: tile(totals.leaves), inline: true },
      { name: 'Casos', value: tile(totals.cases), inline: true },
      { name: 'Hits de automod', value: tile(totals.automodHits), inline: true },
      { name: 'Comandos', value: tile(totals.commands), inline: true },
      { name: 'Tickets abertos', value: tile(totals.ticketsOpened), inline: true },
      { name: 'Minutos em voz', value: tile(totals.voiceMinutes), inline: true },
      {
        name: 'Membros',
        value: totals.membersTotal === null ? '—' : number(totals.membersTotal),
        inline: true,
      },
      { name: `Top ${TOP_LIMIT} canais`, value: ranking(channels, (id) => `<#${id}>`) },
    ];

    if (config.trackTopUsers) {
      fields.push({ name: `Top ${TOP_LIMIT} membros`, value: ranking(users, (id) => `<@${id}>`) });
    }

    const embed = infoEmbed(
      {
        title: 'Estatísticas',
        description: `Últimos ${WINDOW_DAYS} dias · fuso ${code(ctx.settings.timezone)}`,
        fields,
        footer: botFooter('STATS'),
      },
      ctx.settings.embedColor,
    );

    await ctx.interaction.editReply({ embeds: [embed] });
  },
});
