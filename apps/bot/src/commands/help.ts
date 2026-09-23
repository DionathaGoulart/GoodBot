import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { defineCommand, isUserContextCommand } from '../lib/command';
import { botFooter, code, infoEmbed } from '../lib/embeds';
import { groupByModule } from '../lib/loader';
import { levelAtLeast } from '../services/permissions';

import type { Module } from '@goodbot/shared';

/** Nome amigável de cada módulo no `/help`. */
const MODULE_LABELS: Record<Module, string> = {
  general: 'Geral',
  moderation: 'Moderação',
  automod: 'Automod',
  logs: 'Logs',
  welcome: 'Boas-vindas',
  autorole: 'Autorole',
  reaction_roles: 'Cargos por reação',
  tickets: 'Tickets',
  tags: 'Tags',
  utilities: 'Utilidades',
  stats: 'Estatísticas',
  social: 'Redes sociais',
  squads: 'Buscar squad',
};

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Lista os comandos disponíveis para você')
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),
  module: 'general',
  level: 'member',
  cooldown: 5,
  help: 'Esta lista.',
  async execute({ interaction, commands, level, settings }) {
    const visible = commands.filter((command) => levelAtLeast(level, command.level));
    const groups = groupByModule(visible);

    const fields = [...groups.entries()].map(([module, list]) => ({
      name: MODULE_LABELS[module as Module] ?? module,
      value: list
        .map((command) => {
          const json = command.data.toJSON();
          const description = command.help ?? ('description' in json ? json.description : '');
          // Menu de contexto não é digitado: aparece sem a barra.
          const label = isUserContextCommand(command)
            ? `${command.data.name} (menu de contexto)`
            : `/${command.data.name}`;
          return `${code(label)} — ${description}`;
        })
        .join('\n'),
      inline: false,
    }));

    await interaction.reply({
      embeds: [
        infoEmbed(
          {
            title: 'Comandos',
            description:
              fields.length > 0
                ? `Seu nível de acesso: ${code(level)}.`
                : 'Nenhum comando disponível para o seu nível.',
            fields,
            footer: botFooter(`${visible.size} COMANDO(S)`),
          },
          settings.embedColor,
        ),
      ],
    });
  },
});
