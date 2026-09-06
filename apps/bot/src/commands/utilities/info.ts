import { countCasesByType } from '@cobot/db';
import { CASE_TYPES, UserFacingError } from '@cobot/shared';
import {
  ChannelType,
  GuildPremiumTier,
  PermissionFlagsBits,
  PermissionsBitField,
  SlashCommandBuilder,
  time,
  TimestampStyles,
} from 'discord.js';

import { requireUtilities } from './shared';
import { defineCommand } from '../../lib/command';
import { botFooter, code, infoEmbed } from '../../lib/embeds';
import { roleMentions } from '../../lib/log-embeds';
import { fetchMember } from '../../services/moderation';
import { levelAtLeast } from '../../services/permissions';

import type { CaseType } from '@cobot/shared';
import type { APIEmbedField, GuildMember } from 'discord.js';

const CASE_TYPE_LABELS: Record<CaseType, string> = {
  ban: 'bans',
  unban: 'unbans',
  softban: 'softbans',
  kick: 'kicks',
  timeout: 'timeouts',
  untimeout: 'untimeouts',
  warn: 'avisos',
  note: 'notas',
};

const BOOST_TIER_LABELS: Record<GuildPremiumTier, string> = {
  [GuildPremiumTier.None]: 'nenhum',
  [GuildPremiumTier.Tier1]: 'nível 1',
  [GuildPremiumTier.Tier2]: 'nível 2',
  [GuildPremiumTier.Tier3]: 'nível 3',
};

/** `<t:…:F> (<t:…:R>)`: data absoluta com o "há quanto tempo" ao lado. */
function fullDate(date: Date | number | null | undefined): string {
  if (!date) return '—';
  return `${time(new Date(date), TimestampStyles.ShortDateTime)} (${time(
    new Date(date),
    TimestampStyles.RelativeTime,
  )})`;
}

export const userinfo = defineCommand({
  data: new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Mostra os dados de um usuário e o resumo dos casos dele')
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages)
    .addUserOption((option) =>
      option.setName('usuario').setDescription('Quem consultar (padrão: você)'),
    ),
  module: 'utilities',
  level: 'member',
  cooldown: 5,
  defer: true,
  help: 'Dados de um usuário: entrada, criação, cargos e casos.',
  async execute(ctx) {
    await requireUtilities(ctx);
    const user = ctx.interaction.options.getUser('usuario') ?? ctx.interaction.user;
    const guild = ctx.interaction.guild;
    const member = guild ? await fetchMember(guild, user.id) : null;

    const fields: APIEmbedField[] = [
      { name: 'Usuário', value: `<@${user.id}> ${user.tag}`, inline: true },
      { name: 'ID', value: code(user.id), inline: true },
      { name: 'Bot', value: user.bot ? 'sim' : 'não', inline: true },
      { name: 'Conta criada', value: fullDate(user.createdTimestamp), inline: false },
    ];

    if (member) {
      fields.push({ name: 'Entrou', value: fullDate(member.joinedTimestamp), inline: false });
      if (member.premiumSinceTimestamp) {
        fields.push({
          name: 'Impulsiona desde',
          value: fullDate(member.premiumSinceTimestamp),
          inline: false,
        });
      }
      if (member.communicationDisabledUntilTimestamp) {
        fields.push({
          name: 'Timeout até',
          value: fullDate(member.communicationDisabledUntilTimestamp),
          inline: false,
        });
      }
      const roleIds = member.roles.cache
        .filter((role) => role.id !== guild?.id)
        .sort((a, b) => b.position - a.position)
        .map((role) => role.id);
      fields.push({
        name: `Cargos (${roleIds.length})`,
        value: roleMentions(roleIds),
        inline: false,
      });
    }

    // O histórico de moderação de outra pessoa é só para a equipe (PRD §9.1).
    if (levelAtLeast(ctx.level, 'mod') || user.id === ctx.member.id) {
      const counts = await countCasesByType(ctx.db, ctx.guildId, user.id);
      const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
      const summary = CASE_TYPES.filter((type) => (counts[type] ?? 0) > 0)
        .map((type) => `${counts[type]} ${CASE_TYPE_LABELS[type]}`)
        .join(' · ');
      fields.push({
        name: 'Casos',
        value: total === 0 ? 'Nenhum caso registrado.' : `**${total}** no total — ${summary}`,
        inline: false,
      });
    }

    const embed = infoEmbed(
      { title: 'Usuário', fields, footer: botFooter(`ID: ${user.id}`) },
      ctx.settings.embedColor,
    ).setThumbnail(user.displayAvatarURL({ size: 256 }));

    await ctx.interaction.editReply({ embeds: [embed] });
  },
});

export const serverinfo = defineCommand({
  data: new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('Mostra os dados do servidor')
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),
  module: 'utilities',
  level: 'member',
  cooldown: 5,
  defer: true,
  help: 'Membros, canais, cargos, boosts e dono do servidor.',
  async execute(ctx) {
    await requireUtilities(ctx);
    const guild = ctx.interaction.guild;
    if (!guild) {
      throw new UserFacingError('Este comando só funciona dentro do servidor.', {
        code: 'NO_GUILD',
      });
    }

    const owner = await guild.fetchOwner().catch(() => null);
    const channels = guild.channels.cache;
    const text = channels.filter((channel) => channel.isTextBased() && !channel.isThread()).size;
    const voice = channels.filter((channel) => channel.isVoiceBased()).size;
    const categories = channels.filter(
      (channel) => channel.type === ChannelType.GuildCategory,
    ).size;

    const embed = infoEmbed(
      {
        title: 'Servidor',
        fields: [
          { name: 'Nome', value: guild.name, inline: true },
          { name: 'ID', value: code(guild.id), inline: true },
          { name: 'Dono', value: owner ? `<@${owner.id}>` : '—', inline: true },
          { name: 'Membros', value: `${guild.memberCount}`, inline: true },
          { name: 'Cargos', value: `${guild.roles.cache.size}`, inline: true },
          { name: 'Emojis', value: `${guild.emojis.cache.size}`, inline: true },
          {
            name: 'Canais',
            value: `${text} de texto · ${voice} de voz · ${categories} categoria(s)`,
            inline: false,
          },
          {
            name: 'Impulsos',
            value: `${guild.premiumSubscriptionCount ?? 0} (${BOOST_TIER_LABELS[guild.premiumTier]})`,
            inline: true,
          },
          { name: 'Criado', value: fullDate(guild.createdTimestamp), inline: false },
        ],
        footer: botFooter(`ID: ${guild.id}`),
      },
      ctx.settings.embedColor,
    );
    const icon = guild.iconURL({ size: 256 });
    if (icon) embed.setThumbnail(icon);

    await ctx.interaction.editReply({ embeds: [embed] });
  },
});

export const avatar = defineCommand({
  data: new SlashCommandBuilder()
    .setName('avatar')
    .setDescription('Mostra o avatar de um usuário')
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages)
    .addUserOption((option) =>
      option.setName('usuario').setDescription('De quem (padrão: você)'),
    ),
  module: 'utilities',
  level: 'member',
  cooldown: 5,
  defer: true,
  help: 'Avatar global e o do servidor, quando existir.',
  async execute(ctx) {
    await requireUtilities(ctx);
    const user = ctx.interaction.options.getUser('usuario') ?? ctx.interaction.user;
    const guild = ctx.interaction.guild;
    const member: GuildMember | null = guild ? await fetchMember(guild, user.id) : null;

    const global = user.displayAvatarURL({ size: 1024 });
    // `avatarURL` sem fallback: só existe quando o avatar do servidor é próprio.
    const guildAvatar = member?.avatarURL({ size: 1024 }) ?? null;

    const links = [`[Global](${global})`];
    if (guildAvatar) links.push(`[Do servidor](${guildAvatar})`);

    const embed = infoEmbed(
      {
        title: 'Avatar',
        description: `${user.tag}\n${links.join(' · ')}`,
        footer: botFooter(`ID: ${user.id}`),
      },
      ctx.settings.embedColor,
    ).setImage(guildAvatar ?? global);

    await ctx.interaction.editReply({ embeds: [embed] });
  },
});

export const roleinfo = defineCommand({
  data: new SlashCommandBuilder()
    .setName('roleinfo')
    .setDescription('Mostra os dados de um cargo')
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages)
    .addRoleOption((option) =>
      option.setName('cargo').setDescription('Qual cargo').setRequired(true),
    ),
  module: 'utilities',
  level: 'member',
  cooldown: 5,
  defer: true,
  help: 'Cor, posição, permissões e quantos membros têm o cargo.',
  async execute(ctx) {
    await requireUtilities(ctx);
    const guild = ctx.interaction.guild;
    const chosen = ctx.interaction.options.getRole('cargo', true);
    const role = guild?.roles.cache.get(chosen.id);
    if (!role) {
      throw new UserFacingError('Não encontrei esse cargo no servidor.', { code: 'NO_ROLE' });
    }

    const permissions = role.permissions.has(PermissionsBitField.Flags.Administrator)
      ? 'Administrador (todas)'
      : role.permissions.toArray().slice(0, 20).map(code).join(' ') || '—';

    const embed = infoEmbed(
      {
        title: 'Cargo',
        fields: [
          { name: 'Cargo', value: `<@&${role.id}> ${role.name}`, inline: true },
          { name: 'ID', value: code(role.id), inline: true },
          { name: 'Membros', value: `${role.members.size}`, inline: true },
          { name: 'Cor', value: role.hexColor, inline: true },
          { name: 'Posição', value: `${role.position}`, inline: true },
          { name: 'Mencionável', value: role.mentionable ? 'sim' : 'não', inline: true },
          { name: 'Exibido à parte', value: role.hoist ? 'sim' : 'não', inline: true },
          { name: 'Gerenciado por integração', value: role.managed ? 'sim' : 'não', inline: true },
          { name: 'Criado', value: fullDate(role.createdTimestamp), inline: false },
          { name: 'Permissões', value: permissions, inline: false },
        ],
        footer: botFooter(`ID: ${role.id}`),
        color: role.color === 0 ? undefined : role.color,
      },
      ctx.settings.embedColor,
    );

    await ctx.interaction.editReply({ embeds: [embed] });
  },
});
