import { MODULES } from '@goodbot/shared';
import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { defineCommand } from '../lib/command';
import { botFooter, code, successEmbed } from '../lib/embeds';

import type { Module } from '@goodbot/shared';

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configuração do bot')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('reload')
        .setDescription('Recarrega a configuração do banco (limpa o cache)')
        .addStringOption((option) =>
          option
            .setName('modulo')
            .setDescription('Só este módulo; em branco recarrega todos')
            .addChoices(...MODULES.map((module) => ({ name: module, value: module }))),
        ),
    ),
  module: 'general',
  level: 'admin',
  // Responde efêmero sem `defer`: sem esta marca, o adiamento automático de
  // 2,5 s (lib/interaction.ts) abriria a resposta em público.
  ephemeral: true,
  cooldown: 5,
  help: 'Recarrega a configuração do banco.',
  async execute({ interaction, config, guildId, settings }) {
    const module = interaction.options.getString('modulo') as Module | null;

    // Passa pelo bus: quem mais estiver escutando (API interna) também limpa.
    config.publishInvalidate(guildId, module ?? undefined);
    await config.warm(guildId);

    await interaction.reply({
      embeds: [
        successEmbed({
          title: 'Configuração recarregada',
          description: module
            ? `Cache do módulo ${code(module)} foi invalidado e recarregado.`
            : 'Cache de todos os módulos foi invalidado e recarregado.',
          footer: botFooter(settings.stored ? undefined : 'GUILD SEM SETTINGS: USANDO DEFAULTS'),
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
});
