import { UserFacingError } from '@cobot/shared';
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { defineCommand } from '../../lib/command';
import { botFooter, warningEmbed } from '../../lib/embeds';

import type { WelcomeKind } from '../../services/welcome';

const KIND_LABEL: Record<WelcomeKind, string> = {
  join: 'entrada',
  leave: 'saída',
  dm: 'DM de entrada',
  boost: 'agradecimento de impulso',
};

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Mensagens de boas-vindas')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('test')
        .setDescription('Mostra como a mensagem ficaria, usando você como exemplo')
        .addStringOption((option) =>
          option
            .setName('tipo')
            .setDescription('Qual mensagem testar (padrão: entrada)')
            .addChoices(
              { name: 'entrada', value: 'join' },
              { name: 'saída', value: 'leave' },
              { name: 'DM de entrada', value: 'dm' },
              { name: 'agradecimento de impulso', value: 'boost' },
            ),
        ),
    ),
  module: 'welcome',
  level: 'admin',
  cooldown: 5,
  defer: true,
  ephemeral: true,
  help: 'Testa a mensagem de boas-vindas configurada.',
  async execute(ctx) {
    const kind = (ctx.interaction.options.getString('tipo') ?? 'join') as WelcomeKind;

    const config = await ctx.config.get(ctx.guildId, 'welcome');
    if (!config.enabled) {
      throw new UserFacingError('O módulo de boas-vindas está desligado neste servidor.', {
        code: 'MODULE_DISABLED',
      });
    }

    // O preview usa quem executou como membro de exemplo — é o jeito de ver as
    // variáveis já resolvidas antes de alguém entrar de verdade.
    const message = await ctx.welcome.build(kind, ctx.member);
    if (!message) {
      throw new UserFacingError(
        `A mensagem de ${KIND_LABEL[kind]} está desligada ou sem template. ` +
          'Configure no painel antes de testar.',
        { code: 'WELCOME_NOT_CONFIGURED' },
      );
    }

    const channelId = kind === 'dm' ? null : config[kind].channelId;
    await ctx.interaction.editReply({
      ...message,
      embeds: [
        ...(message.embeds ?? []),
        warningEmbed({
          title: 'Preview',
          description:
            `Mensagem de **${KIND_LABEL[kind]}**. ` +
            (channelId
              ? `No servidor ela vai para <#${channelId}>.`
              : kind === 'dm'
                ? 'No servidor ela vai por DM para quem entra.'
                : 'Nenhum canal configurado: ela não seria enviada.'),
          footer: botFooter('SÓ VOCÊ ESTÁ VENDO ISTO'),
        }),
      ],
    });
  },
});
