import { MAX_SLOWMODE_SECONDS, UserFacingError, formatDuration } from '@goodbot/shared';
import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { addChannelOption, requireUtilities, resolveChannel } from './shared';
import { defineCommand } from '../../lib/command';
import { botFooter, code, successEmbed } from '../../lib/embeds';
import { logEmbed } from '../../lib/log-embeds';

const builder = new SlashCommandBuilder()
  .setName('slowmode')
  .setDescription('Define o modo lento de um canal')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
  .addIntegerOption((option) =>
    option
      .setName('segundos')
      .setDescription(`Intervalo entre mensagens (0 desliga, máx. ${MAX_SLOWMODE_SECONDS})`)
      .setMinValue(0)
      .setMaxValue(MAX_SLOWMODE_SECONDS)
      .setRequired(true),
  );
addChannelOption(builder);

export default defineCommand({
  data: builder,
  module: 'utilities',
  level: 'mod',
  cooldown: 3,
  defer: true,
  ephemeral: true,
  help: 'Liga, ajusta ou desliga o modo lento de um canal.',
  async execute(ctx) {
    const config = await requireUtilities(ctx);
    const seconds = ctx.interaction.options.getInteger('segundos', true);
    if (seconds > config.slowmode.maxSeconds) {
      throw new UserFacingError(`O máximo configurado aqui é ${config.slowmode.maxSeconds}s.`, {
        code: 'SLOWMODE_TOO_LONG',
      });
    }

    const channel = resolveChannel(ctx.interaction);
    if (
      channel.type === ChannelType.GuildCategory ||
      channel.type === ChannelType.GuildStageVoice
    ) {
      throw new UserFacingError('Esse tipo de canal não tem modo lento.', {
        code: 'BAD_CHANNEL',
      });
    }

    await channel.setRateLimitPerUser(seconds, `slowmode por ${ctx.member.user.tag}`);
    const label = seconds === 0 ? 'desligado' : formatDuration(seconds * 1_000, { style: 'long' });

    await ctx.interaction.editReply({
      embeds: [
        successEmbed({
          title: 'Modo lento',
          description: `Modo lento de <#${channel.id}>: **${label}**.`,
          footer: botFooter('SLOWMODE'),
        }),
      ],
    });

    await ctx.modlog.postAction(ctx.guildId, {
      embeds: [
        logEmbed({
          title: 'Modo lento alterado',
          tone: 'update',
          fields: [
            {
              name: 'Moderador',
              value: `<@${ctx.member.id}>\n${code(ctx.member.id)}`,
              inline: true,
            },
            { name: 'Canal', value: `<#${channel.id}>`, inline: true },
            { name: 'Intervalo', value: label, inline: true },
          ],
          footer: `CANAL: ${channel.id}`,
        }),
      ],
    });
  },
});
