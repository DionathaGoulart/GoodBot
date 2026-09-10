import { LOG_KINDS } from '@goodbot/shared';
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { defineCommand } from '../../lib/command';
import { botFooter, code, infoEmbed } from '../../lib/embeds';

import type { LogConfigMap } from '@goodbot/db';
import type { LogKind } from '@goodbot/shared';

/** Nome do tipo de log em pt-BR, na ordem de `LOG_KINDS`. */
const KIND_LABELS: Record<LogKind, string> = {
  modlog: 'Mod-log',
  messages: 'Mensagens',
  members: 'Membros',
  server: 'Servidor',
  voice: 'Voz',
};

/** Uma linha da grade: `✔ Mensagens → #canal (herdado)`. */
function line(
  kind: LogKind,
  configs: LogConfigMap,
  fallbackChannelId: string | null,
  moduleEnabled: boolean,
): string {
  const entry = configs[kind];
  const channelId = entry.channelId ?? fallbackChannelId;
  const active = moduleEnabled && entry.enabled && Boolean(channelId);
  const mark = active ? '✔' : '✖';

  const destination = channelId
    ? `<#${channelId}>${entry.channelId ? '' : ' (herdado)'}`
    : '_sem canal_';

  const ignored: string[] = [];
  if (entry.ignoredChannelIds.length > 0) {
    ignored.push(`${entry.ignoredChannelIds.length} canal(is)`);
  }
  if (entry.ignoredRoleIds.length > 0) {
    ignored.push(`${entry.ignoredRoleIds.length} cargo(s)`);
  }
  const suffix = ignored.length > 0 ? ` · ignora ${ignored.join(' e ')}` : '';

  return `${mark} **${KIND_LABELS[kind]}** → ${destination}${suffix}`;
}

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('logs')
    .setDescription('Estado dos logs do servidor')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub.setName('status').setDescription('Mostra tipo de log, canal e se está ativo'),
    ),
  module: 'logs',
  level: 'mod',
  defer: true,
  ephemeral: true,
  help: 'Mostra a grade de logs: tipo → canal → ativo.',
  async execute(ctx) {
    const [moduleEnabled, configs] = await Promise.all([
      ctx.config.isEnabled(ctx.guildId, 'logs'),
      ctx.logs.getConfigs(ctx.guildId),
    ]);
    const fallbackChannelId = ctx.settings.logChannelId;

    const rows = LOG_KINDS.map((kind) =>
      line(kind, configs, fallbackChannelId, moduleEnabled),
    ).join('\n');

    const description = moduleEnabled
      ? rows
      : `⚠ O módulo ${code('logs')} está desligado; nada é publicado.\n\n${rows}`;

    await ctx.interaction.editReply({
      embeds: [
        infoEmbed(
          {
            title: 'Logs do servidor',
            description,
            fields: [
              {
                name: 'Canal geral',
                value: fallbackChannelId ? `<#${fallbackChannelId}>` : '_não configurado_',
                inline: true,
              },
            ],
            footer: botFooter('configure em /config ou no painel'),
          },
          ctx.settings.embedColor,
        ),
      ],
    });
  },
});
