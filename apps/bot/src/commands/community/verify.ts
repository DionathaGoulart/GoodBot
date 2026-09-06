import { setModuleConfig } from '@cobot/db';
import { UserFacingError } from '@cobot/shared';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

import { VERIFY_BUTTON_ID } from '../../interactions/verify';
import { defineCommand } from '../../lib/command';
import { botFooter, code, infoEmbed, successEmbed } from '../../lib/embeds';

import type { Role } from 'discord.js';

const DEFAULT_TEXT = 'Clique no botão abaixo para liberar o acesso ao servidor.';

/** O bot só consegue dar cargos abaixo do seu mais alto e não gerenciados. */
function assertAssignable(role: Role): void {
  const me = role.guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new UserFacingError('Eu não tenho a permissão **Gerenciar cargos**.', {
      code: 'MISSING_PERMISSION',
    });
  }
  if (role.managed) {
    throw new UserFacingError(`${role} é gerenciado por uma integração e não pode ser dado.`, {
      code: 'MANAGED_ROLE',
    });
  }
  if (role.position >= me.roles.highest.position) {
    throw new UserFacingError(
      `${role} está acima do meu cargo mais alto. Suba meu cargo na hierarquia.`,
      { code: 'ROLE_HIERARCHY' },
    );
  }
}

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Cargo de verificação por botão')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription('Publica a mensagem de verificação num canal')
        .addChannelOption((option) =>
          option
            .setName('canal')
            .setDescription('Onde publicar a mensagem')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true),
        )
        .addRoleOption((option) =>
          option
            .setName('cargo')
            .setDescription('Cargo dado a quem clicar')
            .setRequired(true),
        )
        .addStringOption((option) =>
          option.setName('texto').setDescription('Texto da mensagem').setMaxLength(1_000),
        )
        .addStringOption((option) =>
          option.setName('botao').setDescription('Texto do botão (padrão: Verificar)').setMaxLength(80),
        ),
    ),
  module: 'autorole',
  level: 'admin',
  cooldown: 10,
  defer: true,
  ephemeral: true,
  help: 'Publica a mensagem com o botão de verificação.',
  async execute(ctx) {
    const channel = ctx.interaction.options.getChannel('canal', true);
    const role = ctx.interaction.options.getRole('cargo', true) as Role;
    const text = ctx.interaction.options.getString('texto') ?? DEFAULT_TEXT;
    const config = await ctx.config.get(ctx.guildId, 'autorole');
    const buttonLabel = ctx.interaction.options.getString('botao') ?? config.verify.buttonLabel;

    assertAssignable(role);

    const target = await ctx.interaction.guild?.channels.fetch(channel.id).catch(() => null);
    if (!target?.isTextBased() || target.isDMBased()) {
      throw new UserFacingError('Não consigo publicar nesse canal.', { code: 'BAD_CHANNEL' });
    }

    const sent = await target.send({
      embeds: [
        infoEmbed(
          {
            title: 'Verificação',
            description: text,
            footer: botFooter(),
          },
          ctx.settings.embedColor,
        ),
      ],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(VERIFY_BUTTON_ID)
            .setLabel(buttonLabel.toUpperCase())
            .setStyle(ButtonStyle.Success),
        ),
      ],
    });

    // A mensagem é persistente: o que faz o botão funcionar depois de um
    // restart é esta config, não nada em memória.
    await setModuleConfig(
      ctx.db,
      ctx.guildId,
      'autorole',
      {
        ...config,
        enabled: true,
        verify: {
          enabled: true,
          channelId: target.id,
          messageId: sent.id,
          roleId: role.id,
          buttonLabel,
        },
      },
      ctx.member.id,
    );
    ctx.config.publishInvalidate(ctx.guildId, 'autorole');

    await ctx.interaction.editReply({
      embeds: [
        successEmbed({
          title: 'Verificação publicada',
          description: `A mensagem está em ${target} e dá o cargo ${role}.`,
          fields: [
            { name: 'Mensagem', value: code(sent.id), inline: true },
            { name: 'Botão', value: buttonLabel, inline: true },
          ],
          footer: botFooter(config.enabled ? undefined : 'MÓDULO AUTOROLE LIGADO AGORA'),
        }),
      ],
    });
  },
});
